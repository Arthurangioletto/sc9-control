/* Lista de saída para a transportadora assinar (impressão em A4). Recebe a resposta de POST /api/expedicao/lista e monta
 * uma folha por transportadora; o estilo de impressão (@media print) fica em expedicao.css (classes "lista-*").
 * Funciona em tela cheia e dentro do SC9 (moldura ?embed=1): window.print() imprime o documento da própria moldura.
 * Tudo que vem do servidor entra como texto (nunca como HTML). JavaScript puro, sem nada de fora. */
(function (root) {
  'use strict';
  const FUSO = 'America/Sao_Paulo';
  const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const ID_RAIZ = 'exp-lista-impressao';

  /* ---------- funções puras (testáveis sem navegador) ---------- */
  const ehDia = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
  const dmy = (d) => (ehDia(d) ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '');
  const diaLongo = (d) => (ehDia(d) ? DIAS[new Date(d + 'T12:00:00Z').getUTCDay()] + ', ' + dmy(d) : '');
  const hora = (iso) => { const t = iso ? new Date(iso) : null; return t && !isNaN(t) ? t.toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' }) : ''; };
  const dataHora = (iso) => { const t = iso ? new Date(iso) : null; return t && !isNaN(t) ? t.toLocaleDateString('pt-BR', { timeZone: FUSO }) + ' às ' + hora(iso) : ''; };
  const plural = (n, um, varios) => Number(n || 0).toLocaleString('pt-BR') + ' ' + (Number(n) === 1 ? um : varios);
  const textoVolumes = (v) => (v == null || v === '' ? '' : String(v));
  const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'transportadora';
  // Nome sugerido ao salvar em PDF: "Lista de saida - retira-3 - 2026-11-25"
  const nomeDocumento = (dados, grupo) => 'Lista de saida - ' + slug(grupo && grupo.transportadora) + ' - ' + String((dados && dados.dia) || '');
  const totaisGrupo = (g) => {
    const linhas = (g && g.linhas) || [];
    return { pedidos: g && g.totalPedidos != null ? g.totalPedidos : linhas.length, volumes: g && g.totalVolumes != null ? g.totalVolumes : linhas.reduce((a, l) => a + (Number(l.volumes) || 0), 0), semNota: linhas.filter((l) => l.aguardandoNota || !l.nf).length };
  };
  function validar(dados) {
    if (!dados || !Array.isArray(dados.grupos) || !dados.grupos.length) throw new Error('A lista veio vazia. Marque os pedidos e tente de novo.');
    return dados;
  }

  /* ---------- montagem do documento ---------- */
  const el = (tag, classe, texto, extra) => {
    const e = root.document.createElement(tag);
    if (classe) e.className = classe;
    if (texto != null && texto !== '') e.textContent = String(texto);
    for (const [k, v] of Object.entries(extra || {})) e.setAttribute(k, v);
    return e;
  };
  function campoAssinatura(rotulo) {
    const c = el('div', 'lista-campo');
    c.append(el('span', 'lista-linha'), el('span', 'lista-rotulo', rotulo));
    return c;
  }
  function folha(dados, g) {
    const t = totaisGrupo(g);
    const f = el('section', 'lista-folha');
    const cab = el('header', 'lista-cab');
    cab.append(el('p', 'lista-marca', 'Central de Pedidos · Expedição'), el('h1', 'lista-titulo', 'Lista de saída para a transportadora'));
    const meta = el('div', 'lista-meta');
    const transp = el('div', 'lista-transp'); transp.append(el('span', null, 'Transportadora'), el('b', null, g.transportadora || 'Sem transportadora'));
    const dl = el('dl', 'lista-dados');
    const par = (k, v) => { const d = el('div'); d.append(el('dt', null, k), el('dd', null, v)); return d; };
    dl.append(par('Data', diaLongo(dados.dia)), par('Lista nº', dados.listaId || ''), par('Gerada por', (dados.geradoPor || '—') + (dados.geradoEm ? ' · ' + dataHora(dados.geradoEm) : '')), par('Total', plural(t.pedidos, 'pedido', 'pedidos') + ' · ' + plural(t.volumes, 'volume', 'volumes')));
    meta.append(transp, dl);

    const tab = el('table', 'lista-tab');
    tab.append(el('caption', 'lista-sr', 'Pedidos desta transportadora'));
    const cols = [['Nº', 'c-n'], ['Pedido', 'c-ped'], ['Nota fiscal', 'c-nf'], ['Cliente', 'c-cli'], ['Vol.', 'c-vol'], ['Observação', 'c-obs'], ['Assinatura / OK', 'c-ass']];
    const thead = el('thead'), trh = el('tr');
    for (const [nome, cls] of cols) trh.append(el('th', cls, nome, { scope: 'col' }));
    thead.append(trh); tab.append(thead);
    const tbody = el('tbody');
    (g.linhas || []).forEach((l, i) => {
      const tr = el('tr');
      const nf = l.aguardandoNota || !l.nf ? el('td', 'c-nf sem-nota', 'aguardando nota') : el('td', 'c-nf', l.nf);
      tr.append(el('td', 'c-n', i + 1), el('td', 'c-ped', l.pedido), nf, el('td', 'c-cli', l.cliente || '—'), el('td', 'c-vol', textoVolumes(l.volumes)), el('td', 'c-obs', l.observacao || ''), el('td', 'c-ass'));
      tbody.append(tr);
    });
    tab.append(tbody);

    const tot = el('p', 'lista-totais');
    tot.append(el('b', null, plural(t.pedidos, 'pedido', 'pedidos') + ' · ' + plural(t.volumes, 'volume', 'volumes')), t.semNota ? el('span', null, ' · ' + plural(t.semNota, 'pedido aguardando nota', 'pedidos aguardando nota')) : '');
    const assin = el('div', 'lista-assin');
    assin.append(campoAssinatura('Entregue por (expedição)'), campoAssinatura('Recebido por (transportadora)'), campoAssinatura('Data e hora'));
    const bloco = el('div', 'lista-fim'); bloco.append(tot, assin);
    f.append(cab, meta, tab, bloco);
    return f;
  }
  function montar(dados) {
    validar(dados);
    const raiz = el('div', 'lista-impressao', null, { id: ID_RAIZ, 'aria-hidden': 'true' });
    for (const g of dados.grupos) raiz.append(folha(dados, g));
    // rodapé fixo: o navegador o repete em todas as páginas impressas
    raiz.append(el('footer', 'lista-pe', 'Lista ' + (dados.listaId || '') + ' · gerada por ' + (dados.geradoPor || '—') + ' em ' + dataHora(dados.geradoEm) + ' · Central de Pedidos'));
    return raiz;
  }
  function limpar() {
    const antigo = root.document.getElementById(ID_RAIZ); if (antigo) antigo.remove();
    root.document.body.classList.remove('imprimindo-lista');
  }
  // Põe a lista na página (escondida na tela) e abre a janela de impressão. Devolve o elemento montado.
  function preparar(dados) {
    limpar();
    const raiz = montar(dados);
    root.document.body.appendChild(raiz);
    root.document.body.classList.add('imprimindo-lista');
    return raiz;
  }
  function imprimir(dados) {
    const raiz = preparar(dados);
    const tituloAntes = root.document.title;
    root.document.title = nomeDocumento(dados, dados.grupos.length === 1 ? dados.grupos[0] : { transportadora: 'varias-transportadoras' });
    const fim = () => { root.document.title = tituloAntes; root.document.body.classList.remove('imprimindo-lista'); root.removeEventListener('afterprint', fim); };
    root.addEventListener('afterprint', fim);
    // dá um respiro para o navegador montar o layout antes de abrir a impressão
    return new Promise((ok) => root.setTimeout(() => { try { root.print(); } finally { ok(raiz); } }, 60));
  }

  const api = { montar, preparar, imprimir, limpar, ehDia, dmy, diaLongo, plural, slug, nomeDocumento, totaisGrupo, validar, ID_RAIZ };
  root.SC9ExpedicaoLista = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
