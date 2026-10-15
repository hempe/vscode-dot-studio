using Riok.Mapperly.Abstractions;

namespace Shop.Core.Catalog;

// Mapperly (NuGet) generates the mapping code: Dependencies > Analyzers > Riok.Mapperly
[Mapper]
public static partial class ProductMapper
{
    [MapProperty(nameof(Product.Stock), nameof(ProductDto.InStock), Use = nameof(IsInStock))]
    public static partial ProductDto ToDto(this Product product);

    private static bool IsInStock(int stock) => stock > 0;
}
