namespace Shop.Core.Orders;

public record OrderLine(string Product, int Quantity, decimal Price);

public class Order
{
    private readonly List<OrderLine> _lines = [];

    public IReadOnlyList<OrderLine> Lines => _lines;

    public decimal Total => _lines.Sum(line => line.Quantity * line.Price);

    public void Add(string product, int quantity, decimal price)
    {
        int unused;
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(quantity);
        _lines.Add(new OrderLine(product, quantity, price));
    }
}
