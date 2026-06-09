const fs = require('fs');
const data = fs.readFileSync('data.js', 'utf8');
const lines = data.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('mockStocks')) {
    console.log(`Line ${i + 1}: ${lines[i].slice(0, 200)}`);
  }
}
