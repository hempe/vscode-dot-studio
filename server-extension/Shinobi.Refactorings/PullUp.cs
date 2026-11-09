using System.Text;
using System.Text.Json.Serialization;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Extensions;
using Microsoft.CodeAnalysis.Text;

namespace Shinobi.Refactorings;

public sealed record PullUpTarget(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("name")] string Name,
    /// <summary>"class" or "interface"</summary>
    [property: JsonPropertyName("kind")] string Kind,
    /// <summary>The file (and project) it is declared in.</summary>
    [property: JsonPropertyName("where")] string Where,
    [property: JsonPropertyName("isAbstract")] bool IsAbstract);

public sealed record PullUpMember(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("signature")] string Signature,
    [property: JsonPropertyName("canBeAbstract")] bool CanBeAbstract,
    [property: JsonPropertyName("abstractSignature")] string? AbstractSignature,
    [property: JsonPropertyName("deps")] IReadOnlyList<string> Deps,
    [property: JsonPropertyName("blocked")] string? Blocked,
    /// <summary>The member can go into an interface (public, not static, a method, property or event); the declaration the interface gets.</summary>
    [property: JsonPropertyName("interfaceSignature")] string? InterfaceSignature);

public sealed record PullUpInfo(
    [property: JsonPropertyName("typeName")] string TypeName,
    [property: JsonPropertyName("targets")] IReadOnlyList<PullUpTarget> Targets,
    [property: JsonPropertyName("members")] IReadOnlyList<PullUpMember> Members,
    /// <summary>The members to check at the start: the one the cursor is on.</summary>
    [property: JsonPropertyName("selected")] IReadOnlyList<string> Selected,
    [property: JsonPropertyName("refusal")] string? Refusal);

public sealed record PullUpRequest(
    [property: JsonPropertyName("position")] Position Position,
    [property: JsonPropertyName("targetId")] string TargetId,
    [property: JsonPropertyName("memberIds")] IReadOnlyList<string> MemberIds,
    [property: JsonPropertyName("abstractIds")] IReadOnlyList<string> AbstractIds);

/// <summary>The class under the cursor (on its name or on one of its members), the base classes and interfaces of the solution's source it can pull members up to, and its members.</summary>
public sealed class PullUpInfoHandler : DocumentHandler<TypeAt, PullUpInfo?>
{
    public override Task<PullUpInfo?> ExecuteAsync(TypeAt message, Document document, CancellationToken cancellationToken)
        => PullUpEngine.InfoAsync(document, message.Position, cancellationToken);
}

/// <summary>Moves the chosen members to the base class (or declares them abstract there), or adds them to the interface; compiled before it is applied.</summary>
public sealed class PullUpHandler : DocumentHandler<PullUpRequest, ExtractInterfaceResult?>
{
    public override Task<ExtractInterfaceResult?> ExecuteAsync(PullUpRequest message, Document document, CancellationToken cancellationToken)
        => PullUpEngine.RunAsync(document, message, cancellationToken);
}

public static class PullUpEngine
{
    private sealed class Analysis
    {
        public required Document Document { get; init; }
        public required SuperclassContext Context { get; init; }
        public required List<(INamedTypeSymbol Type, string Kind)> Targets { get; init; }
        public required string? SelectedId { get; init; }
        public required string? Refusal { get; init; }
    }

    public static async Task<PullUpInfo?> InfoAsync(Document document, Position position, CancellationToken ct)
    {
        var analysis = await AnalyzeAsync(document, position, ct).ConfigureAwait(false);
        if (analysis is null) { return null; }
        var context = analysis.Context;
        if (analysis.Refusal is not null) { return new PullUpInfo(context.Symbol.Name, [], [], [], analysis.Refusal); }

        var targets = analysis.Targets.Select(t => new PullUpTarget(IdOf(t.Type), t.Type.Name, t.Kind, WhereOf(document, t.Type), t.Type.IsAbstract)).ToList();
        var members = new List<PullUpMember>();
        foreach (var (syntax, id) in context.Members)
        {
            var (deps, blocked) = ExtractSuperclassEngine.DependenciesOf(context, syntax);
            var abstractSignature = ExtractSuperclassEngine.AbstractDeclaration(syntax);
            members.Add(new PullUpMember(id, PartialSupport.KindOf(syntax), PartialSupport.HeaderOf(syntax), abstractSignature is not null, abstractSignature, deps, blocked, InterfaceSignature(context, syntax)));
        }
        return new PullUpInfo(context.Symbol.Name, targets, members, analysis.SelectedId is null ? [] : [analysis.SelectedId], null);
    }

    public static async Task<ExtractInterfaceResult?> RunAsync(Document document, PullUpRequest request, CancellationToken ct)
    {
        var analysis = await AnalyzeAsync(document, request.Position, ct).ConfigureAwait(false);
        if (analysis is null) { return null; }
        if (analysis.Refusal is not null) { throw new InvalidOperationException(analysis.Refusal); }
        var context = analysis.Context;
        var target = analysis.Targets.FirstOrDefault(t => IdOf(t.Type) == request.TargetId);
        if (target.Type is null) { throw new InvalidOperationException("The target is no longer a base type of this class; try again."); }

        var byId = context.Members.ToDictionary(m => m.Id, m => m.Syntax);
        var chosen = new HashSet<string>(request.MemberIds);
        if (chosen.Count == 0) { return null; }
        if (chosen.Any(id => !byId.ContainsKey(id)) || request.AbstractIds.Any(id => !chosen.Contains(id)))
        {
            throw new InvalidOperationException("The file changed since the members were listed; try again.");
        }
        var ordered = context.Members.Where(m => chosen.Contains(m.Id)).ToList();

        var targetDocument = TargetDocument(document, target.Type, out var targetDeclaration);
        if (targetDocument is null || targetDeclaration is null) { throw new InvalidOperationException($"{target.Type.Name} is not declared in source of this solution."); }
        var targetText = await targetDocument.GetTextAsync(ct).ConfigureAwait(false);
        var targetRoot = (CompilationUnitSyntax)(await targetDocument.GetSyntaxRootAsync(ct).ConfigureAwait(false))!;
        var eol = targetText.ToString().Contains("\r\n") ? "\r\n" : "\n";

        var edits = new List<TextEdit>();                 // in the class's own file
        var targetEdits = new List<TextEdit>();           // in the target's file (the same list when it is the same file)
        var sameFile = targetDocument.Id == document.Id;
        var intoTarget = sameFile ? edits : targetEdits;

        string[] lines;
        IEnumerable<SyntaxNode> usedNodes;
        if (target.Kind == "interface")
        {
            if (request.AbstractIds.Count > 0) { throw new InvalidOperationException("An interface member is abstract already."); }
            var signatures = new List<string>();
            foreach (var (syntax, _) in ordered)
            {
                var signature = InterfaceSignature(context, syntax) ?? throw new InvalidOperationException($"'{PartialSupport.HeaderOf(syntax)}' cannot go into an interface (it must be public, not static, a method, property or event).");
                var clash = FindClash(context, target.Type, syntax);
                if (clash is not null) { throw new InvalidOperationException($"{target.Type.Name} already has {clash}."); }
                signatures.Add(signature);
            }
            lines = signatures.ToArray();
            usedNodes = ordered.Select(m => (SyntaxNode)m.Syntax);
        }
        else
        {
            var abstractIds = new HashSet<string>(request.AbstractIds);
            foreach (var id in abstractIds)
            {
                if (ExtractSuperclassEngine.AbstractDeclaration(byId[id]) is null) { throw new InvalidOperationException($"'{PartialSupport.HeaderOf(byId[id])}' cannot be made abstract."); }
            }
            var moved = ordered.Where(m => !abstractIds.Contains(m.Id)).Select(m => m.Syntax).ToList();
            var declared = ordered.Where(m => abstractIds.Contains(m.Id)).Select(m => m.Syntax).ToList();
            foreach (var (syntax, _) in ordered)
            {
                var clash = FindClash(context, target.Type, syntax);
                if (clash is not null) { throw new InvalidOperationException($"{target.Type.Name} already has {clash}."); }
            }
            // a moved member can only use members that go up with it
            foreach (var (syntax, _) in ordered.Where(m => !abstractIds.Contains(m.Id)))
            {
                var (deps, blocked) = ExtractSuperclassEngine.DependenciesOf(context, syntax);
                if (blocked is not null) { throw new InvalidOperationException($"'{PartialSupport.HeaderOf(syntax)}' cannot move: {blocked}."); }
                var missing = deps.Where(d => !chosen.Contains(d)).Select(d => PartialSupport.HeaderOf(byId[d])).ToList();
                if (missing.Count > 0)
                {
                    throw new InvalidOperationException($"'{PartialSupport.HeaderOf(syntax)}' uses {string.Join(", ", missing.Select(m => $"'{m}'"))}, which stays in {context.Symbol.Name} and cannot be reached from {target.Type.Name}; pull it up as well.");
                }
            }

            // members that stay as overrides of the abstract declarations, members that move leave their lines
            foreach (var member in declared) { edits.AddRange(ExtractSuperclassEngine.OverrideEdits(context.Text, member)); }
            edits.AddRange(PartialSupport.RemovalEdits(context.Text, moved));

            // a private member (or accessor) that the class still uses must stay reachable from it: protected
            var usedElsewhere = ExtractSuperclassEngine.MovedMembersUsedElsewhere(context, moved, ct);
            var bodies = new List<string>();
            foreach (var (syntax, id) in ordered)
            {
                if (abstractIds.Contains(id)) { bodies.Add(ExtractSuperclassEngine.AbstractDeclaration(syntax)! + eol); continue; }
                var adjustments = usedElsewhere.Contains(syntax) ? ExtractSuperclassEngine.AccessibilityEdits(context.Model, syntax) : [];
                bodies.Add(PartialSupport.TextOf(context.Text, syntax, eol, adjustments));
            }
            lines = bodies.ToArray();
            usedNodes = moved.Concat(declared).Cast<SyntaxNode>();

            // abstract members make the target abstract
            if (declared.Count > 0 && !targetDeclaration.Modifiers.Any(SyntaxKind.AbstractKeyword))
            {
                intoTarget.Add(PartialSupport.Insert(targetText, targetDeclaration.Keyword.SpanStart, "abstract "));
            }
        }

        // the members go before the closing brace of the target, with its indentation
        var indent = ExtractInterfaceSupport.IndentOf(targetText, targetDeclaration) + "    ";
        var block = new StringBuilder();
        var brace = targetDeclaration.CloseBraceToken;
        var braceLine = targetText.Lines.GetLineFromPosition(brace.SpanStart);
        var brokenLine = targetText.ToString(TextSpan.FromBounds(braceLine.Start, brace.SpanStart)).Trim().Length > 0;
        if (brokenLine) { block.Append(eol); }
        if (targetDeclaration.Members.Count > 0 && target.Kind == "class") { block.Append(eol); }
        for (var i = 0; i < lines.Length; i++)
        {
            if (i > 0 && target.Kind == "class") { block.Append(eol); }
            block.Append(target.Kind == "class" ? PartialSupport.Reindent(lines[i], indent, eol) : indent + lines[i] + eol);
        }
        intoTarget.Add(PartialSupport.Insert(targetText, brokenLine ? brace.SpanStart : braceLine.Start, block.ToString()));

        // the usings the pulled members need that the target's file lacks
        var usings = PartialSupport.NeededUsings(context.Root, context.Model, usedNodes, ct)
            .Where(u => !targetRoot.Usings.Any(t => t.Name?.ToString() == u.Name?.ToString() && t.Alias?.ToString() == u.Alias?.ToString() && t.StaticKeyword == default)).ToList();
        if (usings.Count > 0 && !(sameFile))
        {
            var text = string.Concat(usings.Select(u => u.ToString() + eol));
            if (targetRoot.Usings.Count > 0)
            {
                var last = targetText.Lines.GetLineFromPosition(targetRoot.Usings.Last().Span.End - 1);
                intoTarget.Add(PartialSupport.Insert(targetText, last.EndIncludingLineBreak, text));
            }
            else
            {
                intoTarget.Add(PartialSupport.Insert(targetText, 0, text + eol));
            }
        }

        var others = sameFile ? null : new List<FileEdits> { new(targetDocument.FilePath!, targetEdits) };
        return await RefactoringValidator.CheckAsync(document, new ExtractInterfaceResult(edits, null, null, null, others), ct).ConfigureAwait(false);
    }

    private static string IdOf(INamedTypeSymbol type) => type.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat);

    private static string WhereOf(Document document, INamedTypeSymbol type)
    {
        var tree = type.DeclaringSyntaxReferences.FirstOrDefault()?.SyntaxTree;
        var target = tree is null ? null : document.Project.Solution.GetDocument(tree);
        return target is null ? "" : $"{Path.GetFileName(target.FilePath)} ({target.Project.Name})";
    }

    /// <summary>The document and declaration of a source type; for a partial type the first part that is in the solution.</summary>
    private static Document? TargetDocument(Document from, INamedTypeSymbol type, out TypeDeclarationSyntax? declaration)
    {
        foreach (var reference in type.DeclaringSyntaxReferences)
        {
            if (from.Project.Solution.GetDocument(reference.SyntaxTree) is { FilePath: not null } document && reference.GetSyntax() is TypeDeclarationSyntax syntax)
            {
                declaration = syntax;
                return document;
            }
        }
        declaration = null;
        return null;
    }

    /// <summary>A member of the target that the pulled member would clash with: the same name and, for methods, the same parameter types.</summary>
    internal static string? FindClash(SuperclassContext context, INamedTypeSymbol target, MemberDeclarationSyntax member)
    {
        foreach (var symbol in ExtractSuperclassEngine.DeclaredSymbols(context.Model, member))
        {
            foreach (var existing in target.GetMembers(symbol.Name))
            {
                if (symbol is IMethodSymbol method && existing is IMethodSymbol other)
                {
                    if (method.Parameters.Length == other.Parameters.Length && method.TypeParameters.Length == other.TypeParameters.Length
                        && method.Parameters.Zip(other.Parameters).All(p => SymbolEqualityComparer.Default.Equals(p.First.Type, p.Second.Type) && p.First.RefKind == p.Second.RefKind))
                    {
                        return $"'{ExtractInterfaceSupport.SignatureOf(other).TrimEnd(';')}'";
                    }
                }
                else if (symbol is not IMethodSymbol && existing is not IMethodSymbol)
                {
                    return $"a member '{existing.Name}'";
                }
            }
        }
        return null;
    }

    /// <summary>The declaration an interface gets for the member, or null when an interface cannot have it.</summary>
    private static string? InterfaceSignature(SuperclassContext context, MemberDeclarationSyntax member)
    {
        if (member is not (MethodDeclarationSyntax or PropertyDeclarationSyntax or EventDeclarationSyntax or EventFieldDeclarationSyntax)) { return null; }
        var symbol = ExtractSuperclassEngine.DeclaredSymbols(context.Model, member).FirstOrDefault();
        if (symbol is null || symbol.DeclaredAccessibility != Accessibility.Public || symbol.IsStatic) { return null; }
        if (symbol is IMethodSymbol { MethodKind: not MethodKind.Ordinary }) { return null; }
        return ExtractInterfaceSupport.SignatureOf(symbol);
    }

    private static async Task<Analysis?> AnalyzeAsync(Document document, Position position, CancellationToken ct)
    {
        var root = await document.GetSyntaxRootAsync(ct).ConfigureAwait(false);
        var text = await document.GetTextAsync(ct).ConfigureAwait(false);
        if (root is null || position.Line >= text.Lines.Count) { return null; }
        var offset = Math.Min(text.Lines[position.Line].Start + position.Character, text.Length);
        var token = root.FindToken(offset);

        // the class's name, or the name of one of its members (the cursor member is checked at the start)
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

        var targets = new List<(INamedTypeSymbol, string)>();
        for (var b = symbol.BaseType; b is not null && b.SpecialType != SpecialType.System_Object; b = b.BaseType)
        {
            if (IsSource(document, b)) { targets.Add((b, "class")); }
        }
        foreach (var i in symbol.AllInterfaces)
        {
            if (IsSource(document, i)) { targets.Add((i, "interface")); }
        }

        var members = new List<(MemberDeclarationSyntax, string)>();
        for (var i = 0; i < declaration.Members.Count; i++)
        {
            if (ExtractSuperclassEngine.IsListable(declaration.Members[i])) { members.Add((declaration.Members[i], PartialSupport.IdOf(declaration.Members[i], i))); }
        }
        string? refusal = null;
        if (targets.Count == 0)
        {
            refusal = $"{symbol.Name} has no base class or interface declared in this solution's source to pull members up to.";
        }
        var context = new SuperclassContext
        {
            Document = document, Declaration = declaration, Symbol = symbol, Model = model, Root = (CompilationUnitSyntax)root, Text = text, Members = members, Refusal = null,
        };
        var selectedId = selected is null ? null : members.FirstOrDefault(m => m.Item1 == selected).Item2;
        return new Analysis { Document = document, Context = context, Targets = targets, SelectedId = selectedId, Refusal = refusal };
    }

    /// <summary>Declared in a document of this solution (not generated, not from metadata) and not generic (a generic target would need its type arguments mapped).</summary>
    private static bool IsSource(Document document, INamedTypeSymbol type)
        => !type.IsGenericType
           && type.DeclaringSyntaxReferences.Any(r => document.Project.Solution.GetDocument(r.SyntaxTree) is { FilePath: not null } d && !d.FilePath.EndsWith(".g.cs", StringComparison.OrdinalIgnoreCase));
}
