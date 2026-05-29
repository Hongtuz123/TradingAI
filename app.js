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

    // 完整的台股市場狀態判斷（覆蓋休市、非交易時段、開盤倒數與收盤）
    const day = now.getDay();
    const isWeekend = day === 0 || day === 6;
    const currentMin = now.getMinutes();

    if (isWeekend) {
      marketStatusText.innerText = `今日休市，請參考上週五盤後資料`;
    } else if (h < '09') {
      if (h === '08') {
        const targetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
        const diffMs = targetTime - now;
        const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
        const minutesLeft = Math.floor(totalSeconds / 60);
        const secondsLeft = totalSeconds % 60;
        marketStatusText.innerText = `距離開盤還有 ${minutesLeft} 分 ${secondsLeft} 秒`;
      } else {
        marketStatusText.innerText = `非交易時段 (09:00 開盤)`;
      }
    } else if (h === '09' && currentMin < 5) {
      marketStatusText.innerText = `台股剛開盤！請留意劇烈波動`;
    } else if ((h === '13' && currentMin >= 30) || h > '13') {
      marketStatusText.innerText = `台股已收盤，顯示靜態數據`;
    } else {
      marketStatusText.innerText = `台股盤中交易中，即時監控中`;
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

  // ── 輔助量能格式化與 Badge 產生器 ─────────────────────
  function formatVolNum(v) {
    if (v === null || v === undefined) return '--';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + ' B';
    if (v >= 1e6) return (v / 1e6).toFixed(1) + ' M';
    return v.toLocaleString();
  }
  
  function getVolLevelBadge(level) {
    if (!level) return '';
    let cls = 'warning'; // 普通
    if (level === '多') cls = 'success';
    if (level === '少') cls = 'danger';
    return `<span class="badge ${cls}" style="font-size: 9px; padding: 1px 5px; margin-left: 4px;">量:${level}</span>`;
  }

  // ── 台股版塊 ──────────────────────────────────────────
  const twData = marketData.tw_indices || [];
  const twHTML = twData.map(idx => `
    <div class="health-indicator-card tw-card" style="position: relative;">
      <div class="idx-name" style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
        <span>${idx.label}</span>
        <button onclick="openIndexIntroModal('${idx.label}')" style="background: none; border: none; color: var(--primary); cursor: pointer; font-size: 13px; padding: 2px 6px; border-radius: 4px; transition: background 0.2s;" onmouseover="this.style.background='rgba(59, 130, 246, 0.1)'" onmouseout="this.style.background='none'">❓</button>
      </div>
      <div class="idx-close">${idx.close !== null ? idx.close.toLocaleString() : '--'}</div>
      <div class="idx-pct" style="color:${pctColor(idx.pct_chg)};font-weight:700; display: flex; align-items: center; justify-content: space-between;">
        <span>${pctStr(idx.pct_chg)}</span>
        <span>${getVolLevelBadge(idx.vol_level)}</span>
      </div>
      <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">
        成交量: <span style="color: var(--text-main); font-weight: 600;">${formatVolNum(idx.volume)}</span>
      </div>
      <div class="idx-ma-badges" style="margin-top: 4px;">
        ${maBadge(idx.above_20ma, '>20MA')}
        ${maBadge(idx.above_60ma, '>60MA')}
      </div>
      <div style="font-size: 9px; color: var(--text-muted); margin-top: 4px; text-align: right; width: 100%;">
        更新：${updateTime}
      </div>
    </div>
  `).join('');
  document.getElementById('twIndicators').innerHTML = twHTML;

  // 大盤量
  const volVal = marketData.vol_above_20ma;
  const volLevel = marketData.vol_level || '普通';
  const latestVolNum = marketData.latest_vol_num;
  document.getElementById('volIndicator').innerHTML = volVal !== null && volVal !== undefined
    ? `<div class="health-indicator-card vol-card" style="position: relative; padding-bottom: 18px;">
         <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
           <div style="display: flex; align-items: center; gap: 4px;">
             <span style="font-size:12px; font-weight: 600;">大盤成交量</span>
             <button onclick="openIndexIntroModal('大盤成交量')" style="background: none; border: none; color: var(--primary); cursor: pointer; font-size: 12px; padding: 1px 4px; border-radius: 4px; transition: background 0.2s;" onmouseover="this.style.background='rgba(59, 130, 246, 0.1)'" onmouseout="this.style.background='none'">❓</button>
           </div>
           <div>
             <span class="badge ${volVal ? 'success' : 'danger'}">${volVal ? '> 20MA' : '< 20MA'}</span>
             ${getVolLevelBadge(volLevel)}
           </div>
         </div>
         <div style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">
           日成交量: <span style="color: var(--text-main); font-weight: 600;">${formatVolNum(latestVolNum)}</span>
         </div>
         <div style="font-size: 8px; color: var(--text-muted); position: absolute; bottom: 2px; right: 8px;">
           ${updateTime}
         </div>
       </div>`
    : '';

  // ── 美股版塊 ──────────────────────────────────────────
  const usData = marketData.us_indices || [];
  const usHTML = usData.map(idx => {
    if (idx.label.includes('VIX')) {
      let vixStatus = '安全';
      let vixColor = 'var(--success)';
      let vixBg = 'rgba(16, 185, 129, 0.12)';
      let vixBorder = 'rgba(16, 185, 129, 0.3)';
      const val = idx.close;
      if (val !== null && val !== undefined) {
        if (val > 30) {
          vixStatus = '極度恐慌';
          vixColor = 'var(--danger)';
          vixBg = 'rgba(239, 68, 68, 0.12)';
          vixBorder = 'rgba(239, 68, 68, 0.3)';
        } else if (val >= 20) {
          vixStatus = '警戒偏高';
          vixColor = 'var(--warning)';
          vixBg = 'rgba(245, 158, 11, 0.12)';
          vixBorder = 'rgba(245, 158, 11, 0.3)';
        }
      }
      return `
        <div class="health-indicator-card us-card" style="border: 1px solid ${vixBorder}; background: ${vixBg}; transition: all 0.3s; position: relative;">
          <div class="idx-name" style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
            <span style="font-weight: 700; color: var(--text-main);">${idx.label}</span>
            <button onclick="openIndexIntroModal('${idx.label}')" style="background: none; border: none; color: var(--primary); cursor: pointer; font-size: 13px; padding: 2px 6px; border-radius: 4px; transition: background 0.2s;" onmouseover="this.style.background='rgba(59, 130, 246, 0.1)'" onmouseout="this.style.background='none'">❓</button>
          </div>
          <div class="idx-close" style="font-size: 24px; font-weight: 800; color: ${vixColor}; margin: 4px 0;">${val !== null ? val.toFixed(2) : '--'}</div>
          <div class="idx-pct" style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
            <span class="badge" style="color: ${vixColor}; background: ${vixBg}; border: 1px solid ${vixBorder}; font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 4px; width: fit-content; display: inline-block;">${vixStatus}</span>
            <span style="font-size: 11px; color: var(--text-muted); font-weight: 600;">波動率指標</span>
          </div>
          <div style="font-size: 10px; color: var(--text-muted); margin-top: 6px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 4px; display: flex; justify-content: space-between;">
            <span>避險情緒指標</span>
            <span style="color: var(--text-main); font-weight: 600;">無成交量限制</span>
          </div>
          <div style="font-size: 9px; color: var(--text-muted); margin-top: 4px; text-align: right; width: 100%;">
            更新：${updateTime}
          </div>
        </div>
      `;
    }

    return `
      <div class="health-indicator-card us-card">
        <div class="idx-name" style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
          <span>${idx.label}</span>
          <button onclick="openIndexIntroModal('${idx.label}')" style="background: none; border: none; color: var(--primary); cursor: pointer; font-size: 13px; padding: 2px 6px; border-radius: 4px; transition: background 0.2s;" onmouseover="this.style.background='rgba(59, 130, 246, 0.1)'" onmouseout="this.style.background='none'">❓</button>
        </div>
        <div class="idx-close">${idx.close !== null ? idx.close.toLocaleString() : '--'}</div>
        <div class="idx-pct" style="color:${pctColor(idx.pct_chg)};font-weight:700; display: flex; align-items: center; justify-content: space-between;">
          <span>${pctStr(idx.pct_chg)}</span>
          <span>${getVolLevelBadge(idx.vol_level)}</span>
        </div>
        <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">
          成交量: <span style="color: var(--text-main); font-weight: 600;">${formatVolNum(idx.volume)}</span>
        </div>
        <div style="font-size: 9px; color: var(--text-muted); margin-top: 4px; text-align: right; width: 100%;">
          更新：${updateTime}
        </div>
      </div>
    `;
  }).join('');
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
  // 5 個指標：費半、那斯達克100、羅素2000、道瓊、S&P 500 (篩除 VIX)
  let usTotalScore = 0;
  usData.filter(idx => !idx.label.includes('VIX')).forEach(idx => {
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
    // 技術面（加入 null 防護）
    if (s.volRatio != null) {
      if (s.volRatio < p.volRatio) failedConditions.push(`量能比 (${s.volRatio} < ${p.volRatio})`);
    }
    chk(s.turnover,    s.turnover >= p.turnover, `週轉率 (${s.turnover ?? '--'}% < ${p.turnover}%)`);
    chk(s.marketCap,   s.marketCap >= p.mktCap,  `市值 (${s.marketCap ?? '--'}億 < ${p.mktCap}億)`);
    if (s.dailyVol != null) {
      if (s.dailyVol < p.dailyVol) failedConditions.push(`日均量 (${s.dailyVol}張 < ${p.dailyVol}張)`);
    }
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

  // 更新預覽區與清單
  renderScreenerTable(currentResults);
  renderWhitelistGrid();
  
  // 動態繪製熱力圖與強弱排行榜
  renderSectorFlowMap();
  renderRankings();
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
      <td><button class="btn-link" onclick="event.stopPropagation(); openChart('${s.id}')">回測</button></td>
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

// 全域排行分頁狀態
let currentRankTab = 'strong';

// 核心股票之「產業 > 族群」三層高精細分類補償表 (參照證交所分類與玩股網板塊)
const SECTOR_COMPENSATION = {
  // 格式: [股票代號]: "大產業:細分族群"
  '2330': '半導體:AI/CoWoS',
  '2303': '半導體:成熟製程代工',
  '6770': '半導體:成熟製程代工',
  '2408': '半導體:DRAM記憶體',
  '2344': '半導體:DRAM記憶體',
  '2337': '半導體:Flash快閃記憶體',
  '3711': '半導體:IC封測',
  '6239': '半導體:IC封測',
  '3707': '半導體:功率元件',
  '2317': '電腦週邊:AI伺服器組裝',
  '2382': '電腦週邊:AI伺服器組裝',
  '3231': '電腦週邊:AI伺服器組裝',
  '6669': '電腦週邊:AI伺服器組裝',
  '2324': '電腦週邊:伺服器組裝',
  '2474': '電腦週邊:機殼輕量',
  '3017': '電子零件:AI液冷散熱',
  '33383': '電子零件:AI液冷散熱', // 雙鴻等
  '2308': '電子零件:電源管理',
  '2383': '電子零件:銅箔基板(CCL)',
  '2368': '電子零件:PCB硬板',
  '3037': '電子零件:IC載板',
  '6531': 'IC設計:ASIC/IP授權',
  '3443': 'IC設計:ASIC/IP授權',
  '5351': 'IC設計:記憶體IC',
  '2454': 'IC設計:手機/通訊晶片',
  '3481': '光電面板:LCD大尺寸',
  '2409': '光電面板:LCD大尺寸',
  '8043': '電子零件:綜合零件',
  '6182': '半導體:矽晶圓',
  '6488': '半導體:矽晶圓',
  '4931': '電子零件:電源與散熱',
  '3030': '半導體:檢測設備',
  '2360': '半導體:檢測設備',
  '6788': '半導體:檢測設備'
};

// 智慧取得股票所屬的 [大產業] 與 [細分族群]
function getStockSector(s) {
  if (SECTOR_COMPENSATION[s.id]) {
    return SECTOR_COMPENSATION[s.id];
  }
  // 透過 OpenAPI 基本資料兜底
  if (s.industry) {
    return `一般板塊:${s.industry}`;
  }
  return '傳統產業:一般傳統';
}

// 核心產業與細分族群之詳細描述資料庫 (三層結構簡介)
const SECTOR_DESCRIPTIONS = {
  '半導體:AI/CoWoS': '【半導體 ➔ AI/CoWoS】這是目前全球科技業最核心的板塊。包含台積電等大廠，負責利用先進封裝技術將 GPU 與高頻寬記憶體整合，是生成式 AI 高效能運算晶片的終極出海口。',
  '半導體:成熟製程代工': '【半導體 ➔ 成熟製程】包含聯電、力積電等，提供汽車電子、電源管理與物聯網晶片的主力製造，與全球成熟型半導體產能需求密切相關。',
  '半導體:IC封測': '【半導體 ➔ IC封測】半導體後段製程，負責將切割好的晶片進行封裝測試，日月光、力成等為此領域先驅。',
  '半導體:DRAM記憶體': '【半導體 ➔ DRAM記憶體】用於電腦與伺服器暫存高速數據，隨AI PC與AI手機導入，高頻寬記憶體(HBM)需求呈爆發性成長。',
  'IC設計:ASIC/IP授權': '【IC設計 ➔ ASIC/IP授權】擁有極高毛利率，協助Google、Amazon等雲端大廠設計專屬的自主研發晶片，技術壁壘極高。',
  '電腦週邊:AI伺服器組裝': '【電腦週邊 ➔ AI伺服器組裝】隨NVIDIA GPU大量出貨，AI伺服器在電壓、高散熱、零組件容錯率有極嚴格指標，台廠在此領域擁有世界獨佔性優勢。',
  '電子零件:AI液冷散熱': '【電子零件 ➔ AI液冷散熱】高階運算功耗極大，氣冷已達極限。液冷散熱、熱導管與 3D VC 散熱元件正迎來全面性的爆發需求。',
  '電子零件:電源管理': '【電子零件 ➔ 電源管理】運算核心需要高效率、超穩定的電源調節系統，台達電等在該領域市佔與專利居全球領導地位。',
  '電子零件:銅箔基板(CCL)': '【電子零件 ➔ 銅箔基板(CCL)】印刷電路板最核心的基材。高頻高速運算需要極低損耗的高階板材，推動相關大廠營收高成長。',
  '電子零件:IC載板': '【電子零件 ➔ IC載板】用於 CoWoS 等高階晶片封裝，欣興、南電等為此高壁壘領域的全球領袖。',
  '光電面板:LCD大尺寸': '【光電面板 ➔ LCD大尺寸】大尺寸電視與車用顯示器主力，正積極朝 MicroLED 與電競高增值顯示板塊轉型。',
  '傳統產業:一般傳統': '【傳統產業 ➔ 一般傳產】涵蓋航運、金融、鋼鐵等傳統經濟循環板塊，主要受全球利率與航運報價波動影響。'
};

// 1. 繪製資金族群熱力圖 (TreeMap)
function renderSectorFlowMap() {
  const container = document.getElementById('sectorTreeMap');
  if (!container) return;
  container.innerHTML = '';

  // 對 mockStocks 進行產業分組
  const sectorGroups = {};
  mockStocks.forEach(s => {
    const sector = getStockSector(s);
    if (!sectorGroups[sector]) {
      sectorGroups[sector] = {
        name: sector,
        stocks: [],
        totalVolRatio: 0,
        avgChange: 0
      };
    }
    sectorGroups[sector].stocks.push(s);
    sectorGroups[sector].totalVolRatio += (s.volRatio || 1);
  });

  // 計算每個族群的平均值
  const sectorsArray = Object.values(sectorGroups);
  sectorsArray.forEach(g => {
    const sumChange = g.stocks.reduce((sum, s) => sum + (s.change || 0), 0);
    g.avgChange = g.stocks.length > 0 ? (sumChange / g.stocks.length) : 0;
  });

  // 排序：依據資金熱度 (總量能比) 降序排列，以填滿 Grid 排版
  sectorsArray.sort((a, b) => b.totalVolRatio - a.totalVolRatio);

  // 動態分配 CSS Grid 的 span 寬度 (總共 12 欄格柵)
  const totalHeat = sectorsArray.reduce((sum, s) => sum + s.totalVolRatio, 0);
  
  sectorsArray.forEach((g, idx) => {
    const ratio = g.totalVolRatio / totalHeat;
    let span = 2;
    if (ratio > 0.15) span = 6;
    else if (ratio > 0.08) span = 4;
    else if (ratio > 0.04) span = 3;

    // 依漲跌幅決定背景配色
    let colorClass = 'node-flat';
    if (g.avgChange > 2.0) colorClass = 'node-up-heavy';
    else if (g.avgChange > 0) colorClass = 'node-up-light';
    else if (g.avgChange < -2.0) colorClass = 'node-down-heavy';
    else if (g.avgChange < 0) colorClass = 'node-down-light';

    const node = document.createElement('div');
    node.className = `treemap-node ${colorClass}`;
    node.style.gridColumn = `span ${span}`;
    
    // 主力飆股顯示
    const leadStock = g.stocks.sort((a,b) => (b.volRatio||0) - (a.volRatio||0))[0];
    const leadStockStr = leadStock ? `${leadStock.id} ${leadStock.name}` : '--';

    node.innerHTML = `
      <div class="treemap-node-header" title="${g.name}">
        ${g.name.split(':')[1] || g.name}
      </div>
      <div class="treemap-node-body">
        <div class="treemap-node-meta">
          領頭: ${leadStockStr}<br>
          家數: ${g.stocks.length}檔
        </div>
        <div class="treemap-node-change">
          ${g.avgChange >= 0 ? '+' : ''}${g.avgChange.toFixed(2)}%
        </div>
      </div>
    `;

    // 🚀 重構：點擊熱力圖後彈出該族群內前 3~5 檔成分股的清單面板
    node.onclick = () => {
      openSectorDetailModal(g.name, g.stocks, g.avgChange);
    };

    container.appendChild(node);
  });
}

// 彈出產業詳細成分股及產業簡介之 Modal
function openSectorDetailModal(sectorName, stocks, avgChange) {
  const box = document.getElementById('modalContent');
  if (!box) return;

  // 排序選出最核心/量比最大的前 5 支成分股
  const topStocks = [...stocks]
    .sort((a, b) => (b.volRatio || 0) - (a.volRatio || 0))
    .slice(0, 5);

  const sectorDesc = SECTOR_DESCRIPTIONS[sectorName] || '台灣重要科技/傳統核心發展板塊，在產業供應鏈中扮演不可或缺的支援地位。';
  const displayTitle = sectorName.replace(':', ' ▸ ');

  // 產生個股清單 HTML
  const stocksHTML = topStocks.map(s => {
    return `
      <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); padding: 10px 14px; border-radius: 8px; margin-bottom: 8px; cursor: pointer; transition: all 0.2s;" 
           onmouseover="this.style.background='rgba(59, 130, 246, 0.1)'; this.style.borderColor='rgba(59, 130, 246, 0.3)';" 
           onmouseout="this.style.background='rgba(255,255,255,0.03)'; this.style.borderColor='rgba(255,255,255,0.05)';"
           onclick="showStockSectorIntro('${s.id}', '${s.name}', '${sectorName}', decodeURIComponent('${encodeURIComponent(sectorDesc)}'))">
        <div>
          <strong style="font-size:14px; color: var(--text-main);">${s.id} ${s.name}</strong>
          <span class="badge" style="font-size: 10px; margin-left: 6px;">量比: ${s.volRatio?.toFixed(1) || '1.0'}x</span>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <span style="font-weight: 700;" class="${s.change >= 0 ? 'text-up' : 'text-down'}">${s.price} (${s.change >= 0 ? '+' : ''}${s.change}%)</span>
          <button class="btn-primary" style="padding: 2px 8px; font-size:11px; height:24px;" onclick="event.stopPropagation(); closeModal(); openChart('${s.id}')">K線回測 📈</button>
        </div>
      </div>
    `;
  }).join('');

  box.innerHTML = `
    <div style="margin-bottom:15px;">
      <h2 style="color: var(--primary); margin-bottom: 6px; font-size: 18px;">🌱 ${displayTitle}</h2>
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
        族群今日平均漲跌幅：<span class="${avgChange >= 0 ? 'text-up' : 'text-down'}" style="font-weight:700;">${avgChange >= 0 ? '+' : ''}${avgChange.toFixed(2)}%</span>
      </div>
      <hr style="border: 0; border-top: 1px solid var(--border-color); margin-bottom: 15px;">
      
      <div style="background: rgba(30, 41, 59, 0.6); padding: 12px 16px; border-radius: 8px; border: 1.5px dashed rgba(245, 158, 11, 0.3); margin-bottom: 16px;">
        <h4 style="color: var(--warning); margin-bottom: 4px; font-size: 13px;">💡 產業簡介</h4>
        <p style="color: var(--text-main); font-size: 13px; line-height: 1.6; text-align: justify; margin: 0;">
          ${sectorDesc}
        </p>
      </div>

      <h4 style="color: var(--success); margin-bottom: 8px; font-size: 13px;">🎯 核心領頭成分股 (點擊看個股與產業連動)：</h4>
      <div style="max-height: 220px; overflow-y: auto; padding-right: 4px;">
        ${stocksHTML}
      </div>

      <div style="text-align: right; margin-top: 15px;">
        <button class="btn-secondary" onclick="closeModal()" style="padding: 4px 16px; font-size: 12px;">關閉</button>
      </div>
    </div>
  `;

  document.getElementById('stockModal').classList.add('active');
}

// 點擊個股後，呈現該個股的專屬產業簡介與策略連動
function showStockSectorIntro(stockId, stockName, sectorName, sectorDesc) {
  const box = document.getElementById('modalContent');
  if (!box) return;

  box.innerHTML = `
    <div style="margin-bottom:15px;">
      <h2 style="color: var(--primary); margin-bottom: 4px; font-size: 18px;">🔍 標的產業簡介：${stockId} ${stockName}</h2>
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">
        細分所屬板塊：<span style="color: var(--text-main); font-weight:700;">${sectorName.replace(':', ' ▸ ')}</span>
      </div>
      <hr style="border: 0; border-top: 1px solid var(--border-color); margin-bottom: 15px;">
      
      <div style="margin-bottom: 18px;">
        <h4 style="color: var(--warning); margin-bottom: 6px; font-size: 13px;">🌱 所屬產業描述</h4>
        <p style="color: var(--text-main); font-size: 13px; line-height: 1.6; text-align: justify;">
          ${sectorDesc}
        </p>
      </div>

      <div style="margin-bottom: 20px; background: rgba(16, 185, 129, 0.08); padding: 12px; border-radius: 8px; border-left: 4px solid var(--success);">
        <h4 style="color: var(--success); margin-bottom: 4px; font-size: 13px;">⚡ 個股與產業連動關係</h4>
        <p style="color: var(--text-main); font-size: 12.5px; line-height: 1.5; margin: 0;">
          當 <b>${sectorName.split(':')[1] || sectorName}</b> 族群啟動且整體平均量比大於 1.5 倍時，<b>${stockName}</b> 作為板塊主力，極易吸引投信與主力隔日沖資金進駐，進而產生突破型 (Type A) 或均線多頭 (Type B) 的技術面黃金買點！
        </p>
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 20px;">
        <button class="btn-secondary" onclick="closeModal()" style="padding: 4px 16px; font-size: 12px;">關閉</button>
        <button class="btn-primary" style="padding: 4px 20px; font-size: 12px;" onclick="closeModal(); openChart('${stockId}')">策略 K 線回測 📈</button>
      </div>
    </div>
  `;
}

// 2. 切換排行榜 Tab
function switchRankTab(tabId) {
  currentRankTab = tabId;
  document.querySelectorAll('.rank-tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  const activeBtn = document.querySelector(`.rank-tab-btn[onclick="switchRankTab('${tabId}')"]`);
  if (activeBtn) activeBtn.classList.add('active');
  
  renderRankings();
}

// 3. 渲染排行榜
function renderRankings() {
  const container = document.getElementById('rankListContent');
  if (!container) return;
  container.innerHTML = '';

  // 預先對 mockStocks 進行產業分組，提供族群強弱排行使用
  const sectorGroups = {};
  mockStocks.forEach(s => {
    const sector = getStockSector(s);
    if (!sectorGroups[sector]) {
      sectorGroups[sector] = { name: sector, stocks: [], avgChange: 0, totalVol: 0 };
    }
    sectorGroups[sector].stocks.push(s);
    sectorGroups[sector].totalVol += (s.dailyVol || 0) * (s.price || 0); // 估算成交金額
  });
  
  const sectorsArray = Object.values(sectorGroups);
  sectorsArray.forEach(g => {
    const sumChange = g.stocks.reduce((sum, s) => sum + (s.change || 0), 0);
    g.avgChange = g.stocks.length > 0 ? (sumChange / g.stocks.length) : 0;
  });

  // 讀取前台設定的限制個數，預設為 10
  const limitSelect = document.getElementById('rankLimitSelect');
  const limit = limitSelect ? parseInt(limitSelect.value) : 10;

  let listHTML = '';

  if (currentRankTab === 'strong') {
    // 強勢族群排行榜 (漲幅前 N 名)
    const sorted = [...sectorsArray].sort((a, b) => b.avgChange - a.avgChange).slice(0, limit);
    listHTML = sorted.map((g, idx) => {
      const displayTitle = g.name.replace(':', ' ▸ ');
      const val = (g.totalVol / 1e8).toFixed(1); // 億元
      return `
        <div class="rank-item-row" onclick="openSectorDetailModal('${g.name}', ${JSON.stringify(g.stocks).replace(/"/g, '&quot;')}, ${g.avgChange})">
          <div class="rank-number top${idx+1}">${idx+1}</div>
          <div class="rank-info">
            <div class="rank-title">${displayTitle}</div>
            <div class="rank-desc">成分股: ${g.stocks.length}檔 | 估算資金: ${val}億</div>
          </div>
          <div class="rank-value text-up">+${g.avgChange.toFixed(2)}%</div>
        </div>
      `;
    }).join('');

  } else if (currentRankTab === 'weak') {
    // 弱勢族群排行榜 (跌幅前 N 名)
    const sorted = [...sectorsArray].sort((a, b) => a.avgChange - b.avgChange).slice(0, limit);
    listHTML = sorted.map((g, idx) => {
      const displayTitle = g.name.replace(':', ' ▸ ');
      const val = (g.totalVol / 1e8).toFixed(1); // 億元
      return `
        <div class="rank-item-row" onclick="openSectorDetailModal('${g.name}', ${JSON.stringify(g.stocks).replace(/"/g, '&quot;')}, ${g.avgChange})">
          <div class="rank-number top${idx+1}">${idx+1}</div>
          <div class="rank-info">
            <div class="rank-title">${displayTitle}</div>
            <div class="rank-desc">成分股: ${g.stocks.length}檔 | 估算資金: ${val}億</div>
          </div>
          <div class="rank-value text-down">${g.avgChange.toFixed(2)}%</div>
        </div>
      `;
    }).join('');

  } else if (currentRankTab === 'hot') {
    // 熱門標的排行榜 (量能比 volRatio 排序前 N 名)
    const sorted = [...mockStocks].sort((a, b) => (b.volRatio || 0) - (a.volRatio || 0)).slice(0, limit);
    listHTML = sorted.map((s, idx) => {
      const sector = getStockSector(s).split(':')[1] || '一般';
      return `
        <div class="rank-item-row" onclick="openChart('${s.id}')">
          <div class="rank-number top${idx+1}">${idx+1}</div>
          <div class="rank-info">
            <div class="rank-title">${s.id} ${s.name}</div>
            <div class="rank-desc">${sector} | 成交量: ${s.dailyVol?.toLocaleString() || '--'}張</div>
          </div>
          <div class="rank-value text-up" style="color: var(--warning);">${s.volRatio?.toFixed(2) || '1.0'}x</div>
        </div>
      `;
    }).join('');

  } else if (currentRankTab === 'inst') {
    // 法人買超排行榜 (投信+外資買超張數加總排序前 N 名)
    const sorted = [...mockStocks].sort((a, b) => {
      const sumA = (a.trustDays || 0) + (a.foreignNetBuy || 0);
      const sumB = (b.trustDays || 0) + (b.foreignNetBuy || 0);
      return sumB - sumA;
    }).slice(0, limit);
    
    listHTML = sorted.map((s, idx) => {
      const sumBuy = (s.trustDays || 0) + (s.foreignNetBuy || 0);
      return `
        <div class="rank-item-row" onclick="openChart('${s.id}')">
          <div class="rank-number top${idx+1}">${idx+1}</div>
          <div class="rank-info">
            <div class="rank-title">${s.id} ${s.name}</div>
            <div class="rank-desc">外資: ${s.foreignNetBuy || 0}張 | 投信: ${s.trustDays || 0}張</div>
          </div>
          <div class="rank-value text-up">+${sumBuy.toLocaleString()}張</div>
        </div>
      `;
    }).join('');
  }

  container.innerHTML = listHTML || '<p style="color:var(--text-muted);padding:10px;">查無排行資料</p>';
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
          <button class="btn-secondary" style="font-size:12px;padding:4px 8px;" onclick="openChart('${s.id}')">策略回測 →</button>
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

// 表格點擊排序狀態記錄器
let currentSortKey = 'score'; // 預設排序欄位
let currentSortDir = 'desc';  // 預設降序

function sortResults(by) {
  currentSortKey = by;
  currentSortDir = 'desc'; // 下拉選單預設以降序排列
  applyCurrentSort();
}

function toggleSort(key) {
  if (currentSortKey === key) {
    // 同一欄位點擊，切換升降序
    currentSortDir = currentSortDir === 'desc' ? 'asc' : 'desc';
  } else {
    // 新欄位點擊，預設改為降序 (更符合交易員看最大值習慣)
    currentSortKey = key;
    currentSortDir = 'desc';
  }
  applyCurrentSort();
}

function applyCurrentSort() {
  let sorted = [...currentResults];
  const isDesc = currentSortDir === 'desc';

  sorted.sort((a, b) => {
    let valA = getSortValue(a, currentSortKey);
    let valB = getSortValue(b, currentSortKey);

    // 處理空值 (null/undefined) 永遠沉底的防爆設計
    if (valA === null || valA === undefined) return 1;
    if (valB === null || valB === undefined) return -1;

    if (typeof valA === 'string' && typeof valB === 'string') {
      return isDesc ? valB.localeCompare(valA) : valA.localeCompare(valB);
    }
    return isDesc ? valB - valA : valA - valB;
  });

  // 更新所有標頭的 UI 排序圖示
  updateSortIcons();

  renderScreenerTable(sorted);
}

// 根據 key 抓取對應屬性值
function getSortValue(item, key) {
  switch (key) {
    case 'id':
      return item.id;
    case 'techType':
      return item.type || '';
    case 'price':
      return item.price;
    case 'score':
      return item.dynamicScore;
    case 'epsGrowth':
      return item.epsYoY;
    case 'revGrowth':
      return item.revYoY;
    case 'roe':
      return item.roe;
    case 'trustDays':
      return item.trustDays;
    case 'foreignNet':
      return item.foreignNetBuy;
    case 'dealerNet':
      return item.dealerDays;
    case 'volRatio':
      return item.volRatio;
    default:
      return 0;
  }
}

// 更新 results Table 標頭的視覺圖標
function updateSortIcons() {
  const keys = ['id', 'techType', 'price', 'score', 'epsGrowth', 'revGrowth', 'roe', 'trustDays', 'foreignNet', 'dealerNet', 'volRatio'];
  keys.forEach(k => {
    const el = document.getElementById(`sort-${k}`);
    if (el) {
      if (currentSortKey === k) {
        el.innerText = currentSortDir === 'desc' ? '▼' : '▲';
        el.style.color = 'var(--primary)';
        el.style.fontWeight = 'bold';
      } else {
        el.innerText = '↕';
        el.style.color = 'var(--text-muted)';
        el.style.fontWeight = 'normal';
      }
    }
  });

  // 連動更新 results-meta 的下拉選單選項 value
  const selectSort = document.getElementById('resultSort');
  if (selectSort) {
    if (['score', 'techType', 'epsGrowth', 'revGrowth', 'trustDays'].includes(currentSortKey)) {
      selectSort.value = currentSortKey;
    }
  }
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
    const stockTypes = s.type ? s.type.split(',') : [];
    const typeMatch = (!p.typeA && !p.typeB && !p.typeC && !p.typeD && !p.typeE) || 
                      (p.typeA && stockTypes.includes('A')) || 
                      (p.typeB && stockTypes.includes('B')) || 
                      (p.typeC && stockTypes.includes('C')) || 
                      (p.typeD && stockTypes.includes('D')) || 
                      (p.typeE && stockTypes.includes('E'));
    return !typeMatch;
  }).length;

  const fails = {
    '綜合評分不足': mockStocks.filter(s => s.dynamicScore < p.minScore).length,
    '月營收 YoY': mockStocks.filter(s => s.revYoY != null && s.revYoY < p.rev).length,
    'EPS YoY':    mockStocks.filter(s => s.epsYoY != null && s.epsYoY < p.eps).length,
    'ROE':        mockStocks.filter(s => s.roe != null && s.roe < p.roe).length,
    '毛利率':     mockStocks.filter(s => s.grossMargin != null && s.grossMargin < p.margin).length,
    '負債比':     mockStocks.filter(s => s.debtRatio != null && s.debtRatio > p.debt).length,
    '投信買超不足': mockStocks.filter(s => s.trustDays != null && s.trustDays < p.trustDays).length,
    '外資未買超':   mockStocks.filter(s => p.fb && s.foreignBuy != null && !s.foreignBuy).length,
    '量能比':     mockStocks.filter(s => s.volRatio != null && s.volRatio < p.volRatio).length,
    '週轉率':     mockStocks.filter(s => s.turnover != null && s.turnover < p.turnover).length,
    '市值':       mockStocks.filter(s => s.marketCap != null && s.marketCap < p.mktCap).length,
    '日均量':     mockStocks.filter(s => s.dailyVol != null && s.dailyVol < p.dailyVol).length,
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

// ========== 各指數意涵科普彈窗 ==========
function openIndexIntroModal(label) {
  const data = {
    '加權指數': {
      title: '加權指數 (TAIEX) 🇹🇼',
      desc: '俗稱「大盤」，是台灣證券交易所編製的股價指數，用來衡量「全台灣所有上市公司」的整體表現。它是以市值加權計分，市值越大的公司影響越大。',
      influence: '台灣前幾大權值股，包含<b>台積電 (2330)</b>（影響高達30%以上）、鴻海、聯發科、廣達等。當大盤上漲時，通常代表大型權值股受外資青睞，市場信心強勁。'
    },
    '櫃買指數': {
      title: '櫃買指數 (OTC) 🇹🇼',
      desc: '代表台灣證券櫃檯買賣中心（上櫃市場）的整體股價指數。上櫃公司多為「中小型企業」或「新創高科技公司」，股性通常比上市公司活潑、波動較劇烈。',
      influence: '中小型半導體、IC設計（如信驊、力旺）、生技類股（如藥華藥）等。櫃買指數通常被視為「內資與主力散戶」的信心指標，當它強於加權指數時，中小型股會百花齊放。'
    },
    '大盤成交量': {
      title: '大盤成交量 📊',
      desc: '指當天加權市場成交的總股數與成交金額。成交量代表市場的資金動能，是價格能否持續上漲的「油門」。',
      influence: '<b>量增價揚</b>是健康多頭，當量大於 20MA（20日平均量）時，代表資金進場，強勢股容易續漲；若出現<b>量縮價跌</b>通常是高檔整理，但如果是<b>價漲量縮</b>則要提防虛胖無量拉回。'
    },
    '費半 SOX': {
      title: '費城半導體指數 (SOX) 🇺🇸',
      desc: '由美股市場中最大的 30 家半導體（設計、設備、製造）晶片企業組成的指數，是全球半導體景氣的終極指標。',
      influence: '<b>台灣半導體產業鏈</b>。台積電、聯電、聯發科、全新、日月光等都與費半走勢高度正相關，費半大漲通常隔天台股科技股也會跟著噴出。'
    },
    '那斯達克 100': {
      title: '那斯達克 100 指數 (NDX) 🇺🇸',
      desc: '成分股包含在那斯達克交易所上市的 100 家最大型「非金融企業」，主要由頂尖的「高科技、軟體、網路與生技」巨頭組成。',
      influence: '美股科技七巨頭（蘋果、微軟、輝達、亞馬遜、Meta、Google、特斯拉）。影響台股所有<b>AI伺服器供應鏈（廣達、緯創、台達電）</b>及關鍵電子零組件股的出口展望。'
    },
    '羅素 2000': {
      title: '羅素 2000 指數 (RUT) 🇺🇸',
      desc: '由美國股市中市值較小的 2000 家中小型企業組成，是觀察美國「本土實體經濟」與中小企業活力的最重要櫥窗。',
      influence: '主要對應台灣的<b>外銷中小型股與傳產出口商</b>。當羅素2000轉強，代表美國消費力道強勁，降息預期高，熱錢容易流入新興市場。'
    },
    '道瓊 DJI': {
      title: '道瓊工業平均指數 (DJI) 🇺🇸',
      desc: '歷史最悠久的美股指數，由美國 30 家最知名、最具代表性的「藍籌優質特大型企業」組成（非科技股居多，如波音、高盛、可口可樂）。',
      influence: '台股中的<b>傳統產業、金融股、塑化與鋼鐵板塊</b>。道瓊大漲代表美國傳統產業景氣與基本面良好，資金風格偏向安全穩健的價值股。'
    },
    'S&P 500': {
      title: '標準普爾 500 指數 (SPX) 🇺🇸',
      desc: '由美國 500 家最具代表性的上市公司組成，涵蓋多種產業。因為產業結構均衡，被公認為最能代表「美國整體股市」與大局趨勢的指標。',
      influence: '幾乎影響<b>全球所有資產定價與外資熱錢的流向</b>。當S&P 500大漲，代表外資風險胃口大開，熱錢會批量湧入台灣股市，帶動台幣升值與加權指數齊漲。'
    },
    'VIX 恐慌指數': {
      title: 'VIX 波動率恐慌指數 (VIX) 🇺🇸',
      desc: '又稱「恐慌指數」，是芝加哥選擇權交易所 (CBOE) 波動率指數的代號，用來衡量 S&P 500 指數未來 30 天的預期波動程度。當市場恐慌時，VIX 會急遽飆高；市場穩定時，VIX 會處於低位。',
      influence: '全球避險情緒與台美股修正警戒。<b>VIX < 20 (安全區)</b>：代表大盤平穩健康；<b>20 ~ 30 (警戒區)</b>：需提防市場出現劇烈震盪或拉回；<b>> 30 (恐慌區)</b>：代表系統性危機爆發，主力爆量殺出，宜保留高成數現金避險。'
    }
  };

  const info = data[label] || {
    title: label,
    desc: '市場重要參考指標，提供當下大環境資金與多空景氣脈絡。',
    influence: '影響整體市場氣氛與外資對該特定板塊的持股信心。'
  };

  const box = document.getElementById('modalContent');
  box.innerHTML = `
    <div style="margin-bottom:20px;">
      <h2 style="color: var(--primary); margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
        <span>${info.title}</span>
      </h2>
      <hr style="border: 0; border-top: 1px solid var(--border-color); margin-bottom: 16px;">
      
      <div style="margin-bottom: 18px;">
        <h4 style="color: var(--warning); margin-bottom: 6px;">💡 代表什麼意涵？</h4>
        <p style="color: var(--text-main); font-size: 14px; line-height: 1.6; text-align: justify;">
          ${info.desc}
        </p>
      </div>

      <div style="margin-bottom: 24px;">
        <h4 style="color: var(--success); margin-bottom: 6px;">🎯 影響哪些相關股票？</h4>
        <p style="color: var(--text-main); font-size: 14px; line-height: 1.6; text-align: justify;">
          ${info.influence}
        </p>
      </div>

      <div style="text-align: center;">
        <button class="btn-primary" onclick="closeModal()" style="padding: 6px 20px; font-size: 14px;">我明白了！</button>
      </div>
    </div>
  `;

  document.getElementById('stockModal').classList.add('active');
}

