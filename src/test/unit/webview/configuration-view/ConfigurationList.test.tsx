import { fireEvent, render, screen } from '@testing-library/react';
import { ConfigurationList } from '../../../../webview/configuration-view/ConfigurationList';
import { ConfigurationManagerRequest } from '../../../../types/configurationManager';

const setup = (names: string[], kind: 'configuration' | 'platform' = 'configuration') => {
    const sent: ConfigurationManagerRequest[] = [];
    render(<ConfigurationList kind={kind} names={names} active={names[0]} post={r => sent.push(r)} />);
    return sent;
};

describe('ConfigurationList', () => {
    it('adds a name copying from the active entry, then clears the input', () => {
        const sent = setup(['Debug', 'Release']);
        const add = screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement;
        expect(add.disabled).toBe(true);
        const input = screen.getByLabelText('New configuration name') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Staging' } });
        fireEvent.click(add);
        expect(sent).toEqual([{ type: 'addConfiguration', name: 'Staging', copyFrom: 'Debug' }]);
        expect(input.value).toBe('');
    });

    it('adds a platform with the platform request', () => {
        const sent = setup(['Any CPU'], 'platform');
        fireEvent.change(screen.getByLabelText('New platform name'), { target: { value: 'x64' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));
        expect(sent).toEqual([{ type: 'addPlatform', name: 'x64', copyFrom: 'Any CPU' }]);
    });

    it('renames with Enter and cancels with Escape', () => {
        const sent = setup(['Debug', 'Release']);
        fireEvent.click(screen.getByRole('button', { name: 'Rename Release' }));
        let input = screen.getByLabelText('New name for Release') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Prod' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(sent).toEqual([{ type: 'renameConfiguration', from: 'Release', to: 'Prod' }]);

        fireEvent.click(screen.getByRole('button', { name: 'Rename Debug' }));
        input = screen.getByLabelText('New name for Debug') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Dev' } });
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(sent).toHaveLength(1);
        expect(screen.queryByLabelText('New name for Debug')).toBeNull();
    });

    it('removes, but not the last entry', () => {
        const sent = setup(['Debug', 'Release']);
        fireEvent.click(screen.getByRole('button', { name: 'Remove Release' }));
        expect(sent).toEqual([{ type: 'removeConfiguration', name: 'Release' }]);
    });

    it('disables Remove for the last entry', () => {
        setup(['Debug']);
        expect((screen.getByRole('button', { name: 'Remove Debug' }) as HTMLButtonElement).disabled).toBe(true);
    });
});
