import * as React from 'react';

/** Elements a package README may not use: it is written by anyone who publishes a package */
const BLOCKED_TAGS = new Set(['form', 'input', 'button', 'select', 'textarea', 'option', 'base', 'link', 'meta', 'iframe', 'frame', 'object', 'embed', 'script', 'style', 'svg']);

/** Style properties a README may not set: it must not cover or leave its own box */
const BLOCKED_STYLE = new Set(['position', 'zIndex', 'inset', 'top', 'left', 'right', 'bottom']);

/** `createElement` for markdown-to-jsx: drops blocked elements and positioning from inline styles */
export function readmeElement(type: string | React.ComponentType, props: Record<string, unknown> | null, ...children: React.ReactNode[]): React.ReactElement | null {
    if (typeof type === 'string' && BLOCKED_TAGS.has(type.toLowerCase())) {
        return null;
    }
    const style = props?.style;
    if (props && style && typeof style === 'object') {
        const safe = Object.fromEntries(Object.entries(style as Record<string, unknown>).filter(([name]) => !BLOCKED_STYLE.has(name)));
        return React.createElement(type as string, { ...props, style: safe }, ...children);
    }
    return React.createElement(type as string, props, ...children);
}
