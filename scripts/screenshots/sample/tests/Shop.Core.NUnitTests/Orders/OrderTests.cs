using Shop.Core.Orders;

namespace Shop.Core.NUnitTests.Orders;

// Classic VSTest project (NUnit + NUnit3TestAdapter): one passes, one fails on purpose, parameterized cases
public class OrderTests
{
    [Test]
    public void SumsTheLines()
    {
        var order = new Order();
        order.Add("Apple", 2, 1.5m);
        Assert.That(order.Total, Is.EqualTo(3m));
    }

    [Test]
    public void FailsOnPurpose()
    {
        Assert.That(new Order().Total, Is.EqualTo(1m));
    }

    [TestCase(1)]
    [TestCase(3)]
    public void CountsQuantities(int quantity)
    {
        var order = new Order();
        order.Add("Pear", quantity, 2m);
        Assert.That(order.Lines[0].Quantity, Is.EqualTo(quantity));
    }
}
