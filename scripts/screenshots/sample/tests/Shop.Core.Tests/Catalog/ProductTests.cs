using Shop.Core.Catalog;

namespace Shop.Core.Tests.Catalog;

// Tests code from source generators: Mapperly (NuGet) and Shop.Generators (our own)
public class ProductTests
{
    private readonly Product _apple = new() { Name = "Apple", Price = 1.5m, Stock = 0 };

    [Fact]
    public void MapsToTheDto()
    {
        Assert.Equal(new ProductDto("Apple", 1.5m, false), _apple.ToDto());
    }

    [Fact]
    public void DescribesItself()
    {
        Assert.Equal("Product(Name=Apple, Price=1.5, Stock=0)", _apple.Describe());
    }
}
