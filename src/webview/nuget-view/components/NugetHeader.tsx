import React, { useEffect, useState } from "react";
import Markdown from "markdown-to-jsx";
import { formatAuthors, LocalNuGetPackage } from "../shared";

interface NugetHeaderProps {
    selectedPackage: LocalNuGetPackage;
}

export default function NugetHeader({ selectedPackage }: NugetHeaderProps) {

    return (
    <div style={{ marginBottom: '20px' }}>
        <h2 style={{
            margin: '0 0 8px 0',
            fontSize: '18px',
            fontWeight: 600
        }}>
            {selectedPackage.id}
        </h2>
        <div style={{
            fontSize: '12px',
            color: 'var(--vscode-descriptionForeground)',
            marginBottom: '8px'
        }}>
            by {formatAuthors(selectedPackage.authors)}
        </div>
        <div style={{
            fontSize: '12px',
            color: 'var(--vscode-descriptionForeground)',
            lineHeight: '1.4'
        }}>
            {selectedPackage.description || 'No description available'}
        </div>
    </div>
    );
}