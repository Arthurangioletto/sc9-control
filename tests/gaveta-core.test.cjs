const { test } = require('node:test');
const assert = require('node:assert/strict');
const G = require('../gaveta-core.js');

// Planilhas no formato do Protheus: cabeçalhos B8_*, ZZ2 e SB1.
const sheets = {
  Planilha1: [
    ['B8_FILIAL', 'B8_PRODUTO', 'B8_LOCAL', 'data validade', 'saldo', 'B8_EMPENHO', 'lote', 'D_E_L_E_T_'],
    ['01', 'P1', '01', '20270501', 10, 2, 'L1', ''],
    ['01', 'P1', '01', 46143, 5, 0, 'L2', ''],        // serial do Excel = 2026-05-01
    ['01', 'P1', '59', '01/08/2027', 7, 0, 'L1', ''],
    ['01', 'P1', 'ES', '', 3, 0, 'L3', ''],
    ['01', 'P1', '01', '', 0, 0, 'L0', ''],            // sem saldo: ignora
    ['01', 'P1', '01', '', 4, 0, 'LX', '*'],           // excluída no Protheus: ignora
    ['01', 'P2', '01', '', 9, 0, '', ''],              // sem lote: ignora
    ['01', 'P2', '20', '2026-12-31', 6, 0, 'L9', '']
  ],
  ZZ2: [
    ['Filial', 'Armazem', 'Endereco', 'Produto', 'Lote'],
    ['01', '01', 'ab1', 'P1', ''],
    ['01', '01', 'AB1', 'P2', ''],
    ['01', '01', 'C7', 'P1', ''],
    ['01', '01', 'AB1', 'P1', '']                      // repetido: não duplica
  ],
  SB1: [['Codigo', 'Descricao'], ['P1', 'IMPLANTE A'], ['P2', 'PARAFUSO B']]
};
const book = { SheetNames: Object.keys(sheets), Sheets: sheets };
const xlsx = { utils: { sheet_to_json: rows => rows } };

test('reconhece SB8, ZZ2 e SB1 pelos cabeçalhos e só guarda saldo positivo não excluído', () => {
  const found = G.readWorkbook(book, xlsx);
  assert.deepEqual(Object.keys(found).sort(), ['sb1', 'sb8', 'zz2']);
  assert.equal(found.sb8.rows.length, 5);
  assert.deepEqual(found.sb8.rows[0], ['1', 'P1', '1', 'L1', 10, 2, '2027-05-01']);
  assert.equal(found.sb8.rows[1][6], '2026-05-01');
  assert.equal(found.sb8.rows[3][6], '');
  assert.equal(found.zz2.rows[0][2], 'AB1');
  assert.equal(found.sb1.rows.length, 2);
});

test('cada endereço do ZZ2 vira uma gaveta e mostra saldo daqui e de outros armazéns', () => {
  const found = G.readWorkbook(book, xlsx);
  const ctx = G.makeContext(found.zz2.rows, G.cleanSb1(found.sb1.rows), found.sb8.rows);
  assert.deepEqual([...ctx.gavetas.keys()].sort(), ['1|1|AB1', '1|1|C7']);
  const detail = G.detail(ctx, '1|1|AB1');
  assert.deepEqual(detail.itens.map(item => item.produto), ['P1', 'P2']);
  const p1 = detail.itens[0];
  assert.equal(p1.descricao, 'IMPLANTE A');
  assert.deepEqual(p1.lotes.map(l => l.lote), ['L2', 'L1'], 'FEFO: validade mais próxima primeiro');
  assert.deepEqual(p1.outros.map(l => [l.arm, l.lote, l.saldo]), [['59', 'L1', 7], ['ES', 'L3', 3]]);
  assert.deepEqual(p1.enderecos.map(e => e.endereco + (e.aqui ? '*' : '')), ['AB1*', 'C7'], 'mostra todos os endereços cadastrados do produto');
  const p2 = detail.itens[1];
  assert.equal(p2.semSaldo, true, 'P2 não tem saldo no 01, só no 20');
  assert.deepEqual(p2.outros.map(l => l.arm), ['20']);
});

test('lote bipado mostra onde está o saldo em todos os armazéns', () => {
  const found = G.readWorkbook(book, xlsx);
  const ctx = G.makeContext(found.zz2.rows, G.cleanSb1(found.sb1.rows), found.sb8.rows);
  assert.deepEqual(G.findLote(ctx, 'l1').map(r => r.arm).sort(), ['1', '59']);
  assert.equal(G.findLote(ctx, 'l1')[0].enderecos.length, 2);
  assert.deepEqual(G.findLote(ctx, 'nao-existe'), []);
});

test('situação da validade usa as faixas de cor', () => {
  const today = '2026-11-17';
  assert.equal(G.validity('2026-11-10', today).tone, 'red');
  assert.equal(G.validity('2026-11-17', today).key, 'hoje');
  assert.equal(G.validity('2026-12-01', today).tone, 'orange');
  assert.equal(G.validity('2027-01-15', today).tone, 'yellow');
  assert.equal(G.validity('2027-06-01', today).tone, 'green');
  assert.equal(G.validity('', today).key, 'sem');
});

test('o SB8 vale 24 horas e depois some', () => {
  const t0 = Date.parse('2026-11-17T08:00:00Z');
  assert.equal(G.baseState({ updatedAt: new Date(t0).toISOString() }, t0 + 23.9 * 3600000).expirada, false);
  assert.equal(G.baseState({ updatedAt: new Date(t0).toISOString() }, t0 + 24 * 3600000).expirada, true);
  assert.equal(G.baseState(null).presente, false);
});

test('a análise só fecha com todos os produtos conferidos e valida os dados', () => {
  const found = G.readWorkbook(book, xlsx);
  const ctx = G.makeContext(found.zz2.rows, G.cleanSb1(found.sb1.rows), found.sb8.rows);
  const gaveta = ctx.gavetas.get('1|1|AB1');
  const item = (produto, extra = {}) => ({ produto, conferido: true, lotes: [], transferir: [], ...extra });
  assert.throws(() => G.cleanAnalysis({ itens: [item('P1')] }, gaveta), /Faltam produtos/);
  assert.throws(() => G.cleanAnalysis({ itens: [item('P1'), item('P2', { conferido: false })] }, gaveta), /conferidos/);
  assert.throws(() => G.cleanAnalysis({ itens: [item('P1'), item('OUTRO')] }, gaveta), /não pertence/);
  assert.throws(() => G.cleanAnalysis({ itens: [item('P1', { transferir: [{ arm: '59', lote: 'L1', qtd: 0 }] }), item('P2')] }, gaveta), /positiva/);
  const ok = G.cleanAnalysis({ itens: [item('P1', { lotes: [{ lote: 'l1', saldo: 10, validadeSistema: '2027-05-01', validadeNova: '2027-06-01' }], transferir: [{ arm: '59', lote: 'l1', qtd: 7, obs: 'trazer' }] }), item('P2', { semSaldo: true })], extras: [{ lote: 'zz9', obs: 'sem cadastro' }] }, gaveta);
  const resumo = G.summarize(ok.itens, '2026-11-17');
  assert.deepEqual(resumo, { produtos: 2, semSaldo: 1, validadesAlteradas: 1, vencidos: 0, transferencias: 1 });
  assert.equal(ok.extras[0].lote, 'ZZ9');
});

test('o painel conta gavetas analisadas e as que faltam, sem nunca esquecer o histórico', () => {
  const gavetas = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const rec = (id, dia, por, extra = {}) => ({ gaveta: { id }, dia, em: dia + 'T12:00:00Z', por, duracaoSeg: 120, resumo: { vencidos: 0, transferencias: 0 }, ...extra });
  const records = [rec('a', '2026-11-16', 'ana'), rec('a', '2026-11-17', 'ana'), rec('b', '2026-11-17', 'bia'), rec('velha', '2026-11-10', 'ana')];
  const panel = G.dashboard(gavetas, records, '2026-11-17');
  assert.equal(panel.total, 3);
  assert.equal(panel.analisadas, 2);
  assert.equal(panel.faltam, 1);
  assert.equal(panel.hoje, 2);
  assert.equal(panel.foraDoZz2, 1);
  assert.equal(panel.porDia.length, 30);
  assert.deepEqual(panel.porDia.slice(-2).map(day => day.gavetas), [1, 2]);
  assert.deepEqual(panel.porUsuarioHoje.map(u => u.usuario).sort(), ['ana', 'bia']);
  assert.equal(panel.duracaoMediaSeg, 120);
});
