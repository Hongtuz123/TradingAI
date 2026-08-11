// 荳荳 AI 智能選股 — PWA Service Worker
try {
  importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
} catch (e) {}

const CACHE_NAME = 'doudou-ai-cache-v2.5';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './stock-dashboard.js',
  './manifest.json'
];

// 安裝服務工作線程
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.warn('PWA 靜態檔案快取部分跳過:', err);
      });
    })
  );
  self.skipWaiting();
});

// 激活服務工作線程並清理舊快取
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 網路請求攔截與漸進式快取
self.addEventListener('fetch', (event) => {
  // 只處理 GET 請求
  if (event.request.method !== 'GET') return;
  
  // API 或動態數據一律網路優先
  const url = event.request.url;
  if (url.includes('/api/') || url.includes('data.js') || url.includes('data.json')) {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});

// 推播通知監聽 (預留給 Phase 2/3)
self.addEventListener('push', (event) => {
  let payload = {
    title: '🟢 荳荳 AI 動態交易訊號',
    body: '觸發最新買進/加碼訊號，點擊直達 TradingView App！',
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🌱</text></svg>',
    data: { url: 'tradingview://symbol/TWSE:2330' }
  };

  if (event.data) {
    try {
      payload = Object.assign(payload, event.data.json());
    } catch (e) {
      payload.body = event.data.text();
    }
  }

  const options = {
    body: payload.body,
    icon: payload.icon,
    badge: payload.icon,
    data: payload.data,
    vibrate: [100, 50, 100],
    actions: [
      { action: 'open_tv', title: '📈 TradingView App' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});

// 點擊通知跳轉至 TradingView App
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  let targetUrl = 'tradingview://symbol/TWSE:2330';
  if (event.notification.data && event.notification.data.url) {
    targetUrl = event.notification.data.url;
  } else if (event.notification.data && event.notification.data.symbol) {
    const sym = event.notification.data.symbol;
    const mkt = (event.notification.data.market || 'TSE').toUpperCase() === 'OTC' ? 'TPEX' : 'TWSE';
    targetUrl = `tradingview://symbol/${mkt}:${sym}`;
  }

  event.waitUntil(
    clients.openWindow(targetUrl).catch(() => {
      clients.openWindow('https://www.tradingview.com');
    })
  );
});
