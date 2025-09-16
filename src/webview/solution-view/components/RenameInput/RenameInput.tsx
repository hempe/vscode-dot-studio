import React, { useState, useEffect, useRef } from 'react';

export interface RenameInputProps {
    initialValue: string;
    onConfirm: (newName: string) => void;
    onCancel: () => void;
}

export const RenameInput: React.FC<RenameInputProps> = ({
    initialValue,
    onConfirm,
    onCancel
}) => {
    const [value, setValue] = useState(initialValue);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.focus();
            // Select filename without extension for files
            const lastDotIndex = initialValue.lastIndexOf('.');
            if (lastDotIndex > 0) {
                inputRef.current.setSelectionRange(0, lastDotIndex);
            } else {
                inputRef.current.select();
            }
        }
    }, [initialValue]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (value.trim() && value !== initialValue) {
                onConfirm(value.trim());
            } else {
                onCancel();
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        }
    };

    const handleBlur = () => {
        if (value.trim() && value !== initialValue) {
            onConfirm(value.trim());
        } else {
            onCancel();
        }
    };

    return (
        <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            className="rename-input"
        />
    );
};