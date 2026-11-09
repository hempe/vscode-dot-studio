using System.Text.Json.Serialization;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Extensions;
using Microsoft.CodeAnalysis.FindSymbols;
using Microsoft.CodeAnalysis.Text;

namespace Shinobi.Refactorings;

public sealed record ConvertImplementer(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("where")] string Where);

public sealed record ConvertTypeInfo(
    /// <summary>"toInterface" (an abstract class becomes an interface) or "toClass" (an interface becomes an abstract class).</summary>
    [property: JsonPropertyName("direction")] string Direction,
    [property: JsonPropertyName("typeName")] string TypeName,
    /// <summary>The classes that derive from the class (or implement the interface): their base list and members are rewritten.</summary>
    [property: JsonPropertyName("implementers")] IReadOnlyList<ConvertImplementer> Implementers,
    /// <summary>The members with a body: an interface has them only as default interface members (C# 8).</summary>
    [property: JsonPropertyName("bodies")] IReadOnlyList<string> Bodies,
    [property: JsonPropertyName("canUseDefaultMembers")] bool CanUseDefaultMembers,
    /// <summary>Why it cannot be done (one reason per line); the form is not opened.</summary>
    [property: JsonPropertyName("refusal")] string? Refusal);

public sealed record ConvertTypeRequest(
    [property: JsonPropertyName("position")] Position Position,
    /// <summary>Abstract class to interface: members with a body stay as default interface members.</summary>
    [property: JsonPropertyName("defaultMembers")] bool DefaultMembers);

public sealed class ConvertTypeInfoHandler : DocumentHandler<TypeAt, ConvertTypeInfo?>
{
    public override Task<ConvertTypeInfo?> ExecuteAsync(TypeAt message, Document document, CancellationToken cancellationToken)
        => ConvertTypeEngine.InfoAsync(document, message.Position, cancellationToken);
}

public sealed class ConvertTypeHandler : DocumentHandler<ConvertTypeRequest, ExtractInterfaceResult?>
{
    public override Task<ExtractInterfaceResult?> ExecuteAsync(ConvertTypeRequest message, Document document, CancellationToken cancellationToken)
        => ConvertTypeEngine.RunAsync(document, message, cancellationToken);
}

/// <summary>
/// Abstract class to interface and back. The type keeps its name (renaming it is F2's job: every use of it is kept valid), its
/// implementers lose or gain `override` and their base list is put right; anything the refactoring does not handle (state in the class,
/// constructors, non-public members, a class that already has a base class...) is refused with the reason, and the result is compiled.
/// </summary>
public static class ConvertTypeEngine
{
    private sealed class Analysis
    {
        public required string Direction { get; init; }
        public required TypeDeclarationSyntax Declaration { get; init; }
        public required INamedTypeSymbol Symbol { get; init; }
        public required Document Document { get; init; }
        public required SemanticModel Model { get; init; }
        public required List<string> Problems { get; init; }
        public required List<(Document Document, ClassDeclarationSyntax Declaration)> Implementers { get; init; }
        public required List<MemberDeclarationSyntax> WithBodies { get; init; }
        public required bool CanUseDefaults { get; init; }
    }

    public static async Task<ConvertTypeInfo?> InfoAsync(Document document, Position position, CancellationToken ct)
    {
        var a = await AnalyzeAsync(document, position, ct).ConfigureAwait(false);
        if (a is null) { return null; }
        var bodies = a.WithBodies.Select(PartialSupport.HeaderOf).ToList();
        var problems = a.Problems.ToList();
        if (a.Direction == "toInterface" && bodies.Count > 0 && !a.CanUseDefaults)
        {
            problems.Add($"It has members with a body ({string.Join(", ", bodies.Select(b => $"'{b}'"))}); an interface can only have them as default interface members, from C# 8 on.");
        }
        return new ConvertTypeInfo(a.Direction, a.Symbol.Name, a.Implementers.Select(i => new ConvertImplementer(i.Declaration.Identifier.Text, WhereOf(i.Document))).ToList(), bodies,
            a.CanUseDefaults, problems.Count == 0 ? null : string.Join("\n", problems.Select(p => $"{a.Symbol.Name}: {p}")));
    }

    public static async Task<ExtractInterfaceResult?> RunAsync(Document document, ConvertTypeRequest request, CancellationToken ct)
    {
        var a = await AnalyzeAsync(document, request.Position, ct).ConfigureAwait(false);
        if (a is null) { return null; }
        if (a.Problems.Count > 0) { throw new InvalidOperationException(string.Join("\n", a.Problems.Select(p => $"{a.Symbol.Name}: {p}"))); }
        var text = await document.GetTextAsync(ct).ConfigureAwait(false);
        var edits = new List<TextEdit>();
        var others = new Dictionary<string, List<TextEdit>>(StringComparer.OrdinalIgnoreCase);
        List<TextEdit> Into(Document target)
        {
            if (target.Id == document.Id) { return edits; }
            if (!others.TryGetValue(target.FilePath!, out var list)) { others[target.FilePath!] = list = []; }
            return list;
        }

        if (a.Direction == "toInterface")
        {
            if (a.WithBodies.Count > 0 && !request.DefaultMembers)
            {
                throw new InvalidOperationException($"{a.Symbol.Name} has members with a body; they can only stay as default interface members.");
            }
            ToInterface(a, text, edits);
            foreach (var (implementerDocument, declaration) in a.Implementers)
            {
                var implementerText = await implementerDocument.GetTextAsync(ct).ConfigureAwait(false);
                var model = (await implementerDocument.GetSemanticModelAsync(ct).ConfigureAwait(false))!;
                var list = Into(implementerDocument);
                // what overrode a member of the class now implements a member of the interface
                foreach (var member in declaration.Members)
                {
                    if (member is BaseTypeDeclarationSyntax || !OverridesMemberOf(model, member, a.Symbol, ct)) { continue; }
                    list.AddRange(RemoveModifiers(implementerText, member, SyntaxKind.OverrideKeyword));
                }
            }
        }
        else
        {
            ToClass(a, text, edits);
            foreach (var (implementerDocument, declaration) in a.Implementers)
            {
                var implementerText = await implementerDocument.GetTextAsync(ct).ConfigureAwait(false);
                var model = (await implementerDocument.GetSemanticModelAsync(ct).ConfigureAwait(false))!;
                var list = Into(implementerDocument);
                var symbol = model.GetDeclaredSymbol(declaration, ct)!;
                // the class named first in the base list: the interface becomes a class, which must come before the interfaces
                var baseList = declaration.BaseList!;
                var entries = baseList.Types.Select(t => t.ToString()).ToList();
                var index = baseList.Types.ToList().FindIndex(t => Same(model.GetTypeInfo(t.Type, ct).Type, a.Symbol));
                if (index > 0)
                {
                    var ordered = new[] { entries[index] }.Concat(entries.Where((_, i) => i != index));
                    list.Add(ExtractSuperclassEngine.Replace(implementerText, TextSpan.FromBounds(baseList.Types[0].SpanStart, baseList.Types[^1].Span.End), string.Join(", ", ordered)));
                }
                // what implemented a member of the interface now overrides a member of the class
                var done = new HashSet<MemberDeclarationSyntax>();
                foreach (var interfaceMember in a.Symbol.GetMembers().Where(m => m is IMethodSymbol { MethodKind: MethodKind.Ordinary } or IPropertySymbol or IEventSymbol))
                {
                    if (symbol.FindImplementationForInterfaceMember(interfaceMember) is not { } implementation || !Same(implementation.ContainingType, symbol)) { continue; }
                    foreach (var reference in implementation.DeclaringSyntaxReferences)
                    {
                        var syntax = reference.GetSyntax(ct);
                        var member = syntax as MemberDeclarationSyntax ?? syntax.Parent as MemberDeclarationSyntax;
                        if (member is null || reference.SyntaxTree != declaration.SyntaxTree || !done.Add(member)) { continue; }
                        list.AddRange(AddOverride(implementerText, member));
                    }
                }
            }
        }

        var result = new ExtractInterfaceResult(edits, null, null, null, others.Count == 0 ? null : others.Select(o => new FileEdits(o.Key, o.Value)).ToList(),
            a.Direction == "toInterface"
                ? $"{a.Symbol.Name} is an interface now; it keeps its name, rename it (F2) to follow your naming."
                : $"{a.Symbol.Name} is an abstract class now; it keeps its name, rename it (F2) to follow your naming.");
        var checkedResult = await RefactoringValidator.CheckAsync(document, result, ct).ConfigureAwait(false);
        return checkedResult;
    }

    // ---- abstract class to interface ----

    private static void ToInterface(Analysis a, SourceText text, List<TextEdit> edits)
    {
        var declaration = (ClassDeclarationSyntax)a.Declaration;
        edits.AddRange(RemoveModifiers(text, declaration, SyntaxKind.AbstractKeyword));
        edits.Add(ExtractSuperclassEngine.Replace(text, declaration.Keyword.Span, "interface"));
        foreach (var member in declaration.Members)
        {
            edits.AddRange(RemoveModifiers(text, member, SyntaxKind.PublicKeyword, SyntaxKind.AbstractKeyword, SyntaxKind.VirtualKeyword));
        }
    }

    private static bool OverridesMemberOf(SemanticModel model, MemberDeclarationSyntax member, INamedTypeSymbol type, CancellationToken ct)
    {
        if (!member.Modifiers.Any(SyntaxKind.OverrideKeyword)) { return false; }
        return PullDeclared(model, member).Any(symbol => symbol switch
        {
            IMethodSymbol m => Same(m.OverriddenMethod?.ContainingType, type),
            IPropertySymbol p => Same(p.OverriddenProperty?.ContainingType, type),
            IEventSymbol e => Same(e.OverriddenEvent?.ContainingType, type),
            _ => false,
        });
    }

    private static IEnumerable<ISymbol> PullDeclared(SemanticModel model, MemberDeclarationSyntax member) => ExtractSuperclassEngine.DeclaredSymbols(model, member);

    // ---- interface to abstract class ----

    private static void ToClass(Analysis a, SourceText text, List<TextEdit> edits)
    {
        var declaration = (InterfaceDeclarationSyntax)a.Declaration;
        var partial = declaration.Modifiers.FirstOrDefault(m => m.IsKind(SyntaxKind.PartialKeyword));
        edits.Add(PartialSupport.Insert(text, partial != default ? partial.SpanStart : declaration.Keyword.SpanStart, "abstract "));
        edits.Add(ExtractSuperclassEngine.Replace(text, declaration.Keyword.Span, "class"));
        foreach (var member in declaration.Members)
        {
            var hasBody = a.WithBodies.Contains(member);
            var modifiers = member.Modifiers;
            var add = (modifiers.Any(SyntaxKind.PublicKeyword) ? "" : "public ")
                    + (modifiers.Any(SyntaxKind.AbstractKeyword) || modifiers.Any(SyntaxKind.VirtualKeyword) ? "" : hasBody ? "virtual " : "abstract ");
            if (add.Length > 0) { edits.Add(PartialSupport.Insert(text, ExtractSuperclassEngine.ModifierAnchor(member), add)); }
        }
    }

    /// <summary>`override` after the access modifier (before the rest), `virtual` and `new` gone: a member that implemented an interface member now overrides one.</summary>
    private static IEnumerable<TextEdit> AddOverride(SourceText text, MemberDeclarationSyntax member)
    {
        var modifiers = member.Modifiers;
        if (modifiers.Any(SyntaxKind.OverrideKeyword)) { yield break; }
        foreach (var edit in RemoveModifiers(text, member, SyntaxKind.VirtualKeyword, SyntaxKind.NewKeyword)) { yield return edit; }
        var access = modifiers.LastOrDefault(m => ExtractSuperclassEngine.AccessKinds.Contains(m.Kind()));
        yield return access != default
            ? PartialSupport.Insert(text, access.Span.End, " override")
            : PartialSupport.Insert(text, ExtractSuperclassEngine.ModifierAnchor(member), "public override ");
    }

    // ---- shared ----

    private static bool Same(ISymbol? a, ISymbol? b) => SymbolEqualityComparer.Default.Equals(a?.OriginalDefinition, b?.OriginalDefinition);

    /// <summary>Removes the modifiers of the kinds from the member, with the blanks after each, never a line break.</summary>
    private static IEnumerable<TextEdit> RemoveModifiers(SourceText text, MemberDeclarationSyntax member, params SyntaxKind[] kinds)
    {
        foreach (var token in member.Modifiers.Where(m => kinds.Contains(m.Kind())))
        {
            var end = token.Span.End + token.TrailingTrivia.TakeWhile(t => t.IsKind(SyntaxKind.WhitespaceTrivia)).Sum(t => t.FullSpan.Length);
            yield return ExtractSuperclassEngine.Replace(text, TextSpan.FromBounds(token.SpanStart, end), "");
        }
    }

    private static string WhereOf(Document document) => $"{Path.GetFileName(document.FilePath)} ({document.Project.Name})";

    private static async Task<Analysis?> AnalyzeAsync(Document document, Position position, CancellationToken ct)
    {
        var root = await document.GetSyntaxRootAsync(ct).ConfigureAwait(false);
        var text = await document.GetTextAsync(ct).ConfigureAwait(false);
        if (root is null || position.Line >= text.Lines.Count) { return null; }
        var token = root.FindToken(Math.Min(text.Lines[position.Line].Start + position.Character, text.Length));
        TypeDeclarationSyntax? declaration = token.Parent switch
        {
            ClassDeclarationSyntax c when c.Identifier == token && c.Modifiers.Any(SyntaxKind.AbstractKeyword) => c,
            InterfaceDeclarationSyntax i when i.Identifier == token => i,
            _ => null,
        };
        if (declaration is null) { return null; }
        var model = (await document.GetSemanticModelAsync(ct).ConfigureAwait(false))!;
        if (model.GetDeclaredSymbol(declaration, ct) is not { } symbol) { return null; }

        var toInterface = declaration is ClassDeclarationSyntax;
        var problems = new List<string>();
        var withBodies = new List<MemberDeclarationSyntax>();
        if (symbol.DeclaringSyntaxReferences.Length > 1 || declaration.Modifiers.Any(SyntaxKind.PartialKeyword)) { problems.Add("It is a partial type; convert it after putting it in one file."); }
        var parseOptions = (CSharpParseOptions)document.Project.ParseOptions!;
        var canUseDefaults = parseOptions.LanguageVersion.MapSpecifiedToEffectiveVersion() >= LanguageVersion.CSharp8;

        if (toInterface) { CheckClass(symbol, declaration, model, problems, withBodies, ct); }
        else { CheckInterface(symbol, declaration, problems, withBodies); }

        var implementers = new List<(Document, ClassDeclarationSyntax)>();
        var solution = document.Project.Solution;
        if (toInterface)
        {
            var derived = await SymbolFinder.FindDerivedClassesAsync(symbol, solution, transitive: false, cancellationToken: ct).ConfigureAwait(false);
            foreach (var type in derived)
            {
                if (Source(solution, type) is { } found) { implementers.Add(found); }
                else { problems.Add($"{type.Name} derives from it and is not declared in this solution's source."); }
            }
        }
        else
        {
            await FindImplementersAsync(solution, symbol, implementers, problems, ct).ConfigureAwait(false);
        }
        return new Analysis
        {
            Direction = toInterface ? "toInterface" : "toClass", Declaration = declaration, Symbol = symbol, Document = document, Model = model,
            Problems = problems, Implementers = implementers, WithBodies = withBodies, CanUseDefaults = canUseDefaults,
        };
    }

    private static (Document, ClassDeclarationSyntax)? Source(Solution solution, INamedTypeSymbol type)
    {
        foreach (var reference in type.DeclaringSyntaxReferences)
        {
            if (reference.GetSyntax() is ClassDeclarationSyntax syntax && solution.GetDocument(reference.SyntaxTree) is { FilePath: not null } document) { return (document, syntax); }
        }
        return null;
    }

    /// <summary>An abstract class that an interface can replace: no state, no constructors, no base class, public instance members only.</summary>
    private static void CheckClass(INamedTypeSymbol symbol, TypeDeclarationSyntax declaration, SemanticModel model, List<string> problems, List<MemberDeclarationSyntax> withBodies, CancellationToken ct)
    {
        if (symbol.BaseType is { SpecialType: not SpecialType.System_Object } baseType) { problems.Add($"It derives from {baseType.Name}; an interface cannot have a base class."); }
        foreach (var member in declaration.Members)
        {
            var name = PartialSupport.HeaderOf(member);
            switch (member)
            {
                case FieldDeclarationSyntax: problems.Add($"'{name}' is a field; an interface has no state."); continue;
                case ConstructorDeclarationSyntax or DestructorDeclarationSyntax: problems.Add($"'{name}' is a constructor or finalizer; an interface has none."); continue;
                case BaseTypeDeclarationSyntax or DelegateDeclarationSyntax: problems.Add($"'{name}' is a nested type."); continue;
                case OperatorDeclarationSyntax or ConversionOperatorDeclarationSyntax: problems.Add($"'{name}' is an operator."); continue;
                case EventFieldDeclarationSyntax e when !e.Modifiers.Any(SyntaxKind.AbstractKeyword): problems.Add($"'{name}' is an event with its own field; an interface has no state."); continue;
            }
            var modifiers = member.Modifiers;
            if (modifiers.Any(SyntaxKind.StaticKeyword)) { problems.Add($"'{name}' is static."); continue; }
            if (modifiers.Any(SyntaxKind.OverrideKeyword)) { problems.Add($"'{name}' overrides a member of object; an interface cannot."); continue; }
            if (modifiers.Any(SyntaxKind.NewKeyword) || modifiers.Any(SyntaxKind.SealedKeyword) || modifiers.Any(SyntaxKind.ExternKeyword)) { problems.Add($"'{name}' cannot be in an interface (new, sealed or extern)."); continue; }
            if (ExtractSuperclassEngine.DeclaredSymbols(model, member).Any(s => s.DeclaredAccessibility != Accessibility.Public)) { problems.Add($"'{name}' is not public; an interface member would be."); continue; }
            if (ExtractSuperclassEngine.DeclaredSymbols(model, member).Any(s => s is IMethodSymbol m && m.ExplicitInterfaceImplementations.Length > 0 || s is IPropertySymbol p && p.ExplicitInterfaceImplementations.Length > 0)) { problems.Add($"'{name}' is an explicit interface implementation."); continue; }

            var isAbstract = modifiers.Any(SyntaxKind.AbstractKeyword);
            switch (member)
            {
                case MethodDeclarationSyntax m when !isAbstract: withBodies.Add(m); break;
                case PropertyDeclarationSyntax p when !isAbstract:
                    if (p.ExpressionBody is null && p.AccessorList?.Accessors.All(x => x.Body is null && x.ExpressionBody is null) == true) { problems.Add($"'{name}' is an automatic property with its own field; an interface has no state."); }
                    else { withBodies.Add(p); }
                    break;
                case IndexerDeclarationSyntax i when !isAbstract: withBodies.Add(i); break;
                case EventDeclarationSyntax e when !isAbstract: withBodies.Add(e); break;
            }
        }
        _ = ct;
    }

    private static void CheckInterface(INamedTypeSymbol symbol, TypeDeclarationSyntax declaration, List<string> problems, List<MemberDeclarationSyntax> withBodies)
    {
        if (symbol.Interfaces.Length > 0) { problems.Add($"It extends {string.Join(", ", symbol.Interfaces.Select(i => i.Name))}; the abstract class would have to implement {(symbol.Interfaces.Length == 1 ? "it" : "them")}, which is not supported."); }
        foreach (var member in declaration.Members)
        {
            var name = PartialSupport.HeaderOf(member);
            if (member is BaseTypeDeclarationSyntax or DelegateDeclarationSyntax) { problems.Add($"'{name}' is a nested type."); continue; }
            var modifiers = member.Modifiers;
            if (modifiers.Any(SyntaxKind.StaticKeyword) || modifiers.Any(SyntaxKind.PrivateKeyword) || modifiers.Any(SyntaxKind.ProtectedKeyword) || modifiers.Any(SyntaxKind.InternalKeyword) || modifiers.Any(SyntaxKind.SealedKeyword))
            {
                problems.Add($"'{name}' is static, sealed or not public; a class member that implements it would not match.");
                continue;
            }
            var body = member switch
            {
                MethodDeclarationSyntax m => m.Body is not null || m.ExpressionBody is not null,
                PropertyDeclarationSyntax p => p.ExpressionBody is not null || p.AccessorList?.Accessors.Any(x => x.Body is not null || x.ExpressionBody is not null) == true,
                IndexerDeclarationSyntax i => i.ExpressionBody is not null || i.AccessorList?.Accessors.Any(x => x.Body is not null || x.ExpressionBody is not null) == true,
                EventDeclarationSyntax => true,
                _ => false,
            };
            if (body) { withBodies.Add(member); }
        }
    }

    /// <summary>The classes that name the interface in their base list; every other kind of type or interface that does is a reason not to convert.</summary>
    private static async Task FindImplementersAsync(Solution solution, INamedTypeSymbol symbol, List<(Document, ClassDeclarationSyntax)> implementers, List<string> problems, CancellationToken ct)
    {
        var references = await SymbolFinder.FindReferencesAsync(symbol, solution, ct).ConfigureAwait(false);
        foreach (var location in references.SelectMany(r => r.Locations))
        {
            if (location.IsImplicit || location.Location.SourceTree is not { } tree) { continue; }
            var node = (await tree.GetRootAsync(ct).ConfigureAwait(false)).FindNode(location.Location.SourceSpan, getInnermostNodeForTie: true);
            if (node.Parent is not (SimpleBaseTypeSyntax or PrimaryConstructorBaseTypeSyntax) && node.AncestorsAndSelf().OfType<BaseListSyntax>().FirstOrDefault() is null) { continue; }
            var baseList = node.AncestorsAndSelf().OfType<BaseListSyntax>().FirstOrDefault();
            switch (baseList?.Parent)
            {
                case ClassDeclarationSyntax @class:
                {
                    var model = (await location.Document.GetSemanticModelAsync(ct).ConfigureAwait(false))!;
                    var type = model.GetDeclaredSymbol(@class, ct);
                    if (type?.BaseType is { SpecialType: not SpecialType.System_Object } existing)
                    {
                        problems.Add($"{@class.Identifier.Text} already derives from {existing.Name}; a class has only one base class.");
                    }
                    else if (location.Document.FilePath is not null && !implementers.Any(i => i.Item2 == @class)) { implementers.Add((location.Document, @class)); }
                    break;
                }
                case InterfaceDeclarationSyntax other: problems.Add($"The interface {other.Identifier.Text} extends it."); break;
                case StructDeclarationSyntax @struct: problems.Add($"The struct {@struct.Identifier.Text} implements it; a struct cannot derive from a class."); break;
                case RecordDeclarationSyntax record: problems.Add($"The record {record.Identifier.Text} implements it, which is not supported."); break;
            }
        }
    }
}
