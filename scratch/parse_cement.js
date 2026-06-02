const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'cement_category.html'), 'utf-8');

const match = html.match(/window\.__NUXT__\s*=\s*([\s\S]+?);\s*<\/script>/);
if (!match) {
  console.log('Not found window.__NUXT__');
  process.exit(1);
}

const jsCode = match[1];
const sandbox = { window: {} };

try {
  const runner = new Function('window', `window.__NUXT__ = ${jsCode}; return window.__NUXT__;`);
  const nuxt = runner(sandbox.window);
  console.log('Successfully evaluated __NUXT__!');
  
  // 寫入 JSON
  fs.writeFileSync(path.join(__dirname, 'cement_dump.json'), JSON.stringify(nuxt, null, 2), 'utf-8');
  console.log('Dumped to scratch/cement_dump.json');
} catch (e) {
  console.error('Error executing NUXT JS:', e);
}
