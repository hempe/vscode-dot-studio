using System;
using Newtonsoft.Json;
class Program { static void Main() { Console.WriteLine(JsonConvert.SerializeObject(new { Hello = "net48" })); } }
