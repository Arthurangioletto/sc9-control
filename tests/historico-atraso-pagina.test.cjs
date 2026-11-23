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
  assert.deepEqual(RG.registroDoDia(pedidos, new Date(2026, 10, 20), '2026-11-20', null, entrega).despachados['2026-11-19'], { pedidos: 2, pecas: 19.5 });
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
    const guardado = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'atraso-expedicao-' + mes + '.json'), 'utf8'));
    assert.equal(Object.keys(guardado.dias).length, 2);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
