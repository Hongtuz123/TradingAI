// 荳荳 AI 智能選股 — PWA Service Worker
try {
  importScripts('./OneSignalSDK.sw.js');
} catch (e) {}

const CACHE_NAME = 'doudou-ai-cache-v3.0';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './stock-dashboard.js',
  './manifest.json',
  './OneSignalSDKWorker.js',
  './OneSignalSDK.sw.js',
  './OneSignalSDK.page.js',
  './OneSignalSDK.page.es6.js'
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
  
  try {
    const url = new URL(event.request.url);
    // 關鍵修正：只攔截本站同源請求。外部 CDN 如 OneSignal 等一律不予攔截，讓瀏覽器原生處理
    if (url.origin !== self.location.origin) {
      return;
    }

    // API 或動態數據一律網路優先
    if (url.pathname.includes('/api/') || url.pathname.includes('data.js') || url.pathname.includes('data.json')) {
      return;
    }

    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(event.request);
      })
    );
  } catch (e) {
    // 預防 URL 解析失敗時的安全退路
    return;
  }
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
