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
const COL_PSE = 15;      // colunas Q a U: PSE (0 a 10) de cada série; série s na coluna COL_PSE + s (desde 13/11/2026)
const PSE_DESDE = 6;     // versão do servidor que grava a PSE
const COL_DICA = 15;   // coluna P das abas Registro: dica do treinador (o aluno vê no app dele)
const FORM_FOTOS = "https://forms.gle/Jc9hwKyR9xHa6WP17";
const cardioValido = t => !!t && (/\d/.test(t) || !/^min,?\s*manter uma m[ée]dia de\s*bpm\.?$/i.test(t.replace(/\s+/g, " ").trim()));
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
    return ["atencao", n === 0 ? "A revisão é hoje: o aluno vai renovar?" : `O ciclo acabou há ${tempo(n)} (revisão em ${dd(c.revisao)}): renovou ou parou?`];
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
  else if (r.tela === "fin") telaFin();
  else if (r.tela === "leads") telaLeads();
  else if (r.tela === "avisos") telaAvisos();
  else telaHoje();
  if (rolar) window.scrollTo({top: 0});
}

function telaSemChave(){
  $("nav").hidden = true;
  $("tela").innerHTML = `<div class="card"><h2>Abra pelo seu link</h2><p class="sub">Este app é só seu. Abra pelo link com a sua chave, que o Claude te mandou no chat. Depois de abrir uma vez, ele lembra sozinho.</p>
  <label class="sub" for="ch">Ou cole a chave aqui:</label><input class="busca" id="ch" autocomplete="off"><button class="btn amarelo" type="button" id="okch">Entrar</button></div>`;
  $("okch").onclick = () => { const v = $("ch").value.replace(/[^A-Za-z0-9]/g, ""); if (v.length >= 24){ guardar("t_chave", v); location.hash = "#/hoje"; location.reload(); } };
}

// ---------- WhatsApp: as mensagens são as de ferramentas/mensagens-whatsapp/mensagens-whatsapp.md e da skill secretaria ----------
const MSG = {
  conversa: a => `Oi, ${primeiro(a.nome)}! `,
  // "Treino chegou: app", com o link do app DESTE aluno (planilha de acessos; servidor versão 5)
  treino: a => `${primeiro(a.nome)}, seu treino chegou! 🎉\n\nEle fica no seu app de treino, feito só pra você:\n${a.app}\n\nAbre no celular e coloca na tela inicial (o próprio app mostra como): ele fica com a minha logo e funciona até sem internet na academia.\n\nEm cada dia de treino, o app mostra os exercícios, o que você fez da última vez e o cronômetro de descanso. Anota as repetições e a carga de cada série: tudo chega direto pra mim, não precisa me mandar nada 😉\n\nE o mais importante: grava os exercícios *de lado ou de costas* e me manda aqui, principalmente os novos e quando a carga subir. É assim que eu corrijo a sua execução pra você não treinar errado 💪`,
  registro: (a, N) => `Oi, ${primeiro(a.nome)}! Como está sendo a semana de treino? 💪\n\nVi que faltam treinos anotados no app esta semana. Se você já treinou, anota lá as repetições e as cargas de cada série, tá? É com elas que eu acompanho a sua evolução e ajusto o seu treino 🙂`,
  fotos: a => `Oi, ${primeiro(a.nome)}! Chegou o dia da sua reavaliação 📸\n\nÉ tudo pelo mesmo formulário:\n• as 4 fotos (lembra do Guia de fotos: mesmo lugar, mesma luz e mesmo horário)\n• o feedback do mês, que leva uns 2 minutinhos\n\n${FORM_FOTOS}\n\nMe manda até sábado, que no domingo te envio o seu relatório de evolução 📈`,
  // umas 2 semanas antes do fim do plano; depois do fim, o lembrete curto
  renovar: a => { const fim = fimDoPlano(ciclo(a)); if (!fim || hojeZero() > fim) return MSG.lembrarRenovar(a); return MSG.textoRenovar(a.nome, fim); },
  // financeiro: o fim do plano vem da aba Alunos da planilha do financeiro
  renovarFin: (nome, fimIso) => { const fim = isoData(fimIso); if (!fim || hojeZero() > fim) return MSG.lembrarRenovar({nome}); return MSG.textoRenovar(nome, fim); },
  // cobrança de pagamento em aberto (skill financeiro, seção 6)
  cobrar: (nome, plano) => `Oi, ${primeiro(nome)}! Tudo bem? 😊\n\nPassando pra lembrar do pagamento do seu plano ${plano}, que ainda não apareceu aqui pra mim. Se já pagou, me manda o comprovante que eu confiro. Se precisar do link de novo, é só falar!`,
  textoRenovar: (nome, fim) => {
    return `Oi, ${primeiro(nome)}! Tudo bem? 😊\n\nPassando com antecedência pra você se organizar: o seu plano vai até ${NOMES[SEMANA_JS[fim.getDay()]].toLowerCase()}, dia ${dd(fim)}. Estamos na reta final do ciclo! 🏁\n\nFoi muito bom acompanhar a sua evolução até aqui 💪 E o próximo ciclo não começa do zero: eu monto o treino novo em cima da sua reavaliação de fim de ciclo (fotos e relatório), com o que você já conquistou e o que ainda dá pra melhorar.\n\nConfirmando agora, dá tempo de eu preparar tudo com calma: o treino novo chega nesse mesmo domingo e você já começa na segunda, sem ficar nem um dia parado.\n\nBora pro próximo? Me fala se vai seguir no mesmo plano ou se prefere trocar de plano, que eu te mando o link pra renovar 🙂\n\nE se tiver alguma coisa que você quer mudar no próximo ciclo (dias de treino, foco, algum exercício), me conta também!`; },
  lembrarRenovar: a => `Oi, ${primeiro(a.nome)}! Conseguiu pensar no próximo ciclo? 😊 Me fala se vai seguir comigo, que eu já deixo o seu treino novo pronto 💪`
};
// domingo em que o plano acaba: o da semana da revisão (revisão numa segunda = começo do ciclo seguinte), como na skill secretaria
function fimDoPlano(c){
  if (!c.revisao) return null;
  const fim = new Date(c.revisao.getTime() - (c.revisao.getDay() === 1 ? DIA_MS : 0));
  return new Date(fim.getFullYear(), fim.getMonth(), fim.getDate() + (7 - fim.getDay()) % 7);
}
const zap = (a, texto) => `https://wa.me/${a.whats}?text=${encodeURIComponent(texto)}`;
function semanaACobrar(a){ const c = ciclo(a), u = (a.resumo || {}).ultima_semana || 0; return Math.max(1, Math.min(u + 1, c.concluidas || 1)); }
// link do app do aluno: só com o servidor na versão 5 ou mais nova
function avisoApp(a){
  if ((INICIO.versao || 0) < 5) return `<p class="sub">Para o botão "Enviar o treino" com o link do app de cada aluno, cole o código novo do servidor (página Ligar o app do treinador).</p>`;
  if (!a.app && a.modelo !== "sem_protocolo") return `<p class="sub">Sem link do app: este aluno não está ativo na planilha "App dos alunos - acessos".</p>`;
  return "";
}
function botoesZap(a){
  if (!a.whats) return `<p class="sub">Sem número de WhatsApp na anamnese deste aluno.</p>${avisoApp(a)}`;
  const b = (t, txt, amarelo) => `<a class="btn${amarelo ? " amarelo" : ""}" href="${esc(zap(a, txt))}" target="_blank" rel="noopener">${t}</a>`;
  const c = ciclo(a), N = semanaACobrar(a);
  return `<div class="acoes">${a.app ? b("Enviar o treino (link do app)", MSG.treino(a), true) : ""}${b("Abrir conversa", MSG.conversa(a))}${a.modelo === "novo" && c.concluidas ? b(`Cobrar o registro (semana ${N})`, MSG.registro(a, N)) : ""}${b("Pedir as fotos", MSG.fotos(a))}${c.revisao ? b("Perguntar se vai renovar", MSG.renovar(a)) + b("Lembrar da renovação", MSG.lembrarRenovar(a)) : ""}</div>${avisoApp(a)}`;
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
  h += cartaoAvisosHoje(alunos);

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

  // começam o treino: entrega de ontem até daqui a 7 dias (botão com o link do app de cada um)
  const com = alunos.map(a => [ciclo(a), a]).filter(([c, a]) => c.entrega && a.modelo !== "sem_protocolo" && dias(hoje, c.entrega) >= -1 && dias(hoje, c.entrega) <= 7).sort((x,y) => x[0].entrega - y[0].entrega);
  if (com.length){
    h += `<section class="secao"><header><h2>Começam o treino</h2><span class="cont">mande o link do app</span></header><div class="lista">${com.map(([c,a]) => { const n = dias(hoje, c.entrega);
      return `<div class="aluno"><span class="bola ${n <= 1 ? "aviso" : "ok"}"></span><span class="meio"><h3>${esc(a.nome)}</h3><p>${n > 1 ? `Começa em ${plural(n, "dia")} (${NOMES[SEMANA_JS[c.entrega.getDay()]].toLowerCase()}, ${dd(c.entrega)})` : n === 1 ? `Começa amanhã (${dd(c.entrega)})` : n === 0 ? "Começa hoje" : `Começou ontem (${dd(c.entrega)})`}</p></span>
        ${a.whats && a.app ? `<a class="btn amarelo" href="${esc(zap(a, MSG.treino(a)))}" target="_blank" rel="noopener">Enviar o treino</a>` : `<a class="btn" href="#/a/${a.chave}">Abrir</a>`}</div>`; }).join("")}</div></section>`;
  }

  // renovações: revisão nos próximos 14 dias (ou que passou há até 14 dias)
  const ren = alunos.map(a => [ciclo(a), a]).filter(([c]) => c.revisao && Math.abs(dias(hoje, c.revisao)) <= 14).sort((x,y) => x[0].revisao - y[0].revisao);
  if (ren.length){
    h += `<section class="secao"><header><h2>Renovações</h2><span class="cont">revisão em até 14 dias</span></header><div class="lista">${ren.map(([c,a]) => { const n = dias(hoje, c.revisao);
      return `<div class="aluno"><span class="bola ${n <= 0 ? "atencao" : n <= 7 ? "aviso" : "ok"}"></span><span class="meio"><h3>${esc(a.nome)}</h3><p>${n > 0 ? `Revisão em ${plural(n, "dia")} (${dd(c.revisao)})` : n === 0 ? "Revisão hoje" : `A revisão foi há ${plural(-n, "dia")} (${dd(c.revisao)})`}</p></span>
        ${a.whats ? `<a class="btn amarelo" href="${esc(zap(a, MSG.renovar(a)))}" target="_blank" rel="noopener">Perguntar</a>` : `<a class="btn" href="#/a/${a.chave}">Abrir</a>`}</div>`; }).join("")}</div></section>`;
  }

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
      `<div class="recado"><small>${esc(primeiro(x.a.nome))} · semana ${x.semana}</small>🏆 ${esc(x.exercicio)} · ${esc(x.texto || `${x.exercicio}: ${fmt(x.kg)} kg × ${x.reps}`)}</div>`).join("")}</div></section>`;
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
  const temProto = !!a.protocolo, abas = [["resumo","Resumo"],["evolucao","Evolução"]].concat(temProto ? [["registrar","Registrar"]] : []).concat(temProto && a.modelo === "novo" && (INICIO.versao || 0) >= PRESC_DESDE ? [["treino","Treino"]] : []).concat([["avaliacao","Avaliação"]]);
  if (!abas.some(x => x[0] === aba)) aba = "resumo";
  let h = `<a class="voltar" href="#/alunos">‹ Alunos</a>
    <div><div class="eyebrow">${a.modalidade === "presencial" ? "Presencial" : "Consultoria online"}</div><h1>${esc(a.nome)}</h1></div>
    <div class="situ"><span class="bola ${nivel}"></span><span>${esc(frase)}</span></div>
    <nav class="abas" aria-label="Partes do aluno">${abas.map(([k,t]) => `<a href="#/a/${a.chave}/${k}" aria-current="${k === aba ? "page" : "false"}">${t}</a>`).join("")}</nav>
    ${aba === "registrar" ? trocarAluno(a) : ""}
    <div id="corpo" class="wrap" style="width:100%"></div>`;
  $("tela").innerHTML = h;
  if (aba === "resumo") resumoAluno(a);
  else carregarAluno(a, () => abrirAba(a, aba));
}
function abrirAba(a, aba){ if (aba === "evolucao") evolucaoAluno(a); else if (aba === "treino") prescricaoAluno(a); else if (aba === "avaliacao") avaliacaoAluno(a); else registrarAluno(a); }

// no Registrar: os outros alunos com Protocolo, primeiro os do presencial que treinam hoje
function trocarAluno(atual){
  const d = SEMANA_JS[hojeZero().getDay()];
  const nota = a => (a.modalidade === "presencial" ? 0 : 2) + (a.resumo && a.resumo.periodo && a.resumo.periodo[d] ? 0 : 1);
  const outros = (INICIO.alunos || []).filter(a => a.protocolo && a.chave !== atual.chave).sort((x,y) => nota(x) - nota(y) || x.nome.localeCompare(y.nome));
  if (!outros.length) return "";
  return `<div class="trocar" aria-label="Trocar de aluno"><span class="sub">Trocar:</span>${outros.map(a => `<a class="chip-aluno${nota(a) === 0 ? " hoje" : ""}" href="#/a/${a.chave}/registrar">${esc(primeiro(a.nome))}${nota(a) === 0 ? " · hoje" : ""}</a>`).join("")}</div>`;
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
  if (a.app) links.push(`<a class="btn" href="${esc(a.app)}" target="_blank" rel="noopener">App do aluno</a>`);
  h += `<div class="acoes">${links.join("")}</div>`;
  h += `<section class="secao"><header><h2>WhatsApp</h2><span class="cont">mensagem pronta</span></header>${botoesZap(a)}</section>`;

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
      `<div class="recado"><small>Semana ${x.semana} · ${esc(x.exercicio)}</small>🏆 ${esc(x.texto || `${x.exercicio}: ${fmt(x.kg)} kg × ${x.reps}`)}</div>`).join("")}</div></section>`;
  if (a.lido_planilha_erro) h += `<p class="sub">${esc(a.lido_planilha_erro)}</p>`;
  // sugestão alimentar no app do aluno (servidor versão 15; pedido do criador): só com o ok do treinador e sem nutricionista
  if (a.app && (INICIO.versao || 0) >= 15){
    const tem = a.nutri === "Sim";
    h += `<section class="secao"><header><h2>Sugestão alimentar no app</h2><span class="cont">${a.dieta_app ? "aparece no app" : "não aparece"}</span></header><div class="card">
      <p class="sub">${tem ? "Na anamnese, este aluno disse que faz acompanhamento com nutricionista: a sugestão alimentar não vai para o app dele."
        : a.dieta_app ? `O cardápio da aba Cardápio aparece no app de ${esc(primeiro(a.nome))}, no botão "Sugestão alimentar". Mudou o cardápio? Ele vê o novo em até 30 minutos.`
        : `Para o aluno que quis a sugestão alimentar e não tem nutricionista. Antes, monte e aprove o cardápio comigo no chat ("monta a dieta de ${esc(primeiro(a.nome))}").${a.nutri ? "" : " A anamnese não diz se ele tem nutricionista: confira antes."}`}</p>
      <p class="sub" id="dietaMsg"></p>${tem ? "" : `<div class="acoes"><button class="btn${a.dieta_app ? "" : " amarelo"}" type="button" id="dietaApp">${a.dieta_app ? "Tirar do app do aluno" : "Mostrar no app do aluno"}</button></div>`}</div></section>`;
  }
  if (a.app && (INICIO.versao || 0) >= 17) h += secaoAvisoAluno(a);
  h += `<section class="secao" id="inatSecao"><header><h2>Aluno parou?</h2></header><div class="card">
    <p class="sub">Leva a pasta para Inativos, o contrato para Contratos Inativos e desliga o app do aluno. Nada é apagado: se ele voltar, me diga no chat "${esc(primeiro(a.nome))} voltou".</p>
    <p class="sub" id="inatMsg"></p><div class="acoes"><button class="btn" type="button" id="inativar">Inativar aluno</button></div></div></section>`;
  $("corpo").innerHTML = h;
  $("inativar").onclick = () => inativarAluno(a);
  ligarFormAviso("avA", t => ({acao: "t_aviso", aluno: a.chave, ...t}), j => j.depois ? "Guardado ✓ Sai às 7h (de noite, nada vai para o celular)." : j.aparelhos ? `Mandado ✓ Chegou em ${plural(j.aparelhos, "celular")}.` : `Guardado ✓ ${primeiro(a.nome)} não ligou os avisos no celular: vê no 🔔 quando abrir o app.`);
  if ($("dietaApp")) $("dietaApp").onclick = async () => {
    const ligar = !a.dieta_app, b = $("dietaApp"); b.disabled = true; $("dietaMsg").textContent = ligar ? "Conferindo o cardápio…" : "Tirando…";
    try { await chamar({acao: "t_dieta_app", aluno: a.chave, ligar}, 60000); a.dieta_app = ligar; guardar("t_inicio", INICIO); resumoAluno(a); }
    catch(e){ b.disabled = false; $("dietaMsg").textContent = e.servidor ? e.message : "Sem internet: tente de novo com sinal."; }
  };
  $("salvarAnot").onclick = async () => {
    const t = $("anot").value; $("anotMsg").textContent = "Salvando…";
    try { await chamar({acao: "t_nota", aluno: a.chave, nome: a.nome, texto: t}); a.anotacao = t; guardar("t_inicio", INICIO); $("anotMsg").textContent = "Salvo ✓"; }
    catch(e){ $("anotMsg").textContent = e.servidor ? "Não salvou: " + e.message : "Sem internet: não salvou. Tente de novo com sinal."; }
  };
}

// ---------- inativar aluno (servidor versão 13; skill estagiario, 3.2 e 3.5) ----------
async function inativarAluno(a){
  const msg = $("inatMsg"), btn = $("inativar");
  if (((INICIO && INICIO.versao) || 0) < 13){ msg.textContent = "Para isto, cole o código novo do servidor (página Ligar o app do treinador, versão 13) e toque em ↻."; return; }
  if (!confirm(`Inativar ${a.nome}? A pasta vai para Inativos, o contrato para Contratos Inativos e o app do aluno deixa de abrir. Nada é apagado.`)) return;
  btn.disabled = true; msg.textContent = "Inativando…";
  try {
    const j = await chamar({acao: "t_inativar", aluno: a.chave, nome: a.nome}, 60000);
    INICIO.alunos = (INICIO.alunos || []).filter(x => x.chave !== a.chave); guardar("t_inicio", INICIO);
    delete DADOS[a.chave]; try { localStorage.removeItem("t_aluno:" + a.chave); } catch(e){}
    $("inatSecao").innerHTML = `<div class="card ok-card"><h3>${esc(primeiro(a.nome))} está inativo ✓</h3>
      ${(j.feito || []).map(t => `<p class="sub">✓ ${esc(t)}</p>`).join("")}${(j.avisos || []).map(t => `<p class="sub">⚠ ${esc(t)}</p>`).join("")}
      <p class="sub">As tarefas dele na agenda saem na faxina de domingo (ou me diga no chat "tira o ${esc(primeiro(a.nome))} da agenda"). Se o plano ainda não acabou e houve reembolso, anote no Financeiro.</p>
      <div class="acoes"><a class="btn amarelo" href="#/alunos">Voltar para os alunos</a></div></div>`;
  } catch(e){ btn.disabled = false; msg.textContent = e.servidor ? "Não inativou: " + e.message : "Sem internet: nada mudou. Tente de novo com sinal."; }
}

async function carregarAluno(a, depois){
  const corpo = $("corpo");
  const guardado = DADOS[a.chave] || ler("t_aluno:" + a.chave);
  if (guardado){ DADOS[a.chave] = guardado; depois(); }
  else corpo.innerHTML = `<p class="carregando">Abrindo a planilha de ${esc(primeiro(a.nome))}…</p>`;
  try {
    const d = await chamar({acao: "t_aluno", aluno: a.chave});
    const mudou = !guardado || JSON.stringify([d.treino, d.reg, d.cardio, d.avaliacao, d.grupos, d.prescricao]) !== JSON.stringify([guardado.treino, guardado.reg, guardado.cardio, guardado.avaliacao, guardado.grupos, guardado.prescricao]);
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
        if (NOMES[d] && cardioValido(t)) ds[d] = t.replace(/(\d+)\s*min/i,"$1 min").replace(/\s*em um[a]?\s*/i,", ").replace(/media/i,"média").replace(/(\d+)\s*bpm/i,"$1 bpm"); }
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
// volume de cada grupamento muscular por semana. O grupamento vem da aba VIDEOS (servidor versão 7): coluna D = principal
// (conta inteiro), coluna E = secundário (conta metade), a mesma regra da tabela "Volume semanal" da aba Treino.
// "Todos" soma cada exercício uma vez só (igual ao volume total). Série feita = série com reps anotadas.
const chaveNome = s => txt(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");
function volumePorGrupo(reg, grupos){
  const mapa = {}; (grupos || []).forEach(g => { if (txt(g[0]) && txt(g[1])) mapa[chaveNome(g[0])] = [txt(g[1]), txt(g[2])]; });
  const total = {}, por = {}, sem = new Set();
  const somar = (alvo, w, kg, n, peso) => { const x = alvo[w] || (alvo[w] = {kg: 0, series: 0}); x.kg += kg * peso; x.series += n * peso; };
  Object.keys(reg || {}).forEach(L => { for (let w = 1; w <= 12; w++) for (let k = 1; k <= 9; k++){
    const row = (reg[L]||[])[linhaReg(w,k)]; const nome = nomeDaLinha(row); if (!nome) continue;
    let kg = 0, n = 0;
    for (let s = 0; s < 5; s++){ const r = lerPlanilha(row[1+2*s]), q = lerPlanilha(row[2+2*s]); if (!(r > 0)) continue; n++; kg += r * (q === "" ? 0 : q); }
    if (!n) continue;
    somar(total, w, kg, n, 1);
    const g = mapa[chaveNome(nome)];
    if (!g){ sem.add(nome); continue; }
    somar(por[g[0]] || (por[g[0]] = {}), w, kg, n, 1);
    if (g[1] && g[1] !== g[0]) somar(por[g[1]] || (por[g[1]] = {}), w, kg, n, .5);
  } });
  return {total, por, sem: [...sem].sort((x,y) => x.localeCompare(y))};
}
const kgTxt = n => Math.round(n).toLocaleString("pt-BR");
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
  const temAv = d.avaliacao && !d.avaliacaoAntiga;
  if (d.reg || temAv) h += `<div class="acoes">${d.reg ? `<button class="btn amarelo" type="button" id="pdfTreino">📄 PDF da evolução do treino</button>` : ""}${temAv ? `<button class="btn" type="button" id="pdfAvEvo">📄 PDF da avaliação física</button>` : ""}</div>`;
  if (d.reg){
    const exs = evolucaoPorExercicio(d.reg);
    h += volumeHtml(a, d, c);
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
  botaoPdf($("pdfTreino"), () => pdfTreino(a)); botaoPdf($("pdfAvEvo"), () => pdfAvaliacao(a));
  ligarVolume(a, d);
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
// seção Volume da Evolução: filtro por grupamento muscular (Todos, Peito, Costas…) e medida (reps × kg ou séries feitas)
function volumeHtml(a, d, c){
  const V = volumePorGrupo(d.reg, d.grupos), vs = Object.keys(V.total).map(Number).sort((x,y) => x-y);
  if (!vs.length) return "";
  const nomes = Object.keys(V.por).sort((x,y) => x.localeCompare(y, "pt-BR"));
  const temGrupos = Array.isArray(d.grupos);
  let h = `<section class="secao"><header><h2>Volume</h2><span class="cont" id="volCont"></span></header><div class="card">`;
  if (nomes.length) h += `<div class="filtros grupos" role="group" aria-label="Grupamento muscular">${["Todos"].concat(nomes).map(g => `<button type="button" data-g="${esc(g)}">${esc(g)}</button>`).join("")}</div>`;
  h += `<div class="filtros medida" role="group" aria-label="Medir em">${[["kg","Volume (reps × kg)"],["series","Séries feitas"]].map(([k,t]) => `<button type="button" data-m="${k}">${t}</button>`).join("")}</div>
    <div id="volGraf"></div><p class="sub" id="volNota"></p>`;
  if (!temGrupos) h += `<p class="sub">Para filtrar por grupamento muscular, cole o código novo do servidor (página Ligar o app do treinador, versão 7).</p>`;
  else if (!nomes.length) h += `<p class="sub">A aba VIDEOS desta planilha não tem o grupamento dos exercícios (colunas D e E).</p>`;
  h += `</div></section>`;
  if (!nomes.length) return h;
  // tabela: 1ª semana com números → última semana completa (a semana em andamento ainda não fechou)
  const fechadas = vs.filter(w => w <= (c.concluidas || 0)), ini = vs[0], fim = (fechadas.length ? fechadas : vs).slice(-1)[0];
  const linhas = nomes.map(g => { const p = V.por[g][ini] || {kg: 0, series: 0}, u = V.por[g][fim] || {kg: 0, series: 0};
    const v = p.kg > 0 && fim !== ini ? Math.round(100 * (u.kg - p.kg) / p.kg) : null;
    return `<tr data-g="${esc(g)}"><td>${esc(g)}</td><td>${fmt(u.series)}</td><td>${kgTxt(p.kg)}</td><td>${kgTxt(u.kg)}</td><td class="${v > 0 ? "sobe" : v < 0 ? "desce" : ""}">${v == null ? "—" : (v > 0 ? "+" : "") + v + "%"}</td></tr>`; }).join("");
  h += `<section class="secao"><header><h2>Por grupamento</h2><span class="cont">semana ${ini} → ${fim}</span></header><div class="card"><div class="tabela"><table><thead><tr><th>Grupamento</th><th>Séries S${fim}</th><th>kg S${ini}</th><th>kg S${fim}</th><th>Variação</th></tr></thead><tbody>${linhas}</tbody></table></div>
    <p class="sub">Volume = reps × kg. O grupamento vem da aba VIDEOS: o principal conta inteiro e o secundário, metade (igual à tabela Volume semanal da planilha).${V.sem.length ? ` Sem grupamento na aba VIDEOS (só entram em Todos): ${esc(V.sem.join(", "))}.` : ""}</p></div></section>`;
  return h;
}
function ligarVolume(a, d){
  const caixa = $("volGraf"); if (!caixa) return;
  const V = volumePorGrupo(d.reg, d.grupos), vs = Object.keys(V.total).map(Number).sort((x,y) => x-y);
  let g = ler("t_grupo:" + a.chave) || "Todos", m = ler("t_vol_medida") || "kg";
  const desenhar = () => {
    if (g !== "Todos" && !V.por[g]) g = "Todos";
    const serie = g === "Todos" ? V.total : V.por[g];
    document.querySelectorAll("[data-g]").forEach(b => b.tagName === "BUTTON" ? b.setAttribute("aria-pressed", b.dataset.g === g) : b.classList.toggle("escolhido", b.dataset.g === g));
    document.querySelectorAll("[data-m]").forEach(b => b.setAttribute("aria-pressed", b.dataset.m === m));
    const nome = g === "Todos" ? "Volume total" : g;
    $("volCont").textContent = (m === "kg" ? "reps × kg" : "séries feitas") + ", por semana";
    caixa.innerHTML = grafico(vs.map(w => { const x = serie[w] || {kg: 0, series: 0};
      return {x: "S" + w, y: m === "kg" ? Math.round(x.kg) : Math.round(x.series * 10) / 10, dica: `Semana ${w}: ${kgTxt(x.kg)} kg · ${fmt(x.series)} ${x.series === 1 ? "série" : "séries"}`}; }),
      {titulo: `${nome} por semana`, zero: true});
    const ultimo = serie[vs[vs.length - 1]] || {kg: 0, series: 0};
    $("volNota").textContent = `${nome} na semana ${vs[vs.length - 1]}: ${kgTxt(ultimo.kg)} kg em ${fmt(ultimo.series)} ${ultimo.series === 1 ? "série" : "séries"}.`;
    ligarDicas(caixa);
  };
  document.querySelectorAll("button[data-g], tr[data-g]").forEach(b => b.onclick = () => { g = b.dataset.g; guardar("t_grupo:" + a.chave, g); desenhar();
    if (b.tagName === "TR") caixa.closest(".secao").scrollIntoView({behavior: "smooth", block: "start"}); });
  document.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { m = b.dataset.m; guardar("t_vol_medida", m); desenhar(); });
  desenhar();
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
      for (let c = 0; c < 10; c++) at[c+1] = row[c] === "" ? "" : fmt(row[c]);
      if (op.pse) for (let s = 1; s <= 5; s++){ const v = (op.pse[i]||[])[s-1]; at[COL_PSE+s] = v === "" || v == null ? "" : String(v); } });
  } else if (op.tipo === "dica"){
    const reg = P.reg[op.aba] || (P.reg[op.aba] = []);
    op.dicas.forEach((t,i) => { const k = linhaReg(op.semana, i+1); (reg[k] || (reg[k] = []))[COL_DICA] = t; });
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
      for (let s = 0; s < 5; s++){ const r = lerPlanilha(row[1+2*s]), q = lerPlanilha(row[2+2*s]), p = lerPlanilha(row[COL_PSE+1+s]);
        if (r !== "" && r > 0) series.push({reps: r, kg: q === "" ? 0 : q, s, pse: p !== "" && p >= 0 && p <= 10 ? p : ""}); } } });
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
  const rec = recordeDe(agora, antes);
  return rec ? textoRecorde(rec) : null;
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
  const dt = dataDoDia(N, d.dia), REST = descanso(SEM.faixa), desc = grupos(d.exercicios), lo = (SEM.faixa||"").split(" a ")[0] || "0", cp = comPse();
  h += `<div class="tit-dia"><h2>${NOMES[d.dia]}${d.treino ? " · Treino " + d.treino : ""}</h2><span class="contagem" id="cont"></span></div>${dt ? `<p class="sub" style="margin-top:-8px">${ddaaaa(dt)}${d.aba !== d.treino && d.treino ? ` · anotado na aba Registro ${d.aba}` : ""}</p>` : ""}`;
  if (!cp && d.exercicios.length) h += `<p class="sub">Para anotar a PSE (0 a 10) de cada série, cole antes o código novo do servidor (página Ligar o app do treinador).</p>`;
  d.exercicios.forEach((ex,i) => { const k = i+1, ant = anterior(ex.nome, N); let s = "";
    for (let si = 1; si <= ex.series; si++){ const a = ant && ant.series[si-1], r = reps(d,k,si), q = kg(d,k,si);
      s += `<div class="serie${cp ? " pse" : ""}"><span>S${si}</span>${campo(`e${k}s${si}r`,"reps",r,lo)}${campo(`e${k}s${si}k`,"kg",q,a ? fmt(a.kg) : "0",true)}${cp ? botaoPse(`e${k}s${si}p`, k, si, pse(d,k,si)) : ""}
        ${a ? `<div class="antes">Semana ${ant.semana}: ${a.reps} reps × ${fmt(a.kg)} kg${cp && a.pse !== "" ? ` · PSE ${fmt(a.pse)}` : ""}</div>` : ""}<div class="confere" id="cf-${k}-${si}">${esc(confere("kg", q, a ? {kg: a.kg, semana: ant.semana} : null) || confere("reps", r, null, SEM.faixa))}</div></div>`; }
    const rec = recorde(d,k,ex), msg = recadoEx(d,k), dica = txt(celula(d.aba, N, k, COL_DICA)), dAnt = dicaAnterior(ex.nome, N);
    h += `<article class="ex${exOk(d,k,ex) ? " ok" : ""}" id="ex-${k}"><div class="ex-top"><span class="num">${k}</span><div class="ex-nome"><h3>${esc(ex.nome)}</h3><p>${plural(ex.series, "série")} · ${esc(SEM.faixa)} reps</p>${ex.tecnica ? `<span class="tec">${esc(ex.tecnica)}</span>` : ""}</div></div>
      ${ex.obs ? `<div class="obs">${esc(ex.obs)}</div>` : ""}${msg ? `<div class="recmsg">Recado do aluno: “${esc(msg)}”</div>` : ""}
      <div class="recorde" id="rec-${k}" ${rec ? "" : "hidden"}>🏆 ${rec ? esc(rec) : ""}</div><div class="series">${s}</div>
      <div class="acoes">${ant ? `<button class="btn" type="button" data-repetir="${k}">Mesma carga da semana ${ant.semana}</button>` : ""}
        ${desc[i] ? `<button class="btn amarelo" type="button" data-desc="${esc(ex.nome)}">Descanso ${mmss(REST)}</button>` : `<span class="sub">Sem descanso: direto para o próximo.</span>`}
        ${ex.video ? `<a class="btn" href="${esc(ex.video)}" target="_blank" rel="noopener">▶ Vídeo</a>` : ""}
        <button class="btn${dica ? " tem" : ""}" type="button" data-dica="${k}">💬 Dica para o aluno</button></div>
      <div class="dicabox" id="dc-${k}" ${dica ? "" : "hidden"}><textarea id="dica-${k}" maxlength="300" placeholder="${esc(dAnt ? `Semana ${dAnt.semana}: ${dAnt.texto}` : "Ex.: semana que vem sobe 2 kg; desce em 3 segundos")}">${esc(dica)}</textarea><small>${esc(primeiro(RA.nome))} vê esta dica no app, na semana ${N}${dAnt && !dica ? `. Sem dica nova, continua valendo a da semana ${dAnt.semana}` : ""}.</small></div></article>`; });
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
  corpo.querySelectorAll("[data-dica]").forEach(b => b.onclick = () => {
    if ((INICIO.versao || 0) < 4){ aviso("Para mandar dicas, cole antes o código novo do servidor (página Ligar o app do treinador)."); return; }
    const box = $(`dc-${b.dataset.dica}`); box.hidden = !box.hidden; if (!box.hidden) $(`dica-${b.dataset.dica}`).focus(); });
  corpo.querySelectorAll("textarea[id^=dica-]").forEach(t => t.addEventListener("input", () => escreveuDica(t)));
  corpo.querySelectorAll("[data-pse-k]").forEach(b => b.onclick = () => {
    const k = +b.dataset.pseK, s = +b.dataset.pseS, ex = d.exercicios[k-1];
    abrirPse(`Quanto ${primeiro(RA.nome)} se esforçou?`, `${ex.nome.trim()} · série ${s}`, pse(d,k,s), v => {
      const reg = P.reg[d.aba] || (P.reg[d.aba] = []), row = reg[linhaReg(semanaN,k)] || (reg[linhaReg(semanaN,k)] = [ex.nome]);
      row[COL_PSE+s] = v === "" ? "" : String(v); pintarPse(b, s, v); enfileirar(opTreinoT(d));
    }, b);
  });
}
function dicaAnterior(nome, N){
  for (let w = N - 1; w >= 1; w--) for (const L of Object.keys(P.reg)) for (let j = 1; j <= 9; j++){
    const row = (P.reg[L]||[])[linhaReg(w,j)]; if (row && nomeDaLinha(row) === nome.trim() && txt(row[COL_DICA])) return {texto: txt(row[COL_DICA]), semana: w}; }
  return null;
}
function opTreinoT(d){
  const linhas = d.exercicios.map((ex2,i) => { const r = []; for (let q = 1; q <= 5; q++){ r.push(q <= ex2.series ? reps(d,i+1,q) : ""); r.push(q <= ex2.series ? kg(d,i+1,q) : ""); } return r; });
  const op = {tipo: "treino", aba: d.aba, semana: semanaN, linhas};
  if (comPse()) op.pse = d.exercicios.map((ex,i) => { const r = []; for (let s = 1; s <= 5; s++) r.push(s <= ex.series ? pse(d,i+1,s) : ""); return r; });
  return op;
}
function escreveuDica(t){
  const d = SEM.dias[atual], k = +t.id.split("-")[1], ex = d.exercicios[k-1], reg = P.reg[d.aba] || (P.reg[d.aba] = []);
  const row = reg[linhaReg(semanaN,k)] || (reg[linhaReg(semanaN,k)] = [ex.nome]); row[COL_DICA] = t.value;
  const b = document.querySelector(`[data-dica="${k}"]`); if (b) b.classList.toggle("tem", !!t.value.trim());
  enfileirar({tipo: "dica", aba: d.aba, semana: semanaN, dicas: d.exercicios.map((e,i) => txt(celula(d.aba, semanaN, i+1, COL_DICA)))});
}
function digitou(inp){
  const d = SEM.dias[atual], m = /^e(\d+)s(\d+)([rk])$/.exec(inp.id), c = /^c(min|bpm)$/.exec(inp.id), val = lerDigitado(inp.value);
  if (m){
    const k = +m[1], s = +m[2], ex = d.exercicios[k-1], reg = P.reg[d.aba] || (P.reg[d.aba] = []);
    const row = reg[linhaReg(semanaN,k)] || (reg[linhaReg(semanaN,k)] = [ex.nome]);
    const v = m[3] === "r" ? (val === "" ? "" : Math.round(val)) : val;
    row[m[3] === "r" ? 2*s-1 : 2*s] = v === "" ? "" : fmt(v);
    $(`ex-${k}`).classList.toggle("ok", exOk(d,k,ex));
    $(`cf-${k}-${s}`).textContent = confereSerie(d,k,s);
    const el = $(`rec-${k}`), antes = el.hidden, rec = recorde(d,k,ex);
    el.hidden = !rec; el.textContent = rec ? "🏆 " + rec : "";
    if (rec && antes){ aviso("🏆 " + rec); try { navigator.vibrate && navigator.vibrate(60); } catch(e){} }
    enfileirar(opTreinoT(d));
  }
  if (c){ const ch = semanaN+"|"+d.dia, o = P.cardio[ch] || (P.cardio[ch] = {minutos:"", bpm:"", recado:""});
    o[c[1] === "min" ? "minutos" : "bpm"] = val === "" ? "" : Math.round(val);
    const dt = dataDoDia(semanaN, d.dia);
    enfileirar({tipo: "cardio", semana: semanaN, dia: d.dia, data: dt ? ddaaaa(dt) : "", prescrito: d.cardio, minutos: o.minutos ?? "", bpm: o.bpm ?? "", recado: o.recado || ""}); }
  contagem();
  document.querySelectorAll("[data-dia]").forEach(b => b.classList.toggle("feito", diaFeito(+b.dataset.dia)));
}
// PSE de cada série, de 0 a 10 (igual ao app do aluno): escala só de esforço, a CR-10 modificada por Foster e cols. 2001
// (0 repouso … 5 difícil, 7 muito difícil, 10 máximo; tabela em Haddad e cols. 2017, doi:10.3389/fnins.2017.00612).
const comPse = () => ((INICIO && INICIO.versao) || 0) >= PSE_DESDE;
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
function confereSerie(d, k, s){
  const ex = d.exercicios[k-1], ant = anterior(ex.nome, semanaN), a = ant && ant.series[s-1];
  return confere("kg", kg(d,k,s), a ? {kg: a.kg, semana: ant.semana} : null) || confere("reps", reps(d,k,s), null, SEM.faixa);
}
function contagem(){ const d = SEM.dias[atual], el = $("cont"); if (!el || !d) return; el.textContent = d.exercicios.length ? `${d.exercicios.filter((ex,i) => exOk(d,i+1,ex)).length} de ${d.exercicios.length} feitos` : ""; }
function pararSemSalvar(){ /* a fila já guarda tudo; nada a fazer ao trocar de tela */ }

// ---------- fila: tudo fica no celular até a planilha confirmar ----------
let timerEnvio = null, enviando = false, tentativas = 0, gravacoes = 0;
function enfileirar(op){
  op.aluno = RA.chave; op.nome = RA.nome;
  const chave = op.tipo === "treino" ? `t|${op.aluno}|${op.aba}|${op.semana}` : op.tipo === "dica" ? `d|${op.aluno}|${op.aba}|${op.semana}` : `c|${op.aluno}|${op.semana}|${op.dia}`;
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

// ---------- FINANCEIRO (servidor versão 8; planilha "Financeiro da Consultoria", skill financeiro) ----------
// Só a consultoria online. Lê com t_fin; anota com t_fin_pag (pagamento), t_fin_gasto (gasto) e t_fin_recebi (Aguardando → Pago).
// Anotar precisa de internet (não entra na fila do Registrar): se falhar, o formulário continua aberto para tentar de novo.
const FIN_DESDE = 8;
let FIN = ler("t_fin"), finLendo = false, finForm = "", finFeito = null, finEnviando = false;
let finPrefill = "";   // nome vindo dos Leads (lead que fechou)
const real = n => n == null || n === "" ? "—" : Number(n).toLocaleString("pt-BR", {style: "currency", currency: "BRL"});
const din = t => `<span class="din">${t}</span>`;   // valor que o olhinho esconde
// olhinho de esconder (pedido do criador, 15/11/2026): valores do Financeiro e fotos de avaliação; a escolha fica no celular
const svgOlho = fechado => `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>${fechado ? `<path d="M3 3l18 18"/>` : ""}</svg>`;
const botaoOlho = (id, oculto, oque) => `<button type="button" class="olho" id="${id}" aria-pressed="${oculto}" aria-label="${oculto ? "Mostrar" : "Esconder"} ${oque}">${svgOlho(oculto)}</button>`;

const pctTxt = n => n == null ? "—" : (n * 100).toLocaleString("pt-BR", {maximumFractionDigits: 1}) + "%";
const isoDe = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const ddIso = s => { const d = isoData(s); return d ? dd(d) : "—"; };
const zapNum = (num, texto) => `https://wa.me/${num}?text=${encodeURIComponent(texto)}`;
const semAc = s => txt(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
function proximaSegunda(){ const h = hojeZero(); return new Date(h.getFullYear(), h.getMonth(), h.getDate() + (8 - h.getDay()) % 7); }
const finAlunoDe = nome => (FIN.alunos || []).find(a => semAc(a.aluno) === semAc(nome));

async function lerFin(silencioso){
  if (finLendo) return; finLendo = true;
  try {
    const j = await chamar({acao: "t_fin"}, 60000), primeira = !FIN;
    FIN = {resumo: j.resumo, alunos: j.alunos, abertos: j.abertos, planos: j.planos, cupons: j.cupons, categorias: j.categorias,
      formas_gasto: j.formas_gasto, origens: j.origens, planilha: j.planilha, lido_em: j.lido_em};
    guardar("t_fin", FIN);
    const foco = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (rota().tela === "fin" && (primeira || (!finForm && !foco))) telaFin();
  } catch(e){
    if (!silencioso) aviso(e.servidor && /desconhecida/i.test(e.message) ? "O servidor ainda é a versão antiga: cole o código novo (Ligar o app do treinador)." : e.servidor ? e.message : "Sem internet: mostrando a última leitura.");
    if (rota().tela === "fin" && !FIN) telaFin(e);
  } finally { finLendo = false; }
}

function fatoFin(t, v, s, destaque){ return `<div class="fato${destaque ? " destaque" : ""}"><small>${t}</small><b>${v}</b>${s ? `<span>${s}</span>` : ""}</div>`; }

function telaFin(erro){
  const ocultos = !!ler("t_ocultar_valores");
  document.body.classList.toggle("esconde-valores", ocultos);
  let h = `<div class="tit-olho"><div><div class="eyebrow">Consultoria online</div><h1>Financeiro</h1></div>${botaoOlho("olhoFin", ocultos, "os valores")}</div>`;
  if (!FIN){
    h += erro ? `<div class="card"><h2>Não consegui abrir o financeiro</h2><p class="sub">${esc(erro.servidor && /desconhecida/i.test(erro.message) ? "O servidor do app ainda é a versão antiga. Cole o código novo pela página Ligar o app do treinador (versão 8) e toque em ↻." : erro.servidor ? erro.message : "Sem internet. Na primeira vez, o app precisa de internet para ler a planilha do financeiro.")}</p><button class="btn amarelo" type="button" id="finTentar">Tentar de novo</button></div>`
      : `<p class="carregando">Lendo a planilha do financeiro…</p>`;
    $("tela").innerHTML = h;
    if ($("finTentar")) $("finTentar").onclick = () => { telaFin(); lerFin(); };
    if (!erro) lerFin();
    return;
  }
  const r = FIN.resumo || {};
  if (finFeito) h += `<div class="card ok-card"><h3>Anotado ✓</h3><p class="sub din">${esc(finFeito)}</p></div>`;
  h += `<div class="fatos">
    ${fatoFin("Entrou na conta este mês", din(real(r.entrou)), `gastos ${din(real(r.gastos))}`)}
    ${fatoFin("Lucro do mês", din(real(r.lucro)), `margem ${din(pctTxt(r.margem))}`, true)}
    ${fatoFin("A receber", din(real((r.em_aberto || 0) + (r.cartao_cair || 0))), `em aberto ${din(real(r.em_aberto))} · cartão ${din(real(r.cartao_cair))}`)}
    ${fatoFin("Receita por mês dos planos", din(real(r.receita_mensal)), plural(r.ativos || 0, "aluno ativo", "alunos ativos"))}
  </div>`;
  h += `<div class="acoes"><button class="btn amarelo" type="button" data-form="pag" aria-pressed="${finForm === "pag"}">+ Pagamento recebido</button><button class="btn" type="button" data-form="gasto" aria-pressed="${finForm === "gasto"}">+ Gasto</button></div>`;
  h += `<div id="finForm"></div>`;

  // cobrar: pagamentos "Aguardando"
  const ab = (FIN.abertos || []).slice().sort((x, y) => (x.data || "").localeCompare(y.data || ""));
  h += `<section class="secao"><header><h2>Cobrar</h2><span class="cont">${plural(ab.length, "em aberto")}</span></header>`;
  h += ab.length ? `<div class="lista">${ab.map(p => `<div class="aluno"><span class="bola atencao"></span><span class="meio"><h3>${esc(p.aluno)}</h3><p>${esc(p.plano)} · ${din(real(p.valor))} · ${esc(p.forma === "Cartão (Eduzz)" ? `cartão ${p.parcelas}x` : p.forma || "")}${p.data ? ` · desde ${ddIso(p.data)}` : ""}</p></span>
      <span class="acoes">${p.whats ? `<a class="btn" href="${esc(zapNum(p.whats, MSG.cobrar(p.aluno, p.plano)))}" target="_blank" rel="noopener">Cobrar</a>` : ""}<button class="btn amarelo" type="button" data-recebi="${p.linha}">Recebi</button></span></div>`).join("")}</div>`
    : `<p class="vazio">Nenhum pagamento em aberto.</p>`;
  h += `</section>`;

  // renovar: plano acabando (13 dias antes) ou que acabou há até 7 dias
  const ren = (FIN.alunos || []).filter(a => a.situacao === "Perguntar se renova" || a.situacao === "Plano acabou").sort((x, y) => (x.dias || 0) - (y.dias || 0));
  h += `<section class="secao"><header><h2>Renovar</h2><span class="cont">plano acabando</span></header>`;
  h += ren.length ? `<div class="lista">${ren.map(a => { const n = a.dias == null ? 0 : Math.round(a.dias);
      return `<div class="aluno"><span class="bola ${n < 0 ? "atencao" : "aviso"}"></span><span class="meio"><h3>${esc(a.aluno)}</h3><p>${esc(a.plano)} · ${n > 0 ? `acaba em ${ddIso(a.fim)} (faltam ${plural(n, "dia")})` : n === 0 ? "acaba hoje" : `acabou em ${ddIso(a.fim)}`}</p></span>
        <span class="acoes">${a.whats ? `<a class="btn amarelo" href="${esc(zapNum(a.whats, n >= 0 ? MSG.renovarFin(a.aluno, a.fim) : MSG.lembrarRenovar({nome: a.aluno})))}" target="_blank" rel="noopener">${n >= 0 ? "Perguntar" : "Lembrar"}</a>` : ""}<button class="btn" type="button" data-renovou="${esc(a.aluno)}">Renovou</button></span></div>`; }).join("")}</div>`
    : `<p class="vazio">Nenhum plano acabando nos próximos 13 dias.</p>`;
  h += `</section>`;
  const quando = FIN.lido_em ? new Date(FIN.lido_em) : null;
  h += `<p class="sub">${quando ? `Lido da planilha às ${String(quando.getHours()).padStart(2,"0")}:${String(quando.getMinutes()).padStart(2,"0")} de ${dd(quando)}. ` : ""}<a href="${esc(FIN.planilha || "#")}" target="_blank" rel="noopener">Abrir a planilha</a></p>`;
  $("tela").innerHTML = h;
  $("olhoFin").onclick = () => { guardar("t_ocultar_valores", !ocultos); telaFin(); };

  document.querySelectorAll("[data-form]").forEach(b => b.onclick = () => { finForm = finForm === b.dataset.form ? "" : b.dataset.form; finFeito = null; telaFin(); if (finForm) $("finForm").scrollIntoView({block: "start", behavior: "smooth"}); });
  document.querySelectorAll("[data-recebi]").forEach(b => b.onclick = () => recebi(Number(b.dataset.recebi), b));
  document.querySelectorAll("[data-renovou]").forEach(b => b.onclick = () => { finForm = "pag"; finFeito = null; telaFin(); $("fpAluno").value = b.dataset.renovou; $("fpAluno").dispatchEvent(new Event("input")); $("finForm").scrollIntoView({block: "start", behavior: "smooth"}); });
  if (finForm === "pag") formPagamento();
  else if (finForm === "gasto") formGasto();
  if (!quando || Date.now() - quando > 5 * 60e3) lerFin(true);
}

async function recebi(linha, btn){
  const p = (FIN.abertos || []).find(x => x.linha === linha); if (!p) return;
  if (!confirm(`Marcar como recebido o pagamento de ${p.aluno} (${p.plano}, ${real(p.valor)})?`)) return;
  btn.disabled = true;
  try {
    const j = await chamar({acao: "t_fin_recebi", linha, aluno: p.aluno}, 60000);
    finFeito = `${p.aluno}: pagamento de ${real(p.valor)} marcado como recebido.`;
    await lerFinDe(j);
  } catch(e){ btn.disabled = false; aviso(e.servidor ? e.message : "Sem internet: tente de novo quando a internet voltar."); }
}
function lerFinDe(j){
  FIN = {resumo: j.resumo, alunos: j.alunos, abertos: j.abertos, planos: j.planos, cupons: j.cupons, categorias: j.categorias,
    formas_gasto: j.formas_gasto, origens: j.origens, planilha: j.planilha, lido_em: j.lido_em};
  guardar("t_fin", FIN); finForm = ""; telaFin(); window.scrollTo({top: 0});
}

const opcoes = (lista, atual) => lista.map(([v, t]) => `<option value="${esc(v)}"${v === atual ? " selected" : ""}>${esc(t)}</option>`).join("");
const escolha = (id, itens, atual) => `<div class="filtros" role="group" id="${id}">${itens.map(([v, t]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${v === atual}">${esc(t)}</button>`).join("")}</div>`;
function ligarEscolha(id, aoMudar){ document.querySelectorAll(`#${id} button`).forEach(b => b.onclick = () => { document.querySelectorAll(`#${id} button`).forEach(x => x.setAttribute("aria-pressed", String(x === b))); aoMudar && aoMudar(b.dataset.v); }); }
const valorDe = id => { const b = document.querySelector(`#${id} button[aria-pressed="true"]`); return b ? b.dataset.v : ""; };

function formPagamento(){
  const planos = FIN.planos || [], cupons = FIN.cupons || [];
  const nomes = [...new Set([...(FIN.alunos || []).map(a => a.aluno), ...((INICIO.alunos || []).filter(a => a.modalidade === "consultoria").map(a => a.nome))])].sort((a, b) => a.localeCompare(b, "pt-BR"));
  $("finForm").innerHTML = `<div class="card form"><h2>Pagamento recebido</h2>
    <label>Aluno<input class="busca" id="fpAluno" list="fpNomes" autocomplete="off" placeholder="Nome completo"></label>
    <datalist id="fpNomes">${nomes.map(n => `<option value="${esc(n)}">`).join("")}</datalist>
    <p class="sub" id="fpTipo"></p>
    <label>Plano<select id="fpPlano">${opcoes(planos.map(p => [p.nome, `${p.nome} · ${real(p.preco)}`]), (planos.find(p => p.nome === "Trimestral") || planos[0] || {}).nome)}</select></label>
    <label>Início do plano (a segunda em que o treino começa)<input class="busca" type="date" id="fpInicio"></label>
    <p class="sub" id="fpSeg"></p>
    <div><span class="rot">Forma de pagamento</span>${escolha("fpForma", [["Pix", "Pix"], ["Cartão (Eduzz)", "Cartão (Eduzz)"]], "Pix")}</div>
    <label id="fpParcRot" hidden>Parcelas<select id="fpParc"></select></label>
    <label>Cupom de influenciador<select id="fpCupom"><option value="">Sem cupom</option>${opcoes(cupons.map(c => [c.cupom, `${c.cupom} (${c.influenciador})`]))}</select></label>
    <label>Outro valor (só se combinou um valor diferente da tabela)<input class="busca" id="fpOutro" inputmode="decimal" placeholder="Deixe vazio para o preço da tabela"></label>
    <div><span class="rot">O dinheiro já entrou?</span>${escolha("fpSit", [["Pago", "Sim, já pagou"], ["Aguardando", "Ainda não"]], "Pago")}</div>
    <label>Data do pagamento (no cartão, o dia da venda)<input class="busca" type="date" id="fpData" value="${isoDe(hojeZero())}"></label>
    <label>Observação (opcional)<input class="busca" id="fpObs" maxlength="300"></label>
    <p class="sub" id="fpMsg"></p>
    <div class="acoes"><button class="btn amarelo" type="button" id="fpOk">Anotar na planilha</button><button class="btn" type="button" id="fpX">Cancelar</button></div></div>`;
  const plano = () => planos.find(p => p.nome === $("fpPlano").value) || {};
  const parcelas = () => { const max = plano().parcelas || 1, atual = $("fpParc").value; $("fpParc").innerHTML = opcoes(Array.from({length: max}, (_, i) => [String(i + 1), `${i + 1}x`]), atual && Number(atual) <= max ? atual : String(max)); };
  const forma = v => { $("fpParcRot").hidden = v !== "Cartão (Eduzz)"; parcelas(); };
  const conferirSeg = () => { const d = isoData($("fpInicio").value); $("fpSeg").textContent = d && d.getDay() !== 1 ? "Atenção: essa data não é uma segunda-feira." : ""; };
  const aluno = () => {
    const a = finAlunoDe($("fpAluno").value), hoje = hojeZero();
    if (!txt($("fpAluno").value)){ $("fpTipo").textContent = ""; return; }
    if (a && a.fim){
      const fim = isoData(a.fim), novo = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate() + 1), renov = dias(fim, hoje) <= 7;
      $("fpTipo").textContent = renov ? `Renovação: o plano atual (${a.plano}) vai até ${dd(fim)}, então o novo começa em ${dd(novo)}.` : `Aluno que voltou: o último plano acabou em ${ddIso(a.fim)}.`;
      $("fpInicio").value = isoDe(renov ? novo : proximaSegunda());
      if (planos.some(p => p.nome === a.plano)){ $("fpPlano").value = a.plano; $("fpParc").value = ""; parcelas(); }
    } else {
      $("fpTipo").textContent = "Aluno novo na planilha do financeiro.";
      if (!$("fpInicio").value) $("fpInicio").value = isoDe(proximaSegunda());
    }
    conferirSeg();
  };
  $("fpInicio").value = isoDe(proximaSegunda()); conferirSeg();
  if (finPrefill){ $("fpAluno").value = finPrefill; finPrefill = ""; }
  forma("Pix");
  ligarEscolha("fpForma", forma); ligarEscolha("fpSit");
  $("fpPlano").onchange = () => { $("fpParc").value = ""; parcelas(); };
  $("fpAluno").oninput = aluno;
  if (txt($("fpAluno").value)) aluno();
  $("fpInicio").onchange = conferirSeg;
  $("fpX").onclick = () => { finForm = ""; telaFin(); };
  $("fpOk").onclick = async () => {
    const p = {aluno: txt($("fpAluno").value), plano: $("fpPlano").value, inicio: $("fpInicio").value, forma: valorDe("fpForma"),
      parcelas: valorDe("fpForma") === "Pix" ? 1 : Number($("fpParc").value), cupom: $("fpCupom").value, outro: txt($("fpOutro").value),
      situacao: valorDe("fpSit"), data: $("fpData").value, obs: txt($("fpObs").value)};
    if (!p.aluno || !p.plano || !p.inicio){ $("fpMsg").textContent = "Preencha o aluno, o plano e o início do plano."; return; }
    if (finEnviando) return; finEnviando = true; $("fpOk").disabled = true; $("fpMsg").textContent = "Anotando…";
    try {
      const j = await chamar({acao: "t_fin_pag", p}, 60000), f = j.feito || {};
      finFeito = `${f.aluno}: ${f.plano} (${String(f.tipo || "").toLowerCase()}) de ${ddIso(f.inicio)} a ${ddIso(f.fim)}, ${real(f.valor)}${f.desconto ? ` (com ${real(f.desconto)} de desconto do cupom)` : ""}. ${f.situacao === "Pago" ? `${f.taxa ? `Taxa da Eduzz ~${real(f.taxa)}; c` : "C"}aem ${real(f.liquido)} em ${ddIso(f.cai_em)}.` : "Ficou como aguardando o pagamento."}${f.repasse ? ` Repasse de ${real(f.repasse)} para ${f.influenciador}.` : ""}`;
      lerFinDe(j);
    } catch(e){ $("fpOk").disabled = false; $("fpMsg").textContent = e.servidor ? e.message : "Sem internet: nada foi anotado. Tente de novo quando a internet voltar."; }
    finally { finEnviando = false; }
  };
}

function formGasto(){
  const cats = FIN.categorias || [], formas = FIN.formas_gasto || ["Pix"];
  $("finForm").innerHTML = `<div class="card form"><h2>Gasto</h2>
    <label>O que foi<input class="busca" id="fgDesc" maxlength="200" placeholder="Ex.: anúncio no Instagram"></label>
    <label>Valor (R$)<input class="busca" id="fgValor" inputmode="decimal" placeholder="0,00"></label>
    <label>Categoria<select id="fgCat"><option value="">Escolha</option>${opcoes(cats.map(c => [c.nome, c.nome]))}</select></label>
    <label>Forma de pagamento<select id="fgForma">${opcoes(formas.map(f => [f, f]), "Pix")}</select></label>
    <div><span class="rot">Tem nota ou recibo?</span>${escolha("fgNota", [["Sim", "Sim"], ["Não", "Não"]], "")}</div>
    <label>Data<input class="busca" type="date" id="fgData" value="${isoDe(hojeZero())}"></label>
    <label>Observação (opcional)<input class="busca" id="fgObs" maxlength="300"></label>
    <p class="sub">O que você tira para a sua vida pessoal vai como "Retirada para mim". A taxa da Eduzz não entra aqui: ela já sai dos pagamentos.</p>
    <p class="sub" id="fgMsg"></p>
    <div class="acoes"><button class="btn amarelo" type="button" id="fgOk">Anotar na planilha</button><button class="btn" type="button" id="fgX">Cancelar</button></div></div>`;
  ligarEscolha("fgNota");
  $("fgX").onclick = () => { finForm = ""; telaFin(); };
  $("fgOk").onclick = async () => {
    const bruto = txt($("fgValor").value).replace(/R\$|\s/g, "");
    const g = {descricao: txt($("fgDesc").value), valor: bruto.includes(",") ? bruto.replace(/\./g, "").replace(",", ".") : bruto, categoria: $("fgCat").value,
      forma: $("fgForma").value, nota: valorDe("fgNota"), data: $("fgData").value, obs: txt($("fgObs").value)};
    if (!g.descricao || !(Number(g.valor) > 0) || !g.categoria){ $("fgMsg").textContent = "Preencha o que foi, o valor e a categoria."; return; }
    if (finEnviando) return; finEnviando = true; $("fgOk").disabled = true; $("fgMsg").textContent = "Anotando…";
    try {
      const j = await chamar({acao: "t_fin_gasto", g}, 60000), f = j.feito || {};
      finFeito = `${real(f.valor)} em ${f.categoria} (${f.descricao}).`;
      lerFinDe(j);
    } catch(e){ $("fgOk").disabled = false; $("fgMsg").textContent = e.servidor ? e.message : "Sem internet: nada foi anotado. Tente de novo quando a internet voltar."; }
    finally { finEnviando = false; }
  };
}

// ---------- LEADS (servidor versão 9; planilha "Leads", aba Leads, skill consultor-de-vendas) ----------
// Os números do mês seguem o painel da consultoria: contam pelo mês do 1º contato; proposta = Plano / valor preenchido; venda = Fechou.
// Anotar precisa de internet. "Fechou" não cria nada aqui: a rotina da manhã (Comercial) cria a pasta do aluno.
let LEADS = ler("t_leads"), leadsLendo = false, leadForm = false, leadAberto = 0, leadFeito = null, leadEnviando = false;
// versão 18 (15/11/2026): quadro por etapa, termômetro (colunas K a M), histórico (aba Interações) e Instagram automático
let leadsVista = ler("t_leads_vista") === "quadro" ? "quadro" : "lista", leadEtapaNova = "", igAberto = false, igEnviando = false;
const ETAPAS_QUADRO = ["Novo", "Conversando", "Proposta enviada", "Mês que vem", "Fechou", "Não fechou"];
const TERMO = {"Frio": "t-frio", "Morno": "t-morno", "Quente": "t-quente", "Pronto": "t-pronto"};
const termoTag = l => l.cor && TERMO[l.cor] ? `<span class="termo ${TERMO[l.cor]}">${esc(l.cor)}${l.nota != null ? " · " + l.nota : ""}</span>` : "";
const ABERTAS = ["Novo", "Conversando", "Proposta enviada", "Mês que vem"];
const MESES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
function contatoLink(c){
  const t = txt(c), arroba = /^@?([A-Za-z0-9._]{1,30})$/.exec(t), dig = t.replace(/\D/g, "");
  if (dig.length >= 10 && dig.length <= 13 && !/[A-Za-z@]/.test(t)) return {url: `https://wa.me/${dig.length <= 11 ? "55" + dig : dig}`, rot: "WhatsApp"};
  if (arroba && /^@/.test(t)) return {url: `https://instagram.com/${arroba[1]}`, rot: "Instagram"};
  return null;
}
function lerLeadsDe(j){
  LEADS = {leads: j.leads, origens: j.origens, interesses: j.interesses, etapas: j.etapas, motivos: j.motivos, planilha: j.planilha, lido_em: j.lido_em, ig: j.ig || null};
  guardar("t_leads", LEADS);
}
async function lerLeads(silencioso){
  if (leadsLendo) return; leadsLendo = true;
  try {
    lerLeadsDe(await chamar({acao: "t_leads"}, 60000));
    const foco = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (rota().tela === "leads" && !leadForm && !leadAberto && !foco) telaLeads();
  } catch(e){
    if (!silencioso) aviso(e.servidor && /desconhecida/i.test(e.message) ? "O servidor ainda é a versão antiga: cole o código novo (Ligar o app do treinador)." : e.servidor ? e.message : "Sem internet: mostrando a última leitura.");
    if (rota().tela === "leads" && !LEADS) telaLeads(e);
  } finally { leadsLendo = false; }
}
function numerosLeads(leads, ano, mes){
  const m = `${ano}-${String(mes + 1).padStart(2, "0")}`, l = leads.filter(x => (x.data || "").slice(0, 7) === m);
  const vendas = l.filter(x => x.etapa === "Fechou").length;
  return {leads: l.length, propostas: l.filter(x => txt(x.plano)).length, vendas, conv: l.length ? Math.round(vendas / l.length * 100) : 0};
}
const difTxt = (n, sufixo) => n === 0 ? `igual` : `<span class="${n > 0 ? "sobe" : "desce"}">${n > 0 ? "▲ +" : "▼ "}${n}${sufixo || ""}</span>`;

function telaLeads(erro){
  let h = `<div><div class="eyebrow">Consultoria e presencial</div><h1>Leads</h1></div>`;
  if (!LEADS){
    h += erro ? `<div class="card"><h2>Não consegui abrir os leads</h2><p class="sub">${esc(erro.servidor && /desconhecida/i.test(erro.message) ? "O servidor do app ainda é a versão antiga. Cole o código novo pela página Ligar o app do treinador (versão 9) e toque em ↻." : erro.servidor ? erro.message : "Sem internet. Na primeira vez, o app precisa de internet para ler a planilha de leads.")}</p><button class="btn amarelo" type="button" id="ldTentar">Tentar de novo</button></div>`
      : `<p class="carregando">Lendo a planilha de leads…</p>`;
    $("tela").innerHTML = h;
    if ($("ldTentar")) $("ldTentar").onclick = () => { telaLeads(); lerLeads(); };
    if (!erro) lerLeads();
    return;
  }
  const leads = LEADS.leads || [], hoje = hojeZero(), ano = hoje.getFullYear(), mes = hoje.getMonth();
  const at = numerosLeads(leads, ano, mes), ant = numerosLeads(leads, mes ? ano : ano - 1, mes ? mes - 1 : 11), nomeAnt = MESES[mes ? mes - 1 : 11];
  if (leadFeito) h += `<div class="card ok-card"><h3>Anotado ✓</h3><p class="sub">${esc(leadFeito.texto)}</p>${leadFeito.fechou ? `<div class="acoes"><a class="btn amarelo" href="#/fin" id="ldPagar">Anotar o pagamento no Financeiro</a></div>` : ""}</div>`;
  h += `<div class="fatos">
    ${fatoFin(`Leads novos em ${MESES[mes]}`, at.leads, `${difTxt(at.leads - ant.leads)} sobre ${nomeAnt}`)}
    ${fatoFin("Propostas", at.propostas, `${difTxt(at.propostas - ant.propostas)} sobre ${nomeAnt}`)}
    ${fatoFin("Vendas", at.vendas, `${difTxt(at.vendas - ant.vendas)} sobre ${nomeAnt}`, true)}
    ${fatoFin("Conversão (lead → venda)", at.conv + "%", `${difTxt(at.conv - ant.conv, " pontos")} sobre ${nomeAnt}`)}
  </div>`;
  h += `<div class="acoes"><button class="btn amarelo" type="button" id="ldNovo" aria-pressed="${leadForm}">+ Lead</button>${escolha("ldVista", [["lista", "Lista"], ["quadro", "Quadro"]], leadsVista)}</div><div id="ldForm"></div>`;
  h += cartaoInstagram();
  if (leadsVista === "quadro"){
    const limite = isoDe(new Date(hoje.getFullYear(), hoje.getMonth() - 3, hoje.getDate()));
    const aberto = (LEADS.leads || []).find(l => l.linha === leadAberto);
    h += `<div class="quadro" id="ldQuadro">${ETAPAS_QUADRO.map(e => {
      let ls = leads.filter(l => (l.etapa || "Novo") === e);
      if (e === "Fechou" || e === "Não fechou") ls = ls.filter(l => (l.data || "") >= limite);
      ls.sort((a, b) => (b.nota ?? -1) - (a.nota ?? -1) || (b.ultima || b.data || "").localeCompare(a.ultima || a.data || ""));
      return `<section class="coluna" data-etapa="${esc(e)}"><header><h3>${esc(e)}</h3><span class="cont">${ls.length}</span></header>
        ${ls.map(l => `<button type="button" class="cartao${leadAberto === l.linha ? " aberto" : ""}" draggable="true" data-lead="${l.linha}">
          <span class="topo"><span class="bola ${TERMO[l.cor] || "info"}"></span><b>${esc(l.nome)}</b></span>
          ${termoTag(l)}
          <small>${esc([l.ultima ? `última ação ${ddIso(l.ultima)}` : "", l.proximo && ABERTAS.includes(l.etapa) ? `chamar ${ddIso(l.proximo)}` : ""].filter(Boolean).join(" · ") || `desde ${ddIso(l.data)}`)}</small></button>`).join("") || `<p class="vazio">—</p>`}
        ${e === "Fechou" || e === "Não fechou" ? `<p class="sub">últimos 3 meses</p>` : ""}</section>`; }).join("")}</div>
      <p class="sub">Toque num cartão para ver a história e mudar a etapa. No computador, dá para arrastar o cartão para outra coluna.</p>`;
    if (aberto) h += `<div class="lead aberto"><div class="aluno"><span class="bola ${TERMO[aberto.cor] || "info"}"></span><span class="meio"><h3>${esc(aberto.nome)}</h3><p>${esc([aberto.etapa, aberto.interesse === "Personal presencial" ? "Presencial" : aberto.interesse === "Consultoria online" ? "Online" : ""].filter(Boolean).join(" · "))}</p></span>
      <span class="acoes">${contatoLink(aberto.contato) ? `<a class="btn" href="${esc(contatoLink(aberto.contato).url)}" target="_blank" rel="noopener">${contatoLink(aberto.contato).rot}</a>` : ""}<button class="btn amarelo" type="button" data-fechar="1">Fechar</button></span></div><div id="ldEd"></div></div>`;
  }

  const abertos = leads.filter(l => ABERTAS.includes(l.etapa));
  const chamar = abertos.filter(l => l.proximo && isoData(l.proximo) <= hoje).sort((a, b) => a.proximo.localeCompare(b.proximo));
  const semData = abertos.filter(l => !l.proximo);
  const depois = abertos.filter(l => l.proximo && isoData(l.proximo) > hoje).sort((a, b) => a.proximo.localeCompare(b.proximo));
  const linha = (l, frase, nivel) => { const c = contatoLink(l.contato), aberto = leadAberto === l.linha;
    return `<div class="lead${aberto ? " aberto" : ""}"><div class="aluno"><span class="bola ${nivel}"></span><span class="meio"><h3>${esc(l.nome)}</h3><p>${termoTag(l)}${termoTag(l) ? " " : ""}${esc([l.etapa || "Sem etapa", l.interesse === "Personal presencial" ? "Presencial" : l.interesse === "Consultoria online" ? "Online" : "", frase].filter(Boolean).join(" · "))}</p></span>
      <span class="acoes">${c ? `<a class="btn" href="${esc(c.url)}" target="_blank" rel="noopener">${c.rot}</a>` : ""}<button class="btn${aberto ? " amarelo" : ""}" type="button" data-lead="${l.linha}">${aberto ? "Cancelar" : "Atualizar"}</button></span></div>
      ${aberto ? `<div id="ldEd"></div>` : ""}</div>`; };
  if (leadsVista === "lista"){
  h += `<section class="secao"><header><h2>Chamar hoje</h2><span class="cont">${plural(chamar.length, "lead")}</span></header>`;
  h += chamar.length ? `<div class="lista">${chamar.map(l => { const n = dias(isoData(l.proximo), hoje); return linha(l, n ? `atrasado ${plural(n, "dia")} (era ${ddIso(l.proximo)})` : "hoje", n ? "atencao" : "aviso"); }).join("")}</div>` : `<p class="vazio">Ninguém para chamar hoje.</p>`;
  h += `</section>`;
  if (semData.length) h += `<section class="secao"><header><h2>Sem data de contato</h2><span class="cont">ponha uma data</span></header><div class="lista">${semData.map(l => linha(l, `desde ${ddIso(l.data)}`, "aviso")).join("")}</div></section>`;
  if (depois.length) h += `<section class="secao"><header><h2>Próximos contatos</h2><span class="cont">${plural(depois.length, "lead")}</span></header><div class="lista">${depois.map(l => linha(l, `chamar em ${ddIso(l.proximo)}`, "ok")).join("")}</div></section>`;
  const quentes = abertos.filter(l => l.cor === "Quente" || l.cor === "Pronto").sort((a, b) => (b.nota || 0) - (a.nota || 0));
  if (quentes.length) h += `<section class="secao"><header><h2>Esquentando</h2><span class="cont">pelo termômetro</span></header><div class="lista">${quentes.map(l => linha(l, `${l.cor} (${l.nota})${l.ultima ? `, última ação ${ddIso(l.ultima)}` : ""}`, l.cor === "Pronto" ? "atencao" : "aviso")).join("")}</div></section>`;
  }

  // de onde vêm (este ano), como no painel
  const anoTxt = String(ano), porOrigem = {};
  leads.filter(l => (l.data || "").startsWith(anoTxt)).forEach(l => { const o = l.origem || "Sem origem"; const g = porOrigem[o] = porOrigem[o] || {leads: 0, vendas: 0}; g.leads++; if (l.etapa === "Fechou") g.vendas++; });
  const orig = Object.entries(porOrigem).sort((a, b) => b[1].vendas - a[1].vendas || b[1].leads - a[1].leads);
  if (orig.length) h += `<section class="secao"><header><h2>De onde vêm</h2><span class="cont">${anoTxt}</span></header><div class="card"><table class="tab-leads"><thead><tr><th>Origem</th><th>Leads</th><th>Vendas</th><th>Conversão</th></tr></thead><tbody>${orig.map(([o, g]) => `<tr><td>${esc(o)}</td><td>${g.leads}</td><td>${g.vendas}</td><td>${Math.round(g.vendas / g.leads * 100)}%</td></tr>`).join("")}</tbody></table></div></section>`;
  const quando = LEADS.lido_em ? new Date(LEADS.lido_em) : null;
  h += `<p class="sub">${quando ? `Lido da planilha às ${String(quando.getHours()).padStart(2,"0")}:${String(quando.getMinutes()).padStart(2,"0")} de ${dd(quando)}. ` : ""}A agenda ("Leads: chamar") é atualizada pela rotina da manhã. <a href="${esc(LEADS.planilha || "#")}" target="_blank" rel="noopener">Abrir a planilha</a></p>`;
  $("tela").innerHTML = h;

  $("ldNovo").onclick = () => { leadForm = !leadForm; leadAberto = 0; leadFeito = null; telaLeads(); };
  if ($("ldPagar")) $("ldPagar").onclick = () => { finForm = "pag"; finPrefill = leadFeito.nome; leadFeito = null; };
  document.querySelectorAll("[data-lead]").forEach(b => b.onclick = () => { const n = Number(b.dataset.lead); leadAberto = leadAberto === n ? 0 : n; leadEtapaNova = ""; leadForm = false; leadFeito = null; telaLeads();
    if (leadAberto && leadsVista === "quadro" && $("ldEd")) $("ldEd").scrollIntoView({behavior: "smooth", block: "start"}); });
  document.querySelectorAll("[data-fechar]").forEach(b => b.onclick = () => { leadAberto = 0; telaLeads(); });
  ligarEscolha("ldVista", v => { leadsVista = v; guardar("t_leads_vista", v); leadAberto = 0; telaLeads(); });
  ligarQuadro(); ligarInstagram();
  if (leadForm) formLead();
  if (leadAberto) editarLead((LEADS.leads || []).find(l => l.linha === leadAberto), leadEtapaNova);
  if (!quando || Date.now() - quando > 5 * 60e3) lerLeads(true);
}

// Arrastar no computador (no celular é tocar e escolher a etapa): soltar numa coluna abre o cartão já com a etapa nova.
function ligarQuadro(){
  if (!$("ldQuadro")) return;
  document.querySelectorAll(".cartao[draggable]").forEach(c => c.ondragstart = ev => { ev.dataTransfer.setData("text/plain", c.dataset.lead); ev.dataTransfer.effectAllowed = "move"; });
  document.querySelectorAll(".coluna").forEach(col => {
    col.ondragover = ev => { ev.preventDefault(); col.classList.add("alvo"); };
    col.ondragleave = () => col.classList.remove("alvo");
    col.ondrop = ev => { ev.preventDefault(); col.classList.remove("alvo"); const n = Number(ev.dataTransfer.getData("text/plain")); const l = (LEADS.leads || []).find(x => x.linha === n);
      if (!l || l.etapa === col.dataset.etapa) return; leadAberto = n; leadEtapaNova = col.dataset.etapa; leadFeito = null; telaLeads(); };
  });
}

// Instagram automático (servidor versão 18): a chave fica só no servidor; daqui ela só passa uma vez, quando o criador cola.
function cartaoInstagram(){
  const ig = LEADS && LEADS.ig;
  if (!ig) return `<div class="card"><h3>📷 Instagram automático</h3><p class="sub">Para ler comentários e DMs sozinho, o servidor do app precisa da versão 18. Cole o código novo pela página Ligar o app do treinador e toque em ↻.</p></div>`;
  const quando = ig.lido_em ? new Date(ig.lido_em) : null, u = ig.ultimo;
  let h = `<div class="card ig"><div class="ig-topo"><h3>📷 Instagram automático</h3><span class="termo ${ig.ligado ? "t-ok" : "t-frio"}">${ig.ligado ? "ligado" : "desligado"}</span></div>`;
  if (ig.ligado){
    h += `<p class="sub">${ig.usuario ? `Conta @${esc(ig.usuario)}. ` : ""}Todo dia às 7h eu leio os comentários, as DMs e as respostas de story e anoto no termômetro.${quando ? ` Última leitura: ${dd(quando)} às ${String(quando.getHours()).padStart(2, "0")}:${String(quando.getMinutes()).padStart(2, "0")}${u ? ` (${plural(u.interacoes || 0, "ação", "ações")}, ${plural(u.leads_novos || 0, "lead novo", "leads novos")})` : ""}.` : ""}</p>`;
    if (ig.erro) h += `<p class="sub erro">O Instagram respondeu: ${esc(ig.erro)}. Se falar de chave ou "token", gere uma chave nova e troque aqui.</p>`;
    if (!ig.despertador) h += `<p class="sub erro">O despertador das 7h não está ligado: troque a chave (cole a mesma) para ligar de novo.</p>`;
    h += `<div class="acoes"><button class="btn amarelo" type="button" id="igAgora">Ler agora</button><button class="btn" type="button" id="igTrocar">${igAberto ? "Cancelar" : "Trocar a chave"}</button><button class="btn" type="button" id="igDesl">Desligar</button></div>`;
  } else {
    h += `<p class="sub">Lê sozinho os comentários, as DMs e as respostas de story e põe no termômetro. Curtidas e quem começou a seguir continuam pelo print. Para ligar, crie a chave no aplicativo da Meta (o passo a passo está no chat) e cole aqui.</p>`;
    if (!igAberto) h += `<div class="acoes"><button class="btn amarelo" type="button" id="igTrocar">Colar a chave</button></div>`;
  }
  if (igAberto) h += `<div class="form"><label>Chave do Instagram (o código comprido que a Meta mostrou)<textarea class="busca" id="igChave" rows="3" autocomplete="off" spellcheck="false"></textarea></label>
    <p class="sub">A chave vai direto para o servidor do seu app e fica guardada só lá. Não mande essa chave no chat.</p>
    <div class="acoes"><button class="btn amarelo" type="button" id="igOk">Ligar</button></div></div>`;
  h += `<p class="sub" id="igMsg"></p></div>`;
  return h;
}
function ligarInstagram(){
  if ($("igTrocar")) $("igTrocar").onclick = () => { igAberto = !igAberto; telaLeads(); if (igAberto && $("igChave")) $("igChave").focus(); };
  const enviar = async (corpo, msg, depois) => {
    if (igEnviando) return; igEnviando = true; $("igMsg").textContent = msg;
    try { const j = await chamar(corpo, 120000); lerLeadsDe(j); igAberto = false; leadFeito = depois(j.feito || {}); telaLeads(); window.scrollTo({top: 0}); }
    catch(e){ $("igMsg").textContent = e.servidor ? (/desconhecida/i.test(e.message) ? "O servidor ainda é a versão antiga: cole o código novo (versão 18)." : e.message) : "Sem internet: tente de novo quando a internet voltar."; }
    finally { igEnviando = false; }
  };
  if ($("igOk")) $("igOk").onclick = () => { const t = ($("igChave").value || "").replace(/\s+/g, ""); if (t.length < 50){ $("igMsg").textContent = "Cole o código inteiro (ele é bem comprido)."; return; }
    enviar({acao: "t_ig_chave", token: t}, "Conferindo com o Instagram…", f => ({texto: `Instagram ligado${f.usuario ? ` (@${f.usuario})` : ""}. Amanhã às 7h sai a primeira leitura; para ver já, toque em Ler agora.`})); };
  if ($("igAgora")) $("igAgora").onclick = () => enviar({acao: "t_ig_agora"}, "Lendo o Instagram… (pode levar 1 minuto)", f => ({texto: f.ig === "lido" ? `Li o Instagram: ${plural(f.interacoes || 0, "ação nova", "ações novas")}, ${plural(f.leads_novos || 0, "lead novo", "leads novos")}.${f.erro ? ` Aviso: ${f.erro}` : ""}` : "O Instagram não está ligado."}));
  if ($("igDesl")) $("igDesl").onclick = () => { if (confirm("Desligar o Instagram automático? A chave sai do servidor e a leitura das 7h para. O que já foi anotado continua.")) enviar({acao: "t_ig_desligar"}, "Desligando…", () => ({texto: "Instagram automático desligado."})); };
}

function datasRapidas(id){ return `<div class="filtros" role="group" id="${id}R">${[["1", "Amanhã"], ["3", "Em 3 dias"], ["7", "Em 1 semana"], ["0", "Sem data"]].map(([v, t]) => `<button type="button" data-d="${v}">${t}</button>`).join("")}</div>`; }
function ligarDatas(id){ document.querySelectorAll(`#${id}R button`).forEach(b => b.onclick = () => { const n = Number(b.dataset.d), h = hojeZero(); $(id).value = n ? isoDe(new Date(h.getFullYear(), h.getMonth(), h.getDate() + n)) : ""; }); }

function formLead(){
  $("ldForm").innerHTML = `<div class="card form"><h2>Lead novo</h2>
    <label>Nome<input class="busca" id="lnNome" maxlength="120" autocomplete="off"></label>
    <label>@ do Instagram ou WhatsApp<input class="busca" id="lnContato" maxlength="120" autocomplete="off" placeholder="@fulana ou 44999999999"></label>
    <div><span class="rot">De onde veio</span>${escolha("lnOrigem", (LEADS.origens || []).map(o => [o, o]), "DM")}</div>
    <div><span class="rot">Interesse</span>${escolha("lnInt", [["Consultoria online", "Consultoria online"], ["Personal presencial", "Presencial"]], "Consultoria online")}</div>
    <div><span class="rot">Etapa</span>${escolha("lnEtapa", [["Novo", "Novo"], ["Conversando", "Conversando"], ["Proposta enviada", "Proposta enviada"]], "Conversando")}</div>
    <label>Próximo contato<input class="busca" type="date" id="lnProx"></label>${datasRapidas("lnProx")}
    <label>Observação (opcional)<input class="busca" id="lnObs" maxlength="500"></label>
    <p class="sub" id="lnMsg"></p>
    <div class="acoes"><button class="btn amarelo" type="button" id="lnOk">Anotar na planilha</button><button class="btn" type="button" id="lnX">Cancelar</button></div></div>`;
  const h = hojeZero(); $("lnProx").value = isoDe(new Date(h.getFullYear(), h.getMonth(), h.getDate() + 1));
  ["lnOrigem", "lnInt", "lnEtapa"].forEach(id => ligarEscolha(id)); ligarDatas("lnProx");
  $("lnX").onclick = () => { leadForm = false; telaLeads(); };
  $("lnOk").onclick = async () => {
    const l = {nome: txt($("lnNome").value), contato: txt($("lnContato").value), origem: valorDe("lnOrigem"), interesse: valorDe("lnInt"), etapa: valorDe("lnEtapa"),
      proximo: $("lnProx").value, data: isoDe(hojeZero()), obs: txt($("lnObs").value)};
    if (!l.nome){ $("lnMsg").textContent = "Escreva o nome do lead."; return; }
    if (leadEnviando) return; leadEnviando = true; $("lnOk").disabled = true; $("lnMsg").textContent = "Anotando…";
    try {
      const j = await chamar({acao: "t_lead_novo", l}, 60000);
      lerLeadsDe(j); leadForm = false; leadFeito = {texto: `${l.nome} entrou nos leads${l.proximo ? `, para chamar em ${ddIso(l.proximo)}` : ""}.`};
      telaLeads(); window.scrollTo({top: 0});
    } catch(e){ $("lnOk").disabled = false; $("lnMsg").textContent = e.servidor ? e.message : "Sem internet: nada foi anotado. Tente de novo quando a internet voltar."; }
    finally { leadEnviando = false; }
  };
}

function historicoLead(l){
  const itens = (l.hist || []).map(x => ({data: x.data, t: `${x.acao}${x.pontos ? ` (+${x.pontos})` : ""}`, s: [x.obs, x.de].filter(Boolean).join(" · ")}));
  const ano = (l.data || "").slice(0, 4) || String(hojeZero().getFullYear());
  String(l.obs || "").split("|").map(t => t.trim()).filter(Boolean).forEach(t => {
    const m = /^(\d{1,2})\/(\d{1,2}):\s*(.*)$/.exec(t);
    if (m) itens.push({data: `${ano}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`, t: "Observação", s: m[3]});
    else itens.push({data: l.data || "", t: "Observação", s: t});
  });
  if (l.data) itens.push({data: l.data, t: "Entrou nos leads", s: l.origem ? `origem: ${l.origem}` : ""});
  itens.sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  if (!itens.length) return "";
  return `<div class="hist"><span class="rot">História${l.cor ? ` · termômetro: ${esc(l.cor)} (${l.nota})` : ""}</span><ol>${itens.slice(0, 30).map(x => `<li><time>${x.data ? ddIso(x.data) : ""}</time><b>${esc(x.t)}</b>${x.s ? `<span>${esc(x.s)}</span>` : ""}</li>`).join("")}</ol></div>`;
}

function editarLead(l, etapaNova){
  if (!l || !$("ldEd")) return;
  $("ldEd").innerHTML = `<div class="card form">
    ${historicoLead(l)}
    <div><span class="rot">Etapa</span>${escolha("leEtapa", (LEADS.etapas || []).map(e => [e, e]), etapaNova || l.etapa)}</div>
    ${l.interesse ? "" : `<div><span class="rot">Interesse</span>${escolha("leInt", [["Consultoria online", "Consultoria online"], ["Personal presencial", "Presencial"]], "")}</div>`}
    <label>Plano / valor (quando mandar a proposta)<input class="busca" id="lePlano" maxlength="80" value="${esc(l.plano)}" placeholder="Ex.: Trimestral R$ 497"></label>
    <label id="leMotRot"${(etapaNova || l.etapa) === "Não fechou" ? "" : " hidden"}>Motivo<select id="leMot"><option value="">Escolha</option>${opcoes((LEADS.motivos || []).map(m => [m, m]), l.motivo)}</select></label>
    <label>Próximo contato<input class="busca" type="date" id="leProx" value="${esc(l.proximo)}"></label>${datasRapidas("leProx")}
    <label>Acrescentar observação (a de antes continua)<input class="busca" id="leObs" maxlength="300"></label>
    ${l.obs && !(l.hist) ? `<p class="sub">Observações: ${esc(l.obs)}</p>` : ""}
    <p class="sub" id="leMsg">${etapaNova && etapaNova !== l.etapa ? `Mudando de ${esc(l.etapa)} para ${esc(etapaNova)}: confira e salve.` : ""}</p>
    <div class="acoes"><button class="btn amarelo" type="button" id="leOk">Salvar na planilha</button></div></div>`;
  ligarEscolha("leEtapa", v => { $("leMotRot").hidden = v !== "Não fechou"; if (v === "Fechou" || v === "Não fechou") $("leProx").value = ""; });
  if ($("leInt")) ligarEscolha("leInt");
  ligarDatas("leProx");
  $("leOk").onclick = async () => {
    const m = {etapa: valorDe("leEtapa"), plano: txt($("lePlano").value), proximo: $("leProx").value, motivo: $("leMot").value, obs_mais: txt($("leObs").value)};
    if ($("leInt") && valorDe("leInt")) m.interesse = valorDe("leInt");
    if (m.etapa === "Fechou" && !l.interesse && !m.interesse){ $("leMsg").textContent = "Escolha o interesse: consultoria online ou presencial."; return; }
    if (ABERTAS.includes(m.etapa) && !m.proximo && !confirm("Deixar sem data de próximo contato? Ele não entra na agenda.")) return;
    if (leadEnviando) return; leadEnviando = true; $("leOk").disabled = true; $("leMsg").textContent = "Salvando…";
    try {
      const j = await chamar({acao: "t_lead_mudar", linha: l.linha, nome: l.nome, m}, 60000);
      lerLeadsDe(j); leadAberto = 0;
      leadFeito = {nome: l.nome, fechou: m.etapa === "Fechou" && l.etapa !== "Fechou" && (m.interesse || l.interesse) === "Consultoria online",
        texto: m.etapa === "Fechou" && l.etapa !== "Fechou" ? `${l.nome} fechou! Amanhã de manhã a rotina dos leads cria a pasta do aluno.` : `${l.nome}: ${m.etapa}${m.proximo ? `, chamar em ${ddIso(m.proximo)}` : ""}.`};
      telaLeads(); window.scrollTo({top: 0});
    } catch(e){ $("leOk").disabled = false; $("leMsg").textContent = e.servidor ? e.message : "Sem internet: nada foi salvo. Tente de novo quando a internet voltar."; }
    finally { leadEnviando = false; }
  };
}

// ---------- PRESCRIÇÃO (servidor versão 10; aba Treino do Protocolo, skill treinador, seção 3) ----------
// Muda exercício, séries, técnica e observação nos 9 lugares fixos de cada treino; e começa o ciclo novo a partir do atual.
// Faixas de repetição, periodização e cardio continuam na planilha (computador).
const PRESC_DESDE = 10;
let PRESC_ED = "", PRESC_CICLO = false, PRESC_DATAS = false, prescEnviando = false;
function semanasAnotadas(d, nome){
  const ws = new Set();
  Object.values(d.reg || {}).forEach(v => { for (let w = 1; w <= 12; w++) for (let k = 1; k <= 9; k++){ const row = v[linhaReg(w, k)] || [];
    if (nomeDaLinha(row) === nome && row.slice(1, 11).some(x => txt(x) !== "")) ws.add(w); } });
  return ws.size;
}
function prescricaoAluno(a){
  const d = DADOS[a.chave] || {}, p = d.prescricao, c = ciclo(a);
  if (!p){ $("corpo").innerHTML = `<div class="card"><p class="sub">${esc(d.prescricaoErro || "Para mudar o treino pelo app, cole o código novo do servidor (página Ligar o app do treinador, versão 10) e toque em ↻.")}</p></div>`; return; }
  const T = lerTreino(d.treino || []), diasDe = L => ORDEM.filter(x => T.periodo[x] === L).map(x => NOMES[x].slice(0, 3).toLowerCase());
  let h = `<div class="card"><h3>Ciclo atual</h3><p class="sub">${c.entrega ? `Começou em ${ddaaaa(c.entrega)}` : "Sem data de entrega"}${c.revisao ? ` · revisão em ${ddaaaa(c.revisao)}` : ""}${c.semana ? ` · semana ${Math.min(c.semana, c.total)} de ${c.total}` : ""}</p>
    <div class="acoes"><button class="btn${PRESC_DATAS ? " amarelo" : !c.entrega ? " amarelo" : ""}" type="button" id="dtAbrir">${PRESC_DATAS ? "Cancelar" : c.entrega ? "Mudar as datas" : "Pôr as datas do ciclo"}</button><button class="btn${PRESC_CICLO ? " amarelo" : ""}" type="button" id="cnAbrir">Começar o ciclo novo a partir deste</button></div><div id="dtForm"></div><div id="cnForm"></div></div>`;
  h += v11() ? cicloResumoHtml(a, d) : `<p class="sub">Faixas de repetição, periodização e cardio continuam na planilha. ${AVISO_V11}</p>`;
  ["A","B","C","D","E"].forEach(L => {
    const slots = (p.treinos || {})[L] || [], usados = slots.filter(s => s.nome), vago = slots.find(s => !s.nome), dias = diasDe(L);
    if (!usados.length && !dias.length) return;
    h += `<section class="secao"><header><h2>Treino ${L}</h2><span class="cont">${dias.length ? dias.join(", ") : "fora da periodização"}</span></header><div class="lista">`;
    usados.forEach((s, i) => { const id = `${L}|${s.k}`, aberto = PRESC_ED === id;
      h += `<div class="lead${aberto ? " aberto" : ""}"><div class="aluno"><span class="n-ex">${i + 1}</span><span class="meio"><h3>${esc(s.nome)}</h3><p>${esc([s.series ? plural(Number(s.series) || 0, "série") : "sem séries", s.tecnica].filter(Boolean).join(" · "))}${s.obs ? `<br>${esc(s.obs)}` : ""}</p></span>
        <button class="btn${aberto ? " amarelo" : ""}" type="button" data-ed="${id}">${aberto ? "Cancelar" : "Editar"}</button></div>${aberto ? `<div id="exEd"></div>` : ""}</div>`; });
    if (vago){ const id = `${L}|${vago.k}`, aberto = PRESC_ED === id;
      h += aberto ? `<div class="lead aberto"><div id="exEd"></div></div>` : `<div><button class="btn" type="button" data-ed="${id}">+ Adicionar exercício</button></div>`; }
    h += `</div></section>`;
  });
  if (a.planilha) h += `<p class="sub"><a href="${esc(a.planilha)}" target="_blank" rel="noopener">Abrir a planilha</a></p>`;
  $("corpo").innerHTML = h;
  document.querySelectorAll("[data-ed]").forEach(b => b.onclick = () => { PRESC_ED = PRESC_ED === b.dataset.ed ? "" : b.dataset.ed; PRESC_CICLO = false; PRESC_DATAS = false; PLANO_ED = false; prescricaoAluno(a); });
  $("cnAbrir").onclick = () => { PRESC_CICLO = !PRESC_CICLO; PRESC_ED = ""; PRESC_DATAS = false; PLANO_ED = false; prescricaoAluno(a); };
  $("dtAbrir").onclick = () => { PRESC_DATAS = !PRESC_DATAS; PRESC_ED = ""; PRESC_CICLO = false; PLANO_ED = false; prescricaoAluno(a); };
  if ($("plAbrir")) $("plAbrir").onclick = () => { PLANO_ED = !PLANO_ED; PRESC_ED = ""; PRESC_CICLO = false; PRESC_DATAS = false; prescricaoAluno(a); if (PLANO_ED) $("plForm").scrollIntoView({behavior: "smooth", block: "start"}); };
  if (PLANO_ED) formPlano(a, d);
  if (PRESC_ED && $("exEd")) editarExercicio(a, d, p);
  if (PRESC_CICLO) formCiclo(a, c);
  if (PRESC_DATAS) formDatas(a, d, c);
}

// datas do ciclo atual (servidor versão 16): para o primeiro treino do aluno novo, ou para acertar o começo e a revisão
const DATAS_DESDE = 16;
function formDatas(a, d, c){
  if (((INICIO && INICIO.versao) || 0) < DATAS_DESDE){
    $("dtForm").innerHTML = `<div class="card" style="margin-top:8px"><p class="sub">Para pôr as datas pelo app, cole o código novo do servidor (página Ligar o app do treinador, versão 16) e toque em ↻.</p></div>`; return; }
  const ini = c.entrega || proximaSegunda();
  const rev = c.revisao || new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + 7 * 12 - 3);
  const dur = Math.round((rev - ini) / DIA_MS);
  const anotou = Object.values(d.reg || {}).some(v => { for (let w = 1; w <= 12; w++) for (let k = 1; k <= 9; k++) if ((v[linhaReg(w, k)] || []).slice(1, 11).some(x => txt(x) !== "")) return true; return false; });
  $("dtForm").innerHTML = `<div class="card form" style="margin-top:8px"><h3>Datas do ciclo</h3>
    <p class="sub">${c.entrega ? "Muda o começo e a revisão deste ciclo, na mesma planilha." : `O dia em que ${esc(primeiro(a.nome))} começa a treinar e o dia da revisão. Com as datas, o app do aluno já abre na semana certa.`}</p>
    <label>Começa em (segunda)<input class="busca" type="date" id="dtIni" value="${isoDe(ini)}"></label>
    <label>Revisão<input class="busca" type="date" id="dtRev" value="${isoDe(rev)}"></label>
    <p class="sub" id="dtMsg"></p>
    <div class="acoes"><button class="btn amarelo" type="button" id="dtOk">Salvar na planilha</button></div></div>`;
  const conf = () => { const x = isoData($("dtIni").value); $("dtMsg").textContent = x && x.getDay() !== 1 ? "O treino começa numa segunda-feira." : x && x < hojeZero() && !c.entrega ? "Atenção: essa data já passou." : ""; };
  $("dtIni").onchange = () => { const x = isoData($("dtIni").value); if (x && !c.revisao) $("dtRev").value = isoDe(new Date(x.getFullYear(), x.getMonth(), x.getDate() + dur)); conf(); };
  conf();
  $("dtOk").onclick = async () => {
    const i = isoData($("dtIni").value), r = isoData($("dtRev").value);
    if (!i || i.getDay() !== 1){ $("dtMsg").textContent = "Escolha uma segunda-feira para começar."; return; }
    if (!r || r <= i){ $("dtMsg").textContent = "A revisão tem de ser depois do começo."; return; }
    const mudouIni = !c.entrega || isoDe(c.entrega) !== isoDe(i);
    if (anotou && mudouIni && !confirm(`${a.nome} já anotou treinos neste ciclo. Mudar o começo muda a semana de cada anotação (a semana 1 passa a ser a de ${ddaaaa(i)}). Mudar mesmo assim?`)) return;
    if (!confirm(`Salvar: começa em ${ddaaaa(i)} e revisão em ${ddaaaa(r)}?`)) return;
    if (prescEnviando) return; prescEnviando = true; $("dtOk").disabled = true; $("dtMsg").textContent = "Salvando…";
    try {
      const nd = await chamar({acao: "t_datas", aluno: a.chave, inicio: $("dtIni").value, revisao: $("dtRev").value}, 60000);
      DADOS[a.chave] = nd; guardar("t_aluno:" + a.chave, nd); PRESC_DATAS = false;
      $("dtForm").innerHTML = `<div class="card ok-card" style="margin-top:8px"><h3>Datas salvas ✓</h3><p class="sub">De ${ddaaaa(i)} até a revisão em ${ddaaaa(r)}. Para pôr na agenda, me diga no chat: "põe ${esc(primeiro(a.nome))} na agenda".</p></div>`;
      aviso("Datas salvas ✓"); atualizar();
    } catch(e){ $("dtOk").disabled = false; $("dtMsg").textContent = e.servidor ? e.message : "Sem internet: nada foi salvo. Tente de novo quando a internet voltar."; }
    finally { prescEnviando = false; }
  };
}

function editarExercicio(a, d, p){
  const [L, kk] = PRESC_ED.split("|"), k = Number(kk), s = ((p.treinos || {})[L] || [])[k] || {}, novo = !s.nome;
  const nomes = [...new Set((d.videos || []).map(r => txt(r[0])).filter(n => n && !/^exerc[íi]cio/i.test(n)))].sort((x, y) => x.localeCompare(y, "pt-BR"));
  $("exEd").innerHTML = `<div class="card form"><h3>${novo ? `Exercício novo no Treino ${L}` : "Editar exercício"}</h3>
    <label>Exercício (da lista de vídeos)<input class="busca" id="exNome" list="exNomes" autocomplete="off" value="${esc(s.nome || "")}" placeholder="Comece a digitar"></label>
    <datalist id="exNomes">${nomes.map(n => `<option value="${esc(n)}">`).join("")}</datalist>
    <label>Séries<select id="exSeries">${opcoes(Array.from({length: 10}, (_, i) => [String(i + 1), String(i + 1)]), String(Number(s.series) || 3))}</select></label>
    <label>Técnica<select id="exTec"><option value="">Nenhuma</option>${opcoes((p.tecnicas || []).map(t => [t, t]), s.tecnica)}</select></label>
    <label>Observação${k === 0 ? " (no 1º exercício, ela também vale como aviso do treino todo)" : ""}<textarea class="busca" id="exObs" rows="3" maxlength="500">${esc(s.obs || "")}</textarea></label>
    <p class="sub" id="exMsg"></p>
    <div class="acoes"><button class="btn amarelo" type="button" id="exOk">Salvar na planilha</button>${novo ? "" : `<button class="btn" type="button" id="exTirar">Tirar do treino</button>`}</div></div>`;
  const mandar = async (m, texto) => {
    if (prescEnviando) return; prescEnviando = true; $("exOk").disabled = true; $("exMsg").textContent = "Salvando…";
    try {
      const nd = await chamar({acao: "t_treino_mudar", aluno: a.chave, letra: L, k, m}, 60000);
      DADOS[a.chave] = nd; guardar("t_aluno:" + a.chave, nd); PRESC_ED = ""; prescricaoAluno(a); aviso(texto);
    } catch(e){ $("exOk").disabled = false; $("exMsg").textContent = e.servidor ? e.message : "Sem internet: nada foi salvo. Tente de novo quando a internet voltar."; }
    finally { prescEnviando = false; }
  };
  $("exOk").onclick = () => {
    const nome = txt($("exNome").value), achou = nomes.find(n => n.toLowerCase() === nome.toLowerCase());
    if (!achou){ $("exMsg").textContent = "Escolha um exercício da lista (é dela que saem o vídeo e o volume)."; return; }
    if (!novo && achou !== s.nome){ const n = semanasAnotadas(d, s.nome);
      if (n && !confirm(`${s.nome} já tem ${plural(n, "semana anotada", "semanas anotadas")} neste ciclo. Depois da troca, essas semanas vão aparecer com o nome novo (${achou}) no histórico. Trocar mesmo assim?`)) return; }
    mandar({nome: achou, series: Number($("exSeries").value), tecnica: $("exTec").value, obs: $("exObs").value}, novo ? "Exercício adicionado ✓" : "Treino atualizado ✓");
  };
  if ($("exTirar")) $("exTirar").onclick = () => { const n = semanasAnotadas(d, s.nome);
    if (!confirm(`Tirar ${s.nome} do Treino ${L}?${n ? ` Ele tem ${plural(n, "semana anotada", "semanas anotadas")}: os números continuam na planilha, mas somem do histórico do app.` : ""}`)) return;
    mandar({remover: true}, "Exercício tirado do treino ✓"); };
}

function formCiclo(a, c){
  const fim = fimDoPlano(c), h = hojeZero();
  const ini = fim ? new Date(fim.getFullYear(), fim.getMonth(), fim.getDate() + 1) : proximaSegunda();
  const dur = c.entrega && c.revisao ? Math.round((c.revisao - c.entrega) / DIA_MS) : 7 * 12 - 3;
  const rev = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + dur);
  $("cnForm").innerHTML = `<div class="card form" style="margin-top:8px"><h3>Ciclo novo</h3>
    <p class="sub">O app cria uma planilha nova na pasta de ${esc(primeiro(a.nome))}, com o mesmo treino e as anotações vazias. A planilha atual vira "ANTIGO … (ciclo até …)" e continua guardada. O app do aluno passa a abrir a planilha nova. Faça depois que o aluno anotar a última semana do ciclo atual.</p>
    <label>Começa em (segunda)<input class="busca" type="date" id="cnIni" value="${isoDe(ini)}"></label>
    <label>Revisão<input class="busca" type="date" id="cnRev" value="${isoDe(rev)}"></label>
    <p class="sub" id="cnMsg"></p>
    <div class="acoes"><button class="btn amarelo" type="button" id="cnOk">Criar o ciclo novo</button></div></div>`;
  const conf = () => { const d = isoData($("cnIni").value); $("cnMsg").textContent = d && d.getDay() !== 1 ? "O ciclo começa numa segunda-feira." : d && d < h ? "Atenção: essa data já passou." : ""; };
  $("cnIni").onchange = () => { const d = isoData($("cnIni").value); if (d){ $("cnRev").value = isoDe(new Date(d.getFullYear(), d.getMonth(), d.getDate() + dur)); } conf(); };
  conf();
  $("cnOk").onclick = async () => {
    const i = isoData($("cnIni").value), r = isoData($("cnRev").value);
    if (!i || i.getDay() !== 1){ $("cnMsg").textContent = "Escolha uma segunda-feira para começar."; return; }
    if (!r || r <= i){ $("cnMsg").textContent = "A revisão tem de ser depois do começo."; return; }
    if (!confirm(`Criar o ciclo novo de ${a.nome}, de ${ddaaaa(i)} até a revisão em ${ddaaaa(r)}?`)) return;
    if (prescEnviando) return; prescEnviando = true; $("cnOk").disabled = true; $("cnMsg").textContent = "Criando a planilha nova (uns 20 segundos)…";
    try {
      const j = await chamar({acao: "t_ciclo_novo", aluno: a.chave, inicio: $("cnIni").value, revisao: $("cnRev").value}, 90000);
      delete DADOS[a.chave]; try { localStorage.removeItem("t_aluno:" + a.chave); } catch(e){}
      PRESC_CICLO = false;
      $("cnForm").innerHTML = `<div class="card ok-card" style="margin-top:8px"><h3>Ciclo novo criado ✓</h3><p class="sub">A planilha antiga ficou como "${esc(j.antigo)}". ${j.app ? "O app do aluno já abre a planilha nova." : "Este aluno não tem linha na planilha de acessos do app."} Mude o que precisar no Treino e, para pôr as datas na agenda, me diga no chat: "mudei o treino de ${esc(primeiro(a.nome))}".</p><div class="acoes"><a class="btn" href="${esc(j.url)}" target="_blank" rel="noopener">Abrir a planilha nova</a></div></div>`;
      atualizar();
    } catch(e){ $("cnOk").disabled = false; $("cnMsg").textContent = e.servidor ? e.message : "Sem internet: nada foi criado. Tente de novo quando a internet voltar."; }
    finally { prescEnviando = false; }
  };
}

// ---------- versão 11: aba Avaliação (fotos + avaliação física) e o ciclo (faixas, dias e cardio) na aba Treino ----------
const V11_DESDE = 11;
const v11 = () => ((INICIO && INICIO.versao) || 0) >= V11_DESDE;
const AVISO_V11 = `Para isto, cole o código novo do servidor (página Ligar o app do treinador, versão 11) e toque em ↻.`;
const isoDePlanilha = s => { const d = dataPlanilha(s); return d ? isoDe(d) : ""; };

function avaliacaoAluno(a){
  // presencial com a planilha de avaliação: a avaliação física primeiro (é o que se anota na hora); o resto, as fotos primeiro
  const caixa = id => `<div id="${id}" class="wrap" style="width:100%"></div>`;
  $("corpo").innerHTML = a.avaliacao ? caixa("avSec") + caixa("fotosSec") : caixa("fotosSec") + caixa("avSec");
  pintarFotos(a); pintarAv(a);
  if (v11() && !FOTOS_LIDAS[a.chave]) lerFotosAluno(a);
}

// ----- fotos de avaliação (pasta "Avaliações <Nome>"; nome "<Ângulo> AAAA-MM-DD", como a recepcionista renomeia) -----
const FOTO_ANGULOS = ["Frente", "Lado direito", "Lado esquerdo", "Costas", "Outras"];
const FOTOS = {}, FOTOS_LIDAS = {}, FOTOS_ERRO = {}, FOTO_SEL = {}, IMG = {}, PDFS_AV = {};
async function lerFotosAluno(a, deNovo){
  if (!FOTOS[a.chave]) FOTOS[a.chave] = ler("t_fotos:" + a.chave);
  FOTOS_LIDAS[a.chave] = true; delete FOTOS_ERRO[a.chave];
  try { const j = await chamar({acao: "t_fotos", aluno: a.chave, ler_de_novo: !!deNovo}, 60000); FOTOS[a.chave] = j.fotos || []; guardar("t_fotos:" + a.chave, FOTOS[a.chave]);
    if (j.pdfs){ PDFS_AV[a.chave] = j.pdfs; guardar("t_pdfs:" + a.chave, j.pdfs); } }
  catch(e){ FOTOS_LIDAS[a.chave] = false; FOTOS_ERRO[a.chave] = e.servidor ? e.message : "Sem internet: não consegui procurar as fotos."; }
  const r = rota(); if (r.tela === "a" && r.chave === a.chave && r.aba === "avaliacao") pintarFotos(a);
}
function pintarFotos(a){
  const el = $("fotosSec"); if (!el) return;
  if (document.activeElement && document.activeElement.id === "fAnalise") return;   // não apaga o que está sendo escrito
  if (!FOTOS[a.chave]) FOTOS[a.chave] = ler("t_fotos:" + a.chave);
  const lista = FOTOS[a.chave];
  const fOcultas = !!ler("t_ocultar_fotos");
  let h = `<section class="secao${fOcultas ? " fotos-ocultas" : ""}"><header><h2>Fotos de avaliação</h2><span class="cont" id="fotosCont"></span>${botaoOlho("olhoFotos", fOcultas, "as fotos")}</header>`;
  if (!v11()){ el.innerHTML = h + `<div class="card"><p class="sub">${AVISO_V11}</p></div></section>`; return; }
  if (!lista){ el.innerHTML = h + `<div class="card"><p class="${FOTOS_ERRO[a.chave] ? "sub" : "carregando"}">${esc(FOTOS_ERRO[a.chave] || "Procurando as fotos na pasta de avaliações…")}</p>${FOTOS_ERRO[a.chave] ? `<div class="acoes"><button class="btn" type="button" id="fotosDeNovo">Tentar de novo</button></div>` : ""}</div></section>`;
    if ($("fotosDeNovo")) $("fotosDeNovo").onclick = () => { delete FOTOS_ERRO[a.chave]; pintarFotos(a); lerFotosAluno(a, true); };
    return; }
  if (!lista.length){ el.innerHTML = h + `<div class="card"><p class="vazio">Nenhuma foto na pasta "Avaliações ${esc(a.nome)}". As fotos chegam pelo formulário Fotos de avaliação e a recepção leva para a pasta do aluno.</p>
    <div class="acoes"><button class="btn" type="button" id="fotosDeNovo">Procurar de novo</button></div></div></section>`;
    $("fotosDeNovo").onclick = () => { FOTOS[a.chave] = null; pintarFotos(a); lerFotosAluno(a, true); }; return; }
  const datas = [...new Set(lista.map(f => f.data))].sort();
  let [antes, depois] = FOTO_SEL[a.chave] || [datas[0], datas[datas.length - 1]];
  if (!datas.includes(antes)) antes = datas[0];
  if (!datas.includes(depois)) depois = datas[datas.length - 1];
  const mostrar = antes === depois ? [antes] : [antes, depois];
  const rotData = s => ddaaaa(isoData(s));
  h = h.replace(`<span class="cont" id="fotosCont"></span>`, `<span class="cont">${plural(datas.length, "data", "datas")}</span>`);
  h += `<div class="card">`;
  if (datas.length > 1) h += `<div class="av-grid"><label class="sub">Antes<select id="fAntes">${opcoes(datas.map(x => [x, rotData(x)]), antes)}</select></label><label class="sub">Depois<select id="fDepois">${opcoes(datas.map(x => [x, rotData(x)]), depois)}</select></label></div>`;
  else h += `<p class="sub">Só uma data até agora (${rotData(datas[0])}). A comparação aparece quando chegarem as fotos da reavaliação.</p>`;
  const de = (ang, dt) => lista.filter(f => f.angulo === ang && f.data === dt);
  FOTO_ANGULOS.forEach(ang => {
    if (!mostrar.some(dt => de(ang, dt).length)) return;
    h += `<div class="foto-ang"><h3>${ang}</h3><div class="par${mostrar.length === 1 ? " um" : ""}">${mostrar.map(dt => { const f = de(ang, dt)[0];
      return `<figure>${f ? `<button type="button" class="foto" data-foto="${esc(f.id)}" data-leg="${esc(`${ang} · ${rotData(dt)}`)}" aria-label="Ampliar ${esc(ang)} de ${rotData(dt)}"><img alt="${esc(ang)} em ${rotData(dt)}" hidden><span class="foto-msg">Abrindo…</span></button>` : `<div class="foto vazia"><span class="foto-msg">Sem foto</span></div>`}<figcaption>${rotData(dt)}</figcaption></figure>`; }).join("")}</div></div>`;
  });
  const pasta = (lista.find(f => f.pasta) || {}).pasta;
  // "Sua análise" (pedido do criador, 15/11/2026): vai no PDF das fotos; fica guardada no celular, por par de datas
  h += `<label class="sub" for="fAnalise">Sua análise (vai no PDF das fotos${mostrar.length > 1 ? `, ${rotData(antes)} e ${rotData(depois)}` : ""})</label>
    <textarea id="fAnalise" class="nota" rows="5" placeholder="Escreva ou cole aqui. Cada parágrafo numa linha; linha começando com ## vira subtítulo.">${esc(ler(chaveAnalise(a, antes, depois)) || "")}</textarea>
    <p class="sub">Textos prontos (toque para pôr no fim):</p><div class="filtros prontos">${TEXTOS_PRONTOS.map(([t], i) => `<button type="button" data-pronto="${i}">+ ${esc(t)}</button>`).join("")}</div>`;
  h += `<p class="sub">Toque numa foto para ver grande. O PDF das fotos sai com as datas escolhidas acima e o mesmo enquadramento nas duas fotos.</p>
    ${mostrar.length > 1 ? `<label class="sub ig-borrar"><input type="checkbox" id="igBorrar"${ler("t_ig_borrar") === false ? "" : " checked"}> Borrar o rosto nas imagens do Instagram (a foto de costas fica sem borrão)</label>` : ""}
    <div class="acoes"><button class="btn amarelo" type="button" id="pdfFotos">📄 PDF das fotos${mostrar.length > 1 ? " (antes e depois)" : ""}</button>${mostrar.length > 1 ? `<button class="btn amarelo" type="button" id="igFotos">📸 Antes e depois para o Instagram</button>` : ""}${pasta ? `<a class="btn" href="${esc(pasta)}" target="_blank" rel="noopener">Abrir a pasta</a>` : ""}<button class="btn" type="button" id="fotosDeNovo">Procurar fotos novas</button></div></div></section>`;
  // análise das fotos: os PDFs aprovados que estão na pasta "Avaliações <Nome>" (skill treinador, 9.9; servidor versão 14)
  if (!PDFS_AV[a.chave]) PDFS_AV[a.chave] = ler("t_pdfs:" + a.chave);
  const pdfs = PDFS_AV[a.chave];
  h += `<section class="secao"><header><h2>Análise das fotos</h2>${pdfs && pdfs.length ? `<span class="cont">${plural(pdfs.length, "PDF", "PDFs")}</span>` : ""}</header><div class="card">`;
  if (pdfs && pdfs.length) h += `<div class="lista">${pdfs.map(p => `<a class="btn pdf-link" href="${esc(p.url)}" target="_blank" rel="noopener">📄 ${esc(p.nome)}</a>`).join("")}</div>
    <p class="sub">Abre no Drive, onde dá para baixar e mandar ao aluno.</p>`;
  else h += `<p class="sub">${pdfs ? `Nenhum PDF de análise na pasta "Avaliações ${esc(a.nome)}" ainda.` : `Para ver aqui os PDFs de análise que estão na pasta do aluno, cole o código novo do servidor (página Ligar o app do treinador, versão 14) e toque em ↻.`}</p>`;
  h += `<p class="sub">A análise é feita comigo no chat: "compara as fotos de ${esc(primeiro(a.nome))}". Depois de aprovada, salve o PDF em "Avaliações ${esc(a.nome)}" e ele aparece aqui.</p></div></section>`;
  el.innerHTML = h;
  $("olhoFotos").onclick = () => { guardar("t_ocultar_fotos", !fOcultas); pintarFotos(a); };
  botaoPdf($("pdfFotos"), () => pdfFotos(a));
  botaoInstagram($("igFotos"), a);
  if ($("igBorrar")) $("igBorrar").onchange = e => guardar("t_ig_borrar", e.target.checked);
  $("fAnalise").oninput = e => guardar(chaveAnalise(a, antes, depois), e.target.value);
  el.querySelectorAll("[data-pronto]").forEach(b => b.onclick = () => {
    const ta = $("fAnalise"), novo = TEXTOS_PRONTOS[b.dataset.pronto][1].replace("{antes}", rotData(antes)).replace("{depois}", rotData(depois));
    ta.value = ta.value.trim() ? ta.value.replace(/\s+$/, "") + "\n" + novo : novo;
    guardar(chaveAnalise(a, antes, depois), ta.value);
    ta.style.height = "auto"; ta.style.height = ta.scrollHeight + 4 + "px";
  });
  const escolher = () => { FOTO_SEL[a.chave] = [$("fAntes").value, $("fDepois").value]; pintarFotos(a); };
  if ($("fAntes")){ $("fAntes").onchange = escolher; $("fDepois").onchange = escolher; }
  $("fotosDeNovo").onclick = () => { $("fotosDeNovo").disabled = true; lerFotosAluno(a, true); };
  el.querySelectorAll("[data-foto]").forEach(b => {
    const img = b.querySelector("img"), msg = b.querySelector(".foto-msg");
    carregarFoto(a, b.dataset.foto).then(url => { img.src = url; img.hidden = false; msg.remove(); b.onclick = () => { if (!ler("t_ocultar_fotos")) abrirFoto(url, b.dataset.leg); }; })
      .catch(e => { msg.textContent = e.servidor ? "Não abriu" : "Sem internet"; b.onclick = () => pintarFotos(a); });
  });
}
// textos prontos para "Sua análise" (pedido do criador, 15/11/2026), escritos pelas regras de
// .claude/skills/treinador/diretrizes.md (seções 4.7, 4.8 e 5.1); o criador escolheu só estes 3 (15/11/2026): mudou o texto lá, mude aqui.
// Linha que começa com "## " vira subtítulo no PDF. {antes} e {depois} viram as datas escolhidas.
const TEXTOS_PRONTOS = [
  ["Como comparamos", "## Como as fotos foram comparadas\nComparamos as fotos de {antes} e de {depois}, nos mesmos ângulos (frente, lados e costas), com o corpo do mesmo tamanho e na mesma posição nas duas fotos."],
  ["Postura: se policiar", "## Um recado sobre a sua postura\nO treino e os alongamentos fazem uma parte, e o seu dia a dia faz a outra. Ao longo do dia, vale se policiar: ombros relaxados, peito aberto e a barriga levemente firme quando estiver em pé ou sentado. Não precisa ser perfeito o tempo todo; são esses lembretes, todos os dias, que somam com o treino."],
  ["Sobre esta análise", "## Sobre esta análise\nÉ uma análise visual, feita a partir das fotos. Ela depende de fotos tiradas sempre do mesmo jeito (mesmo lugar, mesma luz e mesmo horário) e complementa as medidas e o acompanhamento, sem substituí-los."]
];
// a foto (miniatura de 1200 px) fica guardada no celular depois da 1ª vez: abre rápido e sem internet
const FILA_FOTOS = []; let fotosBaixando = 0;
function carregarFoto(a, id){
  if (IMG[id]) return IMG[id];
  const chaveCache = new URL(`__foto/${encodeURIComponent(id)}`, location.href).href;
  const p = (async () => {
    try { if (window.caches){ const c = await caches.open("t-fotos"), r = await c.match(chaveCache); if (r) return URL.createObjectURL(await r.blob()); } } catch(e){}
    await new Promise(ok => { FILA_FOTOS.push(ok); andarFila(); });
    try {
      const j = await chamar({acao: "t_foto", aluno: a.chave, id}, 60000);
      const bin = atob(j.b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], {type: j.tipo || "image/jpeg"});
      try { if (window.caches){ const c = await caches.open("t-fotos"); await c.put(chaveCache, new Response(blob, {headers: {"Content-Type": blob.type}})); } } catch(e){}
      return URL.createObjectURL(blob);
    } finally { fotosBaixando--; andarFila(); }
  })();
  IMG[id] = p; p.catch(() => { delete IMG[id]; });
  return p;
}
function andarFila(){ while (fotosBaixando < 2 && FILA_FOTOS.length){ fotosBaixando++; FILA_FOTOS.shift()(); } }
function abrirFoto(url, legenda){
  const f = document.createElement("div"); f.className = "foto-cheia"; f.setAttribute("role", "dialog"); f.setAttribute("aria-label", legenda);
  f.innerHTML = `<button type="button" class="pse-x" aria-label="Fechar">✕</button><img src="${esc(url)}" alt="${esc(legenda)}"><p>${esc(legenda)}</p>`;
  const fechar = () => { f.remove(); document.removeEventListener("keydown", tecla); };
  const tecla = e => { if (e.key === "Escape") fechar(); };
  f.onclick = fechar; document.addEventListener("keydown", tecla);
  document.body.appendChild(f); f.querySelector("button").focus();
}

// ----- avaliação física (aba Avaliações da planilha "Avaliação <Nome>"; servidor: avSalvar_) -----
let AV_ED = null, avEnviando = false;   // AV_ED = índice da coluna (0 = avaliação 1, coluna D) que está aberta para editar
// linha de cada rótulo (servidor: avaliacaoLinhas, achadas pelo rótulo da coluna B; sem elas, as linhas da matriz de 13/11/2026)
const AV_ANTIGA = {"Data da avaliação": 10, "Altura": 13, "% de gordura": 43, "Massa magra": 45, "% de gordura desejado": 46, "Sexo": 5};
const LN = (d, rot) => (d.avaliacaoLinhas || {})[rot] || AV_ANTIGA[rot] || 0;
function avCel(d, linha, col){ return linha ? txt(((d.avaliacao || [])[linha - (d.avaliacaoIni || 10)] || [])[2 + col]) : ""; }
const avData = (d, i) => avCel(d, LN(d, "Data da avaliação"), i);
function avColunas(d){ return [0,1,2,3,4,5].filter(i => avData(d, i)); }
function pintarAv(a){
  const el = $("avSec"); if (!el) return;
  const d = DADOS[a.chave] || {};
  // consultoria sem a planilha de avaliação: a aba mostra só as fotos (pedido do criador, 15/11/2026)
  if (!a.avaliacao){ el.innerHTML = a.modalidade === "presencial" ? `<section class="secao"><header><h2>Avaliação física</h2></header><div class="card"><p class="sub">Este aluno ainda não tem a planilha "Avaliação ${esc(a.nome)}". Me peça no chat para criar.</p></div></section>` : ""; return; }
  let h = avaliacaoHtml(d);
  if (d.avaliacao && !d.avaliacaoAntiga && avColunas(d).length) h += `<div class="acoes"><button class="btn amarelo" type="button" id="pdfAv">📄 PDF da avaliação física</button></div>`;
  if (d.avaliacaoAntiga){ el.innerHTML = h; return; }
  if (!d.avaliacaoCampos){ el.innerHTML = h + `<div class="card"><p class="sub">${d.avaliacao ? AVISO_V11 : "Abrindo a planilha de avaliação…"}</p></div>`; botaoPdf($("pdfAv"), () => pdfAvaliacao(a)); return; }
  const feitas = avColunas(d), livre = [0,1,2,3,4,5].find(i => !avData(d, i));
  h += `<div class="card"><h3>Anotar pelo app</h3><div class="acoes">${livre != null ? `<button class="btn${AV_ED === livre ? " amarelo" : ""}" type="button" id="avNova">${AV_ED === livre ? "Cancelar" : "+ Nova avaliação"}</button>` : ""}
    ${feitas.map(i => `<button class="btn${AV_ED === i ? " amarelo" : ""}" type="button" data-avcol="${i}">${AV_ED === i ? "Cancelar" : "Editar " + esc(avData(d, i).slice(0, 5))}</button>`).join("")}</div>
    ${livre == null ? `<p class="sub">As 6 avaliações da planilha estão preenchidas. Para a próxima, me peça no chat uma planilha nova.</p>` : ""}<div id="avForm"></div></div>`;
  el.innerHTML = h;
  ligarDicas(el); botaoPdf($("pdfAv"), () => pdfAvaliacao(a));
  if ($("avNova")) $("avNova").onclick = () => { AV_ED = AV_ED === livre ? null : livre; pintarAv(a); };
  el.querySelectorAll("[data-avcol]").forEach(b => b.onclick = () => { const i = Number(b.dataset.avcol); AV_ED = AV_ED === i ? null : i; pintarAv(a); });
  if (AV_ED != null) formAvaliacao(a, d, AV_ED, !avData(d, AV_ED));
}
function formAvaliacao(a, d, col, nova){
  const campos = d.avaliacaoCampos, perfil = d.avaliacaoPerfil || [], feitas = avColunas(d).filter(i => i !== col);
  const ultima = feitas.length ? feitas[feitas.length - 1] : null;
  // valor de cada campo: o da coluna; na avaliação nova, a altura e o % desejado vêm da última avaliação
  const orig = {}, ini = {};
  campos.forEach(([L, , un]) => { const v = avCel(d, L, col); orig[L] = un === "data" ? isoDePlanilha(v) : v;
    ini[L] = orig[L] || (nova && un === "data" ? isoDe(hojeZero()) : nova && (L === LN(d, "Altura") || L === LN(d, "% de gordura desejado")) && ultima != null ? avCel(d, L, ultima) : orig[L]); });
  const pOrig = {}; perfil.forEach(([L, , op]) => { const v = avCel(d, L, 0); pOrig[L] = op === "data" ? isoDePlanilha(v) : v; });
  const semSexo = !pOrig[(perfil.find(p => p[1] === "Sexo") || [])[0]];
  const campoHtml = ([L, rot, un]) => un === "data"
    ? `<label>Data da avaliação<input class="busca" type="date" data-av="${L}" value="${esc(ini[L])}"></label>`
    : `<label>${esc(rot)} (${un})<input class="busca" inputmode="decimal" autocomplete="off" data-av="${L}" value="${esc(ini[L])}"></label>`;
  const grupo = g => campos.filter(c => c[3] === g);
  const preenchidos = g => grupo(g).filter(c => ini[c[0]]).length;
  const perfilHtml = `<div class="av-grid">${perfil.map(([L, rot, op]) => op === "data"
    ? `<label>${esc(rot)}<input class="busca" type="date" data-perfil="${L}" value="${esc(pOrig[L])}"></label>`
    : `<label>${esc(rot === "Sexo" ? "Sexo" : /atleta/i.test(rot) ? "É atleta?" : "Etnia negra? (Evans)")}<select data-perfil="${L}">${rot === "Sexo" ? `<option value="">Escolha</option>` : ""}${opcoes(op.map(x => [x, x === "F" ? "Mulher" : x === "M" ? "Homem" : x]), pOrig[L])}</select></label>`).join("")}</div>`;
  let h = `<div class="card form" style="margin-top:4px"><h3>${nova ? `Avaliação ${col + 1} (nova)` : `Avaliação ${col + 1}`}</h3>`;
  h += semSexo ? `<p class="sub">Escolha o sexo: sem ele, a planilha não calcula o % de gordura.</p>${perfilHtml}` : `<details><summary>Perfil do aluno (vale para todas)</summary>${perfilHtml}</details>`;
  h += `<div class="av-grid">${grupo("Dados").map(campoHtml).join("")}</div>`;
  ["Perímetros", "Dobras cutâneas"].forEach(g => { h += `<details${nova || preenchidos(g) ? " open" : ""}><summary>${g} (${preenchidos(g)} de ${grupo(g).length})</summary><div class="av-grid">${grupo(g).map(campoHtml).join("")}</div></details>`; });
  h += `<div class="av-grid">${grupo("Meta").map(campoHtml).join("")}</div>
    <p class="sub">A idade, a soma das dobras, o % de gordura (protocolo automático), as massas, o peso desejado e o IMC a planilha calcula sozinha.</p>
    <p class="sub" id="avMsg"></p><div class="acoes"><button class="btn amarelo" type="button" id="avOk">Salvar na planilha</button></div></div>`;
  $("avForm").innerHTML = h;
  $("avOk").onclick = async () => {
    const v = {}, p = {}; let erro = "";
    document.querySelectorAll("#avForm [data-av]").forEach(inp => {
      const L = Number(inp.dataset.av), c = campos.find(x => x[0] === L), bruto = txt(inp.value);
      if (c[2] === "data"){ if (bruto !== orig[L] || nova) v[L] = bruto; return; }
      const n = bruto === "" ? "" : lerDigitado(bruto);
      if (bruto !== "" && !(n > 0)) erro = erro || `Número inválido em ${c[1]}.`;
      if (n !== "" && c[4] && n > c[4]) erro = erro || `${c[1]}: ${fmt(n)} ${c[2]} parece errado.`;
      if (String(n) !== String(lerPlanilha(orig[L]))) v[L] = n === "" ? "" : String(n);
    });
    document.querySelectorAll("#avForm [data-perfil]").forEach(inp => { const L = Number(inp.dataset.perfil); if (txt(inp.value) !== pOrig[L]) p[L] = txt(inp.value); });
    if (!txt((document.querySelector(`#avForm [data-av="${LN(d, "Data da avaliação")}"]`) || {}).value)) erro = erro || "Falta a data da avaliação.";
    if (erro){ $("avMsg").textContent = erro; return; }
    if (!Object.keys(v).length && !Object.keys(p).length){ AV_ED = null; pintarAv(a); return; }
    if (avEnviando) return; avEnviando = true; $("avOk").disabled = true; $("avMsg").textContent = "Salvando na planilha…";
    try {
      const nd = await chamar({acao: "t_av_salvar", aluno: a.chave, col, v, perfil: p}, 60000);
      DADOS[a.chave] = nd; guardar("t_aluno:" + a.chave, nd); AV_ED = null; pintarAv(a);
      const g = avCel(nd, LN(nd, "% de gordura"), col), mm = avCel(nd, LN(nd, "Massa magra"), col);
      aviso(`Avaliação salva ✓${g ? ` · ${g}% de gordura` : ""}${mm ? ` · massa magra ${mm} kg` : ""}`);
    } catch(e){ $("avOk").disabled = false; $("avMsg").textContent = e.servidor ? e.message : "Sem internet: nada foi salvo. Tente de novo quando a internet voltar."; }
    finally { avEnviando = false; }
  };
}

// ----- o ciclo na aba Treino: faixa de reps de cada semana, periodização e cardio (servidor: planoMudar_) -----
const FAIXAS_SUGERIDAS = ["3 a 6", "6 a 8", "8 a 12", "10 a 12", "12 a 15", "15 a 20"];
let PLANO_ED = false, planoEnviando = false;
function lugaresCiclo(v){
  const cel = (r, c) => txt((v[r] || [])[c]);
  let dia = -1, aer = -1;
  for (let r = 0; r < v.length; r++){ if (cel(r, 0) === "DIA" && /TREINO/.test(cel(r, 1)) && dia < 0) dia = r; if (cel(r, 0) === "EXERCÍCIOS AERÓBICOS" && aer < 0) aer = r; }
  const out = {faixas: [], dias: {}, cardio: []};
  if (dia < 0) return null;
  const vistas = new Set();
  for (let r = 0; r < dia; r++) (v[r] || []).forEach((x, c) => { const m = /^Semana (\d+)$/.exec(txt(x)); if (m && !vistas.has(m[1])){ vistas.add(m[1]); out.faixas.push({n: +m[1], valor: cel(r + 1, c)}); } });
  out.faixas.sort((x, y) => x.n - y.n);
  for (let i = 1; i <= 7; i++){ const d = cel(dia + i, 0); if (NOMES[d]) out.dias[d] = cel(dia + i, 1); }
  if (aer >= 0) for (let r = aer + 1; r < v.length; r++){ if (!/^Semana/i.test(cel(r, 0))) continue;
    const ds = {}; for (let j = 1; j <= 7; j++){ const d = cel(r + j, 0); if (NOMES[d]) ds[d] = cel(r + j, 1); }
    out.cardio.push({bloco: cel(r, 0), dias: ds}); }
  return out;
}
// "30 min, manter uma média de 130 bpm (esteira)" → {min, bpm, tipo}; o texto do modelo (sem números) → vazio
function lerCardio(t){
  if (!cardioValido(t)) return {min: "", bpm: "", tipo: "", padrao: true};
  const min = (/(\d+)\s*min/i.exec(t) || [])[1] || "", bpm = (/(\d+)\s*bpm/i.exec(t) || [])[1] || "";
  // tipo: o que está entre parênteses no fim; num texto escrito de outro jeito ("Caminhada leve 20min"), o que sobra sem os números
  let tipo = (/\(([^)]*)\)\s*$/.exec(t) || [])[1] || "";
  if (!tipo && !/manter uma m[ée]dia/i.test(t)) tipo = t.replace(/\d+\s*min(utos)?/i, " ").replace(/\d+\s*bpm/i, " ").replace(/[(),]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  const refeito = `${min} min${bpm ? `, manter uma média de ${bpm} bpm` : ""}${tipo ? ` (${tipo})` : ""}`;
  return {min, bpm, tipo, padrao: !!min && refeito.replace(/\s+/g, " ") === t.replace(/\s+/g, " ").trim()};
}
const textoCardio = c => c.min ? `${c.min} min${c.bpm ? `, ${c.bpm} bpm` : ""}${c.tipo ? ` (${c.tipo})` : ""}` : "";
function cicloResumoHtml(a, d){
  const L = lugaresCiclo(d.treino || []);
  if (!L) return `<p class="sub">Não achei a periodização na aba Treino. Faixas, dias e cardio continuam na planilha.</p>`;
  const faixas = L.faixas.filter(f => f.valor).map(f => `S${f.n} ${esc(f.valor)}`).join(" · ") || "sem faixas";
  const ds = ORDEM.filter(x => /^[A-E]$/.test(L.dias[x] || "")).map(x => `${NOMES[x].slice(0, 3).toLowerCase()} ${L.dias[x]}`).join(" · ") || "nenhum dia de treino";
  const cs = L.cardio.map(b => { const n = Object.values(b.dias).filter(t => cardioValido(t)).length; return n ? `${esc(b.bloco)}: ${plural(n, "dia")}` : ""; }).filter(Boolean).join(" · ") || "sem cardio";
  return `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3>Faixas, dias e cardio</h3><button class="btn${PLANO_ED ? " amarelo" : ""}" type="button" id="plAbrir">${PLANO_ED ? "Cancelar" : "Editar"}</button></div>
    <p class="sub"><b>Faixas:</b> ${faixas}</p><p class="sub"><b>Dias:</b> ${ds}</p><p class="sub"><b>Cardio:</b> ${cs}</p><div id="plForm"></div></div>`;
}
function formPlano(a, d){
  const L = lugaresCiclo(d.treino || []); if (!L || !$("plForm")) return;
  const opDia = atual => { const base = [["", "Descanso"], ["A","A"], ["B","B"], ["C","C"], ["D","D"], ["E","E"]]; if (atual && !/^[A-E]$/.test(atual)) base.push([atual, atual]); return opcoes(base, atual); };
  let h = `<div class="card form" style="margin-top:4px">
    <h3>Faixa de repetições de cada semana</h3><datalist id="plFaixas">${FAIXAS_SUGERIDAS.map(f => `<option value="${f}">`).join("")}</datalist>
    <div class="av-grid tres">${L.faixas.map(f => `<label>Semana ${f.n}<input class="busca" data-faixa="${f.n}" list="plFaixas" inputmode="text" autocomplete="off" value="${esc(f.valor)}" placeholder="8 a 12"></label>`).join("")}</div>
    <p class="sub">Escreva como "8 a 12". 15 a 20 é a semana regenerativa (a planilha corta as séries pela metade). Semana sem faixa fica fora do ciclo.</p>
    <h3>Dias de treino</h3><div class="av-grid tres">${ORDEM.filter(x => x in L.dias).map(x => `<label>${NOMES[x]}<select data-dia="${x}">${opDia(L.dias[x])}</select></label>`).join("")}</div>`;
  if (L.cardio.length){
    h += `<h3>Cardio</h3><p class="sub">Minutos e frequência cardíaca média de cada dia. Tipo é opcional (ex.: esteira, bike). Dia em branco fica sem cardio.</p>`;
    L.cardio.forEach((b, i) => { const n = Object.values(b.dias).filter(t => cardioValido(t)).length;
      h += `<details${n ? " open" : ""}><summary>${esc(b.bloco)} (${plural(n, "dia")})</summary><div class="cardio-dias"><span></span><small>min</small><small>bpm</small><small>tipo</small>${ORDEM.filter(x => x in b.dias).map(x => { const c = lerCardio(b.dias[x]);
        return `<b>${NOMES[x].slice(0, 3)}</b><input class="busca" inputmode="numeric" data-cb="${i}" data-cd="${x}" data-cc="min" value="${esc(c.min)}" aria-label="${esc(b.bloco)}, ${NOMES[x]}: minutos"><input class="busca" inputmode="numeric" data-cb="${i}" data-cd="${x}" data-cc="bpm" value="${esc(c.bpm)}" aria-label="${esc(b.bloco)}, ${NOMES[x]}: bpm"><input class="busca" data-cb="${i}" data-cd="${x}" data-cc="tipo" value="${esc(c.tipo)}" maxlength="60" aria-label="${esc(b.bloco)}, ${NOMES[x]}: tipo">${!c.padrao && cardioValido(b.dias[x]) ? `<small class="cardio-dif">Na planilha está: "${esc(b.dias[x])}". Ao salvar este dia, o texto troca para o formato acima.</small>` : ""}`; }).join("")}</div></details>`; });
  }
  h += `<p class="sub" id="plMsg"></p><div class="acoes"><button class="btn amarelo" type="button" id="plOk">Salvar na planilha</button></div></div>`;
  $("plForm").innerHTML = h;
  $("plOk").onclick = async () => {
    const m = {faixas: {}, periodo: {}, cardio: {}}; let erro = "";
    document.querySelectorAll("[data-faixa]").forEach(inp => { const n = inp.dataset.faixa, f = L.faixas.find(x => String(x.n) === n), v = txt(inp.value).replace(/\s+/g, " ");
      if (v && !/^\d{1,2} ?a ?\d{1,2}$/.test(v)) erro = erro || `Semana ${n}: escreva a faixa como "8 a 12".`;
      if (v !== f.valor) m.faixas[n] = v; });
    document.querySelectorAll("[data-dia]").forEach(s => { if (s.value !== (L.dias[s.dataset.dia] || "")) m.periodo[s.dataset.dia] = s.value; });
    L.cardio.forEach((b, i) => Object.keys(b.dias).forEach(x => {
      const pega = c => txt((document.querySelector(`[data-cb="${i}"][data-cd="${x}"][data-cc="${c}"]`) || {}).value);
      const novo = {min: pega("min"), bpm: pega("bpm"), tipo: pega("tipo")}, velho = lerCardio(b.dias[x]);
      if (novo.min && !(Number(novo.min) >= 1 && Number(novo.min) <= 300)) erro = erro || `${b.bloco}, ${NOMES[x]}: minutos de 1 a 300.`;
      if (novo.bpm && !(Number(novo.bpm) >= 40 && Number(novo.bpm) <= 230)) erro = erro || `${b.bloco}, ${NOMES[x]}: bpm de 40 a 230.`;
      if (!novo.min && (novo.bpm || novo.tipo)) erro = erro || `${b.bloco}, ${NOMES[x]}: falta o tempo em minutos.`;
      if (novo.min !== velho.min || novo.bpm !== velho.bpm || novo.tipo !== velho.tipo) (m.cardio[b.bloco] = m.cardio[b.bloco] || {})[x] = novo.min ? novo : null;
    }));
    if (erro){ $("plMsg").textContent = erro; return; }
    const n = Object.keys(m.faixas).length + Object.keys(m.periodo).length + Object.values(m.cardio).reduce((s, x) => s + Object.keys(x).length, 0);
    if (!n){ PLANO_ED = false; prescricaoAluno(a); return; }
    if (Object.keys(m.periodo).length && ((a.resumo || {}).ultima_semana || 0) > 0 &&
      !confirm(`Mudar os dias de treino muda em qual dia o app do aluno mostra cada treino. As semanas já anotadas continuam na planilha, mas um treino repetido na semana pode passar a aparecer em outra aba. Mudar mesmo assim?`)) return;
    if (planoEnviando) return; planoEnviando = true; $("plOk").disabled = true; $("plMsg").textContent = "Salvando na planilha…";
    try {
      const nd = await chamar({acao: "t_plano_mudar", aluno: a.chave, m}, 60000);
      DADOS[a.chave] = nd; guardar("t_aluno:" + a.chave, nd); PLANO_ED = false; prescricaoAluno(a); aviso(`Ciclo atualizado ✓ (${plural(n, "mudança", "mudanças")})`);
      atualizar();   // o resumo do aluno (dias de treino, semana) vem do t_inicio
    } catch(e){ $("plOk").disabled = false; $("plMsg").textContent = e.servidor ? e.message : "Sem internet: nada foi salvo. Tente de novo quando a internet voltar."; }
    finally { planoEnviando = false; }
  };
}

// ---------- abrir ----------
let lendo = false;
async function atualizar(){
  if (!CHAVE || lendo) return; lendo = true;
  if (INICIO) mostrarStatus(navigator.onLine === false ? "velho" : "atualizando");
  const g0 = gravacoes;
  try {
    const j = await chamar({acao: "t_inicio"}, 90000);
    if (gravacoes !== g0){ lendo = false; setTimeout(atualizar, 500); return; }
    INICIO = {alunos: j.alunos, agenda: j.agenda, agendaErro: j.agendaErro || "", versao: j.versao || 0, lido_em: j.lido_em}; ultimaLeitura = new Date(j.lido_em); guardar("t_inicio", INICIO);
    const r = rota(), foco = document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (!(r.tela === "a" && r.aba !== "resumo") && !foco) render(false);
    else if (r.tela === "a" && !$("corpo")) render(false);   // 1ª leitura com o app aberto num aluno (Evolução ou Registrar)
    mostrarStatus(Object.keys(FILA).length ? "local" : "ok");
    enviar();
  } catch(e){
    if (e.servidor && /chave/i.test(e.message)){ $("tela").innerHTML = `<div class="card"><h2>Chave errada</h2><p class="sub">O servidor não reconheceu a sua chave. Abra de novo pelo link que o Claude mandou.</p></div>`; }
    else if (INICIO) mostrarStatus(e.servidor ? "erro-servidor" : "velho", e.message);
    else $("tela").innerHTML = `<div class="card"><h2>Não consegui abrir</h2><p class="sub">${esc(e.servidor ? e.message : "Sem internet. Na primeira vez, o app precisa de internet para ler os seus alunos no Drive.")}</p><button class="btn amarelo" type="button" id="tentar">Tentar de novo</button></div>`,
      $("tentar") && ($("tentar").onclick = atualizar);
  } finally { lendo = false; }
}
$("recarregar").onclick = () => { atualizar(); const r = rota(); if (r.tela === "fin") lerFin(); if (r.tela === "leads") lerLeads(); if (r.tela === "a" && r.aba !== "resumo"){ const a = alunoPorChave(r.chave); if (a){ if (r.aba === "avaliacao" && v11()) lerFotosAluno(a, true); carregarAluno(a, () => abrirAba(a, r.aba)); } } };
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

// ---------- AVISOS no celular dos alunos (servidor versão 17; pedido do criador, 15/11/2026) ----------
// Os automáticos começam desligados: o criador lê cada texto e liga (é o ok dele). Regras no servidor (Avisos.gs).
const AV_INFO = [
  ["treino", "Lembrete do treino", "Nos dias de treino, na hora que o aluno escolheu no app, só se ele ainda não anotou o treino do dia.", "Hoje é dia de Treino B 💪", "Maria, o seu treino já está no app. Bora?"],
  ["ciclo", "Ciclo novo", "No primeiro dia do ciclo (a data de entrega).", "Seu treino novo começa hoje 🔥", "Hoje é Treino A. Bom ciclo, Maria!"],
  ["sumiu", "Sumiu do treino", "4 dias ou mais sem treino anotado e 2 treinos perdidos. Repete só depois de 7 dias.", "Bora voltar pro treino?", "Faz 5 dias sem treino anotado. Treinou? Anota no app. Precisou parar? Me chama no WhatsApp."],
  ["fotos", "Fotos de avaliação", "Nas semanas 4, 8, 12 e na última: quinta e sábado, se o formulário ainda não chegou.", "Semana das fotos de avaliação 📸", "Mande as 4 fotos e o feedback do mês até sábado. No domingo sai o seu relatório de evolução."],
  ["renovacao", "Renovação", "Só consultoria (aba Alunos do Financeiro): 7 dias antes do fim do plano e na véspera. Só a data, sem pressão.", "Seu plano vai até 23/11", "Seu plano trimestral vai até domingo, 23/11. Para seguir sem pausa, a renovação está no app."],
  ["semana", "Resumo da semana", "Domingo, 18h, para quem treinou na semana (o aluno pode desligar no app).", "Sua semana: 3 de 4 treinos", "2 recordes nesta semana 🏆 Segunda tem Treino A. Bora!"],
  ["dica", "Dica nova", "Quando você grava uma dica no Registrar. De noite (21h às 7h), sai às 7h.", "Dica nova no seu treino", "Supino reto: desce em 3 segundos e segura 1 embaixo."]];
const AV_PRONTOS = [
  ["Treino atualizado", "Seu treino foi atualizado", "Dei uma ajustada no seu treino. Confere no app antes do próximo."],
  ["Análise das fotos", "Sua análise das fotos saiu 📈", "Mandei a análise da sua evolução no WhatsApp. Dá uma olhada!"],
  ["Relatório de evolução", "Seu relatório de evolução saiu 📈", "Mandei o relatório das suas últimas semanas no WhatsApp. Dá uma olhada!"],
  ["Recado livre", "", ""]];
let AVS = null, avsLendo = false;
function cartaoAvisosHoje(alunos){
  if ((INICIO.versao || 0) < 17) return "";
  const com = alunos.filter(a => a.avisos > 0).length, ligados = AV_INFO.filter(([k]) => (INICIO.avisos_cfg || {})[k]).length;
  return `<a class="card avcard" href="#/avisos"><span aria-hidden="true">🔔</span><span><b>Avisos no celular</b><small>${plural(com, "aluno")} com os avisos ligados · ${ligados} de ${AV_INFO.length} automáticos ligados</small></span><span aria-hidden="true">›</span></a>`;
}
function formAviso(id){
  return `<div class="card form"><div><span class="rot">Pronto para usar</span><div class="filtros" role="group" id="${id}P">${AV_PRONTOS.map(([n], i) => `<button type="button" data-i="${i}" aria-pressed="false">${n}</button>`).join("")}</div></div>
    <label>Título<input class="busca" id="${id}T" maxlength="80" placeholder="Ex.: Academia fechada no feriado"></label>
    <label>Texto<textarea class="nota" id="${id}X" maxlength="240" placeholder="Curto, como uma mensagem de WhatsApp."></textarea></label>
    <p class="sub" id="${id}M"></p><div class="acoes"><button class="btn amarelo" type="button" id="${id}Ok">Mandar aviso</button></div></div>`;
}
function ligarFormAviso(id, pedido, feito, confirmar){
  if (!$(id + "Ok")) return;
  document.querySelectorAll(`#${id}P button`).forEach(b => b.onclick = () => { const [, t, x] = AV_PRONTOS[+b.dataset.i];
    document.querySelectorAll(`#${id}P button`).forEach(y => y.setAttribute("aria-pressed", String(y === b))); $(id + "T").value = t; $(id + "X").value = x; (t ? $(id + "X") : $(id + "T")).focus(); });
  $(id + "Ok").onclick = async () => {
    const t = {titulo: txt($(id + "T").value), texto: txt($(id + "X").value)}, msg = $(id + "M");
    if (!t.titulo || !t.texto){ msg.textContent = "Escreva o título e o texto."; return; }
    if (confirmar && !confirm(confirmar)) return;
    $(id + "Ok").disabled = true; msg.textContent = "Mandando…";
    try { const j = await chamar(pedido(t), 120000); msg.textContent = feito(j); $(id + "T").value = ""; $(id + "X").value = ""; AVS = null; }
    catch(e){ msg.textContent = e.servidor ? "Não mandou: " + e.message : "Sem internet: nada foi mandado."; }
    finally { $(id + "Ok").disabled = false; }
  };
}
function secaoAvisoAluno(a){
  return `<section class="secao"><header><h2>Mandar aviso</h2><span class="cont">${a.avisos ? `🔔 ligado em ${plural(a.avisos, "celular")}` : "avisos não ligados"}</span></header>
    <p class="sub">${a.avisos ? `Chega no celular de ${esc(primeiro(a.nome))} e fica no 🔔 do app.` : `${esc(primeiro(a.nome))} ainda não ligou os avisos no celular (no app dele: 🔔 › Ativar avisos). O aviso fica no 🔔 e aparece quando ele abrir o app.`}</p>
    ${formAviso("avA")}</section>`;
}
async function lerAvisos(){
  if (avsLendo) return; avsLendo = true;
  try { AVS = await chamar({acao: "t_avisos"}, 60000); INICIO.avisos_cfg = AVS.cfg; guardar("t_inicio", INICIO); }
  catch(e){ AVS = {erro: e.servidor ? e.message : "Sem internet: não consegui ler os avisos."}; }
  finally { avsLendo = false; }
  if (rota().tela === "avisos") telaAvisos();
}
function telaAvisos(){
  let h = `<div><div class="eyebrow">No celular dos alunos</div><h1>Avisos</h1></div>`;
  if ((INICIO.versao || 0) < 17){ $("tela").innerHTML = h + `<p class="vazio">Para os avisos, cole o código novo do servidor (página Ligar o app do treinador, versão 17).</p>`; return; }
  if (!AVS){ $("tela").innerHTML = h + `<p class="carregando">Lendo os avisos…</p>`; lerAvisos(); return; }
  if (AVS.erro){ $("tela").innerHTML = h + `<p class="vazio">${esc(AVS.erro)}</p><div class="acoes"><button class="btn" type="button" id="avDeNovo">Tentar de novo</button></div>`; $("avDeNovo").onclick = () => { AVS = null; telaAvisos(); }; return; }
  const cfg = AVS.cfg || {};
  h += `<p class="sub">Cada aluno liga no app dele (🔔 › Ativar avisos) e escolhe a hora do lembrete. No máximo 1 aviso automático por dia por aluno, nada entre 21h e 6h, e o aviso fica também no 🔔 do app. Leia cada texto e ligue só os que quiser.</p>`;
  if (AVS.gatilho === false) h += `<div class="card alerta"><b>Falta o despertador dos avisos</b><p class="sub">${AVS.erroGatilho ? esc(AVS.erroGatilho) + " · " : ""}Sem ele, só os avisos que você manda saem. Faça o passo "Ligue o despertador dos avisos" da página Ligar o app do treinador.</p></div>`;
  h += `<section class="secao"><header><h2>Automáticos</h2><span class="cont">${AV_INFO.filter(([k]) => cfg[k]).length} de ${AV_INFO.length} ligados</span></header><div class="lista">${AV_INFO.map(([k, nome, quando, tit, tx]) =>
    `<div class="card avtipo${cfg[k] ? " on" : ""}"><div class="avtopo"><b>${nome}</b><button type="button" class="btn${cfg[k] ? " amarelo" : ""}" data-av="${k}" aria-pressed="${!!cfg[k]}">${cfg[k] ? "Ligado ✓" : "Ligar"}</button></div>
      <p class="sub">${quando}</p><div class="avex"><small>Exemplo</small><b>${esc(tit)}</b><span>${esc(tx)}</span></div></div>`).join("")}</div><p class="sub" id="avCfgMsg"></p></section>`;
  h += `<section class="secao"><header><h2>Mandar para todos</h2><span class="cont">alunos com o app</span></header>${formAviso("avT")}</section>`;
  const al = AVS.alunos || [];
  h += `<section class="secao"><header><h2>Ligaram os avisos</h2><span class="cont">${plural(al.length, "aluno")}</span></header>${al.length ? `<div class="card">${al.sort((x, y) => x.nome.localeCompare(y.nome)).map(x =>
    `<div class="recado"><small>${x.hora == null ? "sem lembrete do treino" : `lembrete às ${x.hora}h`}${x.resumo ? " · resumo do domingo" : ""}${x.n > 1 ? ` · ${x.n} celulares` : ""}</small>${esc(x.nome)}</div>`).join("")}</div>` : `<p class="vazio">Nenhum aluno ligou ainda. No app, o convite aparece depois que ele anota o primeiro treino (ou no 🔔).</p>`}</section>`;
  const env = AVS.enviados || [];
  if (env.length) h += `<section class="secao"><header><h2>Últimos avisos</h2></header><div class="card">${env.map(x => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(x.quando) || [];
    return `<div class="recado"><small>${m[3]}/${m[2]} ${m[4] || ""} · ${esc(primeiro(x.nome))} · ${x.entregue ? esc(x.entregue.replace(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2} ?/, "")) || "entregue" : "esperando as 7h"}</small><b>${esc(x.titulo)}</b> ${esc(x.texto)}</div>`; }).join("")}</div></section>`;
  $("tela").innerHTML = h;
  document.querySelectorAll("[data-av]").forEach(b => b.onclick = async () => {
    const k = b.dataset.av, novo = !cfg[k]; b.disabled = true; $("avCfgMsg").textContent = "Salvando…";
    try { const j = await chamar({acao: "t_avisos_cfg", cfg: {[k]: novo}}, 60000); AVS.cfg = j.cfg; AVS.gatilho = j.gatilho; AVS.erroGatilho = j.erroGatilho; INICIO.avisos_cfg = j.cfg; guardar("t_inicio", INICIO); telaAvisos(); }
    catch(e){ b.disabled = false; $("avCfgMsg").textContent = e.servidor ? "Não salvou: " + e.message : "Sem internet: não salvou."; }
  });
  ligarFormAviso("avT", t => ({acao: "t_aviso_todos", ...t}), j => `${j.depois ? "Guardado ✓ Sai às 7h." : "Mandado ✓"} ${plural(j.alunos, "aluno")}, ${plural(j.aparelhos, "celular")} com os avisos ligados.`, "Mandar este aviso para TODOS os alunos com o app?");
}
