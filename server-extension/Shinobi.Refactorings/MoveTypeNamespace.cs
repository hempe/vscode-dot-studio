using System.Text;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Extensions;
using Microsoft.CodeAnalysis.FindSymbols;
using Microsoft.CodeAnalysis.Text;

namespace Shinobi.Refactorings;

public sealed record MoveTypeNamespaceInfo(
    [property: JsonPropertyName("typeName")] string TypeName,
    /// <summary>The namespace the type is in now (empty: the global namespace).</summary>
    [property: JsonPropertyName("namespace")] string Namespace,
    /// <summary>The namespaces the solution's source declares, for the form to suggest (only the counting handler fills it).</summary>
    [property: JsonPropertyName("namespaces")] IReadOnlyList<string> Namespaces,
    /// <summary>Set when the refactoring cannot be done on this type; the form is not opened, the message is shown.</summary>
    [property: JsonPropertyName("refusal")] string? Refusal);

public sealed record MoveTypeNamespaceRequest(
    [property: JsonPropertyName("position")] Position Position,
    [property: JsonPropertyName("namespace")] string Namespace);

/// <summary>The type under the cursor and its namespace: cheap, for the lightbulb.</summary>
public sealed class MoveTypeNamespaceInfoHandler : DocumentHandler<TypeAt, MoveTypeNamespaceInfo?>
{
    public override Task<MoveTypeNamespaceInfo?> ExecuteAsync(TypeAt message, Document document, CancellationToken cancellationToken)
        => MoveTypeNamespaceEngine.InfoAsync(document, message.Position, false, cancellationToken);
}

/// <summary>The same with the namespaces of the solution's source, which takes a look at every file: asked when the refactoring runs.</summary>
public sealed class MoveTypeNamespaceNamesHandler : DocumentHandler<TypeAt, MoveTypeNamespaceInfo?>
{
    public override Task<MoveTypeNamespaceInfo?> ExecuteAsync(TypeAt message, Document document, CancellationToken cancellationToken)
        => MoveTypeNamespaceEngine.InfoAsync(document, message.Position, true, cancellationToken);
}

public sealed class MoveTypeNamespaceHandler : DocumentHandler<MoveTypeNamespaceRequest, ExtractInterfaceResult?>
{
    public override Task<ExtractInterfaceResult?> ExecuteAsync(MoveTypeNamespaceRequest message, Document document, CancellationToken cancellationToken)
        => MoveTypeNamespaceEngine.RunAsync(document, message, cancellationToken);
}

/// <summary>
/// Move Type to Namespace (Visual Studio's "Move to namespace" with the namespace of your choice, which the C# server's cannot take): the
/// type's namespace changes, every place that used it gets the using it needs (or the qualifier it wrote is replaced), and the type keeps
/// the usings of what it used from its old namespace. The file stays where it is. The result is compiled before it is applied.
/// </summary>
public static class MoveTypeNamespaceEngine
{
    private static readonly Regex NamespaceName = new(@"^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$", RegexOptions.Compiled);

    private sealed record Analysis(BaseTypeDeclarationSyntax Declaration, INamedTypeSymbol Symbol, SemanticModel Model, CompilationUnitSyntax Root, SourceText Text, string Current, string? Refusal);

    public static async Task<MoveTypeNamespaceInfo?> InfoAsync(Document document, Position position, bool withNamespaces, CancellationToken ct)
    {
        var a = await AnalyzeAsync(document, position, ct).ConfigureAwait(false);
        if (a is null) { return null; }
        IReadOnlyList<string> namespaces = [];
        if (withNamespaces && a.Refusal is null) { namespaces = await NamespacesAsync(document.Project.Solution, ct).ConfigureAwait(false); }
        return new MoveTypeNamespaceInfo(a.Symbol.Name, a.Current, namespaces, a.Refusal);
    }

    public static async Task<ExtractInterfaceResult?> RunAsync(Document document, MoveTypeNamespaceRequest request, CancellationToken ct)
    {
        var a = await AnalyzeAsync(document, request.Position, ct).ConfigureAwait(false);
        if (a is null) { return null; }
        if (a.Refusal is not null) { throw new InvalidOperationException(a.Refusal); }
        var target = request.Namespace.Trim();
        if (!NamespaceName.IsMatch(target) || target.Split('.').Any(part => !SyntaxFacts.IsValidIdentifier(part)))
        {
            throw new InvalidOperationException($"'{target}' is not a valid namespace.");
        }
        if (target == a.Current) { throw new InvalidOperationException($"{a.Symbol.Name} is in {target} already."); }
        if (document.FilePath is null) { return null; }

        var solution = document.Project.Solution;
        var eol = a.Text.ToString().Contains("\r\n") ? "\r\n" : "\n";
        var edits = new List<TextEdit>();
        var others = new Dictionary<string, List<TextEdit>>(StringComparer.OrdinalIgnoreCase);
        var usingsFor = new Dictionary<string, (Document Document, HashSet<string> Namespaces)>(StringComparer.OrdinalIgnoreCase);
        List<TextEdit> Into(Document d)
        {
            if (d.FilePath is null || string.Equals(d.FilePath, document.FilePath, StringComparison.OrdinalIgnoreCase)) { return edits; }
            if (!others.TryGetValue(d.FilePath, out var list)) { others[d.FilePath] = list = []; }
            return list;
        }
        void NeedUsing(Document d, string ns)
        {
            var key = d.FilePath ?? d.Name;
            if (!usingsFor.TryGetValue(key, out var entry)) { usingsFor[key] = entry = (d, []); }
            entry.Namespaces.Add(ns);
        }

        // ---- the declaration moves
        var declaration = a.Declaration;
        var ns = declaration.Ancestors().OfType<BaseNamespaceDeclarationSyntax>().FirstOrDefault();
        if (ns is not null && ns.Members.Count == 1)
        {
            edits.Add(ExtractSuperclassEngine.Replace(a.Text, ns.Name.Span, target));
        }
        else if (ns is NamespaceDeclarationSyntax)
        {
            var lines = PartialSupport.LinesOf(a.Text, declaration);
            var start = a.Text.Lines.GetLinePosition(lines.Start);
            var end = a.Text.Lines.GetLinePosition(lines.End);
            edits.Add(new TextEdit(start.Line, start.Character, end.Line, end.Character, ""));
            var typeText = a.Text.ToString(TextSpan.FromBounds(ExtractInterfaceSupport.LineStartBefore(a.Text, declaration), a.Text.Lines.GetLineFromPosition(declaration.Span.End - 1).End));
            var tail = a.Root.FullSpan.End;
            var after = a.Text.Lines.GetLinePosition(tail);
            var block = $"{(a.Text.ToString().EndsWith('\n') ? "" : eol)}{eol}namespace {target}{eol}{{{eol}{typeText.Replace("\r\n", "\n").Replace("\n", eol)}{eol}}}{eol}";
            edits.Add(new TextEdit(after.Line, after.Character, after.Line, after.Character, block));
        }
        else
        {
            // a file without a namespace and with this type only
            edits.Add(PartialSupport.Insert(a.Text, ExtractInterfaceSupport.LineStartBefore(a.Text, declaration), $"namespace {target};{eol}{eol}"));
        }

        // ---- the type keeps what it used of its old namespace
        var globalUsings = new Dictionary<ProjectId, HashSet<string>>();
        HashSet<string> GlobalsOf(Project project)
        {
            if (!globalUsings.TryGetValue(project.Id, out var set)) { globalUsings[project.Id] = set = GlobalUsingsOf(project); }
            return set;
        }
        var imported = ImportedNamespaces(a.Root, ns is not null && ns.Members.Count == 1 ? ns : null, GlobalsOf(document.Project));
        foreach (var used in NamespacesUsedBy(a.Model, declaration, ct))
        {
            if (VisibleFrom(target, used) || imported.Contains(used)) { continue; }
            NeedUsing(document, used);
        }

        // ---- the places that use the type
        var symbols = new List<ISymbol> { a.Symbol };
        symbols.AddRange(a.Symbol.GetMembers().OfType<IMethodSymbol>().Where(m => m.IsExtensionMethod));
        var seen = new HashSet<(DocumentId, int)>();
        foreach (var symbol in symbols)
        {
            foreach (var referenced in await SymbolFinder.FindReferencesAsync(symbol, solution, ct).ConfigureAwait(false))
            {
                foreach (var location in referenced.Locations)
                {
                    if (location.IsImplicit || !location.Location.IsInSource || !seen.Add((location.Document.Id, location.Location.SourceSpan.Start))) { continue; }
                    var d = location.Document;
                    var root = (CompilationUnitSyntax?)await d.GetSyntaxRootAsync(ct).ConfigureAwait(false);
                    var model = await d.GetSemanticModelAsync(ct).ConfigureAwait(false);
                    if (root is null || model is null) { continue; }
                    var span = location.Location.SourceSpan;
                    // the type's own body is handled above
                    if (d.Id == document.Id && declaration.Span.Contains(span)) { continue; }
                    var name = root.FindToken(span.Start).Parent?.AncestorsAndSelf().OfType<SimpleNameSyntax>().FirstOrDefault();
                    if (name is null) { continue; }
                    var text = await d.GetTextAsync(ct).ConfigureAwait(false);
                    if (QualifierOf(name, model, ct) is { } qualifier)
                    {
                        var written = qualifier.ToString();
                        Into(d).Add(ExtractSuperclassEngine.Replace(text, qualifier.Span, written.StartsWith("global::") ? "global::" + target : target));
                    }
                    else if (!IsVisible(name, target, GlobalsOf(d.Project)))
                    {
                        NeedUsing(d, target);
                    }
                }
            }
        }

        // a using of the old namespace dangles when the type was the last thing in it (CS0234): it is renamed to the new one, or removed
        if (a.Current.Length > 0)
        {
            var remains = new Dictionary<ProjectId, bool>();
            foreach (var project in solution.Projects)
            {
                foreach (var d in project.Documents)
                {
                    if (await d.GetSyntaxRootAsync(ct).ConfigureAwait(false) is not CompilationUnitSyntax root) { continue; }
                    var dangling = root.DescendantNodes(n => n is CompilationUnitSyntax or BaseNamespaceDeclarationSyntax).OfType<UsingDirectiveSyntax>()
                        .Where(u => u.Alias is null && u.StaticKeyword == default && u.GlobalKeyword == default && u.Name?.ToString() == a.Current).ToList();
                    if (dangling.Count == 0) { continue; }
                    if (!remains.TryGetValue(project.Id, out var stays))
                    {
                        remains[project.Id] = stays = await NamespaceRemainsAsync(project, a.Current, a.Symbol, ct).ConfigureAwait(false);
                    }
                    if (stays) { continue; }
                    var text = await d.GetTextAsync(ct).ConfigureAwait(false);
                    var key = d.FilePath ?? d.Name;
                    var wantsTarget = usingsFor.TryGetValue(key, out var entry) && entry.Namespaces.Contains(target);
                    foreach (var u in dangling)
                    {
                        if (wantsTarget)
                        {
                            Into(d).Add(ExtractSuperclassEngine.Replace(text, u.Name!.Span, target));
                            entry.Namespaces.Remove(target);
                            wantsTarget = false;
                        }
                        else
                        {
                            var line = text.Lines.GetLineFromPosition(u.SpanStart);
                            var start = text.Lines.GetLinePosition(line.Start);
                            var end = text.Lines.GetLinePosition(line.EndIncludingLineBreak);
                            Into(d).Add(new TextEdit(start.Line, start.Character, end.Line, end.Character, ""));
                        }
                    }
                }
            }
        }

        foreach (var (_, (d, namespaces)) in usingsFor)
        {
            var root = (CompilationUnitSyntax)(await d.GetSyntaxRootAsync(ct).ConfigureAwait(false))!;
            var text = await d.GetTextAsync(ct).ConfigureAwait(false);
            var present = root.Usings.Where(u => u.Alias is null && u.StaticKeyword == default).Select(u => u.Name?.ToString()).ToHashSet();
            var missing = namespaces.Where(n => !present.Contains(n)).OrderBy(n => n, StringComparer.Ordinal).ToList();
            if (missing.Count > 0) { Into(d).Add(AddUsings(text, root, missing, eol)); }
        }

        var result = new ExtractInterfaceResult(edits, null, null, null, others.Count == 0 ? null : others.Select(o => new FileEdits(o.Key, o.Value)).ToList(),
            $"{a.Symbol.Name} is in {target} now (the file stays where it is). Move Type to File or Sync Namespaces can put it in the matching folder.");
        return await RefactoringValidator.CheckAsync(document, result, ct).ConfigureAwait(false);
    }

    /// <summary>Whether a namespace still has anything in it (other than the moved type) as the project sees it.</summary>
    private static async Task<bool> NamespaceRemainsAsync(Project project, string name, INamedTypeSymbol moved, CancellationToken ct)
    {
        var compilation = await project.GetCompilationAsync(ct).ConfigureAwait(false);
        if (compilation is null) { return true; }
        INamespaceSymbol? current = compilation.GlobalNamespace;
        foreach (var part in name.Split('.'))
        {
            current = current?.GetNamespaceMembers().FirstOrDefault(n => n.Name == part);
        }
        return current is not null && current.GetMembers().Any(m => !SymbolEqualityComparer.Default.Equals(m.OriginalDefinition, moved.OriginalDefinition));
    }

    // ---- analysis

    private static async Task<Analysis?> AnalyzeAsync(Document document, Position position, CancellationToken ct)
    {
        var root = await document.GetSyntaxRootAsync(ct).ConfigureAwait(false) as CompilationUnitSyntax;
        var text = await document.GetTextAsync(ct).ConfigureAwait(false);
        var model = await document.GetSemanticModelAsync(ct).ConfigureAwait(false);
        if (root is null || model is null || position.Line >= text.Lines.Count) { return null; }
        var offset = Math.Min(text.Lines[position.Line].Start + position.Character, text.Length);
        var token = root.FindToken(offset);
        if (token.Parent is not BaseTypeDeclarationSyntax declaration || declaration.Identifier != token || model.GetDeclaredSymbol(declaration, ct) is not INamedTypeSymbol symbol) { return null; }

        var current = symbol.ContainingNamespace is { IsGlobalNamespace: false } containing ? containing.ToDisplayString() : "";
        string? refusal = null;
        if (declaration.Parent is not (BaseNamespaceDeclarationSyntax or CompilationUnitSyntax)) { refusal = $"{symbol.Name} is a nested type: only types of a namespace can move to another."; }
        else if (symbol.DeclaringSyntaxReferences.Length > 1) { refusal = $"{symbol.Name} is a partial type with several parts: move its parts one by one is not supported."; }
        else if (declaration.Parent is BaseNamespaceDeclarationSyntax { Parent: BaseNamespaceDeclarationSyntax }) { refusal = $"{symbol.Name} is in a namespace declared inside another namespace, which is not supported."; }
        else if (declaration.Parent is FileScopedNamespaceDeclarationSyntax { Members.Count: > 1 }) { refusal = $"The file has other types in the file-scoped namespace {current}: move {symbol.Name} to its own file first (Move Type to File)."; }
        else if (declaration.Parent is CompilationUnitSyntax { Members.Count: > 1 }) { refusal = $"The file has other types: move {symbol.Name} to its own file first (Move Type to File)."; }
        return new Analysis(declaration, symbol, model, root, text, current, refusal);
    }

    /// <summary>The namespaces the solution's source declares, sorted: for the form to suggest.</summary>
    private static async Task<IReadOnlyList<string>> NamespacesAsync(Solution solution, CancellationToken ct)
    {
        var names = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var project in solution.Projects)
        {
            foreach (var document in project.Documents)
            {
                if (await document.GetSyntaxRootAsync(ct).ConfigureAwait(false) is not { } root) { continue; }
                foreach (var ns in root.DescendantNodes(n => n is CompilationUnitSyntax or BaseNamespaceDeclarationSyntax).OfType<BaseNamespaceDeclarationSyntax>())
                {
                    names.Add(FullNameOf(ns));
                }
            }
        }
        return names.Take(3000).ToList();
    }

    private static string FullNameOf(BaseNamespaceDeclarationSyntax ns)
        => string.Join(".", ns.AncestorsAndSelf().OfType<BaseNamespaceDeclarationSyntax>().Reverse().Select(n => n.Name.ToString()));

    /// <summary>`target` is visible without a using from inside the namespace `from`: it is that namespace or one around it.</summary>
    private static bool VisibleFrom(string inside, string target) => inside == target || inside.StartsWith(target + ".", StringComparison.Ordinal);

    /// <summary>The namespaces of the types (and extension methods) a declaration names on its own, not through a qualifier.</summary>
    private static IEnumerable<string> NamespacesUsedBy(SemanticModel model, SyntaxNode declaration, CancellationToken ct)
    {
        var result = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var name in declaration.DescendantNodesAndSelf().OfType<SimpleNameSyntax>())
        {
            if (name.Parent is MemberAccessExpressionSyntax access && access.Name == name && !(access.Expression is ThisExpressionSyntax)) { if (!IsExtensionCall(model, name, ct)) { continue; } }
            if (name.Parent is QualifiedNameSyntax q && q.Right == name) { continue; }
            if (name.Parent is MemberBindingExpressionSyntax or AliasQualifiedNameSyntax) { continue; }
            var info = model.GetSymbolInfo(name, ct);
            foreach (var symbol in info.Symbol is null ? info.CandidateSymbols : [info.Symbol])
            {
                var type = symbol as INamedTypeSymbol ?? (symbol is IMethodSymbol { IsExtensionMethod: true } or IMethodSymbol { MethodKind: MethodKind.Constructor } ? symbol.ContainingType : null);
                while (type?.ContainingType is not null) { type = type.ContainingType; }
                if (type?.ContainingNamespace is { IsGlobalNamespace: false } containing) { result.Add(containing.ToDisplayString()); }
            }
        }
        return result;
    }

    private static bool IsExtensionCall(SemanticModel model, SimpleNameSyntax name, CancellationToken ct)
        => model.GetSymbolInfo(name, ct).Symbol is IMethodSymbol { IsExtensionMethod: true };

    /// <summary>The namespaces the project's global usings import (written in its files, or generated like the implicit usings).</summary>
    private static HashSet<string> GlobalUsingsOf(Project project)
    {
        var names = new HashSet<string>();
        foreach (var document in project.Documents)
        {
            if (document.TryGetSyntaxTree(out var tree) && tree.TryGetRoot(out var other) && other is CompilationUnitSyntax unit)
            {
                foreach (var u in unit.Usings.Where(u => u.GlobalKeyword != default && u.Alias is null && u.StaticKeyword == default && u.Name is not null)) { names.Add(u.Name!.ToString()); }
            }
        }
        return names;
    }

    /// <summary>What the file imports with usings (also inside the namespace, and the project's global usings).</summary>
    private static HashSet<string> ImportedNamespaces(CompilationUnitSyntax root, BaseNamespaceDeclarationSyntax? ns, HashSet<string> globals)
    {
        var names = new HashSet<string>(globals);
        void Add(IEnumerable<UsingDirectiveSyntax> usings)
        {
            foreach (var u in usings.Where(u => u.Alias is null && u.StaticKeyword == default && u.Name is not null)) { names.Add(u.Name!.ToString()); }
        }
        Add(root.Usings);
        if (ns is not null) { Add(ns.Usings); }
        return names;
    }

    /// <summary>Whether a name in a file reaches the namespace without a new using: the namespaces around it, the file's usings, the global usings.</summary>
    private static bool IsVisible(SimpleNameSyntax name, string target, HashSet<string> globals)
    {
        var chain = name.Ancestors().OfType<BaseNamespaceDeclarationSyntax>().FirstOrDefault();
        if (chain is not null && VisibleFrom(FullNameOf(chain), target)) { return true; }
        var root = (CompilationUnitSyntax)name.SyntaxTree.GetRoot();
        return ImportedNamespaces(root, chain, globals).Contains(target);
    }

    /// <summary>The namespace part of a qualified name of the type (`Old.Ns.Type`), when the name is written with one.</summary>
    private static SyntaxNode? QualifierOf(SimpleNameSyntax name, SemanticModel model, CancellationToken ct)
    {
        SyntaxNode? left = name.Parent switch
        {
            QualifiedNameSyntax q when q.Right == name => q.Left,
            MemberAccessExpressionSyntax m when m.Name == name => m.Expression,
            _ => null,
        };
        if (left is null) { return null; }
        return model.GetSymbolInfo(left, ct).Symbol is INamespaceSymbol ? left : null;
    }

    /// <summary>The usings after the last one, or above the first member when the file has none.</summary>
    private static TextEdit AddUsings(SourceText text, CompilationUnitSyntax root, IReadOnlyList<string> namespaces, string eol)
    {
        var lines = string.Join(eol, namespaces.Select(n => $"using {n};"));
        if (root.Usings.Count > 0)
        {
            var end = text.Lines.GetLineFromPosition(root.Usings.Last().Span.End - 1).End;
            return PartialSupport.Insert(text, end, eol + lines);
        }
        var first = root.Members.FirstOrDefault();
        var at = first is null ? 0 : ExtractInterfaceSupport.LineStartBefore(text, first);
        return PartialSupport.Insert(text, at, lines + eol + eol);
    }
}
