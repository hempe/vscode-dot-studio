using Shop.Core.Pricing;

namespace Shop.Worker;

// Logs a price every 5 seconds, so you can see it run next to Shop.Web ("Debug > Start New Instance")
public partial class Worker(ILogger<Worker> logger) : BackgroundService
{
    private readonly PriceCalculator _calculator = new([new BulkDiscount()]);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            LogPrice(_calculator.Total(1.5m, 12), DateTimeOffset.Now);
            await Task.Delay(5000, stoppingToken);
        }
    }

    // Source generated logging: Dependencies > Analyzers > Microsoft.Extensions.Logging.Generators
    [LoggerMessage(Level = LogLevel.Information, Message = "12 apples at 1.50 cost {Total} at {Time}")]
    private partial void LogPrice(decimal total, DateTimeOffset time);
}
