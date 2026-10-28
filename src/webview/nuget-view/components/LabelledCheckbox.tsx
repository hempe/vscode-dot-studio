import React from 'react';
import { Checkbox } from 'vscrui';

interface LabelledCheckboxProps {
    checked: boolean;
    onChange(checked: boolean): void;
    disabled?: boolean;
    children: React.ReactNode;
}

/** A checkbox whose label toggles it too, as in the filter rows of the manager */
export const LabelledCheckbox: React.FC<LabelledCheckboxProps> = ({ checked, onChange, disabled, children }) => (
    <>
        <Checkbox checked={checked} onChange={onChange} disabled={disabled} />
        <label
            style={{ fontSize: '13px', color: 'var(--vscode-foreground)', cursor: disabled ? 'default' : 'pointer' }}
            onClick={() => !disabled && onChange(!checked)}
        >
            {children}
        </label>
    </>
);
