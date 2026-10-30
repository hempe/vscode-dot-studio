import { fireEvent, render, screen } from '@testing-library/react';
import { DiagnosticsHint } from '../../../../../webview/solution-view/components/DiagnosticsHint';

const anchor = { top: 100, bottom: 116 } as DOMRect;

describe('DiagnosticsHint', () => {
    it('shows what the marker counts as a link that shows them in the Error List', () => {
        const onShow = jest.fn();
        render(<DiagnosticsHint text="1 error, 3 infos" anchor={anchor} onHover={jest.fn()} onShow={onShow} />);
        fireEvent.click(screen.getByText('1 error, 3 infos'));
        expect(onShow).toHaveBeenCalledTimes(1);
    });

    it('tells the tree when the mouse is on it, so it stays open', () => {
        const onHover = jest.fn();
        const { container } = render(<DiagnosticsHint text="2 warnings" anchor={anchor} onHover={onHover} onShow={jest.fn()} />);
        const hint = container.querySelector('.diagnostics-hint')!;
        fireEvent.mouseEnter(hint);
        fireEvent.mouseLeave(hint);
        expect(onHover.mock.calls).toEqual([[true], [false]]);
    });
});
