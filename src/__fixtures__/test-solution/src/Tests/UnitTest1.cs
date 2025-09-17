using Xunit;
using ClassLibrary;

namespace Tests
{
    public class UnitTest1
    {
        [Fact]
        public void Test1()
        {
            var cls = new Class1();
            var result = cls.GetMessage();
            Assert.Equal("Hello from ClassLibrary", result);
        }
    }
}