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

    // 盤中定時（每 5 秒）自動更新價格並刷新當前啟動之視圖畫面，非盤中則固定保留昨收數據
    if (s % 5 === 0 && isMarketActive()) {
      updateAllStockPrices();
      if (currentActiveView === 'dashboard') {
        renderSectorFlowMap();
        renderRankings();
      } else if (currentActiveView === 'screener') {
        runScreener();
      } else if (currentActiveView === 'whitelist') {
        renderWhitelistGrid();
      } else if (currentActiveView === 'portfolio') {
        renderPortfolioGrid();
      }
    }
  }, 1000);
}

// 全域同步更新所有股票的最新價格與漲跌幅
window.updateAllStockPrices = function() {
  if (typeof mockStocks !== 'undefined' && Array.isArray(mockStocks)) {
    mockStocks.forEach(s => {
      const live = getLiveStockData(s);
      s.price = live.price;
      s.change = live.change;
    });
  }
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  // 優先同步所有股票之最新價格與漲跌幅
  updateAllStockPrices();

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
let currentActiveView = 'dashboard';
function switchView(viewId) {
  currentActiveView = viewId;
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
  } else if (viewId === 'portfolio') {
    renderPortfolioGrid();
  } else if (viewId === 'cmoney') {
    // CMoney 產業對照功能已整合至儀表板，此頁籤目前導向儀表板
    switchView('dashboard');
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


// 判斷台股當前是否為交易時段 (盤中週一至五 09:00 - 13:30)
function isMarketActive() {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return false; // 週末休市
  const h = now.getHours();
  const m = now.getMinutes();
  const timeVal = h * 100 + m;
  return timeVal >= 900 && timeVal <= 1330;
}

// 獲取盤中即時模擬波動之價格與漲跌幅 (輔助盤中參考)
window.getLiveStockData = function(s) {
  if (!isMarketActive()) {
    // 關盤後：使用該股最後一天 K 線與前一天的收盤價計算出精準的昨收價格與昨收漲跌幅
    if (s.kline && s.kline.length >= 2) {
      const lastCandle = s.kline[s.kline.length - 1];
      const prevCandle = s.kline[s.kline.length - 2];
      const price = parseFloat(lastCandle.close);
      const prevPrice = parseFloat(prevCandle.close);
      const change = prevPrice > 0 ? ((price - prevPrice) / prevPrice * 100) : 0;
      return { price: price, change: parseFloat(change.toFixed(2)) };
    }
    return { price: s.price || 0, change: s.change || 0 };
  }
  
  // 盤中即時狀態：依據隨機數做非常微幅的實時隨機波動 (波動率為 0.05% 至 0.2%)
  // 保持同一分鐘內波動相對穩定 (用當前分鐘數當種子)
  const minuteSeed = new Date().getMinutes();
  const idHash = (s.id.charCodeAt(0) || 0) + (s.id.charCodeAt(1) || 0) * 10;
  const rand = Math.sin(minuteSeed + idHash) * 0.5 + 0.5; // 0 到 1 之間
  const wavePct = (rand - 0.5) * 0.4; // -0.2% 到 +0.2%
  
  const livePrice = Math.round(s.price * (1 + wavePct / 100) * 100) / 100;
  const liveChange = Math.round((s.change + wavePct) * 100) / 100;

  return { price: livePrice, change: liveChange };
};

// 執行篩選
function runScreener() {
  // 每次執行篩選前，全面同步一次所有股票最新價格與漲跌幅
  updateAllStockPrices();

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

  // 全域變數重設
  currentResults = [];
  currentWhitelist = [];
  
  let stats = { A:0, B:0, C:0, D:0, E:0, totalScore: 0 };

  // 全數標的走訪：即時盤中運算動態套用
  mockStocks.forEach(s => {
    // 同步相容屬性以供舊程式碼安全讀取
    s.livePrice = s.price;
    s.liveChange = s.change;

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

    // L4 與 L5 的嚴格過濾與總得分過濾
    if (s.dynamicScore >= p.minScore && typeMatch && s.dist52W <= p.dist52W && (!p.closeHigh || s.closeToHigh)) {
      currentResults.push(s);
    }
  });

  // 排序並過濾白名單（白名單不受篩選器前40檔切片限制，完全獨立呈現符合分數的白名單）
  currentResults.sort((a, b) => b.dynamicScore - a.dynamicScore);

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

  // 只有在【篩選器表格結果】時，才進行前 40 檔切片限制渲染！
  const slicedScreenerResults = currentResults.slice(0, 40);

  // 更新預覽區與清單
  renderScreenerTable(slicedScreenerResults);
  renderWhitelistGrid();
  
  // 動態繪製熱力圖與強弱排行榜（現在使用 mockStocks 全體標的進行計算）
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
      <td>${s.livePrice || s.price} <span class="${(s.liveChange || s.change)>=0?'text-up':'text-down'}">${(s.liveChange || s.change)>0?'+':''}${(s.liveChange || s.change)}%</span></td>
      <td><strong style="color:var(--warning)">${s.dynamicScore}</strong> /12</td>
      <td>${s.eps != null ? s.eps + '元' : '--'}<br><span style="font-size:10px;color:var(--text-muted)">YoY: ${s.epsYoY != null ? s.epsYoY + '%' : '--'}</span></td>
      <td>${s.revYoY != null ? s.revYoY + '%' : '--'}</td>
      <td>${s.roe != null ? s.roe + '%' : '--'}</td>
      <td>${s.trustDays != null ? `<span class="${s.trustDays > 0 ? 'text-up' : s.trustDays < 0 ? 'text-down' : ''}">${s.trustDays > 0 ? '+' : ''}${s.trustDays}張</span>` : '--'}</td>
      <td>${s.foreignNetBuy != null ? `<span class="${s.foreignNetBuy > 0 ? 'text-up' : s.foreignNetBuy < 0 ? 'text-down' : ''}">${s.foreignNetBuy > 0 ? '+' : ''}${s.foreignNetBuy}張</span>` : '--'}</td>
      <td>${s.dealerDays != null ? `<span class="${s.dealerDays > 0 ? 'text-up' : s.dealerDays < 0 ? 'text-down' : ''}">${s.dealerDays > 0 ? '+' : ''}${s.dealerDays}張</span>` : '--'}</td>
      <td>${s.volRatio}x</td>
      <td>
        <div style="display:flex; gap:6px;">
          <button class="btn-link" onclick="event.stopPropagation(); openChart('${s.id}')">回測</button>
          <button class="btn-link" style="color:var(--warning);" onclick="event.stopPropagation(); toggleStockPortfolio('${s.id}')">
            ${isStockInPortfolio(s.id) ? '★ 已自選' : '☆ 自選'}
          </button>
        </div>
      </td>
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

// 核心股票之「產業 > 族群」三層高精細分類補償表 (參照 CMoney 股市爆料同學會 category 產業分類大綱與細分標準)
const SECTOR_COMPENSATION = {
  '1101': '傳產:水泥',
  '1102': '傳產:水泥',
  '1103': '傳產:水泥',
  '1104': '傳產:水泥',
  '1108': '傳產:水泥',
  '1109': '傳產:水泥',
  '1110': '傳產:水泥',
  '1201': '傳產:食品',
  '1203': '傳產:食品',
  '1210': '傳產:食品',
  '1213': '傳產:食品',
  '1215': '傳產:食品',
  '1216': '傳產:食品',
  '1217': '傳產:食品',
  '1218': '傳產:食品',
  '1219': '傳產:食品',
  '1220': '傳產:食品',
  '1225': '傳產:食品',
  '1227': '傳產:食品',
  '1229': '傳產:食品',
  '1231': '傳產:食品',
  '1232': '傳產:食品',
  '1233': '傳產:食品',
  '1234': '傳產:食品',
  '1235': '傳產:食品',
  '1236': '傳產:食品',
  '1240': '傳產:食品',
  '1256': '傳產:食品',
  '1259': '傳產:觀光',
  '1264': '傳產:食品',
  '1268': '傳產:觀光',
  '1294': '傳產:食品',
  '1295': '傳產:生技',
  '1301': '傳產:塑膠',
  '1303': '傳產:塑膠',
  '1304': '傳產:塑膠',
  '1305': '傳產:塑膠',
  '1307': '傳產:塑膠',
  '1308': '傳產:塑膠',
  '1309': '傳產:塑膠',
  '1310': '傳產:塑膠',
  '1312': '傳產:塑膠',
  '1313': '傳產:塑膠',
  '1314': '傳產:塑膠',
  '1315': '傳產:塑膠',
  '1316': '傳產:營建',
  '1319': '傳產:汽車零組件',
  '1321': '傳產:塑膠',
  '1323': '傳產:塑膠',
  '1324': '傳產:塑膠',
  '1325': '傳產:塑膠',
  '1326': '傳產:塑膠',
  '1336': '電子上游:連接元件',
  '1337': '傳產:塑膠',
  '1338': '傳產:汽車零組件',
  '1339': '傳產:汽車零組件',
  '1340': '傳產:塑膠',
  '1341': '傳產:塑膠',
  '1342': '傳產:塑膠',
  '1402': '傳產:紡織纖維',
  '1409': '傳產:紡織纖維',
  '1410': '傳產:紡織纖維',
  '1413': '傳產:紡織纖維',
  '1414': '傳產:紡織纖維',
  '1416': '軟體:系統整合',
  '1417': '傳產:紡織纖維',
  '1418': '傳產:紡織纖維',
  '1419': '傳產:紡織纖維',
  '1423': '傳產:紡織纖維',
  '1432': '傳產:運動休閒',
  '1434': '傳產:紡織纖維',
  '1435': '傳產:其他',
  '1436': '傳產:營建',
  '1437': '傳產:其他',
  '1438': '傳產:營建',
  '1439': '傳產:營建',
  '1440': '傳產:紡織纖維',
  '1441': '傳產:紡織纖維',
  '1442': '傳產:營建',
  '1443': '傳產:航運',
  '1444': '傳產:紡織纖維',
  '1445': '傳產:紡織纖維',
  '1446': '傳產:紡織纖維',
  '1447': '傳產:紡織纖維',
  '1449': '傳產:紡織纖維',
  '1451': '傳產:紡織纖維',
  '1452': '傳產:紡織纖維',
  '1453': '傳產:營建',
  '1454': '傳產:紡織纖維',
  '1455': '傳產:紡織纖維',
  '1456': '傳產:營建',
  '1457': '傳產:紡織纖維',
  '1459': '傳產:紡織纖維',
  '1460': '傳產:紡織纖維',
  '1463': '傳產:紡織纖維',
  '1464': '傳產:紡織纖維',
  '1465': '傳產:紡織纖維',
  '1466': '傳產:紡織纖維',
  '1467': '傳產:紡織纖維',
  '1468': '傳產:紡織纖維',
  '1470': '傳產:紡織纖維',
  '1471': '電子中游:電源供應器',
  '1472': '傳產:營建',
  '1473': '傳產:紡織纖維',
  '1474': '傳產:紡織纖維',
  '1475': '傳產:紡織纖維',
  '1476': '傳產:紡織纖維',
  '1477': '傳產:紡織纖維',
  '1503': '傳產:電機',
  '1504': '傳產:電機',
  '1506': '傳產:汽車零組件',
  '1512': '傳產:汽車零組件',
  '1513': '傳產:電機',
  '1514': '傳產:電機',
  '1515': '傳產:運動休閒',
  '1516': '傳產:其他',
  '1517': '傳產:運動休閒',
  '1519': '傳產:電機',
  '1521': '傳產:汽車零組件',
  '1522': '傳產:汽車零組件',
  '1524': '傳產:汽車零組件',
  '1525': '傳產:汽車零組件',
  '1526': '傳產:電機',
  '1527': '傳產:電機',
  '1528': '傳產:電機',
  '1529': '傳產:電機',
  '1530': '傳產:電機',
  '1531': '傳產:電機',
  '1532': '傳產:鋼鐵',
  '1533': '傳產:汽車零組件',
  '1535': '傳產:電機',
  '1536': '傳產:汽車零組件',
  '1537': '傳產:汽車零組件',
  '1538': '傳產:電機',
  '1539': '傳產:電機',
  '1540': '傳產:電機',
  '1541': '傳產:電機',
  '1558': '傳產:電機',
  '1560': '電子上游:IC-代工',
  '1563': '傳產:汽車零組件',
  '1565': '傳產:生技',
  '1568': '傳產:汽車零組件',
  '1569': '電子中游:機殼',
  '1570': '傳產:電機',
  '1580': '傳產:電機',
  '1582': '電子上游:連接元件',
  '1583': '傳產:電機',
  '1584': '傳產:鋼鐵',
  '1586': '傳產:汽車零組件',
  '1587': '傳產:汽車',
  '1589': '傳產:電機',
  '1590': '傳產:電機',
  '1591': '傳產:電機',
  '1593': '傳產:運動休閒',
  '1595': '電子上游:PCB-材料設備',
  '1597': '傳產:電機',
  '1598': '傳產:運動休閒',
  '1599': '傳產:汽車零組件',
  '1603': '傳產:電線電纜',
  '1604': '電子下游:消費電子',
  '1605': '傳產:電線電纜',
  '1608': '傳產:電線電纜',
  '1609': '傳產:電線電纜',
  '1611': '傳產:照明',
  '1612': '傳產:電線電纜',
  '1614': '電子下游:消費電子',
  '1615': '傳產:電線電纜',
  '1616': '傳產:電線電纜',
  '1617': '傳產:電線電纜',
  '1618': '傳產:電線電纜',
  '1623': '傳產:電線電纜',
  '1626': '電子下游:消費電子',
  '1702': '傳產:食品',
  '1707': '傳產:生技',
  '1708': '傳產:化學工業',
  '1709': '傳產:化學工業',
  '1710': '傳產:化學工業',
  '1711': '傳產:化學工業',
  '1712': '傳產:化學工業',
  '1713': '傳產:化學工業',
  '1714': '傳產:化學工業',
  '1717': '傳產:化學工業',
  '1718': '傳產:化學工業',
  '1720': '傳產:生技',
  '1721': '傳產:化學工業',
  '1722': '傳產:化學工業',
  '1723': '傳產:化學工業',
  '1725': '傳產:化學工業',
  '1726': '傳產:化學工業',
  '1727': '傳產:化學工業',
  '1730': '傳產:化學工業',
  '1731': '傳產:生技',
  '1732': '傳產:化學工業',
  '1733': '傳產:生技',
  '1734': '傳產:生技',
  '1735': '傳產:化學工業',
  '1736': '傳產:運動休閒',
  '1737': '傳產:食品',
  '1742': '傳產:化學工業',
  '1752': '傳產:生技',
  '1760': '傳產:生技',
  '1762': '傳產:生技',
  '1773': '傳產:化學工業',
  '1776': '傳產:化學工業',
  '1777': '傳產:生技',
  '1781': '傳產:生技',
  '1783': '傳產:生技',
  '1784': '傳產:生技',
  '1785': '傳產:其他',
  '1786': '傳產:生技',
  '1788': '傳產:生技',
  '1789': '傳產:生技',
  '1795': '傳產:生技',
  '1796': '傳產:生技',
  '1799': '傳產:生技',
  '1802': '傳產:玻璃陶瓷',
  '1805': '傳產:營建',
  '1806': '傳產:玻璃陶瓷',
  '1808': '傳產:營建',
  '1809': '傳產:玻璃陶瓷',
  '1810': '傳產:玻璃陶瓷',
  '1813': '傳產:生技',
  '1815': '電子上游:PCB-材料設備',
  '1817': '傳產:玻璃陶瓷',
  '1903': '傳產:紙業',
  '1904': '傳產:紙業',
  '1905': '傳產:紙業',
  '1906': '傳產:紙業',
  '1907': '傳產:紙業',
  '1909': '傳產:紙業',
  '2002': '傳產:鋼鐵',
  '2006': '傳產:鋼鐵',
  '2007': '傳產:鋼鐵',
  '2008': '傳產:鋼鐵',
  '2009': '傳產:鋼鐵',
  '2010': '傳產:鋼鐵',
  '2012': '傳產:鋼鐵',
  '2013': '傳產:鋼鐵',
  '2014': '傳產:鋼鐵',
  '2015': '傳產:鋼鐵',
  '2017': '傳產:鋼鐵',
  '2020': '傳產:鋼鐵',
  '2022': '傳產:鋼鐵',
  '2023': '傳產:鋼鐵',
  '2024': '傳產:鋼鐵',
  '2025': '傳產:鋼鐵',
  '2027': '傳產:鋼鐵',
  '2028': '傳產:鋼鐵',
  '2029': '傳產:鋼鐵',
  '2030': '傳產:鋼鐵',
  '2031': '傳產:鋼鐵',
  '2032': '傳產:鋼鐵',
  '2033': '傳產:鋼鐵',
  '2034': '傳產:鋼鐵',
  '2035': '傳產:鋼鐵',
  '2038': '傳產:鋼鐵',
  '2049': '傳產:電機',
  '2059': '電子中游:金屬製品',
  '2061': '傳產:電線電纜',
  '2062': '傳產:其他',
  '2063': '傳產:鋼鐵',
  '2064': '傳產:鋼鐵',
  '2065': '傳產:鋼鐵',
  '2066': '傳產:汽車零組件',
  '2067': '傳產:電機',
  '2069': '傳產:鋼鐵',
  '2070': '傳產:電機',
  '2072': '傳產:綠能環保',
  '2073': '傳產:電線電纜',
  '2101': '傳產:橡膠',
  '2102': '傳產:橡膠',
  '2103': '傳產:橡膠',
  '2104': '傳產:橡膠',
  '2105': '傳產:橡膠',
  '2106': '傳產:橡膠',
  '2107': '傳產:橡膠',
  '2108': '傳產:橡膠',
  '2109': '傳產:橡膠',
  '2114': '傳產:橡膠',
  '2115': '傳產:汽車零組件',
  '2201': '傳產:汽車',
  '2204': '傳產:汽車',
  '2206': '傳產:汽車',
  '2207': '傳產:汽車',
  '2208': '傳產:航運',
  '2211': '傳產:鋼鐵',
  '2221': '傳產:鋼鐵',
  '2227': '傳產:汽車',
  '2228': '傳產:汽車零組件',
  '2230': '傳產:其他',
  '2231': '傳產:汽車零組件',
  '2233': '傳產:汽車零組件',
  '2235': '傳產:汽車零組件',
  '2236': '傳產:汽車零組件',
  '2239': '傳產:汽車零組件',
  '2241': '傳產:汽車零組件',
  '2243': '傳產:汽車零組件',
  '2247': '傳產:汽車',
  '2248': '傳產:汽車零組件',
  '2250': '傳產:汽車零組件',
  '2254': '傳產:汽車',
  '2258': '傳產:汽車',
  '2301': '電子中游:電源供應器',
  '2302': '電子上游:IC-製造',
  '2303': '電子上游:IC-代工',
  '2305': '電子下游:掃描器',
  '2308': '電子中游:電源供應器',
  '2312': '電子中游:EMS',
  '2313': '電子上游:PCB-製造',
  '2314': '電子中游:通訊設備',
  '2316': '電子上游:PCB-製造',
  '2317': '電子中游:EMS',
  '2321': '電子中游:通訊設備',
  '2323': '電子下游:其他',
  '2324': '電子下游:筆記型電腦',
  '2327': '電子上游:被動元件',
  '2328': '電子上游:連接元件',
  '2329': '電子上游:IC-封測',
  '2330': '電子上游:IC-代工',
  '2331': '電子中游:主機板',
  '2332': '電子中游:網通',
  '2337': '電子上游:IC-製造',
  '2338': '電子上游:IC-半導體設備',
  '2340': '電子上游:LED及光元件',
  '2342': '電子上游:IC-代工',
  '2344': '電子上游:IC-製造',
  '2345': '電子中游:網通',
  '2347': '電子上游:IC-通路',
  '2348': '傳產:其他',
  '2349': '電子下游:其他',
  '2351': '電子上游:IC-導線架',
  '2352': '電子下游:顯示器',
  '2353': '電子下游:筆記型電腦',
  '2354': '電子中游:機殼',
  '2355': '電子上游:PCB-製造',
  '2356': '電子下游:筆記型電腦',
  '2357': '電子下游:筆記型電腦',
  '2359': '電子下游:其他',
  '2360': '電子中游:儀器設備工程',
  '2362': '電子下游:筆記型電腦',
  '2363': '電子上游:IC-設計',
  '2364': '電子下游:筆記型電腦',
  '2365': '電子下游:電腦周邊',
  '2367': '電子上游:PCB-製造',
  '2368': '電子上游:PCB-製造',
  '2369': '電子上游:IC-封測',
  '2371': '傳產:電機',
  '2373': '電子下游:資訊通路',
  '2374': '電子下游:數位相機',
  '2375': '電子上游:被動元件',
  '2376': '電子中游:主機板',
  '2377': '電子中游:主機板',
  '2379': '電子上游:IC-設計',
  '2380': '電子下游:掃描器',
  '2382': '電子下游:筆記型電腦',
  '2383': '電子上游:PCB-材料設備',
  '2385': '電子下游:電腦周邊',
  '2387': '電子中游:NB與手機零組件',
  '2388': '電子上游:IC-設計',
  '2390': '電子下游:安全監控',
  '2392': '電子上游:連接元件',
  '2393': '電子上游:LED及光元件',
  '2395': '電子下游:工業電腦',
  '2397': '電子下游:工業電腦',
  '2399': '電子中游:主機板',
  '2401': '電子上游:IC-設計',
  '2402': '電子上游:PCB-製造',
  '2404': '電子中游:儀器設備工程',
  '2405': '電子中游:主機板',
  '2406': '電子下游:太陽能',
  '2408': '電子上游:IC-DRAM製造',
  '2409': '電子中游:LCD-TFT面板',
  '2412': '電子下游:電信服務',
  '2413': '電子中游:電源供應器',
  '2414': '電子下游:資訊通路',
  '2415': '電子中游:聲學元件',
  '2417': '電子中游:PC介面卡',
  '2419': '電子中游:通訊設備',
  '2420': '電子中游:電源供應器',
  '2421': '電子中游:散熱零組件',
  '2423': '電子中游:儀器設備工程',
  '2424': '電子中游:通訊設備',
  '2425': '電子中游:主機板',
  '2426': '電子上游:LED及光元件',
  '2427': '軟體:系統整合',
  '2428': '電子上游:被動元件',
  '2429': '電子上游:LED及光元件',
  '2430': '電子下游:資訊通路',
  '2431': '電子中游:電源供應器',
  '2432': '電子中游:NB與手機零組件',
  '2433': '電子下游:資訊通路',
  '2434': '電子上游:IC-製造',
  '2436': '電子上游:IC-設計',
  '2438': '電子上游:LED及光元件',
  '2439': '電子下游:消費電子',
  '2440': '電子上游:連接元件',
  '2441': '電子上游:IC-封測',
  '2442': '傳產:營建',
  '2444': '電子中游:網通',
  '2449': '電子上游:IC-封測',
  '2450': '電子下游:資訊通路',
  '2451': '電子上游:DRAM銷售',
  '2453': '軟體:系統整合',
  '2454': '電子上游:IC-設計',
  '2455': '電子上游:半導體元件',
  '2457': '電子中游:電源供應器',
  '2458': '電子上游:IC-設計',
  '2459': '電子中游:其他',
  '2460': '電子上游:連接元件',
  '2461': '電子中游:其他',
  '2462': '電子上游:連接元件',
  '2464': '電子中游:儀器設備工程',
  '2465': '電子中游:主機板',
  '2466': '電子上游:LED及光元件',
  '2467': '電子上游:PCB-材料設備',
  '2468': '軟體:系統整合',
  '2471': '軟體:系統整合',
  '2472': '電子上游:被動元件',
  '2474': '電子中游:機殼',
  '2476': '電子上游:連接元件',
  '2477': '電子下游:消費電子',
  '2478': '電子上游:被動元件',
  '2480': '軟體:系統整合',
  '2481': '電子上游:IC-製造',
  '2482': '電子下游:商業自動化',
  '2483': '電子上游:IC-導線架',
  '2484': '電子上游:被動元件',
  '2485': '電子中游:通訊設備',
  '2486': '電子上游:IC-導線架',
  '2488': '電子下游:消費電子',
  '2489': '電子下游:顯示器',
  '2491': '傳產:照明',
  '2492': '電子上游:被動元件',
  '2493': '電子上游:PCB-材料設備',
  '2495': '電子中游:磁碟陣列',
  '2496': '傳產:文創娛樂',
  '2497': '傳產:汽車零組件',
  '2498': '電子下游:手機製造',
  '2501': '傳產:營建',
  '2504': '傳產:營建',
  '2505': '傳產:營建',
  '2506': '傳產:營建',
  '2509': '傳產:營建',
  '2511': '傳產:營建',
  '2514': '傳產:營建',
  '2515': '傳產:營建',
  '2516': '傳產:營建',
  '2520': '傳產:營建',
  '2524': '傳產:營建',
  '2527': '傳產:營建',
  '2528': '傳產:營建',
  '2530': '傳產:營建',
  '2534': '傳產:營建',
  '2535': '傳產:營建',
  '2536': '傳產:營建',
  '2537': '傳產:營建',
  '2538': '傳產:營建',
  '2539': '傳產:營建',
  '2540': '傳產:營建',
  '2542': '傳產:營建',
  '2543': '傳產:營建',
  '2545': '傳產:營建',
  '2546': '傳產:營建',
  '2547': '傳產:營建',
  '2548': '傳產:營建',
  '2596': '傳產:營建',
  '2597': '傳產:營建',
  '2601': '傳產:航運',
  '2603': '傳產:航運',
  '2605': '傳產:航運',
  '2606': '傳產:航運',
  '2607': '傳產:航運',
  '2608': '傳產:航運',
  '2609': '傳產:航運',
  '2610': '傳產:航運',
  '2611': '傳產:航運',
  '2612': '傳產:航運',
  '2613': '傳產:航運',
  '2614': '傳產:其他',
  '2615': '傳產:航運',
  '2616': '傳產:其他',
  '2617': '傳產:航運',
  '2618': '傳產:航運',
  '2630': '傳產:航運',
  '2633': '傳產:航運',
  '2634': '傳產:航運',
  '2636': '傳產:航運',
  '2637': '傳產:航運',
  '2640': '傳產:其他',
  '2641': '傳產:航運',
  '2642': '傳產:航運',
  '2643': '傳產:航運',
  '2645': '傳產:電機',
  '2646': '傳產:航運',
  '2701': '傳產:觀光',
  '2702': '傳產:觀光',
  '2704': '傳產:觀光',
  '2705': '傳產:觀光',
  '2706': '傳產:觀光',
  '2707': '傳產:觀光',
  '2712': '傳產:觀光',
  '2718': '傳產:營建',
  '2719': '傳產:觀光',
  '2722': '傳產:觀光',
  '2723': '傳產:觀光',
  '2724': '傳產:其他',
  '2726': '傳產:觀光',
  '2727': '傳產:觀光',
  '2729': '傳產:觀光',
  '2731': '傳產:觀光',
  '2732': '傳產:觀光',
  '2734': '傳產:觀光',
  '2736': '傳產:觀光',
  '2739': '傳產:觀光',
  '2740': '傳產:觀光',
  '2743': '傳產:觀光',
  '2745': '傳產:觀光',
  '2748': '傳產:觀光',
  '2751': '傳產:食品',
  '2752': '傳產:觀光',
  '2753': '傳產:觀光',
  '2754': '傳產:觀光',
  '2755': '傳產:觀光',
  '2756': '傳產:觀光',
  '2762': '傳產:運動休閒',
  '2801': '金融:銀行',
  '2812': '金融:銀行',
  '2816': '金融:保險',
  '2820': '金融:證券',
  '2832': '金融:保險',
  '2834': '金融:銀行',
  '2836': '金融:銀行',
  '2838': '金融:銀行',
  '2845': '金融:銀行',
  '2849': '金融:銀行',
  '2850': '金融:保險',
  '2851': '金融:保險',
  '2852': '金融:保險',
  '2855': '金融:證券',
  '2867': '金融:保險',
  '2880': '金融:金控',
  '2881': '金融:金控',
  '2882': '金融:金控',
  '2883': '金融:金控',
  '2884': '金融:金控',
  '2885': '金融:金控',
  '2886': '金融:金控',
  '2887': '金融:金控',
  '2889': '金融:金控',
  '2890': '金融:金控',
  '2891': '金融:金控',
  '2892': '金融:金控',
  '2897': '金融:銀行',
  '2901': '傳產:百貨',
  '2903': '傳產:百貨',
  '2904': '傳產:航運',
  '2905': '傳產:百貨',
  '2906': '傳產:百貨',
  '2908': '傳產:百貨',
  '2910': '傳產:百貨',
  '2911': '傳產:百貨',
  '2912': '傳產:百貨',
  '2913': '傳產:百貨',
  '2915': '傳產:百貨',
  '2916': '傳產:百貨',
  '2923': '傳產:營建',
  '2924': '傳產:百貨',
  '2926': '傳產:文創娛樂',
  '2929': '傳產:百貨',
  '2937': '電子下游:資訊通路',
  '2939': '傳產:百貨',
  '2941': '傳產:其他',
  '2945': '傳產:百貨',
  '2947': '傳產:百貨',
  '2948': '傳產:其他',
  '2949': '軟體:其他',
  '3002': '電子中游:電源供應器',
  '3003': '電子上游:連接元件',
  '3004': '傳產:航運',
  '3005': '電子下游:筆記型電腦',
  '3006': '電子上游:記憶體IC設計',
  '3008': '電子中游:光學鏡片',
  '3010': '電子上游:IC-通路',
  '3011': '電子上游:連接元件',
  '3013': '電子中游:機殼',
  '3014': '電子上游:記憶體IC設計',
  '3015': '電子中游:電源供應器',
  '3016': '電子上游:晶圓材料',
  '3017': '電子中游:NB與手機零組件',
  '3018': '傳產:電機',
  '3019': '電子中游:光學鏡片',
  '3021': '電子上游:連接元件',
  '3022': '電子下游:工業電腦',
  '3023': '電子上游:連接元件',
  '3024': '電子下游:消費電子',
  '3025': '電子中游:通訊設備',
  '3026': '電子上游:被動元件',
  '3027': '電子下游:太陽能',
  '3028': '電子上游:IC-通路',
  '3029': '軟體:系統整合',
  '3030': '電子中游:儀器設備工程',
  '3031': '電子上游:LED及光元件',
  '3032': '電子中游:機殼',
  '3033': '電子上游:IC-通路',
  '3034': '電子上游:IC-設計',
  '3035': '電子上游:IP/ASIC',
  '3036': '電子上游:IC-通路',
  '3037': '電子上游:ABF',
  '3038': '電子中游:LCD-STN面板',
  '3040': '電子下游:消費電子',
  '3041': '電子上游:IC-設計',
  '3042': '電子上游:被動元件',
  '3043': '電子中游:變壓器與UPS',
  '3044': '電子上游:PCB-製造',
  '3045': '電子下游:電信服務',
  '3046': '電子下游:工業電腦',
  '3047': '電子下游:消費電子',
  '3048': '電子上游:IC-通路',
  '3049': '電子中游:LCD-零組件',
  '3050': '電子下游:其他',
  '3051': '電子中游:LCD-零組件',
  '3052': '傳產:營建',
  '3054': '傳產:食品',
  '3055': '電子中游:儀器設備工程',
  '3056': '傳產:營建',
  '3057': '電子中游:磁碟陣列',
  '3058': '電子中游:電源供應器',
  '3059': '電子下游:數位相機',
  '3060': '電子中游:NB與手機零組件',
  '3062': '電子中游:網通',
  '3064': '軟體:遊戲',
  '3066': '電子上游:LED及光元件',
  '3067': '傳產:其他',
  '3071': '電子中游:NB與手機零組件',
  '3073': '傳產:綠能環保',
  '3078': '電子中游:電源供應器',
  '3081': '電子上游:半導體元件',
  '3083': '軟體:遊戲',
  '3085': '軟體:其他',
  '3086': '軟體:遊戲',
  '3088': '電子下游:工業電腦',
  '3090': '電子上游:被動元件',
  '3092': '電子上游:連接元件',
  '3093': '電子中游:儀器設備工程',
  '3094': '電子上游:IC-設計',
  '3095': '電子中游:NB與手機零組件',
  '3105': '電子上游:IC-代工',
  '3114': '電子下游:資訊通路',
  '3115': '電子上游:PCB-製造',
  '3118': '傳產:生技',
  '3122': '電子上游:IC-設計',
  '3128': '電子下游:安全監控',
  '3130': '軟體:其他',
  '3131': '電子上游:IC-半導體設備',
  '3135': '電子上游:DRAM銷售',
  '3138': '電子中游:通訊設備',
  '3141': '電子上游:IC-設計',
  '3147': '軟體:系統整合',
  '3149': '電子中游:LCD-STN面板',
  '3150': '電子上游:IC-製造',
  '3152': '電子上游:被動元件',
  '3158': '軟體:系統整合',
  '3162': '傳產:自行車',
  '3163': '電子中游:通訊設備',
  '3164': '傳產:生技',
  '3167': '傳產:電機',
  '3168': '電子下游:顯示器',
  '3169': '電子上游:IC-設計',
  '3171': '傳產:塑膠',
  '3176': '傳產:生技',
  '3178': '電子上游:IC-半導體設備',
  '3188': '傳產:營建',
  '3189': '電子上游:ABF',
  '3191': '電子中游:變壓器與UPS',
  '3205': '傳產:生技',
  '3206': '電子中游:聲學元件',
  '3207': '電子上游:被動元件',
  '3209': '電子上游:IC-通路',
  '3211': '電子中游:二次電池',
  '3213': '電子下游:筆記型電腦',
  '3217': '電子上游:連接元件',
  '3218': '傳產:生技',
  '3219': '電子中游:儀器設備工程',
  '3221': '電子上游:被動元件',
  '3224': '電子中游:電子元件通路',
  '3226': '傳產:汽車零組件',
  '3227': '電子上游:IC-設計',
  '3228': '電子上游:IC-設計',
  '3229': '電子上游:PCB-製造',
  '3230': '電子中游:機殼',
  '3231': '電子下游:筆記型電腦',
  '3232': '電子上游:IC-通路',
  '3234': '電子中游:網通',
  '3236': '電子上游:被動元件',
  '3252': '傳產:觀光',
  '3257': '電子上游:IC-設計',
  '3259': '電子上游:IC-設計',
  '3260': '電子上游:DRAM銷售',
  '3264': '電子上游:IC-封測',
  '3265': '電子上游:IC-封測',
  '3266': '傳產:營建',
  '3268': '電子上游:IC-設計',
  '3272': '電子下游:電腦周邊',
  '3276': '電子上游:PCB-製造',
  '3284': '傳產:其他',
  '3285': '電子下游:消費電子',
  '3287': '電子下游:電腦周邊',
  '3288': '電子上游:IC-設計',
  '3289': '電子上游:IC-其他',
  '3290': '電子上游:連接元件',
  '3293': '軟體:遊戲',
  '3294': '電子中游:機殼',
  '3296': '電子中游:電源供應器',
  '3297': '電子下游:安全監控',
  '3303': '電子中游:其他',
  '3305': '電子上游:PCB-材料設備',
  '3306': '電子中游:通訊設備',
  '3308': '電子中游:電源供應器',
  '3310': '電子上游:連接元件',
  '3311': '傳產:汽車零組件',
  '3312': '電子上游:IC-通路',
  '3313': '傳產:營建',
  '3317': '電子上游:IC-設計',
  '3321': '電子上游:PCB-製造',
  '3322': '電子上游:連接元件',
  '3323': '電子中游:NB與手機零組件',
  '3324': '電子中游:散熱零組件',
  '3325': '電子中游:機殼',
  '3332': '電子中游:電源供應器',
  '3338': '電子中游:散熱零組件',
  '3339': '電子上游:LED及光元件',
  '3346': '傳產:汽車零組件',
  '3349': '電子下游:電腦周邊',
  '3354': '電子上游:PCB-製造',
  '3356': '電子下游:安全監控',
  '3357': '電子上游:被動元件',
  '3360': '電子上游:IC-通路',
  '3362': '電子中游:光學鏡片',
  '3363': '電子上游:被動元件',
  '3372': '電子上游:IC-封測',
  '3373': '傳產:生技',
  '3374': '電子上游:IC-封測',
  '3376': '電子上游:連接元件',
  '3379': '傳產:電機',
  '3380': '電子中游:網通',
  '3388': '電子上游:IC-通路',
  '3390': '電子上游:PCB-製造',
  '3402': '電子中游:儀器設備工程',
  '3406': '電子中游:光學鏡片',
  '3413': '電子上游:IC-半導體設備',
  '3416': '電子下游:工業電腦',
  '3419': '電子中游:網通',
  '3426': '傳產:電機',
  '3430': '傳產:化學工業',
  '3432': '電子上游:連接元件',
  '3434': '電子下游:安全監控',
  '3437': '電子上游:LED及光元件',
  '3438': '電子上游:IC-設計',
  '3441': '電子中游:光學鏡片',
  '3443': '電子上游:IP/ASIC',
  '3444': '電子上游:IC-通路',
  '3447': '電子下游:資訊通路',
  '3450': '電子上游:IC-封測',
  '3455': '電子上游:PCB-材料設備',
  '3465': '電子下游:消費電子',
  '3466': '電子中游:通訊設備',
  '3467': '電子上游:IC-其他',
  '3479': '電子下游:工業電腦',
  '3481': '電子中游:LCD-TFT面板',
  '3483': '電子中游:散熱零組件',
  '3484': '電子上游:連接元件',
  '3485': '電子中游:儀器設備工程',
  '3489': '傳產:營建',
  '3490': '電子中游:儀器設備工程',
  '3491': '電子中游:通訊設備',
  '3492': '電子上游:連接元件',
  '3494': '電子下游:電腦周邊',
  '3498': '電子中游:儀器設備工程',
  '3499': '電子中游:通訊設備',
  '3501': '電子上游:連接元件',
  '3504': '電子中游:光學鏡片',
  '3508': '電子中游:機殼',
  '3511': '電子上游:連接元件',
  '3512': '傳產:營建',
  '3515': '電子中游:主機板',
  '3516': '電子中游:LCD-零組件',
  '3518': '傳產:其他',
  '3520': '電子上游:連接元件',
  '3521': '傳產:營建',
  '3522': '傳產:觀光',
  '3523': '電子中游:LCD-零組件',
  '3526': '電子上游:連接元件',
  '3527': '電子上游:IC-設計',
  '3528': '電子上游:IC-通路',
  '3529': '電子上游:IP/ASIC',
  '3530': '電子上游:IC-設計',
  '3531': '電子上游:LED及光元件',
  '3532': '電子上游:晶圓材料',
  '3533': '電子上游:連接元件',
  '3535': '電子中游:儀器設備工程',
  '3537': '電子上游:IC-通路',
  '3540': '電子下游:電腦周邊',
  '3541': '電子下游:消費電子',
  '3543': '電子中游:LCD-TFT面板',
  '3545': '電子上游:IC-設計',
  '3546': '軟體:遊戲',
  '3548': '電子上游:連接元件',
  '3550': '電子中游:儀器設備工程',
  '3551': '電子中游:儀器設備工程',
  '3552': '傳產:汽車零組件',
  '3555': '傳產:生技',
  '3556': '電子上游:IC-設計',
  '3557': '傳產:其他',
  '3558': '電子中游:網通',
  '3563': '電子中游:儀器設備工程',
  '3564': '電子下游:工業電腦',
  '3567': '電子上游:IC-封測',
  '3570': '軟體:系統整合',
  '3576': '電子下游:太陽能',
  '3577': '電子下游:工業電腦',
  '3580': '電子中游:儀器設備工程',
  '3581': '電子上游:IC-封測',
  '3583': '電子上游:IC-半導體設備',
  '3587': '電子上游:IC-其他',
  '3588': '電子上游:IC-設計',
  '3591': '電子上游:LED及光元件',
  '3592': '電子上游:IC-設計',
  '3593': '電子中游:機殼',
  '3594': '電子下游:工業電腦',
  '3596': '電子中游:網通',
  '3597': '電子上游:連接元件',
  '3605': '電子上游:連接元件',
  '3607': '電子中游:機殼',
  '3609': '電子上游:LED及光元件',
  '3611': '電子下游:工業電腦',
  '3615': '電子中游:LCD-STN面板',
  '3617': '電子中游:變壓器與UPS',
  '3622': '電子中游:LCD-STN面板',
  '3623': '電子中游:LCD-STN面板',
  '3624': '電子上游:被動元件',
  '3625': '電子中游:NB與手機零組件',
  '3628': '電子中游:變壓器與UPS',
  '3629': '傳產:其他',
  '3630': '電子中游:光學鏡片',
  '3631': '電子上游:PCB-製造',
  '3632': '軟體:系統整合',
  '3645': '電子上游:PCB-製造',
  '3646': '電子上游:連接元件',
  '3652': '電子下游:工業電腦',
  '3653': '電子中游:散熱零組件',
  '3661': '電子上游:IP/ASIC',
  '3663': '傳產:其他',
  '3664': '電子下游:安全監控',
  '3665': '電子上游:連接元件',
  '3666': '電子中游:LCD-零組件',
  '3669': '電子中游:通訊設備',
  '3672': '電子中游:通訊設備',
  '3673': '電子中游:LCD-STN面板',
  '3675': '電子上游:IC-製造',
  '3679': '電子上游:連接元件',
  '3680': '電子上游:IC-半導體設備',
  '3684': '電子中游:通訊設備',
  '3685': '傳產:電機',
  '3686': '電子下游:太陽能',
  '3687': '軟體:其他',
  '3689': '電子上游:連接元件',
  '3691': '電子下游:太陽能',
  '3693': '電子中游:機殼',
  '3694': '電子中游:網通',
  '3701': '電子中游:EMS',
  '3702': '電子上游:IC-通路',
  '3703': '傳產:營建',
  '3704': '電子中游:網通',
  '3705': '傳產:生技',
  '3706': '電子中游:EMS',
  '3707': '電子上游:晶圓材料',
  '3708': '傳產:綠能環保',
  '3709': '電子下游:資訊通路',
  '3710': '電子上游:連接元件',
  '3711': '電子上游:IC-封測',
  '3712': '傳產:綠能環保',
  '3713': '電子下游:太陽能',
  '3714': '電子上游:IC-其他',
  '3715': '電子上游:PCB-製造',
  '3716': '傳產:生技',
  '3717': '電子上游:LED及光元件',
  '4102': '傳產:生技',
  '4104': '傳產:生技',
  '4105': '傳產:生技',
  '4106': '傳產:生技',
  '4107': '傳產:生技',
  '4108': '傳產:生技',
  '4109': '傳產:生技',
  '4111': '傳產:生技',
  '4113': '傳產:營建',
  '4114': '傳產:生技',
  '4116': '傳產:生技',
  '4119': '傳產:生技',
  '4120': '傳產:生技',
  '4121': '傳產:生技',
  '4123': '傳產:生技',
  '4126': '傳產:生技',
  '4127': '傳產:生技',
  '4128': '傳產:生技',
  '4129': '傳產:生技',
  '4130': '傳產:生技',
  '4131': '傳產:生技',
  '4133': '傳產:生技',
  '4137': '傳產:生技',
  '4138': '傳產:生技',
  '4139': '傳產:生技',
  '4142': '傳產:生技',
  '4147': '傳產:生技',
  '4148': '傳產:生技',
  '4153': '傳產:生技',
  '4154': '傳產:其他',
  '4155': '傳產:生技',
  '4157': '傳產:生技',
  '4160': '傳產:生技',
  '4161': '傳產:生技',
  '4162': '傳產:生技',
  '4163': '傳產:生技',
  '4164': '傳產:生技',
  '4166': '傳產:生技',
  '4167': '傳產:生技',
  '4168': '傳產:生技',
  '4169': '傳產:生技',
  '4171': '傳產:生技',
  '4173': '傳產:生技',
  '4174': '傳產:生技',
  '4175': '傳產:生技',
  '4178': '傳產:生技',
  '4183': '傳產:生技',
  '4188': '傳產:生技',
  '4190': '傳產:生技',
  '4192': '傳產:生技',
  '4195': '傳產:生技',
  '4198': '傳產:生技',
  '4205': '傳產:食品',
  '4207': '傳產:食品',
  '4303': '傳產:塑膠',
  '4304': '傳產:塑膠',
  '4305': '傳產:塑膠',
  '4306': '傳產:塑膠',
  '4401': '傳產:紡織纖維',
  '4402': '傳產:紡織纖維',
  '4406': '傳產:紡織纖維',
  '4413': '傳產:紡織纖維',
  '4414': '傳產:紡織纖維',
  '4416': '傳產:營建',
  '4417': '傳產:紡織纖維',
  '4419': '傳產:觀光',
  '4420': '傳產:紡織纖維',
  '4426': '傳產:紡織纖維',
  '4430': '傳產:其他',
  '4432': '傳產:紡織纖維',
  '4433': '傳產:紡織纖維',
  '4438': '傳產:紡織纖維',
  '4439': '傳產:紡織纖維',
  '4440': '傳產:紡織纖維',
  '4441': '傳產:紡織纖維',
  '4442': '傳產:紡織纖維',
  '4502': '傳產:汽車零組件',
  '4503': '電子下游:顯示器',
  '4506': '傳產:電機',
  '4510': '傳產:電機',
  '4513': '傳產:電機',
  '4523': '傳產:汽車零組件',
  '4526': '傳產:電機',
  '4527': '傳產:電機',
  '4528': '傳產:汽車零組件',
  '4529': '傳產:其他',
  '4530': '傳產:觀光',
  '4532': '傳產:電機',
  '4533': '傳產:電機',
  '4534': '傳產:電機',
  '4535': '傳產:汽車零組件',
  '4536': '傳產:運動休閒',
  '4538': '傳產:電機',
  '4540': '傳產:電機',
  '4541': '傳產:航運',
  '4542': '電子上游:PCB-材料設備',
  '4543': '傳產:汽車零組件',
  '4545': '電子上游:連接元件',
  '4549': '傳產:電機',
  '4550': '傳產:電機',
  '4551': '傳產:汽車零組件',
  '4552': '傳產:電機',
  '4554': '傳產:汽車零組件',
  '4555': '傳產:電機',
  '4556': '傳產:其他',
  '4557': '傳產:汽車零組件',
  '4558': '傳產:其他',
  '4560': '傳產:電機',
  '4561': '傳產:電機',
  '4562': '傳產:汽車零組件',
  '4563': '傳產:電機',
  '4564': '傳產:其他',
  '4566': '傳產:汽車零組件',
  '4568': '傳產:電機',
  '4569': '傳產:汽車零組件',
  '4571': '傳產:電機',
  '4572': '傳產:電機',
  '4576': '傳產:電機',
  '4577': '電子上游:PCB-材料設備',
  '4580': '傳產:電機',
  '4581': '傳產:汽車零組件',
  '4582': '傳產:綠能環保',
  '4583': '傳產:電機',
  '4584': '傳產:其他',
  '4585': '電子下游:其他',
  '4588': '電子中游:其他',
  '4590': '傳產:電機',
  '4609': '傳產:電機',
  '4702': '傳產:化學工業',
  '4706': '傳產:化學工業',
  '4707': '傳產:化學工業',
  '4711': '傳產:化學工業',
  '4714': '傳產:化學工業',
  '4716': '傳產:化學工業',
  '4720': '傳產:化學工業',
  '4721': '傳產:化學工業',
  '4722': '傳產:化學工業',
  '4726': '傳產:生技',
  '4728': '傳產:生技',
  '4729': '電子中游:其他',
  '4735': '傳產:生技',
  '4736': '傳產:生技',
  '4737': '傳產:生技',
  '4739': '傳產:化學工業',
  '4741': '傳產:化學工業',
  '4743': '傳產:生技',
  '4744': '傳產:生技',
  '4745': '傳產:生技',
  '4746': '傳產:生技',
  '4747': '傳產:生技',
  '4749': '電子中游:LCD-TFT面板',
  '4754': '傳產:化學工業',
  '4755': '傳產:化學工業',
  '4760': '電子上游:被動元件',
  '4763': '傳產:化學工業',
  '4764': '傳產:化學工業',
  '4766': '傳產:化學工業',
  '4767': '傳產:化學工業',
  '4768': '傳產:化學工業',
  '4770': '電子上游:PCB-材料設備',
  '4771': '傳產:生技',
  '4772': '傳產:化學工業',
  '4804': '傳產:觀光',
  '4806': '傳產:文創娛樂',
  '4807': '傳產:百貨',
  '4903': '傳產:電線電纜',
  '4904': '電子下游:電信服務',
  '4905': '傳產:生技',
  '4906': '電子中游:網通',
  '4907': '傳產:營建',
  '4908': '電子中游:通訊設備',
  '4909': '電子上游:PCB-製造',
  '4911': '傳產:生技',
  '4912': '電子上游:連接元件',
  '4915': '電子下游:電腦周邊',
  '4916': '電子下游:工業電腦',
  '4919': '電子上游:IC-設計',
  '4923': '電子上游:被動元件',
  '4924': '傳產:綠能環保',
  '4927': '電子上游:PCB-製造',
  '4930': '電子下游:消費電子',
  '4931': '電子下游:其他',
  '4933': '電子中游:LCD-零組件',
  '4934': '電子下游:太陽能',
  '4935': '電子中游:LCD-零組件',
  '4938': '電子中游:EMS',
  '4939': '電子上游:PCB-製造',
  '4942': '電子中游:其他',
  '4943': '電子中游:聲學元件',
  '4946': '軟體:遊戲',
  '4949': '電子下游:太陽能',
  '4950': '傳產:鋼鐵',
  '4951': '電子上游:IC-設計',
  '4952': '電子上游:IC-設計',
  '4953': '軟體:系統整合',
  '4956': '電子上游:LED及光元件',
  '4958': '電子上游:PCB-製造',
  '4960': '電子中游:LCD-零組件',
  '4961': '電子上游:IC-設計',
  '4966': '電子上游:IC-設計',
  '4967': '電子上游:DRAM銷售',
  '4968': '電子上游:IC-設計',
  '4971': '電子上游:晶圓材料',
  '4972': '傳產:照明',
  '4973': '電子上游:IC-設計',
  '4974': '電子下游:掃描器',
  '4976': '電子下游:安全監控',
  '4977': '電子中游:網通',
  '4979': '電子中游:通訊設備',
  '4989': '電子上游:PCB-材料設備',
  '4991': '電子上游:IC-代工',
  '4994': '軟體:遊戲',
  '4995': '電子中游:LCD-TFT面板',
  '4999': '電子上游:連接元件',
  '5007': '傳產:鋼鐵',
  '5009': '傳產:鋼鐵',
  '5011': '傳產:鋼鐵',
  '5013': '傳產:鋼鐵',
  '5014': '傳產:鋼鐵',
  '5015': '傳產:鋼鐵',
  '5016': '傳產:鋼鐵',
  '5201': '軟體:系統整合',
  '5202': '軟體:其他',
  '5203': '軟體:系統整合',
  '5205': '傳產:其他',
  '5206': '傳產:營建',
  '5209': '軟體:系統整合',
  '5210': '軟體:系統整合',
  '5211': '軟體:其他',
  '5212': '軟體:系統整合',
  '5213': '傳產:營建',
  '5215': '電子中游:NB與手機零組件',
  '5220': '電子中游:LCD-STN面板',
  '5222': '電子上游:IC-代工',
  '5223': '電子中游:NB與手機零組件',
  '5225': '電子下游:消費電子',
  '5227': '電子中游:二次電池',
  '5228': '電子上游:被動元件',
  '5230': '電子上游:LED及光元件',
  '5234': '電子上游:PCB-材料設備',
  '5236': '電子上游:IC-設計',
  '5243': '電子中游:其他',
  '5244': '電子上游:LED及光元件',
  '5245': '電子中游:LCD-TFT面板',
  '5251': '電子下游:安全監控',
  '5258': '電子下游:商業自動化',
  '5263': '軟體:其他',
  '5269': '電子上游:IC-設計',
  '5272': '電子上游:IC-設計',
  '5274': '電子上游:IC-設計',
  '5276': '傳產:汽車零組件',
  '5278': '軟體:其他',
  '5283': '傳產:電機',
  '5284': '傳產:其他',
  '5285': '電子上游:IC-導線架',
  '5287': '軟體:其他',
  '5288': '傳產:汽車零組件',
  '5289': '電子上游:DRAM銷售',
  '5291': '電子上游:PCB-製造',
  '5292': '傳產:其他',
  '5299': '電子上游:IC-代工',
  '5301': '傳產:觀光',
  '5302': '電子上游:IC-設計',
  '5306': '傳產:自行車',
  '5309': '電子中游:變壓器與UPS',
  '5310': '軟體:系統整合',
  '5312': '傳產:生技',
  '5314': '傳產:其他',
  '5315': '電子中游:LCD-STN面板',
  '5321': '軟體:其他',
  '5324': '傳產:營建',
  '5328': '電子中游:電源供應器',
  '5340': '電子上游:PCB-材料設備',
  '5344': '電子上游:IC-封測',
  '5345': '電子中游:其他',
  '5347': '電子上游:IC-代工',
  '5348': '傳產:運動休閒',
  '5351': '電子上游:記憶體IC設計',
  '5353': '電子中游:網通',
  '5355': '電子上游:PCB-製造',
  '5356': '電子下游:電腦周邊',
  '5364': '傳產:觀光',
  '5371': '電子中游:LCD-零組件',
  '5381': '傳產:電機',
  '5386': '電子中游:主機板',
  '5388': '電子中游:網通',
  '5392': '電子中游:機殼',
  '5398': '傳產:生技',
  '5403': '軟體:系統整合',
  '5410': '電子下游:資訊通路',
  '5425': '電子下游:掃描器',
  '5426': '電子中游:機殼',
  '5432': '電子下游:太陽能',
  '5434': '電子上游:半導體元件',
  '5438': '電子下游:電腦周邊',
  '5439': '電子上游:PCB-製造',
  '5443': '電子上游:IC-半導體設備',
  '5450': '傳產:其他',
  '5452': '傳產:塑膠',
  '5455': '傳產:營建',
  '5457': '電子上游:連接元件',
  '5460': '電子上游:連接元件',
  '5464': '電子上游:PCB-製造',
  '5465': '電子中游:機殼',
  '5468': '電子上游:IC-設計',
  '5469': '電子上游:PCB-製造',
  '5471': '電子上游:IC-設計',
  '5474': '電子中游:PC介面卡',
  '5475': '電子上游:PCB-材料設備',
  '5478': '軟體:遊戲',
  '5481': '傳產:其他',
  '5483': '電子下游:太陽能',
  '5484': '電子下游:安全監控',
  '5487': '電子上游:IC-設計',
  '5488': '電子上游:連接元件',
  '5489': '電子下游:安全監控',
  '5490': '電子下游:商業自動化',
  '5493': '電子中游:儀器設備工程',
  '5498': '電子上游:PCB-材料設備',
  '5508': '傳產:營建',
  '5511': '傳產:營建',
  '5512': '傳產:營建',
  '5514': '傳產:營建',
  '5515': '傳產:營建',
  '5516': '傳產:營建',
  '5519': '傳產:營建',
  '5520': '傳產:營建',
  '5521': '傳產:營建',
  '5522': '傳產:營建',
  '5523': '傳產:營建',
  '5525': '傳產:營建',
  '5529': '傳產:營建',
  '5530': '傳產:其他',
  '5531': '傳產:營建',
  '5533': '傳產:營建',
  '5534': '傳產:營建',
  '5536': '電子中游:儀器設備工程',
  '5538': '傳產:鋼鐵',
  '5543': '傳產:鋼鐵',
  '5546': '傳產:營建',
  '5547': '傳產:營建',
  '5548': '傳產:營建',
  '5601': '傳產:航運',
  '5603': '傳產:航運',
  '5604': '傳產:其他',
  '5607': '傳產:航運',
  '5608': '傳產:航運',
  '5609': '傳產:航運',
  '5701': '傳產:觀光',
  '5703': '傳產:觀光',
  '5704': '傳產:觀光',
  '5706': '傳產:觀光',
  '5864': '金融:證券',
  '5871': '傳產:其他',
  '5876': '金融:銀行',
  '5878': '金融:保險',
  '5880': '金融:金控',
  '5902': '傳產:百貨',
  '5903': '傳產:百貨',
  '5904': '傳產:百貨',
  '5905': '傳產:觀光',
  '5906': '傳產:百貨',
  '5907': '傳產:百貨',
  '6005': '金融:證券',
  '6015': '金融:證券',
  '6016': '金融:證券',
  '6020': '金融:證券',
  '6021': '金融:證券',
  '6023': '金融:證券',
  '6024': '金融:證券',
  '6026': '金融:證券',
  '6028': '金融:保險',
  '6101': '傳產:文創娛樂',
  '6103': '電子上游:IC-設計',
  '6104': '電子上游:IC-設計',
  '6108': '電子上游:PCB-製造',
  '6109': '電子中游:電源供應器',
  '6111': '軟體:遊戲',
  '6112': '軟體:系統整合',
  '6113': '電子上游:IC-通路',
  '6114': '電子上游:PCB-製造',
  '6115': '電子上游:連接元件',
  '6116': '電子中游:LCD-TFT面板',
  '6117': '電子中游:機殼',
  '6118': '電子下游:資訊通路',
  '6120': '電子中游:LCD-零組件',
  '6121': '電子中游:二次電池',
  '6122': '電子中游:儀器設備工程',
  '6123': '軟體:系統整合',
  '6124': '電子中游:散熱零組件',
  '6125': '傳產:電機',
  '6126': '電子上游:連接元件',
  '6127': '電子上游:被動元件',
  '6128': '電子下游:電腦周邊',
  '6129': '電子上游:IC-設計',
  '6130': '傳產:生技',
  '6133': '電子上游:連接元件',
  '6134': '電子上游:連接元件',
  '6136': '電子下游:資訊通路',
  '6138': '電子上游:IC-設計',
  '6139': '電子中游:儀器設備工程',
  '6140': '軟體:系統整合',
  '6141': '電子上游:PCB-製造',
  '6142': '電子中游:網通',
  '6143': '電子下游:資訊通路',
  '6144': '電子下游:消費電子',
  '6146': '電子上游:IC-其他',
  '6147': '電子上游:IC-封測',
  '6148': '軟體:系統整合',
  '6150': '電子中游:PC介面卡',
  '6151': '傳產:塑膠',
  '6152': '電子中游:通訊設備',
  '6153': '電子上游:PCB-製造',
  '6154': '電子下游:資訊通路',
  '6155': '電子上游:被動元件',
  '6156': '電子上游:PCB-製造',
  '6158': '電子上游:連接元件',
  '6160': '電子下游:商業自動化',
  '6161': '電子下游:工業電腦',
  '6163': '軟體:系統整合',
  '6164': '電子上游:LED及光元件',
  '6165': '軟體:其他',
  '6166': '電子下游:工業電腦',
  '6167': '電子中游:LCD-STN面板',
  '6168': '電子上游:LED及光元件',
  '6169': '軟體:遊戲',
  '6170': '電子下游:資訊通路',
  '6171': '傳產:營建',
  '6173': '電子上游:被動元件',
  '6174': '電子上游:被動元件',
  '6175': '電子上游:被動元件',
  '6176': '電子中游:LCD-零組件',
  '6177': '傳產:營建',
  '6179': '傳產:其他',
  '6180': '軟體:遊戲',
  '6182': '電子上游:晶圓材料',
  '6183': '軟體:其他',
  '6184': '電子中游:通訊設備',
  '6185': '電子上游:連接元件',
  '6186': '傳產:營建',
  '6187': '電子上游:IC-半導體設備',
  '6188': '電子下游:電腦周邊',
  '6189': '電子上游:IC-通路',
  '6190': '傳產:電線電纜',
  '6191': '電子上游:PCB-製造',
  '6192': '電子上游:PCB-材料設備',
  '6194': '電子上游:PCB-製造',
  '6195': '傳產:百貨',
  '6196': '電子中游:儀器設備工程',
  '6197': '電子上游:連接元件',
  '6198': '傳產:營建',
  '6199': '傳產:其他',
  '6201': '電子下游:消費電子',
  '6202': '電子上游:IC-設計',
  '6203': '電子中游:電源供應器',
  '6204': '電子上游:被動元件',
  '6205': '電子上游:連接元件',
  '6206': '電子下游:商業自動化',
  '6207': '電子中游:儀器設備工程',
  '6208': '電子上游:半導體元件',
  '6209': '電子中游:光學鏡片',
  '6210': '電子上游:PCB-製造',
  '6212': '傳產:營建',
  '6213': '電子上游:PCB-材料設備',
  '6214': '軟體:系統整合',
  '6215': '電子中游:儀器設備工程',
  '6216': '電子中游:網通',
  '6217': '電子上游:PCB-材料設備',
  '6218': '軟體:系統整合',
  '6219': '傳產:營建',
  '6220': '電子上游:連接元件',
  '6221': '軟體:系統整合',
  '6222': '電子上游:LED及光元件',
  '6223': '電子上游:IC-封測',
  '6224': '電子上游:被動元件',
  '6225': '電子下游:數位相機',
  '6226': '電子上游:LED及光元件',
  '6227': '電子上游:IC-通路',
  '6228': '電子下游:掃描器',
  '6229': '電子上游:IC-設計',
  '6230': '電子中游:散熱零組件',
  '6231': '電子上游:IC-其他',
  '6233': '電子上游:IC-設計',
  '6234': '電子上游:PCB-材料設備',
  '6235': '電子中游:機殼',
  '6236': '軟體:系統整合',
  '6237': '電子上游:IC-設計',
  '6239': '電子上游:IC-封測',
  '6240': '軟體:系統整合',
  '6241': '電子中游:網通',
  '6242': '傳產:生技',
  '6243': '電子上游:IC-設計',
  '6244': '電子下游:太陽能',
  '6245': '電子中游:網通',
  '6246': '電子上游:LED及光元件',
  '6248': '傳產:鋼鐵',
  '6257': '電子上游:IC-封測',
  '6259': '電子上游:IC-通路',
  '6261': '電子上游:IC-封測',
  '6263': '電子中游:網通',
  '6264': '傳產:營建',
  '6265': '電子上游:IC-通路',
  '6266': '電子上游:PCB-材料設備',
  '6269': '電子上游:PCB-製造',
  '6270': '電子上游:IC-通路',
  '6271': '電子上游:IC-封測',
  '6272': '電子上游:連接元件',
  '6274': '電子上游:PCB-材料設備',
  '6275': '電子中游:散熱零組件',
  '6276': '電子中游:機殼',
  '6277': '電子下游:其他',
  '6278': '電子上游:PCB-製造',
  '6279': '傳產:汽車零組件',
  '6281': '電子下游:資訊通路',
  '6282': '電子中游:電源供應器',
  '6283': '電子中游:NB與手機零組件',
  '6284': '電子上游:被動元件',
  '6285': '電子中游:網通',
  '6290': '電子上游:連接元件',
  '6291': '電子上游:IC-設計',
  '6292': '電子上游:被動元件',
  '6294': '傳產:文創娛樂',
  '6405': '電子中游:LCD-零組件',
  '6409': '電子中游:變壓器與UPS',
  '6411': '電子上游:IC-設計',
  '6412': '電子中游:電源供應器',
  '6414': '電子下游:工業電腦',
  '6415': '電子上游:IC-設計',
  '6416': '電子中游:網通',
  '6417': '電子上游:被動元件',
  '6418': '電子上游:連接元件',
  '6419': '電子下游:安全監控',
  '6423': '電子上游:IP/ASIC',
  '6425': '電子上游:IC-其他',
  '6426': '電子中游:通訊設備',
  '6431': '電子中游:光學鏡片',
  '6432': '電子上游:被動元件',
  '6435': '電子上游:IC-設計',
  '6438': '電子中游:儀器設備工程',
  '6441': '電子下游:工業電腦',
  '6442': '電子中游:通訊設備',
  '6443': '電子下游:太陽能',
  '6446': '傳產:生技',
  '6449': '電子上游:被動元件',
  '6451': '電子上游:IC-封測',
  '6456': '電子中游:LCD-STN面板',
  '6461': '傳產:生技',
  '6462': '電子上游:IC-設計',
  '6464': '傳產:其他',
  '6465': '電子中游:通訊設備',
  '6469': '傳產:生技',
  '6470': '電子中游:網通',
  '6472': '傳產:生技',
  '6474': '電子上游:IC-通路',
  '6477': '電子下游:太陽能',
  '6482': '軟體:遊戲',
  '6485': '電子上游:IC-設計',
  '6486': '電子中游:網通',
  '6488': '電子上游:晶圓材料',
  '6491': '傳產:生技',
  '6492': '傳產:生技',
  '6494': '電子上游:IC-設計',
  '6496': '傳產:生技',
  '6498': '電子中游:光學鏡片',
  '6499': '傳產:生技',
  '6504': '傳產:生技',
  '6505': '傳產:塑膠',
  '6506': '傳產:紡織纖維',
  '6508': '傳產:生技',
  '6509': '傳產:化學工業',
  '6510': '電子上游:IC-封測',
  '6512': '電子下游:其他',
  '6515': '電子上游:IC-封測',
  '6516': '軟體:系統整合',
  '6517': '電子中游:光學鏡片',
  '6523': '傳產:生技',
  '6525': '電子上游:IC-封測',
  '6526': '電子上游:IC-設計',
  '6527': '傳產:生技',
  '6530': '電子中游:通訊設備',
  '6531': '電子上游:記憶體IC設計',
  '6532': '電子上游:IC-半導體設備',
  '6533': '電子上游:IP/ASIC',
  '6534': '傳產:生技',
  '6535': '傳產:生技',
  '6538': '電子中游:其他',
  '6541': '傳產:生技',
  '6542': '軟體:遊戲',
  '6546': '電子中游:網通',
  '6547': '傳產:生技',
  '6548': '電子上游:IC-導線架',
  '6550': '傳產:生技',
  '6552': '電子上游:IC-封測',
  '6556': '電子下游:安全監控',
  '6558': '電子中游:其他',
  '6560': '電子下游:安全監控',
  '6561': '電子中游:網通',
  '6568': '電子上游:IC-設計',
  '6569': '傳產:生技',
  '6570': '電子下游:工業電腦',
  '6573': '電子上游:IC-製造',
  '6574': '傳產:生技',
  '6576': '傳產:生技',
  '6577': '電子下游:顯示器',
  '6578': '傳產:其他',
  '6579': '電子下游:工業電腦',
  '6581': '傳產:綠能環保',
  '6582': '傳產:橡膠',
  '6584': '電子中游:金屬製品',
  '6585': '傳產:塑膠',
  '6588': '電子中游:通訊設備',
  '6589': '傳產:生技',
  '6590': '軟體:系統整合',
  '6591': '電子中游:散熱零組件',
  '6592': '傳產:其他',
  '6593': '軟體:系統整合',
  '6596': '傳產:文創娛樂',
  '6597': '電子上游:LED及光元件',
  '6598': '傳產:生技',
  '6603': '傳產:電機',
  '6605': '傳產:汽車零組件',
  '6606': '傳產:電機',
  '6609': '傳產:電機',
  '6612': '傳產:生技',
  '6613': '電子中游:儀器設備工程',
  '6614': '軟體:系統整合',
  '6615': '傳產:生技',
  '6616': '傳產:其他',
  '6617': '傳產:生技',
  '6620': '傳產:生技',
  '6624': '傳產:綠能環保',
  '6625': '傳產:文創娛樂',
  '6629': '傳產:其他',
  '6637': '傳產:生技',
  '6640': '電子上游:IC-半導體設備',
  '6641': '傳產:綠能環保',
  '6642': '電子上游:被動元件',
  '6643': '電子上游:IP/ASIC',
  '6645': '傳產:生技',
  '6649': '傳產:生技',
  '6651': '電子上游:IC-設計',
  '6654': '電子中游:儀器設備工程',
  '6655': '傳產:其他',
  '6657': '傳產:生技',
  '6658': '電子上游:PCB-材料設備',
  '6661': '傳產:生技',
  '6662': '傳產:生技',
  '6664': '電子上游:PCB-材料設備',
  '6666': '傳產:生技',
  '6667': '電子中游:儀器設備工程',
  '6668': '電子中游:光學鏡片',
  '6669': '電子中游:EMS',
  '6670': '傳產:高爾夫球',
  '6671': '傳產:其他',
  '6672': '電子上游:PCB-製造',
  '6674': '電子中游:網通',
  '6679': '電子上游:IC-設計',
  '6680': '電子下游:工業電腦',
  '6683': '電子上游:IC-半導體設備',
  '6684': '電子上游:IC-設計',
  '6689': '軟體:系統整合',
  '6690': '軟體:系統整合',
  '6691': '電子中游:儀器設備工程',
  '6692': '電子下游:太陽能',
  '6693': '電子上游:IC-設計',
  '6695': '電子上游:IC-設計',
  '6697': '軟體:系統整合',
  '6698': '傳產:其他',
  '6703': '傳產:生技',
  '6706': '電子上游:LED及光元件',
  '6708': '電子上游:IC-設計',
  '6712': '傳產:生技',
  '6715': '電子上游:連接元件',
  '6716': '電子上游:IC-設計',
  '6719': '電子上游:IC-設計',
  '6720': '電子上游:IC-設計',
  '6721': '傳產:其他',
  '6722': '電子下游:安全監控',
  '6725': '電子上游:IC-半導體設備',
  '6727': '電子上游:PCB-材料設備',
  '6728': '傳產:電機',
  '6730': '傳產:生技',
  '6732': '電子上游:IC-設計',
  '6733': '傳產:生技',
  '6735': '電子中游:儀器設備工程',
  '6739': '電子中游:其他',
  '6741': '軟體:其他',
  '6742': '電子中游:光學鏡片',
  '6743': '電子下游:消費電子',
  '6751': '軟體:系統整合',
  '6752': '軟體:系統整合',
  '6753': '傳產:航運',
  '6754': '傳產:其他',
  '6756': '電子上游:IC-設計',
  '6757': '傳產:航運',
  '6761': '電子中游:電子元件通路',
  '6762': '傳產:生技',
  '6763': '軟體:系統整合',
  '6767': '傳產:生技',
  '6768': '傳產:其他',
  '6770': '電子上游:IC-代工',
  '6771': '傳產:綠能環保',
  '6776': '電子下游:資訊通路',
  '6781': '電子中游:二次電池',
  '6782': '傳產:生技',
  '6785': '傳產:生技',
  '6788': '電子上游:IC-半導體設備',
  '6789': '電子上游:LED及光元件',
  '6790': '傳產:紙業',
  '6791': '軟體:系統整合',
  '6792': '電子上游:被動元件',
  '6794': '傳產:生技',
  '6796': '傳產:生技',
  '6799': '電子上游:IC-設計',
  '6803': '傳產:綠能環保',
  '6804': '傳產:自行車',
  '6805': '電子上游:連接元件',
  '6806': '電子下游:太陽能',
  '6807': '傳產:其他',
  '6811': '軟體:系統整合',
  '6821': '電子上游:被動元件',
  '6823': '電子上游:IC-半導體設備',
  '6829': '電子上游:半導體元件',
  '6830': '電子上游:IC-其他',
  '6831': '電子中游:散熱零組件',
  '6834': '電子上游:被動元件',
  '6835': '電子上游:PCB-材料設備',
  '6838': '傳產:生技',
  '6840': '電子中游:其他',
  '6841': '軟體:系統整合',
  '6843': '傳產:電機',
  '6844': '傳產:生技',
  '6846': '傳產:生技',
  '6854': '電子上游:LED及光元件',
  '6855': '電子下游:其他',
  '6856': '傳產:文創娛樂',
  '6859': '電子下游:手機製造',
  '6861': '傳產:生技',
  '6862': '電子中游:其他',
  '6863': '電子下游:掃描器',
  '6865': '軟體:其他',
  '6869': '電子下游:太陽能',
  '6870': '軟體:系統整合',
  '6872': '傳產:生技',
  '6873': '電子下游:太陽能',
  '6874': '軟體:系統整合',
  '6875': '傳產:生技',
  '6877': '電子中游:儀器設備工程',
  '6881': '傳產:其他',
  '6884': '電子下游:其他',
  '6885': '傳產:生技',
  '6887': '傳產:其他',
  '6890': '傳產:其他',
  '6894': '傳產:其他',
  '6895': '電子中游:其他',
  '6899': '電子上游:被動元件',
  '6901': '傳產:生技',
  '6902': '軟體:系統整合',
  '6903': '電子中游:儀器設備工程',
  '6904': '傳產:其他',
  '6906': '軟體:系統整合',
  '6907': '電子上游:IC-設計',
  '6908': '電子下游:電腦周邊',
  '6909': '電子上游:IC-半導體設備',
  '6910': '軟體:系統整合',
  '6913': '電子上游:連接元件',
  '6914': '傳產:其他',
  '6916': '電子中游:LCD-STN面板',
  '6918': '傳產:生技',
  '6919': '傳產:生技',
  '6921': '電子上游:IC-設計',
  '6922': '電子下游:工業電腦',
  '6923': '傳產:其他',
  '6924': '電子上游:PCB-製造',
  '6925': '軟體:系統整合',
  '6928': '電子下游:工業電腦',
  '6929': '傳產:生技',
  '6931': '傳產:生技',
  '6933': '電子中游:其他',
  '6934': '傳產:生技',
  '6936': '傳產:生技',
  '6937': '電子上游:IC-半導體設備',
  '6944': '傳產:綠能環保',
  '6949': '傳產:生技',
  '6951': '傳產:綠能環保',
  '6952': '傳產:食品',
  '6953': '電子上游:IC-半導體設備',
  '6955': '傳產:生技',
  '6957': '傳產:其他',
  '6958': '傳產:其他',
  '6961': '傳產:觀光',
  '6962': '電子上游:IC-設計',
  '6965': '傳產:其他',
  '6967': '電子中游:其他',
  '6968': '傳產:其他',
  '6969': '傳產:其他',
  '6971': '傳產:綠能環保',
  '6982': '傳產:電機',
  '6983': '電子中游:儀器設備工程',
  '6988': '傳產:汽車零組件',
  '6994': '傳產:其他',
  '6996': '電子中游:LCD-零組件',
  '6997': '軟體:其他',
  '7402': '電子中游:光學鏡片',
  '7547': '軟體:系統整合',
  '7556': '電子上游:IC-半導體設備',
  '7584': '軟體:遊戲',
  '7610': '傳產:鋼鐵',
  '7631': '電子中游:儀器設備工程',
  '7642': '傳產:電機',
  '7703': '電子中游:儀器設備工程',
  '7704': '電子中游:儀器設備工程',
  '7705': '傳產:觀光',
  '7708': '傳產:觀光',
  '7709': '傳產:電機',
  '7711': '電子中游:EMS',
  '7712': '電子上游:IC-製造',
  '7713': '傳產:生技',
  '7714': '軟體:其他',
  '7715': '傳產:其他',
  '7716': '傳產:航運',
  '7717': '電子上游:LED及光元件',
  '7718': '傳產:電機',
  '7721': '軟體:系統整合',
  '7722': '軟體:其他',
  '7723': '傳產:觀光',
  '7728': '電子上游:IC-其他',
  '7730': '電子中游:儀器設備工程',
  '7732': '傳產:汽車零組件',
  '7734': '電子上游:IC-其他',
  '7736': '傳產:汽車零組件',
  '7738': '軟體:其他',
  '7740': '傳產:綠能環保',
  '7743': '傳產:食品',
  '7744': '電子中游:EMS',
  '7747': '軟體:系統整合',
  '7749': '電子上游:IP/ASIC',
  '7750': '傳產:電機',
  '7751': '電子上游:IC-半導體設備',
  '7753': '電子下游:顯示器',
  '7757': '傳產:觀光',
  '7760': '傳產:觀光',
  '7765': '軟體:系統整合',
  '7767': '軟體:系統整合',
  '7768': '電子上游:晶圓材料',
  '7769': '電子上游:IC-半導體設備',
  '7770': '電子上游:IC-設計',
  '7772': '電子中游:光學鏡片',
  '7777': '傳產:其他',
  '7780': '傳產:生技',
  '7782': '傳產:百貨',
  '7786': '傳產:綠能環保',
  '7788': '傳產:電機',
  '7791': '傳產:食品',
  '7792': '電子中游:變壓器與UPS',
  '7794': '電子下游:消費電子',
  '7795': '電子上游:IC-半導體設備',
  '7799': '傳產:生技',
  '7803': '傳產:生技',
  '7805': '電子中游:磁碟陣列',
  '7810': '電子上游:IC-封測',
  '7811': '傳產:運動休閒',
  '7818': '傳產:其他',
  '7819': '軟體:系統整合',
  '7820': '傳產:綠能環保',
  '7821': '電子下游:工業電腦',
  '7822': '電子上游:IC-半導體設備',
  '7823': '軟體:系統整合',
  '7827': '傳產:生技',
  '7828': '電子中游:儀器設備工程',
  '7842': '傳產:綠能環保',
  '8011': '電子中游:網通',
  '8016': '電子上游:IC-設計',
  '8021': '電子上游:PCB-材料設備',
  '8024': '電子上游:IC-設計',
  '8027': '傳產:電機',
  '8028': '電子上游:IC-半導體設備',
  '8032': '電子上游:IC-通路',
  '8033': '電子下游:消費電子',
  '8034': '電子中游:通訊設備',
  '8038': '電子中游:二次電池',
  '8039': '電子上游:PCB-製造',
  '8040': '電子上游:IC-設計',
  '8042': '電子上游:被動元件',
  '8043': '電子上游:被動元件',
  '8044': '軟體:其他',
  '8045': '電子中游:通訊設備',
  '8046': '電子上游:ABF',
  '8047': '電子下游:其他',
  '8048': '電子中游:通訊設備',
  '8049': '電子中游:LCD-STN面板',
  '8050': '電子下游:工業電腦',
  '8054': '電子上游:IC-設計',
  '8059': '電子中游:通訊設備',
  '8064': '電子中游:儀器設備工程',
  '8066': '傳產:百貨',
  '8067': '電子下游:資訊通路',
  '8068': '電子上游:IC-通路',
  '8069': '電子中游:LCD-TFT面板',
  '8070': '電子上游:IC-導線架',
  '8071': '電子上游:連接元件',
  '8072': '電子下游:安全監控',
  '8074': '電子上游:PCB-材料設備',
  '8076': '電子下游:商業自動化',
  '8077': '傳產:觀光',
  '8080': '傳產:營建',
  '8081': '電子上游:IC-設計',
  '8083': '電子中游:其他',
  '8084': '電子上游:DRAM銷售',
  '8085': '電子中游:LCD-零組件',
  '8086': '電子上游:IC-代工',
  '8087': '電子下游:太陽能',
  '8088': '電子上游:DRAM銷售',
  '8089': '電子中游:通訊設備',
  '8091': '電子上游:IC-半導體設備',
  '8092': '電子中游:儀器設備工程',
  '8093': '電子中游:電源供應器',
  '8096': '電子上游:IC-通路',
  '8097': '電子中游:網通',
  '8099': '軟體:系統整合',
  '8101': '電子下游:手機製造',
  '8102': '電子上游:IC-設計',
  '8103': '電子上游:連接元件',
  '8104': '電子中游:LCD-TFT面板',
  '8105': '電子中游:LCD-STN面板',
  '8107': '傳產:汽車零組件',
  '8109': '電子中游:電源供應器',
  '8110': '電子上游:IC-封測',
  '8111': '電子上游:LED及光元件',
  '8112': '電子上游:IC-通路',
  '8114': '電子下游:商業自動化',
  '8121': '電子上游:被動元件',
  '8131': '電子上游:IC-封測',
  '8147': '電子上游:連接元件',
  '8150': '電子上游:IC-封測',
  '8155': '電子上游:PCB-製造',
  '8162': '電子上游:IC-封測',
  '8163': '電子中游:NB與手機零組件',
  '8171': '電子中游:電源供應器',
  '8176': '電子中游:網通',
  '8182': '電子上游:被動元件',
  '8183': '電子上游:PCB-製造',
  '8201': '電子下游:消費電子',
  '8210': '電子中游:機殼',
  '8213': '電子上游:PCB-製造',
  '8215': '電子中游:LCD-零組件',
  '8222': '傳產:其他',
  '8227': '電子上游:IP/ASIC',
  '8234': '電子下游:工業電腦',
  '8240': '電子中游:LCD-零組件',
  '8249': '電子下游:數位相機',
  '8255': '傳產:汽車零組件',
  '8261': '電子上游:IC-設計',
  '8271': '電子上游:DRAM銷售',
  '8272': '軟體:其他',
  '8277': '電子上游:DRAM銷售',
  '8279': '傳產:生技',
  '8284': '軟體:系統整合',
  '8289': '電子上游:被動元件',
  '8291': '電子上游:PCB-材料設備',
  '8299': '電子上游:記憶體IC設計',
  '8341': '傳產:綠能環保',
  '8342': '傳產:其他',
  '8349': '傳產:鋼鐵',
  '8354': '傳產:塑膠',
  '8358': '電子上游:PCB-材料設備',
  '8367': '傳產:航運',
  '8374': '傳產:電機',
  '8383': '電子中游:其他',
  '8390': '傳產:綠能環保',
  '8401': '傳產:其他',
  '8403': '傳產:生技',
  '8404': '傳產:紡織纖維',
  '8409': '傳產:生技',
  '8410': '電子中游:其他',
  '8411': '傳產:其他',
  '8415': '傳產:鋼鐵',
  '8416': '軟體:系統整合',
  '8421': '電子中游:儀器設備工程',
  '8422': '傳產:綠能環保',
  '8423': '傳產:橡膠',
  '8424': '傳產:營建',
  '8426': '傳產:其他',
  '8429': '傳產:百貨',
  '8431': '電子上游:連接元件',
  '8432': '傳產:生技',
  '8433': '傳產:百貨',
  '8435': '傳產:其他',
  '8436': '傳產:生技',
  '8437': '傳產:其他',
  '8438': '傳產:綠能環保',
  '8440': '傳產:綠能環保',
  '8442': '傳產:其他',
  '8443': '傳產:百貨',
  '8444': '傳產:其他',
  '8446': '傳產:文創娛樂',
  '8450': '傳產:文創娛樂',
  '8454': '傳產:百貨',
  '8455': '傳產:電機',
  '8462': '傳產:運動休閒',
  '8463': '傳產:水泥',
  '8464': '傳產:其他',
  '8466': '傳產:其他',
  '8467': '傳產:其他',
  '8472': '軟體:其他',
  '8473': '傳產:綠能環保',
  '8476': '傳產:綠能環保',
  '8477': '軟體:其他',
  '8478': '傳產:其他',
  '8481': '傳產:其他',
  '8482': '傳產:其他',
  '8487': '傳產:其他',
  '8488': '傳產:其他',
  '8489': '傳產:文創娛樂',
  '8499': '電子下游:其他',
  '8905': '傳產:食品',
  '8906': '傳產:其他',
  '8908': '傳產:其他',
  '8916': '傳產:紡織纖維',
  '8917': '傳產:其他',
  '8921': '傳產:其他',
  '8923': '傳產:文創娛樂',
  '8924': '傳產:高爾夫球',
  '8926': '傳產:其他',
  '8927': '傳產:其他',
  '8928': '傳產:高爾夫球',
  '8929': '傳產:其他',
  '8930': '傳產:鋼鐵',
  '8931': '傳產:其他',
  '8932': '軟體:系統整合',
  '8933': '傳產:自行車',
  '8935': '傳產:塑膠',
  '8936': '傳產:水泥',
  '8937': '傳產:汽車',
  '8938': '傳產:高爾夫球',
  '8940': '傳產:觀光',
  '8941': '傳產:其他',
  '8942': '傳產:塑膠',
  '8996': '傳產:電機',
  '9103': '傳產:其他',
  '910322': '傳產:食品',
  '9105': '電子下游:掃描器',
  '910861': '電子下游:資訊通路',
  '9110': '傳產:汽車零組件',
  '911608': '傳產:其他',
  '911622': '傳產:鋼鐵',
  '911868': '電子上游:LED及光元件',
  '912000': '電子中游:網通',
  '9136': '電子中游:機殼',
  '9802': '傳產:其他',
  '9902': '傳產:其他',
  '9904': '傳產:其他',
  '9905': '傳產:其他',
  '9906': '傳產:營建',
  '9907': '傳產:鋼鐵',
  '9908': '傳產:其他',
  '9910': '傳產:其他',
  '9911': '傳產:其他',
  '9912': '電子下游:顯示器',
  '9914': '傳產:自行車',
  '9917': '電子下游:安全監控',
  '9918': '傳產:其他',
  '9919': '傳產:其他',
  '9921': '傳產:自行車',
  '9924': '傳產:其他',
  '9925': '電子下游:安全監控',
  '9926': '傳產:其他',
  '9927': '傳產:鋼鐵',
  '9928': '傳產:其他',
  '9929': '傳產:其他',
  '9930': '傳產:其他',
  '9931': '傳產:其他',
  '9933': '傳產:其他',
  '9934': '傳產:其他',
  '9935': '傳產:其他',
  '9937': '傳產:其他',
  '9938': '傳產:紡織纖維',
  '9939': '傳產:塑膠',
  '9940': '傳產:其他',
  '9941': '傳產:其他',
  '9942': '傳產:汽車零組件',
  '9943': '傳產:觀光',
  '9944': '傳產:其他',
  '9945': '傳產:營建',
  '9946': '傳產:營建',
  '9949': '傳產:其他',
  '9950': '傳產:塑膠',
  '9951': '傳產:汽車零組件',
  '9955': '傳產:綠能環保',
  '9958': '傳產:鋼鐵',
  '9960': '傳產:高爾夫球',
  '9962': '傳產:鋼鐵'
};

// 智慧取得股票所屬的 [大產業] 與 [細分族群]
function getStockSector(s) {
  if (SECTOR_COMPENSATION[s.id]) {
    return SECTOR_COMPENSATION[s.id];
  }
  
  // 透過 OpenAPI 基本資料與名稱特徵動態精準對齊 CMoney 類股，第一層總分類限制為 6 大類
  let a = '傳產'; // 預設總分類為 傳產
  let b = '其他傳產'; // 預設細細分類
  
  const ind = s.industry || '';
  const name = s.name || '';
  const idStr = s.id ? String(s.id) : '';

  if (ind.includes('半導體') || idStr === '2330' || idStr === '2303' || idStr === '3711') {
    // 半導體分類
    if (name.includes('設計') || idStr === '2454' || idStr === '3034' || idStr === '2379' || idStr === '3661' || idStr === '3443' || idStr === '6531') {
      a = '電子上游'; b = 'IC設計';
    } else if (name.includes('封') || name.includes('測') || idStr === '3711' || idStr === '2449' || idStr === '3264') {
      a = '電子上游'; b = 'IC封測';
    } else if (name.includes('晶圓') || idStr === '2330' || idStr === '2303' || idStr === '6770' || idStr === '6182' || idStr === '6488') {
      a = '電子上游'; b = '半導體代工';
    } else {
      a = '電子上游'; b = '半導體其他';
    }
  } else if (ind.includes('電腦') || ind.includes('週邊') || idStr === '2317' || idStr === '2382' || idStr === '3231') {
    if (name.includes('奇鋐') || name.includes('雙鴻') || name.includes('散熱') || idStr === '3017' || idStr === '3324') {
      a = '電子中游'; b = '散熱零組件';
    } else if (name.includes('廣達') || name.includes('緯創') || name.includes('英業達') || name.includes('神達') || name.includes('和碩') || name.includes('鴻海') || idStr === '2317' || idStr === '2382' || idStr === '3231' || idStr === '6669') {
      a = '電子下游'; b = 'AI伺服器/組裝';
    } else {
      a = '電子下游'; b = '電腦週邊';
    }
  } else if (ind.includes('金融') || ind.includes('保險') || idStr.startsWith('28') || idStr.startsWith('58')) {
    a = '金融';
    if (name.includes('金控') || idStr === '2881' || idStr === '2882' || idStr === '2891' || idStr === '2886' || idStr === '2884') {
      b = '金控';
    } else if (name.includes('銀行')) {
      b = '銀行';
    } else if (name.includes('證')) {
      b = '證券';
    } else {
      b = '保險/其他金融';
    }
  } else if (ind.includes('航運') || idStr === '2603' || idStr === '2609' || idStr === '2618') {
    a = '傳產';
    if (name.includes('航') || name.includes('飛') || idStr === '2618' || idStr === '2610') {
      b = '航空客貨運';
    } else if (name.includes('長榮') || name.includes('陽明') || name.includes('萬海') || idStr === '2603' || idStr === '2609' || idStr === '2615') {
      b = '貨櫃航運';
    } else {
      b = '航運';
    }
  } else if (ind.includes('生技') || ind.includes('醫療') || ind.includes('藥')) {
    a = '傳產'; // 生技歸類在傳產
    b = '生技醫療';
  } else if (ind.includes('光電') || name.includes('光') || idStr === '2409' || idStr === '3481') {
    if (name.includes('鏡頭') || idStr === '3008' || idStr === '3406') {
      a = '電子中游'; b = '光學鏡頭';
    } else if (name.includes('面板') || name.includes('友達') || name.includes('群創') || idStr === '2409' || idStr === '3481') {
      a = '電子中游'; b = '面板';
    } else {
      a = '電子中游'; b = '光電其他';
    }
  } else if (ind.includes('零組件') || ind.includes('通信') || ind.includes('網通') || ind.includes('電子零件') || ind.includes('資訊服務')) {
    if (ind.includes('資訊服務') || name.includes('遊戲') || name.includes('軟體')) {
      a = '軟體'; b = '軟體服務/遊戲';
    } else if (name.includes('國巨') || name.includes('華新科') || idStr === '2327' || idStr === '2492') {
      a = '電子上游'; b = '被動元件MLCC';
    } else if (name.includes('欣興') || name.includes('南電') || name.includes('景碩') || idStr === '3037' || idStr === '3189' || idStr === '8046') {
      a = '電子中游'; b = 'IC載板';
    } else if (ind.includes('通信') || ind.includes('網通')) {
      a = '電子中游'; b = '網通設備';
    } else {
      a = '電子中游'; b = '電子零組件';
    }
  } else if (ind.includes('水泥')) {
    a = '傳產'; b = '水泥';
  } else if (ind.includes('食品')) {
    a = '傳產'; b = '食品';
  } else if (ind.includes('塑膠')) {
    a = '傳產'; b = '塑膠';
  } else if (ind.includes('紡織')) {
    a = '傳產'; b = '紡織纖維';
  } else if (ind.includes('電機') || ind.includes('機械')) {
    a = '傳產'; b = '電機';
  } else if (ind.includes('電線') || ind.includes('電纜')) {
    a = '傳產'; b = '電線電纜';
  } else if (ind.includes('化學') || ind.includes('化工')) {
    a = '傳產'; b = '化學工業';
  } else if (ind.includes('營建') || ind.includes('建材')) {
    a = '傳產'; b = '營建';
  } else if (ind.includes('鋼鐵')) {
    a = '傳產'; b = '鋼鐵';
  } else if (ind.includes('橡膠')) {
    a = '傳產'; b = '橡膠';
  } else if (ind.includes('汽車')) {
    a = '傳產'; b = '汽車零組件';
  } else if (ind.includes('觀光') || ind.includes('餐旅')) {
    a = '傳產'; b = '觀光餐旅';
  } else if (ind.includes('百貨') || ind.includes('貿易')) {
    a = '傳產'; b = '百貨貿易';
  } else {
    if (ind) {
      b = ind.replace('業', '');
    }
  }

  return `${a}:${b}`;
}

// 核心產業與細分族群之詳細描述資料庫 (三層結構簡介)
const SECTOR_DESCRIPTIONS = {
  '半導體:AI/CoWoS先進封裝': '【半導體 ➔ 先進封裝】包含台積電先進封裝等，負責將運算核心與高頻寬記憶體三維度立體整合，是生成式 AI 高效能運算晶片的終極出海口。',
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
  '傳統產業:一般傳統': '【傳統產業 ➔ 一般傳產】涵蓋航運、金融、鋼鐵等傳統經濟循環板塊，主要受全球利率與航運報價波動影響，主要在於全球物流通路與基礎大宗物資。',
  
  // CMoney 追加分類描述
  '航運業:貨櫃航運': '【航運業 ➔ 貨櫃航運】負責全球大宗商品與消費品跨海貨櫃物流。以貨櫃三雄（長榮、陽明、萬海）為代表，受SCFI運價指數、巴拿馬運河與紅海地緣政治危機等供給側變動影響極深。',
  '航運業:航空客貨運': '【航運業 ➔ 航空客貨運】涵蓋客運出國與高價值電子產品（如高階晶片）空運。以長榮航、華航為首，受全球觀光復甦與油價成本波動影響。',
  '金融保險:金控業': '【金融保險 ➔ 金控業】台灣特有的超大型金融版圖。旗下涵蓋壽險、銀行與證券，如富邦金、國泰金、中信金，獲利與美台債券殖利率、全球股市表現與利差息差高度連動。',
  '電腦週邊:品牌PC與伺服器': '【電腦週邊 ➔ 品牌PC與伺服器】從傳統個人電腦轉型為具備邊緣運算能力的 AI PC、AI 筆電與自主品牌伺服器出口（如華碩、宏碁）。',
  '電子零件:被動元件MLCC': '【電子零件 ➔ 被動元件MLCC】被譽為「電子工業黃金」的電容、電阻與電感。以國巨、華新科為龍頭，廣泛應用於車用電子、AI伺服器與消費電子，具備景氣循環特徵。',
  '光電學:光學鏡頭': '【光電學 ➔ 光學鏡頭】手機多鏡頭高階光學元件與車用 ADAS 鏡頭。大立光、玉晶光為全球蘋果供應鏈中最核心的高毛利技術霸主。'
};

// 1. 繪製資金族群熱力圖 (TreeMap)
function renderSectorFlowMap() {
  const container = document.getElementById('sectorTreeMap');
  if (!container) return;
  container.innerHTML = '';

  // 對 mockStocks 進行產業分組
  const sectorGroups = {};
  mockStocks.forEach(s => {
    const fullSector = getStockSector(s);
    const sector = fullSector.split(':')[1] || fullSector; // 直接使用細分類作為分組主鍵，例如 水泥、食品、塑膠
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

  // 計算每個族群的平均值 (動態支援盤中 liveChange 即時大數據運算)
  const sectorsArray = Object.values(sectorGroups);
  sectorsArray.forEach(g => {
    const sumChange = g.stocks.reduce((sum, s) => {
      if (s.liveChange !== undefined) return sum + s.liveChange;
      // 若 liveChange 尚未被 runScreener 初始化，動態計算
      const live = getLiveStockData(s);
      return sum + (live.change || 0);
    }, 0);
    g.avgChange = g.stocks.length > 0 ? (sumChange / g.stocks.length) : 0;
  });

  // 統計所有族群的「漲跌幅平移權重」（平移 +10% 確保全為正數）
  // 漲停 +10% -> 權重 20；跌停 -10% -> 權重 0.1；以實現「漲越多區塊越大，跌的越小」
  sectorsArray.forEach(g => {
    g.weight = Math.max(0.1, g.avgChange + 10);
  });

  // 排序：依據平均漲跌幅 (avgChange) 降序排列 (漲最多的排最前面)
  sectorsArray.sort((a, b) => b.avgChange - a.avgChange);

  // 動態分配 CSS Grid 的 span 寬度 (總共 12 欄格柵)
  const totalWeight = sectorsArray.reduce((sum, s) => sum + s.weight, 0);
  
  sectorsArray.forEach((g, idx) => {
    const ratio = totalWeight > 0 ? (g.weight / totalWeight) : (1 / sectorsArray.length);
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
    
    // 主力飆股顯示 (使用展開運算子保護原始 stocks 數組，防止 in-place sort 污染原資料結構導致點擊彈窗個股順序錯亂)
    const leadStock = [...g.stocks].sort((a,b) => (b.volRatio||0) - (a.volRatio||0))[0];
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
          <span style="font-weight: 700;" class="${(s.liveChange !== undefined ? s.liveChange : s.change) >= 0 ? 'text-up' : 'text-down'}">${s.livePrice || s.price} (${(s.liveChange !== undefined ? s.liveChange : s.change) >= 0 ? '+' : ''}${(s.liveChange !== undefined ? s.liveChange : s.change)}%)</span>
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

  // 預先對 mockStocks 進行產業分組，提供族群強弱排行使用 (直接以細分類分組)
  const sectorGroups = {};
  mockStocks.forEach(s => {
    const sectorStr = getStockSector(s);
    const sector = sectorStr.split(':')[1] || sectorStr; // 直接使用細分類作為分組主鍵，例如 水泥、食品、IC設計
    if (!sectorGroups[sector]) {
      sectorGroups[sector] = { name: sector, stocks: [], avgChange: 0, totalVol: 0 };
    }
    sectorGroups[sector].stocks.push(s);
    sectorGroups[sector].totalVol += (s.dailyVol || 0) * 1000 * (s.price || 0); // 估算成交金額（張×1000股×元）
  });
  
  const sectorsArray = Object.values(sectorGroups);
  sectorsArray.forEach(g => {
    const sumChange = g.stocks.reduce((sum, s) => {
      // 優先使用已計算的 liveChange，再 fallback 到靜態 change
      if (s.liveChange !== undefined) return sum + s.liveChange;
      // 若 liveChange 尚未初始化（runScreener 未執行過），動態計算
      const live = getLiveStockData(s);
      return sum + (live.change || 0);
    }, 0);
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
      const displayTitle = g.name; // 直接顯示細細分類，如 水泥、食品、IC設計
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
      const displayTitle = g.name; // 直接顯示細細分類
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
        <div style="margin-top:10px; display:flex; justify-content:space-between; align-items:center; gap:8px;">
          <button class="btn-secondary" style="font-size:12px;padding:4px 8px; flex:1;" onclick="openChart('${s.id}')">策略回測 →</button>
          <button class="btn-primary" style="font-size:12px;padding:4px 8px; flex:1; background:${isStockInPortfolio(s.id)?'#10b981':'var(--warning)'}; font-weight:bold;" onclick="event.stopPropagation(); toggleStockPortfolio('${s.id}')">
            ${isStockInPortfolio(s.id) ? '★ 已自選' : '☆ 自選'}
          </button>
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
  if (currentWhitelist.length === 0) { alert('基本面推薦清單為空，請先執行篩選'); return; }
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
  a.download = `荳荳基本面推薦清單_${ts}.csv`;
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
      <h2 style="margin-bottom:4px;">推薦清單 0 檔</h2>
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

// ======================== ⭐ 自選清單管理與卡片繪製邏輯 ========================

// 初始化自選清單 (從 localStorage 讀取以永久保存)
let userPortfolio = JSON.parse(localStorage.getItem('trading_ai_portfolio')) || ['2330', '2317', '2382']; // 預設提供熱門股範例以防空白

// 判斷股票是否已加入自選
window.isStockInPortfolio = function(symbolId) {
  return userPortfolio.includes(symbolId);
};

// 切換自選狀態 (增 / 刪)
window.toggleStockPortfolio = function(symbolId) {
  const idx = userPortfolio.indexOf(symbolId);
  if (idx > -1) {
    userPortfolio.splice(idx, 1);
  } else {
    userPortfolio.push(symbolId);
  }
  localStorage.setItem('trading_ai_portfolio', JSON.stringify(userPortfolio));
  
  // 即時更新各視圖的自選按鈕狀態
  if (typeof currentResults !== 'undefined') renderScreenerTable(currentResults);
  renderPortfolioGrid();
  renderWhitelistGrid(); // 連動重繪推薦清單的自選按鈕狀態
  updateChartPortfolioButton();
};

// 自選清單：手動輸入代碼或名稱加入自選
window.addStockToPortfolioFromInput = function() {
  const input = document.getElementById('portfolioSearchInput');
  if (!input) return;
  const val = input.value.trim().toLowerCase();
  if (!val) {
    alert('請先輸入股票代碼或名稱喔！🐾');
    return;
  }

  // 在 mockStocks 全域資料庫中尋找匹配的股票 (精確代碼或部分名稱)
  const stock = mockStocks.find(s => s.id === val || s.name.toLowerCase() === val || s.name.toLowerCase().includes(val));
  
  if (!stock) {
    alert(`找不到代碼或名稱為「${val}」的股票汪...🐶`);
    return;
  }

  if (isStockInPortfolio(stock.id)) {
    alert(`【${stock.id} ${stock.name}】已經在您的自選清單裡囉！🐾`);
    input.value = '';
    return;
  }

  // 加入自選並同步重繪
  toggleStockPortfolio(stock.id);
  alert(`🎉 成功將【${stock.id} ${stock.name}】加入自選清單汪！🐾`);
  input.value = '';
};

// 針對 K 線圖當前標的進行自選切換
window.toggleCurrentStockPortfolio = function() {
  if (typeof currentChartSymbol !== 'undefined' && currentChartSymbol) {
    toggleStockPortfolio(currentChartSymbol);
  } else {
    alert('請先在圖表載入股票喔！🐾');
  }
};

// 動態更新 K 線圖「自選此股」按鈕之文字樣式
function updateChartPortfolioButton() {
  const btn = document.getElementById('btn-chart-add-portfolio');
  if (!btn || typeof currentChartSymbol === 'undefined' || !currentChartSymbol) return;

  if (isStockInPortfolio(currentChartSymbol)) {
    btn.innerHTML = '<span>★ 已在自選</span>';
    btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
    btn.style.boxShadow = '0 0 10px rgba(16,185,129,0.35)';
  } else {
    btn.innerHTML = '<span>☆ 自選此股</span>';
    btn.style.background = 'linear-gradient(135deg, #f59e0b, #eab308)';
    btn.style.boxShadow = '0 0 10px rgba(245,158,11,0.35)';
  }
}

// 監聽原載入 K 線方法 loadTVChart，在載入時同步刷新自選按鈕狀態
const originalLoadTVChart = window.loadTVChart;
window.loadTVChart = function(s) {
  if (typeof originalLoadTVChart === 'function') {
    originalLoadTVChart(s);
  }
  updateChartPortfolioButton();
};

// 繪製自選清單卡片格 ( portfolio-grid )
window.renderPortfolioGrid = function() {
  const grid = document.getElementById('portfolioGrid');
  if (!grid) return;

  if (userPortfolio.length === 0) {
    grid.innerHTML = `
      <div class="empty-row" style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted); background: rgba(30,41,59,0.3); border-radius: 12px; border: 1px dashed rgba(255,255,255,0.1);">
        <div style="font-size: 48px; margin-bottom: 12px;">⭐</div>
        <p style="font-size: 15px; font-weight: 600; color: white;">目前自選清單空空如也汪！</p>
        <p style="font-size: 12px; margin-top: 6px;">請前往【篩選器結果】或【K線回測功能】將優質飆股加入自選追蹤唷！🐶</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = '';

  userPortfolio.forEach((symbolId, index) => {
    const s = mockStocks.find(item => item.id === symbolId);
    if (!s) return;

    // 計算連續日數 (D) 籌碼累計數據
    // 因為靜態模擬庫數據限制，我們根據個股籌碼基準，動態微調生成高擬真 5D、3D、20D 籌碼累計，並與 data.js 保持一致
    const fNet = s.foreignNetBuy || 0;
    const tDays = s.trustDays || 0;

    // 外資 5D 籌碼累計量
    const f5D = fNet * 5 + (s.id.charCodeAt(0) % 7 - 3) * 1500;
    // 投信 5D 籌碼累計量
    const t5D = tDays > 0 ? (tDays * 5 + 4) * 850 : -3500;
    // 自營 5D 籌碼累計量
    const d5D = (s.dealerDays || 0) * 5 + (s.id.charCodeAt(1) % 5 - 2) * 450;
    // 法人 5D 籌碼累計 (外資+投信+自營)
    const inst5D = f5D + t5D + d5D;
    // 投信 3D 籌碼累計量
    const t3D = tDays > 0 ? (tDays * 3 + 2) * 910 : -2100;
    // 前 20D 籌碼累計量
    const total20D = inst5D * 4 + (s.id.charCodeAt(2) % 9 - 4) * 3500;

    // 計算成交金額：現價 * 成交量 (台股通常 1張 = 1000股)
    const dailyVol = s.dailyVol || 8500;
    const volMoneyInBillion = ((s.price * dailyVol * 1000) / 100000000).toFixed(1);

    // 格式化數字
    function fmtVal(v, suffix = '張') {
      const sign = v >= 0 ? '+' : '';
      const color = v >= 0 ? 'var(--up-color)' : 'var(--down-color)';
      return `<strong style="color:${color}; font-size:16px;">${sign}${v.toLocaleString()}</strong> <span style="font-size:11px; color:var(--text-muted);">${suffix}</span>`;
    }

    // 取得產業細分
    const sectorStr = getStockSector(s);
    const mainSector = sectorStr.split(':')[0];
    const subSector = sectorStr.split(':')[1] || sectorStr;

    // 卡片卡號 (01, 02...)
    const cardNum = String(index + 1).padStart(2, '0');

    grid.innerHTML += `
      <div class="portfolio-card" style="background: rgba(30, 41, 59, 0.45); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 16px; box-shadow: 0 4px 15px rgba(0,0,0,0.15); display: flex; flex-direction: column; gap: 12px; border-left: 4px solid var(--primary); transition: all 0.2s;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
        
        <!-- 卡片頭部：股號、股名、產業 -->
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="background:var(--primary); color:white; font-size:11px; font-weight:700; padding:2px 6px; border-radius:4px;">${cardNum}</div>
            <div>
              <span style="font-size:18px; font-weight:800; color:white;">${s.id} ${s.name}</span>
              <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">上市 • ${mainSector} ➔ ${subSector}</div>
            </div>
          </div>
          <button class="shiba-chat-close" style="padding: 2px;" onclick="event.stopPropagation(); toggleStockPortfolio('${s.id}')" title="移出自選">✕</button>
        </div>

        <!-- 價格與漲幅 -->
        <div style="display:flex; align-items:baseline; gap:8px; border-bottom: 1px dashed rgba(255,255,255,0.08); padding-bottom: 8px;">
          <strong style="font-size:28px; font-weight:900; color:white; font-family:'Inter';">${s.price}</strong>
          <span class="${s.change >= 0 ? 'text-up' : 'text-down'}" style="font-size:13px; font-weight:800;">
            ${s.change >= 0 ? '+' : ''}${s.change}%
          </span>
          <span style="font-size:12px; color:var(--text-muted);">
            ↑ ${(s.price * (s.change / 100)).toFixed(2)} / 5D +${(s.change * 1.8).toFixed(2)}%
          </span>
          ${s.change >= 9.8 ? `<span class="badge danger" style="font-size:10px; padding:1px 4px; margin-left:auto;">漲停板</span>` : ''}
        </div>

        <!-- 買賣盤籌碼表格 (連續日數 D) -->
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 1px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; overflow:hidden;">
          <div style="background:var(--bg-panel); padding: 8px 12px;">
            <div style="font-size:11px; color:var(--text-muted); margin-bottom:2px;">外資 5D</div>
            <div>${fmtVal(f5D)}</div>
          </div>
          <div style="background:var(--bg-panel); padding: 8px 12px;">
            <div style="font-size:11px; color:var(--text-muted); margin-bottom:2px;">投信 5D</div>
            <div>${fmtVal(t5D)}</div>
          </div>
          <div style="background:var(--bg-panel); padding: 8px 12px;">
            <div style="font-size:11px; color:var(--text-muted); margin-bottom:2px;">自營 5D</div>
            <div>${fmtVal(d5D)}</div>
          </div>
          <div style="background:var(--bg-panel); padding: 8px 12px;">
            <div style="font-size:11px; color:var(--text-muted); margin-bottom:2px;">法人 5D</div>
            <div>${fmtVal(inst5D)}</div>
          </div>
          <div style="background:var(--bg-panel); padding: 8px 12px;">
            <div style="font-size:11px; color:var(--text-muted); margin-bottom:2px;">投信 3D</div>
            <div>${fmtVal(t3D)}</div>
          </div>
          <div style="background:var(--bg-panel); padding: 8px 12px;">
            <div style="font-size:11px; color:var(--text-muted); margin-bottom:2px;">前 20D</div>
            <div>${fmtVal(total20D)}</div>
          </div>
        </div>

        <!-- 卡片底部：成交張數與成交金額 -->
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; color:var(--text-muted); margin-top:2px;">
          <div>成交 <strong>${dailyVol.toLocaleString()}</strong> 張 / <strong>${volMoneyInBillion}</strong> 億</div>
          <div style="color:var(--primary); font-weight:700;">5 / 5 天買盤 🐾</div>
        </div>

        <!-- 卡片動作按鈕 -->
        <div style="display:flex; gap:8px; margin-top:4px;">
          <button class="btn-primary" style="flex:1; font-size:11px; height:26px; padding:0; display:flex; align-items:center; justify-content:center; gap:4px; font-weight:700;" onclick="closeModal(); openChart('${s.id}')">
            📈 進入K線策略回測 →
          </button>
        </div>
      </div>
    `;
  });
};

