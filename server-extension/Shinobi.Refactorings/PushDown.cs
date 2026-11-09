using System.Text;
using System.Text.Json.Serialization;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Extensions;
using Microsoft.CodeAnalysis.FindSymbols;
using Microsoft.CodeAnalysis.Text;

namespace Shinobi.Refactorings;

public sealed record PushDownDerived(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("name")] string Name,
    /// <summary>The file (and project) it is declared in.</summary>
    [property: JsonPropertyName("where")] string Where);

public sealed record PushDownMember(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("signature")] string Signature,
    /// <summary>The class can keep an abstract declaration of it (the derived types get the body as an override).</summary>
    [property: JsonPropertyName("canBeAbstract")] bool CanBeAbstract,
    [property: JsonPropertyName("abstractSignature")] string? AbstractSignature,
    /// <summary>The members of the class that use this one by their plain name: when it moves and they stay, they cannot reach it.</summary>
    [property: JsonPropertyName("usedBy")] IReadOnlyList<string> UsedBy,
    [property: JsonPropertyName("blocked")] string? Blocked);

public sealed record PushDownInfo(
    [property: JsonPropertyName("typeName")] string TypeName,
    [property: JsonPropertyName("derived")] IReadOnlyList<PushDownDerived> Derived,
    [property: JsonPropertyName("members")] IReadOnlyList<PushDownMember> Members,
    [property: JsonPropertyName("selected")] IReadOnlyList<string> Selected,
    [property: JsonPropertyName("refusal")] string? Refusal);

public sealed record PushDownRequest(
    [property: JsonPropertyName("position")] Position Position,
    [property: JsonPropertyName("derivedIds")] IReadOnlyList<string> DerivedIds,
    [property: JsonPropertyName("memberIds")] IReadOnlyList<string> MemberIds,
    /// <summary>The class keeps an abstract declaration of what can be abstract; the chosen derived types get an override.</summary>
    [property: JsonPropertyName("leaveAbstract")] bool LeaveAbstract);

/// <summary>The class under the cursor (on its name or on one of its members), the classes derived from it in the solution's source, and its members.</summary>
public sealed class PushDownInfoHandler : DocumentHandler<TypeAt, PushDownInfo?>
{
    public override Task<PushDownInfo?> ExecuteAsync(TypeAt message, Document document, CancellationToken cancellationToken)
        => PushDownEngine.InfoAsync(document, message.Position, cancellationToken);
}

/// <summary>Copies the chosen members into the chosen derived types and removes them from the class (or leaves an abstract declaration); compiled before it is applied.</summary>
public sealed class PushDownHandler : DocumentHandler<PushDownRequest, ExtractInterfaceResult?>
{
    public override Task<ExtractInterfaceResult?> ExecuteAsync(PushDownRequest message, Document document, CancellationToken cancellationToken)
        => PushDownEngine.RunAsync(document, message, cancellationToken);
}

public static class PushDownEngine
{
    private sealed class Analysis
    {
        public required SuperclassContext Context { get; init; }
        public required List<INamedTypeSymbol> Derived { get; init; }
        public required string? SelectedId { get; init; }
        public required string? Refusal { get; init; }
    }

    public static async Task<PushDownInfo?> InfoAsync(Document document, Position position, CancellationToken ct)
    {
        var analysis = await AnalyzeAsync(document, position, ct).ConfigureAwait(false);
        if (analysis is null) { return null; }
        var context = analysis.Context;
        if (analysis.Refusal is not null) { return new PushDownInfo(context.Symbol.Name, [], [], [], analysis.Refusal); }

        var derived = analysis.Derived.Select(d => new PushDownDerived(IdOf(d), d.Name, WhereOf(document, d))).ToList();
        var uses = context.Members.ToDictionary(m => m.Id, m => ExtractSuperclassEngine.DependenciesOf(context, m.Syntax));
        var members = new List<PushDownMember>();
        foreach (var (syntax, id) in context.Members)
        {
            var usedBy = context.Members.Where(m => m.Id != id && uses[m.Id].Deps.Contains(id)).Select(m => m.Id).ToList();
            var abstractSignature = ExtractSuperclassEngine.AbstractDeclaration(syntax);
            members.Add(new PushDownMember(id, PartialSupport.KindOf(syntax), PartialSupport.HeaderOf(syntax), abstractSignature is not null, abstractSignature, usedBy, uses[id].Blocked));
        }
        return new PushDownInfo(context.Symbol.Name, derived, members, analysis.SelectedId is null ? [] : [analysis.SelectedId], null);
    }

    public static async Task<ExtractInterfaceResult?> RunAsync(Document document, PushDownRequest request, CancellationToken ct)
    {
        var analysis = await AnalyzeAsync(document, request.Position, ct).ConfigureAwait(false);
        if (analysis is null) { return null; }
        if (analysis.Refusal is not null) { throw new InvalidOperationException(analysis.Refusal); }
        var context = analysis.Context;
        var targets = analysis.Derived.Where(d => request.DerivedIds.Contains(IdOf(d))).ToList();
        if (targets.Count == 0 || targets.Count != request.DerivedIds.Distinct().Count())
        {
            throw new InvalidOperationException("The derived types changed since they were listed; try again.");
        }
        var byId = context.Members.ToDictionary(m => m.Id, m => m.Syntax);
        var chosen = new HashSet<string>(request.MemberIds);
        if (chosen.Count == 0) { return null; }
        if (chosen.Any(id => !byId.ContainsKey(id))) { throw new InvalidOperationException("The file changed since the members were listed; try again."); }
        var ordered = context.Members.Where(m => chosen.Contains(m.Id)).ToList();

        // what the class keeps as an abstract declaration, and what leaves it entirely
        var abstractIds = new HashSet<string>(request.LeaveAbstract ? ordered.Where(m => ExtractSuperclassEngine.AbstractDeclaration(m.Syntax) is not null).Select(m => m.Id) : []);
        var uses = ordered.ToDictionary(m => m.Id, m => ExtractSuperclassEngine.DependenciesOf(context, m.Syntax));
        foreach (var (syntax, id) in ordered)
        {
            if (uses[id].Blocked is { } blocked) { throw new InvalidOperationException($"'{PartialSupport.HeaderOf(syntax)}' cannot move: {blocked}."); }
        }

        // the members must not clash with what a derived type has already
        foreach (var target in targets)
        {
            foreach (var (syntax, _) in ordered)
            {
                if (PullUpEngine.FindClash(context, target, syntax) is { } clash) { throw new InvalidOperationException($"{target.Name} already has {clash}."); }
            }
        }

        var text = context.Text;
        var eol = text.ToString().Contains("\r\n") ? "\r\n" : "\n";
        var edits = new List<TextEdit>();
        var others = new Dictionary<string, List<TextEdit>>(StringComparer.OrdinalIgnoreCase);

        // the class: the members leave, or stay as abstract declarations
        var declared = ordered.Where(m => abstractIds.Contains(m.Id)).Select(m => m.Syntax).ToList();
        var removed = ordered.Where(m => !abstractIds.Contains(m.Id)).Select(m => m.Syntax).ToList();
        edits.AddRange(PartialSupport.RemovalEdits(text, removed));
        foreach (var member in declared)
        {
            edits.Add(ExtractSuperclassEngine.Replace(text, member.Span, ExtractSuperclassEngine.AbstractDeclaration(member)!));
        }
        if (declared.Count > 0 && !context.Declaration.Modifiers.Any(SyntaxKind.AbstractKeyword))
        {
            edits.Add(PartialSupport.Insert(text, context.Declaration.Keyword.SpanStart, "abstract "));
        }
        // a private member that a pushed member uses stays in the class and has to be reachable from the derived types: protected
        var stays = context.Members.Where(m => !chosen.Contains(m.Id)).ToDictionary(m => m.Id, m => m.Syntax);
        var needed = uses.Values.SelectMany(u => u.Deps).Where(stays.ContainsKey).Distinct().ToList();
        foreach (var id in needed)
        {
            var member = stays[id];
            if (ExtractSuperclassEngine.DeclaredSymbols(context.Model, member).Any(s => s.DeclaredAccessibility == Accessibility.Private))
            {
                foreach (var (span, newText) in ExtractSuperclassEngine.AccessibilityEdits(context.Model, member)) { edits.Add(ExtractSuperclassEngine.Replace(text, span, newText)); }
            }
        }

        // the derived types: the body of every pushed member, as an override where the class declares it abstract
        var overrides = abstractIds.Count > 0 ? ordered.Where(m => abstractIds.Contains(m.Id)).Select(m => m.Syntax).ToDictionary(m => m, m => OverrideAdjustments(m)) : [];
        var bodies = ordered.Select(m => PartialSupport.TextOf(text, m.Syntax, eol, overrides.TryGetValue(m.Syntax, out var adjustments) ? adjustments : [])).ToList();
        var usedNodes = ordered.Select(m => (SyntaxNode)m.Syntax).ToList();
        foreach (var target in targets)
        {
            if (!TargetDocument(document, target, out var targetDocument, out var declaration)) { throw new InvalidOperationException($"{target.Name} is not declared in source of this solution."); }
            var targetText = await targetDocument.GetTextAsync(ct).ConfigureAwait(false);
            var targetRoot = (CompilationUnitSyntax)(await targetDocument.GetSyntaxRootAsync(ct).ConfigureAwait(false))!;
            var sameFile = targetDocument.Id == document.Id;
            List<TextEdit> into;
            if (sameFile) { into = edits; }
            else if (!others.TryGetValue(targetDocument.FilePath!, out into!)) { others[targetDocument.FilePath!] = into = []; }

            var targetEol = targetText.ToString().Contains("\r\n") ? "\r\n" : "\n";
            into.Add(InsertAtEnd(targetText, declaration, bodies, targetEol));
            // the usings the members need that the file of the derived type lacks
            var usings = PartialSupport.NeededUsings(context.Root, context.Model, usedNodes, ct)
                .Where(u => !targetRoot.Usings.Any(t => t.Name?.ToString() == u.Name?.ToString() && t.Alias?.ToString() == u.Alias?.ToString() && t.StaticKeyword == default)).ToList();
            if (usings.Count > 0 && !sameFile)
            {
                var usingText = string.Concat(usings.Select(u => u.ToString() + targetEol));
                if (targetRoot.Usings.Count > 0)
                {
                    var last = targetText.Lines.GetLineFromPosition(targetRoot.Usings.Last().Span.End - 1);
                    into.Add(PartialSupport.Insert(targetText, last.EndIncludingLineBreak, usingText));
                }
                else
                {
                    into.Add(PartialSupport.Insert(targetText, 0, usingText + targetEol));
                }
            }
        }
        var result = new ExtractInterfaceResult(edits, null, null, null, others.Count == 0 ? null : others.Select(o => new FileEdits(o.Key, o.Value)).ToList());
        return await RefactoringValidator.CheckAsync(document, result, ct).ConfigureAwait(false);
    }

    /// <summary>The span edits that make a member the override of the abstract declaration the class keeps: `override` for `virtual`, at least protected.</summary>
    private static List<(TextSpan Span, string Text)> OverrideAdjustments(MemberDeclarationSyntax member)
    {
        var modifiers = member.Modifiers.ToList();
        var access = modifiers.Where(m => ExtractSuperclassEngine.AccessKinds.Contains(m.Kind())).Select(m => m.Text).ToList();
        if (access.Count == 0 || access is ["private"]) { access = ["protected"]; }
        var rest = modifiers.Where(m => !ExtractSuperclassEngine.AccessKinds.Contains(m.Kind()) && !m.IsKind(SyntaxKind.VirtualKeyword)).Select(m => m.Text);
        var written = string.Join(" ", access.Concat(["override"]).Concat(rest));
        return modifiers.Count == 0
            ? [(new TextSpan(ExtractSuperclassEngine.ModifierAnchor(member), 0), written + " ")]
            : [(TextSpan.FromBounds(modifiers[0].SpanStart, modifiers[^1].Span.End), written)];
    }

    /// <summary>The members before the closing brace of the derived type, with its indentation.</summary>
    private static TextEdit InsertAtEnd(SourceText text, TypeDeclarationSyntax declaration, IReadOnlyList<string> bodies, string eol)
    {
        var indent = ExtractInterfaceSupport.IndentOf(text, declaration) + "    ";
        var brace = declaration.CloseBraceToken;
        var braceLine = text.Lines.GetLineFromPosition(brace.SpanStart);
        var brokenLine = text.ToString(TextSpan.FromBounds(braceLine.Start, brace.SpanStart)).Trim().Length > 0;
        var block = new StringBuilder();
        if (brokenLine) { block.Append(eol); }
        if (declaration.Members.Count > 0) { block.Append(eol); }
        for (var i = 0; i < bodies.Count; i++)
        {
            if (i > 0) { block.Append(eol); }
            block.Append(PartialSupport.Reindent(bodies[i], indent, eol));
        }
        return PartialSupport.Insert(text, brokenLine ? brace.SpanStart : braceLine.Start, block.ToString());
    }

    private static bool TargetDocument(Document from, INamedTypeSymbol type, out Document document, out TypeDeclarationSyntax declaration)
    {
        foreach (var reference in type.DeclaringSyntaxReferences)
        {
            if (from.Project.Solution.GetDocument(reference.SyntaxTree) is { FilePath: not null } found && reference.GetSyntax() is ClassDeclarationSyntax syntax)
            {
                document = found;
                declaration = syntax;
                return true;
            }
        }
        document = null!;
        declaration = null!;
        return false;
    }

    private static string IdOf(INamedTypeSymbol type) => type.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat);

    private static string WhereOf(Document document, INamedTypeSymbol type)
    {
        var tree = type.DeclaringSyntaxReferences.FirstOrDefault()?.SyntaxTree;
        var target = tree is null ? null : document.Project.Solution.GetDocument(tree);
        return target is null ? "" : $"{Path.GetFileName(target.FilePath)} ({target.Project.Name})";
    }

    private static async Task<Analysis?> AnalyzeAsync(Document document, Position position, CancellationToken ct)
    {
        var root = await document.GetSyntaxRootAsync(ct).ConfigureAwait(false);
        var text = await document.GetTextAsync(ct).ConfigureAwait(false);
        if (root is null || position.Line >= text.Lines.Count) { return null; }
        var offset = Math.Min(text.Lines[position.Line].Start + position.Character, text.Length);
        var token = root.FindToken(offset);

        ClassDeclarationSyntax? declaration = null;
        MemberDeclarationSyntax? selected = null;
        if (token.Parent is ClassDeclarationSyntax named && named.Identifier == token) { declaration = named; }
        else
        {
            selected = token.Parent switch
            {
                MethodDeclarationSyntax m when m.Identifier == token => m,
                PropertyDeclarationSyntax p when p.Identifier == token => p,
                EventDeclarationSyntax e when e.Identifier == token => e,
                VariableDeclaratorSyntax { Parent.Parent: BaseFieldDeclarationSyntax field } v when v.Identifier == token => field,
                _ => null,
            };
            declaration = selected?.Parent as ClassDeclarationSyntax;
        }
        if (declaration is null || declaration.Modifiers.Any(SyntaxKind.StaticKeyword)) { return null; }

        var model = (await document.GetSemanticModelAsync(ct).ConfigureAwait(false))!;
        if (model.GetDeclaredSymbol(declaration, ct) is not { } symbol) { return null; }

        var members = new List<(MemberDeclarationSyntax, string)>();
        for (var i = 0; i < declaration.Members.Count; i++)
        {
            if (ExtractSuperclassEngine.IsListable(declaration.Members[i])) { members.Add((declaration.Members[i], PartialSupport.IdOf(declaration.Members[i], i))); }
        }
        var context = new SuperclassContext
        {
            Document = document, Declaration = declaration, Symbol = symbol, Model = model, Root = (CompilationUnitSyntax)root, Text = text, Members = members, Refusal = null,
        };

        string? refusal = null;
        var derived = new List<INamedTypeSymbol>();
        if (symbol.IsGenericType) { refusal = $"{symbol.Name} is generic: the members would have to be written with the base type's type arguments in each derived type, which is not supported yet."; }
        else
        {
            var found = await SymbolFinder.FindDerivedClassesAsync(symbol, document.Project.Solution, transitive: false, cancellationToken: ct).ConfigureAwait(false);
            derived = found.Where(d => !d.IsGenericType && d.DeclaringSyntaxReferences.Any(r => r.GetSyntax(ct) is ClassDeclarationSyntax && document.Project.Solution.GetDocument(r.SyntaxTree) is { FilePath: not null } doc && !IsGenerated(doc.FilePath!)))
                .OrderBy(d => d.Name, StringComparer.Ordinal).ToList();
            if (derived.Count == 0) { refusal = $"No class in this solution's source derives from {symbol.Name} (generic derived classes are not offered)."; }
        }
        var selectedId = selected is null ? null : members.FirstOrDefault(m => m.Item1 == selected).Item2;
        return new Analysis { Context = context, Derived = derived, SelectedId = selectedId, Refusal = refusal };
    }

    private static bool IsGenerated(string path)
        => path.EndsWith(".g.cs", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".designer.cs", StringComparison.OrdinalIgnoreCase);
}
