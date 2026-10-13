import {
    BUILTIN_ITEMS, builtinItemContent, defaultTemplateItemName, itemBaseName, namespaceSegment, projectLanguage, replaceNamespace,
} from '../../../../services/templates/itemTemplates';

describe('built-in items', () => {
    it('offers the basic C# types with Visual Studio default names', () => {
        expect(BUILTIN_ITEMS.map(item => [item.label, item.defaultName])).toEqual([
            ['Class', 'Class1.cs'], ['Interface', 'Interface1.cs'], ['Record', 'Record1.cs'], ['Enum', 'Enum1.cs'], ['Struct', 'Struct1.cs'],
        ]);
    });

    it('writes a file-scoped namespace and an empty type', () => {
        expect(builtinItemContent('record', 'Customer', 'Demo.Models')).toBe('namespace Demo.Models;\n\npublic record Customer\n{\n}\n');
        expect(builtinItemContent('interface', 'IRepository', 'Demo', '\r\n')).toBe('namespace Demo;\r\n\r\npublic interface IRepository\r\n{\r\n}\r\n');
    });
});

describe('names', () => {
    it('default names for dotnet new templates', () => {
        expect(defaultTemplateItemName({ name: 'API Controller', shortNames: ['apicontroller'], languages: ['C#'], tags: [] })).toBe('APIController1');
        expect(defaultTemplateItemName({ name: 'Razor Component', shortNames: ['razorcomponent'], languages: ['C#'], tags: [] })).toBe('RazorComponent1');
    });

    it('drops a typed extension', () => {
        expect(itemBaseName('Counter.razor')).toBe('Counter');
        expect(itemBaseName('ValuesController.cs')).toBe('ValuesController');
        expect(itemBaseName('Index')).toBe('Index');
    });
});

describe('namespaces', () => {
    it('replaces the first file-scoped or block namespace', () => {
        expect(replaceNamespace('using X;\n\nnamespace MyApp.Namespace;\n\npublic class A {}', 'Demo.Controllers'))
            .toBe('using X;\n\nnamespace Demo.Controllers;\n\npublic class A {}');
        expect(replaceNamespace('namespace MyApp.Namespace\n{\n    class A {}\n}', 'Demo')).toBe('namespace Demo\n{\n    class A {}\n}');
        expect(replaceNamespace('@page "/x"\n<h3>X</h3>', 'Demo')).toBe('@page "/x"\n<h3>X</h3>');
    });

    it('turns folder names into identifiers like Visual Studio', () => {
        expect(namespaceSegment('Connected Services')).toBe('Connected_Services');
        expect(namespaceSegment('my-feature')).toBe('my_feature');
        expect(namespaceSegment('2024')).toBe('_2024');
        expect(namespaceSegment('Models')).toBe('Models');
    });

    it('knows the project language by extension', () => {
        expect(projectLanguage('/a/A.csproj')).toBe('C#');
        expect(projectLanguage('/a/A.fsproj')).toBe('F#');
        expect(projectLanguage('/a/A.vbproj')).toBe('VB');
    });
});
