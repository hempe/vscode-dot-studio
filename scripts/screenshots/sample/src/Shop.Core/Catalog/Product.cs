using Shop.Generated;

namespace Shop.Core.Catalog;

// [Describe] comes from our own generator (Shop.Generators): it generates Product.Describe.g.cs
[Describe]
public partial class Product
{
    public required string Name { get; init; }
    public decimal Price { get; init; }
    public int Stock { get; init; }
}

public record ProductDto(string Name, decimal Price, bool InStock);
