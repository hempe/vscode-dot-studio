import { FileNestingService, NestedFile } from './fileNesting';

describe('FileNestingService', () => {
  describe('nestFiles', () => {
    it('should create flat structure when no nesting patterns exist', () => {
      const files = [
        { name: 'Program.cs', path: '/project/Program.cs' },
        { name: 'Startup.cs', path: '/project/Startup.cs' },
        { name: 'appsettings.json', path: '/project/appsettings.json' }
      ];

      const result = FileNestingService.nestFiles(files);

      expect(result).toHaveLength(3);
      expect(result.every(f => !f.children || f.children.length === 0)).toBe(true);
      expect(result.map(f => f.name).sort()).toEqual(['Program.cs', 'Startup.cs', 'appsettings.json']);
    });

    it('should nest code-behind files correctly', () => {
      const files = [
        { name: 'Index.cshtml', path: '/project/Views/Index.cshtml' },
        { name: 'Index.cshtml.cs', path: '/project/Views/Index.cshtml.cs' },
        { name: 'About.cshtml', path: '/project/Views/About.cshtml' }
      ];

      const result = FileNestingService.nestFiles(files);

      expect(result).toHaveLength(2); // Index.cshtml (with child) and About.cshtml

      const indexFile = result.find(f => f.name === 'Index.cshtml');
      expect(indexFile).toBeDefined();
      expect(indexFile!.isParent).toBe(true);
      expect(indexFile!.children).toHaveLength(1);
      expect(indexFile!.children![0].name).toBe('Index.cshtml.cs');

      const aboutFile = result.find(f => f.name === 'About.cshtml');
      expect(aboutFile).toBeDefined();
      expect(aboutFile!.children).toEqual([]);
    });

    it('should handle designer files', () => {
      const files = [
        { name: 'Form1.cs', path: '/project/Form1.cs' },
        { name: 'Form1.Designer.cs', path: '/project/Form1.Designer.cs' },
        { name: 'Form1.resx', path: '/project/Form1.resx' }
      ];

      const result = FileNestingService.nestFiles(files);

      expect(result).toHaveLength(1); // Only Form1.cs should be at root

      const form1 = result[0];
      expect(form1.name).toBe('Form1.cs');
      expect(form1.isParent).toBe(true);
      expect(form1.children).toHaveLength(2);
      expect(form1.children!.map(c => c.name).sort()).toEqual(['Form1.Designer.cs', 'Form1.resx']);
    });

    it('should handle TypeScript declaration files', () => {
      const files = [
        { name: 'utils.ts', path: '/project/utils.ts' },
        { name: 'utils.d.ts', path: '/project/utils.d.ts' },
        { name: 'api.ts', path: '/project/api.ts' }
      ];

      const result = FileNestingService.nestFiles(files);

      expect(result).toHaveLength(2); // utils.ts (with child) and api.ts

      const utilsFile = result.find(f => f.name === 'utils.ts');
      expect(utilsFile).toBeDefined();
      expect(utilsFile!.children).toHaveLength(1);
      expect(utilsFile!.children![0].name).toBe('utils.d.ts');
    });

    it('should handle configuration file variants', () => {
      const files = [
        { name: 'appsettings.json', path: '/project/appsettings.json' },
        { name: 'appsettings.Development.json', path: '/project/appsettings.Development.json' },
        { name: 'appsettings.Production.json', path: '/project/appsettings.Production.json' },
        { name: 'web.config', path: '/project/web.config' }
      ];

      const result = FileNestingService.nestFiles(files);

      expect(result).toHaveLength(2); // appsettings.json (with children) and web.config

      const appSettings = result.find(f => f.name === 'appsettings.json');
      expect(appSettings).toBeDefined();
      expect(appSettings!.children).toHaveLength(2);
      expect(appSettings!.children!.map(c => c.name).sort()).toEqual([
        'appsettings.Development.json',
        'appsettings.Production.json'
      ]);
    });

    it('should sort results alphabetically', () => {
      const files = [
        { name: 'Zebra.cs', path: '/project/Zebra.cs' },
        { name: 'Apple.cs', path: '/project/Apple.cs' },
        { name: 'Banana.cs', path: '/project/Banana.cs' }
      ];

      const result = FileNestingService.nestFiles(files);

      expect(result.map(f => f.name)).toEqual(['Apple.cs', 'Banana.cs', 'Zebra.cs']);
    });

    it('should sort children alphabetically', () => {
      const files = [
        { name: 'app.config', path: '/project/app.config' },
        { name: 'app.Release.config', path: '/project/app.Release.config' },
        { name: 'app.Debug.config', path: '/project/app.Debug.config' },
        { name: 'app.Test.config', path: '/project/app.Test.config' }
      ];

      const result = FileNestingService.nestFiles(files);

      expect(result).toHaveLength(1);
      const appConfig = result[0];
      expect(appConfig.children!.map(c => c.name)).toEqual([
        'app.Debug.config',
        'app.Release.config',
        'app.Test.config'
      ]);
    });

    it('should handle multiple nesting levels', () => {
      const files = [
        { name: 'Home.cshtml', path: '/project/Views/Home.cshtml' },
        { name: 'Home.cshtml.cs', path: '/project/Views/Home.cshtml.cs' },
        { name: 'Home.cshtml.designer.cs', path: '/project/Views/Home.cshtml.designer.cs' }
      ];

      const result = FileNestingService.nestFiles(files);

      expect(result).toHaveLength(1);
      const homeFile = result[0];
      expect(homeFile.name).toBe('Home.cshtml');

      // Should have nested both code-behind files
      expect(homeFile.children).toHaveLength(2);
      expect(homeFile.children!.map(c => c.name).sort()).toEqual([
        'Home.cshtml.cs',
        'Home.cshtml.designer.cs'
      ]);
    });

    it('should handle empty file list', () => {
      const result = FileNestingService.nestFiles([]);
      expect(result).toHaveLength(0);
    });

    it('should handle files with same base name but different extensions', () => {
      const files = [
        { name: 'data.xml', path: '/project/data.xml' },
        { name: 'data.xsd', path: '/project/data.xsd' },
        { name: 'data.cs', path: '/project/data.cs' }
      ];

      const result = FileNestingService.nestFiles(files);

      // Should create separate files since there's no clear parent-child relationship
      expect(result).toHaveLength(3);
      expect(result.every(f => !f.children || f.children.length === 0)).toBe(true);
    });

    it('should preserve file paths correctly', () => {
      const files = [
        { name: 'Component.tsx', path: '/project/src/Component.tsx' },
        { name: 'Component.module.css', path: '/project/src/Component.module.css' }
      ];

      const result = FileNestingService.nestFiles(files);

      expect(result).toHaveLength(2); // No nesting for these patterns
      expect(result[0].path).toBe('/project/src/Component.module.css');
      expect(result[1].path).toBe('/project/src/Component.tsx');
    });
  });

  describe('edge cases and robustness', () => {
    it('should handle files with complex paths', () => {
      const files = [
        { name: 'Very.Long.File.Name.cs', path: '/very/deep/project/path/Very.Long.File.Name.cs' },
        { name: 'Very.Long.File.Name.Designer.cs', path: '/very/deep/project/path/Very.Long.File.Name.Designer.cs' }
      ];

      const result = FileNestingService.nestFiles(files);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Very.Long.File.Name.cs');
      expect(result[0].children).toHaveLength(1);
    });

    it('should handle files with no extensions', () => {
      const files = [
        { name: 'Dockerfile', path: '/project/Dockerfile' },
        { name: 'README', path: '/project/README' },
        { name: 'LICENSE', path: '/project/LICENSE' }
      ];

      const result = FileNestingService.nestFiles(files);

      expect(result).toHaveLength(3);
      expect(result.every(f => !f.children || f.children.length === 0)).toBe(true);
    });

    it('should handle duplicate file names in different directories', () => {
      const files = [
        { name: 'Index.cshtml', path: '/project/Views/Home/Index.cshtml' },
        { name: 'Index.cshtml', path: '/project/Views/Product/Index.cshtml' },
        { name: 'Index.cshtml.cs', path: '/project/Views/Home/Index.cshtml.cs' }
      ];

      const result = FileNestingService.nestFiles(files);

      expect(result).toHaveLength(2);

      // One should have a child, one should not
      const withChild = result.find(f => f.children && f.children.length > 0);
      const withoutChild = result.find(f => !f.children || f.children.length === 0);

      expect(withChild).toBeDefined();
      expect(withoutChild).toBeDefined();
      expect(withChild!.children).toHaveLength(1);
    });

    it('should handle case sensitivity correctly', () => {
      const files = [
        { name: 'Component.ts', path: '/project/Component.ts' },
        { name: 'component.d.ts', path: '/project/component.d.ts' }
      ];

      const result = FileNestingService.nestFiles(files);

      // Should not nest due to case difference (depending on implementation)
      expect(result).toHaveLength(2);
    });
  });
});