using Shop.Core.Orders;

namespace Shop.Core.Tests.Helpers;

// No tests in this folder: "Run Tests" on it says so
public static class OrderBuilder
{
    public static Order WithApples(int count)
    {
        var order = new Order();
        order.Add("Apple", count, 1m);
        return order;
    }
}
