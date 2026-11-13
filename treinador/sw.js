// Guarda a tela do app do treinador no celular para abrir sem internet (os dados ficam no app.js, localStorage).
// Mudou algum arquivo? O publicar-site.sh troca a VERSAO sozinho.
const VERSAO = "treinador-202611130444";
const ARQUIVOS = ["./", "index.html", "app.js", "manifest.webmanifest",
  "../icons/logo-horizontal.svg", "../icons/icon-192.png", "../icons/icon-512.png", "../icons/icon-maskable-512.png", "../icons/apple-touch-icon.png", "../icons/favicon-32.png",
  "../fonts/archivo.woff2", "../fonts/inter.woff2", "../fonts/jetbrainsmono.woff2"];
const PRIMEIRO_REDE = /\/treinador\/(index\.html|app\.js|manifest\.webmanifest)?$/;

self.addEventListener("install", e => { e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("treinador-") && k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

function daRede(req, ms){
  return new Promise((ok, falha) => {
    const t = setTimeout(() => falha(new Error("lento")), ms);
    fetch(req).then(r => { clearTimeout(t); ok(r); }, e => { clearTimeout(t); falha(e); });
  });
}
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  const chave = req.mode === "navigate" ? new URL("index.html", self.registration.scope).href : req;
  if (req.mode === "navigate" || PRIMEIRO_REDE.test(url.pathname)) {
    e.respondWith(daRede(req, 3000).then(r => {
      if (r.ok) { const copia = r.clone(); caches.open(VERSAO).then(c => c.put(chave, copia)); }
      return r;
    }).catch(() => caches.match(chave, {ignoreSearch: true}).then(r => r || caches.match(new URL("./", self.registration.scope).href))));
    return;
  }
  e.respondWith(caches.match(req, {ignoreSearch: true}).then(r => r || fetch(req).then(resp => {
    if (resp.ok) { const copia = resp.clone(); caches.open(VERSAO).then(c => c.put(req, copia)); }
    return resp;
  })));
});
