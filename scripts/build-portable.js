#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src');
const outDir = path.join(root, 'dist', 'portable');
fs.mkdirSync(outDir, { recursive: true });

let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
const logoBytes = fs.readFileSync(path.join(root, 'assets', 'sprite-creator.png'));
const logoDataUri = `data:image/png;base64,${logoBytes.toString('base64')}`;
html = html.replaceAll('../assets/sprite-creator.png', logoDataUri);
const styles = ['styles.css', 'theme-system.css', 'canvas.css', 'selection.css', 'theme-polish.css'];
for (const name of styles) {
  const link = `<link rel="stylesheet" href="${name}">`;
  if (!html.includes(link)) throw new Error(`Expected stylesheet link not found: ${name}`);
  const css = fs.readFileSync(path.join(src, name), 'utf8');
  html = html.replace(link, `<style data-source="${name}">\n${css}\n</style>`);
}
for (const name of ['theme-init.js', 'brand-config.js', 'renderer.js']) {
  const tag = `<script src="${name}"></script>`;
  if (!html.includes(tag)) throw new Error(`Expected script tag not found: ${name}`);
  let js = fs.readFileSync(path.join(src, name), 'utf8');
  // Prevent an embedded literal closing tag from ending the containing script element.
  js = js.replace(/<\/script/gi, '<\\/script');
  html = html.replace(tag, `<script data-source="${name}">\n${js}\n</script>`);
}
html = html.replace(
  /<meta http-equiv="Content-Security-Policy"[^>]*>/i,
  `<meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' file:; object-src 'none'; base-uri 'self'; form-action 'self'">`
);
const output = path.join(outDir, 'Sprite Creator.html');
fs.writeFileSync(output, html, 'utf8');
console.log(`Portable single-file application written to ${output}`);
console.log(`Size: ${fs.statSync(output).size.toLocaleString()} bytes`);
