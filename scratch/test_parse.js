const fs = require('fs');
const path = require('path');

const dataContent = fs.readFileSync(path.join(__dirname, '../data.js'), 'utf8');
// 模擬瀏覽器/Node 環境，把資料載入
const sandbox = {};
const fn = new Function('sandbox', dataContent + '\nreturn mockStocks;');
const mockStocks = fn(sandbox);

console.log('Total stocks:', mockStocks.length);
console.log('First stock keys:', Object.keys(mockStocks[0]));
console.log('First stock sample:', JSON.stringify(mockStocks[0]).slice(0, 500));
