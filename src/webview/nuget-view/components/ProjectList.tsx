import React, { useEffect, useState } from "react";
import Markdown from "markdown-to-jsx";
import { ensureArray, formatAuthors, LocalNuGetPackage } from "../shared";
import { Checkbox } from "vscrui";

interface ProjectListProps {
    selectedPackage: LocalNuGetPackage;
    projects?: { name: string; version: string }[];
    installedPackages?: LocalNuGetPackage[];
    selectedProjects: Set<string>;
    setSelectedProjects: (projects: Set<string>) => void;
}

export default function ProjectList({ 
    selectedPackage,
    projects, 
    installedPackages = [],
    selectedProjects,
    setSelectedProjects
}: ProjectListProps) {

    return (
        <div style={{
            background: 'var(--vscode-panel-background)',
            border: '1px solid var(--vscode-panel-border)',
            borderRadius: '4px',
            padding: '8px 16px',
            marginBottom: '16px'
        }}>
            {/* Get all available projects from the solution */}
            {(() => {
                // For Browse tab, show all projects from the solution
                const projectList = ensureArray(projects).map(project => {
                    // Check if this project already has the selected package installed
                    const existingInstall = ensureArray(installedPackages)
                        .find(pkg => pkg.id === selectedPackage.id && pkg.projects?.some(p => p.name === project.name));

                    return {
                        name: project.name,
                        version: existingInstall?.projects?.find(p => p.name === project.name)?.version || null
                    };
                });

                return projectList.map((project, idx) => (
                    <div key={idx} style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '8px 0',
                        borderBottom: idx < projectList.length - 1
                            ? '1px solid var(--vscode-panel-border)'
                            : 'none'
                    }}>
                        <Checkbox
                            checked={selectedProjects.has(project.name)}
                            onChange={() => {
                                const newSelected = new Set(selectedProjects);
                                if (newSelected.has(project.name)) {
                                    newSelected.delete(project.name);
                                } else {
                                    newSelected.add(project.name);
                                }
                                setSelectedProjects(newSelected);
                            }}
                        />
                        <div style={{
                            marginLeft: '8px',
                            flex: 1,
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center'
                        }}>
                            <div style={{ fontSize: '13px' }}>
                                {project.name}
                            </div>
                            <div style={{
                                fontSize: '11px',
                                color: 'var(--vscode-descriptionForeground)',
                                marginLeft: '8px',
                                flexShrink: 0
                            }}>
                                {project.version ? `v${project.version}` : 'Not installed'}
                            </div>
                        </div>
                    </div>
                ));
            })()}
        </div>
    );
}