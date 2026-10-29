import * as path from 'path';
import { hotReloadArgs, hotReloadTerminalName } from '../../../../../services/debug/hotReload/hotReloadCommand';

describe('hotReloadArgs', () => {
    const projectPath = path.resolve('src', 'Shop.Web', 'Shop.Web.csproj');

    it('runs dotnet watch with the launch profile, the configuration and the framework', () => {
        expect(hotReloadArgs({ projectPath, launchProfile: 'https', configuration: 'Debug', framework: 'net10.0' })).toEqual([
            'watch', 'run', '--project', projectPath, '--launch-profile', 'https', '--non-interactive',
            '--configuration', 'Debug', '--framework', 'net10.0',
        ]);
    });

    it('runs without a launch profile when the project has none', () => {
        const args = hotReloadArgs({ projectPath, configuration: 'Release' });
        expect(args).toContain('--no-launch-profile');
        expect(args).not.toContain('--launch-profile');
        expect(args).not.toContain('--framework');
        expect(args.slice(-2)).toEqual(['--configuration', 'Release']);
    });

    it('passes MSBuild properties (the platform) last', () => {
        const args = hotReloadArgs({ projectPath, launchProfile: 'http', configuration: 'Debug', framework: null, properties: ['-property:Platform=x64'] });
        expect(args[args.length - 1]).toBe('-property:Platform=x64');
        expect(args).not.toContain('--framework');
    });

    it('keeps a launch profile name with spaces as one argument', () => {
        const args = hotReloadArgs({ projectPath, launchProfile: 'Shop Web', configuration: 'Debug' });
        expect(args[args.indexOf('--launch-profile') + 1]).toBe('Shop Web');
    });
});

describe('hotReloadTerminalName', () => {
    it('names the terminal after the project', () => {
        expect(hotReloadTerminalName(path.resolve('src', 'Shop.Web', 'Shop.Web.csproj'))).toBe('Shop.Web (watch)');
        expect(hotReloadTerminalName(path.resolve('App.fsproj'))).toBe('App (watch)');
    });
});

