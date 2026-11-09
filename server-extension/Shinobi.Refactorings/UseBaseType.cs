using System.Text.Json.Serialization;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Extensions;
using Microsoft.CodeAnalysis.FindSymbols;
using Microsoft.CodeAnalysis.Text;

namespace Shinobi.Refactorings;

/// <summary>What the uses of a type may be replaced with: the new type's name and what exists on it.</summary>
internal sealed class UseTarget
{
    /// <summary>The name written in place of the type's.</summary>
    public required string Name { get; init; }
    /// <summary>Whether a member of the source type (as bound at a use) exists on the new type.</summary>
    public required Func<ISymbol, bool> Allows { get; init; }
    /// <summary>Whether a value of the new type converts to this type by itself (besides the source type itself and object).</summary>
    public required Func<ITypeSymbol, bool> FlowOk { get; init; }
}

/// <summary>The uses of the source type in one declaration (a parameter, a local variable, a private field) that can name the new type.</summary>
internal sealed class UseGroup
{
    public required Document Document { get; init; }
    public required SimpleNameSyntax Name { get; init; }
    public required string Kind { get; init; }
    /// <summary>A parameter of a method other code can call: the signature changes for them (a call still compiles; a binary reference does not).</summary>
    public required bool PublicApi { get; init; }
    public required List<UseVariable> Variables { get; init; }
    /// <summary>The name the type is replaced with; set when a target has been chosen.</summary>
    public string? NewName { get; set; }
}

internal sealed class UseVariable
{
    public required ISymbol Symbol { get; init; }
    /// <summary>Where the variable can be used: the nodes to look through, with their documents.</summary>
    public required List<(Document Document, SyntaxNode Node)> Scopes { get; init; }
}

public sealed record UseBaseTypeTarget(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("name")] string Name,
    /// <summary>"class" or "interface"</summary>
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("where")] string Where,
    /// <summary>How many declarations would name the type instead; -1 when it was not counted.</summary>
    [property: JsonPropertyName("count")] int Count,
    /// <summary>... of them parameters of methods that other code can call.</summary>
    [property: JsonPropertyName("publicCount")] int PublicCount);

public sealed record UseBaseTypeInfo(
    [property: JsonPropertyName("typeName")] string TypeName,
    [property: JsonPropertyName("targets")] IReadOnlyList<UseBaseTypeTarget> Targets,
    [property: JsonPropertyName("refusal")] string? Refusal);

public sealed record UseBaseTypeRequest(
    [property: JsonPropertyName("position")] Position Position,
    [property: JsonPropertyName("targetId")] string TargetId);

/// <summary>The base types and interfaces of the type under the cursor that its uses could name instead; no counts, so it is cheap enough for the lightbulb.</summary>
public sealed class UseBaseTypeInfoHandler : DocumentHandler<TypeAt, UseBaseTypeInfo?>
{
    public override Task<UseBaseTypeInfo?> ExecuteAsync(TypeAt message, Document document, CancellationToken cancellationToken)
        => UseBaseTypeEngine.InfoAsync(document, message.Position, withCounts: false, cancellationToken);
}

/// <summary>The same with how many declarations would name each base type (it looks through the solution for the uses).</summary>
public sealed class UseBaseTypeCountsHandler : DocumentHandler<TypeAt, UseBaseTypeInfo?>
{
    public override Task<UseBaseTypeInfo?> ExecuteAsync(TypeAt message, Document document, CancellationToken cancellationToken)
        => UseBaseTypeEngine.InfoAsync(document, message.Position, withCounts: true, cancellationToken);
}

/// <summary>Replaces the type by the chosen base type where only what the base type has is used; compiled before it is applied.</summary>
public sealed class UseBaseTypeHandler : DocumentHandler<UseBaseTypeRequest, ExtractInterfaceResult?>
{
    public override Task<ExtractInterfaceResult?> ExecuteAsync(UseBaseTypeRequest message, Document document, CancellationToken cancellationToken)
        => UseBaseTypeEngine.RunAsync(document, message, cancellationToken);
}

/// <summary>
/// "Use base type where possible": a use of a type in a parameter, a local variable or a private field names a base type or an
/// interface instead when everything done with the value exists there. Conservative: a variable that is cast, tested with `is`,
/// passed by `ref`/`out`, returned, enumerated, passed to something that needs the type, or used through a member the new type
/// lacks keeps the type. What is left is compiled on a copy of the solution; replacements that add errors are dropped.
/// </summary>
public static class UseBaseTypeEngine
{
    private static readonly SymbolEqualityComparer Same = SymbolEqualityComparer.Default;

    // ---- the standalone refactoring ----

    public static async Task<UseBaseTypeInfo?> InfoAsync(Document document, Position position, bool withCounts, CancellationToken ct)
    {
        var found = await ExtractInterfaceSupport.FindTypeAsync(document, position, ct).ConfigureAwait(false);
        if (found is null) { return null; }
        var source = found.Value.Symbol;
        if (Refusal(source) is { } refusal) { return new UseBaseTypeInfo(source.Name, [], refusal); }
        var targets = new List<UseBaseTypeTarget>();
        foreach (var (type, kind) in Targets(document, source))
        {
            var groups = withCounts ? await PlanAsync(document, source, ForExisting(document, source, type), ct).ConfigureAwait(false) : [];
            targets.Add(new UseBaseTypeTarget(IdOf(type), type.Name, kind, WhereOf(document, type), withCounts ? groups.Count : -1, groups.Count(g => g.PublicApi)));
        }
        return new UseBaseTypeInfo(source.Name, targets, targets.Count == 0 ? $"{source.Name} has no base class or interface declared in this solution's source to use instead." : null);
    }

    public static async Task<ExtractInterfaceResult?> RunAsync(Document document, UseBaseTypeRequest request, CancellationToken ct)
    {
        var found = await ExtractInterfaceSupport.FindTypeAsync(document, request.Position, ct).ConfigureAwait(false);
        if (found is null) { return null; }
        var source = found.Value.Symbol;
        if (Refusal(source) is { } refusal) { throw new InvalidOperationException(refusal); }
        var target = Targets(document, source).Select(t => t.Type).FirstOrDefault(t => IdOf(t) == request.TargetId)
            ?? throw new InvalidOperationException("The target is no longer a base type of this type; try again.");
        var groups = await PlanAsync(document, source, ForExisting(document, source, target), ct).ConfigureAwait(false);
        if (groups.Count == 0) { throw new InvalidOperationException($"No use of {source.Name} can name {target.Name} instead: they all use something only {source.Name} has."); }
        var empty = new ExtractInterfaceResult([], null, null);
        return await ChooseAsync(document, empty, groups, source.Name, target.Name, ct).ConfigureAwait(false);
    }

    private static string? Refusal(INamedTypeSymbol source)
    {
        if (source.IsGenericType) { return $"{source.Name} is generic: its uses would need the base type's type arguments, which is not supported yet."; }
        if (source.GetMembers().Any(m => m is IMethodSymbol { MethodKind: MethodKind.UserDefinedOperator or MethodKind.Conversion }))
        {
            return $"{source.Name} defines operators or conversions, which a base type would not have.";
        }
        return null;
    }

    private static IEnumerable<(INamedTypeSymbol Type, string Kind)> Targets(Document document, INamedTypeSymbol source)
    {
        for (var b = source.BaseType; b is not null && b.SpecialType != SpecialType.System_Object; b = b.BaseType)
        {
            if (IsSource(document, b)) { yield return (b, "class"); }
        }
        foreach (var i in source.AllInterfaces)
        {
            if (IsSource(document, i)) { yield return (i, "interface"); }
        }
    }

    private static bool IsSource(Document document, INamedTypeSymbol type)
        => !type.IsGenericType && type.DeclaringSyntaxReferences.Any(r => document.Project.Solution.GetDocument(r.SyntaxTree) is { FilePath: not null });

    private static string IdOf(INamedTypeSymbol type) => type.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat);

    private static string WhereOf(Document document, INamedTypeSymbol type)
    {
        var tree = type.DeclaringSyntaxReferences.FirstOrDefault()?.SyntaxTree;
        var target = tree is null ? null : document.Project.Solution.GetDocument(tree);
        return target is null ? "" : $"{Path.GetFileName(target.FilePath)} ({target.Project.Name})";
    }

    // ---- what the new type has ----

    private static ISymbol? Overridden(ISymbol member) => member switch
    {
        IMethodSymbol m => m.OverriddenMethod,
        IPropertySymbol p => p.OverriddenProperty,
        IEventSymbol e => e.OverriddenEvent,
        _ => null,
    };

    /// <summary>Members of object (or overriding them): every type has them.</summary>
    private static bool IsObjectMember(ISymbol member)
    {
        for (var m = member; m is not null; m = Overridden(m))
        {
            if (m.ContainingType?.SpecialType == SpecialType.System_Object) { return true; }
        }
        return false;
    }

    /// <summary>A new interface that gets the chosen members.</summary>
    internal static UseTarget ForNewInterface(string name, IEnumerable<ISymbol> chosen)
    {
        var set = new HashSet<ISymbol>(chosen.Select(s => s.OriginalDefinition), Same);
        return new UseTarget { Name = name, Allows = s => set.Contains(s.OriginalDefinition) || IsObjectMember(s), FlowOk = _ => false };
    }

    /// <summary>A new base class that gets the chosen members and inherits what the source type's own base class has.</summary>
    internal static UseTarget ForNewBaseClass(string name, INamedTypeSymbol source, IEnumerable<ISymbol> chosen)
    {
        var set = new HashSet<ISymbol>(chosen.Select(s => s.OriginalDefinition), Same);
        var chain = new HashSet<ISymbol>(Same);
        for (var b = source.BaseType; b is not null; b = b.BaseType) { chain.Add(b.OriginalDefinition); }
        return new UseTarget
        {
            Name = name,
            Allows = s =>
            {
                if (set.Contains(s.OriginalDefinition) || IsObjectMember(s)) { return true; }
                for (var m = s.OriginalDefinition; m is not null; m = Overridden(m)?.OriginalDefinition)
                {
                    if (m.ContainingType is { } t && chain.Contains(t.OriginalDefinition)) { return true; }
                }
                return false;
            },
            FlowOk = type => chain.Contains(type.OriginalDefinition),
        };
    }

    /// <summary>A base class or interface that exists already.</summary>
    private static UseTarget ForExisting(Document document, INamedTypeSymbol source, INamedTypeSymbol existing)
    {
        var members = new HashSet<ISymbol>(Same);
        var implementing = new HashSet<ISymbol>(Same);
        if (existing.TypeKind == TypeKind.Interface)
        {
            foreach (var type in existing.AllInterfaces.Prepend(existing))
            {
                foreach (var member in type.GetMembers())
                {
                    members.Add(member.OriginalDefinition);
                    if (source.FindImplementationForInterfaceMember(member) is { } implementation) { implementing.Add(implementation.OriginalDefinition); }
                }
            }
        }
        else
        {
            for (var type = existing; type is not null; type = type.BaseType)
            {
                foreach (var member in type.GetMembers()) { members.Add(member.OriginalDefinition); }
            }
        }
        var compilation = document.Project.GetCompilationAsync().GetAwaiter().GetResult();
        return new UseTarget
        {
            Name = existing.Name,
            Allows = s =>
            {
                if (IsObjectMember(s) || implementing.Contains(s.OriginalDefinition)) { return true; }
                for (var m = s.OriginalDefinition; m is not null; m = Overridden(m)?.OriginalDefinition)
                {
                    if (members.Contains(m)) { return true; }
                }
                return false;
            },
            FlowOk = type =>
            {
                try { return compilation is not null && compilation.ClassifyConversion(existing, type).IsImplicit; }
                catch { return false; }
            },
        };
    }

    // ---- finding the uses ----

    /// <summary>The declarations of the solution that name the source type and could name the new one, as far as what is done with them goes.</summary>
    internal static async Task<List<UseGroup>> PlanAsync(Document origin, INamedTypeSymbol source, UseTarget target, CancellationToken ct)
    {
        if (Refusal(source) is not null && !source.IsGenericType) { return []; }
        var solution = origin.Project.Solution;
        var references = await SymbolFinder.FindReferencesAsync(source, solution, ct).ConfigureAwait(false);
        var own = source.DeclaringSyntaxReferences.Select(r => (r.SyntaxTree, r.Span)).ToList();
        var models = new Dictionary<SyntaxTree, SemanticModel>();
        async Task<SemanticModel> ModelOf(Document document)
        {
            var tree = (await document.GetSyntaxTreeAsync(ct).ConfigureAwait(false))!;
            if (!models.TryGetValue(tree, out var model))
            {
                model = (await document.GetSemanticModelAsync(ct).ConfigureAwait(false))!;
                models[tree] = model;
            }
            return model;
        }

        var groups = new Dictionary<SyntaxNode, UseGroup>();
        foreach (var location in references.SelectMany(r => r.Locations))
        {
            if (location.IsImplicit || location.Alias is not null) { continue; }
            var document = location.Document;
            if (document.FilePath is null || IsGenerated(document.FilePath)) { continue; }
            var tree = location.Location.SourceTree;
            var span = location.Location.SourceSpan;
            // what the type itself does with itself is not touched (the extraction rewrites it)
            if (tree is null || own.Any(o => o.SyntaxTree == tree && o.Span.Contains(span))) { continue; }
            var root = await tree.GetRootAsync(ct).ConfigureAwait(false);
            if (root.FindNode(span, getInnermostNodeForTie: true).AncestorsAndSelf().OfType<SimpleNameSyntax>().FirstOrDefault(n => n.Identifier.Span == span) is not { } name) { continue; }

            TypeSyntax outer = name;
            while (outer.Parent is QualifiedNameSyntax q && q.Right == outer) { outer = q; }
            if (outer.Parent is NullableTypeSyntax nullable) { outer = nullable; }
            if (groups.ContainsKey(outer)) { continue; }
            var model = await ModelOf(document).ConfigureAwait(false);
            var group = Declare(solution, document, model, name, outer, ct);
            if (group is not null) { groups[outer] = group; }
        }

        // what is done with each variable decides whether its declaration can name the new type
        var candidates = new Dictionary<ISymbol, UseGroup>(Same);
        foreach (var group in groups.Values) { foreach (var variable in group.Variables) { candidates[variable.Symbol] = group; } }
        var needs = new Dictionary<UseGroup, HashSet<ISymbol>>();
        foreach (var group in groups.Values)
        {
            var dependencies = new HashSet<ISymbol>(Same);
            if (await EvaluateAsync(group, source, target, candidates, dependencies, ModelOf, ct).ConfigureAwait(false)) { needs[group] = dependencies; }
        }
        // a variable passed on to another one needs that one to change as well
        for (var changed = true; changed;)
        {
            changed = false;
            foreach (var group in needs.Keys.ToList())
            {
                if (needs[group].Any(d => !candidates.TryGetValue(d, out var other) || !needs.ContainsKey(other)))
                {
                    needs.Remove(group);
                    changed = true;
                }
            }
        }
        var planned = needs.Keys.OrderBy(g => g.Document.FilePath, StringComparer.OrdinalIgnoreCase).ThenBy(g => g.Name.SpanStart).ToList();
        foreach (var group in planned) { group.NewName = target.Name; }
        return planned;
    }

    private static bool IsGenerated(string path)
        => path.EndsWith(".g.cs", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".designer.cs", StringComparison.OrdinalIgnoreCase) || path.EndsWith(".g.i.cs", StringComparison.OrdinalIgnoreCase);

    /// <summary>The declaration this use of the type is in, when it is of a kind we change.</summary>
    private static UseGroup? Declare(Solution solution, Document document, SemanticModel model, SimpleNameSyntax name, TypeSyntax outer, CancellationToken ct)
    {
        switch (outer.Parent)
        {
            case ParameterSyntax { Modifiers.Count: 0 } parameter when parameter.Type == outer && parameter.Parent is ParameterListSyntax list:
            {
                var scopes = new List<SyntaxNode>();
                IMethodSymbol? method;
                switch (list.Parent)
                {
                    case MethodDeclarationSyntax m: method = model.GetDeclaredSymbol(m, ct); AddBodies(scopes, m.Body, m.ExpressionBody); break;
                    case ConstructorDeclarationSyntax c: method = model.GetDeclaredSymbol(c, ct); AddBodies(scopes, c.Body, c.ExpressionBody); if (c.Initializer is not null) { scopes.Add(c.Initializer); } break;
                    case LocalFunctionStatementSyntax f: method = model.GetDeclaredSymbol(f, ct) as IMethodSymbol; AddBodies(scopes, f.Body, f.ExpressionBody); break;
                    default: return null;
                }
                if (method is null || scopes.Count == 0 || !MayChangeSignature(method)) { return null; }
                if (model.GetDeclaredSymbol(parameter, ct) is not { } symbol) { return null; }
                return new UseGroup
                {
                    Document = document, Name = name, Kind = "parameter", PublicApi = list.Parent is not LocalFunctionStatementSyntax && IsExternallyVisible(method),
                    Variables = [new UseVariable { Symbol = symbol, Scopes = scopes.Select(s => (document, s)).ToList() }],
                };
            }
            case VariableDeclarationSyntax declaration when declaration.Type == outer:
                switch (declaration.Parent)
                {
                    case LocalDeclarationStatementSyntax { UsingKeyword.RawKind: 0, Modifiers.Count: 0 } local:
                    {
                        var scope = (SyntaxNode?)local.Parent;
                        if (scope is null) { return null; }
                        var variables = declaration.Variables.Select(v => model.GetDeclaredSymbol(v, ct)).OfType<ISymbol>()
                            .Select(s => new UseVariable { Symbol = s, Scopes = [(document, scope)] }).ToList();
                        return variables.Count == 0 ? null : new UseGroup { Document = document, Name = name, Kind = "local", PublicApi = false, Variables = variables };
                    }
                    case FieldDeclarationSyntax { Modifiers: var modifiers } field when !modifiers.Any(SyntaxKind.ConstKeyword):
                    {
                        var symbols = declaration.Variables.Select(v => model.GetDeclaredSymbol(v, ct)).OfType<IFieldSymbol>().ToList();
                        if (symbols.Count == 0 || symbols.Any(s => s.DeclaredAccessibility != Accessibility.Private) || symbols[0].ContainingType is not { } type) { return null; }
                        var scopes = new List<(Document, SyntaxNode)>();
                        foreach (var reference in type.DeclaringSyntaxReferences)
                        {
                            if (solution.GetDocument(reference.SyntaxTree) is { } d) { scopes.Add((d, reference.GetSyntax(ct))); }
                        }
                        return new UseGroup
                        {
                            Document = document, Name = name, Kind = "field", PublicApi = false,
                            Variables = symbols.Select(s => new UseVariable { Symbol = s, Scopes = scopes }).ToList(),
                        };
                    }
                }
                return null;
            default:
                return null;
        }
    }

    private static void AddBodies(List<SyntaxNode> scopes, params SyntaxNode?[] nodes) => scopes.AddRange(nodes.OfType<SyntaxNode>());

    /// <summary>A method whose parameters can change without breaking an override, an implementation or a partial declaration.</summary>
    private static bool MayChangeSignature(IMethodSymbol method)
    {
        if (method.IsOverride || method.IsVirtual || method.IsAbstract || method.IsExtern || method.IsPartialDefinition || method.PartialDefinitionPart is not null
            || method.ExplicitInterfaceImplementations.Length > 0 || method.IsExtensionMethod)
        {
            return false;
        }
        if (method.ContainingType is { } type)
        {
            foreach (var interfaceMember in type.AllInterfaces.SelectMany(i => i.GetMembers().OfType<IMethodSymbol>()))
            {
                if (Same.Equals(type.FindImplementationForInterfaceMember(interfaceMember), method)) { return false; }
            }
        }
        return true;
    }

    private static bool IsExternallyVisible(ISymbol symbol)
    {
        for (var s = symbol; s is not null; s = s.ContainingType)
        {
            if (s.DeclaredAccessibility is not (Accessibility.Public or Accessibility.Protected or Accessibility.ProtectedOrInternal)) { return false; }
        }
        return true;
    }

    // ---- what is done with a variable ----

    private static async Task<bool> EvaluateAsync(UseGroup group, INamedTypeSymbol source, UseTarget target, Dictionary<ISymbol, UseGroup> candidates,
        HashSet<ISymbol> dependencies, Func<Document, Task<SemanticModel>> modelOf, CancellationToken ct)
    {
        foreach (var variable in group.Variables)
        {
            foreach (var (document, scope) in variable.Scopes)
            {
                var model = await modelOf(document).ConfigureAwait(false);
                foreach (var id in scope.DescendantNodesAndSelf().OfType<IdentifierNameSyntax>())
                {
                    if (id.Identifier.ValueText != variable.Symbol.Name || !Same.Equals(model.GetSymbolInfo(id, ct).Symbol, variable.Symbol)) { continue; }
                    if (!UseIsFine(id, model, source, target, candidates, dependencies, ct)) { return false; }
                }
            }
        }
        return true;
    }

    private static bool UseIsFine(IdentifierNameSyntax id, SemanticModel model, INamedTypeSymbol source, UseTarget target,
        Dictionary<ISymbol, UseGroup> candidates, HashSet<ISymbol> dependencies, CancellationToken ct)
    {
        // (x) and x! are the value as well
        ExpressionSyntax value = id;
        while (value.Parent is ParenthesizedExpressionSyntax or PostfixUnaryExpressionSyntax { RawKind: (int)SyntaxKind.SuppressNullableWarningExpression })
        {
            value = (ExpressionSyntax)value.Parent;
        }
        var parent = value.Parent;

        // nameof(x)
        if (parent is ArgumentSyntax { Parent: ArgumentListSyntax { Parent: InvocationExpressionSyntax { Expression: IdentifierNameSyntax { Identifier.ValueText: "nameof" } } } }) { return true; }

        // x.Member: the member has to exist on the new type
        if (parent is MemberAccessExpressionSyntax access && access.Expression == value)
        {
            var info = model.GetSymbolInfo(access, ct);
            return info.Symbol is { } member && target.Allows(member);
        }
        if (parent is ConditionalAccessExpressionSyntax conditional && conditional.Expression == value)
        {
            var binding = conditional.WhenNotNull.DescendantNodesAndSelf().OfType<MemberBindingExpressionSyntax>().OrderBy(b => b.SpanStart).FirstOrDefault();
            return binding is not null && model.GetSymbolInfo(binding, ct).Symbol is { } member && target.Allows(member);
        }

        // x = value: the value is a source type or a subtype of it, which converts
        if (parent is AssignmentExpressionSyntax assignment && assignment.Left == value) { return assignment.IsKind(SyntaxKind.SimpleAssignmentExpression); }

        // x == null, x != null, x is null, x is not null
        if (parent is BinaryExpressionSyntax binary && binary.Kind() is SyntaxKind.EqualsExpression or SyntaxKind.NotEqualsExpression)
        {
            var other = binary.Left == value ? binary.Right : binary.Left;
            return other.IsKind(SyntaxKind.NullLiteralExpression) || Same.Equals(model.GetTypeInfo(other, ct).Type, source);
        }
        if (parent is IsPatternExpressionSyntax { Pattern: var pattern } && IsNullPattern(pattern)) { return true; }

        // anything else is the value going somewhere: where to, decides
        var converted = model.GetTypeInfo(value, ct).ConvertedType;
        if (converted is null || converted.TypeKind == TypeKind.Error) { return false; }
        if (Same.Equals(converted, source))
        {
            // it goes into a place of the source type: only when that place changes as well
            switch (parent)
            {
                case ArgumentSyntax { Parent: ArgumentListSyntax { Parent: { } call } } argument:
                    return ParameterOf(model, call, argument, ct) is { } parameter && Depend(parameter);
                case EqualsValueClauseSyntax { Parent: VariableDeclaratorSyntax declarator }:
                    return model.GetDeclaredSymbol(declarator, ct) is { } declared && Depend(declared);
                case AssignmentExpressionSyntax { Right: var right } assign when right == value:
                    return model.GetSymbolInfo(assign.Left, ct).Symbol is { } left && Depend(left);
                default:
                    return false;
            }
        }
        return converted.SpecialType == SpecialType.System_Object || target.FlowOk(converted);

        bool Depend(ISymbol symbol)
        {
            if (!candidates.ContainsKey(symbol.OriginalDefinition) && !candidates.ContainsKey(symbol)) { return false; }
            dependencies.Add(candidates.ContainsKey(symbol) ? symbol : symbol.OriginalDefinition);
            return true;
        }
    }

    private static bool IsNullPattern(PatternSyntax pattern) => pattern switch
    {
        ConstantPatternSyntax { Expression: var e } => e.IsKind(SyntaxKind.NullLiteralExpression),
        UnaryPatternSyntax { Pattern: var inner } => IsNullPattern(inner),
        _ => false,
    };

    private static IParameterSymbol? ParameterOf(SemanticModel model, SyntaxNode call, ArgumentSyntax argument, CancellationToken ct)
    {
        if (model.GetSymbolInfo(call, ct).Symbol is not IMethodSymbol method || argument.RefKindKeyword != default) { return null; }
        var parameters = method.OriginalDefinition.Parameters;
        if (argument.NameColon is { } colon) { return parameters.FirstOrDefault(p => p.Name == colon.Name.Identifier.ValueText); }
        var index = ((BaseArgumentListSyntax)argument.Parent!).Arguments.IndexOf(argument);
        return index < parameters.Length && !parameters[index].IsParams ? parameters[index] : null;
    }

    // ---- applying the changes ----

    /// <summary>The result with the uses added; those that make the code not compile are left out. The result is compiled in any case.</summary>
    internal static async Task<ExtractInterfaceResult> ChooseAsync(Document document, ExtractInterfaceResult result, IReadOnlyList<UseGroup> groups, string sourceName, string newName, CancellationToken ct)
    {
        if (groups.Count == 0) { return await RefactoringValidator.CheckAsync(document, result, ct).ConfigureAwait(false); }
        var everything = await WithAsync(document, result, groups, ct).ConfigureAwait(false);
        var errors = await RefactoringValidator.NewErrorsAsync(document, everything, ct).ConfigureAwait(false);
        if (errors.Count == 0) { return Summarized(everything, groups, sourceName, newName); }

        // is it the refactoring itself that does not compile?
        var plain = await RefactoringValidator.CheckAsync(document, result, ct).ConfigureAwait(false);
        if (plain.Errors is { Count: > 0 }) { return plain; }

        // find the part of the uses that compiles: halves, with a limited number of compilations
        var accepted = new List<UseGroup>();
        var budget = 10;
        async Task Resolve(List<UseGroup> candidates)
        {
            if (candidates.Count == 0 || budget <= 0) { return; }
            budget--;
            var trial = await WithAsync(document, result, accepted.Concat(candidates).ToList(), ct).ConfigureAwait(false);
            if ((await RefactoringValidator.NewErrorsAsync(document, trial, ct).ConfigureAwait(false)).Count == 0) { accepted.AddRange(candidates); return; }
            if (candidates.Count == 1) { return; }
            var half = candidates.Count / 2;
            await Resolve(candidates.Take(half).ToList()).ConfigureAwait(false);
            await Resolve(candidates.Skip(half).ToList()).ConfigureAwait(false);
        }
        await Resolve(groups.ToList()).ConfigureAwait(false);
        if (accepted.Count == 0) { return plain with { Summary = $"No use of {sourceName} could name {newName} without errors, so none was changed." }; }
        var final = await WithAsync(document, result, accepted, ct).ConfigureAwait(false);
        return Summarized(final, accepted, sourceName, newName);
    }

    private static ExtractInterfaceResult Summarized(ExtractInterfaceResult result, IReadOnlyList<UseGroup> groups, string sourceName, string newName)
    {
        var publicCount = groups.Count(g => g.PublicApi);
        var summary = $"{newName} is used instead of {sourceName} in {groups.Count} place{(groups.Count == 1 ? "" : "s")}"
            + (publicCount > 0 ? $", {publicCount} of them in the parameters of public methods (their signatures changed)." : ".");
        return result with { Summary = summary };
    }

    private static async Task<ExtractInterfaceResult> WithAsync(Document origin, ExtractInterfaceResult result, IReadOnlyList<UseGroup> groups, CancellationToken ct)
    {
        var edits = result.Edits.ToList();
        var others = (result.Others ?? []).ToDictionary(o => o.Path, o => o.Edits.ToList(), StringComparer.OrdinalIgnoreCase);
        foreach (var group in groups)
        {
            var text = await group.Document.GetTextAsync(ct).ConfigureAwait(false);
            var start = text.Lines.GetLinePosition(group.Name.Identifier.SpanStart);
            var end = text.Lines.GetLinePosition(group.Name.Identifier.Span.End);
            var edit = new TextEdit(start.Line, start.Character, end.Line, end.Character, group.NewName ?? throw new InvalidOperationException("The group has no target name."));
            if (group.Document.Id == origin.Id) { edits.Add(edit); }
            else
            {
                if (!others.TryGetValue(group.Document.FilePath!, out var list)) { others[group.Document.FilePath!] = list = []; }
                list.Add(edit);
            }
        }
        return result with { Edits = edits, Others = others.Count == 0 ? null : others.Select(o => new FileEdits(o.Key, o.Value)).ToList() };
    }
}
