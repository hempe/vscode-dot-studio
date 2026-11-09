using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.Extensions;

namespace Shinobi.Refactorings;

/// <summary>
/// A handler of a message about a document, for both versions of the server's extension API. Roslyn 5.13 moved the handler
/// interface from Microsoft.CodeAnalysis.ExternalAccess.Extensions into Microsoft.CodeAnalysis.Workspaces and passes the document in
/// the context; the build for 5.13 and later (ExtensionsApi=5.13, see the project file) implements that one.
/// </summary>
public abstract class DocumentHandler<TMessage, TResponse> : IExtensionDocumentMessageHandler<TMessage, TResponse>
{
#if EXTENSIONS_API_5_13
    public Task<TResponse> ExecuteAsync(TMessage message, ExtensionDocumentMessageContext context, CancellationToken cancellationToken)
        => ExecuteAsync(message, context.TextDocument as Document ?? throw new InvalidOperationException($"{context.TextDocument.Name} is not a source document."), cancellationToken);
#else
    public Task<TResponse> ExecuteAsync(TMessage message, ExtensionMessageContext context, Document document, CancellationToken cancellationToken)
        => ExecuteAsync(message, document, cancellationToken);
#endif

    public abstract Task<TResponse> ExecuteAsync(TMessage message, Document document, CancellationToken cancellationToken);
}
