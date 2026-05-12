// 全域狀態
let currentResults = [];
let currentWhitelist = [];
let currentBlacklist = [];

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  initDashboard();
  // chart-engine.js 僅保留備用，K 線已改為 TradingView
  if (typeof KLineChart !== 'undefined' && document.getElementById('klineCanvas')) {
    KLineChart.init('klineCanvas', 'volumeCanvas');
  }
  runScreener();
});

// 切換視圖
function switchView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  
  document.getElementById(`view-${viewId}`).classList.add('active');
  const btn = document.querySelector(`.nav-btn[data-view="${viewId}"]`);
  if (btn) btn.classList.add('active');

  if (viewId === 'chart') {
    renderChartStockList(); // 來自 stock-dashboard.js
  }
}

// 初始化儀表板市場健康度
function initDashboard() {
  const badge = document.getElementById('marketStatusBadge');
  const text = document.getElementById('marketStatusText');
  document.getElementById('lastUpdate').innerText = marketData.lastUpdate;

  const isHealthy = marketData.twii_above_60ma && marketData.otc_above_60ma && marketData.vol_above_20ma;
  
  if (isHealthy) {
    document.getElementById('healthGrade').innerText = '多頭安全';
    badge.style.backgroundColor = 'rgba(16, 185, 129, 0.2)';
    badge.style.color = 'var(--success)';
    badge.querySelector('.status-dot').style.backgroundColor = 'var(--success)';
    text.innerText = '市場偏多';
  } else {
    document.getElementById('healthGrade').innerText = '震盪偏空';
    document.getElementById('healthGrade').style.color = 'var(--danger)';
    badge.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
    badge.style.color = 'var(--danger)';
    badge.querySelector('.status-dot').style.backgroundColor = 'var(--danger)';
    text.innerText = '建議降低部位';
    
    document.getElementById('healthWarning').style.display = 'flex';
    document.getElementById('warningList').innerHTML = `
      <li>降低持股水位</li>
      <li>提高停損標準</li>
      <li>減少交易次數</li>
    `;
  }

  const indicatorsHTML = `
    <div class="health-indicator-card">
      <span>加權指數 > 60MA</span>
      <span class="badge ${marketData.twii_above_60ma ? 'success' : 'danger'}">${marketData.twii_above_60ma ? '符合' : '不符'}</span>
    </div>
    <div class="health-indicator-card">
      <span>OTC指數 > 60MA</span>
      <span class="badge ${marketData.otc_above_60ma ? 'success' : 'danger'}">${marketData.otc_above_60ma ? '符合' : '不符'}</span>
    </div>
    <div class="health-indicator-card">
      <span>大盤量 > 20MA</span>
      <span class="badge ${marketData.vol_above_20ma ? 'success' : 'danger'}">${marketData.vol_above_20ma ? '符合' : '不符'}</span>
    </div>
  `;
  document.getElementById('healthIndicators').innerHTML = indicatorsHTML;
}

// 執行篩選
function runScreener() {
  // 取得篩選參數
  const p = {
    eps: parseFloat(document.getElementById('f_eps_growth').value) || 0,
    rev: parseFloat(document.getElementById('f_rev_growth').value) || 0,
    roe: parseFloat(document.getElementById('f_roe').value) || 0,
    margin: parseFloat(document.getElementById('f_gross_margin').value) || 0,
    debt: parseFloat(document.getElementById('f_debt_ratio').value) || 100,
    trustDays: parseInt(document.getElementById('f_trust_days').value) || 0,
    fb: document.getElementById('f_foreign_buy').checked,
    volRatio: parseFloat(document.getElementById('f_vol_ratio').value) || 1,
    turnover: parseFloat(document.getElementById('f_turnover').value) || 0,
    mktCap: parseFloat(document.getElementById('f_market_cap').value) || 0,
    dailyVol: parseFloat(document.getElementById('f_daily_vol').value) || 0,
    minScore: parseInt(document.getElementById('f_min_score').value) || 6
  };

  document.getElementById('scoreThresholdDisplay').innerText = p.minScore;

  currentResults = [];
  currentWhitelist = [];
  currentBlacklist = [];
  
  let stats = { A:0, B:0, C:0, D:0, totalScore: 0 };

  mockStocks.forEach(s => {
    // 黑名單判斷
    if(s.blacklist.length > 0) {
      currentBlacklist.push(s);
    }

    // 基本面與籌碼面初步過濾
    if (s.epsYoY >= p.eps && s.revYoY >= p.rev && s.roe >= p.roe && 
        s.grossMargin >= p.margin && s.debtRatio <= p.debt &&
        s.trustDays >= p.trustDays && (!p.fb || s.foreignBuy) &&
        s.volRatio >= p.volRatio && s.turnover >= p.turnover &&
        s.marketCap >= p.mktCap && s.dailyVol >= p.dailyVol) {
      
      currentResults.push(s);
      
      // 白名單判斷 (依計分)
      if (s.score >= p.minScore && s.blacklist.length === 0) {
        currentWhitelist.push(s);
        stats[s.type] = (stats[s.type] || 0) + 1;
        stats.totalScore += s.score;
      }
    }
  });

  // ========== 無結果彈窗 ==========
  if (mockStocks.length > 0 && currentWhitelist.length === 0) {
    showEmptyResultModal(p, currentResults.length);
  }

  // 更新 Dashboard 統計
  document.getElementById('statTotalVal').innerText = currentResults.length;
  document.getElementById('statWhitelistVal').innerText = currentWhitelist.length;
  document.getElementById('statBlacklistVal').innerText = currentBlacklist.length;
  document.getElementById('statTypeAVal').innerText = stats.A;
  document.getElementById('statTypeBVal').innerText = stats.B;
  
  const avgScore = currentWhitelist.length > 0 ? (stats.totalScore / currentWhitelist.length).toFixed(1) : 0;
  document.getElementById('statAvgScoreVal').innerText = avgScore;

  // 更新預覽區與清單
  renderScreenerTable(currentResults);
  renderWhitelistPreview();
  renderWhitelistGrid();
  renderBlacklistPreview();
}

// 渲染篩選器表格
function renderScreenerTable(data) {
  document.getElementById('resultCount').innerText = data.length;
  const tbody = document.getElementById('resultsBody');
  tbody.innerHTML = '';

  if(data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;">無符合條件的標的</td></tr>';
    return;
  }

  data.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${s.id}</strong> ${s.name}</td>
      <td><span class="badge" style="background:var(--primary)">Type ${s.type}</span></td>
      <td>${s.price} <span class="${s.change>=0?'text-up':'text-down'}">${s.change>0?'+':''}${s.change}%</span></td>
      <td><strong>${s.score}</strong>/11</td>
      <td>${s.epsYoY}%</td>
      <td>${s.revYoY}%</td>
      <td>${s.roe}%</td>
      <td>${s.trustDays}天</td>
      <td>${s.foreignBuy?'✔':'✘'}</td>
      <td>${s.volRatio}x</td>
      <td>${s.blacklist.length>0 ? '<span class="badge danger">黑名單</span>' : '<span class="badge" style="background:var(--success)">正常</span>'}</td>
      <td><button class="btn-link" onclick="openChart('${s.id}')">看圖</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderWhitelistPreview() {
  // 同時更新儀表板內嵌列表
  const container = document.getElementById('dashWlList');
  if (!container) return;
  container.innerHTML = '';

  const sorted = [...currentWhitelist].sort((a, b) => b.score - a.score);
  if (sorted.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);padding:10px 0">無白名單標的，請先到篩選器執行篩選</p>';
    return;
  }

  sorted.forEach((s, idx) => {
    const row = document.createElement('div');
    row.className = 'dash-wl-row';
    row.innerHTML = `
      <div class="dash-wl-rank">${idx + 1}</div>
      <div class="dash-wl-info">
        <strong>${s.id} ${s.name}</strong>
        <span class="badge" style="background:var(--primary);margin-left:6px;font-size:10px">${s.type !== 'none' ? 'Type ' + s.type : '--'}</span>
      </div>
      <div class="dash-wl-price ${parseFloat(s.change) >= 0 ? 'text-up' : 'text-down'}">${s.price}</div>
      <div class="dash-wl-score">${s.score}<span style="font-size:10px;color:var(--text-muted)">/11</span></div>
    `;
    row.onclick = () => {
      document.querySelectorAll('.dash-wl-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      loadInlineDash(s);
    };
    container.appendChild(row);
  });
}

// 內嵌至儀表板的個股戰情板
function loadInlineDash(stock) {
  const placeholder = document.getElementById('dashDetailPlaceholder');
  const content = document.getElementById('inlineDashContent');
  if (!placeholder || !content) return;

  placeholder.style.display = 'none';
  content.style.display = 'block';

  // 著用 stock-dashboard.js 的渲染函式
  renderStockDashInline(stock, content);
}

function renderBlacklistPreview() {
  const container = document.getElementById('blacklistPreview');
  document.getElementById('blacklistCount').innerText = currentBlacklist.length;
  container.innerHTML = '';
  const list = currentBlacklist.slice(0,5);
  list.forEach(s => {
    container.innerHTML += `
      <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--border-color); font-size:13px;">
        <div>${s.id} ${s.name}</div>
        <div style="color:var(--danger)">${s.blacklist[0]}</div>
      </div>
    `;
  });
}

function renderWhitelistGrid() {
  const grid = document.getElementById('whitelistGrid');
  grid.innerHTML = '';
  currentWhitelist.sort((a,b)=>b.score - a.score).forEach(s => {
    grid.innerHTML += `
      <div class="wl-card">
        <div class="wl-card-header">
          <div>
            <h3>${s.id} ${s.name}</h3>
            <span class="badge" style="background:var(--primary)">類型 ${s.type}</span>
          </div>
          <div class="wl-score">${s.score} <span style="font-size:12px;color:var(--text-muted)">/ 11</span></div>
        </div>
        <div class="wl-card-body">
          <div>收盤：${s.price} (${s.change}%)</div>
          <div>EPS YoY：${s.epsYoY}%</div>
          <div>營收 YoY：${s.revYoY}%</div>
          <div>投信連買：${s.trustDays}天</div>
          <div>均量比：${s.volRatio}x</div>
          <div>距52W高：${s.dist52W}%</div>
        </div>
        <div style="margin-top:10px;text-align:right;">
          <button class="btn-secondary" style="font-size:12px;padding:4px 8px;" onclick="openChart('${s.id}')">查看K線 →</button>
        </div>
      </div>
    `;
  });
}

// Chart 相關
function renderChartStockList() {
  const list = document.getElementById('chartStockList');
  list.innerHTML = '';
  mockStocks.forEach(s => {
    const div = document.createElement('div');
    div.className = 'chart-stock-item';
    div.innerHTML = `<strong>${s.id}</strong> ${s.name} <span style="float:right;" class="${s.change>=0?'text-up':'text-down'}">${s.price}</span>`;
    div.onclick = () => loadChart(s);
    list.appendChild(div);
  });
}

function loadChart(stock) {
  document.getElementById('chartCode').innerText = stock.id;
  document.getElementById('chartName').innerText = stock.name;
  document.getElementById('chartPrice').innerText = stock.price;
  document.getElementById('chartPrice').className = `chart-price ${stock.change>=0?'text-up':'text-down'}`;
  document.getElementById('chartChange').innerText = `${stock.change>0?'+':''}${stock.change}%`;

  // 產生假K線資料並渲染
  const data = KLineChart.generateMockData(60, stock.price);
  KLineChart.setData(data);

  // 填寫假指標數值
  document.getElementById('indMA5').innerText = (stock.price * 0.98).toFixed(1);
  document.getElementById('indMA20').innerText = (stock.price * 0.95).toFixed(1);
  document.getElementById('indMA60').innerText = (stock.price * 0.90).toFixed(1);
  document.getElementById('indRSI').innerText = (Math.random() * 30 + 50).toFixed(1);
  document.getElementById('indMACD').innerText = (Math.random() * 2).toFixed(2);
}

function openChart(id) {
  const stock = mockStocks.find(s => s.id === id);
  if(stock) {
    switchView('chart');
    setTimeout(() => loadChart(stock), 200);
  }
}

function filterChartList(val) {
  const items = document.querySelectorAll('.chart-stock-item');
  items.forEach(item => {
    if(item.innerText.includes(val)) item.style.display = 'block';
    else item.style.display = 'none';
  });
}

function sortResults(by) {
  let sorted = [...currentResults];
  if(by === 'score') sorted.sort((a,b) => b.score - a.score);
  if(by === 'epsGrowth') sorted.sort((a,b) => b.epsYoY - a.epsYoY);
  if(by === 'revGrowth') sorted.sort((a,b) => b.revYoY - a.revYoY);
  if(by === 'trustDays') sorted.sort((a,b) => b.trustDays - a.trustDays);
  if(by === 'techType') sorted.sort((a,b) => a.type.localeCompare(b.type));
  
  renderScreenerTable(sorted);
}

function exportWhitelist() {
  alert('匯出 CSV 功能 (模擬)');
}

// ========== 無結果彈窗 ==========
function showEmptyResultModal(p, passedCount) {
  // 分析是哪些條件最嚴苛
  const diagnosis = [];

  // 計算每個條件卡住幾檔
  const total = mockStocks.length;
  const fails = {
    '月營收 YoY': mockStocks.filter(s => s.revYoY < p.rev).length,
    'EPS YoY':    mockStocks.filter(s => s.epsYoY < p.eps).length,
    'ROE':        mockStocks.filter(s => s.roe < p.roe).length,
    '毛利率':     mockStocks.filter(s => s.grossMargin < p.margin).length,
    '負債比':     mockStocks.filter(s => s.debtRatio > p.debt).length,
    '投信連買':   mockStocks.filter(s => s.trustDays < p.trustDays).length,
    '外資買超':   mockStocks.filter(s => p.fb && !s.foreignBuy).length,
    '量能比':     mockStocks.filter(s => s.volRatio < p.volRatio).length,
    '週轉率':     mockStocks.filter(s => s.turnover < p.turnover).length,
    '市值':       mockStocks.filter(s => s.marketCap < p.mktCap).length,
    '日均量':     mockStocks.filter(s => s.dailyVol < p.dailyVol).length,
  };

  // 按失敗數排序，找最嚴苛的前5
  const sorted = Object.entries(fails).sort((a, b) => b[1] - a[1]);
  const topFails = sorted.filter(([, n]) => n > 0).slice(0, 5);

  const diagHTML = topFails.map(([name, n]) =>
    `<div class="modal-diag-row">
      <span>${name}</span>
      <span class="modal-diag-bar-wrap">
        <span class="modal-diag-bar" style="width:${Math.round(n/total*100)}%"></span>
      </span>
      <span class="modal-diag-pct">${n}/${total} 不符</span>
    </div>`
  ).join('');

  const suggestHTML = topFails.map(([name]) => {
    const map = {
      '月營收 YoY': `月營收 YoY 降至 <b>10%</b>`,
      'EPS YoY':    `EPS YoY 降至 <b>5%</b>`,
      'ROE':        `ROE 降至 <b>5%</b>`,
      '毛利率':     `毛利率 降至 <b>10%</b>`,
      '負債比':     `負債比 放寬至 <b>70%</b>`,
      '投信連買':   `投信連買 降至 <b>1天</b>`,
      '外資買超':   `取消外資買超勾選`,
      '量能比':     `量能比 降至 <b>1.0</b>x`,
      '週轉率':     `週轉率 降至 <b>1%</b>`,
      '市值':       `市值 降至 <b>20億</b>`,
      '日均量':     `日均量 降至 <b>500張</b>`,
    };
    return `<li>→ ${map[name] || name}</li>`;
  }).join('');

  const box = document.getElementById('modalContent');
  box.innerHTML = `
    <div style="text-align:center; margin-bottom:20px;">
      <div style="font-size:48px; margin-bottom:8px;">🔍</div>
      <h2 style="margin-bottom:4px;">白名單 0 檔</h2>
      <p style="color:var(--text-muted);">
        共 ${total} 檔標的中，有 ${passedCount} 檔通過基礎篩選，<br>但無任何標的達到最低評分 ${p.minScore} 分
      </p>
    </div>

    <h4 style="margin-bottom:12px; color:var(--warning);">⚠️ 最嚴苛的篩選條件</h4>
    <div class="modal-diag">${diagHTML || '<p>目前資料中所有條件都通過，可能是最低評分門檻太高。</p>'}</div>

    <h4 style="margin-top:20px; margin-bottom:8px; color:var(--success);">💡 建議調整</h4>
    <ul style="padding-left:20px; line-height:2;">${suggestHTML || '<li>嘗試降低最低評分門檻</li>'}</ul>

    <div style="margin-top:20px; display:flex; gap:10px; justify-content:center;">
      <button class="btn-secondary" onclick="closeModal()">關閉</button>
      <button class="btn-primary" onclick="closeModal(); switchView('screener')">前往調整條件</button>
    </div>
  `;

  document.getElementById('stockModal').classList.add('active');
}

function closeModal(e) {
  if (e && e.target !== document.getElementById('stockModal')) return;
  document.getElementById('stockModal').classList.remove('active');
}
