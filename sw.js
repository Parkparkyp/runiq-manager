const CACHE = 'runiq-snap-v41';
const ASSETS = ['./', './index.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png', './icons/icon.svg', './rqpdf.js', './vendor/html2canvas.min.js', './vendor/jspdf.umd.min.js', './ledger.js', './coupang.js', './tax.js', './vendor/xlsx.core.min.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// 캐시 우선 + 백그라운드 갱신 (오프라인에서도 앱 실행, Tailwind/폰트도 캐시)
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // 구글 스크립트(계약서 데이터)나 고객 계약서·예약신청 페이지는 절대 캐시하지 않고 항상 네트워크로 (다른 고객 내용이 섞이면 안 돼요)
  const u = new URL(e.request.url);
  if (u.hostname.endsWith('google.com') || u.hostname.endsWith('googleusercontent.com') || u.pathname.endsWith('/contract.html') || u.pathname.endsWith('/request.html')) return;
  e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(hit => {
    const net = fetch(e.request).then(res => { if (res && (res.ok || res.type === 'opaque')) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); } return res; }).catch(() => hit);
    return hit || net;
  }));
});
