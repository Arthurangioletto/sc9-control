// Central de solicitações (front-end): regras puras da transferência e dos tipos (carregadas num "window" falso), ganchos aditivos nas páginas
// existentes, arquivos servidos e cuidados de segurança (nada de innerHTML com dado do servidor). O visual foi conferido no navegador contra o mock.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..');
const ler = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
function carregarComum() {
  const win = { Central: { icone: () => ({}), h: () => ({}) } };
  win.window = win;
  vm.runInNewContext(ler('solicitacoes-comum.js'), win);
  return win.SolComum;
}
const S = carregarComum();
const origem = { filial: 'Cambuci', armazem: '01' }, destino = { filial: 'Tambore', armazem: '01' };
const prod = (extra) => Object.assign({ codigo: '10.100', descricao: 'Cabo de Aço 8 mm', saldoDisponivel: true, saldoTotal: 49, saldos: [{ filial: 'Cambuci', armazem: '01', saldo: 42 }, { filial: 'Tambore', armazem: '01', saldo: 7 }], lotes: [{ lote: 'L1', saldo: 30, filial: 'Cambuci', armazem: '01', validade: '2027-03-31' }, { lote: 'L2', saldo: 12, filial: 'Cambuci', armazem: '01' }, { lote: 'L9', saldo: 7, filial: 'Tambore', armazem: '01' }] }, extra);

test('tipo da transferência: mesma filial com armazéns diferentes é entre armazéns; origem igual ao destino é recusada', () => {
  assert.equal(S.tipoDaTransf(origem, { filial: 'Cambuci', armazem: '02' }), 'entre_armazens');
  assert.equal(S.tipoDaTransf(origem, destino), 'entre_filiais');
  assert.equal(S.mesmoLocal(origem, { filial: 'cambuci', armazem: '1' }), true, 'compara sem caixa e com "1" = "01"');
  assert.equal(S.mesmoLocal({ filial: 'Tamboré', armazem: '01' }, destino), true, 'nome com acento = chave');
  assert.match(S.validarTransf({ origem, destino: origem, itens: [], prazo: '', motivo: '' }, '2026-01-01'), /diferentes/);
});

test('saldo e alerta: usa o lote escolhido ou o saldo da origem; só avisa, nunca decide por ela', () => {
  const p = prod();
  assert.equal(S.saldoNoLocal(p, origem), 42);
  assert.equal(S.saldoNoLocal(p, destino), 7);
  assert.deepEqual(S.lotesNoLocal(p, origem).map((l) => l.lote), ['L1', 'L2'], 'só os lotes da origem, validade mais próxima primeiro');
  assert.equal(S.saldoDoItem({ produto: p, lote: 'L1', qt: 31 }, origem), 30);
  assert.equal(S.acimaDoSaldo({ produto: p, lote: 'L1', qt: 31 }, origem), true);
  assert.equal(S.acimaDoSaldo({ produto: p, lote: '', qt: 42 }, origem), false);
  assert.equal(S.acimaDoSaldo({ produto: p, lote: '', qt: 43 }, origem), true);
  const sem = prod({ saldoDisponivel: false, saldoTotal: null, saldos: [], lotes: [] });
  assert.equal(S.saldoDoItem({ produto: sem, lote: '', qt: 5 }, origem), null, 'sem saldo carregado: não alerta');
  assert.equal(S.acimaDoSaldo({ produto: sem, lote: '', qt: 99999 }, origem), false);
  assert.equal(S.saldoNoLocal(prod({ saldos: [{ filial: 'BH', armazem: '01', saldo: 3 }], lotes: [] }), origem), 0, 'tem saldo carregado, mas nada nessa origem');
});

test('validação da transferência: 1 a 30 itens, quantidade inteira 1..99999, sem item repetido, prazo não pode ser passado', () => {
  const ok = { origem, destino, itens: [{ produto: prod(), lote: 'L1', qt: '10' }], prazo: '', motivo: '' };
  assert.equal(S.validarTransf(ok, '2026-05-01'), '');
  assert.match(S.validarTransf(Object.assign({}, ok, { itens: [] }), '2026-05-01'), /1 a 30/);
  assert.match(S.validarTransf(Object.assign({}, ok, { itens: Array(31).fill(ok.itens[0]) }), '2026-05-01'), /1 a 30/);
  assert.match(S.validarTransf(Object.assign({}, ok, { itens: [{ produto: prod(), lote: '', qt: '0' }] }), '2026-05-01'), /quantidade/);
  assert.match(S.validarTransf(Object.assign({}, ok, { itens: [{ produto: prod(), lote: '', qt: '100000' }] }), '2026-05-01'), /quantidade/);
  assert.match(S.validarTransf(Object.assign({}, ok, { itens: [{ produto: null, lote: '', qt: '1' }] }), '2026-05-01'), /escolha a peça/);
  assert.match(S.validarTransf(Object.assign({}, ok, { itens: [ok.itens[0], ok.itens[0]] }), '2026-05-01'), /repetido/);
  assert.match(S.validarTransf(Object.assign({}, ok, { prazo: '2026-04-30' }), '2026-05-01'), /prazo/i);
  assert.match(S.validarTransf(Object.assign({}, ok, { origem: { filial: '', armazem: '01' } }), '2026-05-01'), /origem/);
});

test('corpo do envio: só código, lote, quantidade e locais; a descrição e o saldo NÃO vão (o servidor preenche)', () => {
  const corpo = S.corpoTransf({ origem, destino, itens: [{ produto: prod(), lote: 'L1', qt: '40' }, { produto: prod({ codigo: '20.200' }), lote: '', qt: '3' }], prazo: '2026-06-01', motivo: '  Reposição  ' });
  assert.deepEqual(JSON.parse(JSON.stringify(corpo)), { itens: [{ produto: '10.100', qt: 40, lote: 'L1' }, { produto: '20.200', qt: 3 }], origem, destino, prazo: '2026-06-01', motivo: 'Reposição' });
  assert.ok(!JSON.stringify(corpo).includes('descricao') && !JSON.stringify(corpo).includes('saldo'));
});

test('frase de revisão e resumos em português simples', () => {
  const t = { origem, destino, itens: [{ qt: 100 }, { qt: 20 }, { qt: 1 }] };
  assert.equal(S.textoRevisao(t), 'Você está pedindo transferir 3 produtos, 121 peças, de Cambuci (armazém 01) para Tamboré (armazém 01).');
  assert.equal(S.minTxt(30), '30 min'); assert.equal(S.minTxt(240), '4 h'); assert.equal(S.minTxt(1500), '1 dia 1 h');
  assert.equal(S.pedidoValido('12-3'), '', '4 dígitos mínimos'); assert.equal(S.pedidoValido('123 456'), '123456'); assert.equal(S.pedidoValido('12345678901'), '');
  const l = { tipo: 'transferencia_peca', dados: { itens: [{ qt: 10 }], origem: { filial: 'Cambuci', nome: 'Cambuci', armazem: '01' }, destino: { filial: 'Tambore', nome: 'Tamboré', armazem: '02' } } };
  assert.equal(S.resumo(l), '1 produto · 10 peças · Cambuci 01 para Tamboré 02');
  assert.equal(S.etapaTom({ aTempo: true }), 'ok'); assert.equal(S.etapaTom({ etapa: 'nao_achado' }), 'info'); assert.equal(S.etapaTom({ etapa: 'separado' }), 'tarde');
});

test('tabela de tipos igual à do servidor (prazos, área e pedido obrigatório), inclusive os tipos novos', () => {
  const SS = require('../solicitacoes-store.js');
  const antigos = { cancelar_pedido: [true, 30], segurar_pedido: [true, 60], transferencia_peca: [false, 240], consulta_estoque: [false, 60], alterar_pedido: [true, 120], nota_fiscal: [true, 120], outro: [false, 240] };
  for (const [k, [pedido, sla]] of Object.entries(antigos)) { assert.equal(S.TIPOS[k].pedido, pedido, k); assert.equal(S.TIPOS[k].sla, sla, k); }
  assert.deepEqual(Object.keys(S.TIPOS).sort(), SS.TIPOS_IDS.slice().sort(), 'a tela conhece exatamente os tipos do servidor');
  for (const k of SS.TIPOS_IDS) { assert.equal(S.TIPOS[k].sla, SS.TIPOS[k].sla, k + ' sla'); assert.equal(S.TIPOS[k].area, SS.TIPOS[k].area, k + ' área'); assert.equal(S.TIPOS[k].pedido, SS.TIPOS[k].pedido, k + ' pedido'); assert.equal(Boolean(S.TIPOS[k].lote), Boolean(SS.TIPOS[k].lote), k + ' lote'); }
});

test('ganchos nas páginas existentes são só aditivos e os arquivos novos entram na ordem certa', () => {
  const vendHtml = ler('vendedoras.html'), prioHtml = ler('prioridades.html');
  assert.ok(vendHtml.indexOf('/central-ui.js') < vendHtml.indexOf('/solicitacoes-comum.js') && vendHtml.indexOf('/solicitacoes-vend.js') < vendHtml.indexOf('/vendedoras.js'));
  assert.ok(prioHtml.indexOf('/central-ui.js') < prioHtml.indexOf('/solicitacoes-comum.js') && prioHtml.indexOf('/solicitacoes-ui.js') < prioHtml.indexOf('/prioridades.js'));
  assert.ok(vendHtml.includes('/solicitacoes.css') && prioHtml.includes('/solicitacoes.css'));
  const vend = ler('vendedoras.js'), prio = ler('prioridades.js');
  assert.ok(vend.includes("'solicitar'") && vend.includes('SolicitacoesVend') && vend.includes('idsSolic'));
  assert.ok(prio.includes("['solic'") && prio.includes("['dash'") && prio.includes('SolicitacoesUI'));
  for (const f of ['vendedoras.js', 'prioridades.js', 'vendedoras.html', 'prioridades.html']) assert.ok(!ler(f).includes('\r'), f + ' continua em LF');
  const server = ler('server.js');
  for (const f of ['solicitacoes-ui.js', 'solicitacoes-comum.js', 'solicitacoes-vend.js', 'solicitacoes.css']) assert.ok(server.includes('SERVABLE.add("' + f + '")'), f + ' é servido');
});

test('segurança do front: dados do servidor só entram como texto (sem innerHTML/outerHTML/insertAdjacentHTML/eval)', () => {
  for (const f of ['solicitacoes-comum.js', 'solicitacoes-vend.js', 'solicitacoes-ui.js']) {
    const s = ler(f);
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(s), f);
    assert.ok(!/\bfetch\(/.test(s) || f === 'x', f + ' fala com o servidor só pelas funções entregues pelas páginas');
  }
});

test('a busca de produto cancela a requisição antiga, espera ~250 ms e a lista tem teclado e papéis de acessibilidade', () => {
  const v = ler('solicitacoes-vend.js');
  assert.ok(/AbortController/.test(v) && /\.abort\(\)/.test(v) && /\}, 250\)/.test(v));
  assert.ok(/role: 'combobox'/.test(v) && /role: 'listbox'/.test(v) && /role: 'option'/.test(v) && /ArrowDown/.test(v) && /Escape/.test(v));
  assert.ok(/'\/api\/vendedoras\/produtos\?q='/.test(v));
});

test('dashboard: SVG/CSS próprio (sem biblioteca), legenda com padrões (não só cor) e impressão', () => {
  const ui = ler('solicitacoes-ui.js'), css = ler('solicitacoes.css');
  assert.ok(!/https?:\/\//.test(ui.replace('http://www.w3.org/2000/svg', '')) && !/https?:\/\//.test(css));
  assert.ok(/pattern/.test(ui) && /sol-legenda/.test(ui) && /@media print/.test(css));
  assert.ok(/aria-label': 'Gráfico de barras empilhadas/.test(ui), 'gráfico descrito para leitor de tela');
});
