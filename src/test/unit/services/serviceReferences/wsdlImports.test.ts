// A WSDL that imports its schemas can be added from a file (review A6-2)
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { wsdlImports } from '../../../../services/serviceReferences/wsdlImports';

describe('wsdlImports', () => {
    let dir: string;
    beforeEach(() => { dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dotstudio-wsdl-'))); });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
    const write = (name: string, content: string) => {
        fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
        fs.writeFileSync(path.join(dir, name), content);
    };

    it('finds schemas imported by the WSDL and the ones they import', () => {
        write('Calc.wsdl', '<wsdl:definitions xmlns:wsdl="x"><wsdl:types><xsd:schema xmlns:xsd="y"><xsd:import namespace="a" schemaLocation="CalcTypes.xsd"/></xsd:schema></wsdl:types><wsdl:import namespace="b" location="sub/Other.wsdl"/></wsdl:definitions>');
        write('CalcTypes.xsd', '<xs:schema xmlns:xs="y"><xs:include schemaLocation="types/Common.xsd"/></xs:schema>');
        write('types/Common.xsd', '<xs:schema xmlns:xs="y"/>');
        write('sub/Other.wsdl', '<definitions/>');
        expect(wsdlImports(path.join(dir, 'Calc.wsdl')).sort()).toEqual(['CalcTypes.xsd', path.join('sub', 'Other.wsdl'), path.join('types', 'Common.xsd')].sort());
    });

    it('accepts single quotes, backslashes and a cycle', () => {
        write('A.wsdl', "<schema><import schemaLocation='sub\\B.xsd'/></schema>");
        write('sub/B.xsd', '<schema><import schemaLocation="../A.wsdl"/></schema>');
        expect(wsdlImports(path.join(dir, 'A.wsdl'))).toEqual([path.join('sub', 'B.xsd')]);
    });

    it('leaves out URLs, missing files and files outside the folder', () => {
        fs.mkdirSync(path.join(dir, 'in'));
        write('outside.xsd', '<schema/>');
        write('in/A.wsdl', '<schema><import schemaLocation="https://example.com/x.xsd"/><import schemaLocation="missing.xsd"/><import schemaLocation="../outside.xsd"/></schema>');
        expect(wsdlImports(path.join(dir, 'in', 'A.wsdl'))).toEqual([]);
    });
});
