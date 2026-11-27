// Onda 1 das vendedoras (front): regras puras do "Para quando", ZZ2 fora dos textos, caixa "como funciona" recolhida, nível sem padrão, lista única em Minhas,
// aba Armazéns da equipe e cuidados de segurança (nada de innerHTML com dado). O visual foi conferido no navegador (Playwright) contra servidor local.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..');
const ler = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const win = { Central: { icone: () => ({}), h: () => ({}) } }; win.window = win;
vm.runInNewContext(ler('solicitacoes-comum.js'), win);
const S = win.SolComum;
const plano = (x) => JSON.parse(JSON.stringify(x)); // objetos criados dentro do vm têm outro Object.prototype

test('Para quando (front): texto, conferência e corpo do envio', () => {
  assert.equal(S.paraQuandoTxt({ tipo: 'hoje_coleta', data: '2026-11-27' }), 'Hoje, antes da coleta (27/11)');
  assert.equal(S.paraQuandoTxt({ tipo: 'data', data: '2026-12-24' }), 'Até 24/12/2026');
  assert.equal(S.paraQuandoTxt({ tipo: 'constructor' }), ''); assert.equal(S.paraQuandoTxt(null), ''); assert.equal(S.paraQuandoTxt('x'), '');
  assert.equal(S.erroParaQuando({ tipo: '', data: '' }, '2026-11-27'), '', 'opcional: vazio vale');
  assert.match(S.erroParaQuando({ tipo: 'data', data: '' }, '2026-11-27'), /data/i);
  assert.match(S.erroParaQuando({ tipo: 'data', data: '2026-11-01' }, '2026-11-27'), /passado/);
  assert.equal(S.erroParaQuando({ tipo: 'amanha', data: '' }, '2026-11-27'), '');
  assert.equal(S.corpoParaQuando({ tipo: '', data: '' }), undefined);
  assert.deepEqual(plano(S.corpoParaQuando({ tipo: 'amanha', data: 'lixo' })), { tipo: 'amanha' }, 'só manda a data no tipo "data"');
  assert.deepEqual(plano(S.corpoParaQuando({ tipo: 'data', data: '2026-12-01' })), { tipo: 'data', data: '2026-12-01' });
  assert.deepEqual(plano(S.PARA_QUANDO).map((x) => x[0]), ['hoje_coleta', 'hoje_16h', 'amanha', 'data']);
});

test('ZZ2 não aparece como armazém em nenhum texto das vendedoras; não existe mais campo livre de armazém', () => {
  for (const f of ['solicitacoes-comum.js', 'solicitacoes-vend.js', 'vendedoras.js', 'vendedoras.html', 'solicitacoes-ui.js', 'armazens-ui.js', 'solicitacoes-store.js', 'armazens-vendedoras.js']) {
    const linhas = ler(f).split('\n').filter((l) => /ZZ2/.test(l) && !/zz2|PADRAO|erroDoArmazem|ZZ2'/.test(l) || /Ex\.: ZZ2|placeholder.*ZZ2|ex\.: ZZ2/i.test(l));
    assert.deepEqual(linhas, [], f + ' ainda cita ZZ2 como exemplo de armazém');
  }
  const vend = ler('solicitacoes-vend.js');
  assert.ok(!/Outro armazém|Sigla do armazém/.test(vend), 'sem campo livre');
  assert.match(vend, /\/api\/vendedoras\/armazens/, 'a lista vem do servidor');
});

test('"Como funciona" é <details> recolhido por padrão em Prioridade, Avisar e Solicitar e lembra se foi aberto', () => {
  const v = ler('vendedoras.js');
  assert.match(v, /h\('details', \{ class: 'processo como-recolhido'/);
  assert.match(v, /open: Boolean\(estado\.comoAberto\[modo\]\)/);
  assert.match(v, /faixaProcesso\('prioridade'\)/); assert.match(v, /faixaProcesso\('avisar'\)/); assert.match(v, /faixa: \(modo\) => faixaProcesso\(modo\)/);
  assert.match(ler('solicitacoes-vend.js'), /cfg\.faixa\('solicitar'\)/);
});

test('Prioridade: nenhum nível vem marcado; exige escolher e leva o "Para quando"', () => {
  const v = ler('vendedoras.js');
  assert.match(v, /f: \{ pedido: '', nivel: '',/);
  assert.match(v, /if \(!f\.nivel\) f\.erro|else if \(!f\.nivel\)/);
  assert.ok(!/f\.nivel = 'normal'/.test(v), 'não volta para Normal depois de enviar');
  assert.match(v, /paraQuando: root\.SolComum\.corpoParaQuando\(f\.pq\)/);
});

test('Minhas: lista única (prioridades + avisos + solicitações da Central) com filtro Abertas/Concluídas/Acompanho; Exportar inclui a Central; formato antigo continua acessível', () => {
  const v = ler('vendedoras.js');
  assert.match(v, /function itensMinhas/); assert.match(v, /SV\.cartao\(l\)/);
  for (const t of ['Abertas', 'Concluídas', 'Acompanho']) assert.ok(v.includes("'" + t + "'"), t);
  assert.match(v, /solic: \(\) => C\.baixarCsv\(C\.nomeArquivo\('minhas-solicitacoes-a-logistica'\)/);
  assert.match(v, /function telaMinhasAntiga/); assert.match(v, /Abrir no formato antigo/);
});

test('Solicitar: consulta o pedido antes de enviar e mostra a etapa e o aviso; segundo toque se já andou', () => {
  const s = ler('solicitacoes-vend.js');
  assert.match(s, /async function consultarPedido/); assert.match(s, /r\.avisoEtapa/); assert.match(s, /Enviar mesmo assim/);
  assert.match(s, /select|'select'/);
});

test('aba Armazéns da equipe: arquivo servido, carregado pela página, ligado em prioridades.js; sem innerHTML com dado em nenhum arquivo novo', () => {
  assert.match(ler('server.js'), /SERVABLE\.add\("armazens-ui\.js"\)/);
  assert.match(ler('prioridades.html'), /armazens-ui\.js/);
  assert.match(ler('prioridades.js'), /\['armazens', 'predio', 'Armazéns'\]/); assert.match(ler('prioridades.js'), /ArmazensUI\.tela\(ctxSolic\)/);
  for (const f of ['armazens-ui.js', 'solicitacoes-vend.js', 'solicitacoes-comum.js', 'vendedoras.js']) assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(ler(f)), f + ' usa HTML cru');
  assert.match(ler('armazens-ui.js'), /provisória/i);
});
