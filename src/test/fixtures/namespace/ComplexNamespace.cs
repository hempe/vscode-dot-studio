// Complex example with global usings and comments
global using System;
global using System.Collections.Generic;

using Microsoft.Extensions.DependencyInjection;
using MyProject.Interfaces;

/*
 * Multi-line comment before namespace
 * This should be ignored by the parser
 */

namespace MyCompany.MyProject.Services.Core; // Inline comment

/// <summary>
/// Complex service implementation
/// </summary>
public partial class ComplexService : IComplexService
{
    private readonly IServiceProvider _serviceProvider;

    public ComplexService(IServiceProvider serviceProvider)
    {
        _serviceProvider = serviceProvider;
    }

    public async Task<string> ProcessAsync(string input)
    {
        // Implementation
        return await Task.FromResult($"Processed: {input}");
    }
}

// Another class in the same file
internal sealed class ComplexHelper
{
    public static void Help() => Console.WriteLine("Helping...");
}