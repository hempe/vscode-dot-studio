/** What went wrong in one line: an AggregateError from a failed connection has no message of its own, its errors do (ETIMEDOUT, ECONNREFUSED...) */
export function errorReason(error: unknown): string {
    const { message, errors } = (error ?? {}) as { message?: string; errors?: { code?: string; message?: string }[] };
    const inner = [...new Set((errors ?? []).map(e => e.code ?? e.message).filter(Boolean))].join(', ');
    return message || inner || String(error);
}
