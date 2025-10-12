using System;
using System.Collections.Generic;

namespace MyProject.Services;

public class FileScopedService
{
    public void DoSomething()
    {
        Console.WriteLine("File-scoped namespace example");
    }
}

public record ServiceRequest(string Name, int Value);