import * as crypto from 'crypto';

/** A fresh nonce for a webview's Content-Security-Policy: unguessable (a nonce a page can predict protects nothing) */
export function getNonce(): string {
    return crypto.randomBytes(16).toString('base64');
}
