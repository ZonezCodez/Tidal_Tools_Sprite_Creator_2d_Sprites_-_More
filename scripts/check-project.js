#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src');
const fail = message => { console.error(`FAIL  ${message}`); process.exitCode = 1; };
const pass = message => console.log(`PASS  ${message}`);
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function checkBalancedCss(text, name) {
  const stack = [];
  let quote = null;
  let comment = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (comment) {
      if (c === '*' && next === '/') { comment = false; i++; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && next === '*') { comment = true; i++; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{' || c === '(' || c === '[') stack.push({ c, i });
    if (c === '}' || c === ')' || c === ']') {
      const item = stack.pop();
      const match = item && ((item.c === '{' && c === '}') || (item.c === '(' && c === ')') || (item.c === '[' && c === ']'));
      if (!match) throw new Error(`${name}: unmatched '${c}' at offset ${i}`);
    }
  }
  if (comment) throw new Error(`${name}: unterminated comment`);
  if (quote) throw new Error(`${name}: unterminated string`);
  if (stack.length) throw new Error(`${name}: unclosed '${stack[stack.length - 1].c}'`);
}

const pkg = JSON.parse(read('package.json'));
if (pkg.version !== '1.11.1') fail(`package version should be 1.11.1, got ${pkg.version}`);
else pass('package metadata is version 1.11.1');
if (pkg.devDependencies?.electron !== '45.5.0') fail('Electron must remain pinned to 45.5.0');
if (pkg.devDependencies?.['electron-builder'] !== '26.18.0') fail('electron-builder must remain pinned to 26.18.0');
else pass('desktop build dependencies are exactly pinned');

const html = read('src/index.html');
const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)].map(m => m[1]);
const seen = new Set();
const duplicates = new Set();
for (const id of ids) { if (seen.has(id)) duplicates.add(id); seen.add(id); }
if (duplicates.size) fail(`duplicate HTML IDs: ${[...duplicates].join(', ')}`);
else pass(`HTML has ${ids.length} unique IDs`);

const refs = [];
for (const m of html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi)) refs.push(m[1]);
for (const m of html.matchAll(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']stylesheet["'][^>]*>/gi)) refs.push(m[1]);
for (const m of html.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*>/gi)) refs.push(m[1]);
for (const ref of [...new Set(refs)]) {
  if (/^(https?:|\/\/)/i.test(ref)) fail(`remote code/style reference is not allowed: ${ref}`);
  else if (!fs.existsSync(path.join(src, ref))) fail(`missing local HTML dependency: ${ref}`);
}
if (refs.length) pass(`${new Set(refs).size} local stylesheet/script dependencies resolved`);
if (!html.includes("script-src 'self'")) fail('Content Security Policy must restrict scripts to local files');
if (/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(html)) fail('inline script remains in Electron HTML');
else pass('no inline executable script remains in Electron HTML');

const cssFiles = ['styles.css', 'theme-system.css', 'canvas.css', 'selection.css', 'theme-polish.css'];
for (const name of cssFiles) {
  try { checkBalancedCss(read(`src/${name}`), name); pass(`${name}: balanced CSS tokens`); }
  catch (error) { fail(error.message); }
}
if (cssFiles.some(name => !html.includes(`href="${name}"`))) fail('one or more CSS layers are not linked by index.html');
else pass('base, theme, canvas, selection, and final polish layers are all linked in order');

const themeInit = read('src/theme-init.js');
for (const token of ["onyx: ['dark', 'dark']", "prism: ['light', 'light']", "'onyx-prism': ['dark', 'light']", "'prism-onyx': ['light', 'dark']"]) {
  if (!themeInit.includes(token)) fail(`missing theme mapping: ${token}`);
}
if (!read('src/theme-polish.css').includes('--bg: #050608')) fail('Onyx application background is not near-black');
if (!read('src/theme-polish.css').includes('--canvas-workspace: #25282E')) fail('Onyx artboard workspace gray token missing');
else pass('four theme mappings and Onyx black/graphite surround with gray artboard palette verified');

const jsFiles = ['src/main.js', 'src/preload.js', 'src/renderer.js', 'src/brand-config.js', 'src/theme-init.js', 'scripts/check-project.js'];
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (result.status !== 0) fail(`${file}: ${result.stderr || result.stdout}`);
}
if (!process.exitCode) pass(`${jsFiles.length} JavaScript files pass node --check`);

const main = read('src/main.js');
const preload = read('src/preload.js');
for (const text of ['contextIsolation: true', 'nodeIntegration: false', 'sandbox: true', 'setWindowOpenHandler', 'requestSingleInstanceLock', 'registerTrustedHandler']) {
  if (!main.includes(text)) fail(`missing Electron security/desktop setting: ${text}`);
}
for (const m of preload.matchAll(/invoke\(['"]([^'"]+)['"]/g)) {
  if (!main.includes(`registerTrustedHandler('${m[1]}'`)) fail(`preload IPC channel has no trusted main handler: ${m[1]}`);
}
if (!process.exitCode) pass('Electron isolation, navigation, single-instance, and IPC channel checks passed');

if (!fs.existsSync(path.join(root, 'assets/sprite-creator.ico'))) fail('Windows application icon is missing');
if (!fs.existsSync(path.join(root, 'assets/sprite-creator.png'))) fail('Application logo PNG is missing');
if (!html.includes('<img class="brand-mark" src="../assets/sprite-creator.png"')) fail('Top-bar brand mark is not linked to the official application logo');
if (!html.includes('<img class="exit-brand-mark" src="../assets/sprite-creator.png"')) fail('Exit screen is not using the official application logo');
if (!html.includes('rel="icon" type="image/png" href="../assets/sprite-creator.png"')) fail('Browser favicon is not using the official application logo');
if (!fs.existsSync(path.join(root, '.github/workflows/build-windows.yml'))) fail('Windows CI build workflow is missing');
const devLauncher = read('Launch Sprite Creator.bat');
const portableLauncher = read('Launch Portable Share.bat');
const shareBuilder = read('Create Share Package.bat');
if (!devLauncher.includes('Launch Dev.bat')) fail('developer launcher must start the Electron development app');
if (!portableLauncher.includes('Sprite Creator.html')) fail('share launcher must open the self-contained HTML application');
if (!shareBuilder.includes('Launch Portable Share.bat')) fail('share builder must package the dedicated browser launcher');
else pass('developer and recipient launchers are separated correctly');
if (!process.exitCode) pass('required Windows build assets and CI workflow found');

if (process.exitCode) process.exit(process.exitCode);
console.log('\nAll project checks passed.');
