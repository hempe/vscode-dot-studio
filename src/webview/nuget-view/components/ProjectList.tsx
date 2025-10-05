import React, { useEffect, useState } from "react";
import Markdown from "markdown-to-jsx";
import { ensureArray, formatAuthors, LocalNuGetPackage } from "../shared";
import { Checkbox } from "vscrui";
import { logger } from "../../shared/logger";

const log = logger('ProjectList');

interface ProjectInfo {
    name: string;
    path: string;
    framework: string;
    packages: any[];
}

interface ProjectListProps {
    selectedPackage: LocalNuGetPackage;
    projects?: ProjectInfo[];
    installedPackages?: LocalNuGetPackage[];
    selectedProjects: Set<string>;
    setSelectedProjects: (projects: Set<string>) => void;
    initializing?: boolean;
    projectPath?: string; // For project-specific context
}

export default function ProjectList({
    selectedPackage,
    projects,
    installedPackages = [],
    selectedProjects,
    setSelectedProjects,
    initializing = false,
    projectPath
}: ProjectListProps) {

    // Auto-select the current project when opening from project context
    useEffect(() => {
        if (projectPath && projects) {
            const currentProject = projects.find(p => p.path === projectPath);
            if (currentProject && !selectedProjects.has(currentProject.path)) {
                log.info('Auto-selecting current project:', currentProject.name);
                setSelectedProjects(new Set([currentProject.path]));
            }
        }
    }, [projectPath, projects, selectedProjects, setSelectedProjects]);

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
                // Use projects directly - no need to transform since they already have all needed info
                const projectList = ensureArray(projects);

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
                            checked={selectedProjects.has(project.path)}
                            disabled={initializing || (projectPath === project.path)}
                            onChange={() => {
                                if (!initializing && projectPath !== project.path) {
                                    const newSelected = new Set(selectedProjects);
                                    if (newSelected.has(project.path)) {
                                        newSelected.delete(project.path);
                                    } else {
                                        newSelected.add(project.path);
                                    }
                                    setSelectedProjects(newSelected);
                                }
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
                                {(() => {
                                    const installedPackage = project.packages?.find((pkg: any) => pkg.id === selectedPackage.id);
                                    return installedPackage ? `v${installedPackage.version}` : 'Not installed';
                                })()}
                            </div>
                        </div>
                    </div>
                ));
            })()}
        </div>
    );
}