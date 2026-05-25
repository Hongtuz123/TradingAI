// 全域狀態
let currentResults = [];
let currentWhitelist = [];

// 技術面微型標籤產生器
function getTechBadgesHTML(typeStr) {
  if (!typeStr || typeStr === 'none') return '--';
  return typeStr.split(',').map(t => {
    let color = 'var(--primary)';
    if (t === 'A') color = '#ec4899'; // 突破型粉紅
    if (t === 'B') color = '#3b82f6'; // 均線多頭藍
    if (t === 'C') color = '#10b981'; // 剛轉強綠
    if (t === 'D') color = '#f59e0b'; // 強勢回檔橘
    if (t === 'E') color = '#8b5cf6'; // 趨勢多頭紫
    return `<span class="badge" style="background:${color};margin-right:2px;padding:2px 4px;font-size:10px;">Type ${t}</span>`;
  }).join('');
}

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
  // 從 data.js 中的 rulesConfig 載入預設篩選規則
  if (typeof rulesConfig !== 'undefined') {
    const sc = rulesConfig.scoring;
    if (sc) {
      document.getElementById('f_eps_growth').value = sc.eps_growth;
      document.getElementById('f_rev_growth').value = sc.rev_growth;
      document.getElementById('f_roe').value = sc.roe;
      document.getElementById('f_trust_days').value = sc.trust_days;
      document.getElementById('f_vol_ratio').value = sc.vol_ratio;
      document.getElementById('f_market_cap').value = sc.market_cap;
      document.getElementById('f_daily_vol').value = sc.daily_vol;
      document.getElementById('f_52w_pct').value = sc.dist_52w;
    }
    const fl = rulesConfig.filtering;
    if (fl && fl.min_score) {
      document.getElementById('f_min_score').value = fl.min_score;
    }
  }

  initDashboard();
  startClock();
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

  // ── 輔助函數 ──────────────────────────────────────────
  function pctColor(v) {
    if (v === null || v === undefined) return 'var(--text-muted)';
    return v >= 0 ? 'var(--success)' : 'var(--danger)';
  }
  function pctStr(v) {
    if (v === null || v === undefined) return 'N/A';
    const sign = v >= 0 ? '+' : '';
    return `${sign}${v.toFixed(2)}%`;
  }
  function maBadge(val, label) {
    if (val === null || val === undefined) return '';
    const cls = val ? 'success' : 'danger';
    const txt = val ? `✓ ${label}` : `✗ ${label}`;
    return `<span class="badge ${cls}" style="font-size:10px;padding:2px 6px;">${txt}</span>`;
  }

  // ── 台股版塊 ──────────────────────────────────────────
  const twData = marketData.tw_indices || [];
  const twHTML = twData.map(idx => `
    <div class="health-indicator-card tw-card">
      <div class="idx-name">${idx.label}</div>
      <div class="idx-close">${idx.close !== null ? idx.close.toLocaleString() : '--'}</div>
      <div class="idx-pct" style="color:${pctColor(idx.pct_chg)};font-weight:700;">
        ${pctStr(idx.pct_chg)}
      </div>
      <div class="idx-ma-badges">
        ${maBadge(idx.above_20ma, '>20MA')}
        ${maBadge(idx.above_60ma, '>60MA')}
      </div>
    </div>
  `).join('');
  document.getElementById('twIndicators').innerHTML = twHTML;

  // 大盤量
  const volVal = marketData.vol_above_20ma;
  document.getElementById('volIndicator').innerHTML = volVal !== null && volVal !== undefined
    ? `<div class="health-indicator-card vol-card">
         <span style="font-size:12px;">大盤量</span>
         <span class="badge ${volVal ? 'success' : 'danger'}">${volVal ? '> 20MA' : '< 20MA'}</span>
       </div>`
    : '';

  // ── 美股版塊 ──────────────────────────────────────────
  const usData = marketData.us_indices || [];
  const usHTML = usData.map(idx => `
    <div class="health-indicator-card us-card">
      <div class="idx-name">${idx.label}</div>
      <div class="idx-close">${idx.close !== null ? idx.close.toLocaleString() : '--'}</div>
      <div class="idx-pct" style="color:${pctColor(idx.pct_chg)};font-weight:700;">
        ${pctStr(idx.pct_chg)}
      </div>
    </div>
  `).join('');
  document.getElementById('usIndicators').innerHTML = usHTML;

  // ── 評分與評級系統 ────────────────────────────────────
  
  // 1. 台股評分系統 (總分 3 分)
  // 指標一：台灣指數 (加權) 漲跌幅 > 0%
  const twiiPct = twData[0]?.pct_chg || 0;
  const twiiScore = twiiPct > 0 ? 1 : 0;
  
  // 指標二：櫃買指數 漲跌幅 > 0%
  const otcPct = twData[1]?.pct_chg || 0;
  const otcScore = otcPct > 0 ? 1 : 0;
  
  // 指標三：成交量大於 20MA
  const volScore = marketData.vol_above_20ma ? 1 : 0;
  
  const twTotalScore = twiiScore + otcScore + volScore;
  const isTwBull = twTotalScore >= 2; // 達 2 分多，未達 2 分空
  
  // 更新台股評級 UI
  const twGradeEl = document.getElementById('twHealthGrade');
  if (twGradeEl) {
    twGradeEl.innerText = `${isTwBull ? '多' : '空'} (${twTotalScore}分)`;
    twGradeEl.style.color = isTwBull ? 'var(--success)' : 'var(--danger)';
    twGradeEl.style.background = isTwBull ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)';
  }

  // 2. 美股評分系統 (總分 5 分)
  // 5 個指標：費半、那斯達克100、羅素2000、道瓊、S&P 500
  let usTotalScore = 0;
  usData.forEach(idx => {
    if (idx.pct_chg && idx.pct_chg > 0) {
      usTotalScore += 1;
    }
  });
  
  // 3分以下看空 (0, 1, 2)；3分普通；3分以上多 (4, 5)
  let usRating = '普通';
  let usColor = 'var(--warning)';
  let usBg = 'rgba(245, 158, 11, 0.2)';
  if (usTotalScore < 3) {
    usRating = '空';
    usColor = 'var(--danger)';
    usBg = 'rgba(239, 68, 68, 0.2)';
  } else if (usTotalScore > 3) {
    usRating = '多';
    usColor = 'var(--success)';
    usBg = 'rgba(16, 185, 129, 0.2)';
  }
  
  // 更新美股評級 UI
  const usGradeEl = document.getElementById('usHealthGrade');
  if (usGradeEl) {
    usGradeEl.innerText = `${usRating} (${usTotalScore}分)`;
    usGradeEl.style.color = usColor;
    usGradeEl.style.background = usBg;
  }

  // 3. 綜合評級 (雙強則多，雙空則空，其餘安全偏向防守)
  const isHealthy = isTwBull && (usTotalScore > 3);
  
  const failedStocks = marketData.price_failed_stocks || [];
  const hasFailedStocks = failedStocks.length > 0;

  let overallText = '多頭安全';
  let overallColor = 'var(--success)';
  let overallBg = 'rgba(16, 185, 129, 0.2)';
  let badgeText = '市場偏多';

  if (!isTwBull && usTotalScore < 3) {
    overallText = '全面看空';
    overallColor = 'var(--danger)';
    overallBg = 'rgba(239, 68, 68, 0.2)';
    badgeText = '建議降低部位';
  } else if (!isTwBull) {
    overallText = '防守 (台股偏弱)';
    overallColor = 'var(--warning)';
    overallBg = 'rgba(245, 158, 11, 0.2)';
    badgeText = '台股震盪，加強防守';
  } else if (usTotalScore < 3) {
    overallText = '防守 (美股偏弱)';
    overallColor = 'var(--warning)';
    overallBg = 'rgba(245, 158, 11, 0.2)';
    badgeText = '美股偏弱，警惕拉回';
  } else if (usTotalScore === 3) {
    overallText = '多頭防守';
    overallColor = 'var(--warning)';
    overallBg = 'rgba(245, 158, 11, 0.2)';
    badgeText = '美股震盪整理中';
  }

  // 加上分數統計顯示
  document.getElementById('healthGrade').innerText = `${overallText} [台:${twTotalScore}分/美:${usTotalScore}分]`;
  document.getElementById('healthGrade').style.color = overallColor;
  document.getElementById('healthGrade').style.background = overallBg;
  
  badge.style.backgroundColor = overallBg;
  badge.style.color = overallColor;
  badge.querySelector('.status-dot').style.backgroundColor = overallColor;
  text.innerText = `${badgeText} (台:${twTotalScore}分/美:${usTotalScore}分)`;

  if (!isHealthy || hasFailedStocks) {
    document.getElementById('healthWarning').style.display = 'flex';
    let warningHTML = '';
    if (hasFailedStocks) {
      const listStr = failedStocks.map(s => `${s.Code} ${s.Name}`).join(', ');
      warningHTML += `
        <li style="color: var(--danger); font-weight: bold; background: rgba(239, 68, 68, 0.15); padding: 8px 12px; border-radius: 6px; margin-bottom: 10px; list-style: none; border-left: 4px solid var(--danger);">
          ⚠️ 讀取價格失敗標的 (${failedStocks.length} 檔)：${listStr}
        </li>
      `;
    }
    
    // 警示條件以台股為主
    if (!isTwBull) {
      warningHTML += `
        <li style="color: var(--danger); font-weight: bold;">⚠️ 台股市況偏空 (${twTotalScore}分)</li>
        <li>降低台股持股水位</li>
        <li>提高停損標準</li>
      `;
    } else {
      warningHTML += `
        <li style="color: var(--success); font-weight: bold;">✓ 台股市況偏多 (${twTotalScore}分)</li>
      `;
    }
    
    if (usTotalScore < 3) {
      warningHTML += `
        <li style="color: var(--danger); font-weight: bold;">⚠️ 美股趨勢偏空 (${usTotalScore}分)</li>
        <li>警惕外部連動下跌風險</li>
      `;
    } else if (usTotalScore === 3) {
      warningHTML += `
        <li style="color: var(--warning); font-weight: bold;">⚡ 美股市況普通 (3分)</li>
        <li>密切觀察國際盤勢方向</li>
      `;
    }
    
    document.getElementById('warningList').innerHTML = warningHTML;
  } else {
    document.getElementById('healthWarning').style.display = 'none';
  }
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
    typeE: document.getElementById('f_type_e').checked,
    dist52W: parseFloat(document.getElementById('f_52w_pct').value) || 100,
    closeHigh: document.getElementById('f_close_high').checked,
    minScore: parseInt(document.getElementById('f_min_score').value) || 6
  };

  document.getElementById('scoreThresholdDisplay').innerText = p.minScore;

  currentResults = [];
  currentWhitelist = [];
  
  let stats = { A:0, B:0, C:0, D:0, E:0, totalScore: 0 };

  mockStocks.forEach(s => {
    // 支援多型態判定
    const stockTypes = s.type ? s.type.split(',') : [];
    const typeMatch = (!p.typeA && !p.typeB && !p.typeC && !p.typeD && !p.typeE) || 
                      (p.typeA && stockTypes.includes('A')) || 
                      (p.typeB && stockTypes.includes('B')) || 
                      (p.typeC && stockTypes.includes('C')) || 
                      (p.typeD && stockTypes.includes('D')) || 
                      (p.typeE && stockTypes.includes('E'));

    // 計算 12 個條件 of 得分與未達成項目（null 值欄位跳過不計）
    let failedConditions = [];
    let checkedCount = 0;
    function chk(val, cond, label) { if (val != null) { checkedCount++; if (!cond) failedConditions.push(label); } }
    // 基本面（可能為 null）
    chk(s.epsYoY,      s.epsYoY >= p.eps,       `EPS成長 (${s.epsYoY ?? '--'}% < ${p.eps}%)`);
    chk(s.revYoY,      s.revYoY >= p.rev,       `月營收 YoY (${s.revYoY ?? '--'}% < ${p.rev}%)`);
    chk(s.roe,         s.roe >= p.roe,           `ROE (${s.roe ?? '--'}% < ${p.roe}%)`);
    chk(s.grossMargin, s.grossMargin >= p.margin,`毛利率 (${s.grossMargin ?? '--'}% < ${p.margin}%)`);
    chk(s.debtRatio,   s.debtRatio <= p.debt,    `負債比 (${s.debtRatio ?? '--'}% > ${p.debt}%)`);
    // 籌碼（可能為 null）
    chk(s.trustDays,   s.trustDays >= p.trustDays, `投信當日買超 (${s.trustDays ?? '--'}張 < ${p.trustDays}張)`);
    if (s.foreignBuy != null) { checkedCount++; if (p.fb && !s.foreignBuy) failedConditions.push(`外資當日買超 (未達標)`); }
    // 技術面（真實計算）
    if (s.volRatio < p.volRatio) failedConditions.push(`量能比 (${s.volRatio} < ${p.volRatio})`);
    chk(s.turnover,    s.turnover >= p.turnover, `週轉率 (${s.turnover ?? '--'}% < ${p.turnover}%)`);
    chk(s.marketCap,   s.marketCap >= p.mktCap,  `市值 (${s.marketCap ?? '--'}億 < ${p.mktCap}億)`);
    if (s.dailyVol < p.dailyVol) failedConditions.push(`日均量 (${s.dailyVol}張 < ${p.dailyVol}張)`);
    if (!s.ma20Rising) failedConditions.push('20MA未走升');

    s.dynamicScore = 12 - failedConditions.length;
    s.failedConditions = failedConditions;

    // L4 與 L5 的嚴格過濾與總得分過濾 (Type E 已經完全融入 typeMatch)
    if (s.dynamicScore >= p.minScore && typeMatch && s.dist52W <= p.dist52W && (!p.closeHigh || s.closeToHigh)) {
      currentResults.push(s);
    }
  });

  // 依據新規則：最多篩選出前 40 檔符合規則之標的 (依達標數降序排列)
  currentResults.sort((a, b) => b.dynamicScore - a.dynamicScore);
  currentResults = currentResults.slice(0, 40);

  // 根據前 40 檔結果計算白名單與統計數據
  currentResults.forEach(s => {
    if (s.dynamicScore >= p.minScore) {
      currentWhitelist.push(s);
      const stockTypes = s.type ? s.type.split(',') : [];
      stockTypes.forEach(t => {
        if (t !== 'none') {
          stats[t] = (stats[t] || 0) + 1;
        }
      });
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
  document.getElementById('statTypeAVal').innerText = stats.A;
  document.getElementById('statTypeBVal').innerText = stats.B;
  
  const avgScore = currentWhitelist.length > 0 ? (stats.totalScore / currentWhitelist.length).toFixed(1) : 0;
  document.getElementById('statAvgScoreVal').innerText = avgScore;

  // 更新預覽區與清單
  renderScreenerTable(currentResults);
  renderWhitelistPreview();
  renderWhitelistGrid();
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
      <td>${getTechBadgesHTML(s.type)}</td>
      <td>${s.price} <span class="${s.change>=0?'text-up':'text-down'}">${s.change>0?'+':''}${s.change}%</span></td>
      <td><strong style="color:var(--warning)">${s.dynamicScore}</strong> /12</td>
      <td>${s.eps != null ? s.eps + '元' : '--'}<br><span style="font-size:10px;color:var(--text-muted)">YoY: ${s.epsYoY != null ? s.epsYoY + '%' : '--'}</span></td>
      <td>${s.revYoY != null ? s.revYoY + '%' : '--'}</td>
      <td>${s.roe != null ? s.roe + '%' : '--'}</td>
      <td>${s.trustDays != null ? `<span class="${s.trustDays > 0 ? 'text-up' : s.trustDays < 0 ? 'text-down' : ''}">${s.trustDays > 0 ? '+' : ''}${s.trustDays}張</span>` : '--'}</td>
      <td>${s.foreignNetBuy != null ? `<span class="${s.foreignNetBuy > 0 ? 'text-up' : s.foreignNetBuy < 0 ? 'text-down' : ''}">${s.foreignNetBuy > 0 ? '+' : ''}${s.foreignNetBuy}張</span>` : '--'}</td>
      <td>${s.dealerDays != null ? `<span class="${s.dealerDays > 0 ? 'text-up' : s.dealerDays < 0 ? 'text-down' : ''}">${s.dealerDays > 0 ? '+' : ''}${s.dealerDays}張</span>` : '--'}</td>
      <td>${s.volRatio}x</td>
      <td><button class="btn-link" onclick="event.stopPropagation(); openChart('${s.id}')">看圖</button></td>
    `;
    
    // 點擊顯示未達標項目
    tr.onclick = () => {
      if (s.failedConditions.length === 0) {
        alert(`【${s.id} ${s.name}】\n\n🎉 12 項條件全數達標！`);
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
        <span style="margin-left:6px;">${getTechBadgesHTML(s.type)}</span>
      </div>
      <div class="dash-wl-price ${parseFloat(s.change) >= 0 ? 'text-up' : 'text-down'}">${s.price}</div>
      <div class="dash-wl-score">${s.dynamicScore}<span style="font-size:10px;color:var(--text-muted)">/12</span></div>
    `;
    row.onclick = () => {
      document.querySelectorAll('.dash-wl-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      openChart(s.id);
    };
    container.appendChild(row);
  });
}



function renderWhitelistGrid() {
  const grid = document.getElementById('whitelistGrid');
  grid.innerHTML = '';
  currentWhitelist.sort((a,b)=>b.dynamicScore - a.dynamicScore).forEach(s => {
    const isPerfect = s.failedConditions.length === 0;
    const msg = isPerfect 
      ? `【${s.id} ${s.name}】\n\n🎉 12 項條件全數達標！`
      : `【${s.id} ${s.name}】未達標項目 (${s.failedConditions.length}項)：\n\n- ${s.failedConditions.join('\n- ')}`;
      
    grid.innerHTML += `
      <div class="wl-card" style="cursor:pointer;" title="點擊查看未達標項目" onclick="if (event.target.tagName !== 'BUTTON') { alert(decodeURIComponent('${encodeURIComponent(msg)}')); }">
        <div class="wl-card-header">
          <div>
            <h3>${s.id} ${s.name}</h3>
            ${getTechBadgesHTML(s.type)}
          </div>
          <div class="wl-score" style="color:var(--warning)">${s.dynamicScore} <span style="font-size:12px;color:var(--text-muted)">/ 12</span></div>
        </div>
        <div class="wl-card-body">
          <div>收盤：${s.price} (${s.change}%)</div>
          <div>EPS：${s.eps != null ? s.eps + '元' : '--'} (YoY: ${s.epsYoY != null ? s.epsYoY + '%' : '--'})</div>
          <div>營收 YoY：${s.revYoY != null ? s.revYoY + '%' : '--'}</div>
          <div>投信當日：${s.trustDays != null ? `<span class="${s.trustDays > 0 ? 'text-up' : s.trustDays < 0 ? 'text-down' : ''}">${s.trustDays > 0 ? '+' : ''}${s.trustDays}張</span>` : '--'}</div>
          <div>外資當日：${s.foreignNetBuy != null ? `<span class="${s.foreignNetBuy > 0 ? 'text-up' : s.foreignNetBuy < 0 ? 'text-down' : ''}">${s.foreignNetBuy > 0 ? '+' : ''}${s.foreignNetBuy}張</span>` : '--'}</div>
          <div>自營商當日：${s.dealerDays != null ? `<span class="${s.dealerDays > 0 ? 'text-up' : s.dealerDays < 0 ? 'text-down' : ''}">${s.dealerDays > 0 ? '+' : ''}${s.dealerDays}張</span>` : '--'}</div>
          <div>均量比：${s.volRatio}x</div>
          <div>距52W高：${s.dist52W}%</div>
          <div>20MA走升：${s.ma20Rising ? '✔ 是' : '✘ 否'}</div>
          <div>RSI(14)：${s.rsi14 ?? '--'}</div>
          <div>ATR(14)：${s.atr14 ?? '--'}</div>
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
  // 直接導向 Lightweight Charts 渲染（chart-engine.js 已廢棄）
  loadTVChart(stock);
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
  if (currentWhitelist.length === 0) { alert('白名單為空，請先執行篩選'); return; }
  const headers = ['代號','名稱','市場','收盤','漲跌%','技術類型','評分','EPS YoY%','營收 YoY%','ROE%','量比','距52W高%','20MA走升'];
  const rows = currentWhitelist.map(s => [
    s.id, s.name, s.market, s.price, s.change,
    s.type, s.dynamicScore, s.epsYoY, s.revYoY, s.roe,
    s.volRatio, s.dist52W, s.ma20Rising ? '是' : '否'
  ]);
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
  a.download = `荳荳白名單_${ts}.csv`;
  a.click();
  URL.revokeObjectURL(url);
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
    '投信買超不足': mockStocks.filter(s => s.trustDays < p.trustDays).length,
    '外資未買超':   mockStocks.filter(s => p.fb && !s.foreignBuy).length,
    '量能比':     mockStocks.filter(s => s.volRatio < p.volRatio).length,
    '週轉率':     mockStocks.filter(s => s.turnover < p.turnover).length,
    '市值':       mockStocks.filter(s => s.marketCap < p.mktCap).length,
    '日均量':     mockStocks.filter(s => s.dailyVol < p.dailyVol).length,
    '技術類型':   typeFail,
    '多頭趨勢濾網': mockStocks.filter(s => p.trendFilter && !(s.price >= s.ma20 && s.ma20Rising)).length,
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

// 手機版：展開/收合篩選條件
function toggleMobileFilter() {
  const panel = document.getElementById('filterPanel');
  if (panel) {
    panel.classList.toggle('active');
  }
}
