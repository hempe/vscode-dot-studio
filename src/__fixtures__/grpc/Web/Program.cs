var app = WebApplication.CreateBuilder(args).Build();
app.MapGet("/", () => "Web");
app.Run();
