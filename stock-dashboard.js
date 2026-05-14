// =============================================
// TradingView Widget + 個股戰情板邏輯
// =============================================
let currentChartSymbol = null;
let currentLWChart = null;
let currentLWDashChart = null;

// ---- Lightweight Charts 渲染函式 ----
function renderLWChart(containerId, klineData, height = 260) {
  const container = document.getElementById(containerId);
  if (!container) return null;
  container.innerHTML = '';
  // 確保容器有明確高度，autoSize 才能生效
  container.style.height = height + 'px';
  container.style.position = 'relative';

  const chart = LightweightCharts.createChart(container, {
    autoSize: true,   // 自動填滿容器，解決 clientWidth=0 的問題
    height: height,
    layout: {
      background: { type: 'solid', color: '#0f172a' },
      textColor: '#94a3b8',
    },
    grid: {
      vertLines: { color: 'rgba(71, 85, 105, 0.08)' },
      horzLines: { color: 'rgba(71, 85, 105, 0.08)' },
    },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: 'rgba(71, 85, 105, 0.3)', autoScale: true },
    timeScale: { borderColor: 'rgba(71, 85, 105, 0.3)', timeVisible: true, secondsVisible: false },
  });

  const candleSeries = chart.addCandlestickSeries({
    upColor: '#ef4444',
    downColor: '#22c55e',
    borderDownColor: '#22c55e',
    borderUpColor: '#ef4444',
    wickDownColor: '#22c55e',
    wickUpColor: '#ef4444',
  });

  // 成交量面板（獨立 price scale）
  const volumeSeries = chart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
    scaleMargins: { top: 0.85, bottom: 0 },
  });
  chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

  const formattedCandles = klineData.map(d => ({
    time: d.date,
    open: parseFloat(d.open),
    high: parseFloat(d.high),
    low: parseFloat(d.low),
    close: parseFloat(d.close),
  }));

  const formattedVolume = klineData.map(d => ({
    time: d.date,
    value: parseFloat(d.volume),
    color: parseFloat(d.close) >= parseFloat(d.open) ? 'rgba(239,68,68,0.45)' : 'rgba(34,197,94,0.45)',
  }));

  candleSeries.setData(formattedCandles);
  volumeSeries.setData(formattedVolume);
  chart.timeScale().fitContent();

  console.log(`[LWC] ${containerId}: ${klineData.length} candles rendered`);
  return chart;
}

// ---- 內嵌儀表板渲染（供主儀表板呼叫）----
function renderStockDashInline(stock, targetEl) {
  const s = stock;
  console.log(`[DEBUG] Rendering inline dash for ${s.id}, market: ${s.market}`);
  const now = new Date();

  // 模擬數據
  const foreignNet = Math.round(Math.random() * 5000 - 1000);
  const trustNet   = Math.round(Math.random() * 500 - 100);
  const dealerNet  = Math.round(Math.random() * 200 - 50);
  const high  = +(s.price * (1 + Math.random() * 0.05)).toFixed(2);
  const low   = +(s.price * (1 - Math.random() * 0.05)).toFixed(2);
  const vol   = s.dailyVol;
  const prob  = Math.min(95, Math.max(20, Math.round(s.score / 11 * 80 + Math.random() * 20)));
  const stopLoss = (s.price * 0.92).toFixed(2);
  const target   = (s.price * 1.10).toFixed(2);
  const signal   = prob >= 65 ? { label: '可布局', color: 'var(--success)' }
                 : prob >= 45 ? { label: '觀察中', color: 'var(--warning)' }
                 : { label: '暫觀望', color: 'var(--danger)' };

  targetEl.innerHTML = `
    <div class="inline-dash">
      <!-- 頂列 -->
      <div class="sd-topbar" style="border-radius:8px;margin-bottom:12px;">
        <div><div class="sd-symbol" style="font-size:16px">${s.id} ${s.name} 個股戰情</div></div>
        <div style="text-align:right">
          <div class="sd-price ${parseFloat(s.change)>=0?'text-up':'text-down'}" style="font-size:22px">${s.price}</div>
          <div style="font-size:13px;color:${parseFloat(s.change)>=0?'var(--up-color)':'var(--down-color)'}">${parseFloat(s.change)>0?'▲':'▼'} ${Math.abs(s.change)}%</div>
        </div>
      </div>

      <!-- 圖表 + 指標列 -->
      <div class="inline-tv-wrap">
        <div id="inlineTVChart_${s.id}" style="width:100%;height:260px;"></div>
      </div>

      <!-- 指標列 -->
      <div class="sd-indicators" style="margin-top:12px;">
        <div class="sd-ind-card">
          <div class="ind-label">AI 上漲機率</div>
          <div class="ind-main" style="color:${prob>=60?'var(--success)':prob>=40?'var(--warning)':'var(--danger)'}">${prob}%</div>
          <div class="ind-tip">${signal.label}</div>
        </div>
        <div class="sd-ind-card">
          <div class="ind-label">三大法人合計</div>
          <div class="ind-main ${(foreignNet+trustNet+dealerNet)>=0?'text-up':'text-down'}" style="font-size:18px">${(foreignNet+trustNet+dealerNet>0?'+':'')+(foreignNet+trustNet+dealerNet).toLocaleString()}</div>
          <div class="ind-tip">外資${foreignNet>=0?'+':''}${foreignNet} 投信${trustNet>=0?'+':''}${trustNet}</div>
        </div>
        <div class="sd-ind-card">
          <div class="ind-label">荳荳評分</div>
          <div class="ind-main" style="color:var(--warning)">${s.score}</div>
          <div class="ind-tip">/ 11 分｜Type ${s.type !== 'none' ? s.type : '--'}</div>
        </div>
        <div class="sd-ind-card">
          <div class="ind-label">建議停損</div>
          <div class="ind-main" style="font-size:16px;color:var(--danger)">${stopLoss}</div>
          <div class="ind-tip" style="color:var(--success)">目標 ${target}</div>
        </div>
        <div class="sd-ind-card">
          <div class="ind-label">技術類型</div>
          <div class="ind-main" style="font-size:16px">${s.type !== 'none' ? 'Type ' + s.type : '--'}</div>
          <div class="ind-tip">${s.maBull ? '均線多頭 ✔' : '均線未排列'}</div>
        </div>
      </div>

      <!-- 診斷文字 -->
      <div class="sd-panel" style="margin-top:12px;font-size:13px;">
        <div class="sd-panel-title">🚀 即時診斷</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div class="sd-diag-item"><div class="sd-diag-icon">💰 <strong>價格交量</strong></div><div class="sd-diag-content">成交 ${vol.toLocaleString()} 張，量比 ${s.volRatio}x，${parseFloat(s.volRatio)>1.5?'量能放大，動能充足。':'量能偏低。'}</div></div>
          <div class="sd-diag-item"><div class="sd-diag-icon">🏛 <strong>三大法人</strong></div><div class="sd-diag-content">${(foreignNet+trustNet+dealerNet)>0?'法人積極買超，籌碼正向。':'法人偏空，留意出貨。'}</div></div>
          <div class="sd-diag-item"><div class="sd-diag-icon">📊 <strong>技術面</strong></div><div class="sd-diag-content">${s.maBull?'均線多頭排列，趨勢明確向上。':'均線尚未多頭排列，觀察整理。'}  RSI 正常區間。</div></div>
          <div class="sd-diag-item"><div class="sd-diag-icon">⚠️ <strong>風險</strong></div><div class="sd-diag-content">${s.dist52W < 5?'接近52週高點，追高留意。':s.dist52W>20?'距高點較遠，爆發力待觀察。':'距高點 '+s.dist52W+'%，位置合理。'}</div></div>
        </div>
      </div>
    </div>
  `;

  // 渲染 Lightweight Chart
  setTimeout(() => {
    if (s.kline && s.kline.length > 0) {
      renderLWChart(`inlineTVChart_${s.id}`, s.kline, 260);
    } else {
      const chartEl = document.getElementById(`inlineTVChart_${s.id}`);
      if (chartEl) chartEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">暫無 K 線資料</div>';
    }
  }, 100);
}


function loadTVChart(s) {
  currentChartSymbol = s.id;
  window.currentChartMarket = s.market || 'TWSE';

  const container = document.getElementById('tvChartContainer');
  container.innerHTML = '';

  if (s.kline && s.kline.length > 0) {
    const h = Math.max(container.getBoundingClientRect().height, 500);
    currentLWChart = renderLWChart('tvChartContainer', s.kline, h);
  } else {
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">暫無 K 線資料</div>';
  }
}

// ---- 從當前 K 線開啟戰情板 ----
function openCurrentDash() {
  if (!currentChartSymbol) return;
  openStockDash(currentChartSymbol);
}

function renderChartStockList() {}
function filterChartList() {}

// ---- 開啟個股戰情板 ----
function openStockDash(symbolId) {
  if (!symbolId) { alert('請先選擇標的'); return; }
  let stock = mockStocks.find(s => s.id === symbolId);
  if (!stock) { 
    stock = {
      id: symbolId,
      name: '自訂標的',
      price: '--',
      change: 0,
      market: window.currentChartMarket || 'GLOBAL',
      score: 0,
      type: 'none',
      volRatio: 1.0,
      dailyVol: 0,
      dist52W: 0
    };
  }
  switchView('stockdash');
  setTimeout(() => renderStockDash(stock), 100);
}

// ---- 渲染個股戰情板 ----
function renderStockDash(s) {
  const now = new Date();
  const dateStr = `資料日期：${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

  document.getElementById('sd-symbol').innerText = `${s.id} (${s.name}) 股票 AI 戰情分析儀表板`;
  document.getElementById('sd-subtitle').innerText = '法人大買＋主力買超＋股價強勢，動能點火！';
  document.getElementById('sd-price').innerText = s.price;
  document.getElementById('sd-price').className = `sd-price ${parseFloat(s.change) >= 0 ? 'text-up' : 'text-down'}`;
  document.getElementById('sd-change').innerText = `${parseFloat(s.change) > 0 ? '▲' : '▼'} ${Math.abs(s.change)} (${Math.abs(s.change)}%)`;
  document.getElementById('sd-change').className = `sd-change ${parseFloat(s.change) >= 0 ? 'text-up' : 'text-down'}`;
  document.getElementById('sd-date').innerText = dateStr;

  // Lightweight Chart（rAF 確保容器尺寸就緒）
  const dashContainer = document.getElementById('tvDashChart');
  if (s.kline && s.kline.length > 0) {
    requestAnimationFrame(() => {
      currentLWDashChart = renderLWChart('tvDashChart', s.kline, 450);
    });
  } else {
    dashContainer.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">暫無 K 線資料</div>';
  }

  // 模擬籌碼數據
  const foreignNet  = Math.round((Math.random() * 5000 - 1000));
  const trustNet    = Math.round((Math.random() * 500 - 100));
  const dealerNet   = Math.round((Math.random() * 200 - 50));
  const mainForce   = Math.round((Math.random() * 1000 - 200));
  const mainTotal   = Math.round(mainForce * (3 + Math.random()*7));

  // 關鍵數據
  const high  = +(s.price * (1 + Math.random() * 0.05)).toFixed(2);
  const low   = +(s.price * (1 - Math.random() * 0.05)).toFixed(2);
  const amp   = +((high - low) / low * 100).toFixed(2);
  const vol   = s.dailyVol;
  const inner = Math.round(vol * (0.4 + Math.random() * 0.2));
  const outer = vol - inner;

  document.getElementById('sd-key-grid').innerHTML = `
    <div class="sd-kv-row"><span>收盤</span><span class="text-up" style="font-size:18px;font-weight:700">${s.price}</span></div>
    <div class="sd-kv-row"><span>漲跌</span><span class="${parseFloat(s.change)>=0?'text-up':'text-down'}">▲ ${Math.abs(s.change)} (${Math.abs(s.change)}%)</span></div>
    <div class="sd-kv-row"><span>最高</span><span>${high}</span></div>
    <div class="sd-kv-row"><span>最低</span><span>${low}</span></div>
    <div class="sd-kv-row"><span>成交量</span><span>${vol.toLocaleString()} 張</span></div>
    <div class="sd-kv-row"><span>內盤/外盤</span><span>${inner.toLocaleString()} / ${outer.toLocaleString()}</span></div>
    <div class="sd-kv-row"><span>振幅</span><span>${amp}%</span></div>
    <div class="sd-kv-row"><span>評分</span><span style="color:var(--warning);font-weight:700">${s.score}/11</span></div>
  `;

  // AI 漲跌機率計算（以評分為基礎加隨機擾動）
  const rawProb = Math.min(95, Math.max(20, s.score / 11 * 80 + Math.random() * 20));
  const prob = Math.round(rawProb);
  const probFall = Math.round((100 - prob) * 0.3);
  const probFlat = 100 - prob - probFall;

  // 更新量規
  const maxDash = 283;
  document.getElementById('gaugeFill').setAttribute('stroke-dashoffset', (maxDash * (1 - prob / 100)).toFixed(1));
  document.getElementById('gaugeFill').setAttribute('stroke', prob >= 60 ? '#10b981' : prob >= 40 ? '#f59e0b' : '#ef4444');
  document.getElementById('gaugeText').innerText = `${prob}%`;
  document.getElementById('sd-gauge-labels').innerHTML = `
    <div style="display:flex;justify-content:space-around;font-size:12px;color:var(--text-muted);">
      <span>回檔 ${probFall}%</span><span>盤整 ${probFlat}%</span><span>上漲 ${prob}%</span>
    </div>
  `;

  // 法人籌碼
  document.getElementById('sd-chips-grid').innerHTML = `
    <div class="chips-bar-wrap">
      <div class="chips-bar-label">外資</div>
      <div class="chips-bar-track"><div class="chips-bar-fill" style="width:${Math.min(100,Math.abs(foreignNet)/3000*100)}%;background:${foreignNet>=0?'var(--up-color)':'var(--down-color)'}"></div></div>
      <div class="chips-val ${foreignNet>=0?'text-up':'text-down'}">${(foreignNet>0?'+':'')+foreignNet.toLocaleString()}</div>
    </div>
    <div class="chips-bar-wrap">
      <div class="chips-bar-label">投信</div>
      <div class="chips-bar-track"><div class="chips-bar-fill" style="width:${Math.min(100,Math.abs(trustNet)/500*100)}%;background:${trustNet>=0?'var(--up-color)':'var(--down-color)'}"></div></div>
      <div class="chips-val ${trustNet>=0?'text-up':'text-down'}">${(trustNet>0?'+':'')+trustNet.toLocaleString()}</div>
    </div>
    <div class="chips-bar-wrap">
      <div class="chips-bar-label">自營商</div>
      <div class="chips-bar-track"><div class="chips-bar-fill" style="width:${Math.min(100,Math.abs(dealerNet)/200*100)}%;background:${dealerNet>=0?'var(--up-color)':'var(--down-color)'}"></div></div>
      <div class="chips-val ${dealerNet>=0?'text-up':'text-down'}">${(dealerNet>0?'+':'')+dealerNet.toLocaleString()}</div>
    </div>
  `;
  document.getElementById('sd-chips-table').innerHTML = `
    <table style="width:100%;font-size:12px;margin-top:8px;border-collapse:collapse;">
      <tr style="color:var(--text-muted);"><th>項目</th><th style="text-align:right">張數</th></tr>
      <tr><td>外資</td><td class="${foreignNet>=0?'text-up':'text-down'}" style="text-align:right">${(foreignNet>0?'+':'')+foreignNet.toLocaleString()}</td></tr>
      <tr><td>投信</td><td class="${trustNet>=0?'text-up':'text-down'}" style="text-align:right">${(trustNet>0?'+':'')+trustNet.toLocaleString()}</td></tr>
      <tr><td>自營商</td><td class="${dealerNet>=0?'text-up':'text-down'}" style="text-align:right">${(dealerNet>0?'+':'')+dealerNet.toLocaleString()}</td></tr>
      <tr style="border-top:1px solid var(--border-color);font-weight:700"><td>合計</td><td class="${(foreignNet+trustNet+dealerNet)>=0?'text-up':'text-down'}" style="text-align:right">${(foreignNet+trustNet+dealerNet>0?'+':'')+(foreignNet+trustNet+dealerNet).toLocaleString()}</td></tr>
    </table>
    ${(foreignNet+trustNet+dealerNet) > 0 ? '<div style="color:var(--success);font-size:11px;margin-top:6px">✓ 法人資金積極回補！</div>' : ''}
  `;

  // 進出場訊號
  const signal = prob >= 65 ? { label: '可布局', color: 'var(--success)', rate: `${prob}%`, risk: `1:${(prob/30).toFixed(1)}` }
                : prob >= 45 ? { label: '觀察中', color: 'var(--warning)', rate: `${prob}%`, risk: `1:1.0` }
                : { label: '暫觀望', color: 'var(--danger)', rate: `${prob}%`, risk: `1:0.5` };
  const stopLoss = (s.price * 0.92).toFixed(2);
  const target   = (s.price * 1.1).toFixed(2);
  document.getElementById('sd-signal').innerHTML = `
    <div style="font-size:24px;font-weight:800;color:${signal.color};text-align:center;padding:10px 0">${signal.label}</div>
    <div style="display:flex;justify-content:space-around;font-size:13px;margin-bottom:10px">
      <span>勝率 <strong>${signal.rate}</strong></span>
      <span>風險比 <strong>${signal.risk}</strong></span>
    </div>
    <div style="background:rgba(245,158,11,0.15);border-radius:6px;padding:8px;text-align:center;font-size:13px">
      建議停損：<strong style="color:var(--warning)">${stopLoss}</strong>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:8px;color:var(--text-muted)">
      <span>短目標：${target}</span><span>停損：${stopLoss}</span>
    </div>
  `;

  // 即時診斷
  const diagItems = [
    { icon: '💰', title: '價格與成交量', content: `收盤 ${s.price}，漲幅 ${s.change}%，成交 ${vol.toLocaleString()} 張，${vol > 10000 ? '外資大力內盤，買方積極。' : '成交量普通。'}` },
    { icon: '🏛', title: '三大法人', content: `外資 ${foreignNet>0?'+':''}${foreignNet}，投信 ${trustNet>0?'+':''}${trustNet}，自營 ${dealerNet>0?'+':''}${dealerNet}，合計 ${foreignNet+trustNet+dealerNet>0?'法人積極買超，籌碼正向。':'法人偏空，留意風險。'}` },
    { icon: '📊', title: '主力動向', content: `主力增減：${mainForce>0?'+':''}${mainForce}，10日累計：${mainTotal}，${mainForce>0?'→ 主力資金回流，加碼明確！':'→ 主力流出，謹慎為宜。'}` },
    { icon: '⚡', title: '技術趨勢強度', content: `綜合評分 <strong style="color:var(--warning)">${s.score*9}/100</strong>，${s.maBull?'多頭強勢，多頭排列明確。':'均線尚未多頭排列。'}` },
    { icon: '⚠️', title: '風險提醒', content: [
      s.dist52W < 5 ? '接近52週高點，追高風險提升' : '',
      parseFloat(s.change) > 6 ? '當日漲幅超過6%，追高風險高' : '',
      s.volRatio > 3 ? '量能暴增，留意主力出貨可能' : '',
    ].filter(Boolean).join('；') || '目前無特殊風險訊號。' },
    { icon: '✅', title: '操作建議', content: `可布局，建議攤位 ${+(s.price*0.97).toFixed(2)} ~ ${s.price}，停損 ${stopLoss}，日標 ${target}。` }
  ];

  document.getElementById('sd-diag').innerHTML = diagItems.map(d => `
    <div class="sd-diag-item">
      <div class="sd-diag-icon">${d.icon} <strong>${d.title}</strong></div>
      <div class="sd-diag-content">${d.content}</div>
    </div>
  `).join('');

  // 技術指標底部卡片
  const k = (Math.random()*100).toFixed(2);
  const d = (parseFloat(k) - Math.random()*20).toFixed(2);
  const rsi = (40 + Math.random()*55).toFixed(2);
  const macd_dif = (Math.random()*4-1).toFixed(2);
  const macd_dea = (parseFloat(macd_dif) - Math.random()).toFixed(2);
  const bb_mid   = s.price;
  const bb_upper = +(s.price * 1.05).toFixed(2);
  const bb_lower = +(s.price * 0.95).toFixed(2);

  document.getElementById('sd-kd').innerHTML = `
    <div class="ind-label">KD 指標（日K）</div>
    <div class="ind-main">K <strong>${k}</strong></div>
    <div>D <strong>${d}</strong></div>
    <div class="ind-tip ${parseFloat(k)>parseFloat(d)?'text-up':'text-down'}">${parseFloat(k)>parseFloat(d)?'黃金交叉，強勢':'死亡交叉，留意'}</div>
  `;
  document.getElementById('sd-rsi').innerHTML = `
    <div class="ind-label">RSI(14)</div>
    <div class="ind-main rsi-val ${parseFloat(rsi)>80?'text-up':parseFloat(rsi)<30?'text-down':''}">${rsi}</div>
    <div class="ind-tip ${parseFloat(rsi)>80?'text-down':parseFloat(rsi)<30?'text-up':''}">${parseFloat(rsi)>80?'⚠️ 過熱，留意回調':parseFloat(rsi)<30?'超賣，注意反彈':'正常區間'}</div>
  `;
  document.getElementById('sd-macd').innerHTML = `
    <div class="ind-label">MACD</div>
    <div>DIF <strong>${macd_dif}</strong></div>
    <div>DEA <strong>${macd_dea}</strong></div>
    <div class="ind-tip ${parseFloat(macd_dif)>parseFloat(macd_dea)?'text-up':'text-down'}">${parseFloat(macd_dif)>parseFloat(macd_dea)?'MACD 翻正，趨勢向上':'MACD 偏空'}</div>
  `;
  document.getElementById('sd-bb').innerHTML = `
    <div class="ind-label">布林通道</div>
    <div>上 <strong>${bb_upper}</strong></div>
    <div>中 <strong>${bb_mid}</strong></div>
    <div>下 <strong>${bb_lower}</strong></div>
  `;
  document.getElementById('sd-score').innerHTML = `
    <div class="ind-label">荳荳評分</div>
    <div class="ind-main" style="font-size:28px;color:var(--warning)">${s.score}</div>
    <div style="color:var(--text-muted);font-size:11px">/ 11 分</div>
    <div class="ind-tip ${s.type!=='none'?'text-up':'text-muted'}">類型：${s.type !== 'none' ? s.type : '--'}</div>
  `;
}
