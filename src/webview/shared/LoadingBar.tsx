import React from 'react';

interface LoadingBarProps {
    visible: boolean;
    className?: string;
}

/**
 * Shared loading progress bar component with VS Code styling
 * Used across different webview components for consistent loading indicators
 */
export const LoadingBar: React.FC<LoadingBarProps> = ({ visible, className }) => {
    if (!visible) return null;

    return (
        <div
            className={className}
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '2px', // VS Code style thin bar
                backgroundColor: 'var(--vscode-progressBar-background)',
                zIndex: 1000,
                overflow: 'hidden'
            }}
        >
            <div style={{
                height: '100%',
                backgroundColor: 'var(--vscode-progressBar-foreground)',
                animation: 'loading-progress 1.5s ease-in-out infinite',
                width: '30%',
                transform: 'translateX(-100%)'
            }}></div>
        </div>
    );
};

interface LoadingMessageProps {
    loading: boolean;
    message?: string;
    emptyMessage?: string;
    noResultsMessage?: string;
    searchTerm?: string;
    hasResults?: boolean;
    className?: string;
}

/**
 * Shared loading message component for consistent feedback
 */
export const LoadingMessage: React.FC<LoadingMessageProps> = ({
    loading,
    message = "Loading...",
    emptyMessage = "No items to display",
    noResultsMessage,
    searchTerm,
    hasResults,
    className
}) => {
    const getDisplayMessage = () => {
        if (loading) return message;

        if (searchTerm && !hasResults) {
            return noResultsMessage || `No results found for "${searchTerm}"`;
        }

        return emptyMessage;
    };

    return (
        <div
            className={className}
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '40px 20px',
                color: 'var(--vscode-descriptionForeground)',
                fontSize: '14px'
            }}
        >
            {getDisplayMessage()}
        </div>
    );
};