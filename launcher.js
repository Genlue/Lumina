/**
 * Photo Album - One-click Launcher (compiles + starts)
 * Double-click to compile TypeScript and launch the app.
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const projectDir = __dirname;

// Step 1: Compile TypeScript
console.log('[1/2] Compiling TypeScript...');
try {
  execSync('npx tsc --project tsconfig.json', { cwd: projectDir, stdio: 'pipe' });
  console.log('       Compilation OK');
} catch (e) {
  console.error('       TypeScript errors found. Launching anyway...');
}

// Step 2: Launch Electron
console.log('[2/2] Launching Photo Album...');
const electronPath = path.join(projectDir, 'node_modules', 'electron', 'dist', 'electron.exe');

if (!fs.existsSync(electronPath)) {
  console.error('ERROR: Electron not found at ' + electronPath);
  console.error('Run "npm install" first.');
  process.exit(1);
}

const child = spawn(electronPath, [projectDir], {
  cwd: projectDir,
  stdio: 'ignore',
  detached: true,
  windowsHide: false,
});

child.unref();

// Exit immediately — Electron window stays open
setTimeout(() => process.exit(0), 500);
