const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const H = require('../historico-atraso.js');

// [pedido, armazém, liberadoEm, peças, 'E'|'F', 'A'|'P', diasDeAtraso, transportadora]
const reg = (dia, total, itens) => ({ dia, total, pecas: 0, atualizadoEm: dia + 'T20:00:00.000Z', itens });
const dados = {
  meses: {
    '2026-11': {
      mes: '2026-11',
      dias: {
        '2026-11-18': reg('2026-11-18', 100, [['1001', 'Cambuci', '2026-11-10', 5, 'E', 'A', 8, 'TCS'], ['1002', 'BH', '2026-11-12', 3, 'F', 'A', 6, 'Jadlog']]),
        '2026-11-19': reg('2026-11-19', 100, [['1001', 'Cambuci', '2026-11-10', 5, 'F', 'A', 9, 'TCS'], ['1003', 'CE', '2026-11-18', 2, 'E', 'P', 1, 'Brasil']]),
        '2026-11-20': reg('2026-11-20', 100, [['1001', 'Cambuci', '2026-11-10', 5, 'F', 'A', 10, 'TCS']])
      }
    }
  },
  expedicao: { '2026-11': { '2026-11-17': { pedidos: 40, pecas: 900 }, '2026-11-19': { pedidos: 55, pecas: 1200.5 } } }
};

test('preparar junta fotos de atraso e despacho por dia, com o mês mais recente primeiro', () => {
  const p = H.preparar(dados);
  assert.deepEqual([...p.porDia.keys()], ['2026-11-18', '2026-11-19', '2026-11-20']);
  assert.deepEqual(p.meses, ['2026-11']);
  assert.deepEqual(p.diasExp, ['2026-11-17', '2026-11-19']);
  const a19 = p.porDia.get('2026-11-19');
  assert.equal(a19.resumo.tot, 2);
  assert.deepEqual(a19.cmp.novos.map(i => i[0]), ['1003']);
  assert.deepEqual(a19.cmp.saiu.map(i => i[0]), ['1002']);
  assert.deepEqual(a19.cmp.mudou.map(i => i[0]), ['1001'], 'passou de estoque para faturamento');
});

test('despacho compara com o último dia que teve despacho, mesmo com dias sem registro no meio', () => {
  const p = H.preparar(dados);
  const d = H.despacho(p, '2026-11-19');
  assert.deepEqual(d.atual, { pedidos: 55, pecas: 1200.5 });
  assert.equal(d.refDia, '2026-11-17');
  assert.equal(d.ref.pedidos, 40);
  assert.equal(H.despacho(p, '2026-11-20').atual, null, 'sem registro de saída no dia');
  assert.equal(H.despacho(p, '2026-11-17').ref, null, 'primeiro dia não tem referência');
});

test('sequência conta as fotos seguidas em atraso até o dia escolhido', () => {
  const p = H.preparar(dados);
  const k = H.chave(['1001', 'Cambuci']);
  assert.deepEqual(H.sequencia(p, k, '2026-11-20'), { n: 3, desde: '2026-11-18' });
  assert.deepEqual(H.sequencia(p, H.chave(['1003', 'CE']), '2026-11-20'), { n: 0, desde: '2026-11-20' }, 'saiu do atraso');
  assert.deepEqual(H.sequencia(p, H.chave(['1003', 'CE']), '2026-11-19'), { n: 1, desde: '2026-11-19' });
});

test('filtrar combina tipo, situação, armazém, transportadora e busca, e ordena', () => {
  const itens = dados.meses['2026-11'].dias['2026-11-18'].itens.concat(dados.meses['2026-11'].dias['2026-11-19'].itens);
  const f = (extra) => H.filtrar(itens, Object.assign({ tipo: '', sit: '', arm: '', transp: '', busca: '', ordem: 'dias', desc: true }, extra)).map(i => i[0] + i[4]);
  assert.deepEqual(f({}), ['1001F', '1001E', '1002F', '1003E'], 'padrão: mais dias de atraso primeiro');
  assert.deepEqual(f({ tipo: 'F' }), ['1001F', '1002F']);
  assert.deepEqual(f({ sit: 'P' }), ['1003E']);
  assert.deepEqual(f({ arm: 'BH' }), ['1002F']);
  assert.deepEqual(f({ transp: 'TCS' }), ['1001F', '1001E']);
  assert.deepEqual(f({ busca: '1003' }), ['1003E']);
  assert.deepEqual(f({ busca: 'jadlog' }), ['1002F'], 'busca também acha transportadora');
  assert.deepEqual(f({ ordem: 'pedido', desc: false }), ['1001E', '1001F', '1002F', '1003E']);
  assert.deepEqual(f({ ordem: 'pecas', desc: true }).slice(0, 2), ['1001E', '1001F']);
});

test('csv sai com BOM, ponto e vírgula, aspas escapadas e nomes legíveis', () => {
  const item = ['1001', 'Cambuci "A"', '2026-11-10', 5.5, 'F', 'P', 9, '', { n: 'CLIENTE X', c: '001902', nf: '884285', v: 1234.5, l: 3, e: 'F', sp: 'ANA', cf: 'BIA', ce: '2026-11-17T13:30:00.000Z' }];
  const texto = H.csv([item], { 1001: '2026-11-21' }, '2026-11-19', 'atraso');
  assert.ok(texto.startsWith('\ufeff"Pedido";"Cliente"'));
  const linhas = texto.slice(1).split('\r\n');
  assert.equal(linhas[1], '"1001";"CLIENTE X";"001902";"884285";"1234,5";"Cambuci ""A""";"10/11/2026";"5,5";"3";"Faturamento";"Faturamento (falta a nota)";"Em processo";"9";"";"ANA";"BIA";"17/11/2026, 10:30:00";"Estava em atraso · despachado em 21/11";"";"";"";"";"";""');
});

test('status do pedido: despachado (e quando), saiu sem despacho ou ainda em atraso', () => {
  const entregues = { 1001: '2026-11-21', 1002: '2026-11-18' };
  const it = (n) => [String(n), 'BH', '2026-11-10', 3, 'E', 'A', 5, 'TCS'];
  assert.deepEqual(H.statusDoPedido(entregues, it(1001), '2026-11-19', 'atraso'), { tipo: 'desp', em: '2026-11-21', texto: 'Estava em atraso · despachado em 21/11' });
  assert.equal(H.statusDoPedido(entregues, it(1001), '2026-11-19', 'saiu').texto, 'Despachado em 21/11', 'na aba dos que saíram: despachado');
  assert.equal(H.statusDoPedido(entregues, it(1002), '2026-11-19', 'atraso').texto, 'Despachado em 18/11', 'despachado antes da foto');
  assert.equal(H.statusDoPedido(entregues, it(1003), '2026-11-19', 'saiu').tipo, 'saiu');
  assert.equal(H.statusDoPedido(entregues, it(1003), '2026-11-19', 'novos').texto, 'Em atraso');
  const itens = [it(1001), it(1002), it(1003)];
  const f = (status) => H.filtrar(itens, { tipo: '', sit: '', arm: '', transp: '', busca: '', status, ordem: 'pedido', desc: false }, entregues).map((i) => i[0]);
  assert.deepEqual(f('desp'), ['1001', '1002']);
  assert.deepEqual(f('nao'), ['1003']);
  assert.deepEqual(f(''), ['1001', '1002', '1003']);
  assert.deepEqual(H.preparar({ meses: {}, entregues }).entregues, entregues);
});

test('registroDoDia leva os despachados por dia da planilha de Entrega (pedido conta uma vez; peças somam as linhas do pedido, sem repetir a mesma linha)', () => {
  const RG = require('../relatorio-geral-xlsx.js');
  const dia = (d) => new Date(2026, 10, d, 14, 30);
  const entrega = new Map([['9001', { data: dia(19) }], ['9002', { data: dia(19) }], ['9003', { data: dia(20) }], ['9004', { data: null }]]);
  const pedidos = [
    { pedido: '9001', armazem: 'Cambuci', qt: 10, status: 'Enviado' }, { pedido: '9001', armazem: 'BH', qt: 5 }, { pedido: '9001', armazem: 'Cambuci', qt: 99 },
    { pedido: '9002', armazem: 'BH', qt: 4.5 }, { pedido: '9003', armazem: 'CE', qt: 7 }, { pedido: '9004', armazem: 'CE', qt: 1 }, { pedido: '9005', armazem: 'RJ', qt: 9 }
  ];
  assert.deepEqual(RG.despachadosPorDia(pedidos, entrega), {
    '2026-11-19': { pedidos: 2, pecas: 19.5 },
    '2026-11-20': { pedidos: 1, pecas: 7 }
  });
  assert.deepEqual(RG.despachadosPorDia(pedidos, null), {}, 'sem planilha de Entrega carregada');
  assert.deepEqual(RG.entreguesPorPedido(pedidos, entrega, new Date(2026, 10, 23)), { 9001: '2026-11-19', 9002: '2026-11-19', 9003: '2026-11-20' }, 'pedido -> dia do despacho; sem data fica de fora');
  assert.deepEqual(RG.entreguesPorPedido(pedidos, entrega, new Date(2027, 5, 1)), {}, 'despacho com mais de 120 dias não vai junto');
  const dia19 = RG.registroDoDia(pedidos, new Date(2026, 10, 20), '2026-11-20', null, entrega).despachados['2026-11-19'];
  const { por, ...semPor } = dia19;
  assert.deepEqual(semPor, { pedidos: 2, pecas: 19.5 });
  // campo novo e opcional: o mesmo dia aberto por armazém (um pedido em 2 armazéns conta em cada um)
  assert.deepEqual(por, { Cambuci: { pedidos: 1, pecas: 10 }, BH: { pedidos: 2, pecas: 9.5 } });
});

test('registroDoDia leva o total de pedidos da base por armazém e o faturamento por armazém; o servidor guarda só o que é válido', () => {
  const RG = require('../relatorio-geral-xlsx.js'), AH = require('../atraso-historico.js');
  const pedidos = [
    { pedido: '1', armazem: 'Cambuci', qt: 2, nf: '10' }, { pedido: '2', armazem: 'Cambuci', qt: 3 }, { pedido: '3', armazem: 'Tambore', qt: 1, nf: '11' },
    { pedido: '4', armazem: 'BH', qt: 5, status: 'Atrasado', separador: 'Ana', conferente: 'Rui' }
  ];
  const fat = new Map([['10', new Date(2026, 10, 20, 9)], ['11', new Date(2026, 10, 20, 10)]]);
  const reg = RG.registroDoDia(pedidos, new Date(2026, 10, 20), '2026-11-20', null, null, { faturamento: fat });
  assert.deepEqual(reg.totalPorArmazem, { Cambuci: 2, 'Tamboré': 1, BH: 1 });
  assert.deepEqual(reg.faturados['2026-11-20'].por, { Cambuci: { pedidos: 1, pecas: 2 }, 'Tamboré': { pedidos: 1, pecas: 1 } });
  const limpo = AH.normalizarRegistro(Object.assign({}, reg, { totalPorArmazem: Object.assign({}, reg.totalPorArmazem, { lixo: 'x', zero: 0 }) }));
  assert.deepEqual(limpo.totalPorArmazem, { Cambuci: 2, 'Tamboré': 1, BH: 1 });
  assert.equal(AH.normalizarRegistro(Object.assign({}, reg, { totalPorArmazem: undefined })).totalPorArmazem, undefined, 'registro antigo continua igual');
  const desp = AH.normalizarDespachados({ '2026-11-20': { pedidos: 3, pecas: 9, por: { Cambuci: { pedidos: 2, pecas: 6 }, ruim: 'x', BH: { pedidos: 0 } } }, '2026-11-19': { pedidos: 1, pecas: 2 } });
  assert.deepEqual(desp['2026-11-20'].por, { Cambuci: { pedidos: 2, pecas: 6 } });
  assert.equal(desp['2026-11-19'].por, undefined);
});

test('o servidor guarda os despachados que chegam com a foto e só deixa o dia crescer', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-histpag-'));
  for (const name of ['server.js', 'stock-position.js', 'inventory-integrity.js', 'atraso-historico.js', 'historico-atraso.html', 'historico-atraso.js', 'atraso-historico-xlsx.js']) fs.copyFileSync(path.join(__dirname, '..', name), path.join(dir, name));
  fs.mkdirSync(path.join(dir, 'data'));
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const hoje = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const mes = hoje.slice(0, 7), d1 = mes + '-03', d2 = mes + '-04';
  try {
    const pagina = await fetch(base + '/historico-atraso.html');
    assert.equal(pagina.status, 200);
    assert.match(await pagina.text(), /Histórico de Atraso/);
    assert.equal((await fetch(base + '/historico-atraso.js')).status, 200);
    assert.equal((await fetch(base + '/api/atraso-historico')).status, 401, 'sem login a página não lê dados');
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1' }, body: JSON.stringify({ password: process.env.APP_PASSWORD }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const post = (corpo) => fetch(base + '/api/atraso-historico', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1', Cookie: cookie }, body: JSON.stringify(corpo) });
    const ler = async () => (await (await fetch(base + '/api/atraso-historico', { headers: { Cookie: cookie } })).json());
    assert.deepEqual((await ler()).expedicao, {}, 'nada exportado ainda: a página não inventa despacho');
    const r = await post({ dia: hoje, total: 5, pecas: 10, itens: [['P1', 'BH', hoje, 3, 'E', 'A', 2, 'TCS']], despachados: { [d1]: { pedidos: 80, pecas: 5000 }, [d2]: { pedidos: 10, pecas: 300.456 }, '2026-02-31': { pedidos: 9, pecas: 1 }, [mes + '-05']: { pedidos: 0, pecas: 0 }, [mes + '-06']: 'lixo' } });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).diasDespacho, 2, 'dia inexistente, vazio ou lixo são ignorados');
    let exp = (await ler()).expedicao[mes];
    assert.deepEqual(exp, { [d1]: { pedidos: 80, pecas: 5000 }, [d2]: { pedidos: 10, pecas: 300.46 } });
    // nova exportação com a ponta da planilha cortada: o dia não encolhe; com mais pedidos, cresce
    await post({ dia: hoje, total: 5, pecas: 10, itens: [['P1', 'BH', hoje, 3, 'E', 'A', 2, 'TCS']], despachados: { [d1]: { pedidos: 20, pecas: 1000 }, [d2]: { pedidos: 12, pecas: 350 } } });
    exp = (await ler()).expedicao[mes];
    assert.deepEqual(exp[d1], { pedidos: 80, pecas: 5000 });
    assert.deepEqual(exp[d2], { pedidos: 12, pecas: 350 });
    // data de despacho de cada pedido: guardada, atualizada e devolvida; dado ruim ou antigo é descartado
    assert.deepEqual((await ler()).entregues, {});
    const foto = { dia: hoje, total: 5, pecas: 10, itens: [['P1', 'BH', hoje, 3, 'E', 'A', 2, 'TCS']] };
    await post({ ...foto, entregues: { 7001: d1, 7002: d2, 7003: '2026-02-31', 7004: 5, 7005: '2000-01-01' } });
    assert.deepEqual((await ler()).entregues, { 7001: d1, 7002: d2 }, 'dia inválido, lixo e despacho muito antigo ficam de fora');
    await post({ ...foto, entregues: { 7001: d2, 7008: d1 } });
    assert.deepEqual((await ler()).entregues, { 7001: d2, 7002: d2, 7008: d1 }, 'o dia novo troca o antigo e os outros ficam');
    const guardado = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'atraso-expedicao-' + mes + '.json'), 'utf8'));
    assert.equal(Object.keys(guardado.dias).length, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('pedido achado na Saída p/ Expedição passa a contar como atraso de faturamento (só se a saída já tinha acontecido na foto)', () => {
  const item = (pedido, tipo) => [pedido, 'BH', '2026-11-10', 3, tipo, 'A', 5, 'TCS'];
  const meses = { '2026-11': { mes: '2026-11', dias: {
    '2026-11-18': reg('2026-11-18', 100, [item('0005001', 'E'), item('5002', 'E'), item('5003', 'F')]),
    '2026-11-19': reg('2026-11-19', 100, [item('5001', 'E'), item('5002', 'E')])
  } } };
  // 5001 saiu às 15h do dia 18 (hora de Brasília); 5002 só no dia 20; 5003 já era faturamento
  const saidas = { 5001: '2026-11-18T18:00:00.000Z', 5002: '2026-11-20T13:00:00.000Z', 5003: '2026-11-18T12:00:00.000Z' };
  const novo = H.aplicarSaidas(meses, saidas)['2026-11'].dias;
  const d18 = novo['2026-11-18'].itens;
  assert.deepEqual(d18.map(i => i[4]), ['F', 'E', 'F'], '5001 vira faturamento; 5002 ainda era estoque no dia 18');
  assert.equal(d18[0][10], 'E', 'marca que foi reclassificado');
  assert.equal(d18[0][9], '2026-11-18T18:00:00.000Z');
  assert.equal(d18[2][10], undefined, 'quem já era faturamento não é reclassificado');
  assert.equal(novo['2026-11-19'].itens[0][4], 'F');
  assert.equal(novo['2026-11-19'].itens[1][4], 'E', '5002 só saiu depois da foto');
  assert.equal(meses['2026-11'].dias['2026-11-18'].itens[0][4], 'E', 'os dados originais não são alterados');
  const p = H.preparar({ meses, saidas });
  assert.equal(p.porDia.get('2026-11-18').resumo.f, 2);
  assert.equal(p.porDia.get('2026-11-18').resumo.e, 1);
  assert.equal(H.statusDoPedido({}, novo['2026-11-18'].itens[0], '2026-11-18', 'atraso').tipo, 'exp');
  assert.match(H.statusDoPedido({}, novo['2026-11-18'].itens[0], '2026-11-18', 'atraso').texto, /^Saída p\/ expedição em 18\/11 às 15:00$/);
  assert.equal(H.statusDoPedido({ 5001: '2026-11-21' }, novo['2026-11-18'].itens[0], '2026-11-18', 'atraso').tipo, 'desp', 'despacho da Entrega vale mais que a saída');
});

test('o servidor acha na Saída p/ Expedição os pedidos das fotos (ignora zeros à esquerda) e guarda o resultado', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-histsaida-'));
  for (const name of ['server.js', 'stock-position.js', 'inventory-integrity.js', 'atraso-historico.js']) fs.copyFileSync(path.join(__dirname, '..', name), path.join(dir, name));
  const data = path.join(dir, 'data');
  fs.mkdirSync(data);
  const hoje = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const entrada = (pedido, em) => ({ id: 'e' + pedido + em, pedido, registradoEm: em, info: null });
  fs.writeFileSync(path.join(data, 'saida-dias.json'), JSON.stringify({ dias: [hoje], exportados: {}, pendentes: {} }));
  fs.writeFileSync(path.join(data, 'saida-pv-' + hoje + '.json'), JSON.stringify({ dia: hoje, versao: 1, removidos: [], entries: [entrada('5001', hoje + 'T18:00:00.000Z'), entrada('5001', hoje + 'T12:00:00.000Z'), entrada('8888', hoje + 'T12:00:00.000Z')] }));
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1' }, body: JSON.stringify({ password: process.env.APP_PASSWORD }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const post = (corpo) => fetch(base + '/api/atraso-historico', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1', Cookie: cookie }, body: JSON.stringify(corpo) });
    const ler = async () => (await (await fetch(base + '/api/atraso-historico', { headers: { Cookie: cookie } })).json());
    await post({ dia: hoje, total: 5, pecas: 10, itens: [['005001', 'BH', hoje, 3, 'E', 'A', 2, 'TCS'], ['5002', 'BH', hoje, 1, 'E', 'A', 2, '']] });
    const j = await ler();
    assert.deepEqual(j.saidas, { 5001: hoje + 'T12:00:00.000Z' }, 'acha 5001 (com zeros na foto), usa o 1º registro e ignora pedido que não está nas fotos');
    // atualização em tempo real: só o cruzamento com a saída, sem as fotos
    const so = await (await fetch(base + '/api/atraso-historico?so=saidas', { headers: { Cookie: cookie } })).json();
    assert.deepEqual(so, { saidas: { 5001: hoje + 'T12:00:00.000Z' }, ocorrencias: [] });
    // o dia da saída é apagado depois da exportação: o resultado guardado continua
    fs.rmSync(path.join(data, 'saida-pv-' + hoje + '.json'));
    const guardado = JSON.parse(fs.readFileSync(path.join(data, 'atraso-saidas.json'), 'utf8'));
    assert.deepEqual(guardado.pedidos, { 5001: hoje + 'T12:00:00.000Z' });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('link sem senha: só leitura, o administrador gera, troca e desativa', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-histlink-'));
  for (const name of ['server.js', 'stock-position.js', 'inventory-integrity.js', 'atraso-historico.js']) fs.copyFileSync(path.join(__dirname, '..', name), path.join(dir, name));
  fs.mkdirSync(path.join(dir, 'data'));
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const hoje = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  try {
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1' }, body: JSON.stringify({ password: process.env.APP_PASSWORD }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const adm = (url, corpo) => fetch(base + url, { method: corpo ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1', Cookie: cookie }, body: corpo ? JSON.stringify(corpo) : undefined });
    const anonimo = (url, corpo) => fetch(base + url, { method: corpo ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1' }, body: corpo ? JSON.stringify(corpo) : undefined });
    await adm('/api/atraso-historico', { dia: hoje, total: 5, pecas: 10, itens: [['P1', 'BH', hoje, 3, 'E', 'A', 2, 'TCS']] });

    assert.equal((await anonimo('/api/atraso-historico-link')).status, 401, 'sem login não vê nem o código');
    assert.equal((await anonimo('/api/atraso-historico-link', { acao: 'gerar' })).status, 401, 'sem login não gera');
    assert.equal((await (await adm('/api/atraso-historico-link')).json()).token, null, 'começa sem link');
    assert.equal((await anonimo('/api/atraso-historico?k=qualquer')).status, 401, 'código inventado não vale, e sem link ativo nada vale');
    assert.equal((await adm('/api/atraso-historico-link', { acao: 'xyz' })).status, 400);

    const t1 = (await (await adm('/api/atraso-historico-link', { acao: 'gerar' })).json()).token;
    assert.match(t1, /^[A-Za-z0-9_-]{32}$/, 'código longo e aleatório');
    assert.equal((await (await adm('/api/atraso-historico-link')).json()).token, t1);
    const lido = await anonimo('/api/atraso-historico?meses=2&k=' + t1);
    assert.equal(lido.status, 200, 'com o código, qualquer pessoa lê');
    assert.equal(Object.values((await lido.json()).meses)[0].dias[hoje].itens.length, 1);
    assert.equal((await anonimo('/api/atraso-historico?so=saidas&k=' + t1)).status, 200, 'e a atualização em tempo real também');
    assert.equal((await anonimo('/api/atraso-historico?k=' + t1.slice(0, -1) + 'x')).status, 401, 'código errado');
    assert.equal((await anonimo('/api/atraso-historico?k=' + t1, { dia: hoje, total: 9, pecas: 1, itens: [['X', 'BH', hoje, 1, 'E', 'A', 1, '']] })).status, 401, 'o código não grava nada');
    assert.equal((await anonimo('/api/atraso-historico-link?k=' + t1)).status, 401, 'o código não administra o link');
    assert.equal((await anonimo('/api/login', { password: t1 })).status, 401, 'o código não vira senha');

    const t2 = (await (await adm('/api/atraso-historico-link', { acao: 'gerar' })).json()).token;
    assert.notEqual(t2, t1);
    assert.equal((await anonimo('/api/atraso-historico?k=' + t1)).status, 401, 'gerar novo desativa o antigo');
    assert.equal((await anonimo('/api/atraso-historico?k=' + t2)).status, 200);
    await adm('/api/atraso-historico-link', { acao: 'desativar' });
    assert.equal((await anonimo('/api/atraso-historico?k=' + t2)).status, 401, 'desativado');
    assert.equal((await (await adm('/api/atraso-historico-link')).json()).token, null);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('dados do pedido (cliente, NF, valor, etapa...) vão na foto e dá para buscar e filtrar por eles', () => {
  const RG = require('../relatorio-geral-xlsx.js');
  const d = (h) => new Date(Date.UTC(2026, 10, 17, h));
  const faturamento = new Map([['884285', d(18)]]);
  const valores = new Map([['884285', { mercad: 1000, fatura: 1234.5 }]]);
  const base = { armazem: 'Cambuci', dt: new Date(2026, 10, 10), qt: 8, itens: 3, status: 'Atrasado', nome: 'FUNDACAO X', cliente: '001902' };
  const pedidos = [
    { ...base, pedido: '1', nf: '000884285.0', separador: 'ANA', conferente: 'BIA', pickEnd: d(12), confEnd: d(14) },
    { ...base, pedido: '2', nf: null, separador: 'ANA', conferente: '0', pickEnd: d(12), confEnd: null },
    { ...base, pedido: '3', nf: null, separador: '', conferente: '', pickEnd: null, confEnd: null },
    { ...base, pedido: '4', nf: null, separador: 'ANA', conferente: 'BIA', pickEnd: d(12), confEnd: d(14), nome: 'OUTRO CLIENTE', cliente: '77' }
  ];
  const x = (n) => RG.extrasDoPedido(pedidos[n], !!pedidos[n].pickEnd, !!pedidos[n].confEnd, { faturamento, valores });
  assert.deepEqual(x(1), { n: 'FUNDACAO X', c: '001902', l: 3, e: 'C', sp: 'ANA', pe: d(12).toISOString() });
  assert.equal(x(2).e, 'S');
  assert.equal(x(3).e, 'F');
  const rico = x(0);
  assert.equal(rico.e, 'D'); assert.equal(rico.v, 1234.5); assert.equal(rico.fa, d(18).toISOString()); assert.equal(rico.cf, 'BIA');
  const itens = pedidos.map((o) => [o.pedido, 'Cambuci', '2026-11-10', 8, 'F', 'A', 7, 'TCS', RG.extrasDoPedido(o, !!o.pickEnd, !!o.confEnd, { faturamento, valores })]);
  const f = (extra) => H.filtrar(itens, Object.assign({ tipo: '', sit: '', arm: '', transp: '', busca: '', status: '', etapa: '', ordem: 'pedido', desc: false }, extra)).map(i => i[0]);
  assert.deepEqual(f({ busca: 'outro cliente' }), ['4'], 'busca pelo nome do cliente');
  assert.deepEqual(f({ busca: '884285' }), ['1'], 'busca pela nota fiscal');
  assert.deepEqual(f({ busca: '77' }), ['4'], 'busca pelo código do cliente');
  assert.deepEqual(f({ etapa: 'S' }), ['3']);
  assert.deepEqual(f({ etapa: 'F' }), ['4']);
  assert.deepEqual(f({ ordem: 'cliente' }).slice(0, 1), ['1'], 'ordena pelo nome do cliente');
});

test('o servidor guarda só os dados conhecidos do pedido, limpos', async () => {
  const AH = require('../atraso-historico.js');
  const lixo = { n: 'N'.repeat(200), c: 5, nf: '99', v: '12,5', l: 2.4, e: 'Z', sp: 'ANA', pe: 'não é data', ce: '2026-11-17T13:30:00.000Z', hack: '<img>', fa: { a: 1 } };
  const reg = AH.normalizarRegistro({ dia: '2026-11-20', total: 3, itens: [['1', 'BH', '2026-11-10', 3, 'E', 'A', 2, 'TCS', lixo], ['2', 'BH', '2026-11-10', 3, 'E', 'A', 2, 'TCS'], ['3', 'BH', '2026-11-10', 3, 'E', 'A', 2, 'TCS', 'texto']] });
  assert.deepEqual(reg.itens[0][8], { n: 'N'.repeat(60), c: '5', nf: '99', sp: 'ANA', ce: '2026-11-17T13:30:00.000Z', l: 2 }, 'valor "12,5" vira 0 (não é número); etapa inválida, data ruim e chaves desconhecidas saem');
  assert.deepEqual(reg.itens[1][8], {}, 'sem extras: objeto vazio');
  assert.deepEqual(reg.itens[2][8], {}, 'lixo vira vazio');
  const bom = AH.normalizarRegistro({ dia: '2026-11-20', total: 1, itens: [['1', 'BH', '2026-11-10', 3, 'F', 'A', 2, 'TCS', { v: 12.5, e: 'D', fa: '2026-11-18T10:00:00Z' }]] });
  assert.deepEqual(bom.itens[0][8], { v: 12.5, e: 'D', fa: '2026-11-18T10:00:00Z' });
});
