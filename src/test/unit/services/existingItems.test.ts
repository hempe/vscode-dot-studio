import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { copyExistingItems } from '../../../services/existingItems';

describe('copyExistingItems', () => {
    let root: string;
    let source: string;
    let target: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'existing-items-'));
        source = path.join(root, 'elsewhere');
        target = path.join(root, 'Project', 'Models');
        fs.mkdirSync(source, { recursive: true });
        fs.mkdirSync(target, { recursive: true });
    });

    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    const write = (file: string, content: string) => {
        fs.writeFileSync(file, content);
        return file;
    };

    it('copies the files into the folder, like Visual Studio', async () => {
        const a = write(path.join(source, 'Customer.cs'), 'class Customer {}');
        const b = write(path.join(source, 'Order.cs'), 'class Order {}');

        const added = await copyExistingItems([a, b], target, async () => false);

        expect(added).toEqual([path.join(target, 'Customer.cs'), path.join(target, 'Order.cs')]);
        expect(fs.readFileSync(path.join(target, 'Customer.cs'), 'utf8')).toBe('class Customer {}');
        expect(fs.existsSync(a)).toBe(true);
    });

    it('asks before replacing a file of the same name and skips it when declined', async () => {
        write(path.join(target, 'Customer.cs'), 'old');
        const a = write(path.join(source, 'Customer.cs'), 'new');
        const asked: string[] = [];

        const added = await copyExistingItems([a], target, async name => { asked.push(name); return false; });

        expect(asked).toEqual(['Customer.cs']);
        expect(added).toEqual([]);
        expect(fs.readFileSync(path.join(target, 'Customer.cs'), 'utf8')).toBe('old');
    });

    it('replaces the file when confirmed', async () => {
        write(path.join(target, 'Customer.cs'), 'old');
        const a = write(path.join(source, 'Customer.cs'), 'new');

        const added = await copyExistingItems([a], target, async () => true);

        expect(added).toEqual([path.join(target, 'Customer.cs')]);
        expect(fs.readFileSync(path.join(target, 'Customer.cs'), 'utf8')).toBe('new');
    });

    it('leaves files that are already in the folder alone', async () => {
        const existing = write(path.join(target, 'Customer.cs'), 'same');
        const confirm = jest.fn();

        const added = await copyExistingItems([existing], target, confirm);

        expect(confirm).not.toHaveBeenCalled();
        expect(added).toEqual([existing]);
        expect(fs.readFileSync(existing, 'utf8')).toBe('same');
    });
});
