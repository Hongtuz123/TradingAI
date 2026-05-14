// 全域狀態
let currentResults = [];
let currentWhitelist = [];
let currentBlacklist = [];

// 即時時鐘與開盤倒數
function startClock() {
  const clockEl = document.getElementById('currentTime');
  const marketStatusText = document.getElementById('marketStatusText');
  
  setInterval(() => {
    const now = new Date();
    const Y = now.getFullYear();
    const M = String(now.getMonth() + 1).padStart(2, '0');
    const D = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    
    clockEl.innerText = `${Y}/${M}/${D} ${h}:${m}:${s}`;

    // 台股開盤倒數 (09:00:00)
    if (h === '08') {
      const minutesLeft = 59 - now.getMinutes();
      const secondsLeft = 59 - now.getSeconds();
      marketStatusText.innerText = `距離開盤還有 ${minutesLeft} 分 ${secondsLeft} 秒`;
    } else if (h === '09' && now.getMinutes() < 5) {
      marketStatusText.innerText = `台股剛開盤！請留意劇烈波動`;
    }
  }, 1000);
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  initDashboard();
  startClock();
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
    // 只有在還沒載入過任何標的時，才載入預設（例如第一次直接點擊 K 線圖 Tab）
    if (!currentChartSymbol) {
      const defaultStock = mockStocks.find(s => s.id === '2330') || mockStocks[0];
      if (defaultStock) {
        setTimeout(() => loadTVChart(defaultStock), 100);
      }
    }
  }
}

// 初始化儀表板市場健康度
function initDashboard() {
  const badge = document.getElementById('marketStatusBadge');
  const text = document.getElementById('marketStatusText');
  const updateTime = marketData.lastUpdate.replace(/-/g, '/');
  document.getElementById('lastUpdateTime').innerText = updateTime;

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
    typeA: document.getElementById('f_type_a').checked,
    typeB: document.getElementById('f_type_b').checked,
    typeC: document.getElementById('f_type_c').checked,
    typeD: document.getElementById('f_type_d').checked,
    maBull: document.getElementById('f_ma_bull').checked,
    dist52W: parseFloat(document.getElementById('f_52w_pct').value) || 100,
    closeHigh: document.getElementById('f_close_high').checked,
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

    const typeMatch = (!p.typeA && !p.typeB && !p.typeC && !p.typeD) || 
                      (p.typeA && s.type === 'A') || 
                      (p.typeB && s.type === 'B') || 
                      (p.typeC && s.type === 'C') || 
                      (p.typeD && s.type === 'D');

    const maMatch = !p.maBull || s.maBull;

    // 計算 11 個條件的得分與未達成項目
    let failedConditions = [];
    if (s.epsYoY < p.eps) failedConditions.push(`EPS成長 (${s.epsYoY}% < ${p.eps}%)`);
    if (s.revYoY < p.rev) failedConditions.push(`月營收 YoY (${s.revYoY}% < ${p.rev}%)`);
    if (s.roe < p.roe) failedConditions.push(`ROE (${s.roe}% < ${p.roe}%)`);
    if (s.grossMargin < p.margin) failedConditions.push(`毛利率 (${s.grossMargin}% < ${p.margin}%)`);
    if (s.debtRatio > p.debt) failedConditions.push(`負債比 (${s.debtRatio}% > ${p.debt}%)`);
    if (s.trustDays < p.trustDays) failedConditions.push(`投信連買 (${s.trustDays}天 < ${p.trustDays}天)`);
    if (p.fb && !s.foreignBuy) failedConditions.push(`外資近5日買超 (未達標)`);
    if (s.volRatio < p.volRatio) failedConditions.push(`量能比 (${s.volRatio} < ${p.volRatio})`);
    if (s.turnover < p.turnover) failedConditions.push(`週轉率 (${s.turnover}% < ${p.turnover}%)`);
    if (s.marketCap < p.mktCap) failedConditions.push(`市值 (${s.marketCap}億 < ${p.mktCap}億)`);
    if (s.dailyVol < p.dailyVol) failedConditions.push(`日均量 (${s.dailyVol}張 < ${p.dailyVol}張)`);

    s.dynamicScore = 11 - failedConditions.length;
    s.failedConditions = failedConditions;

    // L4 與 L5 的嚴格過濾與總得分過濾
    if (s.dynamicScore >= p.minScore && typeMatch && maMatch && s.dist52W <= p.dist52W && (!p.closeHigh || s.closeToHigh)) {
      currentResults.push(s);
    }
  });

  // 依據新規則：最多篩選出前 40 檔符合規則之標的 (依達標數降序排列)
  currentResults.sort((a, b) => b.dynamicScore - a.dynamicScore);
  currentResults = currentResults.slice(0, 40);

  // 根據前 40 檔結果計算白名單與統計數據
  currentResults.forEach(s => {
    if (s.dynamicScore >= p.minScore && s.blacklist.length === 0) {
      currentWhitelist.push(s);
      stats[s.type] = (stats[s.type] || 0) + 1;
      stats.totalScore += s.dynamicScore;
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
    tr.style.cursor = 'pointer';
    tr.title = '點擊查看未達標項目';
    tr.innerHTML = `
      <td><strong>${s.id}</strong> ${s.name}</td>
      <td><span class="badge" style="background:var(--primary)">Type ${s.type}</span></td>
      <td>${s.price} <span class="${s.change>=0?'text-up':'text-down'}">${s.change>0?'+':''}${s.change}%</span></td>
      <td><strong style="color:var(--warning)">${s.dynamicScore}</strong> /11</td>
      <td>${s.epsYoY}%</td>
      <td>${s.revYoY}%</td>
      <td>${s.roe}%</td>
      <td>${s.trustDays}天</td>
      <td>${s.foreignBuy?'✔':'✘'}</td>
      <td>${s.volRatio}x</td>
      <td>${s.blacklist.length>0 ? '<span class="badge danger">黑名單</span>' : '<span class="badge" style="background:var(--success)">正常</span>'}</td>
      <td><button class="btn-link" onclick="event.stopPropagation(); openChart('${s.id}')">看圖</button></td>
    `;
    
    // 點擊顯示未達標項目
    tr.onclick = () => {
      if (s.failedConditions.length === 0) {
        alert(`【${s.id} ${s.name}】\n\n🎉 11 項條件全數達標！`);
      } else {
        alert(`【${s.id} ${s.name}】未達標項目 (${s.failedConditions.length}項)：\n\n- ` + s.failedConditions.join('\n- '));
      }
    };
    
    tbody.appendChild(tr);
  });
}

function renderWhitelistPreview() {
  // 同時更新儀表板內嵌列表
  const container = document.getElementById('dashWlList');
  if (!container) return;
  container.innerHTML = '';

  const sorted = [...currentWhitelist].sort((a, b) => b.dynamicScore - a.dynamicScore);
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
      <div class="dash-wl-score">${s.dynamicScore}<span style="font-size:10px;color:var(--text-muted)">/11</span></div>
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
  currentWhitelist.sort((a,b)=>b.dynamicScore - a.dynamicScore).forEach(s => {
    grid.innerHTML += `
      <div class="wl-card" style="cursor:pointer;" title="點擊查看未達標項目" onclick="if (event.target.tagName !== 'BUTTON') { if(s.failedConditions.length===0) alert('【${s.id} ${s.name}】\\n\\n🎉 11 項條件全數達標！'); else alert('【${s.id} ${s.name}】未達標項目 (' + s.failedConditions.length + '項)：\\n\\n- ' + s.failedConditions.join('\\n- ')); }">
        <div class="wl-card-header">
          <div>
            <h3>${s.id} ${s.name}</h3>
            <span class="badge" style="background:var(--primary)">類型 ${s.type}</span>
          </div>
          <div class="wl-score" style="color:var(--warning)">${s.dynamicScore} <span style="font-size:12px;color:var(--text-muted)">/ 11</span></div>
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
  if (stock) {
    switchView('chart');
    // 300ms 讓分頁切換的 CSS display 完全生效後再渲染
    setTimeout(() => loadTVChart(stock), 300);
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
  if(by === 'score') sorted.sort((a,b) => b.dynamicScore - a.dynamicScore);
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
  
  const typeFail = mockStocks.filter(s => {
    const typeMatch = (!p.typeA && !p.typeB && !p.typeC && !p.typeD) || 
                      (p.typeA && s.type === 'A') || 
                      (p.typeB && s.type === 'B') || 
                      (p.typeC && s.type === 'C') || 
                      (p.typeD && s.type === 'D');
    return !typeMatch;
  }).length;

  const fails = {
    '綜合評分不足': mockStocks.filter(s => s.dynamicScore < p.minScore).length,
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
    '技術類型':   typeFail,
    '均線多頭':   mockStocks.filter(s => p.maBull && !s.maBull).length,
    '距52週高點': mockStocks.filter(s => s.dist52W > p.dist52W).length,
    '收盤接近日高': mockStocks.filter(s => p.closeHigh && !s.closeToHigh).length,
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
    return `<li>→ 建議放寬 <b>${name}</b> 的限制條件</li>`;
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
