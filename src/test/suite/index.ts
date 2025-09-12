import * as path from 'path';
import * as Mocha from 'mocha';
import * as fs from 'fs';

export function run(): Promise<void> {
    // Create the mocha test
    const mocha = new Mocha({
        ui: 'bdd',
        color: true,
        timeout: 10000
    });

    const testsRoot = path.resolve(__dirname, '..');

    return new Promise((resolve, reject) => {
        try {
            // Simple file discovery without glob
            const testFiles = findTestFiles(testsRoot);
            
            // Add files to the test suite
            testFiles.forEach(f => mocha.addFile(f));

            // Run the mocha test
            mocha.run(failures => {
                if (failures > 0) {
                    reject(new Error(`${failures} tests failed.`));
                } else {
                    resolve();
                }
            });
        } catch (err) {
            console.error(err);
            reject(err);
        }
    });
}

function findTestFiles(dir: string): string[] {
    const files: string[] = [];
    
    function traverse(currentDir: string) {
        const items = fs.readdirSync(currentDir);
        
        for (const item of items) {
            const fullPath = path.join(currentDir, item);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory()) {
                traverse(fullPath);
            } else if (item.endsWith('.test.js')) {
                files.push(fullPath);
            }
        }
    }
    
    traverse(dir);
    return files;
}