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
  const ok = G.cleanAnalysis({ itens: [item('P1', { lotes: [{ lote: 'l1', saldo: 10, validadeSistema: '2027-05-01', validadeNova: '2027-06-01', analisado: true }], transferir: [{ arm: '59', lote: 'l1', qtd: 7, obs: 'trazer' }] }), item('P2', { semSaldo: true })], extras: [{ lote: 'zz9', obs: 'sem cadastro' }] }, gaveta);
  const resumo = G.summarize(ok.itens, '2026-11-17');
  assert.deepEqual(resumo, { produtos: 2, semSaldo: 1, validadesAlteradas: 1, vencidos: 0, transferencias: 1, lotes: 1, lotesAnalisados: 1, lotesContados: 0, divergencias: 0 });
  assert.equal(ok.itens[0].lotes[0].analisado, true);
  const semMarca = G.cleanAnalysis({ itens: [item('P1', { lotes: [{ lote: 'l1', saldo: 10, validadeSistema: '2027-05-01' }] }), item('P2', { semSaldo: true })] }, gaveta);
  assert.equal(semMarca.itens[0].lotes[0].analisado, false);
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

// ---------- planilha gigante: leitura em fluxo (zip + XML do Protheus/openpyxl) ----------
const zlib = require('node:zlib');
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) { c = (crc ^ buf[i]) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function makeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content, method] of files) {
    const raw = Buffer.from(content), data = method === 0 ? raw : zlib.deflateRawSync(raw), nm = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(raw), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nm.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(raw), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nm.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nm, data); centrals.push(central, nm);
    offset += 30 + nm.length + data.length;
  }
  const dir = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, dir, end]));
}
const inline = (ref, value) => `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${value}</t></is></c>`;
const num = (ref, value) => `<c r="${ref}" t="n"><v>${value}</v></c>`;
const sheetXml = rows => `<worksheet><sheetData>${rows.join('')}</sheetData></worksheet>`;

test('leitura em fluxo acha o SB8 numa aba grande, ignora colunas extras e linhas sem saldo', async () => {
  const cols = ['A', 'B', 'C', 'D', 'E', 'F'];
  const rows = [`<row r="1">${['B8_FILIAL', 'B8_PRODUTO', 'B8_LOCAL', 'data validade', 'saldo', 'lote'].map((v, i) => inline(cols[i] + 1, v)).join('')}</row>`];
  for (let i = 0; i < 3000; i++) {
    const n = i + 2;
    rows.push(`<row r="${n}">${num('A' + n, 1)}${inline('B' + n, 'P' + (i % 50) + '&amp;X')}${num('C' + n, i % 2 ? 1 : 59)}${num('D' + n, 20270105)}${num('E' + n, i % 3 ? 4 : 0)}${i % 7 ? num('F' + n, 1000 + i) : inline('F' + n, 'ab' + i)}</row>`);
    if (i === 10) rows.push('<row r="9999"/>');
  }
  const zip = makeZip([
    ['xl/worksheets/sheet1.xml', sheetXml(rows), 8],
    ['xl/worksheets/sheet2.xml', sheetXml([`<row r="1">${inline('A1', 'Outro')}${inline('B1', 'Qualquer')}</row>`, `<row r="2">${inline('A2', 'x')}</row>`]), 0]
  ]);
  const progress = [];
  const found = await G.readWorkbookStream(zip, fraction => progress.push(fraction));
  assert.deepEqual(Object.keys(found), ['sb8']);
  assert.equal(found.sb8.stats.lidas, 3000);
  const valid = Array.from({ length: 3000 }, (_, i) => i).filter(i => i % 3);
  assert.equal(found.sb8.rows.length, valid.length);
  const first = found.sb8.rows[0];           // i = 1 → saldo 4, armazém 1
  assert.deepEqual(first, ['1', 'P1&X', '1', '1001', 4, 0, '2027-01-05']);
  assert.deepEqual(found.sb8.rows.find(row => row[3] === 'AB7'), ['1', 'P7&X', '1', 'AB7', 4, 0, '2027-01-05']);   // texto inline vira maiúsculo e &amp; é decodificado
  assert.equal(found.sb8.rows.find(row => row[3] === 'AB0'), undefined);      // i=0 tem saldo 0
  assert.ok(progress.length > 0 && progress.every(f => f >= 0 && f <= 1));
});

test('leitura em fluxo lê ZZ2 e SB1 com textos compartilhados', async () => {
  const shared = '<sst><si><t>Endereco</t></si><si><t>Produto</t></si><si><t>AB1</t></si><si><t>P1</t></si><si><t>Codigo</t></si><si><t>Descricao</t></si><si><r><t>IMPLANTE </t></r><r><t>A</t></r></si></sst>';
  const s = (ref, i) => `<c r="${ref}" t="s"><v>${i}</v></c>`;
  const zz2 = sheetXml([`<row r="1">${s('A1', 0)}${s('B1', 1)}</row>`, `<row r="2">${s('A2', 2)}${s('B2', 3)}</row>`]);
  const sb1 = sheetXml([`<row r="1">${s('A1', 4)}${s('B1', 5)}</row>`, `<row r="2">${s('A2', 3)}${s('B2', 6)}</row>`]);
  const zip = makeZip([['xl/sharedStrings.xml', shared, 8], ['xl/worksheets/sheet1.xml', zz2, 8], ['xl/worksheets/sheet2.xml', sb1, 8]]);
  const found = await G.readWorkbookStream(zip);
  assert.deepEqual(found.zz2.rows, [['', '', 'AB1', 'P1', '', '']]);
  assert.deepEqual(found.sb1.rows, [['P1', 'IMPLANTE A', '', '']]);
});

test('leitura em fluxo recusa arquivo que não é xlsx', async () => {
  await assert.rejects(() => G.readWorkbookStream(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24])), /xlsx/);
});

test('endereços ZARM são armários, o resto é gaveta', () => {
  assert.equal(G.isArmario('ZARM03'), true);
  assert.equal(G.isArmario(' zarm11 '), true);
  assert.equal(G.isArmario('AA06'), false);
  assert.equal(G.isArmario('ZA01'), false);
});

test('armazéns de consulta seguem a ordem 01, 02, 59, 30, 20, 25, ES, BH, DF, RJ, CE, ET, BT, RT, CT, DT; o resto vai depois', () => {
  assert.deepEqual(G.ARM_PRIORITY, ['1', '2', '59', '30', '20', '25', 'ES', 'BH', 'DF', 'RJ', 'CE', 'ET', 'BT', 'RT', 'CT', 'DT']);
  assert.ok(G.armRank('01') < G.armRank('02') && G.armRank('02') < G.armRank('59') && G.armRank('25') < G.armRank('es'));
  assert.ok(G.armRank('DT') < G.armRank('26'));
  const zz2 = [['1', '1', 'AA01', 'P1', '', '']];
  const sb8 = [
    ['1', 'P1', '26', 'L1', 5, 0, '2030-01-01'], ['1', 'P1', 'DT', 'L1', 5, 0, '2030-01-01'], ['1', 'P1', 'ES', 'L1', 5, 0, '2030-01-01'],
    ['1', 'P1', '2', 'L1', 5, 0, '2030-01-01'], ['1', 'P1', '59', 'L1', 5, 0, '2030-01-01'], ['1', 'P1', '1', 'L1', 5, 0, '2030-01-01']
  ];
  const ctx = G.makeContext(zz2, {}, sb8);
  const detail = G.detail(ctx, '1|1|AA01');
  assert.deepEqual(detail.itens[0].lotes.map(l => l.arm), ['1']);
  assert.deepEqual(detail.itens[0].outros.map(l => l.arm), ['2', '59', 'ES', 'DT', '26']);
  assert.deepEqual(G.findLote(ctx, 'L1').map(row => row.arm), ['1', '2', '59', 'ES', 'DT', '26']);
  assert.deepEqual(G.findLote(ctx, 'NAOEXISTE'), []);
});

test('código de barras/QR da gaveta: aceita o código puro, com prefixo, dentro de uma URL ou com 1 caractere extra', () => {
  const codes = ['AA01', 'AA02', 'ZARM03'];
  assert.equal(G.matchGaveta('aa01', codes), 'AA01');
  assert.equal(G.matchGaveta(' AA02\n', codes), 'AA02');
  assert.equal(G.matchGaveta('GAVETA: ZARM03', codes), 'ZARM03');
  assert.equal(G.matchGaveta('https://sc9-control.onrender.com/g/aa01?x=1', codes), 'AA01');
  assert.equal(G.matchGaveta('AA-01', codes), 'AA01');
  assert.equal(G.matchGaveta('AA03N', ['AA03', 'AA02']), 'AA03');   // dígito verificador do Code 39
  assert.equal(G.matchGaveta('AA01A', ['AA01', 'A01A']), '');     // ambíguo: não chuta
  assert.equal(G.matchGaveta('XYZ', codes), '');
  assert.equal(G.matchGaveta('', codes), '');
});

test('exportação traz o lote em todas as linhas da aba Lotes e se foi analisado', () => {
  const registro = {
    dia: '2026-11-17', em: '2026-11-17T12:30:00Z', por: 'ana', duracaoSeg: 120, obs: '',
    gaveta: { id: '1|1|AB1', codigo: 'AB1', arm: '1', armario: '' },
    resumo: { produtos: 3, lotes: 2, lotesAnalisados: 1, semSaldo: 1, validadesAlteradas: 1, vencidos: 0, transferencias: 1 },
    itens: [
      { produto: 'P1', descricao: 'IMPLANTE A', semSaldo: false, obs: '', transferir: [{ arm: '59', lote: 'L9', qtd: 4, obs: 'trazer' }],
        lotes: [{ lote: 'L1', saldo: 10, validadeSistema: '2027-05-01', validadeNova: '2027-06-01', analisado: true }, { lote: 'L2', saldo: 3, validadeSistema: '2026-11-01', validadeNova: '', analisado: false }] },
      { produto: 'P2', descricao: 'PARAFUSO', semSaldo: true, obs: 'sem saldo', transferir: [], lotes: [] }
    ],
    extras: [{ produto: 'P7', lote: 'ZZ9', obs: 'sem cadastro' }]
  };
  const { lotes, gavetas, transferir } = G.exportRows([registro], iso => '09:30');
  const head = lotes[0], col = name => head.indexOf(name);
  assert.ok(col('Lote') >= 0 && col('Analisado') >= 0);
  const byType = type => lotes.slice(1).filter(row => row[col('Tipo')] === type);
  assert.deepEqual(byType('Lote da gaveta').map(row => [row[col('Lote')], row[col('Analisado')], row[col('Validade informada')], row[col('Saldo')]]), [['L1', 'Sim', '01/06/2027', 10], ['L2', 'Não', '', 3]]);
  assert.match(byType('Lote da gaveta')[1][col('Situação da validade')], /Vencido há 16d/);
  assert.deepEqual(byType('Transferir p/ 01').map(row => [row[col('Lote')], row[col('Armazém')], row[col('Qtd a transferir')]]), [['L9', '59', 4]]);
  assert.deepEqual(byType('Lote fora do cadastro').map(row => row[col('Lote')]), ['ZZ9']);
  assert.equal(byType('Sem saldo no armazém').length, 1);
  assert.equal(gavetas[1][gavetas[0].indexOf('Lotes analisados')], 1);
  assert.equal(gavetas[1][gavetas[0].indexOf('Hora')], '09:30');
  assert.deepEqual(transferir[1].slice(4, 8), ['L9', '59', '01', 4]);
  assert.ok(lotes.slice(1).every(row => row.length === head.length));
});

test('contagem física: achou mais que o saldo do armazém da gaveta e a diferença vem de outros armazéns, em ordem de prioridade', () => {
  const outros = [{ arm: '59', lote: 'L1', saldo: 1, validade: '2027-01-01' }, { arm: 'ES', lote: 'L1', saldo: 5 }, { arm: '30', lote: 'L1', saldo: 4 }];
  // Exemplo do operador: achou 2, o sistema tem 1 no 01 e 1 no 59
  const um = G.reconcile(2, 1, outros);
  assert.equal(um.status, 'outro-armazem');
  assert.deepEqual(um.plano.map(p => [p.arm, p.qtd]), [['59', 1]]);
  assert.equal(um.dif, 1); assert.equal(um.restante, 0);
  // Pede mais do que o 59 tem: continua nos próximos armazéns (59, 30, ES)
  const dez = G.reconcile(10, 1, outros);
  assert.deepEqual(dez.plano.map(p => [p.arm, p.qtd]), [['59', 1], ['30', 4], ['ES', 4]]);
  assert.equal(dez.status, 'outro-armazem');
  // Nenhum armazém cobre: sobra sem saldo no sistema
  const sobra = G.reconcile(20, 1, outros);
  assert.equal(sobra.status, 'sobra'); assert.equal(sobra.restante, 9); assert.equal(sobra.plano.length, 3);
  assert.equal(G.reconcile(3, 3, outros).status, 'confere');
  const abaixo = G.reconcile(1, 3, outros);
  assert.equal(abaixo.status, 'abaixo'); assert.equal(abaixo.dif, -2); assert.deepEqual(abaixo.plano, []);
  // Lote só existe em outro armazém (saldo 0 na gaveta)
  assert.deepEqual(G.reconcile(2, 0, [{ arm: '59', saldo: 5 }]).plano.map(p => [p.arm, p.qtd]), [['59', 2]]);
  assert.equal(G.reconcile('', 1, outros), null);
  assert.equal(G.reconcile(-1, 1, outros), null);
  assert.equal(G.reconcile(0.3, 0.1, [{ arm: '59', saldo: 0.2 }]).status, 'outro-armazem');
});

test('a análise guarda a contagem por lote, os lotes achados só em outro armazém e a quantidade física dos lotes fora do cadastro', () => {
  const found = G.readWorkbook(book, xlsx);
  const ctx = G.makeContext(found.zz2.rows, G.cleanSb1(found.sb1.rows), found.sb8.rows);
  const gaveta = ctx.gavetas.get('1|1|AB1');
  const item = (produto, extra = {}) => ({ produto, conferido: true, lotes: [], transferir: [], ...extra });
  const ok = G.cleanAnalysis({
    itens: [item('P1', { lotes: [{ lote: 'l1', saldo: 1, analisado: true, contagem: { fisico: 2, saldo: 1, status: 'outro-armazem', restante: 0 } }, { lote: 'l2', saldo: 5, contagem: { fisico: '', status: 'confere' } }],
      achados: [{ lote: 'lx', contagem: { fisico: 3, saldo: 0, status: 'sobra', restante: 3 } }, { lote: 'ly', contagem: null }],
      transferir: [{ arm: '59', lote: 'l1', qtd: 1 }] }), item('P2')],
    extras: [{ lote: 'ZZ9', produto: 'P7', fisico: '4', sistema: [{ arm: '59', saldo: 1 }] }, { lote: 'ZZ8', fisico: -2 }]
  }, gaveta);
  assert.deepEqual(ok.itens[0].lotes[0].contagem, { fisico: 2, saldo: 1, status: 'outro-armazem', restante: 0 });
  assert.equal(ok.itens[0].lotes[1].contagem, null);
  assert.deepEqual(ok.itens[0].achados.map(a => [a.lote, a.contagem.status]), [['LX', 'sobra']]);
  assert.equal(ok.extras[0].fisico, 4); assert.deepEqual(ok.extras[0].sistema, [{ arm: '59', saldo: 1 }]);
  assert.equal(ok.extras[1].fisico, null);
  const resumo = G.summarize(ok.itens, '2026-11-17');
  assert.equal(resumo.lotesContados, 2); assert.equal(resumo.divergencias, 2);
  const { lotes, gavetas } = G.exportRows([{ dia: '2026-11-17', em: '2026-11-17T12:30:00.000Z', por: 'ana', duracaoSeg: 60, obs: '', gaveta: { codigo: 'AB1', arm: '01', armario: '' }, resumo,
    itens: ok.itens.map(i => ({ ...i, descricao: 'D' })), extras: ok.extras }], () => '09:30');
  const head = lotes[0], col = name => head.indexOf(name);
  const l1 = lotes.slice(1).find(r => r[col('Lote')] === 'L1' && r[col('Tipo')] === 'Lote da gaveta');
  assert.deepEqual([l1[col('Qtd física')], l1[col('Diferença (físico − saldo)')], l1[col('Contagem')]], [2, 1, 'Achado em outro armazém']);
  const achado = lotes.slice(1).find(r => r[col('Tipo')] === 'Lote achado (saldo só em outro armazém)');
  assert.deepEqual([achado[col('Lote')], achado[col('Qtd física')], achado[col('Contagem')]], ['LX', 3, 'Sobra sem saldo no sistema (3 sem saldo)']);
  const extra = lotes.slice(1).find(r => r[col('Lote')] === 'ZZ9');
  assert.equal(extra[col('Qtd física')], 4); assert.match(extra[col('Observação')], /arm\. 59 saldo 1/);
  assert.ok(lotes.slice(1).every(row => row.length === head.length));
  assert.equal(gavetas[1][gavetas[0].indexOf('Divergências na contagem')], 2);
});

test('a lupa localiza o produto pelo código, EAN, lote ou descrição e mostra as gavetas certas', () => {
  const lojas = {
    SB8: [['B8_FILIAL', 'B8_PRODUTO', 'B8_LOCAL', 'data validade', 'saldo', 'B8_EMPENHO', 'lote', 'D_E_L_E_T_'], ['01', 'P3', '59', '', 4, 0, 'Q1', '']],
    ZZ2: [['Filial', 'Armazem', 'Endereco', 'Produto', 'Lote'], ['01', '01', 'AB9', 'P3', ''], ['01', '59', 'Z1', 'P3', ''], ['01', '01', 'AB1', 'P1', '']],
    SB1: [['Codigo', 'Descricao', 'Unidade', 'EAN'], ['P3', 'CONE MORSE 3.5', 'UN', '789'], ['P1', 'IMPLANTE A', 'UN', '']]
  };
  const f = G.readWorkbook({ SheetNames: Object.keys(lojas), Sheets: lojas }, xlsx);
  const ctx = G.makeContext(f.zz2.rows, G.cleanSb1(f.sb1.rows), f.sb8.rows);
  for (const consulta of ['p3', '789', 'Q1', 'cone morse']) {
    const r = G.findProdutos(ctx, consulta);
    assert.equal(r.length, 1, consulta);
    assert.equal(r[0].produto, 'P3');
    assert.deepEqual(r[0].enderecos.map(e => [G.armLabel(e.arm), e.endereco]), [['01', 'AB9'], ['59', 'Z1']]);
  }
  assert.equal(r0(G.findProdutos(ctx, 'P1')).enderecos[0].id, '1|1|AB1');
  assert.deepEqual(G.findProdutos(ctx, 'XX'), []);
  assert.deepEqual(G.findProdutos(ctx, ''), []);
  function r0(list) { return list[0]; }
});

test('lote achado só em outro armazém sai na exportação com o armazém onde o sistema tem o saldo', () => {
  const contagem = { fisico: 2, saldo: 0, status: 'outro-armazem', restante: 0 };
  const g = G.cleanAnalysis; // valida a limpeza de origem
  const found = G.readWorkbook(book, xlsx);
  const ctx = G.makeContext(found.zz2.rows, G.cleanSb1(found.sb1.rows), found.sb8.rows);
  const gaveta = ctx.gavetas.get('1|1|AB1');
  const item = (produto, extra = {}) => ({ produto, conferido: true, lotes: [], transferir: [], ...extra });
  const ok = g({ itens: [item('P1', { achados: [{ lote: 'lx', contagem, origem: [{ arm: '59', saldo: 3 }, { arm: 'ES', saldo: 1 }] }] }), item('P2')], extras: [{ lote: 'ZZ9', fisico: 1, sistema: [{ arm: '30', saldo: 2 }] }] }, gaveta);
  assert.deepEqual(ok.itens[0].achados[0].origem, [{ arm: '59', saldo: 3 }, { arm: 'ES', saldo: 1 }]);
  const { lotes } = G.exportRows([{ dia: '2026-11-17', em: '2026-11-17T12:30:00.000Z', por: 'ana', duracaoSeg: 60, obs: '', gaveta: { codigo: 'AB1', arm: '01', armario: '' }, resumo: G.summarize(ok.itens, '2026-11-17'),
    itens: ok.itens.map(i => ({ ...i, descricao: 'D' })), extras: ok.extras }], () => '09:30');
  const col = name => lotes[0].indexOf(name);
  const achado = lotes.slice(1).find(r => r[col('Tipo')] === 'Lote achado (saldo só em outro armazém)');
  assert.equal(achado[col('Armazém')], '59, ES');
  assert.match(achado[col('Observação')], /Saldo no sistema: arm\. 59 \(3\), arm\. ES \(1\)/);
  assert.equal(lotes.slice(1).find(r => r[col('Lote')] === 'ZZ9')[col('Armazém')], '30');
});
