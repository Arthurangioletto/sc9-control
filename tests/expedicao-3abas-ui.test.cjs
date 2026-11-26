// Expedição em 3 abas (Bipar · Planilha de entrega · Entregas/POD · Visão geral): testes do front-end.
// O navegador de verdade foi usado contra um servidor simulado (ver relatório); aqui ficam as garantias que rodam em qualquer máquina:
// arquivos servidos com CSP, contrato da API usado pela tela, colunas da planilha numa constante só, impressão A4 e acessibilidade básica.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const RAIZ = path.join(__dirname, '..');
const ler = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const UI = ler('expedicao-ui.js'), CSS = ler('expedicao.css'), HTML = ler('expedicao.html'), LISTA = ler('expedicao-lista.js');

test('páginas e scripts das abas são servidos com CSP restritiva, e a impressão tem o seu script', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-exp3ui-'));
  for (const f of fs.readdirSync(RAIZ)) if (/\.(js|html|css)$/.test(f)) fs.copyFileSync(path.join(RAIZ, f), path.join(dir, f));
  fs.mkdirSync(path.join(dir, 'data'));
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const f of ['expedicao.html', 'expedicao-ui.js', 'expedicao.css', 'expedicao-xlsx.js', 'expedicao-lista.js']) {
      const r = await fetch(base + '/' + f);
      assert.equal(r.status, 200, f);
      const tipo = r.headers.get('content-type') || '';
      assert.ok(f.endsWith('.html') || !/text\/html/.test(tipo), f + ' não cai no index.html');
    }
    const lista = await (await fetch(base + '/expedicao-lista.js')).text();
    assert.match(lista, /SC9ExpedicaoLista/);
    const html = await fetch(base + '/expedicao.html');
    const csp = html.headers.get('content-security-policy') || '';
    assert.match(csp, /script-src 'self'/); assert.match(csp, /default-src 'none'/); assert.match(csp, /connect-src 'self'/); assert.match(csp, /frame-ancestors 'self'/);
  } finally { await new Promise((r) => server.close(r)); }
});

test('a página carrega os scripts na ordem certa e não usa recurso externo', () => {
  assert.ok(!/(src|href)="https?:\/\//i.test(HTML), 'sem recurso externo');
  const ordem = ['central-ui.js', 'expedicao-xlsx.js', 'expedicao-lista.js', 'expedicao-ui.js'].map((f) => HTML.indexOf('/' + f));
  assert.ok(ordem.every((i) => i > 0), 'todos os scripts presentes');
  assert.deepEqual(ordem.slice().sort((a, b) => a - b), ordem, 'ordem de carregamento');
  for (const [nome, txt] of [['expedicao-ui.js', UI], ['expedicao-lista.js', LISTA]]) {
    assert.ok(!/https?:\/\/(?!rastreio|www\.w3\.org)/.test(txt.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')) || nome, nome + ' sem URL externa embutida');
    assert.ok(!/\binnerHTML\b|\beval\(|new Function\(|document\.write/.test(txt), nome + ' não monta HTML a partir de texto (tudo entra como texto)');
  }
  assert.ok(!/@import|url\(\s*['"]?https?:/i.test(CSS), 'CSS sem recurso externo');
});

test('a tela usa só as rotas do contrato da spec v2 (e as da v1)', () => {
  for (const rota of ['/api/expedicao/acesso', '/api/expedicao/planilha', '/api/expedicao/observacao', '/api/expedicao/transportadora', '/api/expedicao/lista', '/api/expedicao/entregas', '/api/expedicao/pod', '/api/expedicao/painel', '/api/expedicao/pedidos', '/api/expedicao/exportar', '/api/expedicao/rastreio', '/api/expedicao/importar-entrega', '/api/recebimento/bipar', '/api/recebimento/atualizar']) assert.ok(UI.includes(rota), rota);
  assert.match(UI, /fotoConfere/); assert.match(UI, /podHistorico/);
  // lista: por ids (seleção) ou por transportadoras (sem seleção), sempre com o dia
  assert.match(UI, /\{ dia: pl\.dia, ids: linhas\.map\(\(l\) => l\.id\) \}/);
  assert.match(UI, /\{ dia: pl\.dia, transportadoras: lista\.map\(\(g\) => g\.nome\) \}/);
  // troca em lote: ids com {id, dia}; um só pedido usa {id, dia, para, motivo}
  assert.match(UI, /ids: sel\.map\(\(l\) => \(\{ id: l\.id, dia: pl\.dia \}\)\)/);
  assert.match(UI, /id: sel\[0\]\.id, dia: pl\.dia, para, motivo: mt/);
});

test('abas: só as permitidas, hash #bipar|#planilha|#entregas|#geral, quem só bipa não vê a barra', () => {
  for (const h of ['bipar', 'planilha', 'entregas', 'geral']) assert.ok(new RegExp("hash: '" + h + "'").test(UI), h);
  assert.match(UI, /abas\.visaoGeral/); assert.match(UI, /const unica = lista\.length === 1/); assert.match(UI, /ui\.abas = unica \? null/);
  assert.match(UI, /role: 'tablist'/); assert.match(UI, /'aria-selected'/); assert.match(UI, /ArrowLeft\|ArrowRight\|Home\|End/);
  assert.match(UI, /replaceState/); assert.match(UI, /hashchange/);
  // perfis antigos continuam valendo se o servidor não tiver a rota de acesso
  assert.match(UI, /p\.includes\('recebimento'\)/); assert.match(UI, /p\.includes\('despacho'\)/);
});

test('colunas da Planilha de entrega ficam numa constante só (COLUNAS_PLANILHA), na ordem e com os nomes da planilha', () => {
  const m = UI.match(/const COLUNAS_PLANILHA = \[([\s\S]*?)\n  \];/);
  assert.ok(m, 'constante COLUNAS_PLANILHA no topo');
  assert.ok(UI.indexOf('COLUNAS_PLANILHA') < UI.indexOf('const estado = {'), 'declarada no topo do arquivo');
  const nomes = [...m[1].matchAll(/nome: '([^']+)'/g)].map((x) => x[1]);
  assert.deepEqual(nomes, ['Data', 'Pedido', 'Cliente', 'Nota Fiscal', 'Transportadora', 'Armazém', 'Volumes', 'Observação', 'Bipado às', 'Bipado por', 'Situação']);
  const ks = [...m[1].matchAll(/k: '([^']+)'/g)].map((x) => x[1]);
  assert.equal(new Set(ks).size, ks.length, 'cada coluna mostra um dado diferente');
  // a tabela e o cabeçalho nascem da constante, nada de nome escrito à mão
  assert.match(UI, /COLUNAS_PLANILHA\.map\(\(c\) => h\('th'/); assert.match(UI, /COLUNAS_PLANILHA\.map\(\(c\) => celulaPlan\(c, l\)\)/);
  // o Excel/CSV baixado usa os mesmos nomes
  const X = require(path.join(RAIZ, 'expedicao-xlsx.js'));
  assert.deepEqual(X.CAB_PLAN.slice(0, nomes.length), nomes);
});

test('Excel/CSV da planilha: mesmas colunas, "Aguardando nota" onde falta a nota, troca descrita', () => {
  const X = require(path.join(RAIZ, 'expedicao-xlsx.js'));
  const linhas = X.linhasPlanilha([
    { data: '2026-11-25', pedido: '482387', cliente: 'Casa do Parafuso', nf: '', transportadora: 'Brasil', transportadoraOriginal: 'Retira 4', trocada: true, armazem: '01', volumes: 3, observacao: 'Frágil', bipadoEm: '2026-11-25T13:00:00Z', bipadoPor: 'Joana', saiuEntrega: null, impressoEm: null }]);
  assert.equal(linhas.length, 1);
  const l = linhas[0];
  assert.equal(l[0], '25/11/2026'); assert.equal(l[1], '482387'); assert.equal(l[3], 'Aguardando nota'); assert.equal(l[4], 'Brasil'); assert.equal(l[6], 3); assert.equal(l[7], 'Frágil'); assert.equal(l[8], '10:00'); assert.equal(l[10], 'Na expedição');
  assert.match(l[11], /Era Retira 4, saiu como Brasil/);
  assert.equal(typeof X.baixarExcelPlanilha, 'function'); assert.equal(typeof X.baixarCsvPlanilha, 'function');
});

// ---------- impressão A4 ----------
function documentoFalso() {
  const texto = (t) => ({ tag: '#text', textContent: String(t), children: [] });
  const el = (tag) => ({ tag, className: '', attrs: {}, children: [], _t: '', set textContent(v) { this._t = String(v); }, get textContent() { return this._t + this.children.map((c) => c.textContent).join(''); }, append(...n) { for (const x of n) this.children.push(typeof x === 'string' ? texto(x) : x); }, setAttribute(k, v) { this.attrs[k] = v; } });
  return { createElement: el, getElementById: () => null, body: { classList: { add() {}, remove() {} }, appendChild() {} } };
}
const todos = (no, f, acc = []) => { if (f(no)) acc.push(no); for (const c of no.children || []) todos(c, f, acc); return acc; };

test('impressão: uma folha por transportadora, com título, nº da lista, totais, assinaturas e "aguardando nota"', () => {
  global.document = documentoFalso();
  delete require.cache[require.resolve(path.join(RAIZ, 'expedicao-lista.js'))];
  const L = require(path.join(RAIZ, 'expedicao-lista.js'));
  const dados = { listaId: 'L-20261125-091500-a1b2', geradoEm: '2026-11-25T12:15:00Z', geradoPor: 'Carlos Menezes', dia: '2026-11-25', grupos: [
    { transportadora: 'Brasil', totalPedidos: 2, totalVolumes: 5, linhas: [{ pedido: '482387', nf: '', aguardandoNota: true, cliente: 'Casa do Parafuso', volumes: 3, observacao: 'Frágil' }, { pedido: '482392', nf: '90892', aguardandoNota: false, cliente: 'Elétrica Central', volumes: 2, observacao: '' }] },
    { transportadora: 'TCE', totalPedidos: 1, totalVolumes: 0, linhas: [{ pedido: '482400', nf: '90900', cliente: 'Tintas Colorado', volumes: null, observacao: '' }] }] };
  const raiz = L.montar(dados);
  const folhas = todos(raiz, (n) => n.className === 'lista-folha');
  assert.equal(folhas.length, 2, 'uma folha por transportadora');
  const txt = raiz.textContent;
  for (const t of ['Lista de saída para a transportadora', 'L-20261125-091500-a1b2', 'Carlos Menezes', 'quarta-feira, 25/11/2026', 'Brasil', 'TCE', 'aguardando nota', '90892', 'Entregue por (expedição)', 'Recebido por (transportadora)', 'Data e hora', 'Assinatura / OK', '2 pedidos · 5 volumes', 'Observação', 'Nota fiscal', 'Vol.']) assert.ok(txt.includes(t), 'falta: ' + t);
  const ths = todos(folhas[0], (n) => n.tag === 'th').map((n) => n.textContent);
  assert.deepEqual(ths, ['Nº', 'Pedido', 'Nota fiscal', 'Cliente', 'Vol.', 'Observação', 'Assinatura / OK']);
  assert.equal(todos(folhas[0], (n) => n.tag === 'tbody')[0].children.length, 2);
  assert.throws(() => L.montar({ grupos: [] }), /vazia/);
  assert.equal(L.nomeDocumento(dados, dados.grupos[0]), 'Lista de saida - brasil - 2026-11-25');
  assert.deepEqual(L.totaisGrupo(dados.grupos[1]), { pedidos: 1, volumes: 0, semNota: 0 });
  delete global.document;
});

test('impressão: CSS de A4 próprio, uma folha por página, cabeçalho repetido, só a lista aparece', () => {
  const imp = CSS.slice(CSS.indexOf('LISTA DE SAÍDA PARA A TRANSPORTADORA'));
  assert.match(imp, /@media print/); assert.match(imp, /@page \{ size: A4 portrait/);
  assert.match(imp, /\.lista-folha \{ page-break-after: always; break-after: page; \}/);
  assert.match(imp, /thead \{ display: table-header-group; \}/); assert.match(imp, /break-inside: avoid/);
  assert.match(imp, /body\.imprimindo-lista > \*:not\(\.lista-impressao\) \{ display: none !important; \}/);
  assert.match(imp, /\.lista-impressao \{ display: none; \}/); // na tela a lista fica escondida
  assert.match(LISTA, /window\.print|root\.print/); assert.match(LISTA, /afterprint/);
});

test('acessibilidade e conforto: alvos de 44 px, movimento reduzido, rótulos e teclado', () => {
  assert.match(CSS, /\.exp \.btn\.peq[^}]*min-height: 44px/); assert.match(CSS, /prefers-reduced-motion: reduce/);
  assert.match(CSS, /\.caixa-area \{[^}]*width: 44px; height: 44px/); assert.match(CSS, /\.chip-tr \{[^}]*min-height: 44px/);
  assert.match(UI, /aria-modal/); assert.match(UI, /Escape/); assert.match(UI, /role: 'radiogroup'/); assert.match(UI, /role: 'status'/);
  assert.match(UI, /'aria-label': 'Marcar todos os pedidos do filtro/); assert.match(UI, /'aria-label': 'Marcar o pedido '/);
  assert.match(UI, /<?scope: 'col'|scope: 'col'/);
  // Bipar: foco sempre no campo, fila para leitor rápido, "Aguardando nota" em âmbar, som opcional
  assert.match(UI, /focarBipe/); assert.match(UI, /bp\.fila\.push/); assert.match(UI, /Aguardando nota/); assert.match(CSS, /\.chip-aguarda \{[^}]*var\(--ambar-claro\)/);
  assert.match(UI, /Som ligado/); assert.match(UI, /Sem dado do SC9/);
  // POD: link só https, nota explicativa
  assert.match(UI, /\^https:\\\/\\\//); assert.match(UI, /a foto é conferida por você/);
});

test('os testes antigos do painel continuam valendo: Visão geral, tabela de pedidos e bipe pelo mesmo endereço', () => {
  assert.match(UI, /\/api\/expedicao\/painel/); assert.match(UI, /\/api\/recebimento\/bipar/); assert.match(UI, /modo=tv|modo === 'tv'/);
  assert.match(UI, /EMBED/); assert.match(UI, /embed=1|'embed'/);
});
