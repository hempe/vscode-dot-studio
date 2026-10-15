using Shop.Core.Pricing;

namespace Shop.Core.XUnit2Tests.Pricing;

// Classic VSTest project (xUnit v2 + xunit.runner.visualstudio): one passes, one fails on purpose, one theory
public class BulkDiscountTests
{
    [Fact]
    public void NoDiscountBelowTen()
    {
        Assert.Equal(0m, new BulkDiscount().Amount(90m, 9));
    }

    [Fact]
    public void FailsOnPurpose()
    {
        Assert.Equal(5m, new BulkDiscount().Amount(100m, 10));
    }

    [Theory]
    [InlineData(10, 10)]
    [InlineData(20, 20)]
    public void TenPercentFromTen(int quantity, decimal expected)
    {
        Assert.Equal(expected, new BulkDiscount().Amount(100m * quantity / 10, quantity));
    }
}
