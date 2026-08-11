(function(){
  console.log('[OneSignal] Loading local es6 SDK...');
  const n = document.createElement("script");
  n.src = "./OneSignalSDK.page.es6.js";
  n.defer = true;
  document.head.appendChild(n);
})();