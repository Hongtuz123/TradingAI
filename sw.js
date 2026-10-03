// 荳荳 AI 智能選股 — PWA Service Worker
try {
  importScripts('./OneSignalSDK.sw.js');
} catch (e) {}

const CACHE_NAME = 'doudou-ai-cache-v4.2';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css?v=79',
  './app.js?v=79',
  './stock-dashboard.js?v=79',
  './manifest.json',
  './OneSignalSDKWorker.js',
  './OneSignalSDK.sw.js',
  './OneSignalSDK.page.js',
  './OneSignalSDK.page.es6.js'
];

// 安裝服務工作線程
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.warn('PWA 靜態檔案快取部分跳過:', err);
      });
    })
  );
});

// 激活服務工作線程並徹底清理舊快取
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] 清理過期快取:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 網路請求攔截 (Network-First，連線成功即自動更新快取)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  
  try {
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) {
      return;
    }

    if (url.pathname.includes('/api/') || url.pathname.includes('data.js') || url.pathname.includes('data.json')) {
      return;
    }

    event.respondWith(
      fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        return caches.match(event.request);
      })
    );
  } catch (e) {
    return;
  }
});

// 推播通知監聽 (收到雲端推播時的預設展示)
self.addEventListener('push', (event) => {
  const now = new Date();
  const timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

  let payload = {
    title: `🟢 [${timeStr}] 2330 台積電 · 買進 (1D+4H)`,
    body: '觸發最新買進起爆訊號，點擊立即查看荳荳精選買進清單 🐕',
    icon: './apple-touch-icon.png',
    data: { url: './index.html?view=screener&filter=buy', view: 'screener', filter: 'buy' }
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
    icon: payload.icon || './apple-touch-icon.png',
    badge: payload.badge || './apple-touch-icon.png',
    data: payload.data,
    vibrate: [200, 100, 200]
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});

// 點擊通知導回荳荳 AI 系統並開啟荳荳清單對應篩選 (買進/賣出/加碼)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  let targetUrl = './index.html?view=screener&filter=buy';
  let targetView = 'screener';
  let targetFilter = 'buy';

  if (event.notification.data) {
    if (event.notification.data.url) targetUrl = event.notification.data.url;
    if (event.notification.data.view) targetView = event.notification.data.view;
    if (event.notification.data.filter) targetFilter = event.notification.data.filter;
  }

  // 從 targetUrl 參數中解析 view 與 filter (雙重保險)
  try {
    const parsed = new URL(targetUrl, self.location.origin);
    if (parsed.searchParams.get('view')) targetView = parsed.searchParams.get('view');
    if (parsed.searchParams.get('filter')) targetFilter = parsed.searchParams.get('filter');
  } catch(e) {}

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // 1. 若已經有開啟中的視窗，向視窗發送 postMessage 觸發即時切換並 focus
      for (let client of windowClients) {
        if ('focus' in client) {
          try {
            client.postMessage({
              type: 'DOUDOU_NOTIFICATION_CLICK',
              view: targetView,
              filter: targetFilter,
              url: targetUrl
            });
          } catch(e) {}
          if ('navigate' in client) {
            client.navigate(targetUrl).catch(() => {});
          }
          return client.focus();
        }
      }
      // 2. 若完全未開啟任何視窗，則直接開啟新視窗
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
