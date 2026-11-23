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
  const texto = H.csv([['1001', 'Cambuci "A"', '2026-11-10', 5.5, 'F', 'P', 9, '']]);
  assert.ok(texto.startsWith('﻿"Pedido";"Armazém"'));
  const linhas = texto.slice(1).split('\r\n');
  assert.equal(linhas[1], '"1001";"Cambuci ""A""";"10/11/2026";"5,5";"Faturamento";"Em processo";"9";""');
});

test('a página é servida, a rota devolve despacho por dia sem repetir pedido e guarda o resumo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-histpag-'));
  for (const name of ['server.js', 'stock-position.js', 'inventory-integrity.js', 'atraso-historico.js', 'historico-atraso.html', 'historico-atraso.js', 'atraso-historico-xlsx.js']) fs.copyFileSync(path.join(__dirname, '..', name), path.join(dir, name));
  const data = path.join(dir, 'data');
  fs.mkdirSync(data);
  const mes = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date()).slice(0, 7);
  const d1 = mes + '-03', d2 = mes + '-04', antigo = mes + '-02';
  const entrada = (pedido, pecas) => ({ id: 'e' + pedido + pecas, pedido, registradoEm: d1 + 'T15:00:00Z', info: pecas == null ? null : { pecas } });
  fs.writeFileSync(path.join(data, 'saida-dias.json'), JSON.stringify({ dias: [d1, d2], exportados: {}, pendentes: {} }));
  fs.writeFileSync(path.join(data, 'saida-pv-' + d1 + '.json'), JSON.stringify({ dia: d1, versao: 1, removidos: [], entries: [entrada('5001', 10), entrada('5002', 4.5), entrada('5001', 99), entrada('5003', null)] }));
  fs.writeFileSync(path.join(data, 'saida-pv-' + d2 + '.json'), JSON.stringify({ dia: d2, versao: 1, removidos: [], entries: [entrada('6001', 7)] }));
  // um dia cujo arquivo de saída já foi exportado e apagado: o resumo guardado continua valendo
  fs.writeFileSync(path.join(data, 'atraso-expedicao-' + mes + '.json'), JSON.stringify({ mes, dias: { [antigo]: { pedidos: 30, pecas: 800 } } }));
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const pagina = await fetch(base + '/historico-atraso.html');
    assert.equal(pagina.status, 200);
    assert.match(await pagina.text(), /Histórico de Atraso/);
    assert.equal((await fetch(base + '/historico-atraso.js')).status, 200);
    assert.equal((await fetch(base + '/api/atraso-historico')).status, 401, 'sem login a página não lê dados');
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1' }, body: JSON.stringify({ password: process.env.APP_PASSWORD }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const r = await fetch(base + '/api/atraso-historico', { headers: { Cookie: cookie } });
    const j = await r.json();
    assert.deepEqual(j.expedicao[mes][d1], { pedidos: 3, pecas: 14.5 }, 'pedido repetido conta uma vez; sem dados do SC9 conta 0 peça');
    assert.deepEqual(j.expedicao[mes][d2], { pedidos: 1, pecas: 7 });
    assert.deepEqual(j.expedicao[mes][antigo], { pedidos: 30, pecas: 800 }, 'resumo de dia apagado da saída continua');
    const guardado = JSON.parse(fs.readFileSync(path.join(data, 'atraso-expedicao-' + mes + '.json'), 'utf8'));
    assert.equal(Object.keys(guardado.dias).length, 3, 'os dias somados ficam guardados');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
