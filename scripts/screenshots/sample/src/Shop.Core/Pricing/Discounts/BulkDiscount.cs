namespace Shop.Core.Pricing;

/// <summary>10% off from 10 items on</summary>
public class BulkDiscount : IDiscount
{
    public decimal Amount(decimal total, int quantity) => quantity >= 10 ? total * 0.1m : 0;
}
