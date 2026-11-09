using System.Text;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Extensions;
using Microsoft.CodeAnalysis.Text;

namespace Shinobi.Refactorings;

public sealed record CheckEditsRequest([property: JsonPropertyName("edits")] IReadOnlyList<TextEdit> Edits);

/// <summary>The edits of the language server's own Extract method / Extract local function, checked and repaired where the server gets it wrong.</summary>
public sealed class CheckEditsHandler : DocumentHandler<CheckEditsRequest, ExtractInterfaceResult?>
{
    public override Task<ExtractInterfaceResult?> ExecuteAsync(CheckEditsRequest message, Document document, CancellationToken cancellationToken)
        => ExtractMethodRepair.RunAsync(document, message.Edits, cancellationToken).ContinueWith(t => (ExtractInterfaceResult?)t.Result, cancellationToken);
}

/// <summary>
/// The Roslyn server's Extract method makes an out parameter of a variable that the selection assigns only on some paths (an
/// <c>out var</c> or a pattern variable behind <c>&amp;&amp;</c>) and does not assign it at the start of the new method: CS0177. This applies
/// the server's edits to a copy of the solution, compiles, adds <c>name = default;</c> where that error says so, and compiles
/// again. What cannot be repaired (ref/out in async methods or lambdas, anything else) comes back as errors, nothing is applied.
/// </summary>
public static class ExtractMethodRepair
{
    private const int MaxRounds = 4;

    public static async Task<ExtractInterfaceResult> RunAsync(Document document, IReadOnlyList<TextEdit> edits, CancellationToken ct)
    {
        var text = await document.GetTextAsync(ct).ConfigureAwait(false);
        var current = edits.OrderBy(e => text.Lines[e.StartLine].Start + e.StartCharacter).ToList();
        ExtractInterfaceResult result = new(current, null, null);
        for (var round = 0; round < MaxRounds; round++)
        {
            var (after, added) = await RefactoringValidator.NewDiagnosticsAsync(document, result, ct).ConfigureAwait(false);
            if (added.Count == 0) { return result; }
            var repaired = after is null ? null : await RepairAsync(text, current, after, added, ct).ConfigureAwait(false);
            if (repaired is null)
            {
                return result with { Errors = added.Select(RefactoringValidator.Describe).ToList() };
            }
            current = repaired;
            result = new ExtractInterfaceResult(current, null, null);
        }
        var (_, left) = await RefactoringValidator.NewDiagnosticsAsync(document, result, ct).ConfigureAwait(false);
        return left.Count == 0 ? result : result with { Errors = left.Select(RefactoringValidator.Describe).ToList() };
    }

    /// <summary>The edits with the missing assignments added, or null when the errors are not (all) the kind this repairs.</summary>
    private static async Task<List<TextEdit>?> RepairAsync(SourceText original, List<TextEdit> edits, Document after, IReadOnlyList<Diagnostic> added, CancellationToken ct)
    {
        var tree = await after.GetSyntaxTreeAsync(ct).ConfigureAwait(false);
        var newText = await after.GetTextAsync(ct).ConfigureAwait(false);
        if (tree is null) { return null; }
        var root = await tree.GetRootAsync(ct).ConfigureAwait(false);
        var languageVersion = ((CSharpParseOptions)tree.Options).LanguageVersion.MapSpecifiedToEffectiveVersion();

        // CS0177 is the only error repaired: "The out parameter 'x' must be assigned to before control leaves the current method"
        if (added.Any(d => d.Id != "CS0177" || d.Location.SourceTree != tree)) { return null; }

        var perMethod = new Dictionary<SyntaxNode, List<ParameterSyntax>>();
        foreach (var diagnostic in added)
        {
            var node = root.FindNode(diagnostic.Location.SourceSpan);
            var function = node.AncestorsAndSelf().FirstOrDefault(n => n is BaseMethodDeclarationSyntax or LocalFunctionStatementSyntax);
            var parameters = function switch
            {
                BaseMethodDeclarationSyntax m => m.ParameterList.Parameters,
                LocalFunctionStatementSyntax l => l.ParameterList.Parameters,
                _ => default,
            };
            if (function is null) { return null; }
            var message = diagnostic.GetMessage();
            // the message names the parameter (in any language): the out parameters it mentions
            var named = parameters.Where(p => p.Modifiers.Any(SyntaxKind.OutKeyword)
                && Regex.IsMatch(message, $@"(?<![\w]){Regex.Escape(p.Identifier.Text)}(?![\w])")).ToList();
            if (named.Count == 0) { return null; }
            if (!perMethod.TryGetValue(function, out var list)) { perMethod[function] = list = []; }
            foreach (var parameter in named.Where(p => !list.Contains(p))) { list.Add(parameter); }
        }

        var eol = newText.ToString().Contains("\r\n") ? "\r\n" : "\n";
        var insertions = new List<(int Position, string Text)>();
        foreach (var (function, parameters) in perMethod)
        {
            var body = function switch { BaseMethodDeclarationSyntax m => m.Body, LocalFunctionStatementSyntax l => l.Body, _ => null };
            if (body is null) { return null; }
            var braceLine = newText.Lines.GetLineFromPosition(body.OpenBraceToken.SpanStart);
            if (body.OpenBraceToken.Span.End < braceLine.End && newText.ToString(TextSpan.FromBounds(body.OpenBraceToken.Span.End, braceLine.End)).Trim().Length > 0)
            {
                return null; // "{ return x; }" on one line: no place for a line of its own
            }
            string indent;
            if (body.Statements.Count > 0 && newText.Lines.GetLineFromPosition(body.Statements[0].SpanStart).LineNumber > braceLine.LineNumber)
            {
                var first = newText.Lines.GetLineFromPosition(body.Statements[0].SpanStart);
                var firstText = first.ToString();
                indent = firstText[..(firstText.Length - firstText.TrimStart().Length)];
            }
            else
            {
                var braceText = braceLine.ToString();
                indent = braceText[..(braceText.Length - braceText.TrimStart().Length)] + "    ";
            }
            var lines = new StringBuilder();
            foreach (var parameter in parameters)
            {
                var value = languageVersion >= LanguageVersion.CSharp7_1 ? "default" : $"default({parameter.Type})";
                lines.Append(indent).Append(parameter.Identifier.Text).Append(" = ").Append(value).Append(';').Append(eol);
            }
            insertions.Add((braceLine.EndIncludingLineBreak, lines.ToString()));
        }

        // an insertion lies inside the text one of the edits writes (the new method): put it there, in that edit's own coordinates
        var result = edits.Select(e => e).ToList();
        var starts = new List<(int Start, int End)>();
        var delta = 0;
        foreach (var edit in edits)
        {
            var start = original.Lines[edit.StartLine].Start + edit.StartCharacter;
            var end = original.Lines[edit.EndLine].Start + edit.EndCharacter;
            starts.Add((start + delta, start + delta + edit.NewText.Length));
            delta += edit.NewText.Length - (end - start);
        }
        foreach (var (position, insertText) in insertions.OrderByDescending(i => i.Position))
        {
            var index = starts.FindIndex(s => s.Start <= position && position <= s.End);
            if (index < 0) { return null; } // the method is not one of the new ones: not ours to repair
            var offset = position - starts[index].Start;
            result[index] = result[index] with { NewText = result[index].NewText[..offset] + insertText + result[index].NewText[offset..] };
            for (var i = index; i < starts.Count; i++)
            {
                starts[i] = (i == index ? starts[i].Start : starts[i].Start + insertText.Length, starts[i].End + insertText.Length);
            }
        }
        return result;
    }
}
