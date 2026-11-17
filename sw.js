// Guarda a tela do app no celular para abrir sem internet. Os dados do treino ficam no app.js (localStorage).
// Não mexe no app do treinador (pasta treinador/), que tem o seu próprio sw.js.
// Mudou algum arquivo do site? Troque a VERSAO para os celulares pegarem a tela nova.
const VERSAO = "treino-202611171721";
const ARQUIVOS = ["./", "index.html", "app.js", "manifest.webmanifest",
  "icons/logo-horizontal.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png",
  "fonts/archivo.woff2", "fonts/inter.woff2", "fonts/jetbrainsmono.woff2", "guia-fotos.pdf"];
const PRIMEIRO_REDE = /\/(index\.html|app\.js|manifest\.webmanifest)?$/;

self.addEventListener("install", e => { e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("treino-") && k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

function daRede(req, ms){
  return new Promise((ok, falha) => {
    const t = setTimeout(() => falha(new Error("lento")), ms);
    fetch(req).then(r => { clearTimeout(t); ok(r); }, e => { clearTimeout(t); falha(e); });
  });
}
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;   // o servidor do Google passa direto
  if (url.pathname.includes("/treinador/")) return;                       // o app do treinador tem o seu próprio sw.js
  const chave = req.mode === "navigate" ? "index.html" : req;
  if (req.mode === "navigate" || PRIMEIRO_REDE.test(url.pathname)) {
    // tela: tenta a rede (versão nova) por 3 segundos; sem sinal, usa a guardada
    e.respondWith(daRede(req, 3000).then(r => {
      if (r.ok) { const copia = r.clone(); caches.open(VERSAO).then(c => c.put(chave, copia)); }
      return r;
    }).catch(() => caches.match(chave, {ignoreSearch: true}).then(r => r || caches.match("./"))));
    return;
  }
  e.respondWith(caches.match(req, {ignoreSearch: true}).then(r => r || fetch(req).then(resp => {
    if (resp.ok) { const copia = resp.clone(); caches.open(VERSAO).then(c => c.put(req, copia)); }
    return resp;
  })));
});

// ---------- avisos no celular (servidor versão 17) ----------
// O servidor manda só um "toque" (sem conteúdo): aqui o app pergunta qual é o aviso e mostra. O código do aluno vem do
// cache "cfg-avisos", que o app.js grava (o sw.js não lê o localStorage).
async function cfgAvisos(){ try { const r = await (await caches.open("cfg-avisos")).match("cfg"); return r ? await r.json() : null; } catch(err){ return null; } }
async function guardarCfgAvisos(c){ try { await (await caches.open("cfg-avisos")).put("cfg", new Response(JSON.stringify(c))); } catch(err){} }
function chaveBytes(b64){ const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4)); return Uint8Array.from(s, c => c.charCodeAt(0)); }
async function mostrarAviso(){
  let av = null; const cfg = await cfgAvisos();
  if (cfg && cfg.codigo && cfg.api){
    try {
      const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 9000);
      const j = await (await fetch(cfg.api, {method: "POST", body: JSON.stringify({acao: "avisos", codigo: cfg.codigo}), signal: ctrl.signal, redirect: "follow"})).json();
      clearTimeout(t);
      const lista = (j && j.avisos) || [], mostrados = cfg.mostrados || [];
      av = lista.find(x => !mostrados.includes(x.id)) || lista[0] || null;
      if (av){ cfg.mostrados = [av.id].concat(mostrados).slice(0, 40); await guardarCfgAvisos(cfg); }
    } catch(err){}
  }
  try { if (self.navigator.setAppBadge) await self.navigator.setAppBadge(1); } catch(err){}
  return self.registration.showNotification(av ? av.titulo : "Aviso do seu treinador", {body: av ? av.texto : "Toque para abrir o app.",
    icon: "icons/icon-192.png", tag: av ? String(av.id) : "aviso", lang: "pt-BR", data: {abrir: (av && av.abrir) || "avisos"}});
}
self.addEventListener("push", e => { e.waitUntil(mostrarAviso()); });
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const abrir = (e.notification.data && e.notification.data.abrir) || "avisos";
  e.waitUntil(clients.matchAll({type: "window", includeUncontrolled: true}).then(cs => {
    const c = cs.find(x => x.url.startsWith(self.registration.scope) && !x.url.includes("/treinador/"));
    if (c){ c.postMessage({abrir}); return c.focus(); }
    return clients.openWindow(new URL("./#" + abrir, self.registration.scope).href);
  }));
});
// o navegador trocou o endereço dos avisos: inscreve de novo e avisa o servidor
self.addEventListener("pushsubscriptionchange", e => {
  e.waitUntil((async () => {
    const cfg = await cfgAvisos(); if (!cfg || !cfg.ligado || !cfg.chave) return;
    const sub = await self.registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: chaveBytes(cfg.chave)});
    await fetch(cfg.api, {method: "POST", body: JSON.stringify({acao: "avisos_ligar", codigo: cfg.codigo, sub: sub.toJSON(), hora: cfg.hora, resumo: cfg.resumo !== false})});
  })().catch(() => {}));
});
