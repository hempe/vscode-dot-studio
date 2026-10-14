import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
// vscrui ships ES modules only; the list uses just its Checkbox (Updates tab)
jest.mock('vscrui', () => ({ Checkbox: () => null }));

import { PackageList } from '../../../../webview/nuget-view/components/PackageList';

const transitive = [
    { id: 'Microsoft.Data.Sqlite.Core', currentVersion: '10.0.13', transitiveReferencedBy: ['Microsoft.EntityFrameworkCore.Sqlite'] },
    { id: 'SQLitePCLRaw.core', currentVersion: '2.1.13', transitiveReferencedBy: ['Microsoft.EntityFrameworkCore.Sqlite'] },
] as any[];

const props = {
    includePrerelease: false,
    emptyMessage: '',
    selectedPackage: null,
    selectedItemRef: createRef<HTMLDivElement>(),
    getPackageIconUrl: () => '',
    title: 'Transitive packages',
    getNote: (pkg: any) => `Transitively referenced by ${pkg.transitiveReferencedBy.join(', ')}`,
};

describe('PackageList: the Installed tab\'s "Transitive packages" section', () => {
    it('shows only its title and count while collapsed, and expands on click', () => {
        const toggle = jest.fn();
        render(<PackageList {...props} packages={transitive} selectedIndex={-1} onPackageSelect={jest.fn()} collapsed onToggleCollapsed={toggle} />);

        expect(screen.getByRole('button').textContent).toBe('▸ Transitive packages (2)');
        expect(screen.queryByText('SQLitePCLRaw.core')).toBeNull();

        fireEvent.click(screen.getByRole('button'));
        expect(toggle).toHaveBeenCalled();
    });

    it('lists the packages with what brings them in, numbered after the top-level packages', () => {
        const select = jest.fn();
        render(<PackageList {...props} packages={transitive} selectedIndex={4} onPackageSelect={select} collapsed={false} onToggleCollapsed={jest.fn()} indexOffset={3} />);

        expect(screen.getAllByText('Transitively referenced by Microsoft.EntityFrameworkCore.Sqlite')).toHaveLength(2);
        fireEvent.click(screen.getByText('Microsoft.Data.Sqlite.Core'));
        expect(select).toHaveBeenCalledWith(transitive[0], 3);
    });
});
