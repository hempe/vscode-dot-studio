using Shop.Core.Orders;

namespace Shop.Core.Tests.Orders;

public class OrderTests
{
    [Fact]
    public void SumsTheLines()
    {
        var order = new Order();
        order.Add("Apple", 2, 1.5m);
        order.Add("Pear", 1, 2m);
        Assert.Equal(5m, order.Total);
    }

    [Fact]
    public void RejectsZeroQuantity()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new Order().Add("Apple", 0, 1m));
    }

    [Fact]
    public void FailsOnPurpose()
    {
        var order = new Order();
        order.Add("Apple", 1, 1m);
        Assert.Equal(2m, order.Total);
    }
}
