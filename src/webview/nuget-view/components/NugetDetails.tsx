import { useState } from "react";
import { LocalNuGetPackage } from "../shared";
import { PackageAdvisory } from "../../../services/nuget/types";
import NugetReadme from "./NugetReadme";
import NugetDetail from "./NugetDetail";

interface NugetDetailProps {
    selectedPackage: LocalNuGetPackage;
    packageReadmes: Map<string, string>;
    advisory?: PackageAdvisory;
    /** Package Source Mapping: the sources that may provide the package, `[]` none, undefined when there is no mapping */
    mappedSources?: string[];
}
export default function NugetDetails({ selectedPackage, packageReadmes, advisory, mappedSources }: NugetDetailProps) {
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
                <NugetDetail selectedPackage={selectedPackage} advisory={advisory} mappedSources={mappedSources} />
            )}

            {detailsTab === 'readme' && (
                <NugetReadme
                    packageId={selectedPackage.id}
                    version={selectedPackage.currentVersion}
                    readmeUrl={packageReadmes.get(selectedPackage.id.toLowerCase())}
                />
            )}
        </>
    );
}
