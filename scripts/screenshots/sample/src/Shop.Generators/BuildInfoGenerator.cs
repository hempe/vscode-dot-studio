using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.Text;
using System.Linq;
using System.Text;

namespace Shop.Generators;

/// <summary>
/// Generates <c>BuildInfo.ProjectName</c>, and a <c>Describe()</c> method for every class marked
/// <c>[Describe]</c> that lists its properties
/// </summary>
[Generator]
public sealed class BuildInfoGenerator : IIncrementalGenerator
{
    private const string Attribute = """
        namespace Shop.Generated;

        [System.AttributeUsage(System.AttributeTargets.Class)]
        internal sealed class DescribeAttribute : System.Attribute { }
        """;

    public void Initialize(IncrementalGeneratorInitializationContext context)
    {
        context.RegisterPostInitializationOutput(ctx => ctx.AddSource("DescribeAttribute.g.cs", SourceText.From(Attribute, Encoding.UTF8)));

        context.RegisterSourceOutput(context.CompilationProvider.Select((compilation, _) => compilation.AssemblyName), (ctx, assemblyName) =>
            ctx.AddSource("BuildInfo.g.cs", SourceText.From($$"""
                namespace Shop.Generated;

                internal static class BuildInfo
                {
                    public const string ProjectName = "{{assemblyName}}";
                }
                """, Encoding.UTF8)));

        var described = context.SyntaxProvider.ForAttributeWithMetadataName(
            "Shop.Generated.DescribeAttribute",
            static (node, _) => node is Microsoft.CodeAnalysis.CSharp.Syntax.ClassDeclarationSyntax,
            static (ctx, _) => (INamedTypeSymbol)ctx.TargetSymbol);

        context.RegisterSourceOutput(described, (ctx, type) =>
        {
            var properties = type.GetMembers().OfType<IPropertySymbol>().Where(p => !p.IsStatic && p.GetMethod is not null);
            var parts = string.Join(" + \", \" + ", properties.Select(p => $"\"{p.Name}=\" + {p.Name}"));
            ctx.AddSource($"{type.Name}.Describe.g.cs", SourceText.From($$"""
                namespace {{type.ContainingNamespace.ToDisplayString()}};

                partial {{(type.IsRecord ? "record" : "class")}} {{type.Name}}
                {
                    public string Describe() => "{{type.Name}}(" + {{(parts.Length > 0 ? parts : "\"\"")}} + ")";
                }
                """, Encoding.UTF8));
        });
    }
}
