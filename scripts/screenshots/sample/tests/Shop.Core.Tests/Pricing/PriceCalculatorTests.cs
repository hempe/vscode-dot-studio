using Shop.Core.Pricing;

namespace Shop.Core.Tests.Pricing;

public class PriceCalculatorTests
{
    [Fact]
    public void MultipliesByQuantity()
    {
        Assert.Equal(30m, new PriceCalculator([]).Total(10m, 3));
    }

    [Theory]
    [InlineData(9, 90)]
    [InlineData(10, 90)]
    [InlineData(20, 180)]
    public void GivesBulkDiscountFromTenItems(int quantity, decimal expected)
    {
        Assert.Equal(expected, new PriceCalculator([new BulkDiscount()]).Total(10m, quantity));
    }
}
