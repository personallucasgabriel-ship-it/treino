// App do treinador: controle dos alunos (situação, evolução, avaliação física, agenda do dia) e registro
// das cargas dos alunos do presencial, direto no "Protocolo de treino" de cada um.
// O servidor é o mesmo do app do aluno (app/aluno/Codigo.gs + Treinador.gs), com a chave do treinador.
// A leitura da aba Treino e o registro seguem as mesmas regras do app do aluno (../app.js); mudou lá, mude aqui.
"use strict";

const API = window.__API_URL || "https://script.google.com/macros/s/AKfycbwgKNi5GJVdmoQgbBivji6dISvLIxBYKxKf9rTWXOG762bF6nDEnAs0mIhzPGGpuuCpGw/exec";
const ORDEM = ["SEG","TER","QUA","QUI","SEX","SAB","DOM"];
const SEMANA_JS = ["DOM","SEG","TER","QUA","QUI","SEX","SAB"];
const NOMES = {DOM:"Domingo",SEG:"Segunda",TER:"Terça",QUA:"Quarta",QUI:"Quinta",SEX:"Sexta",SAB:"Sábado"};
const OFFSET = {SEG:0,TER:1,QUA:2,QUI:3,SEX:4,SAB:5,DOM:6};
const SEGUIDOS = {BISET:2, TRISET:3, "GIANT SET":99};
const COL_RECADO = 14;
const DIA_MS = 864e5;

const $ = id => document.getElementById(id);
const txt = v => (v == null ? "" : String(v)).trim();
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const mmss = s => `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
const dd = d => `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
const ddaaaa = d => `${dd(d)}/${d.getFullYear()}`;
const hojeZero = () => { const h = new Date(); return new Date(h.getFullYear(), h.getMonth(), h.getDate()); };
const dias = (a, b) => Math.round((b - a) / DIA_MS);
const primeiro = n => (n || "").split(/\s+/)[0] || n || "";
const plural = (n, s, p) => `${n} ${n === 1 ? s : (p || s + "s")}`;

function lerDigitado(v){
  let t = txt(v).replace(/\s/g,"").replace(",",".");
  if (t === "") return "";
  t = t.replace(/[^0-9.]/g,"");
  const p = t.indexOf("."); if (p >= 0) t = t.slice(0,p+1) + t.slice(p+1).replace(/\./g,"");
  const n = Number(t);
  return isFinite(n) && t !== "." ? n : "";
}
function lerPlanilha(v){
  let t = txt(v);
  if (t === "") return "";
  if (t.includes(",")) t = t.replace(/\./g,"").replace(",",".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g,"");
  const n = Number(t);
  return isFinite(n) ? n : "";
}
const fmt = n => n === "" || n == null ? "" : String(Math.round(Number(n)*100)/100).replace(".",",");

// ---------- memória do celular ----------
function ler(k){ try { const v = localStorage.getItem(k); return v == null ? null : JSON.parse(v); } catch(e){ return null; } }
function guardar(k,v){ try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch(e){ return false; } }
const CHAVE = (() => {
  const m = /[#&]k=([A-Za-z0-9]+)/.exec(location.hash);
  if (m){ guardar("t_chave", m[1]); history.replaceState(null, "", location.pathname + location.search + "#/hoje"); return m[1]; }
  return ler("t_chave") || "";
})();

async function chamar(corpo, ms){
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms || 45000);
  try {
    corpo = {...corpo, chave: CHAVE};
    const j = window.__API_MOCK ? await window.__API_MOCK(corpo)
      : await (await fetch(API, {method:"POST", body: JSON.stringify(corpo), signal: ctrl.signal, redirect:"follow"})).json();
    if (!j || !j.ok) { const e = new Error((j && j.erro) || "Erro no servidor"); e.servidor = true; throw e; }
    return j;
  } finally { clearTimeout(t); }
}

// ---------- datas do ciclo (mesmas regras do painel da consultoria) ----------
function dataPlanilha(s, ref, depois){
  const m = /^\s*(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?\s*$/.exec(s || ""); if (!m) return null;
  const d = +m[1], mes = +m[2] - 1;
  if (m[3]){ const a = +m[3]; return new Date(a < 100 ? 2000 + a : a, mes, d); }
  if (depois){ for (const a of [depois.getFullYear(), depois.getFullYear()+1]){ const x = new Date(a, mes, d); if (x > depois) return x; } return null; }
  ref = ref || hojeZero();
  return [ref.getFullYear()-1, ref.getFullYear(), ref.getFullYear()+1].map(a => new Date(a, mes, d))
    .sort((x,y) => Math.abs(x-ref) - Math.abs(y-ref))[0];
}
const isoData = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ""); return m ? new Date(+m[1], +m[2]-1, +m[3]) : null; };
function ciclo(a){
  const r = a.resumo || {};
  const entrega = dataPlanilha(r.entrega, isoData(r.alterada) || hojeZero());
  const revisao = entrega ? dataPlanilha(r.revisao, null, entrega) : null;
  const hoje = hojeZero();
  const total = revisao ? Math.max(1, Math.ceil(dias(entrega, revisao) / 7)) : 12;
  const semana = entrega ? Math.floor(dias(entrega, hoje) / 7) + 1 : null;
  return {entrega, revisao, total, semana, concluidas: semana ? Math.max(0, Math.min(semana - 1, total)) : 0};
}
function tempo(n){ if (n < 21) return plural(n, "dia"); if (n < 60) return `${Math.floor(n/7)} semanas`; if (n < 365) return `${Math.floor(n/30)} meses`; return "mais de um ano"; }

// cor do aluno: as mesmas regras de situacao() do painel (skill painel-consultoria, seção 3)
function situacao(a){
  const hoje = hojeZero();
  if (a.erro) return ["aviso", a.erro];
  if (a.modelo === "sem_protocolo") return ["info", "Só tem a planilha de avaliação física, sem Protocolo de treino"];
  const c = ciclo(a), r = a.resumo || {};
  if (!c.entrega){
    const criada = isoData(a.criada), n = criada ? dias(criada, hoje) : null;
    if (n == null) return ["aviso", "Esperando o treino (sem data de entrega na planilha)"];
    return [n >= 7 ? "atencao" : n >= 3 ? "aviso" : "ok", `Esperando o treino há ${tempo(n)}`];
  }
  if (hoje < c.entrega) return ["ok", `O treino começa em ${dd(c.entrega)}`];
  if (c.revisao && hoje >= c.revisao){
    const n = dias(c.revisao, hoje);
    return ["atencao", n === 0 ? "A revisão é hoje: perguntar se vai renovar" : `O ciclo acabou há ${tempo(n)} (revisão em ${dd(c.revisao)}): renovou ou parou?`];
  }
  let nivel, frase;
  if (a.modelo === "antigo"){
    const alt = isoData(a.controle_alterado), n = alt ? dias(alt, hoje) : null;
    if (n == null) [nivel, frase] = ["aviso", "Sem Controle de carga para conferir"];
    else if (n >= 14) [nivel, frase] = ["atencao", `Controle de carga parado há ${tempo(n)}`];
    else if (n >= 8) [nivel, frase] = ["aviso", `Controle de carga parado há ${tempo(n)}`];
    else [nivel, frase] = ["ok", "Controle de carga mexido nesta semana"];
  } else {
    const ultima = r.ultima_semana || 0, atraso = c.concluidas - ultima;
    if (atraso >= 2) [nivel, frase] = ["atencao", ultima ? `Há ${atraso} semanas sem registro (último: semana ${ultima})` : `Ainda não tem nenhum registro (${atraso} semanas)`];
    else if (atraso === 1) [nivel, frase] = ["aviso", `Falta o registro da semana ${c.concluidas}`];
    else [nivel, frase] = ["ok", "Registro em dia"];
  }
  const falta = c.revisao ? dias(hoje, c.revisao) : null;
  if (falta != null && falta <= 7){ frase += ` · revisão em ${plural(falta, "dia")}`; if (nivel === "ok") nivel = "aviso"; }
  return [nivel, frase];
}
const ORDEM_NIVEL = {atencao:0, aviso:1, ok:2, info:3};

// frequência e cardio das 4 últimas semanas que já acabaram
function freq4(a){
  const r = a.resumo || {}, c = ciclo(a); if (!r.freq || !c.concluidas) return null;
  const ws = r.freq.filter(f => f.semana <= c.concluidas && f.semana > c.concluidas - 4 && f.previstos);
  if (!ws.length) return null;
  const feitos = ws.reduce((s,f) => s + f.feitos, 0), previstos = ws.reduce((s,f) => s + f.previstos, 0);
  const cardio = ws.reduce((s,f) => s + ((r.cardio || {})[f.semana] || 0), 0);
  return {feitos, previstos, cardio, semanas: ws.length};
}
function recordes4(a){ const r = a.resumo || {}, c = ciclo(a); const w = c.semana || 0; return (r.recordes || []).filter(x => x.semana > w - 4 && x.semana <= w); }

// ---------- estado ----------
let INICIO = ler("t_inicio");          // {alunos, agenda, lido_em}
let ultimaLeitura = INICIO ? new Date(INICIO.lido_em) : null;
let FILA = ler("t_fila") || {};        // gravações ainda não confirmadas pela planilha
const DADOS = {};                       // dados completos de cada aluno já aberto (memória)
const alunoPorChave = k => ((INICIO && INICIO.alunos) || []).find(a => a.chave === k);

// ---------- rotas ----------
function rota(){ const h = location.hash.replace(/^#\/?/, "").split("/"); return {tela: h[0] || "hoje", chave: h[1] || "", aba: h[2] || "resumo"}; }
window.addEventListener("hashchange", () => { pararSemSalvar(); render(true); });
function render(rolar){
  const r = rota();
  document.querySelectorAll("#nav a").forEach(a => a.setAttribute("aria-current", (r.tela === a.dataset.r || (r.tela === "a" && a.dataset.r === "alunos")) ? "page" : "false"));
  if (!CHAVE) return telaSemChave();
  if (!INICIO) { $("tela").innerHTML = `<p class="carregando">Lendo os seus alunos no Drive… (na primeira vez demora uns segundos)</p>`; return; }
  if (r.tela === "alunos") telaAlunos();
  else if (r.tela === "a") telaAluno(r.chave, r.aba);
  else telaHoje();
  if (rolar) window.scrollTo({top: 0});
}

function telaSemChave(){
  $("nav").hidden = true;
  $("tela").innerHTML = `<div class="card"><h2>Abra pelo seu link</h2><p class="sub">Este app é só seu. Abra pelo link com a sua chave, que o Claude te mandou no chat. Depois de abrir uma vez, ele lembra sozinho.</p>
  <label class="sub" for="ch">Ou cole a chave aqui:</label><input class="busca" id="ch" autocomplete="off"><button class="btn amarelo" type="button" id="okch">Entrar</button></div>`;
  $("okch").onclick = () => { const v = $("ch").value.replace(/[^A-Za-z0-9]/g, ""); if (v.length >= 24){ guardar("t_chave", v); location.hash = "#/hoje"; location.reload(); } };
}

// ---------- HOJE ----------
function linhaAluno(a, direita){
  const [nivel, frase] = situacao(a), c = ciclo(a);
  const dir = direita != null ? direita : (c.semana && c.semana >= 1 && a.modelo !== "sem_protocolo" ? `<b>${Math.min(c.semana, c.total)}/${c.total}</b>semana` : "");
  return `<a class="aluno" href="#/a/${a.chave}"><span class="bola ${nivel}" role="img" aria-label="${({atencao:"Atenção",aviso:"Aviso",ok:"Em dia",info:"Sem protocolo"})[nivel]}"></span>
    <span class="meio"><h3>${esc(a.nome)}</h3><p>${a.modalidade === "presencial" ? '<span class="chip p">Presencial</span>' : '<span class="chip">Online</span>'} ${esc(frase)}</p></span>
    <span class="dir">${dir}</span></a>`;
}
function telaHoje(){
  const hoje = hojeZero(), d = SEMANA_JS[hoje.getDay()], alunos = INICIO.alunos || [];
  let h = `<div><div class="eyebrow">${NOMES[d]}, ${ddaaaa(hoje)}</div><h1>Hoje</h1></div>`;

  // presencial que treina hoje
  const treinam = alunos.filter(a => a.modalidade === "presencial" && a.resumo && a.resumo.periodo && a.resumo.periodo[d]).filter(a => { const c = ciclo(a); return c.entrega && hoje >= c.entrega && (!c.revisao || hoje < c.revisao); });
  h += `<section class="secao"><header><h2>Treinam hoje</h2><span class="cont">presencial</span></header>`;
  h += treinam.length ? `<div class="lista">${treinam.map(a => { const c = ciclo(a), L = a.resumo.periodo[d];
      return `<div class="aluno"><span class="bola ${situacao(a)[0]}"></span><span class="meio"><h3>${esc(a.nome)}</h3><p>Treino ${L} · semana ${c.semana} de ${c.total}</p></span>
        <a class="btn amarelo" href="#/a/${a.chave}/registrar">Registrar</a></div>`; }).join("")}</div>`
    : `<p class="vazio">Nenhum aluno do presencial com treino marcado para hoje.</p>`;
  h += `</section>`;

  // agenda
  const ev = (INICIO.agenda || []).map(e => ({...e, d: new Date(e.inicio)}));
  const deHoje = ev.filter(e => e.d >= hoje && e.d < new Date(hoje.getTime() + DIA_MS));
  const depois = ev.filter(e => e.d >= new Date(hoje.getTime() + DIA_MS));
  const evento = e => `<div class="card evento cor-${esc(e.cor)}"><h3>${esc(e.titulo)}</h3>${e.diaInteiro ? "" : `<p class="sub">${String(e.d.getHours()).padStart(2,"0")}:${String(e.d.getMinutes()).padStart(2,"0")}</p>`}${e.descricao ? `<pre>${esc(e.descricao)}</pre>` : ""}</div>`;
  h += `<section class="secao"><header><h2>Na agenda</h2><span class="cont">${plural(deHoje.length, "tarefa")}</span></header>`;
  h += INICIO.agendaErro ? `<p class="vazio">Não consegui ler a agenda: ${esc(INICIO.agendaErro)}</p>` : deHoje.length ? deHoje.map(evento).join("") : `<p class="vazio">Nenhuma tarefa de aluno ou de lead na agenda hoje.</p>`;
  if (depois.length) h += `<details><summary>Próximos 7 dias (${depois.length})</summary><div class="lista" style="margin-top:8px">${depois.map(e => evento({...e, titulo: `${NOMES[SEMANA_JS[e.d.getDay()]].slice(0,3)} ${dd(e.d)} · ${e.titulo}`})).join("")}</div></details>`;
  h += `</section>`;

  // atenção
  const at = alunos.map(a => [situacao(a), a]).filter(([s]) => s[0] === "atencao" || s[0] === "aviso").sort((x,y) => ORDEM_NIVEL[x[0][0]] - ORDEM_NIVEL[y[0][0]] || x[1].nome.localeCompare(y[1].nome));
  h += `<section class="secao"><header><h2>Pedem atenção</h2><span class="cont">${at.length} de ${alunos.length}</span></header>`;
  h += at.length ? `<div class="lista">${at.map(([,a]) => linhaAluno(a)).join("")}</div>` : `<p class="vazio">Todos os alunos estão em dia.</p>`;
  h += `</section>`;

  // recados (2 últimas semanas com recado de cada aluno)
  const rec = [];
  alunos.forEach(a => { const rs = (a.resumo && a.resumo.recados) || []; if (!rs.length) return; const w = Math.max(...rs.map(x => x.semana)); rs.filter(x => x.semana >= w - 1).forEach(x => rec.push({...x, a})); });
  if (rec.length){
    h += `<section class="secao"><header><h2>Recados dos alunos</h2><span class="cont">app do aluno</span></header><div class="card">${rec.slice(-12).reverse().map(x =>
      `<div class="recado"><small>${esc(primeiro(x.a.nome))} · semana ${x.semana} · ${esc(x.exercicio)}</small>“${esc(x.texto)}”</div>`).join("")}</div></section>`;
  }
  // recordes da semana
  const recs = []; alunos.forEach(a => { const c = ciclo(a); ((a.resumo && a.resumo.recordes) || []).filter(x => c.semana && x.semana >= c.semana - 1 && x.semana <= c.semana).forEach(x => recs.push({...x, a})); });
  if (recs.length){
    h += `<section class="secao"><header><h2>Recordes</h2><span class="cont">esta semana e a passada</span></header><div class="card">${recs.slice(-12).reverse().map(x =>
      `<div class="recado"><small>${esc(primeiro(x.a.nome))} · semana ${x.semana}</small>🏆 ${esc(x.exercicio)}: ${fmt(x.kg)} kg × ${x.reps} (antes ${fmt(x.antes)} kg)</div>`).join("")}</div></section>`;
  }
  $("tela").innerHTML = h;
}

// ---------- ALUNOS ----------
let filtro = ler("t_filtro") || "todos", busca = "";
function telaAlunos(){
  const alunos = INICIO.alunos || [];
  const n = {todos: alunos.length, consultoria: alunos.filter(a => a.modalidade === "consultoria").length, presencial: alunos.filter(a => a.modalidade === "presencial").length};
  let h = `<div><div class="eyebrow">${plural(alunos.length, "aluno ativo", "alunos ativos")}</div><h1>Alunos</h1></div>
    <div class="filtros" role="group" aria-label="Filtrar">${[["todos","Todos"],["consultoria","Online"],["presencial","Presencial"]].map(([k,t]) =>
      `<button type="button" data-f="${k}" aria-pressed="${filtro === k}">${t} (${n[k]})</button>`).join("")}</div>
    <input class="busca" id="busca" type="search" placeholder="Procurar pelo nome" value="${esc(busca)}" autocomplete="off">
    <div class="lista" id="listaAlunos"></div>`;
  $("tela").innerHTML = h;
  const pintar = () => {
    const q = busca.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const l = alunos.filter(a => (filtro === "todos" || a.modalidade === filtro) && a.nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(q))
      .map(a => [situacao(a), a]).sort((x,y) => ORDEM_NIVEL[x[0][0]] - ORDEM_NIVEL[y[0][0]] || x[1].nome.localeCompare(y[1].nome));
    $("listaAlunos").innerHTML = l.length ? l.map(([,a]) => linhaAluno(a)).join("") : `<p class="vazio">Nenhum aluno com esse nome.</p>`;
  };
  pintar();
  document.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { filtro = b.dataset.f; guardar("t_filtro", filtro); telaAlunos(); });
  $("busca").oninput = e => { busca = e.target.value; pintar(); };
}

// ---------- UM ALUNO ----------
function telaAluno(chave, aba){
  const a = alunoPorChave(chave);
  if (!a){ $("tela").innerHTML = `<a class="voltar" href="#/alunos">‹ Alunos</a><div class="card"><h2>Aluno não encontrado</h2><p class="sub">Ele pode ter ido para Inativos. Toque em ↻ para ler o Drive de novo.</p></div>`; return; }
  const [nivel, frase] = situacao(a);
  const temProto = !!a.protocolo, abas = [["resumo","Resumo"],["evolucao","Evolução"]].concat(temProto ? [["registrar","Registrar"]] : []);
  if (!abas.some(x => x[0] === aba)) aba = "resumo";
  let h = `<a class="voltar" href="#/alunos">‹ Alunos</a>
    <div><div class="eyebrow">${a.modalidade === "presencial" ? "Presencial" : "Consultoria online"}</div><h1>${esc(a.nome)}</h1></div>
    <div class="situ"><span class="bola ${nivel}"></span><span>${esc(frase)}</span></div>
    <nav class="abas" aria-label="Partes do aluno">${abas.map(([k,t]) => `<a href="#/a/${a.chave}/${k}" aria-current="${k === aba ? "page" : "false"}">${t}</a>`).join("")}</nav>
    <div id="corpo" class="wrap" style="width:100%"></div>`;
  $("tela").innerHTML = h;
  if (aba === "resumo") resumoAluno(a);
  else carregarAluno(a, () => aba === "evolucao" ? evolucaoAluno(a) : registrarAluno(a));
}

function resumoAluno(a){
  const c = ciclo(a), r = a.resumo || {}, f = freq4(a), rec = recordes4(a), hoje = hojeZero();
  let h = "";
  if (c.entrega){
    const w = Math.max(0, Math.min(c.semana || 0, c.total));
    h += `<div class="card"><div style="display:flex;justify-content:space-between;gap:8px"><b>${hoje < c.entrega ? "Começa em " + dd(c.entrega) : `Semana ${w} de ${c.total}`}</b><span class="sub">${dd(c.entrega)} → ${c.revisao ? dd(c.revisao) : "sem revisão"}</span></div>
      <div class="barra" role="img" aria-label="${w} de ${c.total} semanas"><i style="width:${Math.round(100*w/c.total)}%"></i></div></div>`;
  }
  const fato = (rot, val, sub) => `<div class="fato"><small>${rot}</small><b>${val}</b>${sub ? `<span>${sub}</span>` : ""}</div>`;
  const fatos = [];
  if (a.modelo === "novo") fatos.push(fato("Último registro", r.ultima_semana ? "Semana " + r.ultima_semana : "Nenhum"));
  if (f) fatos.push(fato("Frequência", `${f.feitos}/${f.previstos}`, `${Math.round(100*f.feitos/f.previstos)}% · ${plural(f.semanas, "semana")}`));
  if (f && f.cardio) fatos.push(fato("Cardio", `${f.cardio} min`, plural(f.semanas, "semana")));
  if (a.modelo === "novo") fatos.push(fato("Recordes", rec.length, "últimas 4 semanas"));
  if (c.revisao) fatos.push(fato("Revisão", dd(c.revisao), hoje <= c.revisao ? `em ${plural(dias(hoje, c.revisao), "dia")}` : "já passou"));
  fatos.push(fato("Fotos", a.fotos_em ? dd(isoData(a.fotos_em)) : "—", a.fotos_em ? `há ${tempo(dias(isoData(a.fotos_em), hoje))}` : "nenhum envio"));
  if (a.nota != null) fatos.push(fato("Nota do feedback", `${fmt(a.nota)}/10`, a.nota_em ? dd(isoData(a.nota_em)) : ""));
  if (a.modelo === "antigo" && a.controle_alterado) fatos.push(fato("Controle de carga", dd(isoData(a.controle_alterado)), "última mudança"));
  h += `<div class="fatos">${fatos.join("")}</div>`;

  const links = [];
  if (a.planilha) links.push(`<a class="btn amarelo" href="${esc(a.planilha)}" target="_blank" rel="noopener">Planilha de treino</a>`);
  if (a.avaliacao) links.push(`<a class="btn" href="https://docs.google.com/spreadsheets/d/${esc(a.avaliacao)}/edit" target="_blank" rel="noopener">Avaliação física</a>`);
  if (a.calculos) links.push(`<a class="btn" href="${esc(a.calculos)}" target="_blank" rel="noopener">Cálculos metabólicos</a>`);
  if (a.pasta) links.push(`<a class="btn" href="${esc(a.pasta)}" target="_blank" rel="noopener">Pasta no Drive</a>`);
  h += `<div class="acoes">${links.join("")}</div>`;

  h += `<section class="secao"><header><h2>Minhas anotações</h2></header>
    <textarea class="nota" id="anot" placeholder="Ex.: dor no joelho esquerdo, evitar agachamento profundo; prefere treinar cedo; meta: 10 kg no stiff até dezembro">${esc(a.anotacao || "")}</textarea>
    <div class="acoes"><button class="btn amarelo" type="button" id="salvarAnot">Salvar anotação</button><span class="nota-msg" id="anotMsg">Só você vê. Fica na planilha de acessos, aba Treinador.</span></div></section>`;

  if (r.freq && c.concluidas){
    const ws = r.freq.filter(x => x.semana <= Math.min(c.semana || 0, c.total) && x.previstos);
    if (ws.length) h += `<section class="secao"><header><h2>Semana a semana</h2><span class="cont">treinos feitos</span></header><div class="card"><div class="tabela"><table>
      <thead><tr><th>Semana</th><th>Treinos</th><th>Cardio</th><th>Faltou</th></tr></thead><tbody>${ws.slice().reverse().map(x =>
      `<tr><td>${x.semana}${x.semana === c.semana ? " (atual)" : ""}</td><td>${x.feitos}/${x.previstos}</td><td>${(r.cardio || {})[x.semana] ? r.cardio[x.semana] + " min" : "—"}</td><td>${x.faltou.length && x.semana < c.semana ? x.faltou.join(", ") : "—"}</td></tr>`).join("")}</tbody></table></div></div></section>`;
  }
  const rs = (r.recados || []).slice().sort((x,y) => y.semana - x.semana).slice(0, 8);
  if (rs.length) h += `<section class="secao"><header><h2>Recados do aluno</h2></header><div class="card">${rs.map(x => `<div class="recado"><small>Semana ${x.semana} · ${esc(x.exercicio)}</small>“${esc(x.texto)}”</div>`).join("")}</div></section>`;
  if (rec.length) h += `<section class="secao"><header><h2>Recordes</h2><span class="cont">últimas 4 semanas</span></header><div class="card">${rec.slice().reverse().map(x =>
      `<div class="recado"><small>Semana ${x.semana}</small>🏆 ${esc(x.exercicio)}: ${fmt(x.kg)} kg × ${x.reps} (antes ${fmt(x.antes)} kg)</div>`).join("")}</div></section>`;
  if (a.lido_planilha_erro) h += `<p class="sub">${esc(a.lido_planilha_erro)}</p>`;
  $("corpo").innerHTML = h;
  $("salvarAnot").onclick = async () => {
    const t = $("anot").value; $("anotMsg").textContent = "Salvando…";
    try { await chamar({acao: "t_nota", aluno: a.chave, nome: a.nome, texto: t}); a.anotacao = t; guardar("t_inicio", INICIO); $("anotMsg").textContent = "Salvo ✓"; }
    catch(e){ $("anotMsg").textContent = e.servidor ? "Não salvou: " + e.message : "Sem internet: não salvou. Tente de novo com sinal."; }
  };
}

async function carregarAluno(a, depois){
  const corpo = $("corpo");
  const guardado = DADOS[a.chave] || ler("t_aluno:" + a.chave);
  if (guardado){ DADOS[a.chave] = guardado; depois(); }
  else corpo.innerHTML = `<p class="carregando">Abrindo a planilha de ${esc(primeiro(a.nome))}…</p>`;
  try {
    const d = await chamar({acao: "t_aluno", aluno: a.chave});
    const mudou = !guardado || JSON.stringify([d.treino, d.reg, d.cardio, d.avaliacao]) !== JSON.stringify([guardado.treino, guardado.reg, guardado.cardio, guardado.avaliacao]);
    DADOS[a.chave] = d; guardar("t_aluno:" + a.chave, d);
    const r = rota(); if (r.tela !== "a" || r.chave !== a.chave) return;
    if (mudou){ const foco = document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName); if (!foco) depois(); else precisaRender = true; }
  } catch(e){
    if (!guardado) corpo.innerHTML = `<div class="card"><h2>Não consegui abrir</h2><p class="sub">${esc(e.servidor ? e.message : "Sem internet. Na primeira vez que abre um aluno, o app precisa de internet; depois ele guarda no celular.")}</p><button class="btn amarelo" type="button" id="tentar">Tentar de novo</button></div>`,
      $("tentar").onclick = () => carregarAluno(a, depois);
  }
}

// ---------- leitura da aba Treino (igual ao app do aluno) ----------
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
      const ds = {};
      for (let i = 1; i <= 7; i++){ const d = cel(r+i,0), t = cel(r+i,1);
        if (NOMES[d] && /\d/.test(t)) ds[d] = t.replace(/(\d+)\s*min/i,"$1 min").replace(/\s*em um[a]?\s*/i,", ").replace(/media/i,"média").replace(/(\d+)\s*bpm/i,"$1 bpm"); }
      out.aerobicos.push({semanas: sem, dias: ds});
    }
  }
  return out;
}
const linhaReg = (N,k) => 1 + 13*(N-1) + (k-1);
const nomeDaLinha = row => txt((row||[])[0]).split("\n")[0].trim();

// ---------- EVOLUÇÃO ----------
function evolucaoPorExercicio(reg){
  const ex = {};   // nome → {semanas: {w: {kg, reps, volume}}}
  Object.keys(reg || {}).forEach(L => { for (let w = 1; w <= 12; w++) for (let k = 1; k <= 9; k++){
    const row = (reg[L]||[])[linhaReg(w,k)]; const nome = nomeDaLinha(row); if (!nome) continue;
    for (let s = 0; s < 5; s++){ const r = lerPlanilha(row[1+2*s]), q = lerPlanilha(row[2+2*s]); if (!(r > 0)) continue;
      const e = ex[nome] || (ex[nome] = {nome, semanas: {}}); const x = e.semanas[w] || (e.semanas[w] = {kg: 0, reps: 0, volume: 0});
      const kg = q === "" ? 0 : q; x.volume += r * kg; if (kg > x.kg || (kg === x.kg && r > x.reps)){ x.kg = kg; x.reps = r; } }
  } });
  return Object.values(ex).filter(e => Object.keys(e.semanas).length);
}
function grafico(pontos, opt){
  // um gráfico de linha (uma série só): pontos [{x: rótulo, y, dica}]
  if (!pontos.length) return `<p class="vazio">Ainda sem números.</p>`;
  const W = 320, H = 150, pe = 46, pd = 10, pt = 12, pb = 24;
  const ys = pontos.map(p => p.y), min0 = opt && opt.zero ? 0 : Math.min(...ys), max0 = Math.max(...ys);
  const folga = (max0 - min0) * .15 || Math.max(1, max0 * .1);
  const lo = opt && opt.zero ? 0 : Math.max(0, min0 - folga), hi = opt && opt.max ? opt.max : max0 + folga;
  const X = i => pontos.length === 1 ? (pe + W - pd) / 2 : pe + i * (W - pe - pd) / (pontos.length - 1);
  const Y = v => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo || 1));
  const ticks = [lo, (lo + hi) / 2, hi];
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc((opt && opt.titulo) || "Gráfico")}">`;
  ticks.forEach(t => { s += `<line x1="${pe}" x2="${W - pd}" y1="${Y(t)}" y2="${Y(t)}" stroke="#2A2A27" stroke-width="1"/><text x="${pe - 6}" y="${Y(t) + 4}" text-anchor="end" fill="#A3A196" font-size="10" font-family="JetBrains Mono, monospace">${hi - lo >= 10 ? Math.round(t).toLocaleString("pt-BR") : fmt(Math.round(t * 10) / 10)}${opt && opt.sufixo || ""}</text>`; });
  const passo = Math.ceil(pontos.length / 8);
  pontos.forEach((p,i) => { if (i % passo === 0 || i === pontos.length - 1) s += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle" fill="#A3A196" font-size="10" font-family="Inter, sans-serif">${esc(p.x)}</text>`; });
  if (pontos.length > 1) s += `<polyline fill="none" stroke="#FFD60A" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pontos.map((p,i) => `${X(i)},${Y(p.y)}`).join(" ")}"/>`;
  pontos.forEach((p,i) => { s += `<circle cx="${X(i)}" cy="${Y(p.y)}" r="4" fill="#FFD60A" stroke="#161616" stroke-width="2"/><circle class="alvo" cx="${X(i)}" cy="${Y(p.y)}" r="14" fill="transparent" data-dica="${esc(p.dica || fmt(p.y))}" data-cx="${X(i) / W}" data-cy="${Y(p.y) / H}"/>`; });
  return `<div class="grafico">${s}</svg><div class="tip" hidden></div></div>`;
}
function ligarDicas(raiz){
  raiz.querySelectorAll(".grafico").forEach(g => {
    const tip = g.querySelector(".tip");
    const mostrar = c => { tip.textContent = c.dataset.dica; tip.style.left = (100 * c.dataset.cx) + "%"; tip.style.top = (100 * c.dataset.cy) + "%"; tip.hidden = false; };
    g.querySelectorAll(".alvo").forEach(c => { c.addEventListener("pointerenter", () => mostrar(c)); c.addEventListener("click", () => mostrar(c)); });
    g.addEventListener("pointerleave", () => tip.hidden = true);
  });
}
function evolucaoAluno(a){
  const d = DADOS[a.chave], r = a.resumo || {}, c = ciclo(a); let h = "";
  if (d.reg){
    const exs = evolucaoPorExercicio(d.reg);
    const volSem = {}; exs.forEach(e => Object.entries(e.semanas).forEach(([w,x]) => volSem[w] = (volSem[w] || 0) + x.volume));
    const vs = Object.keys(volSem).map(Number).sort((x,y) => x-y);
    h += `<section class="secao"><header><h2>Volume total</h2><span class="cont">reps × kg, por semana</span></header><div class="card">${grafico(vs.map(w => ({x: "S" + w, y: Math.round(volSem[w]), dica: `Semana ${w}: ${Math.round(volSem[w]).toLocaleString("pt-BR")} kg`})), {titulo: "Volume total por semana", zero: true})}</div></section>`;
    if (r.freq && c.concluidas){
      const ws = r.freq.filter(x => x.semana <= c.concluidas && x.previstos);
      if (ws.length) h += `<section class="secao"><header><h2>Frequência</h2><span class="cont">% dos treinos feitos</span></header><div class="card">${grafico(ws.map(x => ({x: "S" + x.semana, y: Math.round(100 * x.feitos / x.previstos), dica: `Semana ${x.semana}: ${x.feitos} de ${x.previstos} treinos`})), {titulo: "Frequência por semana", zero: true, max: 100, sufixo: "%"})}</div></section>`;
    }
    if (exs.length){
      const ordenados = exs.sort((x,y) => x.nome.localeCompare(y.nome));
      const esc0 = ler("t_ex:" + a.chave); const sel = ordenados.find(e => e.nome === esc0) || ordenados[0];
      h += `<section class="secao"><header><h2>Carga por exercício</h2><span class="cont">melhor série da semana</span></header><div class="card">
        <label class="sub" for="exSel">Exercício</label><select id="exSel">${ordenados.map(e => `<option${e === sel ? " selected" : ""}>${esc(e.nome)}</option>`).join("")}</select><div id="exGraf"></div></div></section>`;
      h += `<section class="secao"><header><h2>Todos os exercícios</h2><span class="cont">1ª semana → última</span></header><div class="card"><div class="tabela"><table><thead><tr><th>Exercício</th><th>Início</th><th>Agora</th><th>Variação</th></tr></thead><tbody>${ordenados.map(e => {
        const ws = Object.keys(e.semanas).map(Number).sort((x,y) => x-y), p = e.semanas[ws[0]], u = e.semanas[ws[ws.length-1]];
        const v = p.kg > 0 ? Math.round(100 * (u.kg - p.kg) / p.kg) : null;
        return `<tr><td>${esc(e.nome)}</td><td>${fmt(p.kg)} kg</td><td>${fmt(u.kg)} kg</td><td class="${v > 0 ? "sobe" : v < 0 ? "desce" : ""}">${v == null || ws.length < 2 ? "—" : (v > 0 ? "+" : "") + v + "%"}</td></tr>`; }).join("")}</tbody></table></div></div></section>`;
    } else h += `<div class="card"><p class="vazio">Ainda não há cargas anotadas nas abas Registro.</p></div>`;
  } else if (a.protocolo) h += `<div class="card"><p class="vazio">Este Protocolo é do modelo antigo (sem abas Registro). As cargas ficam no Controle de carga.</p></div>`;
  h += avaliacaoHtml(d);
  $("corpo").innerHTML = h;
  const sel = $("exSel");
  if (sel){
    const desenhar = () => { const e = evolucaoPorExercicio(d.reg).find(x => x.nome === sel.value); if (!e) return; guardar("t_ex:" + a.chave, e.nome);
      const ws = Object.keys(e.semanas).map(Number).sort((x,y) => x-y);
      $("exGraf").innerHTML = grafico(ws.map(w => ({x: "S" + w, y: e.semanas[w].kg, dica: `Semana ${w}: ${fmt(e.semanas[w].kg)} kg × ${e.semanas[w].reps}`})), {titulo: "Carga de " + e.nome});
      ligarDicas($("exGraf")); };
    sel.onchange = desenhar; desenhar();
  }
  ligarDicas($("corpo"));
}
// planilha "Avaliação <Nome>", aba Avaliações (B10:I52): rótulo na coluna B, avaliações de D a I
function avaliacaoHtml(d){
  if (d.avaliacaoAntiga) return `<section class="secao"><header><h2>Avaliação física</h2></header><div class="card"><p class="sub">A planilha de avaliação deste aluno ainda é do modelo antigo (abas Avaliação 1 a 6).</p>${d.avaliacaoUrl ? `<div class="acoes"><a class="btn" href="${esc(d.avaliacaoUrl)}" target="_blank" rel="noopener">Abrir a avaliação</a></div>` : ""}</div></section>`;
  if (!d.avaliacao) return "";
  const v = d.avaliacao, linha = rot => v.find(r => txt(r[0]) === rot);
  const datas = (linha("Data da avaliação") || []).slice(2);
  const cols = datas.map((x,i) => i).filter(i => txt(datas[i]));
  if (!cols.length) return `<section class="secao"><header><h2>Avaliação física</h2></header><div class="card"><p class="vazio">Nenhuma avaliação preenchida ainda.</p></div></section>`;
  const medidas = [["Peso","kg"],["% de gordura","%"],["Massa magra","kg"],["Massa gorda","kg"],["Cintura","cm"],["Abdômen","cm"],["Quadril","cm"],["Soma das 7 dobras","mm"],["IMC",""]];
  const rotData = i => { const x = txt(datas[i]); const m = /^(\d{1,2})\/(\d{1,2})/.exec(x); return m ? `${m[1].padStart(2,"0")}/${m[2].padStart(2,"0")}` : "Av " + (i+1); };
  let h = `<section class="secao"><header><h2>Avaliação física</h2><span class="cont">${plural(cols.length, "avaliação", "avaliações")}</span></header>`;
  ["Peso","% de gordura"].forEach(rot => { const l = linha(rot); if (!l) return; const pts = cols.map(i => ({x: rotData(i), y: lerPlanilha(l[2+i])})).filter(p => p.y !== "");
    if (pts.length) h += `<div class="card"><h3>${rot === "Peso" ? "Peso (kg)" : "% de gordura"}</h3>${grafico(pts.map(p => ({...p, dica: `${p.x}: ${fmt(p.y)}${rot === "Peso" ? " kg" : "%"}`})), {titulo: rot})}</div>`; });
  h += `<div class="card"><div class="tabela"><table><thead><tr><th>Medida</th>${cols.map(i => `<th>${rotData(i)}</th>`).join("")}${cols.length > 1 ? "<th>Mudou</th>" : ""}</tr></thead><tbody>`;
  medidas.forEach(([rot, un]) => { const l = linha(rot); if (!l) return; const vals = cols.map(i => lerPlanilha(l[2+i])); if (vals.every(x => x === "")) return;
    const ok = vals.filter(x => x !== ""), dif = ok.length > 1 ? ok[ok.length-1] - ok[0] : null;
    h += `<tr><td>${rot}${un ? ` (${un})` : ""}</td>${vals.map(x => `<td>${x === "" ? "—" : fmt(x)}</td>`).join("")}${cols.length > 1 ? `<td>${dif == null ? "—" : (dif > 0 ? "+" : "") + fmt(Math.round(dif*10)/10)}</td>` : ""}</tr>`; });
  h += `</tbody></table></div>${d.avaliacaoUrl ? `<div class="acoes"><a class="btn" href="${esc(d.avaliacaoUrl)}" target="_blank" rel="noopener">Abrir a avaliação</a></div>` : ""}</div></section>`;
  return h;
}

// ---------- REGISTRAR (cargas do aluno, igual ao app do aluno, sem os recados) ----------
let P = null, SEM = null, atual = 0, semanaN = 1, RA = null, precisaRender = false;
function data(s, base){
  if (!s) return null;
  const [d,m,y] = s.split("/").map(Number); if (!d || !m) return null;
  const hoje = base || new Date();
  const ano = y ? (y < 100 ? 2000 + y : y) : hoje.getFullYear();
  let dt = new Date(ano, m-1, d);
  if (!y && dt - hoje > 60*DIA_MS) dt = new Date(ano-1, m-1, d);
  return dt;
}
function semanaDe(dt){ if (!P.ini) return 1; return Math.floor((dt - P.ini) / (7*DIA_MS)) + 1; }
function dataDoDia(N, d){ if (!P.ini) return null; const x = new Date(P.ini); x.setDate(x.getDate() + 7*(N-1) + OFFSET[d]); return x; }
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
  Object.values(FILA).filter(op => op.aluno === RA.chave).forEach(aplicarOp);
}
function aplicarOp(op){
  if (op.tipo === "treino"){
    const reg = P.reg[op.aba] || (P.reg[op.aba] = []);
    op.linhas.forEach((row,i) => { const k = linhaReg(op.semana, i+1); const at = reg[k] || (reg[k] = []);
      for (let c = 0; c < 10; c++) at[c+1] = row[c] === "" ? "" : fmt(row[c]); });
  } else if (op.tipo === "cardio") P.cardio[op.semana+"|"+op.dia] = {minutos: op.minutos, bpm: op.bpm, recado: op.recado};
}
function registrarAluno(a){
  RA = a; montarDados(DADOS[a.chave]);
  const w = Math.min(12, Math.max(1, semanaDe(hojeZero())));
  const guardada = ler("t_sem:" + a.chave);
  montarSemana(guardada && guardada.em > Date.now() - 3*3600e3 ? guardada.semana : w, false);
}
function montarSemana(N, manterDia){
  semanaN = N; guardar("t_sem:" + RA.chave, {semana: N, em: Date.now()});
  const faixa = P.faixas[N] || "", aer = P.aerobicos.find(b => b.semanas.includes(N)), ds = [];
  ORDEM.forEach(d => {
    const L = P.periodo[d] || "", cardio = (aer && aer.dias[d]) || ""; if (!L && !cardio) return;
    const aba = P.abas[d] || L, reg = P.reg[aba] || [];
    const exs = (P.treinos[L]||[]).map((e,i) => { const m = /(\d+)\s*s[ée]ries?\b/.exec(txt((reg[linhaReg(N,i+1)]||[])[0]));
      return {...e, series: Math.min(5, m ? +m[1] : e.series), video: P.videos[e.nome.trim()] || ""}; });
    ds.push({dia: d, treino: L, aba, cardio, exercicios: exs});
  });
  SEM = {semana: N, faixa, dias: ds};
  const hoje = SEMANA_JS[new Date().getDay()];
  if (!manterDia){ const i = ds.findIndex(d => d.dia === hoje); atual = i >= 0 && semanaDe(hojeZero()) === N ? i : 0; }
  atual = Math.min(atual, Math.max(0, ds.length-1));
  renderRegistro();
}
function descanso(faixa){ const m = /(\d+)\s*a\s*\d+/.exec(faixa||""); if (!m) return 90; const n = +m[1]; return n >= 15 ? 40 : n >= 12 ? 60 : n >= 8 ? 90 : 120; }
function celula(aba, N, k, c){ return ((P.reg[aba]||[])[linhaReg(N,k)]||[])[c]; }
function reps(d, k, s){ return lerPlanilha(celula(d.aba, semanaN, k, 2*s-1)); }
function kg(d, k, s){ return lerPlanilha(celula(d.aba, semanaN, k, 2*s)); }
function recadoEx(d, k){ return txt(celula(d.aba, semanaN, k, COL_RECADO)); }
function exOk(d, k, ex){ if (!ex.series) return false; for (let s = 1; s <= ex.series; s++) if (reps(d,k,s) === "") return false; return true; }
function diaFeito(n){ const d = SEM.dias[n]; if (!d) return false;
  if (d.exercicios.length) return d.exercicios.every((ex,i) => exOk(d,i+1,ex));
  const c = P.cardio[semanaN+"|"+d.dia]; return !!(c && c.minutos !== ""); }
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
function confere(tipo, valor, ref, faixa){
  if (valor === "" || valor == null) return "";
  if (tipo === "kg"){
    if (ref && ref.kg > 0 && (valor >= ref.kg * 2.5 || valor <= ref.kg / 2.5)) return `Confere? Na semana ${ref.semana} foi ${fmt(ref.kg)} kg.`;
    if (!ref && valor > 300) return `Confere? ${fmt(valor)} kg.`;
  } else { const topo = Number(((faixa||"").match(/(\d+)\s*$/)||[])[1]) || 25; if (valor > Math.max(40, topo * 2)) return `Confere? ${valor} repetições.`; }
  return "";
}
function recorde(d, k, ex){
  const h = historico(ex.nome, semanaN); if (!h.length) return null;
  const antes = h.flatMap(x => x.series), agora = [], ant = anterior(ex.nome, semanaN);
  for (let s = 1; s <= ex.series; s++){ const r = reps(d,k,s), q = kg(d,k,s), a = ant && ant.series[s-1];
    if (confere("kg", q, a ? {kg: a.kg, semana: ant.semana} : null) || confere("reps", r, null, SEM.faixa)) continue;
    if (r !== "" && r > 0) agora.push({reps: r, kg: q === "" ? 0 : q}); }
  if (!agora.length) return null;
  const maxAntes = Math.max(...antes.map(x => x.kg)), maxAgora = Math.max(...agora.map(x => x.kg));
  if (maxAgora > maxAntes && maxAgora > 0){ const r = Math.max(...agora.filter(x => x.kg === maxAgora).map(x => x.reps));
    return `Recorde de carga: ${fmt(maxAgora)} kg × ${r} (antes ${fmt(maxAntes)} kg)`; }
  let melhor = null;
  agora.forEach(x => { const ref = antes.filter(y => y.kg >= x.kg); const mr = ref.length ? Math.max(...ref.map(y => y.reps)) : 0;
    if (ref.length && x.reps > mr && (!melhor || x.kg > melhor.kg || (x.kg === melhor.kg && x.reps > melhor.reps))) melhor = {...x, antes: mr}; });
  return melhor ? `Recorde de repetições: ${melhor.reps} com ${fmt(melhor.kg)} kg (antes ${melhor.antes})` : null;
}
function grupos(exs){ const tem = []; let i = 0;
  while (i < exs.length){ const t = exs[i].tecnica, tam = SEGUIDOS[t] || 1; let j = i;
    while (j < exs.length && j < i + tam && exs[j].tecnica === t) j++;
    for (let k = i; k < j; k++) tem[k] = (k === j-1); i = j; } return tem; }
function campo(id, rot, val, ph, dec){
  return `<div class="campo"><input id="${id}" inputmode="${dec ? "decimal" : "numeric"}" enterkeyhint="next" autocomplete="off" value="${val === "" ? "" : fmt(val)}" placeholder="${esc(ph)}" aria-label="${rot}"><label for="${id}">${rot}</label></div>`;
}
function renderRegistro(){
  const corpo = $("corpo"); if (!corpo) return;
  const N = semanaN, ini = dataDoDia(N,"SEG"), fim = dataDoDia(N,"DOM"), hoje = SEMANA_JS[new Date().getDay()], estaSemana = semanaDe(hojeZero()) === N;
  let h = `<div class="meta"><span class="pill semnav"><button type="button" id="semAnt" aria-label="Semana anterior"${N <= 1 ? " disabled" : ""}>‹</button>Semana <b>${N}</b><small>${ini ? ` ${dd(ini)}–${dd(fim)}` : ""}</small><button type="button" id="semProx" aria-label="Próxima semana"${N >= 12 ? " disabled" : ""}>›</button></span>
    <span class="pill">Faixa <b>${esc(SEM.faixa || "—")}</b></span><span class="pill">Descanso <b>${mmss(descanso(SEM.faixa))}</b></span></div>`;
  if (!P.ini) h += `<div class="card"><p class="sub">A planilha ainda não tem a data de entrega: as semanas não batem com o calendário.</p></div>`;
  h += `<nav class="dias" role="tablist" aria-label="Dias">${SEM.dias.map((d,n) => `<button type="button" class="dia${diaFeito(n) ? " feito" : ""}${estaSemana && d.dia === hoje ? " hoje" : ""}" role="tab" aria-selected="${n === atual}" data-dia="${n}"><small>${estaSemana && d.dia === hoje ? "HOJE" : d.dia}</small><strong>${d.treino || "♥"}</strong></button>`).join("")}</nav>`;
  const d = SEM.dias[atual];
  if (!d){ corpo.innerHTML = h + `<p class="vazio">Nenhum treino na periodização desta semana.</p>`; ligarRegistro(); return; }
  const dt = dataDoDia(N, d.dia), REST = descanso(SEM.faixa), desc = grupos(d.exercicios), lo = (SEM.faixa||"").split(" a ")[0] || "0";
  h += `<div class="tit-dia"><h2>${NOMES[d.dia]}${d.treino ? " · Treino " + d.treino : ""}</h2><span class="contagem" id="cont"></span></div>${dt ? `<p class="sub" style="margin-top:-8px">${ddaaaa(dt)}${d.aba !== d.treino && d.treino ? ` · anotado na aba Registro ${d.aba}` : ""}</p>` : ""}`;
  d.exercicios.forEach((ex,i) => { const k = i+1, ant = anterior(ex.nome, N); let s = "";
    for (let si = 1; si <= ex.series; si++){ const a = ant && ant.series[si-1], r = reps(d,k,si), q = kg(d,k,si);
      s += `<div class="serie"><span>S${si}</span>${campo(`e${k}s${si}r`,"reps",r,lo)}${campo(`e${k}s${si}k`,"kg",q,a ? fmt(a.kg) : "0",true)}
        ${a ? `<div class="antes">Semana ${ant.semana}: ${a.reps} reps × ${fmt(a.kg)} kg</div>` : ""}<div class="confere" id="cf-${k}-${si}">${esc(confere("kg", q, a ? {kg: a.kg, semana: ant.semana} : null) || confere("reps", r, null, SEM.faixa))}</div></div>`; }
    const rec = recorde(d,k,ex), msg = recadoEx(d,k);
    h += `<article class="ex${exOk(d,k,ex) ? " ok" : ""}" id="ex-${k}"><div class="ex-top"><span class="num">${k}</span><div class="ex-nome"><h3>${esc(ex.nome)}</h3><p>${plural(ex.series, "série")} · ${esc(SEM.faixa)} reps</p>${ex.tecnica ? `<span class="tec">${esc(ex.tecnica)}</span>` : ""}</div></div>
      ${ex.obs ? `<div class="obs">${esc(ex.obs)}</div>` : ""}${msg ? `<div class="recmsg">Recado do aluno: “${esc(msg)}”</div>` : ""}
      <div class="recorde" id="rec-${k}" ${rec ? "" : "hidden"}>🏆 ${rec ? esc(rec) : ""}</div><div class="series">${s}</div>
      <div class="acoes">${ant ? `<button class="btn" type="button" data-repetir="${k}">Mesma carga da semana ${ant.semana}</button>` : ""}
        ${desc[i] ? `<button class="btn amarelo" type="button" data-desc="${esc(ex.nome)}">Descanso ${mmss(REST)}</button>` : `<span class="sub">Sem descanso: direto para o próximo.</span>`}
        ${ex.video ? `<a class="btn" href="${esc(ex.video)}" target="_blank" rel="noopener">▶ Vídeo</a>` : ""}</div></article>`; });
  if (d.cardio){ const c = P.cardio[N+"|"+d.dia] || {};
    h += `<div class="ex"><div class="ex-top"><span class="num">♥</span><div class="ex-nome"><h3>Aeróbico</h3><p>${esc(d.cardio)}</p></div></div><div class="cardio">${campo("cmin","min",c.minutos ?? "","0")}${campo("cbpm","bpm",c.bpm ?? "","0")}</div>${c.recado ? `<div class="recmsg">Recado do aluno: “${esc(c.recado)}”</div>` : ""}</div>`; }
  h += `<p class="sub">Cada número vai sozinho para a planilha de ${esc(primeiro(RA.nome))} (abas Registro). Sem internet, fica guardado no celular e vai quando o sinal voltar.</p>`;
  corpo.innerHTML = h; contagem(); ligarRegistro();
}
function ligarRegistro(){
  const corpo = $("corpo"), d = SEM.dias[atual];
  const sa = $("semAnt"), sp = $("semProx");
  if (sa) sa.onclick = () => montarSemana(semanaN-1, false);
  if (sp) sp.onclick = () => montarSemana(semanaN+1, false);
  corpo.querySelectorAll("[data-dia]").forEach(b => b.onclick = () => { atual = +b.dataset.dia; renderRegistro(); });
  if (!d) return;
  corpo.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("input", () => digitou(inp));
    inp.addEventListener("keydown", e => { if (e.key === "Enter"){ e.preventDefault(); const todos = [...corpo.querySelectorAll("input")]; const p = todos[todos.indexOf(inp)+1]; p ? p.focus() : inp.blur(); } });
    inp.addEventListener("blur", () => { if (precisaRender) setTimeout(() => { if (!document.activeElement || document.activeElement.tagName !== "INPUT"){ precisaRender = false; montarDados(DADOS[RA.chave]); montarSemana(semanaN, true); } }, 50); });
  });
  corpo.querySelectorAll("[data-repetir]").forEach(b => b.onclick = () => { const k = +b.dataset.repetir, ex = d.exercicios[k-1], ant = anterior(ex.nome, semanaN);
    (ant ? ant.series : []).forEach((a,si) => { if (!a || si >= ex.series) return; const el = $(`e${k}s${si+1}k`); if (el && el.value === ""){ el.value = fmt(a.kg); digitou(el); } }); });
  corpo.querySelectorAll("[data-desc]").forEach(b => b.onclick = () => iniciar(b.dataset.desc));
}
function digitou(inp){
  const d = SEM.dias[atual], m = /^e(\d+)s(\d+)([rk])$/.exec(inp.id), c = /^c(min|bpm)$/.exec(inp.id), val = lerDigitado(inp.value);
  if (m){
    const k = +m[1], s = +m[2], ex = d.exercicios[k-1], reg = P.reg[d.aba] || (P.reg[d.aba] = []);
    const row = reg[linhaReg(semanaN,k)] || (reg[linhaReg(semanaN,k)] = [ex.nome]);
    const v = m[3] === "r" ? (val === "" ? "" : Math.round(val)) : val;
    row[m[3] === "r" ? 2*s-1 : 2*s] = v === "" ? "" : fmt(v);
    $(`ex-${k}`).classList.toggle("ok", exOk(d,k,ex));
    const ant = anterior(ex.nome, semanaN), a = ant && ant.series[s-1];
    $(`cf-${k}-${s}`).textContent = confere("kg", kg(d,k,s), a ? {kg: a.kg, semana: ant.semana} : null) || confere("reps", reps(d,k,s), null, SEM.faixa);
    const el = $(`rec-${k}`), antes = el.hidden, rec = recorde(d,k,ex);
    el.hidden = !rec; el.textContent = rec ? "🏆 " + rec : "";
    if (rec && antes){ aviso("🏆 " + rec); try { navigator.vibrate && navigator.vibrate(60); } catch(e){} }
    const linhas = d.exercicios.map((ex2,i) => { const r = []; for (let q = 1; q <= 5; q++){ r.push(q <= ex2.series ? reps(d,i+1,q) : ""); r.push(q <= ex2.series ? kg(d,i+1,q) : ""); } return r; });
    enfileirar({tipo: "treino", aba: d.aba, semana: semanaN, linhas});
  }
  if (c){ const ch = semanaN+"|"+d.dia, o = P.cardio[ch] || (P.cardio[ch] = {minutos:"", bpm:"", recado:""});
    o[c[1] === "min" ? "minutos" : "bpm"] = val === "" ? "" : Math.round(val);
    const dt = dataDoDia(semanaN, d.dia);
    enfileirar({tipo: "cardio", semana: semanaN, dia: d.dia, data: dt ? ddaaaa(dt) : "", prescrito: d.cardio, minutos: o.minutos ?? "", bpm: o.bpm ?? "", recado: o.recado || ""}); }
  contagem();
  document.querySelectorAll("[data-dia]").forEach(b => b.classList.toggle("feito", diaFeito(+b.dataset.dia)));
}
function contagem(){ const d = SEM.dias[atual], el = $("cont"); if (!el || !d) return; el.textContent = d.exercicios.length ? `${d.exercicios.filter((ex,i) => exOk(d,i+1,ex)).length} de ${d.exercicios.length} feitos` : ""; }
function pararSemSalvar(){ /* a fila já guarda tudo; nada a fazer ao trocar de tela */ }

// ---------- fila: tudo fica no celular até a planilha confirmar ----------
let timerEnvio = null, enviando = false, tentativas = 0, gravacoes = 0;
function enfileirar(op){
  op.aluno = RA.chave; op.nome = RA.nome;
  const chave = op.tipo === "treino" ? `t|${op.aluno}|${op.aba}|${op.semana}` : `c|${op.aluno}|${op.semana}|${op.dia}`;
  op.v = Date.now() + Math.random(); op.chave = chave; FILA[chave] = op;
  mostrarStatus(guardar("t_fila", FILA) ? "local" : "erro");
  clearTimeout(timerEnvio); timerEnvio = setTimeout(enviar, 1200);
}
async function enviar(){
  clearTimeout(timerEnvio);
  const ops = Object.values(FILA); if (!ops.length){ mostrarStatus(); return; }
  if (enviando){ timerEnvio = setTimeout(enviar, 800); return; }
  if (navigator.onLine === false){ mostrarStatus("offline"); return; }
  enviando = true; mostrarStatus("salvando");
  const aluno = ops[0].aluno, lote = ops.filter(o => o.aluno === aluno).slice(0, 50);
  try {
    await chamar({acao: "t_lote", aluno, ops: lote.map(({v, chave, aluno, nome, ...o}) => o)});
    lote.forEach(o => { if (FILA[o.chave] && FILA[o.chave].v === o.v) delete FILA[o.chave]; });
    guardar("t_fila", FILA); tentativas = 0; gravacoes++; ultimaGravacao = new Date();
    const dados = DADOS[aluno]; if (dados) guardarDadosLocais(aluno);
    mostrarStatus();
    if (Object.keys(FILA).length) timerEnvio = setTimeout(enviar, 300);
  } catch(e){
    tentativas++; mostrarStatus(e.servidor ? "erro-servidor" : "erro", e.message);
    timerEnvio = setTimeout(enviar, Math.min(60000, 4000 * tentativas));
  } finally { enviando = false; }
}
function guardarDadosLocais(chave){ // o que já foi para a planilha também fica no celular (abre sem sinal com os números novos)
  if (!P || !RA || RA.chave !== chave) return;
  const d = DADOS[chave]; d.reg = P.reg; d.cardio = Object.entries(P.cardio).map(([k,o]) => { const [s,dia] = k.split("|"); return [s, dia, "", "", o.minutos, o.bpm, o.recado]; });
  guardar("t_aluno:" + chave, d);
}
function enviarAoSair(){
  const ops = Object.values(FILA); if (!ops.length || window.__API_MOCK || !navigator.sendBeacon) return;
  const aluno = ops[0].aluno;
  try { navigator.sendBeacon(API, new Blob([JSON.stringify({acao: "t_lote", chave: CHAVE, aluno, ops: ops.filter(o => o.aluno === aluno).map(({v, chave, aluno, nome, ...o}) => o)})], {type: "text/plain"})); } catch(e){}
}
let ultimaGravacao = null;
function mostrarStatus(estado, detalhe){
  const s = $("status"); s.hidden = false; const n = Object.keys(FILA).length; s.onclick = null;
  if (!estado) estado = n ? "local" : "ok";
  const h = d => `${d.getHours()}:${String(d.getMinutes()).padStart(2,"0")}`;
  const textos = {
    ok: ultimaGravacao ? `Tudo salvo nas planilhas (${h(ultimaGravacao)})` : ultimaLeitura ? `Atualizado às ${h(ultimaLeitura)}` : "Ligado ao Drive",
    local: "Guardado no celular. Enviando para a planilha…",
    salvando: "Enviando para a planilha…",
    offline: `Sem internet: ${plural(n, "treino guardado", "treinos guardados")} no celular. Envio sozinho quando a internet voltar.`,
    erro: "Não consegui enviar agora. Está guardado no celular; tento de novo sozinho. Toque para tentar já.",
    "erro-servidor": `A planilha não aceitou: ${detalhe || "erro"}. Está guardado no celular. Toque para tentar de novo.`,
    atualizando: "Lendo o Drive…",
    velho: ultimaLeitura ? `Sem internet: mostrando o que foi lido às ${h(ultimaLeitura)} de ${dd(ultimaLeitura)}.` : "Sem internet."
  };
  s.textContent = textos[estado] || textos.ok;
  s.className = "status " + ({ok:"ok", local:"local", salvando:"salvando", offline:"local", erro:"erro", "erro-servidor":"erro", atualizando:"salvando", velho:"local"}[estado] || "");
  if (estado.startsWith("erro")) s.onclick = () => { tentativas = 0; enviar(); };
}
let toastT = null;
function aviso(t){ const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 3500); }

// ---------- cronômetro de descanso ----------
let fim = 0, tick = null, ctx = null, trava = null; const T = $("timer");
async function manterTela(on){
  try { if (on && "wakeLock" in navigator && !trava){ trava = await navigator.wakeLock.request("screen"); trava.addEventListener("release", () => { trava = null; }); }
    if (!on && trava){ await trava.release(); trava = null; } } catch(e){ trava = null; }
}
function bip(){
  try { ctx ||= new (window.AudioContext || window.webkitAudioContext)(); const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = .15; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + .35); } catch(e){}
  try { navigator.vibrate && navigator.vibrate([200,100,200]); } catch(e){}
}
function iniciar(rot){
  try { ctx ||= new (window.AudioContext || window.webkitAudioContext)(); ctx.resume && ctx.resume(); } catch(e){}
  fim = Date.now() + descanso(SEM.faixa)*1000; T.hidden = false; document.body.classList.add("timer-on"); T.classList.remove("fim"); $("trotulo").textContent = "Descanso · " + rot;
  clearInterval(tick); tick = setInterval(passo, 250); passo(); manterTela(true);
}
function passo(){ const s = Math.max(0, Math.ceil((fim - Date.now())/1000)); $("tempo").textContent = mmss(s);
  if (s === 0){ clearInterval(tick); tick = null; T.classList.add("fim"); $("trotulo").textContent = "Próxima série!"; bip(); setTimeout(() => { if (!tick) manterTela(false); }, 60000); } }
$("mais").onclick = () => { fim = Math.max(fim, Date.now()) + 15000; T.classList.remove("fim"); clearInterval(tick); tick = setInterval(passo, 250); passo(); manterTela(true); };
$("parar").onclick = () => { clearInterval(tick); tick = null; T.hidden = true; document.body.classList.remove("timer-on"); manterTela(false); };

// ---------- abrir ----------
let lendo = false;
async function atualizar(){
  if (!CHAVE || lendo) return; lendo = true;
  if (INICIO) mostrarStatus(navigator.onLine === false ? "velho" : "atualizando");
  const g0 = gravacoes;
  try {
    const j = await chamar({acao: "t_inicio"}, 90000);
    if (gravacoes !== g0){ lendo = false; setTimeout(atualizar, 500); return; }
    INICIO = {alunos: j.alunos, agenda: j.agenda, agendaErro: j.agendaErro || "", lido_em: j.lido_em}; ultimaLeitura = new Date(j.lido_em); guardar("t_inicio", INICIO);
    const r = rota(), foco = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (!(r.tela === "a" && r.aba !== "resumo") && !foco) render(false);
    else if (r.tela === "a" && r.aba === "registrar" && !$("corpo")) render(false);
    mostrarStatus(Object.keys(FILA).length ? "local" : "ok");
    enviar();
  } catch(e){
    if (e.servidor && /chave/i.test(e.message)){ $("tela").innerHTML = `<div class="card"><h2>Chave errada</h2><p class="sub">O servidor não reconheceu a sua chave. Abra de novo pelo link que o Claude mandou.</p></div>`; }
    else if (INICIO) mostrarStatus(e.servidor ? "erro-servidor" : "velho", e.message);
    else $("tela").innerHTML = `<div class="card"><h2>Não consegui abrir</h2><p class="sub">${esc(e.servidor ? e.message : "Sem internet. Na primeira vez, o app precisa de internet para ler os seus alunos no Drive.")}</p><button class="btn amarelo" type="button" id="tentar">Tentar de novo</button></div>`,
      $("tentar") && ($("tentar").onclick = atualizar);
  } finally { lendo = false; }
}
$("recarregar").onclick = () => { atualizar(); const r = rota(); if (r.tela === "a" && r.aba !== "resumo"){ const a = alunoPorChave(r.chave); if (a) carregarAluno(a, () => r.aba === "evolucao" ? evolucaoAluno(a) : registrarAluno(a)); } };
window.addEventListener("online", () => { tentativas = 0; enviar(); });
window.addEventListener("offline", () => mostrarStatus(Object.keys(FILA).length ? "offline" : "velho"));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") enviarAoSair();
  else { if (tick) manterTela(true); if (INICIO && Date.now() - (ultimaLeitura || 0) > 10*60e3) atualizar(); }
});
window.addEventListener("pagehide", enviarAoSair);
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost") && !window.__API_MOCK)
  navigator.serviceWorker.register("sw.js").catch(() => {});

render(false);
if (CHAVE){ if (INICIO) mostrarStatus(Object.keys(FILA).length ? "local" : "ok"); atualizar(); }
