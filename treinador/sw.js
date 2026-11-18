// Guarda a tela do app do treinador no celular para abrir sem internet (os dados ficam no app.js, localStorage).
// Mudou algum arquivo? O publicar-site.sh troca a VERSAO sozinho.
const VERSAO = "treinador-202611181904";
const ARQUIVOS = ["./", "index.html", "app.js", "pdf.js", "jspdf.umd.min.js", "manifest.webmanifest",
  "../icons/logo-horizontal.svg", "../icons/icon-192.png", "../icons/icon-512.png", "../icons/icon-maskable-512.png", "../icons/apple-touch-icon.png", "../icons/favicon-32.png",
  "../fonts/archivo.woff2", "../fonts/inter.woff2", "../fonts/jetbrainsmono.woff2"];
const PRIMEIRO_REDE = /\/treinador\/(index\.html|app\.js|pdf\.js|manifest\.webmanifest)?$/;

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

// ---------- recado do aluno no celular do treinador (servidor versão 22; pedido do criador, 18/11/2026) ----------
// O servidor manda só um "toque" (sem conteúdo): aqui o app pergunta qual é o aviso (t_meus_avisos) e mostra.
// A chave do treinador e a do servidor de avisos vêm do cache "cfg-avisos-tr", que o app.js grava.
async function cfgTr(){ try { const r = await (await caches.open("cfg-avisos-tr")).match("cfg"); return r ? await r.json() : null; } catch(err){ return null; } }
async function guardarCfgTr(c){ try { await (await caches.open("cfg-avisos-tr")).put("cfg", new Response(JSON.stringify(c))); } catch(err){} }
function bytesB64(b64){ const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4)); return Uint8Array.from(s, c => c.charCodeAt(0)); }
async function mostrarRecado(){
  let av = null; const cfg = await cfgTr();
  if (cfg && cfg.tchave && cfg.api){
    try {
      const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 9000);
      const j = await (await fetch(cfg.api, {method: "POST", body: JSON.stringify({acao: "t_meus_avisos", chave: cfg.tchave}), signal: ctrl.signal, redirect: "follow"})).json();
      clearTimeout(t);
      const lista = (j && j.avisos) || [], mostrados = cfg.mostrados || [];
      av = lista.find(x => !mostrados.includes(x.id)) || lista[0] || null;
      if (av){ cfg.mostrados = [av.id].concat(mostrados).slice(0, 40); await guardarCfgTr(cfg); }
    } catch(err){}
  }
  return self.registration.showNotification(av ? av.titulo : "Recado de aluno", {body: av ? av.texto : "Toque para abrir o app do treinador.",
    icon: "../icons/icon-192.png", tag: av ? String(av.id) : "recado", lang: "pt-BR", data: {abrir: (av && av.abrir) || "/hoje"}});
}
self.addEventListener("push", e => { e.waitUntil(mostrarRecado()); });
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const abrir = (e.notification.data && e.notification.data.abrir) || "/hoje";
  e.waitUntil(clients.matchAll({type: "window", includeUncontrolled: true}).then(cs => {
    const c = cs.find(x => x.url.startsWith(self.registration.scope));
    if (c){ c.postMessage({abrir}); return c.focus(); }
    return clients.openWindow(new URL("./#" + abrir, self.registration.scope).href);
  }));
});
// o navegador trocou o endereço dos avisos: inscreve de novo e avisa o servidor
self.addEventListener("pushsubscriptionchange", e => {
  e.waitUntil((async () => {
    const cfg = await cfgTr(); if (!cfg || !cfg.ligado || !cfg.vapid || !cfg.tchave) return;
    const sub = await self.registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: bytesB64(cfg.vapid)});
    await fetch(cfg.api, {method: "POST", body: JSON.stringify({acao: "t_meus_avisos_ligar", chave: cfg.tchave, sub: sub.toJSON()})});
  })().catch(() => {}));
});
