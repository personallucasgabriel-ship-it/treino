// App do aluno: treino da semana no celular, ligado ao "Protocolo de treino" do aluno.
// O servidor (app/aluno/Codigo.gs, Google Apps Script) lê e grava a planilha; esta tela só conversa com ele.
// Tudo o que o aluno anota fica primeiro no celular (fila) e vai para a planilha quando há internet.
"use strict";

const API = window.__API_URL || "https://script.google.com/macros/s/AKfycbwgKNi5GJVdmoQgbBivji6dISvLIxBYKxKf9rTWXOG762bF6nDEnAs0mIhzPGGpuuCpGw/exec";
const ORDEM = ["SEG","TER","QUA","QUI","SEX","SAB","DOM"];
const SEMANA_JS = ["DOM","SEG","TER","QUA","QUI","SEX","SAB"];
const NOMES = {DOM:"Domingo",SEG:"Segunda",TER:"Terça",QUA:"Quarta",QUI:"Quinta",SEX:"Sexta",SAB:"Sábado"};
const OFFSET = {SEG:0,TER:1,QUA:2,QUI:3,SEX:4,SAB:5,DOM:6};   // a semana do ciclo começa na segunda
const SEGUIDOS = {BISET:2, TRISET:3, "GIANT SET":99};
const COL_RECADO = 14;   // coluna O das abas Registro (leitura A5:O157)

const $ = id => document.getElementById(id);
const txt = v => (v == null ? "" : String(v)).trim();
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const mmss = s => `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
const dd = d => `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
const ddaaaa = d => `${dd(d)}/${d.getFullYear()}`;

// ---------- números ----------
// O que o aluno digita: "22,5" e "22.5" são 22,5 kg (o teclado de muitos Android só tem ponto).
function lerDigitado(v){
  let t = txt(v).replace(/\s/g,"").replace(",",".");
  if (t === "") return "";
  t = t.replace(/[^0-9.]/g,"");
  const p = t.indexOf("."); if (p >= 0) t = t.slice(0,p+1) + t.slice(p+1).replace(/\./g,"");
  const n = Number(t);
  return isFinite(n) && t !== "." ? n : "";
}
// O que vem da planilha (formato brasileiro): "27,5" → 27,5; "1.152" → 1152.
function lerPlanilha(v){
  let t = txt(v);
  if (t === "") return "";
  if (t.includes(",")) t = t.replace(/\./g,"").replace(",",".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g,"");
  const n = Number(t);
  return isFinite(n) ? n : "";
}
const fmt = n => n === "" || n == null ? "" : String(Math.round(Number(n)*100)/100).replace(".",",");

// ---------- código do aluno e memória do celular ----------
const CODIGO = (() => {
  const q = (new URLSearchParams(location.search).get("a") || "").replace(/[^A-Za-z0-9]/g,"");
  if (q) { guardar("codigo", q); return q; }
  return ler("codigo") || "";
})();
function ler(k){ try { const v = localStorage.getItem(k); return v == null ? null : JSON.parse(v); } catch(e){ return null; } }
function guardar(k,v){ try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch(e){ return false; } }
const K_DADOS = "dados:" + CODIGO, K_FILA = "fila:" + CODIGO;

// ---------- servidor ----------
async function chamar(corpo, ms){
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms || 25000);
  try {
    const j = window.__API_MOCK ? await window.__API_MOCK(corpo)
      : await (await fetch(API, {method:"POST", body: JSON.stringify(corpo), signal: ctrl.signal, redirect:"follow"})).json();
    if (!j || !j.ok) { const e = new Error((j && j.erro) || "Erro no servidor"); e.servidor = true; throw e; }
    return j;
  } finally { clearTimeout(t); }
}

// ---------- leitura da aba Treino (mesmas regras da skill treinador) ----------
function lerTreino(v){
  const cel = (r,c) => txt((v[r]||[])[c]);
  const out = {nome:"", inicio:null, revisao:"", faixas:{}, periodo:{}, aerobicos:[], treinos:{}};
  let aer = null;
  for (let r = 0; r < v.length; r++){
    const a = cel(r,0);
    if (a === "NOME:") out.nome = cel(r,1);
    if (a === "DATA DE ENTREGA:"){ out.inicio = [cel(r,1),cel(r,2)].find(x => /^\d{1,2}\/\d{1,2}/.test(x)) || null; out.revisao = cel(r,4); }
    (v[r]||[]).forEach((x,c) => { const m = /^Semana (\d+)$/.exec(txt(x)); if (m && /\d/.test(cel(r+1,c))) out.faixas[+m[1]] = cel(r+1,c); });
    if (a === "DIA" && /TREINO/.test(cel(r,1))){ for (let i = 1; i <= 7; i++){ const d = cel(r+i,0), t = cel(r+i,1); if (NOMES[d]) out.periodo[d] = /^[A-E]$/.test(t) ? t : ""; } }
    if (a === "EXERCÍCIOS AERÓBICOS") aer = r;
    const tm = /^TREINO ([A-E])\b/.exec(a);
    if (tm){
      const exs = [];
      for (let i = r+1; i < v.length && !/^TREINO [A-E]\b/.test(cel(i,0)) && cel(i,0) !== "OBSERVAÇÕES"; i++){
        if (/V[íi]deo/.test(cel(i,0)) && cel(i,1)){
          const lista = cel(i-1,1), obs = cel(i-1,7);
          const tec = lista && lista !== "Exercícios" ? lista.toUpperCase() : (/^BISET\b/i.test(obs) ? "BISET" : "");
          exs.push({nome: cel(i,1), series: parseInt(cel(i,5)) || 0, obs, tecnica: tec});
        }
      }
      out.treinos[tm[1]] = exs;
    }
  }
  if (aer != null){
    for (let r = aer+1; r < v.length; r++){
      const a = cel(r,0); if (!/^Semana/i.test(a)) continue;
      let sem = (a.match(/\d+/g)||[]).map(Number); const ra = /(\d+)\s*a\s*(\d+)/.exec(a);
      if (ra){ sem = []; for (let k = +ra[1]; k <= +ra[2]; k++) sem.push(k); }
      const dias = {};
      for (let i = 1; i <= 7; i++){ const d = cel(r+i,0), t = cel(r+i,1);
        if (NOMES[d] && /\d/.test(t)) dias[d] = t.replace(/(\d+)\s*min/i,"$1 min").replace(/\s*em um[a]?\s*/i,", ").replace(/media/i,"média").replace(/(\d+)\s*bpm/i,"$1 bpm"); }
      out.aerobicos.push({semanas: sem, dias});
    }
  }
  return out;
}
function data(s, base){
  if (!s) return null;
  const [d,m,y] = s.split("/").map(Number); if (!d || !m) return null;
  const hoje = base || new Date();
  const ano = y ? (y < 100 ? 2000 + y : y) : hoje.getFullYear();
  let dt = new Date(ano, m-1, d);
  if (!y && dt - hoje > 60*864e5) dt = new Date(ano-1, m-1, d);
  return dt;
}
const hojeZero = () => { const h = new Date(); return new Date(h.getFullYear(), h.getMonth(), h.getDate()); };
function semanaDe(dt){ const ini = P.ini; if (!ini) return 1; return Math.floor((dt - ini) / (7*864e5)) + 1; }
function dataDoDia(N, d){ if (!P.ini) return null; const x = new Date(P.ini); x.setDate(x.getDate() + 7*(N-1) + OFFSET[d]); return x; }

// ---------- estado ----------
let P = null, SEM = null, atual = 0, semanaN = 1, assinatura = "", precisaRender = false;
let FILA = ler(K_FILA) || {};   // chave → operação ainda não confirmada pela planilha

const linhaReg = (N,k) => 1 + 13*(N-1) + (k-1);   // posição na leitura A5:O157 (k = 1 é o 1º exercício)
const nomeDaLinha = row => txt((row||[])[0]).split("\n")[0].trim();

// Treino repetido na semana (ex.: SEG A, TER B, QUI A, SEX B): a 2ª vez vai para a próxima aba Registro
// livre (sem treino na periodização e sem exercícios), na ordem DOM → SAB: QUI A → aba C, SEX B → aba D.
function abasDaSemana(){
  const usados = new Set(Object.values(P.periodo).filter(Boolean));
  const livres = ["A","B","C","D","E"].filter(L => !usados.has(L) && !(P.treinos[L]||[]).length);
  const vistos = new Set(), abas = {};
  SEMANA_JS.forEach(d => { const L = P.periodo[d]; if (!L) return; abas[d] = vistos.has(L) && livres.length ? livres.shift() : L; vistos.add(L); });
  return abas;
}

function montarDados(raw){
  P = lerTreino(raw.treino || []);
  P.videos = {}; (raw.videos||[]).forEach(r => { if (txt(r[0]) && /^https?:/.test(txt(r[1]))) P.videos[txt(r[0])] = txt(r[1]); });
  P.ini = data(P.inicio); P.fim = data(P.revisao, P.ini || undefined);
  P.abas = abasDaSemana();
  P.reg = {}; Object.keys(raw.reg||{}).forEach(L => { P.reg[L] = (raw.reg[L]||[]).map(r => r.slice()); });
  P.cardio = {}; (raw.cardio||[]).forEach(r => { const s = Number(r[0]), d = txt(r[1]); if (s && d) P.cardio[s+"|"+d] = {minutos: lerPlanilha(r[4]), bpm: lerPlanilha(r[5]), recado: txt(r[6])}; });
  // o que ainda está só no celular vale por cima do que veio da planilha
  Object.values(FILA).forEach(aplicarOp);
}
function aplicarOp(op){
  if (op.tipo === "treino"){
    const reg = P.reg[op.aba] || (P.reg[op.aba] = []);
    op.linhas.forEach((row,i) => { const k = linhaReg(op.semana, i+1); const atual = reg[k] || (reg[k] = []);
      for (let c = 0; c < 10; c++) atual[c+1] = row[c] === "" ? "" : fmt(row[c]);
      if (op.recados) atual[COL_RECADO] = op.recados[i] || ""; });
  } else if (op.tipo === "cardio"){
    P.cardio[op.semana+"|"+op.dia] = {minutos: op.minutos, bpm: op.bpm, recado: op.recado};
  }
}

// ---------- a semana ----------
function montarSemana(N, manterDia){
  semanaN = N; const faixa = P.faixas[N] || "";
  const aer = P.aerobicos.find(b => b.semanas.includes(N));
  const dias = [];
  ORDEM.forEach(d => {
    const L = P.periodo[d] || "", cardio = (aer && aer.dias[d]) || ""; if (!L && !cardio) return;
    const aba = P.abas[d] || L, reg = P.reg[aba] || [];
    const exs = (P.treinos[L]||[]).map((e,i) => {
      // séries da semana como a aba Registro mostra ("2 séries · 15 a 20 reps"): a semana regenerativa reduz
      const m = /(\d+)\s*s[ée]ries?\b/.exec(txt((reg[linhaReg(N,i+1)]||[])[0]));
      return {...e, series: Math.min(5, m ? +m[1] : e.series), video: P.videos[e.nome.trim()] || ""};
    });
    dias.push({dia: d, treino: L, aba, cardio, exercicios: exs});
  });
  SEM = {semana: N, faixa, dias};
  const hoje = SEMANA_JS[new Date().getDay()];
  if (!manterDia){ const i = dias.findIndex(d => d.dia === hoje); atual = i >= 0 && semanaDe(hojeZero()) === N ? i : Math.max(0, proximoDia(N)); }
  atual = Math.min(atual, Math.max(0, dias.length-1));
  $("semana").textContent = N;
  const ini = dataDoDia(N,"SEG"), fim = dataDoDia(N,"DOM");
  $("datas").textContent = ini ? ` ${dd(ini)}–${dd(fim)}` : "";
  $("faixa").textContent = faixa || "—"; $("regen").hidden = !/15\s*a\s*20/.test(faixa);
  $("desc").textContent = mmss(descanso(faixa));
  $("semAnt").disabled = N <= 1; $("semProx").disabled = N >= 12; $("envio").hidden = true;
  render();
}
function proximoDia(N){ // na semana de hoje, o próximo dia com treino; em outra semana, o primeiro
  if (!SEM) return 0; if (semanaDe(hojeZero()) !== N) return 0;
  const hoje = OFFSET[SEMANA_JS[new Date().getDay()]];
  const i = SEM.dias.findIndex(d => OFFSET[d.dia] > hoje); return i >= 0 ? i : 0;
}
function descanso(faixa){ const m = /(\d+)\s*a\s*\d+/.exec(faixa||""); if (!m) return 90; const n = +m[1]; return n >= 15 ? 40 : n >= 12 ? 60 : n >= 8 ? 90 : 120; }

// valores na memória (string já no formato da planilha) ----------
function celula(aba, N, k, c){ return ((P.reg[aba]||[])[linhaReg(N,k)]||[])[c]; }
function reps(d, k, s){ return lerPlanilha(celula(d.aba, semanaN, k, 2*s-1)); }
function kg(d, k, s){ return lerPlanilha(celula(d.aba, semanaN, k, 2*s)); }
function recadoEx(d, k){ return txt(celula(d.aba, semanaN, k, COL_RECADO)); }
function exOk(d, k, ex){ if (!ex.series) return false; for (let s = 1; s <= ex.series; s++) if (reps(d,k,s) === "") return false; return true; }
function diaFeito(n){ const d = SEM.dias[n]; if (!d) return false;
  if (d.exercicios.length) return d.exercicios.every((ex,i) => exOk(d,i+1,ex));
  const c = P.cardio[semanaN+"|"+d.dia]; return !!(c && c.minutos !== ""); }
function diaComAlgo(d){ return d.exercicios.some((ex,i) => { for (let s = 1; s <= ex.series; s++) if (reps(d,i+1,s) !== "") return true; return false; }); }

// histórico do exercício (qualquer treino, semanas antes de N) ----------
function historico(nome, N){
  const semanas = [];
  for (let w = 1; w < N; w++){
    const series = [];
    Object.keys(P.reg).forEach(L => { for (let k = 1; k <= 9; k++){ const row = (P.reg[L]||[])[linhaReg(w,k)]; if (!row || nomeDaLinha(row) !== nome.trim()) continue;
      for (let s = 0; s < 5; s++){ const r = lerPlanilha(row[1+2*s]), q = lerPlanilha(row[2+2*s]); if (r !== "" && r > 0) series.push({reps: r, kg: q === "" ? 0 : q, s}); } } });
    if (series.length) semanas.push({semana: w, series});
  }
  return semanas;
}
function anterior(nome, N){ const h = historico(nome, N); if (!h.length) return null;
  const u = h[h.length-1], porSerie = []; u.series.forEach(x => { if (porSerie[x.s] == null) porSerie[x.s] = x; });
  return {semana: u.semana, series: porSerie}; }
function recorde(d, k, ex){ // melhor marca desta semana contra todas as anteriores
  const h = historico(ex.nome, semanaN); if (!h.length) return null;
  const antes = h.flatMap(x => x.series), agora = [], ant = anterior(ex.nome, semanaN);
  for (let s = 1; s <= ex.series; s++){ const r = reps(d,k,s), q = kg(d,k,s), a = ant && ant.series[s-1];
    if (confere("kg", q, a ? {kg: a.kg, semana: ant.semana} : null) || confere("reps", r, null, SEM.faixa)) continue;   // número suspeito não vira recorde
    if (r !== "" && r > 0) agora.push({reps: r, kg: q === "" ? 0 : q}); }
  if (!agora.length) return null;
  const maxAntes = Math.max(...antes.map(x => x.kg)), maxAgora = Math.max(...agora.map(x => x.kg));
  if (maxAgora > maxAntes && maxAgora > 0){ const r = Math.max(...agora.filter(x => x.kg === maxAgora).map(x => x.reps));
    return {tipo: "carga", texto: `Recorde de carga: ${fmt(maxAgora)} kg × ${r} (antes ${fmt(maxAntes)} kg)`}; }
  let melhor = null;
  agora.forEach(x => { const ref = antes.filter(y => y.kg >= x.kg); const mr = ref.length ? Math.max(...ref.map(y => y.reps)) : 0;
    if (ref.length && x.reps > mr && (!melhor || x.kg > melhor.kg || (x.kg === melhor.kg && x.reps > melhor.reps))) melhor = {...x, antes: mr}; });
  if (melhor) return {tipo: "reps", texto: `Recorde de repetições: ${melhor.reps} com ${fmt(melhor.kg)} kg (antes ${melhor.antes})`};
  return null;
}
function confere(tipo, valor, ref, faixa){
  if (valor === "" || valor == null) return "";
  if (tipo === "kg"){
    if (ref && ref.kg > 0 && (valor >= ref.kg * 2.5 || valor <= ref.kg / 2.5)) return `Confere? Na semana ${ref.semana} foi ${fmt(ref.kg)} kg.`;
    if (!ref && valor > 300) return `Confere? ${fmt(valor)} kg.`;
  } else {
    const topo = Number(((faixa||"").match(/(\d+)\s*$/)||[])[1]) || 25;
    if (valor > Math.max(40, topo * 2)) return `Confere? ${valor} repetições.`;
  }
  return "";
}

// ---------- fila: tudo fica no celular até a planilha confirmar ----------
let timerEnvio = null, enviando = false, tentativas = 0, gravacoes = 0;
function opTreino(d){
  const linhas = d.exercicios.map((ex,i) => { const row = []; for (let s = 1; s <= 5; s++){
    row.push(s <= ex.series ? reps(d,i+1,s) : ""); row.push(s <= ex.series ? kg(d,i+1,s) : ""); } return row; });
  const recados = d.exercicios.map((ex,i) => recadoEx(d,i+1));
  return {tipo: "treino", aba: d.aba, semana: semanaN, linhas, recados};
}
function opCardio(d){
  const c = P.cardio[semanaN+"|"+d.dia] || {}; const dt = dataDoDia(semanaN, d.dia);
  return {tipo: "cardio", semana: semanaN, dia: d.dia, data: dt ? ddaaaa(dt) : "", prescrito: d.cardio, minutos: c.minutos ?? "", bpm: c.bpm ?? "", recado: c.recado || ""};
}
function enfileirar(op){
  const chave = op.tipo === "treino" ? `t|${op.aba}|${op.semana}` : `c|${op.semana}|${op.dia}`;
  op.v = Date.now() + Math.random(); op.chave = chave; FILA[chave] = op;
  const ok = guardar(K_FILA, FILA);
  mostrarStatus(ok ? "local" : "erro");
  clearTimeout(timerEnvio); timerEnvio = setTimeout(enviar, 1200);
}
async function enviar(){
  clearTimeout(timerEnvio);
  const ops = Object.values(FILA); if (!ops.length){ mostrarStatus(); return; }
  if (enviando){ timerEnvio = setTimeout(enviar, 800); return; }
  if (navigator.onLine === false){ mostrarStatus("offline"); return; }
  enviando = true; mostrarStatus("salvando");
  try {
    await chamar({acao: "lote", codigo: CODIGO, ops: ops.map(({v, chave, ...o}) => o)});
    ops.forEach(o => { if (FILA[o.chave] && FILA[o.chave].v === o.v) delete FILA[o.chave]; });
    guardar(K_FILA, FILA); tentativas = 0; gravacoes++; ultimaGravacao = new Date();
    mostrarStatus();
    if (Object.keys(FILA).length) timerEnvio = setTimeout(enviar, 300);
  } catch(e){
    tentativas++; mostrarStatus(e.servidor ? "erro-servidor" : "erro", e.message);
    timerEnvio = setTimeout(enviar, Math.min(60000, 4000 * tentativas));
  } finally { enviando = false; }
}
function enviarAoSair(){ // o aluno fechou o app: manda o que falta (a fila continua guardada até confirmar)
  const ops = Object.values(FILA); if (!ops.length || window.__API_MOCK || !navigator.sendBeacon) return;
  try { navigator.sendBeacon(API, new Blob([JSON.stringify({acao: "lote", codigo: CODIGO, ops: ops.map(({v, chave, ...o}) => o)})], {type: "text/plain"})); } catch(e){}
}
let ultimaGravacao = null;
function mostrarStatus(estado, detalhe){
  const s = $("status"); s.hidden = false; const n = Object.keys(FILA).length; s.onclick = null;
  if (!estado) estado = n ? "local" : "ok";
  const h = d => `${d.getHours()}:${String(d.getMinutes()).padStart(2,"0")}`;
  const textos = {
    ok: ultimaGravacao ? `Tudo salvo na sua planilha (${h(ultimaGravacao)})` : "Ligado à sua planilha",
    local: "Guardado no celular. Enviando para a planilha…",
    salvando: "Enviando para a planilha…",
    offline: `Sem internet: ${n} ${n === 1 ? "treino guardado" : "treinos guardados"} no celular. Envio sozinho quando a internet voltar.`,
    erro: "Não consegui enviar agora. Está guardado no celular; tento de novo sozinho. Toque para tentar já.",
    "erro-servidor": `A planilha não aceitou: ${detalhe || "erro"}. Está guardado no celular. Toque para tentar de novo.`,
    atualizando: "Atualizando o treino…",
    velho: "Sem internet: mostrando o treino guardado no celular."
  };
  s.textContent = textos[estado] || textos.ok;
  s.className = "status " + ({ok:"ok", local:"local", salvando:"salvando", offline:"local", erro:"erro", "erro-servidor":"erro", atualizando:"salvando", velho:"local"}[estado] || "");
  if (estado.startsWith("erro")) s.onclick = () => { tentativas = 0; enviar(); };
}

// ---------- tela ----------
function grupos(exs){ const tem = []; let i = 0;
  while (i < exs.length){ const t = exs[i].tecnica, tam = SEGUIDOS[t] || 1; let j = i;
    while (j < exs.length && j < i + tam && exs[j].tecnica === t) j++;
    for (let k = i; k < j; k++) tem[k] = (k === j-1); i = j; } return tem; }

function abasDias(){
  const nav = $("dias"); nav.innerHTML = ""; const hoje = SEMANA_JS[new Date().getDay()], estaSemana = semanaDe(hojeZero()) === semanaN;
  SEM.dias.forEach((d,n) => { const b = document.createElement("button"); b.type = "button";
    b.className = "dia" + (diaFeito(n) ? " feito" : "") + (estaSemana && d.dia === hoje ? " hoje" : "");
    b.setAttribute("role","tab"); b.setAttribute("aria-selected", n === atual);
    b.innerHTML = `<small>${estaSemana && d.dia === hoje ? "HOJE" : d.dia}</small><strong>${d.treino || "♥"}</strong>`;
    b.setAttribute("aria-label", `${NOMES[d.dia]}${d.treino ? ", treino " + d.treino : ", cardio"}`);
    b.onclick = () => { atual = n; render(); window.scrollTo({top: 0}); }; nav.appendChild(b); });
}
function campo(id, rot, val, ph, dec){
  return `<div class="campo"><input id="${id}" inputmode="${dec ? "decimal" : "numeric"}" enterkeyhint="next" autocomplete="off" value="${val === "" ? "" : fmt(val)}" placeholder="${esc(ph)}" aria-label="${rot}"><label for="${id}">${rot}</label></div>`;
}

function avisos(){
  const box = $("avisos"); let h = "";
  const hoje = hojeZero(), wHoje = semanaDe(hoje);
  if (P.ini && hoje < P.ini) h += card("Seu treino começa logo", `O ciclo começa na ${NOMES[SEMANA_JS[P.ini.getDay()]].toLowerCase()}, ${dd(P.ini)}. Já dá para ver os treinos.`);
  else if ((P.fim && hoje > P.fim) || wHoje > 12) h += card("Seu ciclo terminou", `${P.fim ? `A revisão era em ${dd(P.fim)}. ` : ""}Seu treinador está preparando o próximo treino. Enquanto isso, você ainda vê e anota as semanas deste ciclo.`);
  else if (SEM && semanaN === wHoje){
    const d = SEMANA_JS[hoje.getDay()], i = SEM.dias.findIndex(x => x.dia === d);
    if (i < 0){ const p = SEM.dias.find(x => OFFSET[x.dia] > OFFSET[d]);
      h += card("Hoje é dia de descanso", p ? `Próximo treino: ${NOMES[p.dia].toLowerCase()}${p.treino ? `, Treino ${p.treino}` : ", cardio"}.` : "Seu próximo treino é na semana que vem.", "ok"); }
    else if (diaFeito(i)) h += card("Treino de hoje feito ✓", "Tudo anotado. Bom descanso!", "ok");
  }
  h += cardInstalar();
  box.innerHTML = h;
  const bi = $("instalar"); if (bi) bi.onclick = instalarAndroid;
  const bn = $("naoInstalar"); if (bn) bn.onclick = () => { guardar("instalar-depois", Date.now()); avisos(); };
}
function card(t, p, cls){ return `<div class="aviso-card ${cls||""}"><h3>${esc(t)}</h3><p>${esc(p)}</p></div>`; }

let promptInstalar = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); promptInstalar = e; if (P) avisos(); });
function instalado(){ return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; }
function cardInstalar(){
  if (instalado()) return "";
  const depois = ler("instalar-depois"); if (depois && Date.now() - depois < 7*864e5) return "";
  const ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const safari = ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|Instagram|FBAN|FBAV|WhatsApp/.test(ua);
  let corpo;
  if (ios) corpo = safari
    ? `<ol class="passos"><li>Toque em <b>Compartilhar</b> (o quadrado com a seta ↑, embaixo).</li><li>Escolha <b>Adicionar à Tela de Início</b>.</li><li>Toque em <b>Adicionar</b>. Pronto: o app fica com a logo, como os outros.</li></ol>`
    : `<p>Abra este link no <b>Safari</b> (no WhatsApp: toque nos ⋯ ou no ícone da bússola e escolha abrir no Safari). Lá, toque em <b>Compartilhar</b> e em <b>Adicionar à Tela de Início</b>.</p>`;
  else if (promptInstalar) return `<div class="aviso-card"><h3>Coloque o app na tela do celular</h3><p>Fica com a logo, abre direto no seu treino e funciona mesmo sem sinal na academia.</p><div class="acoes"><button class="btn amarelo" type="button" id="instalar">Instalar o app</button><button class="btn" type="button" id="naoInstalar">Agora não</button></div></div>`;
  else corpo = `<ol class="passos"><li>Abra este link no <b>Chrome</b> (no WhatsApp: ⋮ › Abrir no Chrome).</li><li>Toque no menu <b>⋮</b> (em cima, à direita).</li><li>Escolha <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</li></ol>`;
  return `<div class="aviso-card"><h3>Coloque o app na tela do celular</h3><p>Fica com a logo, abre direto no seu treino e funciona mesmo sem sinal na academia.</p>
    <details class="como"><summary>Ver como</summary>${corpo}</details><div class="acoes"><button class="btn" type="button" id="naoInstalar">Agora não</button></div></div>`;
}
async function instalarAndroid(){ if (!promptInstalar) return; promptInstalar.prompt(); try { await promptInstalar.userChoice; } catch(e){} promptInstalar = null; avisos(); }

function render(){
  abasDias(); avisos();
  const n = atual, d = SEM.dias[n], tela = $("tela"), REST = descanso(SEM.faixa);
  if (!d){ tela.innerHTML = `<p class="vazio">Nenhum treino nesta semana.</p>`; return; }
  const dt = dataDoDia(semanaN, d.dia);
  let h = `<div class="tit-dia"><h2>${NOMES[d.dia]}${d.treino ? " · Treino " + d.treino : ""}</h2><span class="contagem" id="cont"></span></div>`;
  if (dt) h += `<p class="nota" style="margin:-8px 0 0">${ddaaaa(dt)}</p>`;
  const desc = grupos(d.exercicios), lo = (SEM.faixa||"").split(" a ")[0] || "0";
  d.exercicios.forEach((ex,i) => { const k = i+1, ant = anterior(ex.nome, semanaN); let s = "";
    for (let si = 1; si <= ex.series; si++){
      const a = ant && ant.series[si-1], r = reps(d,k,si), q = kg(d,k,si);
      s += `<div class="serie"><span>S${si}</span>${campo(`d${n}e${k}s${si}r`,"reps",r,lo)}${campo(`d${n}e${k}s${si}k`,"kg",q,a ? fmt(a.kg) : "0",true)}
        ${a ? `<div class="antes">Semana ${ant.semana}: ${a.reps} reps × ${fmt(a.kg)} kg</div>` : ""}
        <div class="confere" id="cf-${n}-${k}-${si}">${esc(confere("kg", q, a ? {kg: a.kg, semana: ant.semana} : null) || confere("reps", r, null, SEM.faixa))}</div></div>`;
    }
    const rec = recorde(d,k,ex), msg = recadoEx(d,k);
    h += `<article class="ex${exOk(d,k,ex) ? " ok" : ""}" id="ex-${n}-${k}">
      <div class="ex-top"><span class="num">${k}</span><div class="ex-nome"><h3>${esc(ex.nome)}</h3><p>${ex.series} ${ex.series === 1 ? "série" : "séries"} · ${esc(SEM.faixa)} reps</p>${ex.tecnica ? `<span class="tec">${esc(ex.tecnica)}</span>` : ""}</div></div>
      ${ex.obs ? `<div class="obs">${esc(ex.obs)}</div>` : ""}
      <div class="recorde" id="rec-${n}-${k}" ${rec ? "" : "hidden"}>🏆 ${rec ? esc(rec.texto) : ""}</div>
      <div class="series">${s}</div>
      <div class="recado" id="rc-${n}-${k}" ${msg ? "" : "hidden"}><textarea id="m-${n}-${k}" maxlength="300" placeholder="Ex.: máquina ocupada, troquei pelo halter; senti o ombro na 3ª série">${esc(msg)}</textarea><small>O seu treinador vê este recado na sua planilha.</small></div>
      <div class="acoes">
        ${ant ? `<button class="btn" type="button" data-repetir="${k}">Mesma carga da semana ${ant.semana}</button>` : ""}
        ${desc[i] ? `<button class="btn amarelo" type="button" data-desc="${esc(ex.nome)}">Descanso ${mmss(REST)}</button>` : `<span class="nota">Sem descanso: vá direto para o próximo.</span>`}
        ${ex.video ? `<a class="btn" href="${esc(ex.video)}" target="_blank" rel="noopener">▶ Vídeo</a>` : ""}
        <button class="btn${msg ? " tem" : ""}" type="button" data-recado="${k}">${msg ? "✎ Recado" : "✎ Recado para o treinador"}</button>
      </div></article>`; });
  if (d.cardio){ const c = P.cardio[semanaN+"|"+d.dia] || {};
    h += `<div class="ex" id="cardio"><div class="ex-top"><span class="num">♥</span><div class="ex-nome"><h3>Aeróbico</h3><p>${esc(d.cardio)}</p></div></div>
      <div class="cardio">${campo(`c${n}min`,"min",c.minutos ?? "","0")}${campo(`c${n}bpm`,"bpm",c.bpm ?? "","0")}</div>
      <div class="recado" id="rc-${n}-c" ${c.recado ? "" : "hidden"}><textarea id="m-${n}-c" maxlength="300" placeholder="Ex.: fiz na esteira; não consegui manter a média">${esc(c.recado || "")}</textarea><small>O seu treinador vê este recado na sua planilha.</small></div>
      <div class="acoes"><button class="btn${c.recado ? " tem" : ""}" type="button" data-recado="c">${c.recado ? "✎ Recado" : "✎ Recado para o treinador"}</button></div></div>`; }
  h += `<button class="grande sec" type="button" id="enviar">Ver registro da semana</button>`;
  tela.innerHTML = h; contagem();

  tela.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("input", () => digitou(inp));
    inp.addEventListener("keydown", e => { if (e.key === "Enter"){ e.preventDefault(); const todos = [...tela.querySelectorAll("input")]; const p = todos[todos.indexOf(inp)+1]; p ? p.focus() : inp.blur(); } });
    inp.addEventListener("blur", () => { if (precisaRender) setTimeout(() => { if (!document.activeElement || document.activeElement.tagName !== "INPUT") { precisaRender = false; montarSemana(semanaN, true); } }, 50); });
  });
  tela.querySelectorAll("textarea").forEach(t => t.addEventListener("input", () => escreveuRecado(t)));
  tela.querySelectorAll("[data-repetir]").forEach(b => b.onclick = () => { const k = +b.dataset.repetir, ex = d.exercicios[k-1], ant = anterior(ex.nome, semanaN);
    (ant ? ant.series : []).forEach((a,si) => { if (!a || si >= ex.series) return; const el = $(`d${n}e${k}s${si+1}k`); if (el && el.value === ""){ el.value = fmt(a.kg); digitou(el); } }); });
  tela.querySelectorAll("[data-desc]").forEach(b => b.onclick = () => iniciar(b.dataset.desc));
  tela.querySelectorAll("[data-recado]").forEach(b => b.onclick = () => { const k = b.dataset.recado, box = $(`rc-${n}-${k}`); box.hidden = !box.hidden; if (!box.hidden) $(`m-${n}-${k}`).focus(); });
  $("enviar").onclick = mostrarRegistro;
}

function digitou(inp){
  const n = atual, d = SEM.dias[n];
  const m = /^d(\d+)e(\d+)s(\d+)([rk])$/.exec(inp.id), c = /^c(\d+)(min|bpm)$/.exec(inp.id);
  const val = lerDigitado(inp.value);
  if (m){
    const k = +m[2], s = +m[3], ex = d.exercicios[k-1], reg = P.reg[d.aba] || (P.reg[d.aba] = []);
    const row = reg[linhaReg(semanaN,k)] || (reg[linhaReg(semanaN,k)] = [ex.nome]);
    const v = m[4] === "r" ? (val === "" ? "" : Math.round(val)) : val;
    row[m[4] === "r" ? 2*s-1 : 2*s] = v === "" ? "" : fmt(v);
    $(`ex-${n}-${k}`).classList.toggle("ok", exOk(d,k,ex));
    const ant = anterior(ex.nome, semanaN), a = ant && ant.series[s-1];
    $(`cf-${n}-${k}-${s}`).textContent = confere("kg", kg(d,k,s), a ? {kg: a.kg, semana: ant.semana} : null) || confere("reps", reps(d,k,s), null, SEM.faixa);
    const antes = $(`rec-${n}-${k}`).hidden, rec = recorde(d,k,ex);
    $(`rec-${n}-${k}`).hidden = !rec; $(`rec-${n}-${k}`).textContent = rec ? "🏆 " + rec.texto : "";
    if (rec && antes){ aviso("🏆 " + rec.texto); try { navigator.vibrate && navigator.vibrate(60); } catch(e){} }
    enfileirar(opTreino(d));
  }
  if (c){ const ch = semanaN+"|"+d.dia; const o = P.cardio[ch] || (P.cardio[ch] = {minutos:"", bpm:"", recado:""});
    o[c[2] === "min" ? "minutos" : "bpm"] = val === "" ? "" : Math.round(val); enfileirar(opCardio(d)); }
  contagem(); abasDias();
}
function escreveuRecado(t){
  const n = atual, d = SEM.dias[n], m = /^m-(\d+)-(\w+)$/.exec(t.id); if (!m) return;
  if (m[2] === "c"){ const ch = semanaN+"|"+d.dia; const o = P.cardio[ch] || (P.cardio[ch] = {minutos:"", bpm:"", recado:""}); o.recado = t.value; enfileirar(opCardio(d)); return; }
  const k = +m[2], ex = d.exercicios[k-1], reg = P.reg[d.aba] || (P.reg[d.aba] = []);
  const row = reg[linhaReg(semanaN,k)] || (reg[linhaReg(semanaN,k)] = [ex.nome]); row[COL_RECADO] = t.value;
  const b = document.querySelector(`[data-recado="${k}"]`); if (b){ b.classList.toggle("tem", !!t.value.trim()); }
  enfileirar(opTreino(d));
}
function contagem(){ const d = SEM.dias[atual], el = $("cont"); if (!el) return; if (!d.exercicios.length){ el.textContent = ""; return; }
  el.textContent = `${d.exercicios.filter((ex,i) => exOk(d,i+1,ex)).length} de ${d.exercicios.length} feitos`; }
let toastT = null;
function aviso(t){ const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 3500); }
$("semAnt").onclick = () => { if (semanaN > 1) montarSemana(semanaN-1); };
$("semProx").onclick = () => { if (semanaN < 12) montarSemana(semanaN+1); };

// ---------- cronômetro de descanso (a tela não apaga enquanto ele corre) ----------
let fim = 0, tick = null, ctx = null, trava = null; const T = $("timer");
async function manterTela(on){
  try {
    if (on && "wakeLock" in navigator && !trava){ trava = await navigator.wakeLock.request("screen"); trava.addEventListener("release", () => { trava = null; }); }
    if (!on && trava){ await trava.release(); trava = null; }
  } catch(e){ trava = null; }
}
function bip(){
  try { ctx ||= new (window.AudioContext || window.webkitAudioContext)(); const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = .15; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + .35); } catch(e){}
  try { navigator.vibrate && navigator.vibrate([200,100,200]); } catch(e){}
}
function iniciar(rot){
  try { ctx ||= new (window.AudioContext || window.webkitAudioContext)(); ctx.resume && ctx.resume(); } catch(e){}
  fim = Date.now() + descanso(SEM.faixa)*1000; T.hidden = false; T.classList.remove("fim"); $("trotulo").textContent = "Descanso · " + rot;
  clearInterval(tick); tick = setInterval(passo, 250); passo(); manterTela(true);
}
function passo(){ const s = Math.max(0, Math.ceil((fim - Date.now())/1000)); $("tempo").textContent = mmss(s);
  if (s === 0){ clearInterval(tick); tick = null; T.classList.add("fim"); $("trotulo").textContent = "Bora, próxima série!"; bip(); setTimeout(() => { if (!tick) manterTela(false); }, 60000); } }
$("mais").onclick = () => { fim = Math.max(fim, Date.now()) + 15000; T.classList.remove("fim"); clearInterval(tick); tick = setInterval(passo, 250); passo(); manterTela(true); };
$("parar").onclick = () => { clearInterval(tick); tick = null; T.hidden = true; manterTela(false); };

function mostrarRegistro(){
  let t = `${P.nome} · Semana ${SEM.semana} (${SEM.faixa} reps)\n`;
  SEM.dias.forEach(d => { t += `\n${NOMES[d.dia]}${d.treino ? " · Treino " + d.treino : ""}\n`;
    d.exercicios.forEach((ex,i) => { const k = i+1, ss = []; for (let s = 1; s <= ex.series; s++){ const r = reps(d,k,s), q = kg(d,k,s); ss.push(r !== "" ? `${r}×${fmt(q || 0)}kg` : "-"); }
      t += `  ${ex.nome.trim()}: ${ss.join("  ")}\n`; const m = recadoEx(d,k); if (m) t += `    Recado: ${m}\n`; });
    if (d.cardio){ const c = P.cardio[SEM.semana+"|"+d.dia] || {}; t += `  Aeróbico: ${c.minutos !== "" && c.minutos != null ? c.minutos : "-"} min, ${c.bpm !== "" && c.bpm != null ? c.bpm : "-"} bpm (pedido: ${d.cardio})\n`; if (c.recado) t += `    Recado: ${c.recado}\n`; } });
  $("envio").hidden = false; $("texto").textContent = t; $("envio").scrollIntoView({behavior: "smooth"});
}
$("copiar").onclick = async e => { try { await navigator.clipboard.writeText($("texto").textContent); e.target.textContent = "Copiado"; }
  catch(err){ const r = document.createRange(); r.selectNodeContents($("texto")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); e.target.textContent = "Texto selecionado: copie"; } };

// ---------- abrir ----------
function erroTela(titulo, texto, botao){
  $("tela").innerHTML = `<div class="msg"><h2>${esc(titulo)}</h2><p>${esc(texto)}</p>${botao ? `<button class="btn amarelo" type="button" id="tentar">${esc(botao)}</button>` : ""}</div>`;
  if (botao) $("tentar").onclick = () => { $("tela").innerHTML = `<p class="carregando">Abrindo o seu treino…</p>`; atualizar(); };
}
function mostrar(raw, primeira){
  montarDados(raw);
  $("nome").textContent = "Olá, " + ((P.nome || "").split(" ")[0] || "aluno");
  $("meta").hidden = false; $("dias").hidden = false;
  const w = Math.min(12, Math.max(1, semanaDe(hojeZero())));
  montarSemana(primeira ? w : semanaN, !primeira);
}
async function atualizar(){
  const guardado = ler(K_DADOS);
  if (guardado && !P){ mostrar(guardado.raw, true); mostrarStatus(navigator.onLine === false ? "velho" : "atualizando"); }
  const g0 = gravacoes;
  try {
    const raw = await chamar({acao: "dados", codigo: CODIGO});
    // gravou algo enquanto lia? a leitura pode estar sem a última gravação: lê de novo
    if (gravacoes !== g0 && P){ setTimeout(atualizar, 500); return; }
    const nova = JSON.stringify([raw.treino, raw.videos, raw.reg, raw.cardio]);
    guardar(K_DADOS, {raw, em: Date.now()});
    if (!P) mostrar(raw, true);
    else if (nova !== assinatura){ const foco = document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
      if (foco){ montarDados(raw); precisaRender = true; } else mostrar(raw, false); }
    assinatura = nova; mostrarStatus(Object.keys(FILA).length ? "local" : "ok");
    enviar();
  } catch(e){
    if (P){ mostrarStatus(Object.keys(FILA).length ? "offline" : "velho"); return; }
    if (e.servidor && /link/i.test(e.message)) erroTela("Este link não está ativo", "Fale com o seu treinador para receber o link certo.");
    else if (e.servidor) erroTela("Não consegui abrir o seu treino", e.message, "Tentar de novo");
    else erroTela("Sem internet", "Na primeira vez, o app precisa de internet para baixar o seu treino. Depois ele abre mesmo sem sinal.", "Tentar de novo");
  }
}

window.addEventListener("online", () => { tentativas = 0; enviar(); });
window.addEventListener("offline", () => mostrarStatus(Object.keys(FILA).length ? "offline" : "velho"));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") enviarAoSair();
  else { if (tick) manterTela(true); if (P) atualizar(); }
});
window.addEventListener("pagehide", enviarAoSair);

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost") && !window.__API_MOCK)
  navigator.serviceWorker.register("sw.js").catch(() => {});

if (!CODIGO) erroTela("Abra pelo seu link", "Use o link que o seu treinador mandou no WhatsApp. Ele já abre direto no seu treino.");
else atualizar();
