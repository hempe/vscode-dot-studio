import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
// vscrui ships ES modules only: plain stand-ins for the controls these components use
jest.mock('vscrui', () => {
    const React = require('react');
    return {
        Checkbox: () => null,
        Dropdown: () => null,
        Button: (props: { onClick?: () => void; disabled?: boolean; children?: unknown }) =>
            React.createElement('button', { onClick: props.onClick, disabled: props.disabled }, props.children),
    };
});

import { PackageList } from '../../../../webview/nuget-view/components/PackageList';
import ProjectList from '../../../../webview/nuget-view/components/ProjectList';
import { PackageActions } from '../../../../webview/nuget-view/components/PackageActions';

const props = 'Directory.Packages.props';
const entry = (project: string, id: string, currentVersion: string, versionSource?: string) =>
    ({ id, currentVersion, versionSource, versionFile: versionSource === 'override' ? `${project}.csproj` : props, projectPath: `${project}.csproj`, projectName: project });
const projects = [
    { name: 'App', path: 'App.csproj', framework: 'net8.0', packages: [entry('App', 'Newtonsoft.Json', '13.0.1', 'central'), entry('App', 'Microsoft.SourceLink.GitHub', '8.0.0', 'global')] },
    { name: 'Override', path: 'Override.csproj', framework: 'net8.0', packages: [entry('Override', 'Newtonsoft.Json', '13.0.2', 'override'), entry('Override', 'Microsoft.SourceLink.GitHub', '8.0.0', 'global')] },
    { name: 'Legacy', path: 'Legacy.csproj', framework: 'net8.0', packages: [entry('Legacy', 'Polly', '', 'project')] },
] as any[];
const newtonsoft = { id: 'Newtonsoft.Json', currentVersion: '13.0.1', projects } as any;
const sourceLink = { id: 'Microsoft.SourceLink.GitHub', currentVersion: '8.0.0', versionSource: 'global', projects } as any;

describe('NuGet manager under Central Package Management', () => {
    test('the project list shows each project\'s version with its source, an unknown one as not known', () => {
        render(<ProjectList selectedPackage={newtonsoft} projects={projects} selectedProjects={new Set(['App.csproj'])} setSelectedProjects={jest.fn()} />);
        expect(screen.getByText('v13.0.1')).toBeTruthy();
        expect(screen.getByText('v13.0.2 (override)')).toBeTruthy();
        expect(screen.getByText('Not installed')).toBeTruthy();
    });

    test('global packages carry a "global" badge in the list; others do not', () => {
        render(<PackageList packages={[sourceLink, newtonsoft]} includePrerelease={false} emptyMessage="" selectedIndex={-1} selectedPackage={null}
            selectedItemRef={createRef<HTMLDivElement>()} onPackageSelect={jest.fn()} getPackageIconUrl={() => ''} title="Top-level packages" />);
        expect(screen.getAllByText('global')).toHaveLength(1);
        expect(screen.getByText('global').title).toBe('GlobalPackageReference: every project gets it');
        expect(screen.getByText('v13.0.2 (override)')).toBeTruthy();
    });

    test('"Set for This Project Only" shows when offered and sends the chosen version for the selected projects', () => {
        const setOnly = jest.fn();
        const actions = (onSetForProjectOnly?: jest.Mock) => (
            <PackageActions selectedPackage={newtonsoft} selectedVersion="13.0.3" selectedProjects={new Set(['App.csproj'])} initializing={false}
                onVersionChange={jest.fn()} onInstallUpdate={jest.fn()} onUninstall={jest.fn()} getVersionOptions={() => []} onSetForProjectOnly={onSetForProjectOnly} />
        );
        const { rerender } = render(actions());
        expect(screen.queryByText('Set for This Project Only')).toBeNull();
        rerender(actions(setOnly));
        fireEvent.click(screen.getByText('Set for This Project Only'));
        expect(setOnly).toHaveBeenCalledWith(newtonsoft, ['App.csproj'], '13.0.3');
    });
});
