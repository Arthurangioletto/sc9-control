const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

// Onda 1 das vendedoras: lista de armazéns por filial (a vendedora só escolhe da lista; o servidor recusa o resto), saldo separado (59/26), "Para quando"
// (prioridade e solicitação), etapa do pedido na consulta e ataques (constructor, __proto__, valores gigantes).
const iso = (h) => new Date(Date.now() - h * 3600000).toISOString();
const ordem = (pedido, extra) => Object.assign({ pedido, armazem: 'Cambuci', nf: '', nome: 'CLIENTE ' + pedido, cliente: '001', dt: '2026-11-18', dtLiberacaoHora: '2026-11-18T12:10:00.000Z', qt: 5, itens: 2, status: 'Liberado', separador: '', conferente: '' }, extra);
const ITEM_NAMES = [['10.100', 'Cabo de Aço 8 mm'], ['10.101', 'Cabo de aço 10 mm'], ['20.500', 'Luva Térmica'], ['30.001', 'Parafuso sem saldo']];
const SALDO = [
  ['L59', { produto: '10.100', porArmazem: [['59', 100]], itens: [{ arm: '59', produto: '10.100', descricao: 'Cabo de Aço 8 mm', saldo: 100 }, { arm: '26', produto: '10.100', descricao: 'Cabo de Aço 8 mm', saldo: 11 }] }],
  ['L1', { produto: '10.100', porArmazem: [['01', 30]], itens: [{ arm: '01', produto: '10.100', descricao: 'Cabo de Aço 8 mm', saldo: 30 }, { arm: '02', produto: '10.100', descricao: 'Cabo de Aço 8 mm', saldo: 7 }] }],
  ['L2', { produto: '10.100', porArmazem: [['01', 12]], itens: [{ arm: '01', produto: '10.100', descricao: 'Cabo de Aço 8 mm', saldo: 12 }, { arm: '01', produto: '20.500', descricao: 'Luva Térmica', saldo: 80 }] }]
];
const PEDIDOS = [ordem('400001'), ordem('400002', { pickStart: iso(1) }), ordem('400003', { pickStart: iso(3), pickEnd: iso(2) }), ordem('400004', { pickStart: iso(5), pickEnd: iso(4), confEnd: iso(3), nf: '9001' })];

async function subir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-solic-'));
  for (const f of fs.readdirSync(path.join(__dirname, '..'))) if (/\.(js|html|css)$/.test(f)) fs.copyFileSync(path.join(__dirname, '..', f), path.join(dir, f));
  const data = path.join(dir, 'data'); fs.mkdirSync(data);
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (url, body, { cookie, token } = {}) => {
    const r = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1', ...(cookie ? { Cookie: cookie } : {}), ...(token ? { 'X-Vend-Token': token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const texto = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await r.arrayBuffer()); // mantém o BOM do CSV
    let json = {}; try { json = JSON.parse(texto); } catch (e) { /* CSV */ }
    return { status: r.status, data: json, texto, headers: r.headers };
  };
  const login = async (corpo) => { const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1' }, body: JSON.stringify(corpo) }); return (r.headers.get('set-cookie') || '').split(';')[0]; };
  const admin = await login({ password: process.env.APP_PASSWORD });
  const salvar = (extra) => call('/api/save', Object.assign({ orders: PEDIDOS, items: [], itemNames: ITEM_NAMES, saldoPorLote: SALDO, warehousesPresent: ['Cambuci'], cutoff: '2026-11-24', faturamento: [], entregaInfo: [], valores: [] }, extra), { cookie: admin });
  assert.equal((await salvar()).status, 200);
  const k = (await call('/api/vendedoras-link', { acao: 'gerar' }, { cookie: admin })).data.token;
  const U = (rota) => '/api/vendedoras/' + rota + (rota.includes('?') ? '&' : '?') + 'k=' + encodeURIComponent(k);
  const novaConta = async (nome, login) => (await call(U('conta'), { acao: 'criar', nome, login, email: login + '@implacil.com.br', codigo: 'codigo-' + login + '-9' })).data.token;
  const equipe = async (usuario, perfis) => { const r = await call('/api/usuarios', { acao: 'criar', usuario, nome: 'Pessoa ' + usuario, senha: 'senha-' + usuario + '-xyz', perfis }, { cookie: admin }); assert.equal(r.status, 200, 'criar ' + usuario); return login({ usuario, password: 'senha-' + usuario + '-xyz' }); };
  return { server, call, admin, k, U, dir, data, salvar, novaConta, equipe, fechar: () => new Promise((r) => server.close(r)) };
}

const transf = (extra) => Object.assign({ itens: [{ produto: '10.100', qt: 5 }], origem: { filial: 'Cambuci', armazem: '01' }, destino: { filial: 'Tambore', armazem: '01' } }, extra);
const amanha = () => new Date(Date.now() + 36 * 3600000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

test('armazéns: a vendedora lê só os da lista (sem 59/26), cruzados com o saldo; precisa do link', async () => {
  const { call, U, fechar } = await subir();
  try {
    assert.equal((await call('/api/vendedoras/armazens?k=errado')).status, 401);
    assert.equal((await call('/api/vendedoras/armazens')).status, 401);
    const j = (await call(U('armazens'))).data;
    const cambuci = j.filiais.find((f) => f.filial === 'Cambuci');
    assert.deepEqual(cambuci.armazens.map((a) => a.codigo), ['01', '02'], '59 e 26 existem mas não são oferecidos');
    assert.ok(cambuci.armazens.every((a) => a.origem && a.destino));
    assert.equal(cambuci.armazens[0].comSaldo, true);
    assert.ok(j.filiais.some((f) => f.filial === 'BH'), 'as outras filiais têm o armazém da própria filial');
    assert.ok(!JSON.stringify(j).includes('ZZ2'), 'ZZ2 não é armazém');
  } finally { await fechar(); }
});

test('transferência: o servidor recusa armazém fora da lista (59, 26, ZZ2, constructor, __proto__) e aceita os da lista', async () => {
  const { call, U, novaConta, fechar } = await subir();
  try {
    const ana = await novaConta('Ana', 'ana.v');
    const pedir = (extra) => call(U('solicitacao'), { tipo: 'transferencia_peca', pedidoPor: 'Ana', dados: transf(extra) }, { token: ana });
    const ruins = [
      [{ origem: { filial: 'Cambuci', armazem: '59' } }, /59.*(não está liberado|origem)/s], [{ destino: { filial: 'Cambuci', armazem: '26' } }, /26/],
      [{ destino: { filial: 'Cambuci', armazem: 'ZZ2' } }, /ZZ2.*não existe na lista/s], [{ origem: { filial: 'Cambuci', armazem: 'constructor' } }, /não existe na lista|armazém/i],
      [{ origem: { filial: 'Cambuci', armazem: '__proto__' } }, /não existe na lista|armazém/i], [{ origem: { filial: 'constructor', armazem: '01' } }, /filial/i],
      [{ origem: { filial: 'Cambuci', armazem: '01' }, destino: { filial: 'Cambuci', armazem: '1' } }, /diferentes/], [{ destino: { filial: 'Tambore', armazem: '02' } }, /não existe na lista/]
    ];
    for (const [extra, re] of ruins) { const r = await pedir(extra); assert.equal(r.status, 400, JSON.stringify(extra)); assert.match(r.data.error, re); }
    const ok = await pedir({ destino: { filial: 'Cambuci', armazem: '02' } });
    assert.equal(ok.status, 200); assert.equal(ok.data.linha.dados.tipoTransferencia, 'entre_armazens');
    assert.equal((await pedir({ origem: { filial: 'BH', armazem: '1' }, destino: { filial: 'RJ', armazem: '01' } })).status, 200, 'armazém da própria filial (BH/RJ)');
  } finally { await fechar(); }
});

test('armazéns: só a equipe edita; lista inválida é recusada; a vendedora enxerga a lista nova na hora; histórico de quem mudou', async () => {
  const { call, U, k, admin, equipe, novaConta, fechar } = await subir();
  try {
    const ana = await novaConta('Ana', 'ana.v');
    assert.equal((await call('/api/armazens-vendedoras')).status, 401);
    assert.equal((await call('/api/armazens-vendedoras', { acao: 'restaurar' }, { token: ana })).status, 401, 'vendedora não edita');
    const semPerfil = await equipe('semperfil', ['saida']);
    assert.equal((await call('/api/armazens-vendedoras', null, { cookie: semPerfil })).status, 403);
    const logi = await equipe('logi', ['ocorrencias']);
    const g = (await call('/api/armazens-vendedoras', null, { cookie: logi })).data;
    assert.equal(g.provisoria, false, 'lista inicial confirmada em 27/11/2026: sem aviso de provisória'); assert.equal(g.padrao, true);
    assert.deepEqual(g.armazens.filter((x) => !x.vendavel).map((x) => x.codigo).sort(), ['26', '59']);
    assert.ok(g.naoClassificados.every((x) => x.filial && x.codigo));
    const lista = g.armazens.map((x) => ({ filial: x.filial, codigo: x.codigo, rotulo: x.rotulo, origem: x.origem, destino: x.destino, vendavel: x.vendavel, nota: x.nota }));
    for (const ruim of [{ acao: 'salvar' }, { acao: 'salvar', armazens: 'x' }, { acao: 'salvar', armazens: [] }, { acao: 'salvar', armazens: [{ filial: 'Marte', codigo: '01', origem: true, destino: true }] },
      { acao: 'salvar', armazens: lista.concat([lista[0]]) }, { acao: 'salvar', armazens: lista.map((x) => Object.assign({}, x, { origem: false })) }, { acao: 'salvar', armazens: new Array(500).fill(lista[0]) }, { acao: 'apagar' }]) {
      const r = await call('/api/armazens-vendedoras', ruim, { cookie: logi }); assert.equal(r.status, 400, JSON.stringify(ruim).slice(0, 60)); assert.ok(r.data.error);
    }
    const nova = lista.concat([{ filial: 'Cambuci', codigo: 'zz2', rotulo: '<img src=x onerror=alert(1)>', origem: false, destino: true, vendavel: false, nota: 'x'.repeat(5000) }]);
    const s = await call('/api/armazens-vendedoras', { acao: 'salvar', armazens: nova }, { cookie: logi });
    assert.equal(s.status, 200); assert.equal(s.data.provisoria, false);
    const salvo = s.data.armazens.find((x) => x.codigo === 'ZZ2');
    assert.equal(salvo.nota.length, 120, 'nota limitada'); assert.equal(s.data.historico.length, 1); assert.equal(s.data.historico[0].por, 'logi');
    const v = (await call(U('armazens'))).data.filiais.find((f) => f.filial === 'Cambuci').armazens.find((a) => a.codigo === 'ZZ2');
    assert.ok(v && v.destino && !v.origem, 'a vendedora já vê o armazém liberado só como destino');
    assert.equal((await call(U('solicitacao'), { tipo: 'transferencia_peca', pedidoPor: 'Ana', dados: transf({ origem: { filial: 'Cambuci', armazem: '01' }, destino: { filial: 'Cambuci', armazem: 'ZZ2' } }) }, { token: ana })).status, 200, 'destino liberado agora vale');
    assert.equal((await call(U('solicitacao'), { tipo: 'transferencia_peca', pedidoPor: 'Ana', dados: transf({ origem: { filial: 'Cambuci', armazem: 'ZZ2' }, destino: { filial: 'Cambuci', armazem: '01' } }) }, { token: ana })).status, 400, 'mas não como origem');
    const r = await call('/api/armazens-vendedoras', { acao: 'restaurar' }, { cookie: admin });
    assert.equal(r.status, 200); assert.equal(r.data.provisoria, false); assert.equal(r.data.padrao, true); assert.equal(r.data.historico.length, 2);
  } finally { await fechar(); }
});

test('saldo separado: "Total em todas as filiais" soma só o vendável; 59 e 26 vêm à parte', async () => {
  const { call, U, fechar } = await subir();
  try {
    const p = (await call(U('produtos?q=10.100'))).data.produtos[0];
    assert.equal(p.saldoTotal, 30 + 7 + 12, 'só 01 e 02 de Cambuci (L1 e L2), sem 59 e 26');
    assert.equal(p.saldoSeparadoTotal, 111);
    assert.deepEqual(p.saldoSeparado.map((x) => x.armazem).sort(), ['26', '59']);
  } finally { await fechar(); }
});

test('"Para quando": opcional, validado no servidor, guardado, na lista da equipe e no CSV (prioridade e solicitação)', async () => {
  const { call, U, novaConta, equipe, fechar } = await subir();
  try {
    const ana = await novaConta('Ana', 'ana.v'), logi = await equipe('logi', ['ocorrencias']);
    const prio = (extra) => call(U('prioridade'), Object.assign({ pedido: '400001', nivel: 'alta', motivo: 'cliente_aguardando', pedidoPor: 'Ana' }, extra), { token: ana });
    for (const ruim of ['constructor', { tipo: '__proto__' }, { tipo: 'data', data: '2020-01-01' }]) { // (os demais ataques estão no teste do módulo, sem passar pelo limite de envios)
      const r = await prio({ paraQuando: ruim }); assert.equal(r.status, 400, JSON.stringify(ruim)); assert.match(r.data.error, /Para quando/);
    }
    const ok = await prio({ paraQuando: { tipo: 'hoje_16h' } });
    assert.equal(ok.status, 200); assert.equal(ok.data.linha.paraQuando.tipo, 'hoje_16h'); assert.match(ok.data.linha.paraQuando.data, /^\d{4}-\d{2}-\d{2}$/, 'o servidor resolve o dia');
    assert.equal((await prio({ pedido: '400002' })).status, 200, 'sem para quando continua valendo');
    const sol = (extra) => call(U('solicitacao'), Object.assign({ tipo: 'alterar_pedido', pedido: '400001', pedidoPor: 'Ana', dados: { o_que: 'trocar o endereço de entrega' } }, extra), { token: ana });
    assert.equal((await sol({ paraQuando: { tipo: 'data', data: '2020-01-01' } })).status, 400);
    assert.equal((await sol({ paraQuando: 'constructor' })).status, 400);
    const s = await sol({ paraQuando: { tipo: 'data', data: amanha() } });
    assert.equal(s.status, 200); assert.equal(s.data.linha.paraQuando.data, amanha());
    const lista = (await call('/api/solicitacoes', null, { cookie: logi })).data.ativos;
    assert.equal(lista.find((l) => l.id === s.data.linha.id).paraQuando.tipo, 'data', 'aparece na lista da logística');
    const csv = (await call('/api/solicitacoes/exportar', null, { cookie: logi })).texto;
    assert.match(csv, /para quando/i); assert.ok(csv.includes('Até ' + amanha().slice(8) + '/' + amanha().slice(5, 7)), 'e no CSV');
    const minhas = (await call(U('solicitacoes?ids='), null, { token: ana })).data;
    assert.ok([].concat(minhas.ativas, minhas.recentes).some((l) => l.paraQuando && l.paraQuando.tipo === 'data'), 'a vendedora também vê');
  } finally { await fechar(); }
});

test('consulta do pedido traz a etapa e o aviso ("ainda dá tempo" / "já foi separado") antes de enviar', async () => {
  const { call, U, fechar } = await subir();
  try {
    const nao = (await call(U('pedido?pedido=400001'))).data, sep = (await call(U('pedido?pedido=400003'))).data, fora = (await call(U('pedido?pedido=999999'))).data;
    assert.equal(nao.etapa, 'nao_separado'); assert.match(nao.avisoEtapa, /tempo|parar/i);
    assert.ok(['separado', 'conferido', 'faturado', 'despachado'].includes(sep.etapa)); assert.match(sep.avisoEtapa, /separad|andou|não dá|pode/i);
    assert.equal(fora.etapa, 'nao_achado');
    const varios = (await call(U('pedidos?pedidos=400001,400003'))).data.pedidos;
    assert.deepEqual(varios.map((x) => !!x.etapa), [true, true]);
  } finally { await fechar(); }
});

test('para-quando.js: só aceita as opções da lista; data passada, distante ou estranha é recusada; resolve o dia em São Paulo', () => {
  const PQ = require('../para-quando.js'), agora = Date.parse('2026-11-27T15:00:00Z');
  for (const ruim of ['constructor', '__proto__', 'toString', { tipo: 'constructor' }, { tipo: '__proto__' }, { tipo: 'data' }, { tipo: 'data', data: '2026-11-26' }, { tipo: 'data', data: '2999-01-01' }, { tipo: 'data', data: '2026-02-30' }, { tipo: 'data', data: { a: 1 } }, 42, true, ['hoje_coleta']]) {
    assert.ok(PQ.validar(ruim, agora).erro, 'deveria recusar ' + JSON.stringify(ruim));
  }
  assert.deepEqual(PQ.validar(null, agora), { valor: null }); assert.deepEqual(PQ.validar('', agora), { valor: null }); assert.deepEqual(PQ.validar({}, agora), { valor: null });
  assert.deepEqual(PQ.validar('hoje_coleta', agora).valor, { tipo: 'hoje_coleta', data: '2026-11-27' });
  assert.deepEqual(PQ.validar({ tipo: 'amanha' }, agora).valor, { tipo: 'amanha', data: '2026-11-28' });
  assert.deepEqual(PQ.validar({ tipo: 'data', data: '2026-12-24' }, agora).valor, { tipo: 'data', data: '2026-12-24' });
  assert.equal(PQ.validar({ tipo: 'hoje_16h' }, Date.parse('2026-11-28T01:00:00Z')).valor.data, '2026-11-27', 'meia-noite UTC ainda é o dia anterior em São Paulo');
  assert.equal(PQ.rotulo({ tipo: 'amanha', data: '2026-11-28' }), 'Amanhã (28/11)'); assert.equal(PQ.rotulo({ tipo: 'data', data: '2026-12-24' }), 'Até 24/12/2026'); assert.equal(PQ.rotulo({ tipo: 'constructor' }), '');
  assert.equal(PQ.normalizar({ tipo: 'constructor', data: '2026-11-27' }), null, 'arquivo adulterado não vira dado');
});

test('armazens-vendedoras.js: lista padrão conservadora, normalização estrita e mensagens claras', () => {
  const A = require('../armazens-vendedoras.js');
  const ef = A.efetiva(null);
  assert.equal(ef.padrao, true);
  assert.deepEqual(ef.lista.filter((x) => x.filial === 'Cambuci').map((x) => [x.codigo, x.origem, x.destino, x.vendavel]), [['01', true, true, true], ['02', true, true, true], ['59', false, false, false], ['26', false, false, false]]);
  assert.match(A.erroDoArmazem(ef.lista, 'Cambuci', 'ZZ2', 'destino'), /ZZ2.*não existe na lista/s);
  assert.match(A.erroDoArmazem(ef.lista, 'Cambuci', '59', 'origem'), /não está liberado como origem/);
  assert.equal(A.erroDoArmazem(ef.lista, 'Cambuci', '1', 'origem'), '', '"1" é o 01');
  assert.equal(A.vendavel(ef.lista, 'Cambuci', '59'), false); assert.equal(A.vendavel(ef.lista, 'Cambuci', 'constructor'), false);
  assert.ok(A.normalizar([{ filial: 'Cambuci', codigo: '01', origem: true, destino: true }, { filial: 'Cambuci', codigo: '01', origem: true }], true).erro, 'repetido');
  assert.ok(A.normalizar({ armazens: [{ filial: '__proto__', codigo: '01' }] }, true).erro);
  assert.equal(A.efetiva({ armazens: 'lixo' }).padrao, true, 'arquivo quebrado: volta ao padrão conservador');
});
