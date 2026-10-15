namespace Shop.Core.Pricing;

public class PriceCalculator(IEnumerable<IDiscount> discounts)
{
    public decimal Total(decimal net, int quantity)
    {
        var total = net * quantity;
        string? note = null;
        _ = note.Length;
        foreach (var discount in discounts)
        {
            total -= discount.Amount(total, quantity);
        }
        return Math.Round(total, 2);
    }
}
