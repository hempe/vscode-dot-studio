import * as path from 'path';

export interface NestedFile {
    name: string;
    path: string;
    children?: NestedFile[];
    isParent?: boolean;
}

export class FileNestingService {
    
    /**
     * Groups files into nested structure based on naming patterns
     */
    static nestFiles(files: { name: string; path: string }[]): NestedFile[] {
        const fileMap = new Map<string, NestedFile>();
        const result: NestedFile[] = [];
        
        // First pass: create all file entries
        for (const file of files) {
            fileMap.set(file.path, {
                name: file.name,
                path: file.path,
                children: []
            });
        }
        
        // Second pass: determine nesting relationships
        for (const file of files) {
            const parent = this.findParentFile(file, files);
            
            if (parent && parent.path !== file.path) {
                const parentNode = fileMap.get(parent.path);
                const childNode = fileMap.get(file.path);
                
                if (parentNode && childNode) {
                    parentNode.children = parentNode.children || [];
                    parentNode.children.push(childNode);
                    parentNode.isParent = true;
                    
                    // Mark child as nested (don't add to root)
                    childNode.isParent = false;
                }
            }
        }
        
        // Third pass: add only root files to result
        for (const file of files) {
            const node = fileMap.get(file.path);
            if (node && node.isParent !== false) { // Include parents and standalone files
                result.push(node);
            }
        }
        
        // Sort children within each parent
        for (const node of result) {
            if (node.children && node.children.length > 0) {
                node.children.sort((a, b) => a.name.localeCompare(b.name));
            }
        }
        
        return result.sort((a, b) => a.name.localeCompare(b.name));
    }
    
    /**
     * Finds the parent file for a given file based on naming patterns
     */
    private static findParentFile(
        file: { name: string; path: string }, 
        allFiles: { name: string; path: string }[]
    ): { name: string; path: string } | null {
        
        const fileName = file.name;
        const filePath = file.path;
        const fileExt = path.extname(fileName);
        const baseName = path.basename(fileName, fileExt);
        
        // Pattern 1: File.ext.cs (e.g., EditUser.cshtml.cs)
        if (this.isCodeBehindFile(fileName)) {
            const parentName = this.getCodeBehindParent(fileName);
            if (parentName) {
                const parent = allFiles.find(f => f.name === parentName);
                if (parent) return parent;
            }
        }
        
        // Pattern 2: BaseFile.Suffix.ext (e.g., PrinterLayoutCacheEntryProvider.Dtos.cs)
        if (this.hasSuffixPattern(fileName)) {
            const parentName = this.getSuffixParent(fileName, allFiles);
            if (parentName) {
                const parent = allFiles.find(f => f.name === parentName);
                if (parent) return parent;
            }
        }
        
        // Pattern 3: Designer files (e.g., Form1.Designer.cs)
        if (fileName.includes('.Designer.')) {
            const parentName = fileName.replace('.Designer.', '.');
            const parent = allFiles.find(f => f.name === parentName);
            if (parent) return parent;
        }
        
        // Pattern 4: Generated files (e.g., Reference.cs from Reference.svcmap)
        const withoutExt = path.basename(fileName, fileExt);
        for (const otherFile of allFiles) {
            const otherWithoutExt = path.basename(otherFile.name, path.extname(otherFile.name));
            if (otherWithoutExt === withoutExt && otherFile.name !== fileName) {
                // Prefer non-cs files as parents
                if (path.extname(otherFile.name) !== '.cs' && fileExt === '.cs') {
                    return otherFile;
                }
            }
        }
        
        return null;
    }
    
    /**
     * Checks if a file is a code-behind file (e.g., .aspx.cs, .cshtml.cs, .xaml.cs)
     */
    private static isCodeBehindFile(fileName: string): boolean {
        const codeBehindPatterns = [
            /\.aspx\.cs$/i,
            /\.aspx\.vb$/i,
            /\.cshtml\.cs$/i,
            /\.vbhtml\.vb$/i,
            /\.xaml\.cs$/i,
            /\.xaml\.vb$/i,
            /\.resx\.designer\.cs$/i,
            /\.resx\.designer\.vb$/i,
            /\.settings\.designer\.cs$/i,
            /\.settings\.designer\.vb$/i
        ];
        
        return codeBehindPatterns.some(pattern => pattern.test(fileName));
    }
    
    /**
     * Gets the parent file name for a code-behind file
     */
    private static getCodeBehindParent(fileName: string): string | null {
        if (fileName.endsWith('.cs')) {
            return fileName.substring(0, fileName.length - 3);
        }
        if (fileName.endsWith('.vb')) {
            return fileName.substring(0, fileName.length - 3);
        }
        return null;
    }
    
    /**
     * Checks if file has a suffix pattern (e.g., BaseFile.Suffix.ext)
     */
    private static hasSuffixPattern(fileName: string): boolean {
        const ext = path.extname(fileName);
        const withoutExt = path.basename(fileName, ext);
        
        // Look for common suffixes
        const suffixPatterns = [
            /\.Dto$/i, /\.Dtos$/i,
            /\.Model$/i, /\.Models$/i,
            /\.Entity$/i, /\.Entities$/i,
            /\.Request$/i, /\.Response$/i,
            /\.Command$/i, /\.Query$/i,
            /\.Validator$/i, /\.Validation$/i,
            /\.Handler$/i, /\.Handlers$/i,
            /\.Service$/i, /\.Services$/i,
            /\.Repository$/i, /\.Repositories$/i,
            /\.Extensions$/i, /\.Extension$/i,
            /\.Helpers$/i, /\.Helper$/i,
            /\.Utils$/i, /\.Util$/i,
            /\.Constants$/i, /\.Constant$/i,
            /\.Config$/i, /\.Configuration$/i,
            /\.Settings$/i, /\.Setting$/i,
            /\.Tests$/i, /\.Test$/i
        ];
        
        return suffixPatterns.some(pattern => pattern.test(withoutExt));
    }
    
    /**
     * Gets the parent file name for a suffix-pattern file
     */
    private static getSuffixParent(fileName: string, allFiles: { name: string; path: string }[]): string | null {
        const ext = path.extname(fileName);
        const withoutExt = path.basename(fileName, ext);
        
        // Find the base name by removing common suffixes
        const suffixPatterns = [
            /\.Dto$/i, /\.Dtos$/i,
            /\.Model$/i, /\.Models$/i,
            /\.Entity$/i, /\.Entities$/i,
            /\.Request$/i, /\.Response$/i,
            /\.Command$/i, /\.Query$/i,
            /\.Validator$/i, /\.Validation$/i,
            /\.Handler$/i, /\.Handlers$/i,
            /\.Service$/i, /\.Services$/i,
            /\.Repository$/i, /\.Repositories$/i,
            /\.Extensions$/i, /\.Extension$/i,
            /\.Helpers$/i, /\.Helper$/i,
            /\.Utils$/i, /\.Util$/i,
            /\.Constants$/i, /\.Constant$/i,
            /\.Config$/i, /\.Configuration$/i,
            /\.Settings$/i, /\.Setting$/i,
            /\.Tests$/i, /\.Test$/i
        ];
        
        for (const pattern of suffixPatterns) {
            if (pattern.test(withoutExt)) {
                const baseName = withoutExt.replace(pattern, '');
                const parentFileName = baseName + ext;
                
                // Check if parent file exists
                const parent = allFiles.find(f => f.name === parentFileName);
                if (parent) {
                    return parentFileName;
                }
            }
        }
        
        return null;
    }
}