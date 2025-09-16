import React from 'react';
import { FrameworkSelectorProps } from '../../types';

export const FrameworkSelector: React.FC<FrameworkSelectorProps> = ({
    frameworks,
    activeFramework,
    onFrameworkChange
}) => {
    if (frameworks.length === 0) {
        return null;
    }

    return (
        <div className="framework-selector">
            <label htmlFor="framework-select">Target Framework:</label>
            <select
                id="framework-select"
                value={activeFramework || 'Auto'}
                onChange={(e) => onFrameworkChange(e.target.value)}
            >
                <option value="Auto">Auto</option>
                {frameworks.map(framework => (
                    <option key={framework} value={framework}>
                        {framework}
                    </option>
                ))}
            </select>
        </div>
    );
};