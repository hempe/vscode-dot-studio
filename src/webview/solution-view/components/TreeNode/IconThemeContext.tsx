import React from 'react';
import { IconThemePayload } from '../../../../types/iconTheme';

/** The user's file icon theme; null until it arrives or when no theme is set */
export const IconThemeContext = React.createContext<IconThemePayload | null>(null);

export const themeFontFamily = (fontId: string) => `theme-icon-${fontId}`;

/** `@font-face` rules for the fonts of font-based icon themes (e.g. Seti) */
export const IconThemeFonts: React.FC<{ theme: IconThemePayload | null }> = ({ theme }) => {
    if (!theme?.fonts.length) {
        return null;
    }
    const rules = theme.fonts.map(font =>
        `@font-face { font-family: '${themeFontFamily(font.id)}'; src: url('${font.src}')${font.format ? ` format('${font.format}')` : ''};` +
        ` font-weight: ${font.weight ?? 'normal'}; font-style: ${font.style ?? 'normal'}; }`);
    return <style>{rules.join('\n')}</style>;
};
