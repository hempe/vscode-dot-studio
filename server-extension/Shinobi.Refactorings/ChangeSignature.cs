using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Extensions;
using Microsoft.CodeAnalysis.FindSymbols;
using Microsoft.CodeAnalysis.Text;

namespace Shinobi.Refactorings;

public sealed record SignatureParameter(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("type")] string Type,
    /// <summary>`ref`, `out`, `in`, `params`, `this`... as written (empty: none).</summary>
    [property: JsonPropertyName("modifier")] string Modifier,
    [property: JsonPropertyName("defaultValue")] string? DefaultValue);

public sealed record ChangeSignatureInfo(
    /// <summary>The type the method is in.</summary>
    [property: JsonPropertyName("typeName")] string TypeName,
    [property: JsonPropertyName("methodName")] string MethodName,
    [property: JsonPropertyName("returnType")] string ReturnType,
    [property: JsonPropertyName("parameters")] IReadOnlyList<SignatureParameter> Parameters,
    /// <summary>The overridden, overriding, implemented and implementing methods that change with it (only the details handler fills it).</summary>
    [property: JsonPropertyName("related")] IReadOnlyList<string> Related,
    /// <summary>Set when the refactoring cannot be done on this method; the form is not opened, the message is shown.</summary>
    [property: JsonPropertyName("refusal")] string? Refusal);

/// <summary>One parameter of the new signature: an existing one (its index in the old list) or a new one.</summary>
public sealed record SignatureEdit(
    [property: JsonPropertyName("oldIndex")] int? OldIndex,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("type")] string Type,
    /// <summary>A new parameter: its default value (the parameter is optional).</summary>
    [property: JsonPropertyName("defaultValue")] string? DefaultValue,
    /// <summary>A new parameter: the argument every call gets (empty for an optional parameter: the call leaves it out).</summary>
    [property: JsonPropertyName("callSiteValue")] string? CallSiteValue);

public sealed record ChangeSignatureRequest(
    [property: JsonPropertyName("position")] Position Position,
    [property: JsonPropertyName("parameters")] IReadOnlyList<SignatureEdit> Parameters);

/// <summary>The method under the cursor and its parameters: cheap, for the lightbulb.</summary>
public sealed class ChangeSignatureInfoHandler : DocumentHandler<TypeAt, ChangeSignatureInfo?>
{
    public override Task<ChangeSignatureInfo?> ExecuteAsync(TypeAt message, Document document, CancellationToken cancellationToken)
        => ChangeSignatureEngine.InfoAsync(document, message.Position, false, cancellationToken);
}

/// <summary>The same with the methods that change along (overrides, implementations), which look through the solution: asked when the refactoring runs.</summary>
public sealed class ChangeSignatureDetailsHandler : DocumentHandler<TypeAt, ChangeSignatureInfo?>
{
    public override Task<ChangeSignatureInfo?> ExecuteAsync(TypeAt message, Document document, CancellationToken cancellationToken)
        => ChangeSignatureEngine.InfoAsync(document, message.Position, true, cancellationToken);
}

public sealed class ChangeSignatureHandler : DocumentHandler<ChangeSignatureRequest, ExtractInterfaceResult?>
{
    public override Task<ExtractInterfaceResult?> ExecuteAsync(ChangeSignatureRequest message, Document document, CancellationToken cancellationToken)
        => ChangeSignatureEngine.RunAsync(document, message, cancellationToken);
}

/// <summary>
/// Change Signature (Visual Studio's): parameters are reordered, removed, added (with the value the calls pass, or a default value),
/// renamed or given another type. The declaration, the methods it overrides or implements and those that override or implement it,
/// the arguments of every call (named where needed), the references to a renamed parameter and the parameter tags of the XML
/// documentation change together. The result is compiled before it is applied.
/// </summary>
public static class ChangeSignatureEngine
{
    private sealed class Work(Document document)
    {
        public Document Document { get; } = document;
        public Dictionary<SyntaxNode, Func<SyntaxNode, SyntaxNode>> Plans { get; } = [];
    }

    /// <summary>A call of the method: where its arguments are, which method it calls, which parameter every argument is for.</summary>
    private sealed record CallSite(SyntaxNode Owner, ArgumentListSyntax? List, IMethodSymbol Definition, Dictionary<int, List<int>> ArgsByParameter, IReadOnlyList<bool> Named, bool Reduced);

    public static async Task<ChangeSignatureInfo?> InfoAsync(Document document, Position position, bool withRelated, CancellationToken ct)
    {
        var symbol = await LocateAsync(document, position, ct).ConfigureAwait(false);
        if (symbol is null) { return null; }
        var refusal = Refuse(symbol);
        IReadOnlyList<string> related = [];
        if (refusal is null && withRelated)
        {
            var (members, familyRefusal) = await FamilyAsync(symbol, document.Project.Solution, ct).ConfigureAwait(false);
            refusal = familyRefusal;
            related = members.Where(m => !Same(m, symbol)).Select(Describe).ToList();
        }
        var returns = symbol.MethodKind == MethodKind.Constructor ? "" : symbol.ReturnType.ToDisplayString(SymbolDisplayFormat.MinimallyQualifiedFormat);
        return new ChangeSignatureInfo(symbol.ContainingType?.Name ?? "", symbol.MethodKind == MethodKind.Constructor ? symbol.ContainingType!.Name : symbol.Name, returns, ParametersOf(symbol), related, refusal);
    }

    public static async Task<ExtractInterfaceResult?> RunAsync(Document document, ChangeSignatureRequest request, CancellationToken ct)
    {
        var start = await LocateAsync(document, request.Position, ct).ConfigureAwait(false);
        if (start is null) { return null; }
        if (Refuse(start) is { } refused) { throw new InvalidOperationException(refused); }
        var solution = document.Project.Solution;
        var (family, familyRefusal) = await FamilyAsync(start, solution, ct).ConfigureAwait(false);
        if (familyRefusal is not null) { throw new InvalidOperationException(familyRefusal); }

        var edits = request.Parameters;
        var oldNames = start.Parameters.Select(p => p.Name).ToArray();
        var oldTypes = ParametersOf(start).Select(p => p.Type).ToArray();
        CheckRequest(start, edits, oldNames, oldTypes);
        var byOld = edits.Where(e => e.OldIndex is not null).ToDictionary(e => e.OldIndex!.Value);

        // a member's parameter is renamed when it has the name the chosen method's parameter has
        bool Renamed(IMethodSymbol owner, int index) => byOld.TryGetValue(index, out var e) && e.Name != oldNames[index] && owner.Parameters[index].Name == oldNames[index];
        string NameIn(IMethodSymbol owner, int index) => Renamed(owner, index) ? byOld[index].Name : owner.Parameters[index].Name;

        var works = new Dictionary<string, Work>(StringComparer.OrdinalIgnoreCase);
        Work? WorkFor(Document d)
        {
            var key = d.FilePath ?? d.Name;
            if (!works.TryGetValue(key, out var work)) { works[key] = work = new Work(d); }
            // a file linked into several projects is one file: the copy of the first project is rewritten
            return work.Document.Id == d.Id ? work : null;
        }

        // ---- the declarations
        var declarations = 0;
        foreach (var member in family)
        {
            var owners = new List<IMethodSymbol> { member };
            if (member.PartialImplementationPart is { } implementation) { owners.Add(implementation); }
            foreach (var owner in owners)
            {
                foreach (var reference in owner.DeclaringSyntaxReferences)
                {
                    var node = await reference.GetSyntaxAsync(ct).ConfigureAwait(false);
                    var list = ParameterListOf(node);
                    if (list is null || solution.GetDocument(node.SyntaxTree) is not { } d || WorkFor(d) is not { } work) { continue; }
                    var captured = owner;
                    work.Plans[list] = rewritten => RewriteParameters((ParameterListSyntax)rewritten, captured, edits, oldTypes, Renamed);
                    work.Plans[node] = rewritten => RewriteDocumentation(rewritten, captured, edits, Renamed);
                    declarations++;
                }
            }
        }

        // ---- the references to a renamed parameter
        foreach (var member in family)
        {
            foreach (var index in Enumerable.Range(0, member.Parameters.Length).Where(i => Renamed(member, i)))
            {
                foreach (var referenced in await SymbolFinder.FindReferencesAsync(member.Parameters[index], solution, ct).ConfigureAwait(false))
                {
                    foreach (var location in referenced.Locations)
                    {
                        if (!location.Location.IsInSource || WorkFor(location.Document) is not { } work) { continue; }
                        var root = await location.Document.GetSyntaxRootAsync(ct).ConfigureAwait(false);
                        if (root?.FindToken(location.Location.SourceSpan.Start).Parent is not IdentifierNameSyntax name || name.IsPartOfStructuredTrivia()) { continue; }
                        var newName = byOld[index].Name;
                        work.Plans[name] = rewritten => ((IdentifierNameSyntax)rewritten).WithIdentifier(SyntaxFactory.Identifier(newName).WithTriviaFrom(((IdentifierNameSyntax)rewritten).Identifier));
                    }
                }
            }
        }

        // ---- the calls
        var calls = 0;
        var notCalls = 0;
        var notCallPlaces = new List<string>();
        var seen = new HashSet<(DocumentId, int)>();
        void Register(Document d, CallSite site)
        {
            if (WorkFor(d) is not { } work) { return; }
            if (site.List is { } list)
            {
                work.Plans[list] = rewritten => RewriteArguments((ArgumentListSyntax)rewritten, site, edits, NameIn);
            }
            else
            {
                work.Plans[site.Owner] = rewritten => AddArguments((ObjectCreationExpressionSyntax)rewritten, site, edits, NameIn);
            }
            calls++;
        }
        bool InFamily(IMethodSymbol? m) => m is not null && family.Any(f => SameMethod(f, (m.ReducedFrom ?? m).OriginalDefinition));
        foreach (var member in family)
        {
            foreach (var referenced in await SymbolFinder.FindReferencesAsync(member, solution, ct).ConfigureAwait(false))
            {
                foreach (var location in referenced.Locations)
                {
                    if (location.IsImplicit || !location.Location.IsInSource) { continue; }
                    var d = location.Document;
                    var root = await d.GetSyntaxRootAsync(ct).ConfigureAwait(false);
                    var model = await d.GetSemanticModelAsync(ct).ConfigureAwait(false);
                    if (root is null || model is null) { continue; }
                    var span = location.Location.SourceSpan;
                    var token = root.FindToken(span.Start);
                    if (token.Parent is null || token.Parent.IsPartOfStructuredTrivia()) { continue; }
                    if (!seen.Add((d.Id, span.Start))) { continue; }
                    var site = CallAt(model, token, span, InFamily, ct);
                    if (site is null)
                    {
                        if (!token.Parent.Ancestors().OfType<InvocationExpressionSyntax>().Any(i => i.Expression is IdentifierNameSyntax { Identifier.Text: "nameof" })) { notCalls++; notCallPlaces.Add($"{Path.GetFileName(d.FilePath ?? d.Name)}({token.GetLocation().GetLineSpan().StartLinePosition.Line + 1})"); }
                        continue;
                    }
                    Register(d, site);
                }
            }
        }
        // the finder does not report `new(...)`: constructors are looked for in the files that have one
        if (start.MethodKind == MethodKind.Constructor)
        {
            foreach (var d in solution.Projects.SelectMany(p => p.Documents))
            {
                var text = await d.GetTextAsync(ct).ConfigureAwait(false);
                if (!Regex.IsMatch(text.ToString(), @"\bnew\s*\(")) { continue; }
                var root = await d.GetSyntaxRootAsync(ct).ConfigureAwait(false);
                var model = await d.GetSemanticModelAsync(ct).ConfigureAwait(false);
                if (root is null || model is null) { continue; }
                foreach (var creation in root.DescendantNodes().OfType<ImplicitObjectCreationExpressionSyntax>())
                {
                    if (!seen.Add((d.Id, creation.NewKeyword.SpanStart))) { continue; }
                    if (SiteOf(model.GetSymbolInfo(creation, ct), creation, creation.ArgumentList, InFamily) is { } site) { Register(d, site); }
                }
            }
        }

        // ---- the edits
        var current = new List<TextEdit>();
        var others = new List<FileEdits>();
        foreach (var work in works.Values)
        {
            var root = await work.Document.GetSyntaxRootAsync(ct).ConfigureAwait(false);
            var oldText = await work.Document.GetTextAsync(ct).ConfigureAwait(false);
            if (root is null || work.Plans.Count == 0) { continue; }
            var newRoot = root.ReplaceNodes(work.Plans.Keys, (original, rewritten) => work.Plans[original](rewritten));
            var changes = SourceText.From(newRoot.ToFullString()).GetTextChanges(oldText);
            if (changes.Count == 0) { continue; }
            var textEdits = changes.Select(c => ExtractSuperclassEngine.Replace(oldText, c.Span, c.NewText ?? "")).ToList();
            if (work.Document.Id == document.Id) { current = textEdits; }
            else if (work.Document.FilePath is { } path) { others.Add(new FileEdits(path, textEdits)); }
        }

        var files = others.Count + (current.Count > 0 ? 1 : 0);
        var summary = $"{Describe(start)} changed: {declarations} declaration{(declarations == 1 ? "" : "s")} and {calls} call{(calls == 1 ? "" : "s")} in {files} file{(files == 1 ? "" : "s")}."
            + (notCalls > 0 ? $" {notCalls} reference{(notCalls == 1 ? " is" : "s are")} not a call (a method group, for one) and {(notCalls == 1 ? "was" : "were")} left as {(notCalls == 1 ? "it is" : "they are")}: {string.Join(", ", notCallPlaces.Take(5))}{(notCallPlaces.Count > 5 ? ", ..." : "")}." : "");
        var result = new ExtractInterfaceResult(current, null, null, null, others.Count == 0 ? null : others, summary);
        return await RefactoringValidator.CheckAsync(document, result, ct).ConfigureAwait(false);
    }

    // ---- the request

    private static void CheckRequest(IMethodSymbol start, IReadOnlyList<SignatureEdit> edits, string[] oldNames, string[] oldTypes)
    {
        var seenOld = new HashSet<int>();
        var names = new HashSet<string>();
        foreach (var edit in edits)
        {
            var name = edit.Name.Trim();
            if (!SyntaxFacts.IsValidIdentifier(name) || SyntaxFacts.GetKeywordKind(name) != SyntaxKind.None) { throw new InvalidOperationException($"'{edit.Name}' is not a valid parameter name."); }
            if (!names.Add(name)) { throw new InvalidOperationException($"Two parameters are called '{name}'."); }
            if (edit.Type.Trim().Length == 0 || SyntaxFactory.ParseTypeName(edit.Type).GetDiagnostics().Any(x => x.Severity == DiagnosticSeverity.Error)) { throw new InvalidOperationException($"'{edit.Type}' is not a type."); }
            if (edit.OldIndex is { } index)
            {
                if (index < 0 || index >= oldNames.Length || !seenOld.Add(index)) { throw new InvalidOperationException("The parameter list does not match the method."); }
                continue;
            }
            if (edit.DefaultValue is { Length: > 0 } fallback && !IsExpression(fallback)) { throw new InvalidOperationException($"'{fallback}' is not a value."); }
            if (edit.CallSiteValue is { Length: > 0 } passed && !IsExpression(passed)) { throw new InvalidOperationException($"'{passed}' is not a value."); }
            if (string.IsNullOrWhiteSpace(edit.DefaultValue) && string.IsNullOrWhiteSpace(edit.CallSiteValue)) { throw new InvalidOperationException($"{name} is new and has no default value: say what the calls pass for it."); }
        }
        if (start.IsExtensionMethod && edits.FirstOrDefault()?.OldIndex != 0) { throw new InvalidOperationException("The first parameter of an extension method (this) stays where it is."); }
        var unchanged = edits.Count == oldNames.Length
            && edits.Select((e, i) => e.OldIndex == i && e.Name.Trim() == oldNames[i] && e.Type.Trim() == oldTypes[i]).All(same => same);
        if (unchanged) { throw new InvalidOperationException("Nothing changed."); }
    }

    private static bool IsExpression(string text) => !SyntaxFactory.ParseExpression(text).GetDiagnostics().Any(x => x.Severity == DiagnosticSeverity.Error);

    // ---- what is under the cursor

    private static async Task<IMethodSymbol?> LocateAsync(Document document, Position position, CancellationToken ct)
    {
        var root = await document.GetSyntaxRootAsync(ct).ConfigureAwait(false);
        var text = await document.GetTextAsync(ct).ConfigureAwait(false);
        var model = await document.GetSemanticModelAsync(ct).ConfigureAwait(false);
        if (root is null || model is null || position.Line >= text.Lines.Count) { return null; }
        var offset = Math.Min(text.Lines[position.Line].Start + position.Character, text.Length);
        var token = root.FindToken(offset);
        // a cursor right behind the name is on the parenthesis
        if (offset > 0 && !(token.IsKind(SyntaxKind.IdentifierToken) || token.IsKind(SyntaxKind.NewKeyword) || token.IsKind(SyntaxKind.ThisKeyword) || token.IsKind(SyntaxKind.BaseKeyword))) { token = root.FindToken(offset - 1); }
        ISymbol? symbol = token.Parent switch
        {
            MethodDeclarationSyntax m when m.Identifier == token => model.GetDeclaredSymbol(m, ct),
            ConstructorDeclarationSyntax c when c.Identifier == token => model.GetDeclaredSymbol(c, ct),
            LocalFunctionStatementSyntax l when l.Identifier == token => model.GetDeclaredSymbol(l, ct),
            ImplicitObjectCreationExpressionSyntax i when i.NewKeyword == token => model.GetSymbolInfo(i, ct).Symbol,
            ConstructorInitializerSyntax ci when ci.ThisOrBaseKeyword == token => model.GetSymbolInfo(ci, ct).Symbol,
            SimpleNameSyntax name => ReferencedMethod(model, name, token, ct),
            _ => null,
        };
        if (symbol is not IMethodSymbol method) { return null; }
        method = (method.ReducedFrom ?? method).OriginalDefinition;
        return method.MethodKind is MethodKind.Ordinary or MethodKind.Constructor or MethodKind.LocalFunction or MethodKind.ExplicitInterfaceImplementation ? method : null;
    }

    private static ISymbol? ReferencedMethod(SemanticModel model, SimpleNameSyntax name, SyntaxToken token, CancellationToken ct)
    {
        var info = model.GetSymbolInfo(name, ct);
        var symbol = info.Symbol ?? (info.CandidateSymbols.Length == 1 ? info.CandidateSymbols[0] : null);
        if (symbol is IMethodSymbol) { return symbol; }
        // the name of the type in `new Type(...)` is the call of the constructor
        var creation = name.AncestorsAndSelf().OfType<ObjectCreationExpressionSyntax>().FirstOrDefault(o => o.Type.Span.Contains(token.Span));
        return creation is null ? null : model.GetSymbolInfo(creation, ct).Symbol;
    }

    private static string? Refuse(IMethodSymbol symbol)
    {
        var name = Describe(symbol);
        if (symbol.IsImplicitlyDeclared) { return $"{name} is not declared in the source (the compiler made it): there is no signature to change."; }
        if (symbol.DeclaringSyntaxReferences.Length == 0) { return $"{name} is declared in a library: its signature cannot be changed."; }
        if (ParameterListOf(symbol.DeclaringSyntaxReferences[0].GetSyntax()) is null) { return $"{name} is a kind of method whose signature this refactoring does not change (a primary constructor, an operator...)."; }
        return null;
    }

    private static ParameterListSyntax? ParameterListOf(SyntaxNode node) => node switch
    {
        MethodDeclarationSyntax m => m.ParameterList,
        ConstructorDeclarationSyntax c => c.ParameterList,
        LocalFunctionStatementSyntax l => l.ParameterList,
        _ => null,
    };

    private static IReadOnlyList<SignatureParameter> ParametersOf(IMethodSymbol symbol)
    {
        var list = symbol.DeclaringSyntaxReferences.Length > 0 ? ParameterListOf(symbol.DeclaringSyntaxReferences[0].GetSyntax()) : null;
        if (list is null || list.Parameters.Count != symbol.Parameters.Length)
        {
            return symbol.Parameters.Select(p => new SignatureParameter(p.Name, p.Type.ToDisplayString(SymbolDisplayFormat.MinimallyQualifiedFormat), "", null)).ToList();
        }
        return list.Parameters.Select(p => new SignatureParameter(p.Identifier.ValueText, p.Type?.ToString() ?? "object", p.Modifiers.ToString(), p.Default?.Value.ToString())).ToList();
    }

    private static string Describe(IMethodSymbol symbol)
        => symbol.MethodKind == MethodKind.Constructor ? $"{symbol.ContainingType.Name}.{symbol.ContainingType.Name}" : symbol.ContainingType is { } type ? $"{type.Name}.{symbol.Name}" : symbol.Name;

    private static bool Same(ISymbol? a, ISymbol? b) => SymbolEqualityComparer.Default.Equals(a, b);

    /// <summary>
    /// The same method as another project's compilation sees it: equal symbols, or the same name, parameter count and containing type
    /// (a symbol seen through a reference from another project is not always the very object of the declaring project).
    /// </summary>
    private static bool SameMethod(IMethodSymbol a, IMethodSymbol b)
        => Same(a, b) || (a.MetadataName == b.MetadataName && a.Parameters.Length == b.Parameters.Length && a.Arity == b.Arity
            && a.ContainingType?.ToDisplayString() == b.ContainingType?.ToDisplayString());

    // ---- the methods that change along

    /// <summary>The method with those it overrides or implements and those that override or implement it (their signatures must stay equal).</summary>
    private static async Task<(List<IMethodSymbol> Members, string? Refusal)> FamilyAsync(IMethodSymbol start, Solution solution, CancellationToken ct)
    {
        var members = new List<IMethodSymbol>();
        var queue = new Queue<IMethodSymbol>();
        void Add(IMethodSymbol? method)
        {
            if (method is null) { return; }
            method = method.OriginalDefinition;
            if (members.Any(m => Same(m, method))) { return; }
            members.Add(method);
            queue.Enqueue(method);
        }
        Add(start);
        if (start.MethodKind is MethodKind.Constructor or MethodKind.LocalFunction) { return (members, null); }
        while (queue.Count > 0)
        {
            var method = queue.Dequeue();
            Add(method.OverriddenMethod);
            foreach (var implemented in method.ExplicitInterfaceImplementations) { Add(implemented); }
            if (method.ContainingType is { } type)
            {
                foreach (var contract in type.AllInterfaces)
                {
                    foreach (var candidate in contract.GetMembers(method.Name).OfType<IMethodSymbol>())
                    {
                        if (Same(type.FindImplementationForInterfaceMember(candidate), method)) { Add(candidate); }
                    }
                }
                if (type.TypeKind == TypeKind.Interface)
                {
                    foreach (var implementation in await SymbolFinder.FindImplementationsAsync(method, solution, cancellationToken: ct).ConfigureAwait(false))
                    {
                        Add(implementation as IMethodSymbol);
                    }
                }
            }
            if (method.IsVirtual || method.IsAbstract || method.IsOverride)
            {
                foreach (var overriding in await SymbolFinder.FindOverridesAsync(method, solution, cancellationToken: ct).ConfigureAwait(false))
                {
                    Add(overriding as IMethodSymbol);
                }
            }
        }
        var library = members.FirstOrDefault(m => m.DeclaringSyntaxReferences.Length == 0);
        return (members, library is null ? null : $"{Describe(start)} overrides or implements {Describe(library)}, which is declared in a library: the signatures would no longer match.");
    }

    // ---- the calls

    private static CallSite? CallAt(SemanticModel model, SyntaxToken token, TextSpan span, Func<IMethodSymbol?, bool> inFamily, CancellationToken ct)
    {
        foreach (var node in token.Parent!.AncestorsAndSelf())
        {
            switch (node)
            {
                case InvocationExpressionSyntax invocation when invocation.Expression.Span.Contains(span):
                    return SiteOf(model.GetSymbolInfo(invocation, ct), invocation, invocation.ArgumentList, inFamily);
                case ObjectCreationExpressionSyntax creation when BeforeArguments(creation, creation.ArgumentList, span):
                    return SiteOf(model.GetSymbolInfo(creation, ct), creation, creation.ArgumentList, inFamily);
                case ImplicitObjectCreationExpressionSyntax implicitCreation when BeforeArguments(implicitCreation, implicitCreation.ArgumentList, span):
                    return SiteOf(model.GetSymbolInfo(implicitCreation, ct), implicitCreation, implicitCreation.ArgumentList, inFamily);
                case ConstructorInitializerSyntax initializer when initializer.ThisOrBaseKeyword.Span.Contains(span):
                    return SiteOf(model.GetSymbolInfo(initializer, ct), initializer, initializer.ArgumentList, inFamily);
            }
        }
        return null;
    }

    /// <summary>The reference is the `new Type` of the creation (the finder reports the type, the keyword or the whole expression), not something in its arguments.</summary>
    private static bool BeforeArguments(SyntaxNode creation, ArgumentListSyntax? list, TextSpan span)
        => span.Start >= creation.SpanStart && span.Start < (list?.SpanStart ?? creation.Span.End);

    private static CallSite? SiteOf(SymbolInfo info, SyntaxNode owner, ArgumentListSyntax? list, Func<IMethodSymbol?, bool> inFamily)
    {
        var invoked = info.Symbol as IMethodSymbol ?? info.CandidateSymbols.OfType<IMethodSymbol>().FirstOrDefault(inFamily);
        if (invoked is null || !inFamily(invoked)) { return null; }
        var definition = (invoked.ReducedFrom ?? invoked).OriginalDefinition;
        // `x.Extension(a)` leaves the this parameter out
        var offset = invoked.ReducedFrom is null ? 0 : 1;
        var count = definition.Parameters.Length;
        var map = new Dictionary<int, List<int>>();
        var named = new List<bool>();
        var arguments = list?.Arguments ?? [];
        for (var i = 0; i < arguments.Count; i++)
        {
            var argument = arguments[i];
            int index;
            if (argument.NameColon is { } colon)
            {
                index = definition.Parameters.ToList().FindIndex(p => p.Name == colon.Name.Identifier.ValueText);
            }
            else
            {
                index = i + offset;
                if (index >= count) { index = count > 0 && definition.Parameters[count - 1].IsParams ? count - 1 : -1; }
            }
            if (index < 0) { return null; }
            if (!map.TryGetValue(index, out var group)) { map[index] = group = []; }
            group.Add(i);
            named.Add(argument.NameColon is not null);
        }
        return new CallSite(owner, list, definition, map, named, invoked.ReducedFrom is not null);
    }

    private static ArgumentListSyntax RewriteArguments(ArgumentListSyntax rewritten, CallSite site, IReadOnlyList<SignatureEdit> edits, Func<IMethodSymbol, int, string> nameIn)
    {
        var arguments = rewritten.Arguments;
        var joined = Join(arguments, ComposeArguments(arguments, site, edits, nameIn));
        var parsed = SyntaxFactory.ParseArgumentList("(" + joined + ")");
        return rewritten.WithArguments(parsed.Arguments);
    }

    /// <summary>`new Type { ... }` without an argument list gets one when the call needs arguments now.</summary>
    private static SyntaxNode AddArguments(ObjectCreationExpressionSyntax rewritten, CallSite site, IReadOnlyList<SignatureEdit> edits, Func<IMethodSymbol, int, string> nameIn)
    {
        var parts = ComposeArguments([], site, edits, nameIn);
        if (parts.Count == 0) { return rewritten; }
        var list = SyntaxFactory.ParseArgumentList("(" + string.Join(", ", parts) + ")");
        return rewritten.WithType(rewritten.Type.WithoutTrailingTrivia()).WithArgumentList(list.WithTrailingTrivia(rewritten.Type.GetTrailingTrivia()));
    }

    /// <summary>The arguments of the call in the order of the new signature: the old ones where they were, the new ones with their value, named once one is left out.</summary>
    private static List<string> ComposeArguments(IReadOnlyList<ArgumentSyntax> arguments, CallSite site, IReadOnlyList<SignatureEdit> edits, Func<IMethodSymbol, int, string> nameIn)
    {
        var parts = new List<string>();
        var named = false;
        foreach (var edit in edits)
        {
            if (edit.OldIndex is { } index)
            {
                if (!site.ArgsByParameter.TryGetValue(index, out var positions))
                {
                    // `x.Extension(...)` has no argument for this
                    if (site.Reduced && index == 0) { continue; }
                    // the call did not pass it (an optional parameter): the ones behind it need their names
                    named = true;
                    continue;
                }
                var name = nameIn(site.Definition, index);
                foreach (var position in positions)
                {
                    var argument = arguments[position];
                    var useName = named || site.Named[position];
                    var modifier = argument.RefKindKeyword.IsKind(SyntaxKind.None) ? "" : argument.RefKindKeyword.Text + " ";
                    parts.Add((useName ? name + ": " : "") + modifier + argument.Expression);
                    named |= useName;
                }
                continue;
            }
            if (string.IsNullOrWhiteSpace(edit.CallSiteValue))
            {
                named = true;
                continue;
            }
            parts.Add((named ? edit.Name.Trim() + ": " : "") + edit.CallSiteValue.Trim());
        }
        return parts;
    }

    /// <summary>The parts joined with the separator the list had (a comma and a space, or a comma and a line break), keeping the trivia around the first and the last.</summary>
    private static string Join<T>(SeparatedSyntaxList<T> items, IReadOnlyList<string> parts) where T : SyntaxNode
    {
        if (items.Count == 0) { return string.Join(", ", parts); }
        var separator = items.Count > 1 ? items[0].GetTrailingTrivia().ToFullString() + items.GetSeparator(0).ToFullString() + items[1].GetLeadingTrivia().ToFullString() : ", ";
        return items[0].GetLeadingTrivia().ToFullString() + string.Join(separator, parts) + items[^1].GetTrailingTrivia().ToFullString();
    }

    // ---- the declarations

    private static ParameterListSyntax RewriteParameters(ParameterListSyntax rewritten, IMethodSymbol owner, IReadOnlyList<SignatureEdit> edits, string[] oldTypes, Func<IMethodSymbol, int, bool> renamed)
    {
        var parameters = rewritten.Parameters;
        var parts = new List<string>();
        foreach (var edit in edits)
        {
            if (edit.OldIndex is not { } index)
            {
                parts.Add($"{edit.Type.Trim()} {edit.Name.Trim()}" + (string.IsNullOrWhiteSpace(edit.DefaultValue) ? "" : $" = {edit.DefaultValue.Trim()}"));
                continue;
            }
            var parameter = parameters[index];
            if (renamed(owner, index)) { parameter = parameter.WithIdentifier(SyntaxFactory.Identifier(edit.Name.Trim()).WithTriviaFrom(parameter.Identifier)); }
            if (edit.Type.Trim() != oldTypes[index] && parameter.Type is { } type) { parameter = parameter.WithType(SyntaxFactory.ParseTypeName(edit.Type.Trim()).WithTriviaFrom(type)); }
            parts.Add(parameter.ToString());
        }
        var parsed = SyntaxFactory.ParseParameterList("(" + Join(parameters, parts) + ")");
        return rewritten.WithParameters(parsed.Parameters);
    }

    private static readonly Regex ParamStart = new(@"<param\s+name\s*=\s*""([^""]*)""", RegexOptions.Compiled);

    /// <summary>The param tags of the XML documentation follow the parameters: reordered, renamed, dropped, an empty one for a new parameter.</summary>
    private static SyntaxNode RewriteDocumentation(SyntaxNode rewritten, IMethodSymbol owner, IReadOnlyList<SignatureEdit> edits, Func<IMethodSymbol, int, bool> renamed)
    {
        var leading = rewritten.GetLeadingTrivia();
        var at = leading.IndexOf(SyntaxKind.SingleLineDocumentationCommentTrivia);
        if (at < 0) { return rewritten; }
        var doc = leading[at].ToFullString();
        var eol = doc.Contains("\r\n") ? "\r\n" : "\n";

        foreach (var (edit, _) in edits.Select((e, i) => (e, i)).Where(x => x.e.OldIndex is { } oi && renamed(owner, oi)))
        {
            var old = owner.Parameters[edit.OldIndex!.Value].Name;
            doc = Regex.Replace(doc, $@"(<paramref\s+name\s*=\s*"")({Regex.Escape(old)})("")", "${1}" + edit.Name.Trim() + "${3}");
        }

        var lines = Regex.Split(doc, "(?<=\n)").Where(l => l.Length > 0).ToList();
        var blocks = new List<(int Start, int End, string Name)>();
        for (var i = 0; i < lines.Count; i++)
        {
            if (ParamStart.Match(lines[i]) is not { Success: true } match) { continue; }
            var end = i;
            if (!Regex.IsMatch(lines[i], @"</param>|<param\s+name\s*=\s*""[^""]*""\s*/>"))
            {
                while (end + 1 < lines.Count && !lines[end].Contains("</param>")) { end++; }
            }
            blocks.Add((i, end, match.Groups[1].Value));
            i = end;
        }
        if (blocks.Count == 0) { return rewritten; }

        var text = blocks.ToDictionary(b => b.Name, b => string.Concat(lines.Skip(b.Start).Take(b.End - b.Start + 1)));
        var prefix = Regex.Match(lines[blocks[0].Start], @"^\s*///").Value;
        var ordered = new List<string>();
        foreach (var edit in edits)
        {
            if (edit.OldIndex is { } index)
            {
                var old = owner.Parameters[index].Name;
                if (!text.Remove(old, out var block)) { continue; }
                if (renamed(owner, index)) { block = ParamStart.Replace(block, $"<param name=\"{edit.Name.Trim()}\"", 1); }
                ordered.Add(block);
            }
            else
            {
                ordered.Add($"{prefix} <param name=\"{edit.Name.Trim()}\"></param>{eol}");
            }
        }
        // tags of no parameter of the method are not ours to drop; the tag of a removed parameter goes
        ordered.AddRange(text.Where(t => owner.Parameters.All(p => p.Name != t.Key)).Select(t => t.Value));

        var rebuilt = new List<string>();
        for (var i = 0; i < lines.Count; i++)
        {
            if (i == blocks[0].Start) { rebuilt.AddRange(ordered); }
            if (blocks.Any(b => i >= b.Start && i <= b.End)) { continue; }
            rebuilt.Add(lines[i]);
        }
        var parsed = SyntaxFactory.ParseLeadingTrivia(string.Concat(rebuilt));
        return rewritten.WithLeadingTrivia(leading.Take(at).Concat(parsed).Concat(leading.Skip(at + 1)));
    }
}
