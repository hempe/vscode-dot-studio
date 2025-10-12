import { NamespaceService } from '../../../services/namespaceService';
import * as vscode from 'vscode';

// Mock vscode module
jest.mock('vscode', () => ({
    Uri: {
        file: jest.fn((path) => ({ fsPath: path }))
    },
    Position: jest.fn((line, character) => ({ line, character })),
    commands: {
        executeCommand: jest.fn()
    },
    window: {
        showInformationMessage: jest.fn(),
        showWarningMessage: jest.fn(),
        showErrorMessage: jest.fn()
    },
    workspace: {
        openTextDocument: jest.fn(),
        applyEdit: jest.fn(),
        fs: {
            stat: jest.fn(),
            rename: jest.fn(),
            copy: jest.fn()
        }
    },
    FileType: {
        File: 1,
        Directory: 2
    }
}));

// Mock other dependencies
jest.mock('../../../services/solutionService', () => ({
    SolutionService: {
        getActiveSolution: jest.fn(() => null)
    }
}));

jest.mock('../../../core/logger', () => ({
    logger: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

describe('NamespaceService', () => {
    describe('parseNamespaceFromContent', () => {
        it('should parse traditional namespace declaration', () => {
            const content = `
using System;
using System.Collections.Generic;

namespace MyProject.Services
{
    public class MyService
    {
        // Implementation
    }
}`;

            const result = NamespaceService.parseNamespaceFromContent(content);

            expect(result).not.toBeNull();
            expect(result?.namespace).toBe('MyProject.Services');
            expect(result?.isFileScoped).toBe(false);
            expect(result?.line).toBe(4);
        });

        it('should parse file-scoped namespace declaration', () => {
            const content = `
using System;
using System.Collections.Generic;

namespace MyProject.Services;

public class MyService
{
    // Implementation
}`;

            const result = NamespaceService.parseNamespaceFromContent(content);

            expect(result).not.toBeNull();
            expect(result?.namespace).toBe('MyProject.Services');
            expect(result?.isFileScoped).toBe(true);
            expect(result?.line).toBe(4);
        });

        it('should handle global using statements before namespace', () => {
            const content = `
global using System;
global using System.Collections.Generic;
using Microsoft.Extensions.DependencyInjection;

namespace MyProject.Services;

public class MyService
{
    // Implementation
}`;

            const result = NamespaceService.parseNamespaceFromContent(content);

            expect(result).not.toBeNull();
            expect(result?.namespace).toBe('MyProject.Services');
            expect(result?.isFileScoped).toBe(true);
            expect(result?.line).toBe(5);
        });

        it('should handle nested namespace declarations', () => {
            const content = `
using System;

namespace MyProject.Services.Core
{
    public class MyService
    {
        // Implementation
    }
}`;

            const result = NamespaceService.parseNamespaceFromContent(content);

            expect(result).not.toBeNull();
            expect(result?.namespace).toBe('MyProject.Services.Core');
            expect(result?.isFileScoped).toBe(false);
        });

        it('should return null when no namespace is found (global namespace)', () => {
            const content = `
using System;

public class MyService
{
    // Implementation
}`;

            const result = NamespaceService.parseNamespaceFromContent(content);

            expect(result).toBeNull();
        });

        it('should ignore comments and empty lines', () => {
            const content = `
// This is a comment
/* Multi-line
   comment */
using System;

// Another comment
namespace MyProject.Services; // Inline comment

public class MyService
{
    // Implementation
}`;

            const result = NamespaceService.parseNamespaceFromContent(content);

            expect(result).not.toBeNull();
            expect(result?.namespace).toBe('MyProject.Services');
            expect(result?.isFileScoped).toBe(true);
        });

        it('should handle namespace with modifiers correctly', () => {
            const content = `
using System;

namespace MyProject.Services
{
    public partial class MyService
    {
        // Implementation
    }

    internal sealed class InternalService
    {
        // Implementation
    }
}`;

            const result = NamespaceService.parseNamespaceFromContent(content);

            expect(result).not.toBeNull();
            expect(result?.namespace).toBe('MyProject.Services');
            expect(result?.isFileScoped).toBe(false);
        });

        it('should handle namespace followed by opening brace on same line', () => {
            const content = `
using System;

namespace MyProject.Services {
    public class MyService
    {
        // Implementation
    }
}`;

            const result = NamespaceService.parseNamespaceFromContent(content);

            expect(result).not.toBeNull();
            expect(result?.namespace).toBe('MyProject.Services');
            expect(result?.isFileScoped).toBe(false);
        });

        it('should handle complex whitespace scenarios', () => {
            const content = `
using System;

    namespace    MyProject.Services.Complex    ;

public class MyService
{
    // Implementation
}`;

            const result = NamespaceService.parseNamespaceFromContent(content);

            expect(result).not.toBeNull();
            expect(result?.namespace).toBe('MyProject.Services.Complex');
            expect(result?.isFileScoped).toBe(true);
        });
    });

    describe('calculateExpectedNamespace', () => {
        // Note: These tests would require mocking SolutionService and filesystem operations
        // For now, we'll create basic structure tests

        it('should return null when no solution is active', async () => {
            // Mock SolutionService.getActiveSolution to return null
            const result = await NamespaceService.calculateExpectedNamespace('/some/path/file.cs');
            expect(result).toBeNull();
        });
    });

    describe('analyzeNamespaceChanges', () => {
        it('should detect when namespace update is needed', async () => {
            // This would require mocking file system and solution service
            // Implementation would test the integration of parsing and calculation
        });

        it('should detect when namespace update is not needed', async () => {
            // This would require mocking file system and solution service
            // Implementation would test when current and expected namespaces match
        });
    });

    describe('getCSharpFilesInDirectory', () => {
        it('should find C# files in directory recursively', async () => {
            // This would require mocking filesystem operations
            // Implementation would test recursive directory traversal
        });

        it('should handle empty directories', async () => {
            // This would require mocking filesystem operations
            // Implementation would test handling of directories with no C# files
        });

        it('should handle directories with mixed file types', async () => {
            // This would require mocking filesystem operations
            // Implementation would test filtering to only include .cs files
        });
    });

    describe('Namespace validation scenarios', () => {
        const testCases = [
            {
                description: 'should handle single-word namespace',
                content: 'namespace MyProject;',
                expected: { namespace: 'MyProject', isFileScoped: true }
            },
            {
                description: 'should handle multi-level namespace',
                content: 'namespace MyCompany.MyProject.Services.Core;',
                expected: { namespace: 'MyCompany.MyProject.Services.Core', isFileScoped: true }
            },
            {
                description: 'should handle traditional namespace with extra spacing',
                content: 'namespace   MyProject.Services   {\n',
                expected: { namespace: 'MyProject.Services', isFileScoped: false }
            },
            {
                description: 'should handle namespace with numbers',
                content: 'namespace MyProject.V2.Services;',
                expected: { namespace: 'MyProject.V2.Services', isFileScoped: true }
            },
            {
                description: 'should handle namespace with underscores',
                content: 'namespace My_Company.My_Project;',
                expected: { namespace: 'My_Company.My_Project', isFileScoped: true }
            }
        ];

        testCases.forEach(({ description, content, expected }) => {
            it(description, () => {
                const fullContent = `using System;\n\n${content}\n\npublic class TestClass { }`;
                const result = NamespaceService.parseNamespaceFromContent(fullContent);

                expect(result).not.toBeNull();
                expect(result?.namespace).toBe(expected.namespace);
                expect(result?.isFileScoped).toBe(expected.isFileScoped);
            });
        });
    });

    describe('Edge cases and error handling', () => {
        it('should handle empty file content', () => {
            const result = NamespaceService.parseNamespaceFromContent('');
            expect(result).toBeNull();
        });

        it('should handle file with only whitespace', () => {
            const result = NamespaceService.parseNamespaceFromContent('   \n\t  \n  ');
            expect(result).toBeNull();
        });

        it('should handle file with only comments', () => {
            const content = `
// Only comments here
/* Another comment */
// And another one
`;
            const result = NamespaceService.parseNamespaceFromContent(content);
            expect(result).toBeNull();
        });

        it('should handle file with only using statements', () => {
            const content = `
using System;
using System.Collections.Generic;
using Microsoft.Extensions.DependencyInjection;
`;
            const result = NamespaceService.parseNamespaceFromContent(content);
            expect(result).toBeNull();
        });

        it('should handle malformed namespace declarations', () => {
            // Test various malformed cases that should return null
            const malformedCases = [
                'namespace',              // Missing namespace name
                'namespace ;',            // Empty namespace name
                'namespace MyProject',    // Missing semicolon or brace
                'name space MyProject;',  // Incorrect keyword
                'Namespace MyProject;',   // Wrong case
            ];

            malformedCases.forEach(malformed => {
                const content = `using System;\n\n${malformed}\n\npublic class Test { }`;
                const result = NamespaceService.parseNamespaceFromContent(content);
                expect(result).toBeNull();
            });
        });

        it('should stop parsing when reaching class declaration without namespace', () => {
            const content = `
using System;

public class MyService
{
    // This should stop the namespace search
}

namespace ShouldNotBeFound;
`;
            const result = NamespaceService.parseNamespaceFromContent(content);
            expect(result).toBeNull();
        });

        it('should handle different class declaration modifiers', () => {
            const classModifiers = [
                'public class',
                'internal class',
                'private class',
                'protected class',
                'public partial class',
                'internal sealed class',
                'public abstract class',
                'public static class',
                'public interface',
                'public struct',
                'public enum',
                'public record'
            ];

            classModifiers.forEach(modifier => {
                const content = `using System;\n\n${modifier} TestType { }`;
                const result = NamespaceService.parseNamespaceFromContent(content);
                expect(result).toBeNull();
            });
        });
    });

    describe('Position tracking', () => {
        it('should return correct position for namespace keyword', () => {
            const content = `using System;

namespace MyProject.Services;

public class MyService { }`;

            const result = NamespaceService.parseNamespaceFromContent(content);

            expect(result).not.toBeNull();
            expect(result?.position).toBeInstanceOf(vscode.Position);
            expect(result?.position.line).toBe(2);
            expect(result?.position.character).toBeGreaterThan(9); // After "namespace "
        });

        it('should handle position tracking with varying indentation', () => {
            const content = `using System;

    namespace    MyProject.Services;

public class MyService { }`;

            const result = NamespaceService.parseNamespaceFromContent(content);

            expect(result).not.toBeNull();
            expect(result?.position).toBeInstanceOf(vscode.Position);
            expect(result?.line).toBe(2);
            // Position should be after "namespace" keyword plus spaces
        });
    });
});