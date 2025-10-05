import React, { useEffect, useState } from "react";
import Markdown from "markdown-to-jsx";
import { formatAuthors, LocalNuGetPackage } from "../shared";

interface NugetDetailProps {
    selectedPackage: LocalNuGetPackage;
}

export default function NugetDetail({ selectedPackage }: NugetDetailProps) {

    return (
        <div style={{ fontSize: '12px' }}>
            {/* Description Section - Special placement at top */}
            {selectedPackage.description && (
                <div style={{ marginBottom: '20px' }}>
                    <div style={{
                        fontWeight: 'bold',
                        marginBottom: '8px',
                        color: 'var(--vscode-foreground)',
                        fontSize: '13px'
                    }}>
                        Description
                    </div>
                    <div style={{
                        lineHeight: '1.5',
                        color: 'var(--vscode-foreground)'
                    }}>
                        {selectedPackage.description}
                    </div>
                </div>
            )}

            {/* Package Information Table */}
            <div style={{
                border: '1px solid var(--vscode-panel-border)',
                borderRadius: '4px',
                overflow: 'hidden'
            }}>
                <div style={{ background: 'var(--vscode-editor-background)' }}>
                    {/* ID */}
                    <div style={{
                        display: 'flex',
                        borderBottom: '1px solid var(--vscode-panel-border)',
                        minHeight: '32px'
                    }}>
                        <div style={{
                            width: '120px',
                            flexShrink: 0,
                            padding: '8px 12px',
                            background: 'var(--vscode-panel-background)',
                            borderRight: '1px solid var(--vscode-panel-border)',
                            fontWeight: '500',
                            color: 'var(--vscode-foreground)'
                        }}>
                            ID
                        </div>
                        <div style={{
                            flex: 1,
                            padding: '8px 12px',
                            color: 'var(--vscode-foreground)'
                        }}>
                            {selectedPackage.id}
                        </div>
                    </div>

                    {/* Version */}
                    <div style={{
                        display: 'flex',
                        borderBottom: '1px solid var(--vscode-panel-border)',
                        minHeight: '32px'
                    }}>
                        <div style={{
                            width: '120px',
                            flexShrink: 0,
                            padding: '8px 12px',
                            background: 'var(--vscode-panel-background)',
                            borderRight: '1px solid var(--vscode-panel-border)',
                            fontWeight: '500',
                            color: 'var(--vscode-foreground)'
                        }}>
                            Version
                        </div>
                        <div style={{
                            flex: 1,
                            padding: '8px 12px',
                            color: 'var(--vscode-foreground)'
                        }}>
                            {selectedPackage.version}
                        </div>
                    </div>

                    {/* Authors */}
                    {!!selectedPackage.authors?.length && (
                        <div style={{
                            display: 'flex',
                            borderBottom: '1px solid var(--vscode-panel-border)',
                            minHeight: '32px'
                        }}>
                            <div style={{
                                width: '120px',
                                flexShrink: 0,
                                padding: '8px 12px',
                                background: 'var(--vscode-panel-background)',
                                borderRight: '1px solid var(--vscode-panel-border)',
                                fontWeight: '500',
                                color: 'var(--vscode-foreground)'
                            }}>
                                Authors
                            </div>
                            <div style={{
                                flex: 1,
                                padding: '8px 12px',
                                color: 'var(--vscode-foreground)'
                            }}>
                                {formatAuthors(selectedPackage.authors)}
                            </div>
                        </div>
                    )}

                    {/* Tags */}
                    {!!selectedPackage.tags?.length && (
                        <div style={{
                            display: 'flex',
                            borderBottom: '1px solid var(--vscode-panel-border)',
                            minHeight: '32px'
                        }}>
                            <div style={{
                                width: '120px',
                                flexShrink: 0,
                                padding: '8px 12px',
                                background: 'var(--vscode-panel-background)',
                                borderRight: '1px solid var(--vscode-panel-border)',
                                fontWeight: '500',
                                color: 'var(--vscode-foreground)'
                            }}>
                                Tags
                            </div>
                            <div style={{
                                flex: 1,
                                padding: '8px 12px',
                                color: 'var(--vscode-foreground)'
                            }}>
                                {selectedPackage.tags.join(', ')}
                            </div>
                        </div>
                    )}

                    {/* Total Downloads */}
                    {!!selectedPackage.totalDownloads && (
                        <div style={{
                            display: 'flex',
                            borderBottom: '1px solid var(--vscode-panel-border)',
                            minHeight: '32px'
                        }}>
                            <div style={{
                                width: '120px',
                                flexShrink: 0,
                                padding: '8px 12px',
                                background: 'var(--vscode-panel-background)',
                                borderRight: '1px solid var(--vscode-panel-border)',
                                fontWeight: '500',
                                color: 'var(--vscode-foreground)'
                            }}>
                                Downloads
                            </div>
                            <div style={{
                                flex: 1,
                                padding: '8px 12px',
                                color: 'var(--vscode-foreground)'
                            }}>
                                {selectedPackage.totalDownloads.toLocaleString()}
                            </div>
                        </div>
                    )}

                    {/* Project URL */}
                    {selectedPackage.projectUrl && (
                        <div style={{
                            display: 'flex',
                            borderBottom: '1px solid var(--vscode-panel-border)',
                            minHeight: '32px'
                        }}>
                            <div style={{
                                width: '120px',
                                flexShrink: 0,
                                padding: '8px 12px',
                                background: 'var(--vscode-panel-background)',
                                borderRight: '1px solid var(--vscode-panel-border)',
                                fontWeight: '500',
                                color: 'var(--vscode-foreground)'
                            }}>
                                Project URL
                            </div>
                            <div style={{
                                flex: 1,
                                padding: '8px 12px',
                                color: 'var(--vscode-foreground)'
                            }}>
                                <a
                                    href={selectedPackage.projectUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                        color: 'var(--vscode-textLink-foreground)',
                                        textDecoration: 'none'
                                    }}
                                >
                                    {selectedPackage.projectUrl}
                                </a>
                            </div>
                        </div>
                    )}

                    {/* License URL */}
                    {selectedPackage.licenseUrl && (
                        <div style={{
                            display: 'flex',
                            minHeight: '32px'
                        }}>
                            <div style={{
                                width: '120px',
                                flexShrink: 0,
                                padding: '8px 12px',
                                background: 'var(--vscode-panel-background)',
                                borderRight: '1px solid var(--vscode-panel-border)',
                                fontWeight: '500',
                                color: 'var(--vscode-foreground)'
                            }}>
                                License
                            </div>
                            <div style={{
                                flex: 1,
                                padding: '8px 12px',
                                color: 'var(--vscode-foreground)'
                            }}>
                                <a
                                    href={selectedPackage.licenseUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                        color: 'var(--vscode-textLink-foreground)',
                                        textDecoration: 'none'
                                    }}
                                >
                                    {selectedPackage.licenseUrl}
                                </a>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}