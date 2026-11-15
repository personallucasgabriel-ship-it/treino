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
const COL_RECADO = 14;   // coluna O das abas Registro (leitura A5:P157)
const COL_DICA = 15;     // coluna P: dica do treinador (escrita pelo app do treinador)
const COL_PSE = 15;      // colunas Q a U: PSE (0 a 10) de cada série; série s na coluna COL_PSE + s (desde 13/11/2026)
const PSE_DESDE = 6;     // versão do servidor (Codigo.gs) que grava a PSE; antes dela os campos não aparecem
const FORM_FOTOS = "https://forms.gle/Jc9hwKyR9xHa6WP17";
// Cardio da semana: qualquer texto que não seja o do modelo da planilha ("min, manter uma média de bpm")
const cardioValido = t => !!t && (/\d/.test(t) || !/^min,?\s*manter uma m[ée]dia de\s*bpm\.?$/i.test(t.replace(/\s+/g, " ").trim()));

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
        if (NOMES[d] && cardioValido(t)) dias[d] = t.replace(/(\d+)\s*min/i,"$1 min").replace(/\s*em um[a]?\s*/i,", ").replace(/media/i,"média").replace(/(\d+)\s*bpm/i,"$1 bpm"); }
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
  P.fotosEm = raw.fotos_em ? new Date(raw.fotos_em + "T12:00:00") : null;
  P.versao = Number(raw.versao) || 0;
  P.plano = raw.plano || null; P.dieta = !!raw.dieta;   // servidor versão 15: aviso de renovação e sugestão alimentar
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
      if (op.recados) atual[COL_RECADO] = op.recados[i] || "";
      if (op.pse) for (let s = 1; s <= 5; s++){ const v = (op.pse[i]||[])[s-1]; atual[COL_PSE+s] = v === "" || v == null ? "" : String(v); } });
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
// PSE (percepção subjetiva de esforço) de cada série, de 0 a 10 (pedido de 13/11/2026, no lugar das "reps que sobravam"
// só na última série). Escala só de esforço, sem repetições na reserva (pedido do criador): a CR-10 modificada por
// Foster e cols. 2001 (0 repouso, 1 muito, muito fácil, 2 fácil, 3 moderado, 4 um pouco difícil, 5 difícil, 7 muito difícil,
// 10 máximo; 6, 8 e 9 sem nome; tabela em Haddad e cols. 2017, doi:10.3389/fnins.2017.00612), usada série a série
// no treino de força por Day e cols. 2004 (doi:10.1519/R-13113.1).
const comPse = () => (P && P.versao || 0) >= PSE_DESDE;
function pse(d, k, s){ const v = lerPlanilha(celula(d.aba, semanaN, k, COL_PSE + s)); return v === "" || v < 0 || v > 10 ? "" : v; }
// ---------- escala de PSE: toque no campo PSE e escolha o número (pedido de 13/11/2026) ----------
// Faixas do criador: 0 a 2 fácil, 3 a 6 médio, 7 a 10 muito difícil; a cor fica mais forte até o 10.
const PSE_FAIXAS = [["Fácil", [0,1,2], "#79D198"], ["Médio", [3,4,5,6], "#FFD60A"], ["Muito difícil", [7,8,9,10], "#FF7A45"]];
const PSE_COR = ["#D3F2DC","#A8E4BB","#79D198","#FFF0A6","#FFE45C","#FFD60A","#FFB224","#FF8A3D","#F4612F","#DD3A2C","#B3201C"];
const corPse = v => ({fundo: PSE_COR[v], texto: v >= 9 ? "#FAFAFA" : "#0B0B0B"});
function conteudoPse(v){
  if (v === "" || v == null) return `<span class="pse-vazio">–</span><span class="rot">PSE</span>`;
  const c = corPse(v); return `<span class="pse-n" style="background:${c.fundo};color:${c.texto}">${v}</span><span class="rot">PSE</span>`;
}
function botaoPse(id, k, s, v){
  return `<button type="button" class="campo pse-campo" id="${id}" data-pse-k="${k}" data-pse-s="${s}" aria-haspopup="dialog" aria-label="PSE da série ${s}${v === "" ? "" : ": " + v}">${conteudoPse(v)}</button>`;
}
function pintarPse(btn, s, v){ btn.innerHTML = conteudoPse(v); btn.setAttribute("aria-label", `PSE da série ${s}${v === "" ? "" : ": " + v}`); }
function fecharPse(){ const f = $("pseFundo"); if (f) f.remove(); }
function abrirPse(pergunta, detalhe, atualV, escolher, origem){
  fecharPse();
  const fundo = document.createElement("div"); fundo.className = "pse-fundo"; fundo.id = "pseFundo";
  fundo.innerHTML = `<div class="pse-folha" role="dialog" aria-modal="true" aria-labelledby="pseTit">
    <div class="pse-topo"><div><h3 id="pseTit">${esc(pergunta)}</h3><p>${esc(detalhe)}</p></div><button type="button" class="pse-x" aria-label="Fechar">✕</button></div>
    ${PSE_FAIXAS.map(([nome, nums, cor]) => `<div class="pse-faixa"><span style="color:${cor}">${nome}</span><div class="pse-nums">${nums.map(v => { const c = corPse(v);
      return `<button type="button" data-v="${v}" aria-pressed="${atualV === v}" aria-label="${v}, ${nome.toLowerCase()}" style="background:${c.fundo};color:${c.texto}">${v}</button>`; }).join("")}</div></div>`).join("")}
    ${atualV !== "" && atualV != null ? `<button type="button" class="btn pse-apagar">Apagar</button>` : ""}</div>`;
  document.body.appendChild(fundo);
  const fechar = () => { fecharPse(); if (origem && document.body.contains(origem)) origem.focus(); };
  fundo.onclick = e => { if (e.target === fundo) fechar(); };
  fundo.querySelector(".pse-x").onclick = fechar;
  fundo.querySelectorAll("[data-v]").forEach(b => b.onclick = () => { escolher(+b.dataset.v); fechar(); });
  const ap = fundo.querySelector(".pse-apagar"); if (ap) ap.onclick = () => { escolher(""); fechar(); };
  fundo.addEventListener("keydown", e => { if (e.key === "Escape") fechar(); });
  (fundo.querySelector('[aria-pressed="true"]') || fundo.querySelector("[data-v]")).focus({preventScroll: true});
}
function diaComAlgo(d){ return d.exercicios.some((ex,i) => { for (let s = 1; s <= ex.series; s++) if (reps(d,i+1,s) !== "") return true; return false; }); }

// histórico do exercício (qualquer treino, semanas antes de N) ----------
function historico(nome, N){
  const semanas = [];
  for (let w = 1; w < N; w++){
    const series = [];
    Object.keys(P.reg).forEach(L => { for (let k = 1; k <= 9; k++){ const row = (P.reg[L]||[])[linhaReg(w,k)]; if (!row || nomeDaLinha(row) !== nome.trim()) continue;
      for (let s = 0; s < 5; s++){ const r = lerPlanilha(row[1+2*s]), q = lerPlanilha(row[2+2*s]), p = lerPlanilha(row[COL_PSE+1+s]);
        if (r !== "" && r > 0) series.push({reps: r, kg: q === "" ? 0 : q, s, pse: p !== "" && p >= 0 && p <= 10 ? p : ""}); } } });
    if (series.length) semanas.push({semana: w, series});
  }
  return semanas;
}
function anterior(nome, N){ const h = historico(nome, N); if (!h.length) return null;
  const u = h[h.length-1], porSerie = []; u.series.forEach(x => { if (porSerie[x.s] == null) porSerie[x.s] = x; });
  return {semana: u.semana, series: porSerie}; }
function recorde(d, k, ex){ // melhor marca desta semana contra todas as anteriores (regra em recordeDe)
  const h = historico(ex.nome, semanaN); if (!h.length) return null;
  const antes = h.flatMap(x => x.series), agora = [], ant = anterior(ex.nome, semanaN);
  for (let s = 1; s <= ex.series; s++){ const r = reps(d,k,s), q = kg(d,k,s), a = ant && ant.series[s-1];
    if (confere("kg", q, a ? {kg: a.kg, semana: ant.semana} : null) || confere("reps", r, null, SEM.faixa)) continue;   // número suspeito não vira recorde
    if (r !== "" && r > 0) agora.push({reps: r, kg: q === "" ? 0 : q}); }
  const rec = recordeDe(agora, antes);
  return rec ? {tipo: rec.tipo, texto: textoRecorde(rec)} : null;
}
// Recordes: a mesma regra no app do treinador, no servidor (Treinador.gs) e no relatório (historico.py).
// 1) Força: com séries de até 10 repetições (a estimativa só vale até 10), a força estimada da melhor série
//    (Epley: kg × (1 + reps/30)) passa a melhor de antes.
// 2) Sem isso: uma série que nenhuma de antes igualou (carga e reps iguais ou maiores) e que supera alguma de antes.
function recordeDe(agora, antes){
  agora = agora.filter(x => x.reps > 0); antes = antes.filter(x => x.reps > 0);
  if (!agora.length || !antes.length) return null;
  const e1 = x => x.kg * (1 + x.reps / 30);
  const a10 = agora.filter(x => x.kg > 0 && x.reps <= 10), p10 = antes.filter(x => x.kg > 0 && x.reps <= 10);
  if (a10.length && p10.length){
    const m = a10.reduce((b,x) => e1(x) > e1(b) ? x : b), pm = Math.max(...p10.map(e1));
    if (e1(m) > pm + 1e-9) return {tipo: "forca", kg: m.kg, reps: m.reps, e1: e1(m), antes: pm};
  }
  let melhor = null;
  agora.forEach(x => {
    if (antes.some(p => p.kg >= x.kg && p.reps >= x.reps)) return;
    if (!antes.some(p => x.kg >= p.kg && x.reps >= p.reps)) return;
    if (!melhor || x.kg > melhor.kg || (x.kg === melhor.kg && x.reps > melhor.reps)) melhor = x;
  });
  if (!melhor) return null;
  const pmax = Math.max(...antes.map(p => p.kg));
  if (melhor.kg > pmax) return {tipo: "carga", kg: melhor.kg, reps: melhor.reps, antes: pmax};
  const ref = antes.filter(p => p.kg >= melhor.kg).reduce((b,p) => p.reps > b.reps ? p : b);
  return {tipo: "reps", kg: melhor.kg, reps: melhor.reps, antes: ref.reps, antesKg: ref.kg};
}
function textoRecorde(r){
  const f1 = n => String(Math.round(n * 10) / 10).replace(".", ",");
  if (r.tipo === "forca") return `Recorde de força: ${fmt(r.kg)} kg × ${r.reps} (força estimada ${f1(r.e1)} kg; antes ${f1(r.antes)} kg)`;
  if (r.tipo === "carga") return `Recorde de carga: ${fmt(r.kg)} kg × ${r.reps} (antes ${fmt(r.antes)} kg)`;
  if (r.kg > 0) return `Recorde de repetições: ${r.reps} com ${fmt(r.kg)} kg (antes ${r.antes}${r.antesKg !== r.kg ? ` com ${fmt(r.antesKg)} kg` : ""})`;
  return `Recorde de repetições: ${r.reps} (antes ${r.antes})`;
}
// dica do treinador: a desta semana ou, se não tiver, a mais recente de antes no mesmo exercício
function dicaEx(d, k, nome){
  const aqui = txt(celula(d.aba, semanaN, k, COL_DICA)); if (aqui) return {texto: aqui, semana: semanaN};
  for (let w = semanaN - 1; w >= 1; w--) for (const L of Object.keys(P.reg)) for (let j = 1; j <= 9; j++){
    const row = (P.reg[L]||[])[linhaReg(w,j)]; if (row && nomeDaLinha(row) === nome.trim() && txt(row[COL_DICA])) return {texto: txt(row[COL_DICA]), semana: w}; }
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
  const op = {tipo: "treino", aba: d.aba, semana: semanaN, linhas, recados};
  if (comPse()) op.pse = d.exercicios.map((ex,i) => { const r = []; for (let s = 1; s <= 5; s++) r.push(s <= ex.series ? pse(d,i+1,s) : ""); return r; });
  return op;
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
  h = cardRecadoTreinador() + h + cardRenovar(hoje) + cardFotos(hoje, wHoje) + cardFimCiclo(hoje);
  const inst = cardInstalar(); h += inst + (inst ? "" : cardAtivarAvisos());   // um pedido de cada vez
  box.innerHTML = h;
  ligarCardsAvisos();
  const nr = $("naoRenovar"); if (nr) nr.onclick = () => { guardar("renovar-depois:" + CODIGO, Date.now()); avisos(); };
  checarConquistas();
  const bi = $("instalar"); if (bi) bi.onclick = instalarAndroid;
  const bn = $("naoInstalar"); if (bn) bn.onclick = () => { guardar("instalar-depois", Date.now()); avisos(); };
}
// semanas 4, 8, 12 e a última do ciclo: de quinta a domingo, o lembrete das fotos (some quando o formulário chega)
function cardFotos(hoje, w){
  if (!P.ini || w < 1) return "";
  const total = P.fim ? Math.max(1, Math.ceil((P.fim - P.ini) / (7*864e5))) : 12;
  if (!(w % 4 === 0 || w === total) || w > total) return "";
  const qui = dataDoDia(w, "QUI"), dom = dataDoDia(w, "DOM");
  if (hoje < qui || hoje > dom) return "";
  if (P.fotosEm && P.fotosEm >= new Date(qui.getTime() - 3*864e5)) return "";
  return `<div class="aviso-card"><h3>Hora das fotos de avaliação 📸</h3><p>É pelo mesmo formulário: as 4 fotos (frente, lado direito, lado esquerdo e costas) e o feedback do mês, que leva uns 2 minutinhos. Mesmo lugar, mesma luz e mesmo horário das outras vezes.</p><p>Mande até sábado: no domingo chega o seu relatório de evolução 📈</p>
    <div class="acoes"><a class="btn amarelo" href="${FORM_FOTOS}" target="_blank" rel="noopener">Enviar as fotos</a><a class="btn" href="guia-fotos.pdf" target="_blank" rel="noopener">Como tirar as fotos</a></div></div>`;
}
function cardFimCiclo(hoje){
  if (!P.fim || hoje > P.fim) return "";
  const n = Math.round((P.fim - hoje) / 864e5); if (n > 7) return "";
  return card(n === 0 ? "Seu ciclo termina hoje" : `Seu ciclo termina em ${n} ${n === 1 ? "dia" : "dias"}`,
    `A revisão é em ${dd(P.fim)}. Continue anotando: o seu treinador usa tudo isso para montar o próximo treino.`);
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
  const desc = grupos(d.exercicios), lo = (SEM.faixa||"").split(" a ")[0] || "0", cp = comPse();
  d.exercicios.forEach((ex,i) => { const k = i+1, ant = anterior(ex.nome, semanaN); let s = "";
    for (let si = 1; si <= ex.series; si++){
      const a = ant && ant.series[si-1], r = reps(d,k,si), q = kg(d,k,si);
      s += `<div class="serie${cp ? " pse" : ""}"><span>S${si}</span>${campo(`d${n}e${k}s${si}r`,"reps",r,lo)}${campo(`d${n}e${k}s${si}k`,"kg",q,a ? fmt(a.kg) : "0",true)}${cp ? botaoPse(`d${n}e${k}s${si}p`, k, si, pse(d,k,si)) : ""}
        ${a ? `<div class="antes">Semana ${ant.semana}: ${a.reps} reps × ${fmt(a.kg)} kg${cp && a.pse !== "" ? ` · PSE ${fmt(a.pse)}` : ""}</div>` : ""}
        <div class="confere" id="cf-${n}-${k}-${si}">${esc(confere("kg", q, a ? {kg: a.kg, semana: ant.semana} : null) || confere("reps", r, null, SEM.faixa))}</div></div>`;
    }
    const rec = recorde(d,k,ex), msg = recadoEx(d,k), dica = dicaEx(d,k,ex.nome);
    h += `<article class="ex${exOk(d,k,ex) ? " ok" : ""}" id="ex-${n}-${k}">
      <div class="ex-top"><span class="num">${k}</span><div class="ex-nome"><h3>${esc(ex.nome)}</h3><p>${ex.series} ${ex.series === 1 ? "série" : "séries"} · ${esc(SEM.faixa)} reps</p>${ex.tecnica ? `<span class="tec">${esc(ex.tecnica)}</span>` : ""}</div></div>
      ${ex.obs ? `<div class="obs">${esc(ex.obs)}</div>` : ""}
      ${dica ? `<div class="dica"><b>Dica do treinador${dica.semana !== semanaN ? ` (semana ${dica.semana})` : ""}:</b> ${esc(dica.texto)}</div>` : ""}
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
  if (d.exercicios.length) h += `<button class="grande" type="button" id="story"><svg class="ig" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.3" cy="6.7" r="1.2" fill="currentColor"/></svg> Compartilhar no story</button>`;
  h += `<button class="grande sec" type="button" id="enviar">Ver registro da semana</button>`;
  h += blocoAgenda();
  tela.innerHTML = h; contagem();
  ligarAgenda();
  if ($("story")) $("story").onclick = () => compartilharStory(d);

  tela.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("input", () => digitou(inp));
    inp.addEventListener("keydown", e => { if (e.key === "Enter"){ e.preventDefault(); const todos = [...tela.querySelectorAll("input")]; const p = todos[todos.indexOf(inp)+1]; p ? p.focus() : inp.blur(); } });
    inp.addEventListener("blur", () => { if (precisaRender) setTimeout(() => { if (!document.activeElement || document.activeElement.tagName !== "INPUT") { precisaRender = false; montarSemana(semanaN, true); } }, 50); });
  });
  tela.querySelectorAll("textarea").forEach(t => t.addEventListener("input", () => escreveuRecado(t)));
  tela.querySelectorAll("[data-pse-k]").forEach(b => b.onclick = () => {
    const k = +b.dataset.pseK, s = +b.dataset.pseS, ex = d.exercicios[k-1];
    abrirPse("Quanto você se esforçou?", `${ex.nome.trim()} · série ${s}`, pse(d,k,s), v => {
      const reg = P.reg[d.aba] || (P.reg[d.aba] = []), row = reg[linhaReg(semanaN,k)] || (reg[linhaReg(semanaN,k)] = [ex.nome]);
      row[COL_PSE+s] = v === "" ? "" : String(v); pintarPse(b, s, v); enfileirar(opTreino(d));
    }, b);
  });
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
    $(`cf-${n}-${k}-${s}`).textContent = confereSerie(d,n,k,s);
    const antes = $(`rec-${n}-${k}`).hidden, rec = recorde(d,k,ex);
    $(`rec-${n}-${k}`).hidden = !rec; $(`rec-${n}-${k}`).textContent = rec ? "🏆 " + rec.texto : "";
    if (rec && antes){ aviso("🏆 " + rec.texto); try { navigator.vibrate && navigator.vibrate(60); } catch(e){} }
    enfileirar(opTreino(d));
  }
  if (c){ const ch = semanaN+"|"+d.dia; const o = P.cardio[ch] || (P.cardio[ch] = {minutos:"", bpm:"", recado:""});
    o[c[2] === "min" ? "minutos" : "bpm"] = val === "" ? "" : Math.round(val); enfileirar(opCardio(d)); }
  contagem(); abasDias();
}
function confereSerie(d, n, k, s){
  const ex = d.exercicios[k-1], ant = anterior(ex.nome, semanaN), a = ant && ant.series[s-1];
  return confere("kg", kg(d,k,s), a ? {kg: a.kg, semana: ant.semana} : null) || confere("reps", reps(d,k,s), null, SEM.faixa);
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

// ---------- figurinha para o story (PNG sem fundo, para colar em cima da foto do aluno) ----------
// No iPhone o compartilhamento só abre se for chamado direto pelo toque. Por isso as imagens ficam prontas
// antes, numa janela com as opções, e os botões "Copiar" e "Compartilhar" usam a imagem já pronta.
const BOTAO_STORY = '<svg class="ig" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.3" cy="6.7" r="1.2" fill="currentColor"/></svg> Compartilhar no story';
async function compartilharStory(d){
  const b = $("story"); b.disabled = true; b.textContent = "Montando as figurinhas…";
  try {
    const ops = await figurinhas(d);
    if (!ops.length) throw new Error("vazio");
    mostrarFigurinhas(ops, d);
  } catch(e){ aviso("Não consegui montar a imagem agora."); }
  finally { b.disabled = false; b.innerHTML = BOTAO_STORY; }
}
async function figurinhas(d){
  try { await Promise.all(["900 150px Archivo", "800 60px Archivo", "600 34px Inter"].map(f => document.fonts.load(f))); } catch(e){}
  let logo = null; try { logo = await carregarImg("icons/logo-horizontal.svg"); } catch(e){}
  // melhor série de cada exercício com recorde hoje
  const recs = [];
  d.exercicios.forEach((ex,i) => { const k = i+1; if (!recorde(d,k,ex)) return; let m = null;
    for (let s = 1; s <= ex.series; s++){ const r = reps(d,k,s), q = kg(d,k,s) || 0; if (r === "" || !(r > 0)) continue;
      if (!m || q > m.kg || (q === m.kg && r > m.reps)) m = {kg: q, reps: r}; }
    if (m) recs.push({nome: ex.nome.trim(), ...m}); });
  const ops = [{nome: "Marca", desenho: g => figMarca(g, logo)}];
  const feitos = d.exercicios.filter((ex,i) => { for (let s = 1; s <= ex.series; s++) if (reps(d,i+1,s) !== "") return true; return false; }).map(ex => ex.nome.trim());
  if (feitos.length) ops.push({nome: "Exercícios", desenho: g => figLista(g, logo, d.treino ? `TREINO ${d.treino}` : "TREINO DE HOJE", feitos)});
  const dias = (SEM && SEM.dias || []).map(x => ({dia: x.dia, ok: treinouNoDia(x)}));
  if (dias.length) ops.push({nome: "Frequência", desenho: g => figFrequencia(g, logo, dias)});
  if (recs.length) ops.push({nome: "Recorde", desenho: g => figRecorde(g, logo, recs[0], recs.length)});
  const prontas = [];
  for (const o of ops){ const blob = await desenharFig(o.desenho); if (blob) prontas.push({nome: o.nome, blob, url: URL.createObjectURL(blob)}); }
  return prontas;
}
// desenha numa tela grande e transparente e recorta só o que foi desenhado (a figurinha fica do tamanho certo)
async function desenharFig(fn){
  const W = 1080, H = 1300, c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
  g.textAlign = "center"; g.textBaseline = "alphabetic";
  g.shadowColor = "rgba(0,0,0,.55)"; g.shadowBlur = 28; g.shadowOffsetY = 4;   // sombra suave: lê em foto clara e escura
  fn(g);
  const px = g.getImageData(0, 0, W, H).data; let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (px[(y*W + x)*4 + 3] > 6){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const m = 24; x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(W, x1 + m); y1 = Math.min(H, y1 + m);
  const o = document.createElement("canvas"); o.width = x1 - x0; o.height = y1 - y0;
  o.getContext("2d").drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return await new Promise(ok => o.toBlob(ok, "image/png"));
}
function espacado(g, txt, cx, y, esp){ // texto com letras afastadas, centralizado em cx
  const ls = [...txt], ws = ls.map(l => g.measureText(l).width), tot = ws.reduce((a,b) => a+b, 0) + esp * (ls.length - 1);
  let x = cx - tot / 2; const al = g.textAlign; g.textAlign = "left";
  ls.forEach((l,i) => { g.fillText(l, x, y); x += ws[i] + esp; }); g.textAlign = al;
}
function marcaFig(g, logo, y, largura){ // "CONSULTORIA" em amarelo e a logo embaixo; devolve onde terminou
  g.fillStyle = "#FFD60A"; g.font = `600 ${Math.round(largura * .042)}px Inter, Arial`; espacado(g, "CONSULTORIA", 540, y, largura * .022);
  if (!logo) { g.fillStyle = "#FAFAFA"; g.font = `800 ${Math.round(largura * .09)}px Archivo, Arial`; g.fillText("LUCAS GABRIEL", 540, y + largura * .14); return y + largura * .16; }
  const lh = largura * (logo.height || 1200) / (logo.width || 5790); g.drawImage(logo, 540 - largura / 2 - largura * .02, y + largura * .03, largura, lh);
  return y + largura * .03 + lh;
}
function figMarca(g, logo){ marcaFig(g, logo, 120, 900); }
function treinouNoDia(x){ // anotou alguma série ou o aeróbico naquele dia da semana
  if (x.exercicios.some((ex,i) => { for (let s = 1; s <= ex.series; s++) if (reps(x,i+1,s) !== "") return true; return false; })) return true;
  const c = P.cardio[semanaN+"|"+x.dia]; return !!(c && c.minutos !== "" && c.minutos != null); }
function figLista(g, logo, titulo, nomes){
  g.fillStyle = "#FFD60A"; g.font = "600 40px Inter, Arial"; espacado(g, titulo, 540, 70, 16);
  const mostra = nomes.slice(0, 8), fs = 46; g.font = `600 ${fs}px Inter, Arial`;
  const curto = n => { let t = n; while (g.measureText(t).width > 820 && t.length > 4) t = t.slice(0, -2).trimEnd() + "…"; return t; };
  const linhas = mostra.map(curto), larg = Math.max(...linhas.map(t => g.measureText(t).width)) + 56, x = 540 - larg / 2;
  let y = 170; g.textAlign = "left";
  linhas.forEach(t => { g.fillStyle = "#FFD60A"; g.beginPath(); g.arc(x + 12, y - fs * .34, 9, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#FAFAFA"; g.fillText(t, x + 56, y); y += 76; });
  if (nomes.length > 8){ g.fillStyle = "rgba(250,250,250,.7)"; g.font = "600 36px Inter, Arial"; g.fillText(`+ ${nomes.length - 8} exercícios`, x + 56, y); y += 70; }
  g.textAlign = "center";
  g.fillStyle = "rgba(250,250,250,.6)"; g.fillRect(440, y + 4, 200, 3);
  marcaFig(g, logo, y + 100, 640);
}
function figFrequencia(g, logo, dias){
  const n = dias.filter(x => x.ok).length, tot = dias.length;
  g.fillStyle = "#FFD60A"; g.font = "600 40px Inter, Arial"; espacado(g, "FREQUÊNCIA DA SEMANA", 540, 70, 14);
  g.font = "900 210px Archivo, Arial"; const a = String(n), b = `/${tot}`, wa = g.measureText(a).width;
  g.font = "800 100px Archivo, Arial"; const wb = g.measureText(b).width, x0 = 540 - (wa + wb + 10) / 2;
  g.textAlign = "left"; g.fillStyle = "#FAFAFA"; g.font = "900 210px Archivo, Arial"; g.fillText(a, x0, 270);
  g.fillStyle = "rgba(250,250,250,.75)"; g.font = "800 100px Archivo, Arial"; g.fillText(b, x0 + wa + 10, 270); g.textAlign = "center";
  // uma bolinha por dia de treino: amarela = treinou
  const r = 46, esp = 26, larg = tot * 2 * r + (tot - 1) * esp; let cx = 540 - larg / 2 + r;
  const ini = {DOM:"D",SEG:"S",TER:"T",QUA:"Q",QUI:"Q",SEX:"S",SAB:"S"};
  dias.forEach(x => { g.beginPath(); g.arc(cx, 380, r, 0, Math.PI * 2);
    if (x.ok){ g.fillStyle = "#FFD60A"; g.fill(); } else { g.lineWidth = 5; g.strokeStyle = "rgba(250,250,250,.8)"; g.stroke(); }
    g.fillStyle = x.ok ? "#0B0B0B" : "#FAFAFA"; g.font = "800 40px Archivo, Arial"; g.textBaseline = "middle"; g.fillText(ini[x.dia] || "", cx, 382); g.textBaseline = "alphabetic";
    cx += 2 * r + esp; });
  marcaFig(g, logo, 540, 640);
}
function figRecorde(g, logo, r, qtd){
  g.fillStyle = "#FFD60A"; g.font = "600 40px Inter, Arial"; espacado(g, qtd > 1 ? `${qtd} RECORDES HOJE` : "NOVO RECORDE", 540, 90, 16);
  g.fillStyle = "#FAFAFA"; let fs = 64, nome = r.nome.toUpperCase(); g.font = `800 ${fs}px Archivo, Arial`;
  while (g.measureText(nome).width > 960 && fs > 44){ fs -= 2; g.font = `800 ${fs}px Archivo, Arial`; }
  while (g.measureText(nome).width > 960 && nome.length > 4) nome = nome.slice(0, -2).trimEnd() + "…";
  g.fillText(nome, 540, 190);
  g.fillStyle = "#FFD60A"; g.font = "900 140px Archivo, Arial"; g.fillText(r.kg ? `${fmt(r.kg)} KG × ${r.reps}` : `${r.reps} REPS`, 540, 350);
  g.fillStyle = "rgba(250,250,250,.6)"; g.fillRect(440, 410, 200, 3);
  marcaFig(g, logo, 500, 640);
}
function mostrarFigurinhas(ops, d){
  let sel = 0;
  const box = document.createElement("div"); box.className = "imgbox fig";
  box.innerHTML = `<div>
    <h3>Story do Instagram</h3>
    <div class="fig-palco"><img alt="Prévia da figurinha"></div>
    <div class="fig-ops">${ops.map((o,i) => `<button type="button" data-i="${i}" aria-pressed="${i === 0}"><img src="${o.url}" alt=""><span>${esc(o.nome)}</span></button>`).join("")}</div>
    <div class="acoes"><button class="btn amarelo" type="button" id="figCopiar">Copiar figurinha</button><button class="btn" type="button" id="figComp">Compartilhar ou salvar</button></div>
    <p class="nota">Sem fundo: fica por cima da sua foto. <b>Copiou?</b> Abra o story no Instagram, escolha a foto e o Instagram oferece colar a figurinha (ou segure a tela e toque em Colar).</p>
    <button class="btn" type="button" id="figFechar">Fechar</button></div>`;
  const palco = box.querySelector(".fig-palco img");
  const escolher = i => { sel = i; palco.src = ops[i].url; box.querySelectorAll(".fig-ops button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.i === i))); };
  box.querySelectorAll(".fig-ops button").forEach(b => b.onclick = () => escolher(+b.dataset.i));
  const arquivo = () => new File([ops[sel].blob], `figurinha-${ops[sel].nome.toLowerCase().replace(/\s+/g, "-")}.png`, {type: "image/png"});
  box.querySelector("#figCopiar").onclick = async e => {
    try { await navigator.clipboard.write([new ClipboardItem({"image/png": ops[sel].blob})]); e.target.textContent = "Copiada ✓"; setTimeout(() => e.target.textContent = "Copiar figurinha", 2500); }
    catch(err){ aviso("Este celular não deixou copiar. Use “Compartilhar ou salvar”."); }
  };
  box.querySelector("#figComp").onclick = async () => {
    const f = arquivo();
    if (navigator.canShare && navigator.canShare({files: [f]})){ try { await navigator.share({files: [f]}); return; } catch(err){ if (err && err.name === "AbortError") return; } }
    const a = document.createElement("a"); a.href = ops[sel].url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
    aviso("Se não baixou: toque e segure a figurinha e escolha “Salvar na Fotos”.");
  };
  box.querySelector("#figFechar").onclick = () => { box.remove(); ops.forEach(o => URL.revokeObjectURL(o.url)); };
  document.body.appendChild(box); escolher(0);
}
function carregarImg(src){ return new Promise((ok, falha) => { const i = new Image(); i.onload = () => ok(i); i.onerror = falha; i.src = src; }); }

// ---------- lembrete dos treinos na agenda do celular ----------
const BYDAY = {SEG:"MO",TER:"TU",QUA:"WE",QUI:"TH",SEX:"FR",SAB:"SA",DOM:"SU"};
function blocoAgenda(){
  const dias = ORDEM.filter(d => P.periodo[d]); if (!dias.length || !P.ini) return "";
  const hora = ler("agenda-hora") || "18:00";
  return `<details class="como agenda"><summary>📅 Colocar os treinos na agenda do celular</summary>
    <p>Um lembrete em cada dia de treino (${dias.map(d => NOMES[d].toLowerCase()).join(", ")}), 30 minutos antes, até o fim do ciclo.</p>
    <label class="nota" for="agHora">Horário em que você costuma treinar</label>
    <div class="campo" style="max-width:160px"><input id="agHora" type="time" value="${esc(hora)}"></div>
    <div class="acoes"><a class="btn amarelo" id="agGoogle" target="_blank" rel="noopener">Google Agenda (Android)</a><a class="btn" id="agIcs">iPhone e outros</a></div>
    <p class="nota">Mudou o seu horário? É só fazer de novo com o horário novo (e apagar o lembrete antigo da agenda).</p></details>`;
}
function ligarAgenda(){
  const inp = $("agHora"); if (!inp) return;
  const atualizar = () => {
    const [hh, mm] = (inp.value || "18:00").split(":").map(Number); guardar("agenda-hora", inp.value || "18:00");
    const dias = ORDEM.filter(d => P.periodo[d]), hoje = hojeZero();
    let ini = new Date(Math.max(hoje, P.ini)); while (!dias.includes(SEMANA_JS[ini.getDay()])) ini.setDate(ini.getDate() + 1);
    const fimCiclo = P.fim || new Date(P.ini.getTime() + 12*7*864e5);
    const p2 = n => String(n).padStart(2, "0"), dia = x => `${x.getFullYear()}${p2(x.getMonth()+1)}${p2(x.getDate())}`;
    const t0 = `${dia(ini)}T${p2(hh)}${p2(mm)}00`, fimH = new Date(ini); fimH.setHours(hh + 1, mm);
    const t1 = `${dia(fimH)}T${p2(fimH.getHours())}${p2(fimH.getMinutes())}00`;
    const regra = `RRULE:FREQ=WEEKLY;BYDAY=${dias.map(d => BYDAY[d]).join(",")};UNTIL=${dia(fimCiclo)}T235959`;
    const titulo = "Treino 💪", texto = `Abra o app do treino: ${location.origin}${location.pathname}`;
    $("agGoogle").href = "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(titulo) + "&details=" + encodeURIComponent(texto)
      + "&dates=" + t0 + "/" + t1 + "&ctz=America/Sao_Paulo&recur=" + encodeURIComponent(regra.replace(/T235959$/, ""));
    const ics = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Lucas Gabriel Treinador//Treino//PT","BEGIN:VEVENT",
      `UID:treino-${dia(ini)}-${Date.now()}@lucasgabriel`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g,"").slice(0,15)}Z`,
      `DTSTART:${t0}`, `DTEND:${t1}`, regra, `SUMMARY:${titulo}`, `DESCRIPTION:${texto}`,
      "BEGIN:VALARM","ACTION:DISPLAY","DESCRIPTION:Hora do treino","TRIGGER:-PT30M","END:VALARM","END:VEVENT","END:VCALENDAR"].join("\r\n");
    $("agIcs").href = "data:text/calendar;charset=utf-8," + encodeURIComponent(ics);
    $("agIcs").setAttribute("download", "treinos.ics");
  };
  inp.addEventListener("change", atualizar); atualizar();
}

function mostrarRegistro(){
  let t = `${P.nome} · Semana ${SEM.semana} (${SEM.faixa} reps)\n`;
  SEM.dias.forEach(d => { t += `\n${NOMES[d.dia]}${d.treino ? " · Treino " + d.treino : ""}\n`;
    d.exercicios.forEach((ex,i) => { const k = i+1, ss = []; for (let s = 1; s <= ex.series; s++){ const r = reps(d,k,s), q = kg(d,k,s), e = comPse() ? pse(d,k,s) : ""; ss.push(r !== "" ? `${r}×${fmt(q || 0)}kg${e !== "" ? ` PSE ${fmt(e)}` : ""}` : "-"); }
      t += `  ${ex.nome.trim()}: ${ss.join("  ")}\n`; const m = recadoEx(d,k); if (m) t += `    Recado: ${m}\n`; });
    if (d.cardio){ const c = P.cardio[SEM.semana+"|"+d.dia] || {}; t += `  Aeróbico: ${c.minutos !== "" && c.minutos != null ? c.minutos : "-"} min, ${c.bpm !== "" && c.bpm != null ? c.bpm : "-"} bpm (pedido: ${d.cardio})\n`; if (c.recado) t += `    Recado: ${c.recado}\n`; } });
  $("envio").hidden = false; $("texto").textContent = t; $("envio").scrollIntoView({behavior: "smooth"});
}
$("copiar").onclick = async e => { try { await navigator.clipboard.writeText($("texto").textContent); e.target.textContent = "Copiado"; }
  catch(err){ const r = document.createRange(); r.selectNodeContents($("texto")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); e.target.textContent = "Texto selecionado: copie"; } };

// ---------- Minha evolução (desde 15/11/2026, servidor versão 12): presencial vê a avaliação física e as fotos; consultoria, só as fotos ----------
const K_EVO = "evo:" + CODIGO;
let EVO = ler(K_EVO), evoLendo = false, EVO_SEL = null;
const IMG = {}, FILA_FOTOS = []; let fotosBaixando = 0;
const ANGULOS = ["Frente", "Lado direito", "Lado esquerdo", "Costas"];
const isoD = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ""); return m ? new Date(+m[1], +m[2]-1, +m[3]) : null; };
function grafico(pontos, titulo, un){
  if (pontos.length < 2) return "";
  const W = 320, H = 140, pe = 46, pd = 12, pt = 12, pb = 22, ys = pontos.map(p => p.y);
  const folga = (Math.max(...ys) - Math.min(...ys)) * .2 || 1, lo = Math.min(...ys) - folga, hi = Math.max(...ys) + folga;
  const X = i => pe + i * (W - pe - pd) / (pontos.length - 1), Y = v => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(titulo)}">`;
  [lo, (lo + hi) / 2, hi].forEach(t => { s += `<line x1="${pe}" x2="${W - pd}" y1="${Y(t)}" y2="${Y(t)}" stroke="#2A2A27"/><text x="${pe - 6}" y="${Y(t) + 4}" text-anchor="end" fill="#8C8A80" font-size="10" font-family="JetBrains Mono, monospace">${hi - lo >= 10 ? Math.round(t).toLocaleString("pt-BR") : fmt(hi - lo < 2 ? t : Math.round(t * 10) / 10)}</text>`; });
  pontos.forEach((p, i) => { s += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle" fill="#8C8A80" font-size="10" font-family="Inter, sans-serif">${esc(p.x)}</text>`; });
  s += `<polyline fill="none" stroke="#FFD60A" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${pontos.map((p, i) => `${X(i)},${Y(p.y)}`).join(" ")}"/>`;
  pontos.forEach((p, i) => { s += `<circle cx="${X(i)}" cy="${Y(p.y)}" r="4" fill="#FFD60A" stroke="#161616" stroke-width="2"/>`; });
  const u = pontos[pontos.length - 1];
  return `<div class="evo-graf"><h4>${esc(titulo)}</h4>${s}</svg><p class="nota">Última: ${fmt(u.y)}${un} (${esc(u.x)})</p></div>`;
}
// aba Avaliações (B5:I52): rótulo na coluna B, avaliações de D a I; as linhas são as da planilha (ferramentas/avaliacao-fisica)
// cada medida é achada pelo rótulo (servidor: avaliacaoLinhas; "Abdômen" = o perímetro, que vem antes da dobra)
const MEDIDAS = [["Peso","Peso","kg"],["% de gordura","% de gordura","%"],["Massa magra","Massa magra","kg"],["Massa gorda","Massa gorda","kg"],["Cintura","Cintura","cm"],["Abdômen","Abdômen","cm"],["Quadril","Quadril","cm"],
  ["Braço contraído direito","Braço contraído (dir.)","cm"],["Coxa direita","Coxa (dir.)","cm"],["Panturrilha direita","Panturrilha (dir.)","cm"],["Soma das 7 dobras","Soma das dobras","mm"],["IMC","IMC",""]];
function avaliacaoEvo(e){
  const v = e.avaliacao, ini = e.avaliacaoIni || 1, rotLinha = e.avaliacaoLinhas || {};
  const cel = (rot, c) => rotLinha[rot] ? txt(((v[rotLinha[rot] - ini] || [])[2 + c])) : "";
  const cols = [0,1,2,3,4,5].filter(c => cel("Data da avaliação", c));
  if (!cols.length) return `<h3>Avaliação física</h3><p class="nota">A sua primeira avaliação física aparece aqui assim que o seu treinador anotar.</p>`;
  const rot = c => { const m = /^(\d{1,2})\/(\d{1,2})/.exec(cel("Data da avaliação", c)); return m ? `${m[1].padStart(2,"0")}/${m[2].padStart(2,"0")}` : "Av " + (c + 1); };
  const serie = L => cols.map(c => ({x: rot(c), y: lerPlanilha(cel(L, c))})).filter(p => p.y !== "");
  let h = `<h3>Avaliação física</h3><p class="nota">${cols.length === 1 ? `A sua avaliação de ${rot(cols[0])}. Na próxima, você vê aqui o quanto mudou.` : `${cols.length} avaliações: da primeira (${rot(cols[0])}) para a última (${rot(cols[cols.length - 1])}).`}</p>`;
  h += `<div class="evo-cards">${[["Peso","Peso","kg"],["% de gordura","% de gordura","%"],["Massa magra","Massa magra","kg"],["Cintura","Cintura","cm"]].map(([L, n, un]) => { const s = serie(L); if (!s.length) return "";
    const u = s[s.length - 1].y, dif = s.length > 1 ? Math.round((u - s[0].y) * 10) / 10 : null;
    return `<div class="evo-card"><small>${n}</small><b>${fmt(u)}${un === "%" ? "%" : " " + un}</b>${dif != null ? `<span>${dif === 0 ? "igual" : (dif > 0 ? "+" : "") + fmt(dif) + (un === "%" ? " pontos" : " " + un)} desde ${s[0].x}</span>` : ""}</div>`; }).join("")}</div>`;
  h += grafico(serie("Peso"), "Peso (kg)", " kg") + grafico(serie("% de gordura"), "% de gordura", "%") + grafico(serie("Massa magra"), "Massa magra (kg)", " kg");
  const linhas = MEDIDAS.map(([L, n, un]) => { const vals = cols.map(c => lerPlanilha(cel(L, c))); if (vals.every(x => x === "")) return "";
    return `<tr><td>${n}${un ? ` <small>${un}</small>` : ""}</td>${vals.map(x => `<td>${x === "" ? "—" : fmt(x)}</td>`).join("")}</tr>`; }).join("");
  if (linhas) h += `<div class="evo-tab"><table><thead><tr><th>Medida</th>${cols.map(c => `<th>${rot(c)}</th>`).join("")}</tr></thead><tbody>${linhas}</tbody></table></div>`;
  return h;
}
// olhinho de esconder (pedido do criador, 15/11/2026): valores do Financeiro e fotos de avaliação; a escolha fica no celular
const svgOlho = fechado => `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>${fechado ? `<path d="M3 3l18 18"/>` : ""}</svg>`;
const botaoOlho = (id, oculto, oque) => `<button type="button" class="olho" id="${id}" aria-pressed="${oculto}" aria-label="${oculto ? "Mostrar" : "Esconder"} ${oque}">${svgOlho(oculto)}</button>`;
function fotosEvo(e){
  const lista = e.fotos || [], fOcultas = !!ler("ocultar-fotos");
  if (!lista.length) return `<h3>Fotos</h3><p class="nota">As suas fotos de avaliação aparecem aqui depois que você mandar pelo formulário de fotos.</p><a class="btn" href="${FORM_FOTOS}" target="_blank" rel="noopener">Abrir o formulário de fotos</a>`;
  const datas = [...new Set(lista.map(f => f.data))].sort();
  let [a, b] = EVO_SEL || [datas[0], datas[datas.length - 1]];
  if (!datas.includes(a)) a = datas[0]; if (!datas.includes(b)) b = datas[datas.length - 1];
  const mostrar = a === b ? [a] : [a, b], rot = s => ddaaaa(isoD(s));
  let h = `<div class="tit-olho"><h3>Fotos</h3>${botaoOlho("olhoFotos", fOcultas, "as fotos")}</div><div class="${fOcultas ? "fotos-ocultas" : ""}">`;
  if (datas.length > 1) h += `<div class="evo-sel"><label>Antes<select id="evoA">${datas.map(x => `<option value="${x}"${x === a ? " selected" : ""}>${rot(x)}</option>`).join("")}</select></label><label>Depois<select id="evoB">${datas.map(x => `<option value="${x}"${x === b ? " selected" : ""}>${rot(x)}</option>`).join("")}</select></label></div>`;
  else h += `<p class="nota">As suas fotos de ${rot(datas[0])}. Na reavaliação, elas aparecem lado a lado com as novas.</p>`;
  ANGULOS.forEach(ang => {
    if (!mostrar.some(dt => lista.some(f => f.angulo === ang && f.data === dt))) return;
    h += `<h4>${ang}</h4><div class="evo-par${mostrar.length === 1 ? " um" : ""}">${mostrar.map(dt => { const f = lista.find(x => x.angulo === ang && x.data === dt);
      return `<figure>${f ? `<button type="button" class="evo-foto" data-foto="${esc(f.id)}" data-leg="${esc(ang + " · " + rot(dt))}" aria-label="Ampliar ${esc(ang)} de ${rot(dt)}"><img alt="${esc(ang)} em ${rot(dt)}" hidden><span>Abrindo…</span></button>` : `<div class="evo-foto"><span>Sem foto</span></div>`}<figcaption>${rot(dt)}</figcaption></figure>`; }).join("")}</div>`;
  });
  return h + `</div><p class="nota">Só você e o seu treinador veem estas fotos.${fOcultas ? " Toque no olho para mostrar." : ""}</p>`;
}
function pintarEvo(erro){
  const c = $("evoCorpo"); let h = cargasEvo();
  if (!EVO) h += `<p class="carregando">${esc(erro || "Procurando as suas fotos…")}</p>`;
  else {
    if (EVO.modalidade === "presencial") h += EVO.avaliacao ? avaliacaoEvo(EVO) : `<h3>Avaliação física</h3><p class="nota">A sua avaliação física aparece aqui quando estiver no modelo novo da planilha. Fale com o seu treinador.</p>`;
    h += fotosEvo(EVO);
    if (erro) h += `<p class="nota">${esc(erro)}</p>`;
  }
  c.innerHTML = h;
  const escolher = () => { EVO_SEL = [$("evoA").value, $("evoB").value]; pintarEvo(); };
  if ($("olhoFotos")) $("olhoFotos").onclick = () => { guardar("ocultar-fotos", !ler("ocultar-fotos")); pintarEvo(); };
  if ($("evoEx")) $("evoEx").onchange = e => { EVO_EX = e.target.value; guardar("evo-ex:" + CODIGO, EVO_EX); pintarEvo(); };
  if ($("evoA")){ $("evoA").onchange = escolher; $("evoB").onchange = escolher; }
  c.querySelectorAll("[data-foto]").forEach(bt => { const img = bt.querySelector("img"), sp = bt.querySelector("span");
    carregarFoto(bt.dataset.foto).then(url => { img.src = url; img.hidden = false; sp.remove(); bt.onclick = () => { if (!ler("ocultar-fotos")) abrirFoto(url, bt.dataset.leg); }; })
      .catch(e => { sp.textContent = e.servidor ? "Não abriu" : "Sem internet"; }); });
}
async function mostrarEvolucao(){
  pintarEvo();
  if (evoLendo) return; evoLendo = true;
  try { const e = await chamar({acao: "evolucao", codigo: CODIGO}, 60000); EVO = e; guardar(K_EVO, e); pintarEvo(); }
  catch(e){ pintarEvo(e.servidor ? (/desconhecida/i.test(e.message) ? "Esta parte do app chega em breve." : e.message) : "Sem internet: mostrando o que já estava guardado no celular."); }
  finally { evoLendo = false; }
}
// a foto fica guardada no celular depois da 1ª vez (abre rápido e sem internet)
function carregarFoto(id){
  if (IMG[id]) return IMG[id];
  const k = new URL(`__foto/${encodeURIComponent(id)}`, location.href).href;
  const p = (async () => {
    try { if (window.caches){ const r = await (await caches.open("fotos-aluno")).match(k); if (r) return URL.createObjectURL(await r.blob()); } } catch(e){}
    await new Promise(ok => { FILA_FOTOS.push(ok); andar(); });
    try {
      const j = await chamar({acao: "foto", codigo: CODIGO, id}, 60000);
      const bin = atob(j.b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], {type: j.tipo || "image/jpeg"});
      try { if (window.caches) await (await caches.open("fotos-aluno")).put(k, new Response(blob, {headers: {"Content-Type": blob.type}})); } catch(e){}
      return URL.createObjectURL(blob);
    } finally { fotosBaixando--; andar(); }
  })();
  IMG[id] = p; p.catch(() => { delete IMG[id]; });
  return p;
}
function andar(){ while (fotosBaixando < 2 && FILA_FOTOS.length){ fotosBaixando++; FILA_FOTOS.shift()(); } }
function abrirFoto(url, leg){
  const f = document.createElement("div"); f.className = "evo-cheia"; f.setAttribute("role", "dialog"); f.setAttribute("aria-label", leg);
  f.innerHTML = `<button type="button" class="btn" aria-label="Fechar">✕ Fechar</button><img src="${esc(url)}" alt="${esc(leg)}"><p>${esc(leg)}</p>`;
  const fechar = () => { f.remove(); document.removeEventListener("keydown", tecla); }, tecla = e => { if (e.key === "Escape") fechar(); };
  f.onclick = fechar; document.addEventListener("keydown", tecla); document.body.appendChild(f); f.querySelector("button").focus();
}


// ---------- versão 15 (15/11/2026; pedido do criador): suas cargas, conquistas, sugestão alimentar e renovação ----------
let EVO_EX = ler("evo-ex:" + CODIGO);
const totalSemanas = () => P.ini && P.fim ? Math.max(1, Math.min(12, Math.ceil((P.fim - P.ini) / (7*864e5)))) : 12;
const semanaHoje = () => P.ini ? Math.max(1, semanaDe(hojeZero())) : 1;
// treinos previstos e feitos numa semana (feito = alguma série anotada naquele dia)
function treinosDaSemana(w){
  let prev = 0, feitos = 0;
  SEMANA_JS.forEach(d => { const L = P.periodo[d]; if (!L || !(P.treinos[L]||[]).length) return; prev++;
    const reg = P.reg[P.abas[d] || L] || [];
    for (let k = 1; k <= 9; k++){ const row = reg[linhaReg(w,k)]; if (row) for (let s = 0; s < 5; s++) if (lerPlanilha(row[1+2*s]) > 0){ feitos++; return; } } });
  return {prev, feitos};
}
// números do ciclo: melhor série de cada exercício por semana, recordes (mesma regra de recordeDe), volume, treinos e sequência
function estatisticas(){
  const ex = {}, antes = {}, recs = [], volSem = {}; let volume = 0;
  for (let w = 1; w <= 12; w++){
    const daSem = {};
    Object.keys(P.reg).forEach(L => { for (let k = 1; k <= 9; k++){ const row = (P.reg[L]||[])[linhaReg(w,k)], nome = nomeDaLinha(row); if (!nome) continue;
      for (let s = 0; s < 5; s++){ const r = lerPlanilha(row[1+2*s]), q = lerPlanilha(row[2+2*s]); if (!(r > 0)) continue; const kgv = q === "" ? 0 : q;
        (daSem[nome] || (daSem[nome] = [])).push({reps: r, kg: kgv}); volume += r * kgv; volSem[w] = (volSem[w] || 0) + r * kgv; } } });
    Object.keys(daSem).forEach(n => { const lst = daSem[n], e = ex[n] || (ex[n] = {nome: n, semanas: {}});
      e.semanas[w] = lst.reduce((b,x) => x.kg > b.kg || (x.kg === b.kg && x.reps > b.reps) ? x : b);
      const r = recordeDe(lst, antes[n] || []); if (r) recs.push({semana: w, exercicio: n, texto: textoRecorde(r)});
      antes[n] = (antes[n] || []).concat(lst); });
  }
  const total = totalSemanas(), wa = semanaHoje(), sem = [];
  for (let w = 1; w <= total; w++) sem.push({semana: w, ...treinosDaSemana(w)});
  // sequência: semanas completas seguidas (a semana em andamento só conta quando completa; não quebra a sequência)
  let corrente = 0, melhorSeq = 0;
  sem.forEach(x => { if (x.semana > wa) return; if (x.prev && x.feitos >= x.prev){ corrente++; melhorSeq = Math.max(melhorSeq, corrente); } else if (x.semana < wa) corrente = 0; });
  return {ex: Object.values(ex).sort((a,b) => a.nome.localeCompare(b.nome, "pt-BR")), recs, volume, volSem, sem, total,
    treinos: sem.reduce((t,x) => t + x.feitos, 0), seq: corrente, melhorSeq};
}
// conquistas: [id, ícone, nome, valor atual, meta]
function conquistas(e){
  return [
    ["tr1", "👟", "Primeiro treino anotado", e.treinos, 1],
    ["sem1", "✅", "Semana completa", e.melhorSeq, 1],
    ["seq4", "🔥", "4 semanas seguidas sem faltar", e.melhorSeq, 4],
    ["seq8", "🔥", "8 semanas seguidas sem faltar", e.melhorSeq, 8],
    ["ciclo", "👑", "Ciclo inteiro sem faltar", e.melhorSeq, e.total],
    ["rec1", "🏆", "Primeiro recorde", e.recs.length, 1],
    ["rec10", "🏆", "10 recordes", e.recs.length, 10],
    ["rec25", "🏆", "25 recordes", e.recs.length, 25],
    ["tr25", "💪", "25 treinos", e.treinos, 25],
    ["tr50", "💪", "50 treinos", e.treinos, 50],
    ["t10", "🏋️", "10 toneladas levantadas", Math.floor(e.volume / 1000), 10],
    ["t50", "🏋️", "50 toneladas levantadas", Math.floor(e.volume / 1000), 50],
    ["t100", "🏋️", "100 toneladas levantadas", Math.floor(e.volume / 1000), 100]
  ].map(([id, ic, nome, val, meta]) => ({id, ic, nome, val, meta, ok: val >= meta}));
}
// conquista nova: um aviso na hora (a 1ª vez que o app abre só guarda as que já tinha)
function checarConquistas(){
  if (!P || !P.reg) return;
  const k = "conq:" + CODIGO, tinha = ler(k), agora = conquistas(estatisticas()).filter(c => c.ok);
  if (tinha){ const nova = agora.find(c => !tinha.includes(c.id)); if (nova) aviso(`${nova.ic} Nova conquista: ${nova.nome}!`); }
  if (!tinha || agora.some(c => !tinha.includes(c.id))) guardar(k, agora.map(c => c.id));
}
const toneladas = kg => kg >= 1000 ? `${fmt(Math.round(kg / 100) / 10)} t` : `${Math.round(kg)} kg`;
function cargasEvo(){
  if (!P || !P.reg) return "";
  const e = estatisticas(), cq = conquistas(e), feitas = cq.filter(c => c.ok);
  let h = `<h3>Suas conquistas</h3><div class="evo-cards">
    <div class="evo-card"><small>Treinos feitos</small><b>${e.treinos}</b><span>neste ciclo</span></div>
    <div class="evo-card"><small>Sequência</small><b>${e.seq} ${e.seq === 1 ? "semana" : "semanas"}</b><span>${e.melhorSeq > e.seq ? `melhor: ${e.melhorSeq}` : "completas seguidas"}</span></div>
    <div class="evo-card"><small>Recordes</small><b>${e.recs.length}</b><span>neste ciclo</span></div>
    <div class="evo-card"><small>Total levantado</small><b>${toneladas(e.volume)}</b><span>reps × kg</span></div></div>`;
  h += `<p class="nota">${feitas.length} de ${cq.length} conquistas</p><div class="conq">${cq.map(c => `<div class="conq-i${c.ok ? " ok" : ""}"><span aria-hidden="true">${c.ic}</span><div><b>${esc(c.nome)}</b><small>${c.ok ? "Conquistada" : `${Math.min(c.val, c.meta)} de ${c.meta}`}</small></div></div>`).join("")}</div>`;
  if (!e.ex.length) return h + `<h3>Suas cargas</h3><p class="nota">Assim que você anotar as primeiras séries, a evolução de cada exercício aparece aqui.</p>`;
  const sel = e.ex.find(x => x.nome === EVO_EX) || e.ex[0], ws = Object.keys(sel.semanas).map(Number).sort((a,b) => a - b);
  const p0 = sel.semanas[ws[0]], u = sel.semanas[ws[ws.length - 1]], dif = Math.round((u.kg - p0.kg) * 10) / 10;
  h += `<h3>Suas cargas</h3><label class="evo-sel1">Exercício<select id="evoEx">${e.ex.map(x => `<option${x === sel ? " selected" : ""}>${esc(x.nome)}</option>`).join("")}</select></label>`;
  h += ws.length > 1 ? grafico(ws.map(w => ({x: "S" + w, y: sel.semanas[w].kg})), `${sel.nome}: melhor série (kg)`, " kg")
      + `<p class="nota">Semana ${ws[0]}: ${fmt(p0.kg)} kg × ${p0.reps} → semana ${ws[ws.length - 1]}: ${fmt(u.kg)} kg × ${u.reps}${dif > 0 ? ` (+${fmt(dif)} kg)` : ""}.</p>`
    : `<p class="nota">Semana ${ws[0]}: ${fmt(p0.kg)} kg × ${p0.reps}. Na próxima semana, você vê aqui o quanto subiu.</p>`;
  const vs = Object.keys(e.volSem).map(Number).sort((a,b) => a - b);
  if (vs.length > 1) h += grafico(vs.map(w => ({x: "S" + w, y: Math.round(e.volSem[w])})), "Volume total por semana (reps × kg)", " kg");
  if (e.recs.length) h += `<h4>Seus recordes</h4><ul class="evo-recs">${e.recs.slice().reverse().slice(0, 8).map(r => `<li><b>${esc(r.exercicio)}</b> · semana ${r.semana}<br><small>${esc(r.texto)}</small></li>`).join("")}</ul>`;
  return h;
}

// ----- sugestão alimentar (aba Cardápio do Calculos metabólicos; só aparece com o "sim" do treinador e sem nutricionista) -----
const K_DIETA = "dieta:" + CODIGO;
let DIETA = ler(K_DIETA), dietaLendo = false;
const PLURAL = {"unidade": "unidades", "fatia": "fatias", "colher de sopa": "colheres de sopa", "colher de chá": "colheres de chá", "pote": "potes",
  "scoop": "scoops", "copo": "copos", "xícara": "xícaras", "lata": "latas", "porção": "porções"};   // igual ao dieta_pdf.py (skill nutricionista)
function qtdDieta(q, m){ q = txt(q); m = txt(m); if (!q) return ""; if (m === "g" || m === "ml") return `${q} ${m}`;
  const n = lerPlanilha(q); return `${q} ${n !== "" && n >= 2 ? (PLURAL[m] || m) : m}`.trim(); }
function pintarDieta(erro){
  const c = $("dietaCorpo"), j = DIETA; let h = "";
  if (!j) h = `<p class="carregando">${esc(erro || "Abrindo a sua sugestão alimentar…")}</p>`;
  else if (!j.dieta) h = `<p class="nota">${esc(j.motivo || "A sua sugestão alimentar ainda não está pronta.")}</p>`;
  else {
    const d = j.dieta, m = d.cardapio || {};
    const metas = [["Calorias", m.kcal, "kcal"], ["Proteína", m.proteina, "g"], ["Carboidrato", m.carboidrato, "g"], ["Gordura", m.gordura, "g"]].filter(x => txt(x[1]));
    if (metas.length) h += `<h3>Seu dia</h3><div class="evo-cards">${metas.map(([n, v, un]) => `<div class="evo-card"><small>${n}</small><b>${esc(v)} ${un}</b></div>`).join("")}</div>${txt((d.meta || {}).agua) ? `<p class="nota">Água: ${esc(d.meta.agua)} por dia.</p>` : ""}`;
    d.refeicoes.forEach(r => { h += `<div class="refeicao"><h4>${esc(r.nome)}</h4><ul>${r.itens.map(i => `<li><span>${esc(i.alimento)}</span><b>${esc(qtdDieta(i.quantidade, i.medida))}</b>${i.obs ? `<small>${esc(i.obs)}</small>` : ""}</li>`).join("")}</ul></div>`; });
    if (d.suplementos.length) h += `<h3>Suplementação</h3><ul class="evo-recs">${d.suplementos.map(x => `<li><b>${esc(x.nome)}</b>${x.dose ? ` · ${esc(x.dose)}` : ""}${x.uso ? `<br><small>${esc(x.uso)}</small>` : ""}</li>`).join("")}</ul>`;
    if (d.trocas.length){ const por = {}; d.trocas.forEach(t => { (por[t.de] || (por[t.de] = {qtd: qtdDieta(t.qtd_de, t.med_de), itens: []})).itens.push(`${qtdDieta(t.qtd_para, t.med_para)} de ${t.para}`); });
      h += `<h3>Trocas</h3><ul class="evo-recs">${Object.keys(por).map(k => `<li><b>${esc(por[k].qtd)} de ${esc(k)}</b> pode trocar por:<br><small>${por[k].itens.map(esc).join(" · ")}</small></li>`).join("")}</ul>`; }
    if (d.observacoes.length) h += `<h3>Observações</h3>${d.observacoes.map(o => `<p class="nota">${esc(o)}</p>`).join("")}`;
    h += `<p class="nota">É uma sugestão com as suas metas. Dúvida ou quer trocar algo? Fale com o seu treinador.</p>`;
    if (erro) h += `<p class="nota">${esc(erro)}</p>`;
  }
  c.innerHTML = h;
}
async function mostrarDieta(){
  pintarDieta();
  if (dietaLendo) return; dietaLendo = true;
  try { const j = await chamar({acao: "dieta", codigo: CODIGO}, 60000); DIETA = j; guardar(K_DIETA, j); pintarDieta(); }
  catch(e){ pintarDieta(e.servidor ? e.message : "Sem internet: mostrando o que já estava guardado no celular."); }
  finally { dietaLendo = false; }
}

// ---------- abas embaixo (pedido do criador, 15/11/2026): Treino, Evolução e Alimentação (só com a sugestão alimentar liberada) ----------
const ABAS = [["treino", "🏋️", "Treino"], ["evolucao", "📈", "Evolução"], ["alimentacao", "🍽️", "Alimentação"]];
const abaAtual = () => { const h = location.hash.replace("#", ""); return h === "evolucao" || (h === "alimentacao" && P && P.dieta) ? h : "treino"; };
function pintarNav(){
  const nav = $("abas"); if (!P){ nav.hidden = true; return; }
  const a = abaAtual(), lista = ABAS.filter(([k]) => k !== "alimentacao" || P.dieta);
  nav.innerHTML = lista.map(([k, ic, t]) => `<a href="#${k}" aria-current="${k === a ? "page" : "false"}"><span aria-hidden="true">${ic}</span>${t}</a>`).join("");
  nav.hidden = false;
}
let abaMostrada = null;
function aplicarAba(){
  if (!P) return;
  const a = abaAtual(), tr = a === "treino";
  ["meta", "avisos", "dias", "tela"].forEach(id => $(id).hidden = !tr);
  if (!tr) $("envio").hidden = true;
  $("evolucao").hidden = a !== "evolucao"; $("dieta").hidden = a !== "alimentacao";
  pintarNav();
  if (a !== abaMostrada){ abaMostrada = a; scrollTo(0, 0);
    if (a === "evolucao") mostrarEvolucao(); else if (a === "alimentacao") mostrarDieta(); }
}
window.addEventListener("hashchange", aplicarAba);

// ----- renovação: perto do fim do plano (aba Alunos do Financeiro; só consultoria online) -----
// Preços e links: ferramentas/vendas/precos-e-oferta.md. Mudou lá, mude aqui.
const PLANOS_RENOVAR = [
  ["Mensal", "R$ 197", "https://sun.eduzz.com/39YDQYZQ9O"],
  ["Trimestral", "R$ 497 ou 3x de R$ 165,67", "https://sun.eduzz.com/2212855"],
  ["Semestral", "R$ 897 ou 6x de R$ 149,50", "https://sun.eduzz.com/E0D6NXGY91"]];
const WHATS_TREINADOR = "5544998093639";
function cardRenovar(hoje){
  const p = P.plano; if (!p || !p.fim || /sa[ií]u/i.test(p.situacao || "")) return "";
  const fim = isoD(p.fim); if (!fim) return "";
  const n = Math.round((fim - hoje) / 864e5);
  if (n < -7 || !(n <= 14 || /Perguntar se renova|Plano acabou/i.test(p.situacao || ""))) return "";
  const depois = ler("renovar-depois:" + CODIGO); if (depois && Date.now() - depois < 3*864e5 && n > 0) return "";
  const nomePlano = p.plano ? ` ${p.plano.toLowerCase()}` : "";
  const tit = n > 1 ? `Seu plano${nomePlano} acaba em ${n} dias` : n === 1 ? `Seu plano${nomePlano} acaba amanhã` : n === 0 ? `Seu plano${nomePlano} acaba hoje` : `Seu plano${nomePlano} acabou`;
  const txtp = n >= 0 ? `Ele vai até ${NOMES[SEMANA_JS[fim.getDay()]].toLowerCase()}, ${dd(fim)}. Para seguir sem pausa no treino, você pode renovar por aqui.` : `Ele terminou em ${dd(fim)}. Para voltar ao treino, é só renovar por aqui.`;
  const zap = `https://wa.me/${WHATS_TREINADOR}?text=${encodeURIComponent(`Oi, Lucas! Quero renovar a consultoria no Pix.`)}`;
  return `<div class="aviso-card"><h3>${esc(tit)}</h3><p>${esc(txtp)}</p>
    <details class="como"><summary>Renovar no cartão</summary><div class="planos">${PLANOS_RENOVAR.map(([nome, preco, link]) => `<a class="btn${nome === "Trimestral" ? " amarelo" : ""}" href="${link}" target="_blank" rel="noopener"><b>${nome}</b> ${esc(preco)}</a>`).join("")}</div></details>
    <div class="acoes"><a class="btn" href="${zap}" target="_blank" rel="noopener">Pagar no Pix (falar com o Lucas)</a>${n > 0 ? `<button class="btn" type="button" id="naoRenovar">Depois</button>` : ""}</div></div>`;
}

// ---------- avisos no celular (servidor versão 17; pedido do criador, 15/11/2026) ----------
// O servidor guarda cada aviso na caixa do aluno (o sininho) e acorda o celular (Web Push, sw.js). Sem os avisos ligados,
// o aluno vê a caixa quando abre o app. No iPhone, só funciona com o app na tela de início.
const K_VISTO = "avisos-visto:" + CODIGO, K_AVCEL = "avisos-cel:" + CODIGO, K_AVDEPOIS = "avisos-depois:" + CODIGO;
const HORAS_LEMBRETE = [6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21];
let AVISOS = [], AV_CHAVE = "", avConferido = false;
const suportaAvisos = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const ehIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
function estadoAvisos(){
  if (!AV_CHAVE) return "servidor";
  if (ehIos() && !instalado()) return "ios";
  if (!suportaAvisos()) return "sem";
  if (Notification.permission === "denied") return "bloqueado";
  return Notification.permission === "granted" && ler(K_AVCEL) ? "ligado" : "desligado";
}
const naoLidos = () => { const v = ler(K_VISTO) || ""; return AVISOS.filter(x => String(x.id) > v); };
function pintarSino(){
  const b = $("sino"); if (!b) return; b.hidden = !P || (!AV_CHAVE && !AVISOS.length);   // servidor antes da versão 17: sem sininho
  const n = naoLidos().length, el = $("sinoN"); el.hidden = !n; el.textContent = n > 9 ? "9+" : String(n);
  b.setAttribute("aria-label", n ? `Avisos: ${n} ${n === 1 ? "novo" : "novos"}` : "Avisos");
}
function receberAvisos(raw){
  if (Array.isArray(raw.avisos)) AVISOS = raw.avisos;
  if (raw.avisos_chave) AV_CHAVE = raw.avisos_chave;
  pintarSino(); guardarCfgSW(); conferirInscricao();
}
async function guardarCfgSW(extra){ // o sw.js lê daqui o código do aluno para buscar o aviso (o localStorage não chega lá)
  if (!("caches" in window) || window.__API_MOCK) return;
  try { const c = await caches.open("cfg-avisos"), r = await c.match("cfg"), velho = r ? await r.json() : {};
    const cel = ler(K_AVCEL);
    await c.put("cfg", new Response(JSON.stringify({...velho, codigo: CODIGO, api: API, chave: AV_CHAVE, ligado: !!cel, hora: cel ? cel.hora : null, resumo: cel ? cel.resumo : true, ...(extra || {})}))); } catch(e){}
}
function chaveBytes(b64){ const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4)); return Uint8Array.from(s, c => c.charCodeAt(0)); }
function mesmaChave(buf, u8){ try { const a = new Uint8Array(buf); return a.length === u8.length && a.every((v, i) => v === u8[i]); } catch(e){ return false; } }
async function inscrever(){
  const reg = await navigator.serviceWorker.ready, k = chaveBytes(AV_CHAVE);
  let sub = await reg.pushManager.getSubscription();
  if (sub && sub.options && sub.options.applicationServerKey && !mesmaChave(sub.options.applicationServerKey, k)){ await sub.unsubscribe(); sub = null; }
  return sub || reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: k});
}
async function ligarAvisosCel(hora, resumo){
  const perm = await Notification.requestPermission();   // tem que ser a 1ª coisa do toque (o iPhone exige)
  if (perm !== "granted") { const e = new Error(perm === "denied" ? "bloqueado" : "cancelado"); e.perm = perm; throw e; }
  const sub = await inscrever();
  await chamar({acao: "avisos_ligar", codigo: CODIGO, sub: sub.toJSON(), hora, resumo});
  guardar(K_AVCEL, {endpoint: sub.endpoint, hora, resumo}); guardarCfgSW();
}
async function desligarAvisosCel(){
  const cel = ler(K_AVCEL);
  try { const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch(e){}
  try { localStorage.removeItem(K_AVCEL); } catch(e){}
  guardarCfgSW({ligado: false});
  if (cel) await chamar({acao: "avisos_desligar", codigo: CODIGO, endpoint: cel.endpoint});
}
async function conferirInscricao(){ // o celular trocou o endereço dos avisos (acontece): manda o novo
  if (avConferido || estadoAvisos() !== "ligado" || window.__API_MOCK) return; avConferido = true;
  try { const cel = ler(K_AVCEL), sub = await inscrever();
    if (sub.endpoint !== cel.endpoint){ await chamar({acao: "avisos_ligar", codigo: CODIGO, sub: sub.toJSON(), hora: cel.hora, resumo: cel.resumo}); guardar(K_AVCEL, {...cel, endpoint: sub.endpoint}); } } catch(e){}
}
function erroAvisos(e){
  if (e.perm === "denied") return "O celular bloqueou os avisos deste app. Para ligar, libere nas configurações de notificações do celular.";
  if (e.perm) return "Os avisos não foram ligados.";
  return e.servidor ? "Não consegui ligar: " + e.message : "Sem internet: tente de novo com sinal.";
}
const opcoesHora = sel => `<option value="">Não quero lembrete</option>` + HORAS_LEMBRETE.map(h => `<option value="${h}"${h === sel ? " selected" : ""}>Às ${h}h</option>`).join("");
const quandoAviso = q => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(q || ""); return m ? `${m[3]}/${m[2]} · ${m[4]}:${m[5]}` : ""; };
function abrirAvisos(){
  fecharPse();
  const novos = new Set(naoLidos().map(x => x.id)), est = estadoAvisos(), cel = ler(K_AVCEL) || {};
  if (AVISOS.length) guardar(K_VISTO, String(AVISOS[0].id));
  try { navigator.clearAppBadge && navigator.clearAppBadge(); } catch(e){}
  pintarSino();
  let cfg = "";
  if (est === "ligado") cfg = `<p class="av-ok">🔔 Avisos ligados neste celular.</p>
    <label class="av-linha">Lembrete nos dias de treino<select id="avHora">${opcoesHora(cel.hora == null ? null : cel.hora)}</select></label>
    <label class="av-linha"><span>Resumo da semana (domingo, 18h)</span><input type="checkbox" id="avResumo"${cel.resumo === false ? "" : " checked"}></label>
    <p class="nota" id="avMsg"></p><button type="button" class="btn" id="avDesligar">Desligar os avisos</button>`;
  else if (est === "desligado") cfg = `<p class="nota">Ligue para receber no celular: o lembrete nos dias de treino, as dicas do seu treinador, a semana das fotos e o fim do plano. No máximo 1 aviso automático por dia, e nada de madrugada.</p>
    <label class="av-linha">Lembrete nos dias de treino<select id="avHora">${opcoesHora(8)}</select></label>
    <p class="nota" id="avMsg"></p><button type="button" class="btn amarelo" id="avLigar">Ativar avisos</button>`;
  else if (est === "bloqueado") cfg = `<p class="nota">Os avisos estão bloqueados para este app no celular. ${ehIos() ? "Para ligar: Ajustes › Notificações › Treino › Permitir Notificações." : "Para ligar: segure o ícone do app › Informações do app › Notificações › Permitir."} Depois, volte aqui.</p>`;
  else if (est === "ios") cfg = `<p class="nota">No iPhone, os avisos só funcionam com o app na tela de início: no Safari, toque em <b>Compartilhar</b> › <b>Adicionar à Tela de Início</b>, abra o app por lá e volte aqui no 🔔.</p>`;
  else if (est === "sem") cfg = `<p class="nota">Este navegador não recebe avisos. Eles aparecem aqui sempre que você abrir o app.</p>`;
  const lista = AVISOS.length ? AVISOS.map(x => `<div class="av-item${novos.has(x.id) ? " novo" : ""}"><small>${esc(quandoAviso(x.quando))}${novos.has(x.id) ? " · novo" : ""}</small><b>${esc(x.titulo)}</b><p>${esc(x.texto)}</p></div>`).join("")
    : `<p class="nota">Nenhum aviso ainda. Quando o seu treinador mandar um, ele aparece aqui.</p>`;
  const fundo = document.createElement("div"); fundo.className = "pse-fundo"; fundo.id = "pseFundo";
  fundo.innerHTML = `<div class="pse-folha av-folha" role="dialog" aria-modal="true" aria-labelledby="avTit">
    <div class="pse-topo"><div><h3 id="avTit">Avisos</h3><p>Do seu treinador e do app</p></div><button type="button" class="pse-x" aria-label="Fechar">✕</button></div>
    ${est === "servidor" ? "" : `<div class="av-cfg">${cfg}</div>`}<div class="av-lista">${lista}</div></div>`;
  document.body.appendChild(fundo);
  const fechar = () => { fecharPse(); if (location.hash === "#avisos") history.replaceState(null, "", location.pathname + location.search); avisos(); };
  fundo.onclick = e => { if (e.target === fundo) fechar(); };
  fundo.querySelector(".pse-x").onclick = fechar;
  fundo.addEventListener("keydown", e => { if (e.key === "Escape") fechar(); });
  const msg = t => { const m = $("avMsg"); if (m) m.textContent = t; };
  const hora = () => { const v = $("avHora").value; return v === "" ? null : Number(v); };
  if ($("avLigar")) $("avLigar").onclick = async () => { const b = $("avLigar"); b.disabled = true; msg("Ligando…");
    try { await ligarAvisosCel(hora(), true); abrirAvisos(); aviso("Avisos ligados ✓"); } catch(e){ b.disabled = false; msg(erroAvisos(e)); } };
  if ($("avDesligar")) $("avDesligar").onclick = async () => { msg("Desligando…"); try { await desligarAvisosCel(); } catch(e){} abrirAvisos(); };
  const salvarPref = async () => { msg("Salvando…");
    try { const sub = await inscrever(), r = $("avResumo").checked, hh = hora();
      await chamar({acao: "avisos_ligar", codigo: CODIGO, sub: sub.toJSON(), hora: hh, resumo: r});
      guardar(K_AVCEL, {endpoint: sub.endpoint, hora: hh, resumo: r}); guardarCfgSW(); msg("Salvo ✓"); } catch(e){ msg(erroAvisos(e)); } };
  if (est === "ligado"){ $("avHora").onchange = salvarPref; $("avResumo").onchange = salvarPref; }
  fundo.querySelector(".pse-x").focus({preventScroll: true});
}
// no Treino: o último recado do treinador que o aluno ainda não viu (para quem não ligou os avisos) e o convite para ligar
function cardRecadoTreinador(){
  const x = naoLidos().find(a => a.tipo === "treinador" || a.tipo === "dica"); if (!x) return "";
  return `<div class="aviso-card"><h3>📣 ${esc(x.titulo)}</h3><p>${esc(x.texto)}</p><div class="acoes"><button class="btn" type="button" id="avVer">Ver avisos</button></div></div>`;
}
function anotouAlgo(){ return Object.keys(P.reg || {}).some(L => (P.reg[L] || []).some(r => (r || []).slice(1, 11).some(v => txt(v) !== ""))); }
function cardAtivarAvisos(){
  if (estadoAvisos() !== "desligado" || Notification.permission !== "default") return "";
  const depois = ler(K_AVDEPOIS); if (depois && Date.now() - depois < 14*864e5) return "";
  const primeira = ler("primeira-vez") || Date.now(); if (!ler("primeira-vez")) guardar("primeira-vez", primeira);
  if (!anotouAlgo() && Date.now() - primeira < 2*864e5) return "";   // pede depois que o aluno viu valor no app
  return `<div class="aviso-card"><h3>Quer lembrete nos dias de treino? 🔔</h3><p>Eu te aviso no celular nos dias de treino, quando eu deixar uma dica para você e na semana das fotos. No máximo 1 aviso automático por dia.</p>
    <label class="av-linha">Lembrete<select id="avHoraCard">${opcoesHora(8)}</select></label><p class="nota" id="avMsgCard"></p>
    <div class="acoes"><button class="btn amarelo" type="button" id="avLigarCard">Ativar avisos</button><button class="btn" type="button" id="avDepois">Agora não</button></div></div>`;
}
function ligarCardsAvisos(){
  if ($("avVer")) $("avVer").onclick = abrirAvisos;
  if ($("avDepois")) $("avDepois").onclick = () => { guardar(K_AVDEPOIS, Date.now()); avisos(); };
  if ($("avLigarCard")) $("avLigarCard").onclick = async () => { const b = $("avLigarCard"), v = $("avHoraCard").value; b.disabled = true; $("avMsgCard").textContent = "Ligando…";
    try { await ligarAvisosCel(v === "" ? null : Number(v), true); aviso(v === "" ? "Avisos ligados ✓" : `Avisos ligados ✓ Lembrete às ${v}h (mude no 🔔)`); avisos(); }
    catch(e){ b.disabled = false; $("avMsgCard").textContent = erroAvisos(e); } };
}
if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", e => { // toque no aviso com o app aberto
  const a = e.data && e.data.abrir; if (!a) return;
  if (P) atualizar();
  if (a === "avisos") setTimeout(abrirAvisos, 300); else location.hash = "#" + a;
});

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
  aplicarAba(); pintarSino();
}
async function atualizar(){
  const guardado = ler(K_DADOS);
  if (guardado && !P){ receberAvisos(guardado.raw); mostrar(guardado.raw, true); mostrarStatus(navigator.onLine === false ? "velho" : "atualizando"); if (location.hash === "#avisos") abrirAvisos(); }
  const g0 = gravacoes;
  try {
    const raw = await chamar({acao: "dados", codigo: CODIGO});
    // gravou algo enquanto lia? a leitura pode estar sem a última gravação: lê de novo
    if (gravacoes !== g0 && P){ setTimeout(atualizar, 500); return; }
    const nova = JSON.stringify([raw.versao, raw.treino, raw.videos, raw.reg, raw.cardio]);
    guardar(K_DADOS, {raw, em: Date.now()});
    const primeiraVez = !P, novosAntes = naoLidos().length;
    receberAvisos(raw);
    if (!P) mostrar(raw, true);
    if (primeiraVez && location.hash === "#avisos") abrirAvisos();
    else if (P && naoLidos().length !== novosAntes) avisos();
    else if (nova !== assinatura){ const foco = document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
      if (foco){ montarDados(raw); precisaRender = true; } else mostrar(raw, false); }
    if (P && (!!raw.dieta !== P.dieta || JSON.stringify(raw.plano || null) !== JSON.stringify(P.plano))){ P.dieta = !!raw.dieta; P.plano = raw.plano || null; avisos(); aplicarAba(); }
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
  else { if (tick) manterTela(true); if (P) atualizar(); try { if (P && !naoLidos().length && navigator.clearAppBadge) navigator.clearAppBadge(); } catch(e){} }
});
window.addEventListener("pagehide", enviarAoSair);

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost") && !window.__API_MOCK)
  navigator.serviceWorker.register("sw.js").catch(() => {});

if (!CODIGO) erroTela("Abra pelo seu link", "Use o link que o seu treinador mandou no WhatsApp. Ele já abre direto no seu treino.");
else atualizar();
