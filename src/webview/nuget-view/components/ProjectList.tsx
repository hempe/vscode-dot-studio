import { useEffect } from "react";
import { ensureArray, LocalNuGetPackage } from "../shared";
import { Checkbox } from "vscrui";
import { logger } from "../../shared/logger";
import { ProjectInfo as BackendProjectInfo } from "../../../services/nuget/types";

const log = logger('ProjectList');

interface ProjectListProps {
    selectedPackage: LocalNuGetPackage;
    projects?: BackendProjectInfo[];
    selectedProjects: Set<string>;
    setSelectedProjects: (projects: Set<string>) => void;
    initializing?: boolean;
    projectPath?: string; // For project-specific context
}

export default function ProjectList({
    selectedPackage,
    projects,
    selectedProjects,
    setSelectedProjects,
    initializing = false,
    projectPath
}: ProjectListProps) {

    // Auto-select projects based on context
    useEffect(() => {
        if (projects && projects.length > 0) {
            // If there's only one project, always auto-select it
            if (projects.length === 1 && !selectedProjects.has(projects[0].path)) {
                log.info('Auto-selecting single project:', projects[0].name);
                setSelectedProjects(new Set([projects[0].path]));
            }
            // If opening from project context, auto-select the current project
            else if (projectPath) {
                const currentProject = projects.find(p => p.path === projectPath);
                if (currentProject && !selectedProjects.has(currentProject.path)) {
                    log.info('Auto-selecting current project:', currentProject.name);
                    setSelectedProjects(new Set([currentProject.path]));
                }
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
                        {projectList.length > 1 && (
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
                        )}
                        <div style={{
                            marginLeft: projectList.length > 1 ? '8px' : '0px',
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
                                    const installedPackage = project.packages?.find(pkg => pkg.id === selectedPackage.id);
                                    return installedPackage ? `v${installedPackage.currentVersion}` : 'Not installed';
                                })()}
                            </div>
                        </div>
                    </div>
                ));
            })()}
        </div>
    );
}