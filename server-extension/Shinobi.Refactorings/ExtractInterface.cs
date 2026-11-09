using System.Text;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Extensions;
using Microsoft.CodeAnalysis.Text;

namespace Shinobi.Refactorings;

public sealed record Position(
    [property: JsonPropertyName("line")] int Line,
    [property: JsonPropertyName("character")] int Character);

public sealed record TypeAt([property: JsonPropertyName("position")] Position Position);

public sealed record InterfaceMember(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("signature")] string Signature);

public sealed record ExtractInterfaceInfo(
    [property: JsonPropertyName("typeName")] string TypeName,
    [property: JsonPropertyName("interfaceName")] string InterfaceName,
    [property: JsonPropertyName("members")] IReadOnlyList<InterfaceMember> Members);

public sealed record ExtractInterfaceRequest(
    [property: JsonPropertyName("position")] Position Position,
    [property: JsonPropertyName("interfaceName")] string InterfaceName,
    [property: JsonPropertyName("memberIds")] IReadOnlyList<string> MemberIds,
    [property: JsonPropertyName("newFile")] bool NewFile,
    /// <summary>Use the interface in place of the type where only its members are used.</summary>
    [property: JsonPropertyName("useBaseType")] bool UseBaseType = false);

public sealed record TextEdit(
    [property: JsonPropertyName("startLine")] int StartLine,
    [property: JsonPropertyName("startCharacter")] int StartCharacter,
    [property: JsonPropertyName("endLine")] int EndLine,
    [property: JsonPropertyName("endCharacter")] int EndCharacter,
    [property: JsonPropertyName("newText")] string NewText);

public sealed record ExtractInterfaceResult(
    [property: JsonPropertyName("edits")] IReadOnlyList<TextEdit> Edits,
    [property: JsonPropertyName("newFilePath")] string? NewFilePath,
    [property: JsonPropertyName("newFileContent")] string? NewFileContent,
    [property: JsonPropertyName("errors")] IReadOnlyList<string>? Errors = null,
    /// <summary>Edits of other existing files (a refactoring that changes a base class in another file).</summary>
    [property: JsonPropertyName("others")] IReadOnlyList<FileEdits>? Others = null,
    /// <summary>What else was done (shown after the edits are applied).</summary>
    [property: JsonPropertyName("summary")] string? Summary = null);

public sealed record FileEdits(
    [property: JsonPropertyName("path")] string Path,
    [property: JsonPropertyName("edits")] IReadOnlyList<TextEdit> Edits);

/// <summary>What the Extract Interface dialog lists: the type under the cursor and its members that can go into an interface.</summary>
public sealed class ExtractInterfaceInfoHandler : DocumentHandler<TypeAt, ExtractInterfaceInfo?>
{
    public override async Task<ExtractInterfaceInfo?> ExecuteAsync(TypeAt message, Document document, CancellationToken cancellationToken)
    {
        var found = await ExtractInterfaceSupport.FindTypeAsync(document, message.Position, cancellationToken).ConfigureAwait(false);
        if (found is null) { return null; }
        var (_, symbol) = found.Value;
        var members = ExtractInterfaceSupport.Candidates(symbol)
            .Select(m => new InterfaceMember(ExtractInterfaceSupport.IdOf(m), ExtractInterfaceSupport.KindOf(m), ExtractInterfaceSupport.SignatureOf(m)))
            .ToList();
        return new ExtractInterfaceInfo(symbol.Name, "I" + symbol.Name, members);
    }
}

/// <summary>Builds the edits: the interface (in a new file next to the class, or above the class) and the class getting it as a base.</summary>
public sealed class ExtractInterfaceHandler : DocumentHandler<ExtractInterfaceRequest, ExtractInterfaceResult?>
{
    public override async Task<ExtractInterfaceResult?> ExecuteAsync(ExtractInterfaceRequest message, Document document, CancellationToken cancellationToken)
    {
        var found = await ExtractInterfaceSupport.FindTypeAsync(document, message.Position, cancellationToken).ConfigureAwait(false);
        if (found is null) { return null; }
        var (declaration, symbol) = found.Value;
        var text = await document.GetTextAsync(cancellationToken).ConfigureAwait(false);
        var chosen = new HashSet<string>(message.MemberIds);
        var members = ExtractInterfaceSupport.Candidates(symbol).Where(m => chosen.Contains(ExtractInterfaceSupport.IdOf(m))).ToList();

        var eol = text.ToString().Contains("\r\n") ? "\r\n" : "\n";
        var indent = ExtractInterfaceSupport.IndentOf(text, declaration);
        var typeParameters = declaration.TypeParameterList?.ToString() ?? "";
        var interfaceName = message.InterfaceName;
        var body = new StringBuilder();
        // the interface has the type parameters of the type and their constraints: a member can need them (a nullable T?, a type that wants T : class)
        var constraints = string.Concat(declaration.ConstraintClauses.Select(c => " " + Regex.Replace(c.ToString(), @"\s+", " ")));
        body.Append(indent).Append("public interface ").Append(interfaceName).Append(typeParameters).Append(constraints).Append(eol);
        body.Append(indent).Append('{').Append(eol);
        foreach (var member in members)
        {
            body.Append(indent).Append("    ").Append(ExtractInterfaceSupport.SignatureOf(member)).Append(eol);
        }
        body.Append(indent).Append('}').Append(eol);

        var edits = new List<TextEdit>();
        // the class gets the interface: after its last base type, else after its name (and type parameters)
        var baseType = interfaceName + typeParameters;
        if (declaration.BaseList is { } baseList)
        {
            edits.Add(At(text, baseList.Types.Last().Span.End, ", " + baseType));
        }
        else
        {
            var after = declaration.TypeParameterList?.Span.End ?? declaration.Identifier.Span.End;
            edits.Add(At(text, after, " : " + baseType));
        }

        PartialSupport.RefuseExisting(document, symbol, interfaceName, message.NewFile && document.FilePath is { } filePath ? Path.Combine(Path.GetDirectoryName(filePath)!, interfaceName + ".cs") : null);
        string? newFilePath = null;
        string? newFileContent = null;
        if (message.NewFile && document.FilePath is { } path)
        {
            newFilePath = Path.Combine(Path.GetDirectoryName(path)!, interfaceName + ".cs");
            newFileContent = ExtractInterfaceSupport.NewFileText(await document.GetSyntaxRootAsync(cancellationToken).ConfigureAwait(false), declaration, members, body.ToString(), eol, symbol.TypeParameters.SelectMany(p => p.ConstraintTypes));
        }
        else
        {
            edits.Add(At(text, ExtractInterfaceSupport.LineStartBefore(text, declaration), body.ToString() + eol));
        }
        var result = new ExtractInterfaceResult(edits, newFilePath, newFileContent);
        if (message.UseBaseType)
        {
            // uses of the type in parameters, locals and private fields that only need what the interface has name the interface
            var target = UseBaseTypeEngine.ForNewInterface(interfaceName, members);
            var groups = await UseBaseTypeEngine.PlanAsync(document, symbol, target, cancellationToken).ConfigureAwait(false);
            return await UseBaseTypeEngine.ChooseAsync(document, result, groups, symbol.Name, interfaceName, cancellationToken).ConfigureAwait(false);
        }
        return await RefactoringValidator.CheckAsync(document, result, cancellationToken).ConfigureAwait(false);
    }

    private static TextEdit At(SourceText text, int position, string newText)
    {
        var p = text.Lines.GetLinePosition(position);
        return new TextEdit(p.Line, p.Character, p.Line, p.Character, newText);
    }
}

internal static class ExtractInterfaceSupport
{
    private static readonly SymbolDisplayFormat Format = new(
        globalNamespaceStyle: SymbolDisplayGlobalNamespaceStyle.Omitted,
        typeQualificationStyle: SymbolDisplayTypeQualificationStyle.NameAndContainingTypes,
        genericsOptions: SymbolDisplayGenericsOptions.IncludeTypeParameters | SymbolDisplayGenericsOptions.IncludeTypeConstraints,
        memberOptions: SymbolDisplayMemberOptions.IncludeType | SymbolDisplayMemberOptions.IncludeParameters,
        parameterOptions: SymbolDisplayParameterOptions.IncludeType | SymbolDisplayParameterOptions.IncludeName | SymbolDisplayParameterOptions.IncludeDefaultValue | SymbolDisplayParameterOptions.IncludeParamsRefOut | SymbolDisplayParameterOptions.IncludeModifiers,
        miscellaneousOptions: SymbolDisplayMiscellaneousOptions.UseSpecialTypes | SymbolDisplayMiscellaneousOptions.IncludeNullableReferenceTypeModifier | SymbolDisplayMiscellaneousOptions.EscapeKeywordIdentifiers);

    public static async Task<(TypeDeclarationSyntax Declaration, INamedTypeSymbol Symbol)?> FindTypeAsync(Document document, Position position, CancellationToken ct)
    {
        var root = await document.GetSyntaxRootAsync(ct).ConfigureAwait(false);
        var text = await document.GetTextAsync(ct).ConfigureAwait(false);
        var model = await document.GetSemanticModelAsync(ct).ConfigureAwait(false);
        if (root is null || model is null || position.Line >= text.Lines.Count) { return null; }
        var offset = Math.Min(text.Lines[position.Line].Start + position.Character, text.Length);
        var token = root.FindToken(offset);
        if (token.Parent is not TypeDeclarationSyntax declaration || declaration.Identifier != token
            || declaration is not (ClassDeclarationSyntax or StructDeclarationSyntax or RecordDeclarationSyntax))
        {
            return null;
        }
        return model.GetDeclaredSymbol(declaration, ct) is { } symbol ? (declaration, symbol) : null;
    }

    /// <summary>Public instance members an interface can have: methods, properties (and indexers), events.</summary>
    public static IEnumerable<ISymbol> Candidates(INamedTypeSymbol type)
        => type.GetMembers().Where(m => m is { DeclaredAccessibility: Accessibility.Public, IsStatic: false, IsImplicitlyDeclared: false }
            && m switch
            {
                IMethodSymbol method => method.MethodKind == MethodKind.Ordinary,
                IPropertySymbol or IEventSymbol => true,
                _ => false,
            });

    public static string IdOf(ISymbol member) => member.ToDisplayString(Format);

    public static string KindOf(ISymbol member) => member switch { IMethodSymbol => "method", IPropertySymbol => "property", _ => "event" };

    public static string SignatureOf(ISymbol member) => member switch
    {
        IPropertySymbol { IsIndexer: true } indexer => $"{indexer.Type.ToDisplayString(Format)} this[{string.Join(", ", indexer.Parameters.Select(p => p.ToDisplayString(Format)))}] {{ {Accessors(indexer)}}}",
        IPropertySymbol property => $"{property.Type.ToDisplayString(Format)} {property.Name} {{ {Accessors(property)}}}",
        IEventSymbol evt => $"event {evt.Type.ToDisplayString(Format)} {evt.Name};",
        _ => member.ToDisplayString(Format) + ";",
    };

    private static string Accessors(IPropertySymbol property)
        => (property.GetMethod is { DeclaredAccessibility: Accessibility.Public } ? "get; " : "")
         + (property.SetMethod is { DeclaredAccessibility: Accessibility.Public } set ? (set.IsInitOnly ? "init; " : "set; ") : "");

    /// <summary>Start of the line the type begins on, above its doc comment when it has one.</summary>
    public static int LineStartBefore(SourceText text, SyntaxNode declaration)
    {
        var start = declaration.SpanStart;
        foreach (var trivia in declaration.GetLeadingTrivia())
        {
            if (!trivia.IsKind(SyntaxKind.WhitespaceTrivia) && !trivia.IsKind(SyntaxKind.EndOfLineTrivia)) { start = trivia.SpanStart; break; }
        }
        return text.Lines.GetLineFromPosition(start).Start;
    }

    public static string IndentOf(SourceText text, SyntaxNode declaration)
    {
        var line = text.Lines.GetLineFromPosition(declaration.SpanStart);
        var lineText = line.ToString();
        return lineText[..(lineText.Length - lineText.TrimStart().Length)];
    }

    /// <summary>The new file: the usings of the class's file that the chosen members need, its namespace (as written there: file-scoped or block), the interface.</summary>
    public static string NewFileText(SyntaxNode? root, TypeDeclarationSyntax declaration, IReadOnlyList<ISymbol> members, string interfaceText, string eol, IEnumerable<ITypeSymbol>? constraintTypes = null)
    {
        var sb = new StringBuilder();
        if (root is CompilationUnitSyntax unit)
        {
            var needed = NeededUsings(unit, members, constraintTypes ?? []);
            foreach (var u in needed) { sb.Append(u.ToString()).Append(eol); }
            if (needed.Count > 0) { sb.Append(eol); }
        }
        var ns = declaration.Ancestors().OfType<BaseNamespaceDeclarationSyntax>().FirstOrDefault();
        if (ns is FileScopedNamespaceDeclarationSyntax)
        {
            sb.Append("namespace ").Append(ns.Name).Append(';').Append(eol).Append(eol).Append(interfaceText);
        }
        else if (ns is not null)
        {
            // block namespace: the interface text carries the class's indent, which is the namespace's body indent
            sb.Append("namespace ").Append(ns.Name).Append(eol).Append('{').Append(eol).Append(interfaceText).Append('}').Append(eol);
        }
        else
        {
            sb.Append(interfaceText);
        }
        return sb.ToString();
    }

    /// <summary>The usings of the class's file the interface needs: those naming a namespace that a type in a chosen signature lives in.</summary>
    private static List<UsingDirectiveSyntax> NeededUsings(CompilationUnitSyntax unit, IReadOnlyList<ISymbol> members, IEnumerable<ITypeSymbol> constraintTypes)
    {
        var namespaces = new HashSet<string>();
        foreach (var constraint in constraintTypes) { Collect(constraint, namespaces); }
        foreach (var member in members)
        {
            switch (member)
            {
                case IMethodSymbol method:
                    Collect(method.ReturnType, namespaces);
                    foreach (var p in method.Parameters) { Collect(p.Type, namespaces); }
                    foreach (var t in method.TypeParameters) { foreach (var c in t.ConstraintTypes) { Collect(c, namespaces); } }
                    break;
                case IPropertySymbol property:
                    Collect(property.Type, namespaces);
                    foreach (var p in property.Parameters) { Collect(p.Type, namespaces); }
                    break;
                case IEventSymbol evt:
                    Collect(evt.Type, namespaces);
                    break;
            }
        }
        var signatures = string.Join("\n", members.Select(SignatureOf));
        return unit.Usings.Where(u =>
        {
            if (u.StaticKeyword != default) { return false; }
            if (u.Alias is { } alias) { return signatures.Contains(alias.Name.Identifier.Text); }
            return u.Name is not null && namespaces.Contains(u.Name.ToString());
        }).ToList();
    }

    private static void Collect(ITypeSymbol? type, HashSet<string> namespaces)
    {
        switch (type)
        {
            case null: return;
            case IArrayTypeSymbol array: Collect(array.ElementType, namespaces); return;
            case IPointerTypeSymbol pointer: Collect(pointer.PointedAtType, namespaces); return;
            case INamedTypeSymbol named:
                var outer = named;
                while (outer.ContainingType is not null) { outer = outer.ContainingType; }
                if (outer.ContainingNamespace is { IsGlobalNamespace: false } ns) { namespaces.Add(ns.ToDisplayString()); }
                foreach (var argument in named.TypeArguments) { Collect(argument, namespaces); }
                return;
        }
    }
}
