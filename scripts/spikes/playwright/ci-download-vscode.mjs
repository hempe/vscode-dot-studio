// Downloads VS Code (stable, the build for this OS) for the Playwright checks in CI and prints its executable for CODE_EXECUTABLE.
//   node ci-download-vscode.mjs
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

console.log(await downloadAndUnzipVSCode('stable'));
