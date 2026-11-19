// PDFs do app do treinador (desde 15/11/2026; pedido do criador): evolução do treino, avaliação física e fotos de avaliação.
// O PDF é montado no próprio celular com o jsPDF (jspdf.umd.min.js, gratuito, licença MIT em jspdf-LICENSE.txt), sem passar pelo servidor.
// Usa as funções e os dados do app.js (DADOS, FOTOS, ciclo, volumePorGrupo, evolucaoPorExercicio, carregarFoto…).

let JSPDF_P = null, LOGO_P = null;
function carregarJsPDF(){
  if (window.jspdf) return Promise.resolve(window.jspdf.jsPDF);
  if (!JSPDF_P) JSPDF_P = new Promise((ok, falha) => {
    const s = document.createElement("script"); s.src = "jspdf.umd.min.js";
    s.onload = () => window.jspdf ? ok(window.jspdf.jsPDF) : falha(new Error("Não consegui abrir o gerador de PDF."));
    s.onerror = () => { JSPDF_P = null; s.remove(); falha(new Error("Sem internet: não consegui abrir o gerador de PDF. Tente de novo com internet.")); };
    document.head.appendChild(s);
  });
  return JSPDF_P;
}
// logo branca (icons/logo-horizontal.svg) em PNG, para a faixa preta do topo
function logoPng(){
  if (!LOGO_P) LOGO_P = new Promise(ok => {
    const img = new Image();
    img.onload = () => { try { const c = document.createElement("canvas"); c.width = 1158; c.height = 240; c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); ok(c.toDataURL("image/png")); } catch(e){ ok(null); } };
    img.onerror = () => ok(null);
    img.src = "../icons/logo-horizontal.svg";
  });
  return LOGO_P;
}
// as fontes do PDF (Helvetica) só têm as letras do português e alguns símbolos: o resto (emoji, setas) sai do texto
const pdfTxt = s => String(s == null ? "" : s).replace(/→/g, "a").replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•…]/g, "").replace(/\s+/g, " ").trim();
const nf = n => n === "" || n == null || isNaN(n) ? "-" : (Math.abs(n) >= 1000 ? Math.round(n).toLocaleString("pt-BR") : fmt(Math.round(n * 10) / 10));
const sinal = n => n == null || isNaN(n) ? "-" : (n > 0 ? "+" : "") + nf(n);

const COR = {preto: [11,11,11], texto: [30,30,28], sub: [110,108,100], linha: [222,220,212], fundo: [246,245,240], amarelo: [255,214,10], verde: [22,128,61], vermelho: [190,40,40]};

async function novoPdf(titulo, sobre, aluno, linhaDatas){
  const J = await carregarJsPDF(), logo = await logoPng();
  const doc = new J({unit: "mm", format: "a4"});
  const W = 210, H = 297, M = 16, L = W - 2 * M;
  const R = {doc, W, H, M, L, y: 0};
  const cor = (c, tipo) => tipo === "f" ? doc.setFillColor(...c) : tipo === "d" ? doc.setDrawColor(...c) : doc.setTextColor(...c);
  R.cor = cor;
  const faixa = alta => {
    cor(COR.preto, "f"); doc.rect(0, 0, W, alta ? 30 : 16, "F");
    if (logo) doc.addImage(logo, "PNG", M, alta ? 9 : 4, alta ? 58 : 38.6, alta ? 12 : 8);
    cor(COR.amarelo, "f"); doc.rect(0, alta ? 30 : 16, W, 1.4, "F");
    if (!alta){ doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); cor([200,198,190]); doc.text(pdfTxt(`${titulo} · ${aluno}`), W - M, 10, {align: "right"}); }
  };
  R.novaPagina = () => { doc.addPage(); faixa(false); R.y = 28; };
  R.precisa = h => { if (R.y + h > H - 16) R.novaPagina(); };
  faixa(true);
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); cor(COR.sub); doc.text(pdfTxt(sobre).toUpperCase(), M, 44, {charSpace: .6});
  doc.setFontSize(24); cor(COR.preto); doc.text(pdfTxt(titulo), M, 55);
  doc.setFont("helvetica", "normal"); doc.setFontSize(13); cor(COR.texto); doc.text(pdfTxt(aluno), M, 63);
  R.y = 63;
  if (linhaDatas){ doc.setFontSize(10); cor(COR.sub); doc.text(pdfTxt(linhaDatas), M, 69.5); R.y = 69.5; }
  R.y += 9;

  R.h2 = (t, nota) => {
    R.precisa(20); R.y += 3;
    cor(COR.amarelo, "f"); doc.rect(M, R.y - 3.6, 2.2, 5, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(13); cor(COR.preto); doc.text(pdfTxt(t), M + 4.5, R.y + .4);
    if (nota){ doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); cor(COR.sub); doc.text(pdfTxt(nota), W - M, R.y + .4, {align: "right"}); }
    R.y += 7;
  };
  R.p = (t, tam, c) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(tam || 9.5); cor(c || COR.sub);
    const ls = doc.splitTextToSize(pdfTxt(t), L), alt = (tam || 9.5) * .45;
    ls.forEach(l => { R.precisa(alt + 1); doc.text(l, M, R.y + alt * .8); R.y += alt; });
    R.y += 2.5;
  };
  // cartões de número (até 4 por linha): [rótulo, valor, detalhe, tom ("sobe"/"desce")]
  R.cartoes = itens => {
    itens = itens.filter(Boolean); if (!itens.length) return;
    const n = Math.min(4, itens.length), g = 4, w = (L - g * (n - 1)) / n, h = 22;
    for (let i = 0; i < itens.length; i += n){
      R.precisa(h + 4);
      itens.slice(i, i + n).forEach(([rot, val, det, tom], k) => {
        const x = M + k * (w + g);
        cor(COR.fundo, "f"); cor(COR.linha, "d"); doc.setLineWidth(.2); doc.roundedRect(x, R.y, w, h, 2, 2, "FD");
        doc.setFont("helvetica", "normal"); doc.setFontSize(8); cor(COR.sub); doc.text(pdfTxt(rot), x + 3.5, R.y + 5.5);
        doc.setFont("helvetica", "bold"); doc.setFontSize(15); cor(COR.preto); doc.text(pdfTxt(val), x + 3.5, R.y + 13.5);
        if (det){ doc.setFont("helvetica", "normal"); doc.setFontSize(7.8); cor(tom === "sobe" ? COR.verde : tom === "desce" ? COR.vermelho : COR.sub);
          doc.text(doc.splitTextToSize(pdfTxt(det), w - 6)[0], x + 3.5, R.y + 18.6); }
      });
      R.y += h + 5;
    }
  };
  // gráfico de linha: pontos [{x: rótulo, y}]
  R.grafico = (titulo, pontos, un, opt) => {
    pontos = pontos.filter(p => p.y !== "" && p.y != null && !isNaN(p.y));
    if (pontos.length < 2) return;
    const h = 58; R.precisa(h + 10);
    const x0 = M, y0 = R.y;
    cor(COR.linha, "d"); doc.setLineWidth(.2); doc.roundedRect(x0, y0, L, h, 2, 2, "S");
    doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); cor(COR.preto); doc.text(pdfTxt(titulo), x0 + 4, y0 + 6.5);
    const u = pontos[pontos.length - 1]; doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); cor(COR.sub);
    doc.text(pdfTxt(`Última: ${nf(u.y)}${un || ""} (${u.x})`), x0 + L - 4, y0 + 6.5, {align: "right"});
    const pe = 18, pd = 6, pt = 12, pb = 9, ys = pontos.map(p => p.y);
    const zero = opt && opt.zero, mn = zero ? 0 : Math.min(...ys), mx = (opt && opt.max) || Math.max(...ys), folga = (mx - mn) * .15 || Math.max(1, mx * .1);
    const lo = zero ? 0 : Math.max(0, mn - folga), hi = (opt && opt.max) || mx + folga;
    const X = i => x0 + pe + i * (L - pe - pd) / (pontos.length - 1), Y = v => y0 + pt + (h - pt - pb) * (1 - (v - lo) / (hi - lo || 1));
    [lo, (lo + hi) / 2, hi].forEach(t => { cor(COR.linha, "d"); doc.setLineWidth(.15); doc.line(x0 + pe, Y(t), x0 + L - pd, Y(t));
      doc.setFontSize(7); cor(COR.sub); doc.text(hi - lo >= 10 ? Math.round(t).toLocaleString("pt-BR") : fmt(Math.round(t * 10) / 10), x0 + pe - 2, Y(t) + 1, {align: "right"}); });
    const passo = Math.ceil(pontos.length / 12);
    pontos.forEach((p, i) => { if (i % passo === 0 || i === pontos.length - 1){ doc.setFontSize(7); cor(COR.sub); doc.text(pdfTxt(p.x), X(i), y0 + h - 3, {align: "center"}); } });
    cor(COR.preto, "d"); doc.setLineWidth(.7);
    for (let i = 1; i < pontos.length; i++) doc.line(X(i - 1), Y(pontos[i - 1].y), X(i), Y(pontos[i].y));
    pontos.forEach((p, i) => { cor(COR.amarelo, "f"); cor(COR.preto, "d"); doc.setLineWidth(.35); doc.circle(X(i), Y(p.y), 1.3, "FD"); });
    R.y += h + 6;
  };
  // tabela: cab = ["Exercício", "Início"…]; linhas = [[...]]; larg = frações; a 1ª coluna à esquerda, as outras à direita
  R.tabela = (cab, linhas, larg, tons) => {
    if (!linhas.length) return;
    const ws = (larg || cab.map((_, i) => i ? 1 : 2.4)), soma = ws.reduce((x, y) => x + y, 0), wmm = ws.map(w => L * w / soma);
    const cabeca = () => {
      cor(COR.preto, "f"); doc.rect(M, R.y, L, 7, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(8); cor([250,250,250]);
      let x = M; cab.forEach((c, i) => { doc.text(pdfTxt(c), i ? x + wmm[i] - 2.5 : x + 2.5, R.y + 4.8, {align: i ? "right" : "left"}); x += wmm[i]; });
      R.y += 7;
    };
    R.precisa(16); cabeca();
    linhas.forEach((ln, k) => {
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
      const nome = doc.splitTextToSize(pdfTxt(ln[0]), wmm[0] - 5), h = Math.max(6.5, nome.length * 3.8 + 2.7);
      if (R.y + h > H - 16){ R.novaPagina(); cabeca(); }
      if (k % 2){ cor(COR.fundo, "f"); doc.rect(M, R.y, L, h, "F"); }
      let x = M;
      ln.forEach((c, i) => {
        const tom = tons && tons[k] && tons[k][i];
        cor(tom === "sobe" ? COR.verde : tom === "desce" ? COR.vermelho : COR.texto);
        doc.setFont("helvetica", i ? "normal" : "bold");
        if (i) doc.text(pdfTxt(c), x + wmm[i] - 2.5, R.y + 4.4, {align: "right"}); else doc.text(nome, x + 2.5, R.y + 4.4);
        x += wmm[i];
      });
      R.y += h;
    });
    cor(COR.linha, "d"); doc.setLineWidth(.2); doc.line(M, R.y, M + L, R.y);
    R.y += 6;
  };
  R.fim = nome => {
    const n = doc.getNumberOfPages(), hoje = ddaaaa(hojeZero());
    for (let i = 1; i <= n; i++){
      doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); cor(COR.sub);
      doc.text(pdfTxt(`Lucas Gabriel · Treinador · feito em ${hoje}`), M, H - 8);
      doc.text(`${i} de ${n}`, W - M, H - 8, {align: "right"});
    }
    return new File([doc.output("blob")], pdfTxt(nome).replace(/[\\/:*?"<>|]/g, "-") + ".pdf", {type: "application/pdf"});
  };
  return R;
}

// PDF pronto: botões para mandar (WhatsApp, e-mail…) e baixar. O compartilhar precisa de um toque novo (o iPhone recusa depois da espera).
function entregarPdf(arq){
  const url = URL.createObjectURL(arq);
  const podeMandar = !!(navigator.canShare && (() => { try { return navigator.canShare({files: [arq]}); } catch(e){ return false; } })());
  const f = document.createElement("div"); f.className = "pdf-pronto"; f.setAttribute("role", "dialog"); f.setAttribute("aria-label", "PDF pronto");
  f.innerHTML = `<div class="card"><h3>PDF pronto</h3><p class="sub">${esc(arq.name)}</p>
    <div class="acoes">${podeMandar ? `<button class="btn amarelo" type="button" id="pdfMandar">Mandar (WhatsApp…)</button>` : ""}
    <a class="btn${podeMandar ? "" : " amarelo"}" href="${url}" download="${esc(arq.name)}" id="pdfBaixar">Baixar</a>
    <a class="btn" href="${url}" target="_blank" rel="noopener">Abrir</a>
    <button class="btn" type="button" id="pdfFechar">Fechar</button></div><p class="sub" id="pdfMsg">${esc(arq.aviso || "")}</p></div>`;
  const fechar = () => { f.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); };
  f.onclick = e => { if (e.target === f) fechar(); };
  document.body.appendChild(f);
  f.querySelector("#pdfFechar").onclick = fechar;
  if (podeMandar) f.querySelector("#pdfMandar").onclick = async () => {
    try { await navigator.share({files: [arq], title: arq.name}); fechar(); }
    catch(e){ if (e && e.name !== "AbortError") f.querySelector("#pdfMsg").textContent = "Não abriu o compartilhar. Use Baixar e mande o arquivo pelo WhatsApp."; }
  };
  f.querySelector(podeMandar ? "#pdfMandar" : "#pdfBaixar").focus();
}
// liga um botão de PDF: mostra "Fazendo o PDF…" enquanto monta e avisa se der erro
function botaoPdf(bt, fazer){
  if (!bt) return;
  bt.onclick = async () => {
    const t = bt.textContent; bt.disabled = true; bt.textContent = "Fazendo o PDF…";
    try { entregarPdf(await fazer()); }
    catch(e){ console.error(e); alert((e && e.message) || "Não consegui fazer o PDF."); }
    finally { bt.disabled = false; bt.textContent = t; }
  };
}
const datasCiclo = c => c.entrega ? `Ciclo de ${ddaaaa(c.entrega)}${c.revisao ? ` a ${ddaaaa(c.revisao)}` : ""}${c.semana ? ` · semana ${Math.min(c.semana, c.total)} de ${c.total}` : ""}` : "";
const variacao = (p, u) => p > 0 ? Math.round(100 * (u - p) / p) : null;
const pct = v => v == null ? "-" : (v > 0 ? "+" : "") + v + "%";

// ---------- 1. evolução do treino (aba Evolução) ----------
async function pdfTreino(a){
  const d = DADOS[a.chave] || {}, r = a.resumo || {}, c = ciclo(a);
  if (!d.reg) throw new Error("Este aluno ainda não tem cargas anotadas nas abas Registro.");
  const R = await novoPdf("Evolução do treino", "Relatório de evolução", a.nome, datasCiclo(c));
  const V = volumePorGrupo(d.reg, d.grupos), vs = Object.keys(V.total).map(Number).sort((x, y) => x - y);
  const fechadas = vs.filter(w => w <= (c.concluidas || 0)), ini = vs[0], fim = (fechadas.length ? fechadas : vs).slice(-1)[0];
  const exs = evolucaoPorExercicio(d.reg).sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR"));
  const ponta = e => { const ws = Object.keys(e.semanas).map(Number).sort((x, y) => x - y); return {ws, p: e.semanas[ws[0]], u: e.semanas[ws[ws.length - 1]]}; };
  const subiram = exs.filter(e => { const {ws, p, u} = ponta(e); return ws.length > 1 && u.kg > p.kg; }).length;
  const comDuas = exs.filter(e => Object.keys(e.semanas).length > 1).length;
  const freq = (r.freq || []).filter(x => x.semana <= (c.concluidas || 0) && x.previstos);
  const feitos = freq.reduce((s, x) => s + x.feitos, 0), previstos = freq.reduce((s, x) => s + x.previstos, 0);
  const recs = r.recordes || [];
  const vIni = (V.total[ini] || {}).kg || 0, vFim = (V.total[fim] || {}).kg || 0, vv = fim !== ini ? variacao(vIni, vFim) : null;
  R.cartoes([
    previstos ? ["Frequência", Math.round(100 * feitos / previstos) + "%", `${feitos} de ${previstos} treinos`] : null,
    vs.length ? ["Volume semanal", nf(vFim) + " kg", vv == null ? `semana ${fim}` : `${pct(vv)} desde a semana ${ini}`, vv > 0 ? "sobe" : vv < 0 ? "desce" : ""] : null,
    ["Recordes", String(recs.length), recs.length ? "no ciclo" : "ainda nenhum"],
    comDuas ? ["Mais carga", `${subiram} de ${comDuas}`, "exercícios"] : null
  ]);
  if (vs.length > 1){ R.h2("Volume total por semana", "reps × kg"); R.grafico("Volume total (kg)", vs.map(w => ({x: "S" + w, y: Math.round((V.total[w] || {}).kg || 0)})), " kg", {zero: true}); }
  if (freq.length > 1){ R.h2("Frequência", "% dos treinos feitos"); R.grafico("Treinos feitos por semana (%)", freq.map(x => ({x: "S" + x.semana, y: Math.round(100 * x.feitos / x.previstos)})), "%", {zero: true, max: 100}); }
  const nomes = Object.keys(V.por).sort((x, y) => x.localeCompare(y, "pt-BR"));
  if (nomes.length){
    R.h2("Por grupamento muscular", `semana ${ini} a ${fim}`);
    const tons = [], linhas = nomes.map(g => { const p = V.por[g][ini] || {kg: 0, series: 0}, u = V.por[g][fim] || {kg: 0, series: 0}, v = fim !== ini ? variacao(p.kg, u.kg) : null;
      tons.push([null, null, null, null, v > 0 ? "sobe" : v < 0 ? "desce" : null]); return [g, nf(u.series), nf(p.kg), nf(u.kg), pct(v)]; });
    R.tabela(["Grupamento", `Séries S${fim}`, `kg S${ini}`, `kg S${fim}`, "Variação"], linhas, [2.2, 1, 1, 1, 1], tons);
    R.p("Volume = repetições × kg. O grupamento principal conta inteiro e o secundário, metade.", 8);
  }
  if (exs.length){
    R.h2("Carga por exercício", "melhor série: 1ª semana e última");
    const tons = [], linhas = exs.map(e => { const {ws, p, u} = ponta(e), v = ws.length > 1 ? variacao(p.kg, u.kg) : null;
      tons.push([null, null, null, v > 0 ? "sobe" : v < 0 ? "desce" : null]);
      return [e.nome, `${nf(p.kg)} kg × ${p.reps}`, `${nf(u.kg)} kg × ${u.reps}`, pct(v)]; });
    R.tabela(["Exercício", "Início", "Agora", "Variação"], linhas, [2.6, 1.2, 1.2, .9], tons);
  }
  if (recs.length){
    R.h2("Recordes", plural(recs.length, "recorde", "recordes"));
    R.tabela(["Exercício", "Semana", "Recorde"], recs.slice().sort((x, y) => y.semana - x.semana).slice(0, 30).map(x => [x.exercicio, "S" + x.semana, txtRec(x.texto)]), [2.2, .7, 2.2]);
  }
  return R.fim(`Evolução do treino ${a.nome} ${isoDe(hojeZero())}`);
}

// ---------- 2. avaliação física (planilha "Avaliação <Nome>", aba Avaliações) ----------
async function pdfAvaliacao(a){
  const d = DADOS[a.chave] || {}, v = d.avaliacao;
  if (!v) throw new Error("Ainda não abri a planilha de avaliação deste aluno. Toque em ↻ e tente de novo.");
  const linha = rot => v.find(r => txt(r[0]) === rot);
  const datas = (linha("Data da avaliação") || []).slice(2), cols = datas.map((x, i) => i).filter(i => txt(datas[i]));
  if (!cols.length) throw new Error("Nenhuma avaliação preenchida ainda.");
  const rotData = i => { const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.exec(txt(datas[i])); return m ? `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}${m[3] ? "/" + (m[3].length === 2 ? "20" + m[3] : m[3]) : ""}` : "Av " + (i + 1); };
  const curto = i => rotData(i).slice(0, 5);
  const serie = rot => { const l = linha(rot); return l ? cols.map(i => ({x: curto(i), y: lerPlanilha(l[2 + i])})).filter(p => p.y !== "") : []; };
  const R = await novoPdf("Avaliação física", "Relatório de evolução", a.nome,
    cols.length > 1 ? `${cols.length} avaliações: de ${rotData(cols[0])} a ${rotData(cols[cols.length - 1])}` : `Avaliação de ${rotData(cols[0])}`);
  R.cartoes([["Peso", "kg"], ["% de gordura", "%"], ["Massa magra", "kg"], ["Cintura", "cm"]].map(([rot, un]) => {
    const s = serie(rot); if (!s.length) return null;
    const u = s[s.length - 1].y, dif = s.length > 1 ? Math.round((u - s[0].y) * 10) / 10 : null;
    return [rot, nf(u) + (un === "%" ? "%" : " " + un), dif == null ? `em ${s[0].x}` : `${dif === 0 ? "igual" : sinal(dif) + (un === "%" ? " pontos" : " " + un)} desde ${s[0].x}`];
  }));
  R.grafico("Peso (kg)", serie("Peso"), " kg");
  R.grafico("% de gordura", serie("% de gordura"), "%");
  R.grafico("Massa magra (kg)", serie("Massa magra"), " kg");
  const medidas = [["Peso", "kg"], ["Altura", "m"], ["% de gordura", "%"], ["Massa magra", "kg"], ["Massa gorda", "kg"], ["IMC", ""],
    ["Cintura", "cm"], ["Abdômen", "cm"], ["Quadril", "cm"], ["Tórax", "cm"], ["Ombro", "cm"], ["Braço relaxado direito", "cm"], ["Braço contraído direito", "cm"], ["Antebraço direito", "cm"],
    ["Coxa direita", "cm"], ["Panturrilha direita", "cm"], ["Braço relaxado esquerdo", "cm"], ["Braço contraído esquerdo", "cm"], ["Coxa esquerda", "cm"], ["Panturrilha esquerda", "cm"], ["Soma das 7 dobras", "mm"]];
  const mostrar = cols.slice(-5), linhas = [];
  medidas.forEach(([rot, un]) => { const l = linha(rot); if (!l) return; const vals = mostrar.map(i => lerPlanilha(l[2 + i])); if (vals.every(x => x === "")) return;
    const todos = cols.map(i => lerPlanilha(l[2 + i])).filter(x => x !== ""), dif = todos.length > 1 ? todos[todos.length - 1] - todos[0] : null;
    linhas.push([`${rot}${un ? ` (${un})` : ""}`, ...vals.map(x => x === "" ? "-" : nf(x)), ...(cols.length > 1 ? [sinal(dif == null ? null : Math.round(dif * 10) / 10)] : [])]); });
  if (linhas.length){
    R.h2("Medidas", cols.length > mostrar.length ? `as ${mostrar.length} últimas avaliações` : "");
    R.tabela(["Medida", ...mostrar.map(curto), ...(cols.length > 1 ? ["Mudou"] : [])], linhas, [2.4, ...mostrar.map(() => 1), ...(cols.length > 1 ? [1] : [])]);
    if (cols.length > 1) R.p(`"Mudou" = da primeira avaliação (${rotData(cols[0])}) para a última.`, 8);
  }
  return R.fim(`Avaliação física ${a.nome} ${isoDe(hojeZero())}`);
}

// ---------- 3. fotos de avaliação, antes × depois (aba Avaliação; as datas escolhidas na tela) ----------
// Enquadramento igual (pedido do criador, 15/11/2026), a mesma conta de .claude/skills/treinador/scripts/corpo.py:
// o detector de pose do MediaPipe acha o corpo (alto da cabeça à ponta dos pés) e as duas fotos ficam com o corpo
// do mesmo tamanho e no mesmo lugar, num quadro 9:16. Roda no celular; a foto não sai dele.
// Sem o detector (sem internet na 1ª vez) ou sem achar o corpo numa das duas: usa a foto inteira e avisa.
const MP_VERSAO = "1.2.0", MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSAO}`;
const OCUPA_TOPO = .05, OCUPA_BASE = .95;
let POSE_P = null;
function detectorPose(){
  if (!POSE_P) POSE_P = (async () => {
    const mp = await import(`${MP_BASE}/vision_bundle.mjs`);
    const arq = await mp.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    return mp.PoseLandmarker.createFromOptions(arq, {baseOptions: {modelAssetPath: new URL("pose/pose_landmarker_lite.task", location.href).href, delegate: "CPU"}, runningMode: "IMAGE", numPoses: 1});
  })();
  POSE_P.catch(() => { POSE_P = null; });
  return POSE_P;
}
function abrirImg(url){
  return new Promise((ok, falha) => { const img = new Image(); img.onload = () => ok(img); img.onerror = () => falha(new Error("Não abriu uma das fotos.")); img.src = url; });
}
// devolve {topo, base, cx, span} em pixels da foto, ou null
function acharCorpo(det, img){
  const w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, 1000 / Math.max(w, h));
  const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const r = det.detect(c); const L = r && r.landmarks && r.landmarks[0];
  if (!L) return null;
  const P = i => [L[i].x * w, L[i].y * h];
  const nariz = P(0), pes = Math.max(...[29, 30, 31, 32].map(i => P(i)[1])), calc = (P(29)[1] + P(30)[1]) / 2;
  const topo = nariz[1] - .10 * (calc - nariz[1]), cx = [11, 12, 23, 24].reduce((s, i) => s + P(i)[0], 0) / 4, span = pes - topo;
  if (!(span > h * .2)) return null;
  // rosto (para o Instagram): do nariz para a orelha mais próxima no perfil, centrado no nariz de frente (corpo.py)
  const orelhas = [P(7), P(8)], orelha = orelhas.reduce((b, o) => Math.abs(o[0] - nariz[0]) < Math.abs(b[0] - nariz[0]) ? o : b);
  const perfil = Math.abs(orelhas[0][0] - orelhas[1][0]) < .04 * span;
  const centro = perfil ? [nariz[0] * .75 + orelha[0] * .25, nariz[1] * .75 + orelha[1] * .25] : nariz;
  return {topo, base: pes, cx, span, rosto: [centro[0], centro[1] - .004 * span, (perfil ? .040 : .042) * span, .052 * span]};
}
// quadro larg × alt com o corpo do mesmo tamanho e no mesmo lugar; fora da foto, repete a borda
function enquadrar(img, ach, larg, alt){
  const c = enquadrarCanvas(img, ach, larg, alt);
  return {src: c.toDataURL("image/jpeg", .86), w: larg, h: alt};
}
function enquadrarCanvas(img, ach, larg, alt){
  const c = document.createElement("canvas"); c.width = larg; c.height = alt; const g = c.getContext("2d");
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, esc = alt * (OCUPA_BASE - OCUPA_TOPO) / ach.span;
  const x0 = ach.cx - larg / esc / 2, y0 = ach.topo - OCUPA_TOPO * alt / esc;
  const dx = -x0 * esc, dy = -y0 * esc, dw = w * esc, dh = h * esc;
  g.drawImage(img, 0, 0, 1, 1, 0, 0, larg, alt);   // fundo: a cor do canto
  if (dx > 0) g.drawImage(img, 0, 0, 1, h, 0, dy, dx, dh);
  if (dx + dw < larg) g.drawImage(img, w - 1, 0, 1, h, dx + dw, dy, larg - dx - dw, dh);
  if (dy > 0) g.drawImage(img, 0, 0, w, 1, dx, 0, dw, dy);
  if (dy + dh < alt) g.drawImage(img, 0, h - 1, w, 1, dx, dy + dh, dw, alt - dy - dh);
  g.drawImage(img, dx, dy, dw, dh);
  return c;
}
function fotoInteira(img){
  const k = Math.min(1, 1100 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  return {src: c.toDataURL("image/jpeg", .86), w: c.width, h: c.height};
}
// a análise que o criador escreve no app (campo "Sua análise"), guardada no celular por aluno e par de datas
const chaveAnalise = (a, antes, depois) => `t_analise:${a.chave}:${antes}:${depois}`;
function datasFotos(a){
  const lista = (FOTOS[a.chave] || []).filter(f => f.angulo !== "Outras"), datas = [...new Set(lista.map(f => f.data))].sort();
  let [antes, depois] = FOTO_SEL[a.chave] || [datas[0], datas[datas.length - 1]];
  if (!datas.includes(antes)) antes = datas[0]; if (!datas.includes(depois)) depois = datas[datas.length - 1];
  return {lista, datas, antes, depois};
}
async function pdfFotos(a){
  const {lista, antes, depois} = datasFotos(a);
  if (!lista.length) throw new Error("Nenhuma foto de avaliação na pasta deste aluno.");
  const mostrar = antes === depois ? [antes] : [antes, depois], rot = s => ddaaaa(isoData(s));
  const angs = FOTO_ANGULOS.filter(ang => mostrar.some(dt => lista.some(f => f.angulo === ang && f.data === dt)));
  // baixa as fotos (ficam guardadas no celular depois da 1ª vez)
  const imgs = {};
  await Promise.all(angs.flatMap(ang => mostrar.map(async dt => { const f = lista.find(x => x.angulo === ang && x.data === dt); if (!f) return;
    try { imgs[ang + "|" + dt] = await abrirImg(await carregarFoto(a, f.id)); } catch(e){ imgs[ang + "|" + dt] = null; } })));
  if (!Object.values(imgs).some(Boolean)) throw new Error("Não consegui abrir as fotos. Confira a internet e tente de novo.");
  let det = null, semAjuste = [];
  try { det = await detectorPose(); } catch(e){ console.warn(e); }
  const prontas = {};
  angs.forEach(ang => {
    const ims = mostrar.map(dt => imgs[ang + "|" + dt]);
    let achs = null;
    if (det) try { achs = ims.map(im => im ? acharCorpo(det, im) : null); } catch(e){ console.warn(e); }
    const ok = achs && ims.every((im, j) => !im || achs[j]);
    if (!ok) semAjuste.push(ang);
    mostrar.forEach((dt, j) => { const im = ims[j]; if (im) prontas[ang + "|" + dt] = ok ? enquadrar(im, achs[j], 900, 1600) : fotoInteira(im); });
  });
  const analise = txt(ler(chaveAnalise(a, antes, depois)) || "");
  const R = await novoPdf("Fotos de avaliação", mostrar.length > 1 ? "Antes e depois" : "Avaliação", a.nome,
    mostrar.length > 1 ? `${rot(antes)} e ${rot(depois)}` : rot(antes));
  const {doc, M, L} = R, g = 6, w = mostrar.length > 1 ? (L - g) / 2 : L * .62, alt = 100;
  angs.forEach(ang => {
    R.precisa(alt + 20);   // 1 ângulo na 1ª página (embaixo do título), 2 nas outras
    R.h2(ang);
    mostrar.forEach((dt, j) => {
      const x = mostrar.length > 1 ? M + j * (w + g) : M + (L - w) / 2, y = R.y, im = prontas[ang + "|" + dt];
      R.cor(COR.fundo, "f"); doc.rect(x, y, w, alt, "F");
      if (im){ const s = Math.min(w / im.w, alt / im.h), iw = im.w * s, ih = im.h * s; doc.addImage(im.src, "JPEG", x + (w - iw) / 2, y + (alt - ih) / 2, iw, ih); }
      else { doc.setFontSize(9); R.cor(COR.sub); doc.text("Sem foto", x + w / 2, y + alt / 2, {align: "center"}); }
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); R.cor(COR.texto);
      doc.text(pdfTxt(mostrar.length > 1 ? `${j ? "Depois" : "Antes"} · ${rot(dt)}` : rot(dt)), x + w / 2, y + alt + 5, {align: "center"});
    });
    R.y += alt + 11;
  });
  if (analise){
    R.h2("Análise", "Lucas Gabriel · Treinador");
    analise.split(/\n+/).map(t => t.trim()).filter(Boolean).forEach(t => {
      if (/^#{2,3}\s/.test(t)){ R.precisa(16); R.y += 2; doc.setFont("helvetica", "bold"); doc.setFontSize(11); R.cor(COR.preto); doc.text(pdfTxt(t.replace(/^#+\s*/, "")), M, R.y + 3.5); R.y += 7; }
      else R.p(t.replace(/^[-•]\s+/, "• "), 10, COR.texto);
    });
  }
  R.p("Fotos de uso pessoal: só você e o seu treinador.", 8);
  const arq = R.fim(`Fotos de avaliação ${a.nome} ${isoDe(hojeZero())}`);
  if (semAjuste.length) arq.aviso = det ? `Não achei o corpo inteiro em ${semAjuste.join(", ")}: ${semAjuste.length > 1 ? "esses ângulos foram" : "esse ângulo foi"} com a foto inteira, sem igualar o enquadramento.`
    : "Sem internet para abrir o ajuste das fotos: elas foram inteiras, sem igualar o enquadramento.";
  return arq;
}

// ---------- 4. antes e depois para o Instagram (pedido do criador, 15/11/2026) ----------
// Igual ao .claude/skills/treinador/scripts/insta.py: 1080 × 1350 (4:5, feed), uma imagem por ângulo, fundo preto,
// título do ângulo e "ANTES" / "DEPOIS" em branco, sem datas e sem amarelo, logo em cima, as duas fotos com o corpo do
// mesmo tamanho e no mesmo lugar e, se pedido, o rosto borrado (nunca na foto de costas). Tudo no celular.
const IG_L = 1080, IG_A = 1350, IG_M = 24, IG_VAO = 12, IG_TOPO = 118, IG_RODAPE = 120;
function borrarRosto(img, ach){
  const w = img.naturalWidth, h = img.naturalHeight, c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"); g.drawImage(img, 0, 0);
  const [cx, cy, rx, ry] = ach.rosto, bloco = Math.max(6, rx * .55);
  const p = document.createElement("canvas"); p.width = Math.max(2, Math.round(w / bloco)); p.height = Math.max(2, Math.round(h / bloco));
  const pg = p.getContext("2d"); try { pg.filter = `blur(${Math.max(1, Math.round(rx / bloco / 2))}px)`; } catch(e){}
  pg.drawImage(img, 0, 0, p.width, p.height);
  g.save(); g.beginPath(); g.ellipse(cx, cy, rx * 1.1, ry * 1.1, 0, 0, 2 * Math.PI); g.clip();
  g.imageSmoothingEnabled = false; g.drawImage(p, 0, 0, w, h); g.restore();
  return c;
}
async function imagensInstagram(a, borrar){
  const {lista, antes, depois} = datasFotos(a);
  if (antes === depois) throw new Error("Escolha duas datas diferentes (Antes e Depois).");
  const angs = FOTO_ANGULOS.filter(ang => lista.some(f => f.angulo === ang && f.data === antes) && lista.some(f => f.angulo === ang && f.data === depois));
  if (!angs.length) throw new Error("Nenhum ângulo tem foto nas duas datas escolhidas.");
  let det; try { det = await detectorPose(); } catch(e){ throw new Error("Sem internet para abrir o ajuste das fotos. Tente de novo com internet."); }
  try { await document.fonts.load('800 58px "Archivo"'); } catch(e){}
  const logo = await new Promise(ok => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = "../icons/logo-horizontal.svg"; });
  const larg = Math.floor((IG_L - 2 * IG_M - IG_VAO) / 2), alt = IG_A - IG_TOPO - IG_RODAPE, arqs = [], avisos = [];
  for (const ang of angs){
    const fotos = [];
    for (const dt of [antes, depois]){
      const f = lista.find(x => x.angulo === ang && x.data === dt), img = await abrirImg(await carregarFoto(a, f.id));
      const ach = acharCorpo(det, img);
      if (!ach){ avisos.push(`${ang} (${dt === antes ? "antes" : "depois"})`); fotos.push(enquadrarCanvas(img, {topo: 0, cx: img.naturalWidth / 2, span: img.naturalHeight / (OCUPA_BASE - OCUPA_TOPO) * .9}, larg, alt)); continue; }
      fotos.push(enquadrarCanvas(borrar && ang !== "Costas" ? borrarRosto(img, ach) : img, ach, larg, alt));
    }
    const c = document.createElement("canvas"); c.width = IG_L; c.height = IG_A; const g = c.getContext("2d");
    g.fillStyle = "#0B0B0B"; g.fillRect(0, 0, IG_L, IG_A);
    g.fillStyle = "#FAFAFA"; g.fillRect(IG_M, 34, 10, 56);
    g.font = '800 58px "Archivo", "Arial Narrow", Arial, sans-serif'; g.textBaseline = "top"; g.fillText(ang.toUpperCase(), IG_M + 28, 30);
    if (logo){ const lw = 380, lh = lw * 120 / 579; g.drawImage(logo, IG_L - IG_M - lw, 12 + (96 - lh) / 2, lw, lh); }
    const xs = [IG_M, IG_M + larg + IG_VAO];
    fotos.forEach((f, i) => g.drawImage(f, xs[i], IG_TOPO));
    g.fillRect(IG_M + larg + IG_VAO / 2 - 1, IG_TOPO, 3, alt);
    g.font = '800 52px "Archivo", "Arial Narrow", Arial, sans-serif'; g.textAlign = "center";
    ["ANTES", "DEPOIS"].forEach((t, i) => g.fillText(t, xs[i] + larg / 2, IG_TOPO + alt + 30));
    const blob = await new Promise(ok => c.toBlob(ok, "image/jpeg", .92));
    arqs.push(new File([blob], pdfTxt(`Antes e depois ${primeiro(a.nome)} ${ang}`).replace(/[\\/:*?"<>|]/g, "-") + ".jpg", {type: "image/jpeg"}));
  }
  arqs.aviso = avisos.length ? `Não achei o corpo inteiro em: ${avisos.join(", ")}. Essa foto foi sem igualar o enquadramento${borrar ? " e sem borrar o rosto" : ""}: confira antes de postar.` : "";
  return arqs;
}
// imagens prontas: ver, mandar todas juntas (carrossel no Instagram) ou baixar uma a uma
function entregarImagens(arqs){
  const urls = arqs.map(f => URL.createObjectURL(f));
  const podeMandar = !!(navigator.canShare && (() => { try { return navigator.canShare({files: arqs}); } catch(e){ return false; } })());
  const f = document.createElement("div"); f.className = "pdf-pronto"; f.setAttribute("role", "dialog"); f.setAttribute("aria-label", "Imagens prontas");
  f.innerHTML = `<div class="card"><h3>Antes e depois para o Instagram</h3><p class="sub">${plural(arqs.length, "imagem", "imagens")} 4:5 para o feed${arqs.length > 1 ? " (carrossel)" : ""}. Confira o rosto antes de postar.</p>
    <div class="ig-lista">${urls.map((u, i) => `<a href="${u}" download="${esc(arqs[i].name)}"><img src="${u}" alt="${esc(arqs[i].name)}"></a>`).join("")}</div>
    <div class="acoes">${podeMandar ? `<button class="btn amarelo" type="button" id="igMandar">Mandar (Instagram…)</button>` : ""}
    <button class="btn${podeMandar ? "" : " amarelo"}" type="button" id="igBaixar">Baixar ${arqs.length > 1 ? "todas" : ""}</button>
    <button class="btn" type="button" id="igFechar">Fechar</button></div><p class="sub" id="igMsg">${esc(arqs.aviso || "")}</p></div>`;
  const fechar = () => { f.remove(); setTimeout(() => urls.forEach(u => URL.revokeObjectURL(u)), 60000); };
  f.onclick = e => { if (e.target === f) fechar(); };
  document.body.appendChild(f);
  f.querySelector("#igFechar").onclick = fechar;
  f.querySelector("#igBaixar").onclick = () => urls.forEach((u, i) => setTimeout(() => { const l = document.createElement("a"); l.href = u; l.download = arqs[i].name; document.body.appendChild(l); l.click(); l.remove(); }, i * 400));
  if (podeMandar) f.querySelector("#igMandar").onclick = async () => {
    try { await navigator.share({files: arqs}); }
    catch(e){ if (e && e.name !== "AbortError") f.querySelector("#igMsg").textContent = "Não abriu o compartilhar. Use Baixar e poste pela galeria."; }
  };
}
function botaoInstagram(bt, a){
  if (!bt) return;
  bt.onclick = async () => {
    const t = bt.textContent; bt.disabled = true; bt.textContent = "Montando as imagens…";
    try { entregarImagens(await imagensInstagram(a, !!$("igBorrar") && $("igBorrar").checked)); }
    catch(e){ console.error(e); alert((e && e.message) || "Não consegui montar as imagens."); }
    finally { bt.disabled = false; bt.textContent = t; }
  };
}

