import React, { useEffect, useState } from "react";
import Markdown from "markdown-to-jsx";
import { formatAuthors, LocalNuGetPackage } from "../shared";
import NugetReadme from "./NugetReadme";
import NugetDetail from "./NugetDetail";

interface NugetDetailProps {
    selectedPackage: LocalNuGetPackage;
    packageReadmes: Map<string, string>;
}
export default function NugetDetails({ selectedPackage, packageReadmes }: NugetDetailProps) {
    const [detailsTab, setDetailsTab] = useState<'details' | 'readme'>('details');

    return (
        <>
            <div
                style={{
                    display: 'flex',
                    borderBottom: '1px solid var(--vscode-panel-border)',
                    marginBottom: '16px',
                }}
            >
                <button
                    onClick={() => setDetailsTab('details')}
                    style={{
                        background: 'none',
                        border: 'none',
                        padding: '8px 16px',
                        fontSize: '13px',
                        color:
                            detailsTab === 'details'
                                ? 'var(--vscode-foreground)'
                                : 'var(--vscode-descriptionForeground)',
                        borderBottom:
                            detailsTab === 'details'
                                ? '2px solid var(--vscode-focusBorder)'
                                : '2px solid transparent',
                        cursor: 'pointer',
                        fontWeight: detailsTab === 'details' ? 600 : 400,
                    }}
                >
                    Package Details
                </button>
                <button
                    onClick={() => setDetailsTab('readme')}
                    style={{
                        background: 'none',
                        border: 'none',
                        padding: '8px 16px',
                        fontSize: '13px',
                        color:
                            detailsTab === 'readme'
                                ? 'var(--vscode-foreground)'
                                : 'var(--vscode-descriptionForeground)',
                        borderBottom:
                            detailsTab === 'readme'
                                ? '2px solid var(--vscode-focusBorder)'
                                : '2px solid transparent',
                        cursor: 'pointer',
                        fontWeight: detailsTab === 'readme' ? 600 : 400,
                    }}
                >
                    README
                </button>
            </div>

            {detailsTab === 'details' && (
                <NugetDetail selectedPackage={selectedPackage} />
            )}

            {detailsTab === 'readme' && (
                <NugetReadme
                    packageId={selectedPackage.id}
                    version={selectedPackage.version}
                    readmeUrl={packageReadmes.get(selectedPackage.id.toLowerCase())}
                />
            )}
        </>
    );
}
