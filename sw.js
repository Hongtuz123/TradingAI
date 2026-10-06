// 🐾 荳荳 AI 智能選股 — 原生標準 Web Push Service Worker
const CACHE_NAME = 'doudou-ai-cache-v5.8-lifecycle-realrr';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css?v=88',
  './app.js?v=88',
  './stock-dashboard.js?v=88',
  './manifest.json',
  './icon.png',
  './apple-touch-icon.png'
];

// 安裝服務工作線程
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
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

// 網路請求攔截 (Network-First)
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  try {
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;

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

// 🔔 原生標準 Web Push 推播通知監聽 (相容 Apple APNs / RFC 8292 標準封包)
self.addEventListener('push', (event) => {
  const now = new Date();
  const timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

  let title = `🟢 [${timeStr}] 荳荳 AI 交易訊號`;
  let body = '觸發最新買進起爆訊號，點擊立即查看荳荳精選買進清單 🐕';
  let targetUrl = './index.html?view=screener&filter=buy';
  let targetView = 'screener';
  let targetFilter = 'buy';
  let notifTag = 'doudou-signal-' + Date.now();

  if (event.data) {
    try {
      const json = event.data.json();
      if (json.title) title = json.title;
      if (json.body) body = json.body;
      else if (json.alert) body = json.alert;

      if (json.data) {
        if (json.data.url) targetUrl = json.data.url;
        if (json.data.view) targetView = json.data.view;
        if (json.data.filter) targetFilter = json.data.filter;
      }
      if (json.tag) notifTag = json.tag;
    } catch (e) {
      body = event.data.text() || body;
    }
  }

  // 🍎 iOS Safari 16.4+ 規範：乾淨 options，避免不支援屬性導致拒絕彈窗
  const options = {
    body: body,
    icon: './apple-touch-icon.png',
    badge: './apple-touch-icon.png',
    data: {
      url: targetUrl,
      view: targetView,
      filter: targetFilter
    },
    tag: notifTag
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// 🎯 點擊通知導回荳荳 AI 系統並切換指定清單
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

  try {
    const parsed = new URL(targetUrl, self.location.origin);
    if (parsed.searchParams.get('view')) targetView = parsed.searchParams.get('view');
    if (parsed.searchParams.get('filter')) targetFilter = parsed.searchParams.get('filter');
  } catch (e) {}

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let client of windowClients) {
        if ('focus' in client) {
          try {
            client.postMessage({
              type: 'DOUDOU_NOTIFICATION_CLICK',
              view: targetView,
              filter: targetFilter,
              url: targetUrl
            });
          } catch (e) {}
          if ('navigate' in client) {
            client.navigate(targetUrl).catch(() => {});
          }
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
