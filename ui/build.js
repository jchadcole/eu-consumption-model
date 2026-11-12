// Inlines eu-model.json, the sample scenario and eu-engine.js into one self-contained page.
// Usage: node ui/build.js  ->  index.html (served by GitHub Pages)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const body = read('ui/template.html')
  .replace('/*MODEL*/null', () => read('eu-model.json'))
  .replace('/*SAMPLE*/null', () => read('examples/sample-scenario.json'))
  .replace('/*ENGINE*/', () => read('eu-engine.js'));
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
${body}
</body>
</html>
`;
fs.writeFileSync(path.join(root, 'index.html'), html);
console.log('wrote index.html', html.length, 'bytes');
