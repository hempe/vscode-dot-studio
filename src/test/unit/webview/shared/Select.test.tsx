import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Select } from '../../../../webview/shared/Select';

const options = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }, { value: 'c', label: 'Gamma' }];

function setup(onChange = jest.fn()) {
    const Host = () => {
        const [value, setValue] = useState('a');
        return <Select aria-label="Letter" value={value} options={options} onChange={v => { onChange(v); setValue(v); }} />;
    };
    render(<Host />);
    return { onChange, trigger: screen.getByRole('button', { name: 'Letter' }) };
}

describe('Select', () => {
    it('closes the list after an option is clicked', () => {
        const { onChange, trigger } = setup();
        fireEvent.click(trigger);
        fireEvent.click(screen.getByRole('option', { name: 'Beta' }));

        expect(onChange).toHaveBeenCalledWith('b');
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(trigger.textContent).toBe('Beta');
        expect(trigger).toHaveProperty('value', 'b');
    });

    it('closes on a click outside and on Escape without changing the value', () => {
        const { onChange, trigger } = setup();
        fireEvent.click(trigger);
        fireEvent.mouseDown(document.body);
        expect(screen.queryByRole('listbox')).toBeNull();

        fireEvent.click(trigger);
        fireEvent.keyDown(trigger, { key: 'Escape' });
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('changes the value with the arrow keys like a native select, and picks with Enter when open', () => {
        const { onChange, trigger } = setup();
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        expect(onChange).toHaveBeenLastCalledWith('b');

        fireEvent.keyDown(trigger, { key: 'Enter' });
        expect(screen.getByRole('listbox')).toBeTruthy();
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        fireEvent.keyDown(trigger, { key: 'Enter' });
        expect(onChange).toHaveBeenLastCalledWith('c');
        expect(screen.queryByRole('listbox')).toBeNull();
    });
});
