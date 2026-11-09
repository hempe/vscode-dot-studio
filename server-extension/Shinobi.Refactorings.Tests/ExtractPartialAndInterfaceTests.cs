namespace Shinobi.Refactorings.Tests;

public class ExtractPartialAndInterfaceTests
{
    private const string Source = """
        using System.Linq;
        using System.Collections.Generic;

        namespace App;

        public class Order
        {
            private readonly List<int> _lines = new();

            public int Total => _lines.Sum();

            public void Add(int line) => _lines.Add(line);
        }
        """;

    [Fact]
    public async Task The_new_part_keeps_the_modifiers_of_the_type_and_of_the_types_around_it()
    {
        const string source = """
            namespace App;

            internal sealed class Outer
            {
                internal static class Tools
                {
                    public static int One() => 1;
                    public static int Two() => 2;
                }
            }
            """;
        var h = new Harness(("Outer.cs", source));
        var document = h.Document("Outer.cs");
        var position = Harness.At(source, "class Tools", "Tools");
        var info = (await new ExtractPartialInfoHandler().ExecuteAsync(new TypeAt(position), document, default))!;
        var ids = info.Members.Where(m => m.Signature.Contains("Two")).Select(m => m.Id).ToList();

        var result = (await new ExtractPartialHandler().ExecuteAsync(new ExtractPartialRequest(position, "Part", ids), document, default))!;

        Assert.Null(result.Errors);
        Assert.Contains("internal sealed partial class Outer", result.NewFileContent);
        Assert.Contains("internal static partial class Tools", result.NewFileContent);
        Assert.Contains("internal static partial class Tools", Harness.Apply(source, result));
        Assert.Empty(await h.ErrorsAfter(document, result));
    }

    [Fact]
    public async Task The_new_file_gets_the_using_of_an_attribute_the_moved_members_carry()
    {
        const string source = """
            using System;

            namespace App;

            public class Item
            {
                public int Id { get; set; }

                [Obsolete("2021-06-21", true)]
                public string Comment { get; set; }
            }
            """;
        var h = new Harness(("Item.cs", source));
        var document = h.Document("Item.cs");
        var position = Harness.At(source, "class Item", "Item");
        var info = (await new ExtractPartialInfoHandler().ExecuteAsync(new TypeAt(position), document, default))!;
        var ids = info.Members.Where(m => m.Signature.Contains("Comment")).Select(m => m.Id).ToList();

        var result = (await new ExtractPartialHandler().ExecuteAsync(new ExtractPartialRequest(position, "Part", ids), document, default))!;

        Assert.Null(result.Errors);
        Assert.Contains("using System;", result.NewFileContent);
        Assert.Empty(await h.ErrorsAfter(document, result));
    }

    [Fact]
    public async Task Extract_partial_moves_members_to_a_file_of_the_type_and_the_result_compiles()
    {
        var h = new Harness(("Order.cs", Source));
        var document = h.Document("Order.cs");
        var position = Harness.At(Source, "class Order", "Order");
        var info = (await new ExtractPartialInfoHandler().ExecuteAsync(new TypeAt(position), document, default))!;
        var ids = info.Members.Where(m => m.Signature.Contains("Total") || m.Signature.Contains("Add")).Select(m => m.Id).ToList();

        var result = (await new ExtractPartialHandler().ExecuteAsync(new ExtractPartialRequest(position, "Part", ids), document, default))!;

        Assert.Null(result.Errors);
        Assert.EndsWith("Order.Part.cs", result.NewFilePath);
        Assert.Contains("partial class Order", Harness.Apply(Source, result));
        Assert.Contains("public int Total => _lines.Sum();", result.NewFileContent);
        Assert.Contains("using System.Linq;", result.NewFileContent);
        Assert.DoesNotContain("using System.Collections.Generic;", result.NewFileContent);
        Assert.Empty(await h.ErrorsAfter(document, result));
    }

    [Fact]
    public async Task Extract_partial_refuses_a_file_the_project_already_has()
    {
        var h = new Harness(("Order.cs", Source), ("Order.Part.cs", "namespace App; public partial class Order { public int Extra; }"));
        var document = h.Document("Order.cs");
        var position = Harness.At(Source, "class Order", "Order");
        var info = (await new ExtractPartialInfoHandler().ExecuteAsync(new TypeAt(position), document, default))!;
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => new ExtractPartialHandler().ExecuteAsync(
            new ExtractPartialRequest(position, "Part", [info.Members[1].Id]), document, default));
        Assert.Contains("Order.Part.cs exists already", error.Message);
    }

    [Fact]
    public async Task Extract_interface_writes_the_chosen_members_and_the_result_compiles()
    {
        var h = new Harness(("Order.cs", Source));
        var document = h.Document("Order.cs");
        var position = Harness.At(Source, "class Order", "Order");
        var info = (await new ExtractInterfaceInfoHandler().ExecuteAsync(new TypeAt(position), document, default))!;
        Assert.Contains(info.Members, m => m.Signature.StartsWith("int Total"));

        var result = (await new ExtractInterfaceHandler().ExecuteAsync(
            new ExtractInterfaceRequest(position, "IOrder", info.Members.Select(m => m.Id).ToList(), true), document, default))!;

        Assert.Null(result.Errors);
        Assert.Contains("public class Order : IOrder", Harness.Apply(Source, result));
        Assert.Contains("void Add(int line);", result.NewFileContent);
        Assert.Empty(await h.ErrorsAfter(document, result));
    }

    [Fact]
    public async Task Extract_interface_refuses_a_name_that_exists_already_as_a_type_or_a_file()
    {
        var h = new Harness(("Order.cs", Source), ("IOrder.cs", "namespace App; public interface IOrder { }"));
        var document = h.Document("Order.cs");
        var position = Harness.At(Source, "class Order", "Order");
        var info = (await new ExtractInterfaceInfoHandler().ExecuteAsync(new TypeAt(position), document, default))!;
        var ids = info.Members.Select(m => m.Id).ToList();
        var ok = (await new ExtractInterfaceHandler().ExecuteAsync(new ExtractInterfaceRequest(position, "IOrder2", ids, false), document, default))!;
        Assert.Null(ok.Errors);

        var type = await Assert.ThrowsAsync<InvalidOperationException>(() => new ExtractInterfaceHandler().ExecuteAsync(
            new ExtractInterfaceRequest(position, "IOrder", ids, false), document, default));
        Assert.Contains("A type called IOrder exists already", type.Message);

        // a new file of that name: the file is the problem, even when the type is not there
        var withFile = new Harness(("Order.cs", Source), ("IOrder2.cs", "// somebody's notes"));
        var file = await Assert.ThrowsAsync<InvalidOperationException>(() => new ExtractInterfaceHandler().ExecuteAsync(
            new ExtractInterfaceRequest(position, "IOrder2", ids, true), null!, withFile.Document("Order.cs"), default));
        Assert.Contains("IOrder2.cs exists already", file.Message);
    }

    [Fact]
    public async Task Extract_interface_of_a_generic_type_keeps_the_constraints_and_the_usings_they_need()
    {
        const string source = """
            using System;
            using System.Collections.Generic;

            namespace App;

            public class Box<T, TKey> where T : class, IComparable<T>, new() where TKey : struct
            {
                public T? Value { get; set; }

                public TKey? Key { get; set; }

                public List<T> All() => new();
            }
            """;
        var h = new Harness(("Box.cs", source));
        var document = h.Document("Box.cs");
        var position = Harness.At(source, "class Box", "Box");
        var info = (await new ExtractInterfaceInfoHandler().ExecuteAsync(new TypeAt(position), document, default))!;
        var result = (await new ExtractInterfaceHandler().ExecuteAsync(
            new ExtractInterfaceRequest(position, "IBox", info.Members.Select(m => m.Id).ToList(), true), document, default))!;
        Assert.Null(result.Errors);
        var file = Harness.Lf(result.NewFileContent!);
        Assert.Contains("public interface IBox<T, TKey> where T : class, IComparable<T>, new() where TKey : struct", file);
        Assert.Contains("using System;", file);
        Assert.Empty(await h.ErrorsAfter(document, result));
    }
}
