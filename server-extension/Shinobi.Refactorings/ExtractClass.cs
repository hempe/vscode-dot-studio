using System.Text;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Extensions;
using Microsoft.CodeAnalysis.Text;

namespace Shinobi.Refactorings;

public sealed record ExtractClassInfo(
    [property: JsonPropertyName("typeName")] string TypeName,
    [property: JsonPropertyName("className")] string ClassName,
    [property: JsonPropertyName("members")] IReadOnlyList<SuperclassMember> Members,
    /// <summary>Set when the refactoring cannot be done on this type; the form is not opened, the message is shown.</summary>
    [property: JsonPropertyName("refusal")] string? Refusal);

public sealed record ExtractClassRequest(
    [property: JsonPropertyName("position")] Position Position,
    [property: JsonPropertyName("className")] string ClassName,
    [property: JsonPropertyName("memberIds")] IReadOnlyList<string> MemberIds,
    [property: JsonPropertyName("newFile")] bool NewFile);

/// <summary>The members of the class under the cursor that can go into a new class it delegates to, with what they depend on.</summary>
public sealed class ExtractClassInfoHandler : DocumentHandler<TypeAt, ExtractClassInfo?>
{
    public override Task<ExtractClassInfo?> ExecuteAsync(TypeAt message, Document document, CancellationToken cancellationToken)
        => ExtractClassEngine.InfoAsync(document, message.Position, cancellationToken);
}

/// <summary>Creates the class with the chosen members, keeps a field of it in the type and forwarding members for what others could reach; refuses what it cannot do right.</summary>
public sealed class ExtractClassHandler : DocumentHandler<ExtractClassRequest, ExtractInterfaceResult?>
{
    public override Task<ExtractInterfaceResult?> ExecuteAsync(ExtractClassRequest message, Document document, CancellationToken cancellationToken)
        => ExtractClassEngine.RunAsync(document, message, cancellationToken);
}

/// <summary>
/// Extract Class (Rider's): the chosen members move to a new class. The type gets a private readonly field of it, uses of the moved members
/// inside the type go through the field, and every moved member that was reachable from outside stays as a one-line forwarding member, so no
/// caller changes. Moved members that use what stays reach it through a reference to the type (a constructor parameter); what they would
/// need but cannot reach (private, protected) has to move too. The result is compiled before it is applied.
/// </summary>
public static class ExtractClassEngine
{
    private const string Owner = "_owner";

    public static async Task<ExtractClassInfo?> InfoAsync(Document document, Position position, CancellationToken ct)
    {
        var context = await AnalyzeAsync(document, position, ct).ConfigureAwait(false);
        if (context is null) { return null; }
        var className = context.Symbol.Name + "Helper";
        if (context.Refusal is not null) { return new ExtractClassInfo(context.Symbol.Name, className, [], context.Refusal); }

        var members = new List<SuperclassMember>();
        foreach (var (syntax, id) in context.Members)
        {
            var (deps, blocked) = Analyze(context, syntax);
            members.Add(new SuperclassMember(id, PartialSupport.KindOf(syntax), PartialSupport.HeaderOf(syntax), false, deps, blocked, null));
        }
        return new ExtractClassInfo(context.Symbol.Name, className, members, null);
    }

    public static async Task<ExtractInterfaceResult?> RunAsync(Document document, ExtractClassRequest request, CancellationToken ct)
    {
        var context = await AnalyzeAsync(document, request.Position, ct).ConfigureAwait(false);
        if (context is null) { return null; }
        if (context.Refusal is not null) { throw new InvalidOperationException(context.Refusal); }
        if (document.FilePath is not { } path) { return null; }

        var className = request.ClassName;
        var typeName = context.Symbol.Name;
        if (!SyntaxFacts.IsValidIdentifier(className) || className == typeName)
        {
            throw new InvalidOperationException($"'{className}' is not a valid name for the new class.");
        }
        var byId = context.Members.ToDictionary(m => m.Id, m => m.Syntax);
        var chosen = new HashSet<string>(request.MemberIds);
        if (chosen.Count == 0) { return null; }
        if (chosen.Any(id => !byId.ContainsKey(id))) { throw new InvalidOperationException("The file changed since the members were listed; try again."); }

        var ordered = context.Members.Where(m => chosen.Contains(m.Id)).ToList();
        foreach (var (syntax, _) in ordered)
        {
            var (deps, blocked) = Analyze(context, syntax);
            if (blocked is not null) { throw new InvalidOperationException($"'{PartialSupport.HeaderOf(syntax)}' cannot move: {blocked}."); }
            var missing = deps.Where(d => !chosen.Contains(d)).Select(d => $"'{PartialSupport.HeaderOf(byId[d])}'").ToList();
            if (missing.Count > 0)
            {
                throw new InvalidOperationException($"'{PartialSupport.HeaderOf(syntax)}' uses {string.Join(", ", missing)}, which stays in {typeName} and is not reachable from {className}; move it as well.");
            }
        }

        var text = context.Text;
        var eol = text.ToString().Contains("\r\n") ? "\r\n" : "\n";
        var declaration = context.Declaration;
        var moved = ordered.Select(m => m.Syntax).ToList();

        var movedSymbols = new Dictionary<ISymbol, bool>(SymbolEqualityComparer.Default);
        foreach (var member in moved)
        {
            foreach (var symbol in ExtractSuperclassEngine.DeclaredSymbols(context.Model, member)) { movedSymbols[symbol.OriginalDefinition] = symbol.IsStatic; }
        }
        var needsInstance = movedSymbols.Values.Any(isStatic => !isStatic);
        var allStatic = !needsInstance;

        var fieldName = "_" + char.ToLowerInvariant(className[0]) + className[1..];
        if (needsInstance && declaration.Members.Any(m => ExtractSuperclassEngine.DeclaredSymbols(context.Model, m).Any(s => s.Name == fieldName)))
        {
            throw new InvalidOperationException($"{typeName} already has a member named {fieldName}.");
        }

        // the moved members: what they use of the type reaches it through the owner (instance) or its name (static)
        var needsOwner = false;
        var usedElsewhere = ExtractSuperclassEngine.MovedMembersUsedElsewhere(context, moved, ct);
        var bodies = new List<string>();
        foreach (var (syntax, _) in ordered)
        {
            var adjustments = new List<(TextSpan Span, string Text)>(AccessEdits(context.Model, syntax, usedElsewhere.Contains(syntax)));
            adjustments.AddRange(PrefixEdits(context.Model, syntax, symbol =>
            {
                if (movedSymbols.ContainsKey(symbol.OriginalDefinition)) { return null; }
                if (!SymbolEqualityComparer.Default.Equals(symbol.ContainingType?.OriginalDefinition, context.Symbol.OriginalDefinition)) { return null; }
                if (symbol.IsStatic) { return typeName + "."; }
                needsOwner = true;
                return Owner + ".";
            }));
            bodies.Add(PartialSupport.TextOf(text, syntax, eol, adjustments));
        }

        var edits = new List<TextEdit>();
        // members that nobody outside could reach leave the type; the others stay as forwarding members
        var removed = moved.Where(m => IsPrivate(context.Model, m)).ToList();
        edits.AddRange(PartialSupport.RemovalEdits(text, removed));
        foreach (var member in moved.Except(removed))
        {
            edits.Add(ExtractSuperclassEngine.Replace(text, member.Span, Forwarders(member, fieldName, className, eol, ExtractInterfaceSupport.IndentOf(text, member))));
        }

        // what stays uses the moved members through the field (or the class, for static ones)
        foreach (var member in declaration.Members.Where(m => !moved.Contains(m)))
        {
            foreach (var (span, newText) in PrefixEdits(context.Model, member, symbol =>
                movedSymbols.TryGetValue(symbol.OriginalDefinition, out var isStatic) ? (isStatic ? className + "." : fieldName + ".") : null))
            {
                edits.Add(span.Length == 0 ? PartialSupport.Insert(text, span.Start, newText) : ExtractSuperclassEngine.Replace(text, span, newText));
            }
        }

        // the field, created where the type is (field initializer) or in every constructor (it needs `this`)
        var indent = ExtractInterfaceSupport.IndentOf(text, declaration);
        if (needsInstance)
        {
            var field = $"{indent}    private readonly {className} {fieldName}{(needsOwner ? "" : $" = new {className}()")};";
            var constructors = declaration.Members.OfType<ConstructorDeclarationSyntax>().Where(c => !c.Modifiers.Any(SyntaxKind.StaticKeyword)).ToList();
            var extra = "";
            if (needsOwner)
            {
                if (constructors.Count == 0)
                {
                    var access = declaration.Modifiers.Any(SyntaxKind.AbstractKeyword) ? "protected" : "public";
                    extra = $"{eol}{eol}{indent}    {access} {typeName}(){eol}{indent}    {{{eol}{indent}        {fieldName} = new {className}(this);{eol}{indent}    }}";
                }
                foreach (var constructor in constructors)
                {
                    if (constructor.Initializer is { ThisOrBaseKeyword.RawKind: (int)SyntaxKind.ThisKeyword }) { continue; }
                    if (constructor.Body is not { } body)
                    {
                        throw new InvalidOperationException($"The constructor {typeName}(...) has an expression body; the field of {className} cannot be created in it.");
                    }
                    var statement = $"{fieldName} = new {className}(this);";
                    if (body.Statements.Count == 0 && text.Lines.GetLineFromPosition(body.OpenBraceToken.SpanStart).LineNumber == text.Lines.GetLineFromPosition(body.CloseBraceToken.SpanStart).LineNumber)
                    {
                        // `{ }` on one line becomes a body of its own lines
                        edits.Add(ExtractSuperclassEngine.Replace(text, TextSpan.FromBounds(body.OpenBraceToken.Span.End, body.CloseBraceToken.SpanStart), $"{eol}{indent}        {statement}{eol}{indent}    "));
                    }
                    else
                    {
                        edits.Add(PartialSupport.Insert(text, body.OpenBraceToken.Span.End, $"{eol}{indent}        {statement}"));
                    }
                }
            }
            edits.Add(PartialSupport.Insert(text, declaration.OpenBraceToken.Span.End, eol + field + extra + eol));
        }

        // the new class
        var usings = PartialSupport.NeededUsings(context.Root, context.Model, moved, ct);
        var ns = declaration.Ancestors().OfType<BaseNamespaceDeclarationSyntax>().FirstOrDefault();
        PartialSupport.RefuseExisting(document, context.Symbol, className, request.NewFile ? Path.Combine(Path.GetDirectoryName(path)!, className + ".cs") : null);
        string? newPath = null;
        string? newContent = null;
        if (request.NewFile)
        {
            var typeText = ClassText(declaration, className, typeName, allStatic, needsOwner, bodies, ns is NamespaceDeclarationSyntax ? "    " : "", eol);
            newPath = Path.Combine(Path.GetDirectoryName(path)!, className + ".cs");
            newContent = ExtractSuperclassEngine.FileText(usings, ns, typeText, eol);
        }
        else
        {
            var typeText = ClassText(declaration, className, typeName, allStatic, needsOwner, bodies, indent, eol);
            edits.Add(PartialSupport.Insert(text, ExtractInterfaceSupport.LineStartBefore(text, declaration), typeText + eol));
        }
        var result = new ExtractInterfaceResult(edits, newPath, newContent);
        return await RefactoringValidator.CheckAsync(document, result, ct).ConfigureAwait(false);
    }

    // ---- analysis

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
            if (ExtractSuperclassEngine.IsListable(declaration.Members[i])) { members.Add((declaration.Members[i], PartialSupport.IdOf(declaration.Members[i], i))); }
        }
        return new SuperclassContext
        {
            Document = document, Declaration = declaration, Symbol = symbol, Model = model, Root = root, Text = text, Members = members,
            Refusal = RefusalOf(declaration, symbol),
        };
    }

    private static string? RefusalOf(ClassDeclarationSyntax declaration, INamedTypeSymbol symbol)
    {
        if (declaration.Parent is TypeDeclarationSyntax) { return $"{symbol.Name} is a nested type: the new class would have to be nested too, which is not supported."; }
        if (declaration.TypeParameterList is not null) { return $"{symbol.Name} is generic: generic classes are not supported."; }
        if (declaration.Modifiers.Any(SyntaxKind.PartialKeyword) || symbol.DeclaringSyntaxReferences.Length > 1) { return $"{symbol.Name} is a partial class: partial classes are not supported."; }
        if (declaration.ParameterList is not null) { return $"{symbol.Name} has a primary constructor, which is not supported."; }
        return null;
    }

    private static bool IsPrivate(SemanticModel model, MemberDeclarationSyntax member)
        => ExtractSuperclassEngine.DeclaredSymbols(model, member).All(s => s.DeclaredAccessibility == Accessibility.Private);

    /// <summary>A member the new class (in the same assembly) can reach.</summary>
    private static bool Reachable(ISymbol symbol) => symbol.DeclaredAccessibility is Accessibility.Public or Accessibility.Internal or Accessibility.ProtectedOrInternal;

    private static bool IsTypeMember(ISymbol symbol, INamedTypeSymbol type)
        => SymbolEqualityComparer.Default.Equals(symbol.ContainingType?.OriginalDefinition, type.OriginalDefinition)
           && symbol.Kind is SymbolKind.Field or SymbolKind.Method or SymbolKind.Property or SymbolKind.Event;

    /// <summary>What a member depends on (the members it uses that the new class could not reach, so they have to move too) and why it cannot move.</summary>
    internal static (IReadOnlyList<string> Deps, string? Blocked) Analyze(SuperclassContext context, MemberDeclarationSyntax member)
    {
        var blocked = BlockedByKind(context, member);
        var own = new Dictionary<ISymbol, string>(SymbolEqualityComparer.Default);
        foreach (var (syntax, id) in context.Members)
        {
            foreach (var symbol in ExtractSuperclassEngine.DeclaredSymbols(context.Model, syntax)) { own[symbol.OriginalDefinition] = id; }
        }
        var self = context.Members.First(m => m.Syntax == member).Id;
        var deps = new List<string>();
        foreach (var (name, symbol) in ExtractSuperclassEngine.References(context.Model, member))
        {
            if (!ExtractSuperclassEngine.IsSelfAccess(name) || symbol is IMethodSymbol { MethodKind: MethodKind.Constructor } || !IsTypeMember(symbol, context.Symbol)) { continue; }
            if (own.TryGetValue(symbol.OriginalDefinition, out var id))
            {
                if (id != self && !Reachable(symbol) && !deps.Contains(id)) { deps.Add(id); }
            }
            else
            {
                blocked ??= $"it uses {symbol.Name}, which the new class cannot reach";
            }
        }
        foreach (var node in member.DescendantNodes())
        {
            if (node is ThisExpressionSyntax { Parent: not MemberAccessExpressionSyntax } or ThisExpressionSyntax { Parent: MemberAccessExpressionSyntax { Expression: not ThisExpressionSyntax } })
            {
                blocked ??= "it uses 'this' itself";
            }
            else if (node is BaseExpressionSyntax) { blocked ??= "it uses 'base'"; }
        }
        return (deps, blocked);
    }

    private static string? BlockedByKind(SuperclassContext context, MemberDeclarationSyntax member)
    {
        switch (member)
        {
            case IndexerDeclarationSyntax: return "indexers are not supported yet";
            case EventDeclarationSyntax or EventFieldDeclarationSyntax: return "events are not supported yet";
            case BaseTypeDeclarationSyntax or DelegateDeclarationSyntax: return "nested types are not supported yet";
            case PropertyDeclarationSyntax p when p.AccessorList?.Accessors.Any(a => a.IsKind(SyntaxKind.InitAccessorDeclaration)) == true: return "an init accessor cannot be forwarded";
        }
        foreach (var kind in new[] { SyntaxKind.AbstractKeyword, SyntaxKind.VirtualKeyword, SyntaxKind.OverrideKeyword, SyntaxKind.SealedKeyword, SyntaxKind.NewKeyword, SyntaxKind.ExternKeyword, SyntaxKind.PartialKeyword })
        {
            if (member.Modifiers.Any(kind)) { return $"it is {SyntaxFacts.GetText(kind)}"; }
        }
        foreach (var symbol in ExtractSuperclassEngine.DeclaredSymbols(context.Model, member))
        {
            var implemented = context.Symbol.AllInterfaces.SelectMany(i => i.GetMembers())
                .Any(m => SymbolEqualityComparer.Default.Equals(context.Symbol.FindImplementationForInterfaceMember(m), symbol));
            if (implemented) { return "it implements an interface member"; }
        }
        return null;
    }

    // ---- edits

    /// <summary>`Name` becomes `prefix + Name` (and `this.Name` becomes `prefix + Name`) for the members of the type the function names a prefix for.</summary>
    private static IEnumerable<(TextSpan Span, string Text)> PrefixEdits(SemanticModel model, SyntaxNode node, Func<ISymbol, string?> prefixOf)
    {
        foreach (var (name, symbol) in ExtractSuperclassEngine.References(model, node))
        {
            if (symbol.Kind is not (SymbolKind.Field or SymbolKind.Method or SymbolKind.Property or SymbolKind.Event)
                || symbol is IMethodSymbol { MethodKind: MethodKind.Constructor }
                || !ExtractSuperclassEngine.IsSelfAccess(name)) { continue; }
            var prefix = prefixOf(symbol);
            if (prefix is null) { continue; }
            if (name.Parent is MemberAccessExpressionSyntax { Expression: ThisExpressionSyntax } access && access.Name == name)
            {
                yield return (access.Span, prefix + name);
            }
            else
            {
                yield return (new TextSpan(name.SpanStart, 0), prefix);
            }
        }
    }

    /// <summary>The access a member has in the new class: `internal` where the type reaches it (or it was reachable from outside), `public` stays.</summary>
    private static IEnumerable<(TextSpan Span, string Text)> AccessEdits(SemanticModel model, MemberDeclarationSyntax member, bool usedByWhatStays)
    {
        var accessibility = ExtractSuperclassEngine.DeclaredSymbols(model, member).Select(s => s.DeclaredAccessibility).FirstOrDefault();
        var target = accessibility switch
        {
            Accessibility.Public => null,
            Accessibility.Private => usedByWhatStays ? "internal" : null,
            _ => "internal",
        };
        if (target is null) { yield break; }
        var access = member.Modifiers.Where(m => ExtractSuperclassEngine.AccessKinds.Contains(m.Kind())).ToList();
        if (access.Count == 0) { yield return (new TextSpan(ExtractSuperclassEngine.ModifierAnchor(member), 0), target + " "); yield break; }
        yield return (access[0].Span, target);
        foreach (var other in access.Skip(1)) { yield return (TextSpan.FromBounds(other.SpanStart, other.FullSpan.End), ""); }
    }

    // ---- the forwarding members the type keeps

    private static string Squash(object node) => Regex.Replace(node.ToString() ?? "", @"\s+", " ");

    private static string Modifiers(SyntaxTokenList modifiers, params SyntaxKind[] drop)
        => string.Join(" ", modifiers.Where(m => !drop.Contains(m.Kind())).Select(m => m.Text));

    /// <summary>The forwarding member keeps `[Obsolete]` of the member: the moved member is obsolete in its new class, and a use of it from a member that is not obsolete would not compile (CS0619 with `error: true`).</summary>
    private static string Forwarders(MemberDeclarationSyntax member, string fieldName, string className, string eol, string indent)
    {
        var obsolete = member.AttributeLists
            .Where(list => list.Attributes.All(a => a.Name.ToString() is "Obsolete" or "ObsoleteAttribute" or "System.Obsolete" or "System.ObsoleteAttribute"))
            .Select(list => Squash(list) + eol + indent);
        return string.Concat(obsolete) + ForwardersOf(member, fieldName, className, eol, indent);
    }

    private static string ForwardersOf(MemberDeclarationSyntax member, string fieldName, string className, string eol, string indent)
    {
        var isStatic = member.Modifiers.Any(SyntaxKind.StaticKeyword) || member.Modifiers.Any(SyntaxKind.ConstKeyword);
        var target = isStatic ? className : fieldName;
        switch (member)
        {
            case MethodDeclarationSyntax method:
            {
                var typeArguments = method.TypeParameterList is null ? "" : "<" + string.Join(", ", method.TypeParameterList.Parameters.Select(p => p.Identifier.Text)) + ">";
                var arguments = string.Join(", ", method.ParameterList.Parameters.Select(p =>
                    (p.Modifiers.FirstOrDefault(m => m.IsKind(SyntaxKind.RefKeyword) || m.IsKind(SyntaxKind.OutKeyword) || m.IsKind(SyntaxKind.InKeyword)).Text is { Length: > 0 } modifier ? modifier + " " : "") + p.Identifier.Text));
                var constraints = string.Concat(method.ConstraintClauses.Select(c => " " + Squash(c)));
                return $"{Modifiers(method.Modifiers, SyntaxKind.AsyncKeyword)} {Squash(method.ReturnType)} {method.Identifier.Text}{method.TypeParameterList}{Squash(method.ParameterList)}{constraints} => {target}.{method.Identifier.Text}{typeArguments}({arguments});";
            }
            case PropertyDeclarationSyntax property:
            {
                var name = property.Identifier.Text;
                var head = $"{Modifiers(property.Modifiers)} {Squash(property.Type)} {name}";
                if (property.ExpressionBody is not null) { return $"{head} => {target}.{name};"; }
                var accessors = (property.AccessorList?.Accessors ?? []).Select(a =>
                {
                    var access = a.Modifiers.Count > 0 ? Modifiers(a.Modifiers) + " " : "";
                    return a.IsKind(SyntaxKind.GetAccessorDeclaration) ? $"{access}get => {target}.{name};" : $"{access}set => {target}.{name} = value;";
                });
                return $"{head} {{ {string.Join(" ", accessors)} }}";
            }
            case FieldDeclarationSyntax field:
            {
                var lines = new List<string>();
                var type = Squash(field.Declaration.Type);
                foreach (var variable in field.Declaration.Variables)
                {
                    var name = variable.Identifier.Text;
                    if (field.Modifiers.Any(SyntaxKind.ConstKeyword)) { lines.Add($"{Modifiers(field.Modifiers)} {type} {name} = {className}.{name};"); continue; }
                    var readOnly = field.Modifiers.Any(SyntaxKind.ReadOnlyKeyword);
                    var head = $"{Modifiers(field.Modifiers, SyntaxKind.ReadOnlyKeyword, SyntaxKind.VolatileKeyword)} {type} {name}";
                    lines.Add(readOnly ? $"{head} => {target}.{name};" : $"{head} {{ get => {target}.{name}; set => {target}.{name} = value; }}");
                }
                return string.Join(eol + indent, lines);
            }
            default:
                throw new InvalidOperationException($"'{PartialSupport.HeaderOf(member)}' cannot be forwarded.");
        }
    }

    private static string ClassText(ClassDeclarationSyntax declaration, string className, string typeName, bool allStatic, bool needsOwner, IReadOnlyList<string> bodies, string indent, string eol)
    {
        var access = declaration.Modifiers.Where(m => m.IsKind(SyntaxKind.PublicKeyword) || m.IsKind(SyntaxKind.InternalKeyword)).Select(m => m.Text);
        var modifiers = string.Join(" ", access.Concat(allStatic ? ["static"] : []));
        var sb = new StringBuilder();
        sb.Append(indent).Append(modifiers.Length > 0 ? modifiers + " " : "").Append("class ").Append(className).Append(eol).Append(indent).Append('{').Append(eol);
        var inner = indent + "    ";
        var parts = new List<string>();
        if (needsOwner)
        {
            parts.Add($"private readonly {typeName} {Owner};{eol}");
            parts.Add($"internal {className}({typeName} owner){eol}{{{eol}    {Owner} = owner;{eol}}}{eol}");
        }
        parts.AddRange(bodies);
        for (var i = 0; i < parts.Count; i++)
        {
            if (i > 0) { sb.Append(eol); }
            sb.Append(PartialSupport.Reindent(parts[i], inner, eol));
        }
        sb.Append(indent).Append('}').Append(eol);
        return sb.ToString();
    }
}
