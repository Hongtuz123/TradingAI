const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'cmoney_category.html'), 'utf-8');

// 用正則匹配 window.__NUXT__ = (function ...
const match = html.match(/window\.__NUXT__\s*=\s*([\s\S]+?);\s*<\/script>/);
if (!match) {
  console.log('Not found window.__NUXT__');
  process.exit(1);
}

const jsCode = match[1];

// 建立一個 window 對象並 eval
const sandbox = {
  window: {}
};

try {
  const runner = new Function('window', `window.__NUXT__ = ${jsCode}; return window.__NUXT__;`);
  const nuxt = runner(sandbox.window);
  console.log('Successfully evaluated __NUXT__!');
  
  // 印出 nuxt 的部分結構，尋找可能包含分類的地方
  // nuxt 可能是個對象或陣列，我們來看看它的 key 或長度
  console.log('Type of nuxt:', typeof nuxt);
  if (Array.isArray(nuxt)) {
    console.log('nuxt is array, length:', nuxt.length);
  } else {
    console.log('Keys of nuxt:', Object.keys(nuxt));
    if (nuxt.data) {
      console.log('Keys of nuxt.data:', Object.keys(nuxt.data));
      console.log('Sample nuxt.data:', JSON.stringify(nuxt.data).slice(0, 1000));
    }
    if (nuxt.state) {
      console.log('Keys of nuxt.state:', Object.keys(nuxt.state));
    }
  }

  // 寫入一個 JSON 檔，方便我們直接搜尋
  fs.writeFileSync(path.join(__dirname, 'nuxt_dump.json'), JSON.stringify(nuxt, null, 2), 'utf-8');
  console.log('Dumped to scratch/nuxt_dump.json');
} catch (e) {
  console.error('Error executing NUXT JS:', e);
}
