const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const RG = require('../relatorio-geral-xlsx.js');
const HP = require('../historico-atraso.js');

test('faturados por dia: pedidos e peças pelo dia da emissão da nota, cada pedido uma vez', () => {
  const pedidos = [
    { pedido: 'A1', armazem: 'Cambuci', nf: '885234.0', qt: 5 }, { pedido: 'A1', armazem: 'Cambuci', nf: '885234', qt: 2 },
    { pedido: 'A2', armazem: 'Cambuci', nf: '886039', qt: 3.5 }, { pedido: 'A3', armazem: 'BH', nf: '000887', qt: 4 },
    { pedido: 'A4', armazem: 'BH', nf: '', qt: 9 }, { pedido: 'A5', armazem: 'BH', nf: '999', qt: 1 }
  ];
  const fat = new Map([['885234', new Date(2026, 10, 20, 10)], ['886039', new Date(2026, 10, 20, 15)], ['887', new Date(2026, 10, 19, 9)]]);
  assert.deepEqual(RG.faturadosPorDia(pedidos, fat), { '2026-11-20': { pedidos: 2, pecas: 8.5 }, '2026-11-19': { pedidos: 1, pecas: 4 } });
  assert.deepEqual(RG.faturadosPorDia(pedidos, null), {}, 'sem SF2 não inventa');
  const reg = RG.registroDoDia(pedidos, new Date(2026, 10, 20), '2026-11-20', null, null, { faturamento: fat });
  assert.equal(reg.faturados['2026-11-20'].pedidos, 2, 'vai junto da foto do dia');
});

test('página: faturados por dia entram nos dias do mês e podem passar dos despachados', () => {
  const p = HP.preparar({ meses: {}, expedicao: { '2026-11': { '2026-11-20': { pedidos: 3, pecas: 10 } } }, faturados: { '2026-11': { '2026-11-20': { pedidos: 8, pecas: 30 }, '2026-11-21': { pedidos: 5, pecas: 12 } } }, saidas: {}, entregues: {} });
  assert.equal(p.fat['2026-11-20'].pedidos, 8);
  assert.deepEqual(p.meses, ['2026-11']);
});

test('servidor: guarda os faturados por dia no arquivo do mês sem apagar os despachados e devolve na leitura', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-fat-'));
  for (const name of ['server.js', 'stock-position.js', 'inventory-integrity.js', 'atraso-historico.js', 'ocorrencias-store.js']) fs.copyFileSync(path.join(__dirname, '..', name), path.join(dir, name));
  fs.mkdirSync(path.join(dir, 'data'));
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const hoje = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const mes = hoje.slice(0, 7), dia1 = mes + '-01', dia2 = mes + '-02';
  try {
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1' }, body: JSON.stringify({ password: process.env.APP_PASSWORD }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const post = async (corpo) => (await fetch(base + '/api/atraso-historico', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1', Cookie: cookie }, body: JSON.stringify(corpo) })).status;
    assert.equal(await post({ dia: hoje, total: 5, pecas: 1, itens: [], despachados: { [dia1]: { pedidos: 4, pecas: 20 } }, faturados: { [dia1]: { pedidos: 9, pecas: 40 }, [dia2]: { pedidos: 6, pecas: 25 }, lixo: { pedidos: 1 }, [mes + '-03']: { pedidos: 0 } } }), 200);
    assert.equal(await post({ dia: hoje, total: 5, pecas: 1, itens: [], despachados: { [dia2]: { pedidos: 2, pecas: 8 } }, faturados: { [dia1]: { pedidos: 7, pecas: 30 } } }), 200);
    const j = await (await fetch(base + '/api/atraso-historico?meses=2', { headers: { Cookie: cookie } })).json();
    assert.deepEqual(j.faturados[mes], { [dia1]: { pedidos: 9, pecas: 40 }, [dia2]: { pedidos: 6, pecas: 25 } }, 'vale o maior do dia; lixo e zero ficam de fora');
    assert.deepEqual(j.expedicao[mes], { [dia1]: { pedidos: 4, pecas: 20 }, [dia2]: { pedidos: 2, pecas: 8 } }, 'os despachados continuam');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
