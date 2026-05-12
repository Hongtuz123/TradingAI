// 簡易 Canvas K線圖繪製引擎
const KLineChart = {
  canvas: null,
  ctx: null,
  volCanvas: null,
  volCtx: null,
  data: [],
  config: {
    upColor: '#ef4444',
    downColor: '#10b981',
    bgColor: '#131722',
    gridColor: '#2B3139',
    textColor: '#848E9C',
    candleWidth: 8,
    gap: 2,
    margin: { top: 20, right: 50, bottom: 20, left: 10 }
  },

  init(klineId, volId) {
    this.canvas = document.getElementById(klineId);
    this.ctx = this.canvas.getContext('2d');
    this.volCanvas = document.getElementById(volId);
    this.volCtx = this.volCanvas.getContext('2d');
    
    this.resize();
    window.addEventListener('resize', () => this.resize());
  },

  resize() {
    if(!this.canvas) return;
    const parent1 = this.canvas.parentElement;
    this.canvas.width = parent1.clientWidth;
    this.canvas.height = parent1.clientHeight;
    
    const parent2 = this.volCanvas.parentElement;
    this.volCanvas.width = parent2.clientWidth;
    this.volCanvas.height = parent2.clientHeight;
    
    this.render();
  },

  setData(data) {
    this.data = data;
    this.render();
  },

  generateMockData(days = 60, basePrice = 100) {
    let result = [];
    let price = basePrice;
    let now = new Date();
    
    for(let i = days; i >= 0; i--) {
      let d = new Date(now);
      d.setDate(d.getDate() - i);
      
      let open = price;
      let close = open + (Math.random() - 0.48) * (open * 0.05); // 稍微偏多頭
      let high = Math.max(open, close) + Math.random() * (open * 0.03);
      let low = Math.min(open, close) - Math.random() * (open * 0.03);
      let vol = Math.floor(Math.random() * 50000) + 10000;
      
      price = close;
      
      result.push({
        date: d.toISOString().split('T')[0],
        open, high, low, close, vol
      });
    }
    return result;
  },

  render() {
    if(!this.ctx || this.data.length === 0) return;
    
    const { width, height } = this.canvas;
    const { margin, upColor, downColor, gridColor, textColor } = this.config;
    const drawWidth = width - margin.left - margin.right;
    const drawHeight = height - margin.top - margin.bottom;
    
    // 計算最大最小值
    let maxPrice = 0, minPrice = Infinity, maxVol = 0;
    this.data.forEach(d => {
      if(d.high > maxPrice) maxPrice = d.high;
      if(d.low < minPrice) minPrice = d.low;
      if(d.vol > maxVol) maxVol = d.vol;
    });
    
    // 預留空間
    maxPrice *= 1.02;
    minPrice *= 0.98;
    
    // K線圖背景與格線
    this.ctx.fillStyle = this.config.bgColor;
    this.ctx.fillRect(0, 0, width, height);
    
    this.ctx.strokeStyle = gridColor;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    for(let i=1; i<5; i++) {
      let y = margin.top + (drawHeight / 5) * i;
      this.ctx.moveTo(margin.left, y);
      this.ctx.lineTo(width - margin.right, y);
      
      // 價格標籤
      this.ctx.fillStyle = textColor;
      this.ctx.font = '10px Arial';
      let p = maxPrice - (maxPrice - minPrice) * (i/5);
      this.ctx.fillText(p.toFixed(1), width - margin.right + 5, y + 4);
    }
    this.ctx.stroke();

    // 繪製K線
    const totalCandles = this.data.length;
    const itemWidth = drawWidth / totalCandles;
    const candleW = Math.max(1, itemWidth * 0.7);
    
    this.data.forEach((d, i) => {
      const x = margin.left + i * itemWidth + itemWidth/2;
      const yOpen = margin.top + drawHeight * (1 - (d.open - minPrice)/(maxPrice - minPrice));
      const yClose = margin.top + drawHeight * (1 - (d.close - minPrice)/(maxPrice - minPrice));
      const yHigh = margin.top + drawHeight * (1 - (d.high - minPrice)/(maxPrice - minPrice));
      const yLow = margin.top + drawHeight * (1 - (d.low - minPrice)/(maxPrice - minPrice));
      
      const isUp = d.close >= d.open;
      const color = isUp ? upColor : downColor;
      
      this.ctx.strokeStyle = color;
      this.ctx.fillStyle = color;
      
      // 影線
      this.ctx.beginPath();
      this.ctx.moveTo(x, yHigh);
      this.ctx.lineTo(x, yLow);
      this.ctx.stroke();
      
      // 實體
      const bodyTop = Math.min(yOpen, yClose);
      const bodyHeight = Math.max(1, Math.abs(yClose - yOpen));
      this.ctx.fillRect(x - candleW/2, bodyTop, candleW, bodyHeight);
    });

    // 繪製成交量
    this.volCtx.fillStyle = this.config.bgColor;
    this.volCtx.fillRect(0, 0, this.volCanvas.width, this.volCanvas.height);
    
    const volHeight = this.volCanvas.height - 10;
    this.data.forEach((d, i) => {
      const x = margin.left + i * itemWidth + itemWidth/2;
      const isUp = d.close >= d.open;
      const color = isUp ? upColor : downColor;
      
      const vH = (d.vol / maxVol) * volHeight;
      this.volCtx.fillStyle = color;
      this.volCtx.fillRect(x - candleW/2, this.volCanvas.height - vH, candleW, vH);
    });
  }
};
