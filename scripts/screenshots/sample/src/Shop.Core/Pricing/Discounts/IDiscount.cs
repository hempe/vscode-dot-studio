namespace Shop.Core.Pricing;

public interface IDiscount
{
    decimal Amount(decimal total, int quantity);
}
