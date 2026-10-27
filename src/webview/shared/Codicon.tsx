import React from 'react';

interface CodiconProps {
    /** A codicon name, e.g. `folder` (the icon font of VS Code, loaded by the view: no icon is bundled or fetched) */
    icon: string;
    className?: string;
    /** Size in pixels */
    width?: string;
    height?: string;
    style?: React.CSSProperties;
}

/** An icon of VS Code's own icon font; the built-in fallback for rows the user's file icon theme has no icon for */
export const Codicon: React.FC<CodiconProps> = ({ icon, className, width, style }) => (
    <span
        aria-hidden="true"
        className={`codicon codicon-${icon}${className ? ` ${className}` : ''}`}
        style={{ fontSize: width ? `${width}px` : undefined, lineHeight: 1, ...style }}
    />
);
