using System.Text;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Extensions;
using Microsoft.CodeAnalysis.Text;

namespace Shinobi.Refactorings;

public sealed record SuperclassMember(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("signature")] string Signature,
    /// <summary>A method or property the base class can declare abstract; the type keeps its body as an override.</summary>
    [property: JsonPropertyName("canBeAbstract")] bool CanBeAbstract,
    /// <summary>The members of the type this one uses by their plain name: they have to come along or stay reachable.</summary>
    [property: JsonPropertyName("deps")] IReadOnlyList<string> Deps,
    /// <summary>Why the member cannot move (it uses something of another part of the type, it is a partial member).</summary>
    [property: JsonPropertyName("blocked")] string? Blocked,
    /// <summary>The declaration the base class gets when the member is made abstract.</summary>
    [property: JsonPropertyName("abstractSignature")] string? AbstractSignature);

public sealed record ExtractSuperclassInfo(
    [property: JsonPropertyName("typeName")] string TypeName,
    [property: JsonPropertyName("baseName")] string BaseName,
    [property: JsonPropertyName("members")] IReadOnlyList<SuperclassMember> Members,
    /// <summary>Set when the refactoring cannot be done on this type; the form is not opened, the message is shown.</summary>
    [property: JsonPropertyName("refusal")] string? Refusal);

public sealed record ExtractSuperclassRequest(
    [property: JsonPropertyName("position")] Position Position,
    [property: JsonPropertyName("baseName")] string BaseName,
    [property: JsonPropertyName("memberIds")] IReadOnlyList<string> MemberIds,
    [property: JsonPropertyName("abstractIds")] IReadOnlyList<string> AbstractIds,
    [property: JsonPropertyName("newFile")] bool NewFile,
    /// <summary>Use the base class in place of the type where only its members (and what the type inherits) are used.</summary>
    [property: JsonPropertyName("useBaseType")] bool UseBaseType = false);

/// <summary>The members of the class under the cursor that can go into a new base class, with what they depend on.</summary>
public sealed class ExtractSuperclassInfoHandler : DocumentHandler<TypeAt, ExtractSuperclassInfo?>
{
    public override Task<ExtractSuperclassInfo?> ExecuteAsync(TypeAt message, Document document, CancellationToken cancellationToken)
        => ExtractSuperclassEngine.InfoAsync(document, message.Position, cancellationToken);
}

/// <summary>Creates the base class, moves or declares the chosen members there, and makes the class derive from it; refuses what it cannot do right.</summary>
public sealed class ExtractSuperclassHandler : DocumentHandler<ExtractSuperclassRequest, ExtractInterfaceResult?>
{
    public override Task<ExtractInterfaceResult?> ExecuteAsync(ExtractSuperclassRequest message, Document document, CancellationToken cancellationToken)
        => ExtractSuperclassEngine.RunAsync(document, message, cancellationToken);
}

/// <summary>What the refactoring works on: the class, where it is declared and what its members use of each other.</summary>
internal sealed class SuperclassContext
{
    public required Document Document { get; init; }
    public required ClassDeclarationSyntax Declaration { get; init; }
    public required INamedTypeSymbol Symbol { get; init; }
    public required SemanticModel Model { get; init; }
    public required CompilationUnitSyntax Root { get; init; }
    public required SourceText Text { get; init; }
    /// <summary>The members that can be listed, with their id.</summary>
    public required List<(MemberDeclarationSyntax Syntax, string Id)> Members { get; init; }
    public required string? Refusal { get; init; }
}

public static class ExtractSuperclassEngine
{
    public static async Task<ExtractSuperclassInfo?> InfoAsync(Document document, Position position, CancellationToken ct)
    {
        var context = await AnalyzeAsync(document, position, ct).ConfigureAwait(false);
        if (context is null) { return null; }
        if (context.Refusal is not null) { return new ExtractSuperclassInfo(context.Symbol.Name, BaseNameOf(context), [], context.Refusal); }

        var members = new List<SuperclassMember>();
        foreach (var (syntax, id) in context.Members)
        {
            var (deps, blocked) = DependenciesOf(context, syntax);
            var abstractSignature = AbstractDeclaration(syntax);
            members.Add(new SuperclassMember(id, PartialSupport.KindOf(syntax), PartialSupport.HeaderOf(syntax), abstractSignature is not null, deps, blocked, abstractSignature));
        }
        return new ExtractSuperclassInfo(context.Symbol.Name, BaseNameOf(context), members, null);
    }

    public static async Task<ExtractInterfaceResult?> RunAsync(Document document, ExtractSuperclassRequest request, CancellationToken ct)
    {
        var context = await AnalyzeAsync(document, request.Position, ct).ConfigureAwait(false);
        if (context is null) { return null; }
        if (context.Refusal is not null) { throw new InvalidOperationException(context.Refusal); }
        if (document.FilePath is not { } path) { return null; }

        var baseName = request.BaseName;
        if (!SyntaxFacts.IsValidIdentifier(baseName) || baseName == context.Symbol.Name)
        {
            throw new InvalidOperationException($"'{baseName}' is not a valid name for the new base class.");
        }
        var byId = context.Members.ToDictionary(m => m.Id, m => m.Syntax);
        var chosen = new HashSet<string>(request.MemberIds);
        if (chosen.Count == 0) { return null; }
        if (chosen.Any(id => !byId.ContainsKey(id)) || request.AbstractIds.Any(id => !chosen.Contains(id)))
        {
            throw new InvalidOperationException("The file changed since the members were listed; try again.");
        }
        var abstractIds = new HashSet<string>(request.AbstractIds);
        foreach (var id in abstractIds)
        {
            if (AbstractDeclaration(byId[id]) is null) { throw new InvalidOperationException($"'{PartialSupport.HeaderOf(byId[id])}' cannot be made abstract."); }
        }

        var ordered = context.Members.Where(m => chosen.Contains(m.Id)).ToList();
        var moved = ordered.Where(m => !abstractIds.Contains(m.Id)).Select(m => m.Syntax).ToList();
        var declared = ordered.Where(m => abstractIds.Contains(m.Id)).Select(m => m.Syntax).ToList();

        // a moved member can only use members that go to the base class too (or that it declares abstract)
        foreach (var (syntax, id) in ordered.Where(m => !abstractIds.Contains(m.Id)))
        {
            var (deps, blocked) = DependenciesOf(context, syntax);
            if (blocked is not null) { throw new InvalidOperationException($"'{PartialSupport.HeaderOf(syntax)}' cannot move: {blocked}."); }
            var missing = deps.Where(d => !chosen.Contains(d)).Select(d => PartialSupport.HeaderOf(byId[d])).ToList();
            if (missing.Count > 0)
            {
                throw new InvalidOperationException($"'{PartialSupport.HeaderOf(syntax)}' uses {string.Join(", ", missing.Select(m => $"'{m}'"))}, which stays in {context.Symbol.Name} and cannot be reached from the base class; move it as well.");
            }
        }

        var text = context.Text;
        var eol = text.ToString().Contains("\r\n") ? "\r\n" : "\n";
        var declaration = context.Declaration;
        var typeParameters = declaration.TypeParameterList?.ToString() ?? "";
        var edits = new List<TextEdit>();

        // the class derives from the new base class, which takes the place of its own base class
        var baseType = baseName + typeParameters;
        string? oldBase = null;
        if (declaration.BaseList is { } baseList)
        {
            var first = baseList.Types[0].Type;
            if (context.Model.GetTypeInfo(first, ct).Type is { TypeKind: TypeKind.Class })
            {
                oldBase = first.ToString();
                edits.Add(Replace(text, first.Span, baseType));
            }
            else
            {
                edits.Add(PartialSupport.Insert(text, baseList.Types[0].SpanStart, baseType + ", "));
            }
        }
        else
        {
            var after = declaration.TypeParameterList?.Span.End ?? declaration.Identifier.Span.End;
            edits.Add(PartialSupport.Insert(text, after, " : " + baseType));
        }

        // members that stay as overrides of the abstract declarations
        foreach (var member in declared) { edits.AddRange(OverrideEdits(text, member)); }

        // members that move leave their lines
        edits.AddRange(PartialSupport.RemovalEdits(text, moved));

        // private members (and private accessors) that the class still uses (or another part does) must be reachable from it: protected
        var usedElsewhere = MovedMembersUsedElsewhere(context, moved, ct);
        var bodies = new List<string>();
        foreach (var (syntax, id) in ordered)
        {
            if (abstractIds.Contains(id)) { bodies.Add(AbstractDeclaration(syntax)! + eol); continue; }
            var adjustments = usedElsewhere.Contains(syntax) ? AccessibilityEdits(context.Model, syntax) : [];
            bodies.Add(PartialSupport.TextOf(text, syntax, eol, adjustments));
        }

        var isAbstract = declared.Count > 0;
        var nodes = moved.Concat(declared).Cast<SyntaxNode>().ToList();
        var usings = PartialSupport.NeededUsings(context.Root, context.Model, nodes, ct, oldBase is null ? null : [declaration.BaseList!.Types[0]]);

        PartialSupport.RefuseExisting(document, context.Symbol, baseName, request.NewFile ? Path.Combine(Path.GetDirectoryName(path)!, baseName + ".cs") : null);
        string? newPath = null;
        string? newContent = null;
        if (request.NewFile)
        {
            var ns = declaration.Ancestors().OfType<BaseNamespaceDeclarationSyntax>().FirstOrDefault();
            var block = ns is NamespaceDeclarationSyntax;
            var typeText = BaseTypeText(context, baseName, oldBase, isAbstract, bodies, block ? "    " : "", eol);
            newPath = Path.Combine(Path.GetDirectoryName(path)!, baseName + ".cs");
            newContent = FileText(usings, ns, typeText, eol);
        }
        else
        {
            var indent = ExtractInterfaceSupport.IndentOf(text, declaration);
            var typeText = BaseTypeText(context, baseName, oldBase, isAbstract, bodies, indent, eol);
            edits.Add(PartialSupport.Insert(text, ExtractInterfaceSupport.LineStartBefore(text, declaration), typeText + eol));
        }
        var result = new ExtractInterfaceResult(edits, newPath, newContent);
        if (request.UseBaseType)
        {
            var chosenSymbols = nodes.OfType<MemberDeclarationSyntax>().SelectMany(m => DeclaredSymbols(context.Model, m));
            var target = UseBaseTypeEngine.ForNewBaseClass(baseName, context.Symbol, chosenSymbols);
            var groups = await UseBaseTypeEngine.PlanAsync(document, context.Symbol, target, ct).ConfigureAwait(false);
            return await UseBaseTypeEngine.ChooseAsync(document, result, groups, context.Symbol.Name, baseName, ct).ConfigureAwait(false);
        }
        return await RefactoringValidator.CheckAsync(document, result, ct).ConfigureAwait(false);
    }

    private static string BaseNameOf(SuperclassContext context) => context.Symbol.Name + "Base";

    internal static TextEdit Replace(SourceText text, TextSpan span, string newText)
    {
        var start = text.Lines.GetLinePosition(span.Start);
        var end = text.Lines.GetLinePosition(span.End);
        return new TextEdit(start.Line, start.Character, end.Line, end.Character, newText);
    }

    /// <summary>The class under the position and what the refactoring needs to know about it; a refusal when it cannot be done.</summary>
    private static async Task<SuperclassContext?> AnalyzeAsync(Document document, Position position, CancellationToken ct)
    {
        var found = await ExtractInterfaceSupport.FindTypeAsync(document, position, ct).ConfigureAwait(false);
        // classes only: not structs, records or static classes
        if (found is null || found.Value.Declaration is not ClassDeclarationSyntax declaration || declaration.Modifiers.Any(SyntaxKind.StaticKeyword)) { return null; }
        var symbol = found.Value.Symbol;
        var root = (CompilationUnitSyntax)(await document.GetSyntaxRootAsync(ct).ConfigureAwait(false))!;
        var model = (await document.GetSemanticModelAsync(ct).ConfigureAwait(false))!;
        var text = await document.GetTextAsync(ct).ConfigureAwait(false);

        var members = new List<(MemberDeclarationSyntax, string)>();
        for (var i = 0; i < declaration.Members.Count; i++)
        {
            if (IsListable(declaration.Members[i])) { members.Add((declaration.Members[i], PartialSupport.IdOf(declaration.Members[i], i))); }
        }
        return new SuperclassContext
        {
            Document = document, Declaration = declaration, Symbol = symbol, Model = model, Root = root, Text = text, Members = members,
            Refusal = RefusalOf(document, declaration, symbol, model, ct),
        };
    }

    /// <summary>The cases the refactoring does not handle, with the reason, so that nothing is generated that does not compile.</summary>
    private static string? RefusalOf(Document document, ClassDeclarationSyntax declaration, INamedTypeSymbol symbol, SemanticModel model, CancellationToken ct)
    {
        if (declaration.Parent is TypeDeclarationSyntax)
        {
            return $"{symbol.Name} is a nested type: the new base class would have to be nested too, which is not supported.";
        }
        // The base class can be named in one part of a partial class only. Ours takes `: Base` onto this part, so no other part may name a class.
        foreach (var reference in symbol.DeclaringSyntaxReferences)
        {
            if (reference.SyntaxTree == declaration.SyntaxTree && reference.Span == declaration.Span) { continue; }
            if (reference.GetSyntax(ct) is not TypeDeclarationSyntax { BaseList: { } other }) { continue; }
            var otherModel = document.Project.GetCompilationAsync(ct).GetAwaiter().GetResult()!.GetSemanticModel(reference.SyntaxTree);
            foreach (var type in other.Types)
            {
                if (otherModel.GetTypeInfo(type.Type, ct).Type is { TypeKind: TypeKind.Class } named)
                {
                    return $"Another part of {symbol.Name} ({Path.GetFileName(reference.SyntaxTree.FilePath)}) names the base class {named.Name}. Move the base class to the part you extract from, or extract from that part.";
                }
            }
        }
        // the new base class has a default constructor only: the old base class must be creatable without arguments, and so must the calls to it
        if (symbol.BaseType is { SpecialType: not SpecialType.System_Object } oldBase
            && !oldBase.InstanceConstructors.Any(c => c.DeclaredAccessibility != Accessibility.Private && c.Parameters.All(p => p.IsOptional || p.IsParams)))
        {
            return $"The base class {oldBase.Name} has no constructor without arguments. The new base class would need constructors that pass the arguments on, which is not supported yet.";
        }
        if (declaration.Members.OfType<ConstructorDeclarationSyntax>().Any(c => c.Initializer is { ThisOrBaseKeyword.RawKind: (int)SyntaxKind.BaseKeyword, ArgumentList.Arguments.Count: > 0 }))
        {
            return $"A constructor of {symbol.Name} passes arguments to its base class (: base(...)). The new base class would need constructors that pass them on, which is not supported yet.";
        }
        return null;
    }

    internal static bool IsListable(MemberDeclarationSyntax member) => member switch
    {
        MethodDeclarationSyntax m => m.ExplicitInterfaceSpecifier is null,
        PropertyDeclarationSyntax p => p.ExplicitInterfaceSpecifier is null,
        IndexerDeclarationSyntax i => i.ExplicitInterfaceSpecifier is null,
        EventDeclarationSyntax e => e.ExplicitInterfaceSpecifier is null,
        EventFieldDeclarationSyntax or FieldDeclarationSyntax or BaseTypeDeclarationSyntax or DelegateDeclarationSyntax => true,
        _ => false,
    };

    internal static IEnumerable<ISymbol> DeclaredSymbols(SemanticModel model, MemberDeclarationSyntax member)
    {
        if (member is BaseFieldDeclarationSyntax field)
        {
            return field.Declaration.Variables.Select(v => model.GetDeclaredSymbol(v)).OfType<ISymbol>();
        }
        return model.GetDeclaredSymbol(member) is { } symbol ? [symbol] : [];
    }

    /// <summary>The names in a node that stand for a symbol, with the symbol.</summary>
    internal static IEnumerable<(SimpleNameSyntax Name, ISymbol Symbol)> References(SemanticModel model, SyntaxNode node)
    {
        foreach (var name in node.DescendantNodesAndSelf().OfType<SimpleNameSyntax>())
        {
            var info = model.GetSymbolInfo(name);
            var symbol = info.Symbol ?? info.CandidateSymbols.FirstOrDefault();
            if (symbol is not null) { yield return (name, symbol); }
        }
    }

    /// <summary>A name that reaches a member of the class itself: plain (`count`) or through `this` (`this.count`), not `other.count` or `Type.Count`.</summary>
    internal static bool IsSelfAccess(SimpleNameSyntax name)
        => name.Parent switch
        {
            MemberAccessExpressionSyntax access when access.Name == name => access.Expression is ThisExpressionSyntax,
            MemberBindingExpressionSyntax => false,
            _ => true,
        };

    /// <summary>The members of this part that `member` uses by their plain name, and the reason it cannot move when it uses one of another part.</summary>
    internal static (IReadOnlyList<string> Deps, string? Blocked) DependenciesOf(SuperclassContext context, MemberDeclarationSyntax member)
    {
        var own = new Dictionary<ISymbol, string>(SymbolEqualityComparer.Default);
        foreach (var (syntax, id) in context.Members)
        {
            foreach (var symbol in DeclaredSymbols(context.Model, syntax)) { own[symbol.OriginalDefinition] = id; }
        }
        var self = context.Members.First(m => m.Syntax == member).Id;
        var deps = new List<string>();
        string? blocked = null;
        if (member.Modifiers.Any(SyntaxKind.PartialKeyword)) { blocked = "it is a partial member"; }
        foreach (var (name, symbol) in References(context.Model, member))
        {
            if (!IsSelfAccess(name) || symbol is IMethodSymbol { MethodKind: MethodKind.Constructor }) { continue; }
            if (own.TryGetValue(symbol.OriginalDefinition, out var id))
            {
                if (id != self && !deps.Contains(id)) { deps.Add(id); }
            }
            else if (SymbolEqualityComparer.Default.Equals(symbol.ContainingType?.OriginalDefinition, context.Symbol.OriginalDefinition)
                && symbol.Kind is SymbolKind.Field or SymbolKind.Method or SymbolKind.Property or SymbolKind.Event)
            {
                blocked ??= $"it uses {symbol.Name}, which is declared elsewhere in {context.Symbol.Name} (another part or a constructor)";
            }
        }
        return (deps, blocked);
    }

    /// <summary>The moved members that what stays uses (the rest of this part, other parts), and so must stay reachable from the type.</summary>
    internal static HashSet<MemberDeclarationSyntax> MovedMembersUsedElsewhere(SuperclassContext context, IReadOnlyList<MemberDeclarationSyntax> moved, CancellationToken ct)
    {
        var movedSymbols = new Dictionary<ISymbol, MemberDeclarationSyntax>(SymbolEqualityComparer.Default);
        foreach (var member in moved)
        {
            foreach (var symbol in DeclaredSymbols(context.Model, member)) { movedSymbols[symbol.OriginalDefinition] = member; }
        }
        var result = new HashSet<MemberDeclarationSyntax>();
        if (movedSymbols.Count == 0) { return result; }

        void Scan(SemanticModel model, SyntaxNode node)
        {
            foreach (var (_, symbol) in References(model, node))
            {
                if (movedSymbols.TryGetValue(symbol.OriginalDefinition, out var member)) { result.Add(member); }
            }
        }
        foreach (var member in context.Declaration.Members.Where(m => !moved.Contains(m))) { Scan(context.Model, member); }
        foreach (var reference in context.Symbol.DeclaringSyntaxReferences)
        {
            if (reference.SyntaxTree == context.Declaration.SyntaxTree && reference.Span == context.Declaration.Span) { continue; }
            Scan(context.Model.Compilation.GetSemanticModel(reference.SyntaxTree), reference.GetSyntax(ct));
        }
        return result;
    }

    internal static readonly SyntaxKind[] AccessKinds = [SyntaxKind.PublicKeyword, SyntaxKind.ProtectedKeyword, SyntaxKind.InternalKeyword, SyntaxKind.PrivateKeyword];

    /// <summary>Where a modifier can be added to a member that has none: in front of its type.</summary>
    internal static int ModifierAnchor(MemberDeclarationSyntax member)
    {
        if (member.Modifiers.Count > 0) { return member.Modifiers[0].SpanStart; }
        var first = member.AttributeLists.Count > 0 ? member.AttributeLists.Last().GetLastToken().GetNextToken() : member.GetFirstToken();
        return first.SpanStart;
    }

    /// <summary>
    /// What a member needs to be reachable from the type once it is in the base class: `private` (or nothing) becomes `protected`, and so do
    /// private accessors (`{ get; private set; }`), unless the property is protected itself, where the accessor needs no modifier.
    /// </summary>
    internal static List<(TextSpan Span, string Text)> AccessibilityEdits(SemanticModel model, MemberDeclarationSyntax member)
    {
        var edits = new List<(TextSpan, string)>();
        var access = member.Modifiers.Where(m => AccessKinds.Contains(m.Kind())).ToList();
        var wasPrivate = DeclaredSymbols(model, member).Any(s => s.DeclaredAccessibility == Accessibility.Private);
        if (wasPrivate)
        {
            edits.Add(access.Count == 0 ? (new TextSpan(ModifierAnchor(member), 0), "protected ") : (access[0].Span, "protected"));
        }
        var protectedOnly = wasPrivate || access is [{ RawKind: (int)SyntaxKind.ProtectedKeyword }];
        var accessors = member switch
        {
            PropertyDeclarationSyntax p => p.AccessorList?.Accessors,
            IndexerDeclarationSyntax i => i.AccessorList?.Accessors,
            _ => null,
        };
        foreach (var accessor in accessors ?? [])
        {
            var token = accessor.Modifiers.FirstOrDefault(m => m.IsKind(SyntaxKind.PrivateKeyword));
            if (token == default || accessor.Modifiers.Count > 1) { continue; }
            // `protected` on an accessor of a protected property is an error: the modifier goes
            edits.Add(protectedOnly ? (TextSpan.FromBounds(token.SpanStart, token.FullSpan.End), "") : (token.Span, "protected"));
        }
        return edits;
    }

    /// <summary>A member that stays as the override of an abstract declaration: `override` instead of `virtual`, at least protected.</summary>
    internal static IEnumerable<TextEdit> OverrideEdits(SourceText text, MemberDeclarationSyntax member)
    {
        var modifiers = member.Modifiers.ToList();
        var access = modifiers.Where(m => AccessKinds.Contains(m.Kind())).Select(m => m.Text).ToList();
        if (access.Count == 0 || access is ["private"]) { access = ["protected"]; }
        var rest = modifiers.Where(m => !AccessKinds.Contains(m.Kind()) && !m.IsKind(SyntaxKind.VirtualKeyword)).Select(m => m.Text);
        var written = string.Join(" ", access.Concat(["override"]).Concat(rest)) + (modifiers.Count == 0 ? " " : "");
        if (modifiers.Count == 0) { yield return PartialSupport.Insert(text, ModifierAnchor(member), written); }
        else { yield return Replace(text, TextSpan.FromBounds(modifiers[0].SpanStart, modifiers[^1].Span.End), written); }
    }

    /// <summary>The abstract declaration of a method or property (one line), or null when it cannot be made abstract.</summary>
    internal static string? AbstractDeclaration(MemberDeclarationSyntax member)
    {
        var mods = member.Modifiers;
        if (mods.Any(SyntaxKind.StaticKeyword) || mods.Any(SyntaxKind.AbstractKeyword) || mods.Any(SyntaxKind.OverrideKeyword) || mods.Any(SyntaxKind.NewKeyword)
            || mods.Any(SyntaxKind.ExternKeyword) || mods.Any(SyntaxKind.PartialKeyword) || mods.Any(SyntaxKind.SealedKeyword))
        {
            return null;
        }
        var access = mods.Where(m => AccessKinds.Contains(m.Kind())).Select(m => m.Kind()).ToList();
        if (access.Count == 0 || access is [SyntaxKind.PrivateKeyword]) { access = [SyntaxKind.ProtectedKeyword]; }
        var tokens = SyntaxFactory.TokenList(access.Select(k => SyntaxFactory.Token(k)).Append(SyntaxFactory.Token(SyntaxKind.AbstractKeyword)));
        var semicolon = SyntaxFactory.Token(SyntaxKind.SemicolonToken);
        switch (member)
        {
            // an override cannot repeat the constraints, so a generic method with them is not offered
            case MethodDeclarationSyntax { ConstraintClauses.Count: > 0 }:
                return null;
            case MethodDeclarationSyntax method:
                return method.WithAttributeLists(default).WithModifiers(tokens).WithBody(null).WithExpressionBody(null).WithSemicolonToken(semicolon).WithoutTrivia().NormalizeWhitespace().ToString();
            case PropertyDeclarationSyntax property:
                var accessors = property.AccessorList?.Accessors.ToList() ?? [SyntaxFactory.AccessorDeclaration(SyntaxKind.GetAccessorDeclaration)];
                // a private accessor cannot be abstract
                if (accessors.Any(a => a.Modifiers.Any(SyntaxKind.PrivateKeyword))) { return null; }
                var list = SyntaxFactory.AccessorList(SyntaxFactory.List(accessors.Select(a => a.WithAttributeLists(default).WithBody(null).WithExpressionBody(null).WithSemicolonToken(semicolon))));
                return property.WithAttributeLists(default).WithModifiers(tokens).WithAccessorList(list).WithExpressionBody(null).WithInitializer(null)
                    .WithSemicolonToken(default).WithoutTrivia().NormalizeWhitespace().ToString();
            default:
                return null;
        }
    }

    private static string BaseTypeText(SuperclassContext context, string baseName, string? oldBase, bool isAbstract, IReadOnlyList<string> bodies, string indent, string eol)
    {
        var declaration = context.Declaration;
        var access = declaration.Modifiers.Where(m => m.IsKind(SyntaxKind.PublicKeyword) || m.IsKind(SyntaxKind.InternalKeyword)).Select(m => m.Text);
        var modifiers = string.Join(" ", access.Concat(isAbstract ? ["abstract"] : []));
        var constraints = string.Concat(declaration.ConstraintClauses.Select(c => " " + Regex.Replace(c.ToString(), @"\s+", " ")));
        var header = $"{(modifiers.Length > 0 ? modifiers + " " : "")}class {baseName}{declaration.TypeParameterList}{(oldBase is not null ? " : " + oldBase : "")}{constraints}";

        var sb = new StringBuilder();
        sb.Append(indent).Append(header).Append(eol).Append(indent).Append('{').Append(eol);
        var inner = indent + "    ";
        for (var i = 0; i < bodies.Count; i++)
        {
            if (i > 0) { sb.Append(eol); }
            sb.Append(PartialSupport.Reindent(bodies[i], inner, eol));
        }
        sb.Append(indent).Append('}').Append(eol);
        return sb.ToString();
    }

    internal static string FileText(IReadOnlyList<UsingDirectiveSyntax> usings, BaseNamespaceDeclarationSyntax? ns, string typeText, string eol)
    {
        var sb = new StringBuilder();
        foreach (var u in usings) { sb.Append(u.ToString()).Append(eol); }
        if (usings.Count > 0) { sb.Append(eol); }
        switch (ns)
        {
            case FileScopedNamespaceDeclarationSyntax: sb.Append("namespace ").Append(ns.Name).Append(';').Append(eol).Append(eol).Append(typeText); break;
            case not null: sb.Append("namespace ").Append(ns.Name).Append(eol).Append('{').Append(eol).Append(typeText).Append('}').Append(eol); break;
            default: sb.Append(typeText); break;
        }
        return sb.ToString();
    }
}
