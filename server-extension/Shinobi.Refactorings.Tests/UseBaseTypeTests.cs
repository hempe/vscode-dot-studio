namespace Shinobi.Refactorings.Tests;

public class UseBaseTypeTests
{
    private const string Order = """
        namespace App;

        public class Order
        {
            public int Total { get; set; }
            public int Count;
            public void Add(int line) { Count++; Total += line; }
        }
        """;

    private const string Uses = """
        namespace App;

        public class Report
        {
            private Order _order = new Order();
            private Order _counted = new Order();

            public void Print(Order o) { System.Console.WriteLine(o.Total); }
            public void Skip(Order o) { System.Console.WriteLine(o.Count); }

            public void Local()
            {
                Order x = new Order();
                x.Add(1);
                Order y = new Order();
                y.Count++;
            }

            public void Field() { _order.Add(2); _counted.Count++; }

            public void A(Order o) { B(o); }
            private void B(Order o) { o.Add(1); }
            public void C(Order o) { Keep(o); }
            private void Keep(Order o) { o.Count++; }

            public void Cast(Order o) { var same = (Order)o; }
            public void Out(Order o) { Take(out o); }
            private void Take(out Order o) { o = new Order(); }
            public Order Give(Order o) { return o; }
            public void Test(Order o) { if (o != null && o.Total > 0) { } }
        }
        """;

    private static async Task<(ExtractInterfaceResult Result, string Uses)> ExtractInterface(string[] members)
    {
        var h = new Harness(("Order.cs", Order), ("Report.cs", Uses));
        var document = h.Document("Order.cs");
        var position = Harness.At(Order, "class Order", "Order");
        var info = (await new ExtractInterfaceInfoHandler().ExecuteAsync(new TypeAt(position), document, default))!;
        var ids = info.Members.Where(m => members.Any(start => m.Signature.Contains(start))).Select(m => m.Id).ToList();
        var result = (await new ExtractInterfaceHandler().ExecuteAsync(new ExtractInterfaceRequest(position, "IOrder", ids, true, UseBaseType: true), document, default))!;
        Assert.Null(result.Errors);
        Assert.Empty(await h.ErrorsAfter(document, result));
        var other = Assert.Single(result.Others!);
        return (result, Harness.Lf(Harness.Apply(Uses, new ExtractInterfaceResult(other.Edits, null, null))));
    }

    [Fact]
    public async Task Extract_interface_names_the_interface_where_only_its_members_are_used_and_the_result_compiles()
    {
        var (result, uses) = await ExtractInterface(["int Total", "void Add"]);

        Assert.Contains("private IOrder _order = new Order();", uses);       // _order only gets Add
        Assert.Contains("private Order _counted = new Order();", uses);      // Count is not in the interface
        Assert.Contains("public void Print(IOrder o)", uses);
        Assert.Contains("public void Skip(Order o)", uses);
        Assert.Contains("IOrder x = new Order();", uses);
        Assert.Contains("Order y = new Order();", uses);
        // a value passed on: both change, or neither
        Assert.Contains("public void A(IOrder o) { B(o); }", uses);
        Assert.Contains("private void B(IOrder o)", uses);
        Assert.Contains("public void C(Order o) { Keep(o); }", uses);
        Assert.Contains("private void Keep(Order o)", uses);
        // cast, out, a return, null checks
        Assert.Contains("public void Cast(Order o)", uses);
        Assert.Contains("public void Out(Order o)", uses);
        Assert.Contains("public Order Give(Order o)", uses);
        Assert.Contains("public void Test(IOrder o)", uses);
        Assert.Contains("IOrder is used instead of Order in", result.Summary);
        Assert.Contains("public methods", result.Summary);
    }

    [Fact]
    public async Task Without_the_option_nothing_but_the_extraction_is_edited()
    {
        var h = new Harness(("Order.cs", Order), ("Report.cs", Uses));
        var document = h.Document("Order.cs");
        var position = Harness.At(Order, "class Order", "Order");
        var info = (await new ExtractInterfaceInfoHandler().ExecuteAsync(new TypeAt(position), document, default))!;
        var result = (await new ExtractInterfaceHandler().ExecuteAsync(new ExtractInterfaceRequest(position, "IOrder", info.Members.Select(m => m.Id).ToList(), true), document, default))!;
        Assert.Null(result.Others);
        Assert.Null(result.Summary);
    }

    [Fact]
    public async Task Extract_superclass_names_the_base_class_for_what_it_has_and_what_the_type_inherits()
    {
        const string animals = """
            namespace App;

            public class Pet { public string Name { get; set; } }

            public class Dog : Pet
            {
                public int Age { get; set; }
                public void Bark() { }
                public void Fetch() { }
            }
            """;
        const string uses = """
            namespace App;

            public class Shelter
            {
                public void Greet(Dog d) { System.Console.WriteLine(d.Name + d.Age); d.Bark(); }
                public void Play(Dog d) { d.Fetch(); }
                public void Plain(Dog d) { System.Console.WriteLine(d.Name); }
            }
            """;
        var h = new Harness(("Animals.cs", animals), ("Shelter.cs", uses));
        var document = h.Document("Animals.cs");
        var position = Harness.At(animals, "class Dog", "Dog");
        var info = (await ExtractSuperclassEngine.InfoAsync(document, position, default))!;
        string IdOf(string start) => info.Members.Single(m => m.Signature.Contains(start)).Id;
        var result = (await ExtractSuperclassEngine.RunAsync(document, new ExtractSuperclassRequest(position, "DogBase", [IdOf("int Age"), IdOf("void Bark")], [], true, UseBaseType: true), default))!;

        Assert.Null(result.Errors);
        Assert.Empty(await h.ErrorsAfter(document, result));
        var edited = Harness.Lf(Harness.Apply(uses, new ExtractInterfaceResult(Assert.Single(result.Others!).Edits, null, null)));
        Assert.Contains("public void Greet(DogBase d)", edited);    // Name is inherited from Pet through DogBase, Age and Bark were moved
        Assert.Contains("public void Play(Dog d)", edited);          // Fetch stays in Dog
        Assert.Contains("public void Plain(DogBase d)", edited);
    }

    private const string Hierarchy = """
        namespace App;

        public interface IPet { void Feed(); }

        public class Animal { public string Name { get; set; } }

        public class Dog : Animal, IPet
        {
            public void Feed() { }
            public void Bark() { }
        }

        public class Shelter
        {
            public void Greet(Dog d) { System.Console.WriteLine(d.Name); }
            public void Meal(Dog d) { d.Feed(); }
            public void Both(Dog d) { d.Feed(); d.Bark(); }
            public void Box(Dog d) { object o = d; System.Console.WriteLine(d); }
            public void Pet(Dog d) { IPet p = d; }
            public void Dispose(Dog d) { System.Console.WriteLine(d.ToString()); }
        }
        """;

    private static async Task<(UseBaseTypeInfo Info, Func<string, Task<(ExtractInterfaceResult Result, string Text, IReadOnlyList<string> Errors)>> Use)> Standalone()
    {
        var h = new Harness(("A.cs", Hierarchy));
        var document = h.Document("A.cs");
        var position = Harness.At(Hierarchy, "class Dog", "Dog");
        var info = (await UseBaseTypeEngine.InfoAsync(document, position, true, default))!;
        return (info, async name =>
        {
            var result = (await UseBaseTypeEngine.RunAsync(document, new UseBaseTypeRequest(position, info.Targets.Single(t => t.Name == name).Id), default))!;
            return (result, Harness.Lf(Harness.Apply(Hierarchy, result)), await h.ErrorsAfter(document, result));
        });
    }

    [Fact]
    public async Task Lists_the_base_types_with_how_many_declarations_would_change()
    {
        var (info, _) = await Standalone();
        Assert.Equal(new[] { "Animal", "IPet" }, info.Targets.Select(t => t.Name));
        var animal = info.Targets.Single(t => t.Name == "Animal");
        var pet = info.Targets.Single(t => t.Name == "IPet");
        Assert.Equal(3, animal.Count);   // Greet (Name), Box (object) and Dispose (ToString)
        Assert.Equal(4, pet.Count);      // Meal (Feed), Box, Pet (IPet p = d) and Dispose
    }

    [Fact]
    public async Task Uses_the_base_class_where_only_inherited_members_are_used()
    {
        var (_, use) = await Standalone();
        var (result, text, errors) = await use("Animal");
        Assert.Empty(errors);
        Assert.Contains("public void Greet(Animal d)", text);
        Assert.Contains("public void Dispose(Animal d)", text);
        Assert.Contains("public void Box(Animal d)", text);
        Assert.Contains("public void Meal(Dog d)", text);
        Assert.Contains("public void Both(Dog d)", text);
        Assert.Contains("public void Pet(Dog d)", text);          // IPet p = d: an Animal is no IPet
        Assert.Contains("Animal is used instead of Dog in 3 places", result.Summary);
    }

    [Fact]
    public async Task Uses_the_interface_where_only_its_members_are_used_and_keeps_what_needs_the_type()
    {
        var (_, use) = await Standalone();
        var (_, text, errors) = await use("IPet");
        Assert.Empty(errors);
        Assert.Contains("public void Meal(IPet d)", text);
        Assert.Contains("public void Both(Dog d)", text);        // Bark
        Assert.Contains("public void Greet(Dog d)", text);       // Name is Animal's
        Assert.Contains("public void Pet(IPet d)", text);        // IPet p = d
        Assert.Contains("public void Box(IPet d)", text);
        Assert.Contains("public void Dispose(IPet d)", text);
    }

    [Fact]
    public async Task Refuses_a_type_with_operators()
    {
        const string source = """
            namespace App;
            public class Money : Base { public static Money operator +(Money a, Money b) => a; }
            public class Base { }
            """;
        var h = new Harness(("A.cs", source));
        var info = await UseBaseTypeEngine.InfoAsync(h.Document("A.cs"), Harness.At(source, "class Money", "Money"), true, default);
        Assert.NotNull(info!.Refusal);
    }

    [Fact]
    public async Task Leaves_out_a_change_that_would_clash_with_an_overload()
    {
        const string source = """
            namespace App;

            public class Animal { public string Name { get; set; } }
            public class Dog : Animal { }

            public class Shelter
            {
                public void Show(Dog d) { System.Console.WriteLine(d.Name); }
                public void Show(Animal a) { System.Console.WriteLine(a.Name); }
                public void Other(Dog d) { System.Console.WriteLine(d.Name); }
            }
            """;
        var h = new Harness(("A.cs", source));
        var document = h.Document("A.cs");
        var position = Harness.At(source, "class Dog", "Dog");
        var info = (await UseBaseTypeEngine.InfoAsync(document, position, true, default))!;
        var result = (await UseBaseTypeEngine.RunAsync(document, new UseBaseTypeRequest(position, info.Targets.Single().Id), default))!;
        Assert.Null(result.Errors);
        var text = Harness.Lf(Harness.Apply(source, result));
        Assert.Contains("public void Show(Dog d)", text);             // would be a second Show(Animal)
        Assert.Contains("public void Other(Animal d)", text);
        Assert.Empty(await h.ErrorsAfter(document, result));
    }
}
