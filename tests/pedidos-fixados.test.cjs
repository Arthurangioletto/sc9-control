const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const P = require('../pedidos-fixados.js');
const Store = require('../pedidos-fixados-store.js');

// 2026-11-23 é segunda-feira. Horário de Brasília = UTC-3.
const sp = (hh, mm, dia = '2026-11-23') => new Date(dia + 'T' + String(hh + 3).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':00.000Z');
const pedido = (extra) => Object.assign({ pedido: '355386', armazem: 'Cambuci', nome: 'CLIENTE X', transpNome: 'Retira 03', status: 'Pendente', nf: null, pickEnd: null, confEnd: null, dayKey: '2026-11-20', qt: 5 }, extra);

test('horário limite: Retira 02/03/04 às 16h; Brasil e São Paulo às 17h; o resto sem limite', () => {
  for (const n of ['Retira 02', 'RETIRA 03', 'retira 4', 'Retira 04']) assert.equal(P.limiteDaTransportadora(n), 16, n);
  for (const n of ['Brasil', 'brasil', 'São Paulo', 'SAO PAULO']) assert.equal(P.limiteDaTransportadora(n), 17, n);
  for (const n of ['Retira 01', 'TCS', 'Emergência', 'Velox Brasil', '', null, undefined]) assert.equal(P.limiteDaTransportadora(n), null, String(n));
});

test('relógio usa Brasília e sabe o que é dia útil', () => {
  assert.deepEqual(P.relogio(sp(15, 59)), { dia: '2026-11-23', min: 15 * 60 + 59, util: true });
  assert.equal(P.relogio(new Date('2026-11-24T02:30:00.000Z')).dia, '2026-11-23', '23h30 de Brasília ainda é dia 23');
  assert.equal(P.relogio(sp(10, 0, '2026-11-28')).util, false, 'sábado');
  assert.equal(P.relogio(sp(10, 0, '2026-11-29')).util, false, 'domingo');
});

test('avaliar: contagem regressiva, urgente, vencido, saiu, despachado e atrasado', () => {
  const retira = pedido();
  const a = (o, saida, hh, mm) => P.avaliar({ pedido: o.pedido }, o, saida || '', sp(hh, mm));
  const atrasadoComLimite = a(pedido({ status: 'Atrasado' }), '', 10, 0);
  assert.deepEqual([atrasadoComLimite.nivel, atrasadoComLimite.texto], ['atrasado', 'Faltam 6 h para o limite das 16h · em atraso há 3 dias'], 'atrasado, mas com o limite ainda longe');
  assert.equal(a(retira, '', 10, 0).nivel, 'ok');
  const noPrazo = pedido({ status: 'Pendente', dayKey: '2026-11-23' });
  assert.equal(a(noPrazo, '', 10, 0).nivel, 'ok');
  assert.equal(a(noPrazo, '', 10, 0).texto, 'Faltam 6 h para o limite das 16h');
  assert.equal(a(noPrazo, '', 14, 30).nivel, 'atencao', 'até 2 h antes');
  assert.equal(a(noPrazo, '', 14, 30).texto, 'Faltam 1 h 30 min para o limite das 16h');
  assert.equal(a(noPrazo, '', 15, 40).nivel, 'urgente', 'até 30 min antes');
  assert.equal(a(noPrazo, '', 15, 59).minutos, 1);
  assert.equal(a(noPrazo, '', 16, 1).nivel, 'vencido');
  assert.match(a(noPrazo, '', 16, 1).texto, /^Passou das 16h e ainda não saiu p\/ Expedição/);
  const brasil = pedido({ transpNome: 'Brasil', dayKey: '2026-11-23' });
  assert.equal(a(brasil, '', 16, 0).nivel, 'atencao', 'Brasil vai até as 17h');
  assert.equal(a(brasil, '', 16, 30).nivel, 'urgente');
  assert.equal(a(brasil, '', 17, 1).nivel, 'vencido');
  // saiu p/ Expedição: deixa de ser vencido
  const saiu = a(noPrazo, sp(15, 10).toISOString(), 16, 30);
  assert.equal(saiu.nivel, 'saiu'); assert.equal(saiu.saidaHoje, true); assert.equal(saiu.texto, 'Saiu p/ Expedição às 15:10'); assert.equal(saiu.etapa, 'saida');
  assert.match(a(noPrazo, sp(15, 10, '2026-11-20').toISOString(), 16, 30).texto, /^Saiu p\/ Expedição em 20\/11 às 15:10$/);
  // despachado é concluído (mesmo com saída)
  assert.equal(a(pedido({ status: 'Enviado' }), sp(15, 0).toISOString(), 16, 30).nivel, 'concluido');
  // fim de semana: limite não vale
  const sab = P.avaliar({ pedido: '1234' }, noPrazo, '', sp(16, 30, '2026-11-28'));
  assert.equal(sab.nivel, 'info'); assert.match(sab.texto, /só vale em dia útil/);
  // lista de atrasados ignora o limite
  assert.equal(P.avaliar(null, pedido({ status: 'Atrasado' }), '', sp(16, 30), { semLimite: true }).nivel, 'atrasado');
  // sem limite e atrasado
  const tcs = pedido({ transpNome: 'TCS', status: 'Atrasado' });
  const t = a(tcs, '', 10, 0);
  assert.equal(t.nivel, 'atrasado'); assert.equal(t.dias, 3); assert.match(t.texto, /^Em atraso há 3 dias · /);
  // pedido que não está na base
  const nao = P.avaliar({ pedido: '999999' }, undefined, '', sp(10, 0));
  assert.deepEqual([nao.etapa, nao.nivel, nao.texto], ['nao-achado', 'info', 'Não está na base carregada']);
});

test('etapas do pedido', () => {
  const e = (o, s) => P.etapaDoPedido(o, s || '');
  assert.equal(e(pedido()), 'aberto');
  assert.equal(e(pedido({ pickEnd: new Date() })), 'separado');
  assert.equal(e(pedido({ pickEnd: new Date(), confEnd: new Date() })), 'conferido');
  assert.equal(e(pedido({ nf: '1' })), 'faturado');
  assert.equal(e(pedido({ nf: '1' }), '2026-11-23T12:00:00Z'), 'saida');
  assert.equal(e(pedido({ status: 'Enviado' }), '2026-11-23T12:00:00Z'), 'despachado');
  assert.equal(e(undefined), 'nao-achado');
  assert.equal(P.avaliar({ pedido: '1' }, pedido({ pickEnd: new Date(), confEnd: new Date() }), '', sp(10, 0)).passo, 2);
});

test('ordem: vencidos primeiro, depois urgentes, atenção, atrasados, saíram, no prazo e concluídos', () => {
  const lista = [
    P.avaliar({ pedido: '1001' }, pedido({ pedido: '1001', transpNome: 'TCS' }), '', sp(16, 30)),
    P.avaliar({ pedido: '1002' }, pedido({ pedido: '1002', status: 'Enviado' }), '', sp(16, 30)),
    P.avaliar({ pedido: '1003' }, pedido({ pedido: '1003', dayKey: '2026-11-23' }), '', sp(16, 30)),
    P.avaliar({ pedido: '1004' }, pedido({ pedido: '1004', transpNome: 'Brasil', dayKey: '2026-11-23' }), '', sp(16, 40)),
    P.avaliar({ pedido: '1005' }, pedido({ pedido: '1005', transpNome: 'TCS', status: 'Atrasado' }), '', sp(16, 30))
  ];
  assert.deepEqual(P.ordenar(lista).map(a => a.pedido), ['1003', '1004', '1005', '1001', '1002']);
});

test('alarme: avisa 60 e 15 min antes, vencido a cada 30 min, saiu e resumo do dia, sem repetir', () => {
  const ja = new Set();
  const noPrazo = pedido({ pedido: '4001', dayKey: '2026-11-23' });
  const rodar = (hh, mm, saida) => {
    const f = [P.avaliar({ pedido: '4001' }, noPrazo, saida || '', sp(hh, mm))];
    const ev = P.eventosDoAlarme(f, sp(hh, mm), ja, P.resumoDosFixados(f, 7));
    ev.forEach(e => ja.add(e.chave));
    return ev;
  };
  const e1 = rodar(9, 0);
  assert.deepEqual(e1.map(e => e.titulo), ['Pedidos fixados de hoje'], 'só o resumo do dia, cedo demais para o limite');
  assert.equal(e1[0].texto, '1 pedido fixado · 1 com limite hoje · 7 em atraso na base');
  assert.deepEqual(rodar(9, 30), [], 'resumo não repete');
  const e2 = rodar(15, 0);
  assert.equal(e2.length, 1); assert.equal(e2[0].titulo, 'Pedido 4001: faltam 1 h'); assert.equal(e2[0].grave, false);
  assert.deepEqual(rodar(15, 20), [], 'o aviso de 60 min não repete');
  const e3 = rodar(15, 50);
  assert.equal(e3.length, 1); assert.equal(e3[0].titulo, 'Pedido 4001: faltam 10 min'); assert.equal(e3[0].grave, true);
  const e4 = rodar(16, 5);
  assert.equal(e4.length, 1); assert.equal(e4[0].titulo, 'Pedido 4001 VENCIDO'); assert.equal(e4[0].grave, true);
  assert.deepEqual(rodar(16, 20), [], 'dentro da mesma meia hora não repete');
  assert.equal(rodar(16, 40).length, 1, 'repete a cada 30 minutos');
  const e5 = rodar(16, 45, sp(16, 44).toISOString());
  assert.deepEqual(e5.map(e => e.titulo), ['Pedido 4001 saiu p/ Expedição'], 'saiu p/ Expedição avisa uma vez e para o alarme de vencido');
  assert.match(e5[0].texto, /^Saiu p\/ Expedição às 16:44 · CLIENTE X$/);
  assert.deepEqual(rodar(17, 30, sp(16, 44).toISOString()), []);
  // outro dia, tudo de novo
  const f = [P.avaliar({ pedido: '4001' }, pedido({ pedido: '4001', dayKey: '2026-11-24' }), '', sp(9, 0, '2026-11-24'))];
  assert.equal(P.eventosDoAlarme(f, sp(9, 0, '2026-11-24'), ja, P.resumoDosFixados(f, 0)).length, 1);
});

test('sem pedidos na base não inventa aviso de horário', () => {
  const f = [P.avaliar({ pedido: '4001' }, undefined, '', sp(16, 30))];
  assert.deepEqual(P.eventosDoAlarme(f, sp(16, 30), new Set(), null), []);
});

test('lista de fixados: valida número, não repete, tem limite e só mexe no que foi pedido', () => {
  assert.equal(Store.numeroDoPedido('000355386'), '355386');
  assert.equal(Store.numeroDoPedido('12'), null);
  assert.equal(Store.numeroDoPedido('abc'), null);
  let r = Store.aplicar([], { acao: 'fixar', pedido: '355386', nota: '  cliente   VIP \n' }, 'arthur', 1763900000000);
  assert.deepEqual(r.itens.map(i => [i.pedido, i.nota, i.por]), [['355386', 'cliente VIP', 'arthur']]);
  r = Store.aplicar(r.itens, { acao: 'fixar', pedido: '0355386' }, 'victor', 1);
  assert.equal(r.itens.length, 1, 'não duplica');
  assert.equal(r.itens[0].por, 'arthur', 'mantém quem fixou primeiro');
  r = Store.aplicar(r.itens, { acao: 'fixar', pedido: '777777' }, 'victor', 2);
  assert.deepEqual(r.itens.map(i => i.pedido), ['777777', '355386'], 'o mais novo vai para cima');
  r = Store.aplicar(r.itens, { acao: 'nota', pedido: '355386', nota: 'ligar para o cliente' }, 'x', 3);
  assert.equal(r.itens[1].nota, 'ligar para o cliente');
  assert.ok(Store.aplicar(r.itens, { acao: 'nota', pedido: '111111', nota: 'x' }, 'x', 3).erro, 'nota de pedido não fixado dá erro');
  r = Store.aplicar(r.itens, { acao: 'remover', pedido: '355386' }, 'x', 4);
  assert.deepEqual(r.itens.map(i => i.pedido), ['777777']);
  assert.ok(Store.aplicar([], { acao: 'fixar', pedido: '12' }, 'x', 1).erro);
  assert.ok(Store.aplicar([], { acao: 'apagar-tudo', pedido: '123456' }, 'x', 1).erro);
  const cheio = Array.from({ length: Store.MAX_FIXADOS }, (_, i) => ({ pedido: String(100000 + i), nota: '', por: 'a', em: '2026-11-23T00:00:00.000Z' }));
  assert.ok(Store.aplicar(cheio, { acao: 'fixar', pedido: '999999' }, 'x', 1).erro, 'passou do limite');
  assert.deepEqual(Store.normalizarLista({ itens: [{ pedido: '123456', nota: 5 }, { pedido: 'x' }, null, { pedido: '123456' }] }).map(i => [i.pedido, i.nota]), [['123456', '']]);
});

test('servidor: pedidos fixados exigem login, guardam a lista e mostram a Saída p/ Expedição', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-fixados-'));
  for (const name of ['server.js', 'stock-position.js', 'inventory-integrity.js', 'atraso-historico.js', 'pedidos-fixados-store.js']) fs.copyFileSync(path.join(__dirname, '..', name), path.join(dir, name));
  const data = path.join(dir, 'data');
  fs.mkdirSync(data);
  const hoje = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  fs.writeFileSync(path.join(data, 'saida-dias.json'), JSON.stringify({ dias: [hoje], exportados: {}, pendentes: {} }));
  fs.writeFileSync(path.join(data, 'saida-pv-' + hoje + '.json'), JSON.stringify({ dia: hoje, versao: 1, removidos: [], entries: [{ id: 'a', pedido: '0355386', registradoEm: hoje + 'T18:00:00.000Z', info: null }] }));
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const sem = await fetch(base + '/api/pedidos-fixados');
    assert.equal(sem.status, 401, 'sem login não lê');
    assert.equal((await fetch(base + '/api/pedidos-fixados', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1' }, body: '{}' })).status, 401);
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1' }, body: JSON.stringify({ password: process.env.APP_PASSWORD }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const chamar = async (corpo) => { const r = await fetch(base + '/api/pedidos-fixados', { method: corpo ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1', Cookie: cookie }, body: corpo ? JSON.stringify(corpo) : undefined }); return { status: r.status, data: await r.json() }; };
    assert.deepEqual((await chamar()).data.itens, []);
    let r = await chamar({ acao: 'fixar', pedido: '355386', nota: 'acompanhar' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.itens.map(i => [i.pedido, i.nota]), [['355386', 'acompanhar']]);
    assert.equal(r.data.saidas['355386'], hoje + 'T18:00:00.000Z', 'achou na Saída p/ Expedição ignorando zeros à esquerda');
    r = await chamar({ acao: 'fixar', pedido: '888888' });
    assert.deepEqual(Object.keys(r.data.saidas), ['355386'], 'só devolve a saída de quem foi fixado e está lá');
    assert.equal((await chamar({ acao: 'fixar', pedido: '12' })).status, 400);
    assert.equal((await chamar({ acao: 'xyz', pedido: '123456' })).status, 400);
    assert.equal((await chamar()).data.itens.length, 2, 'a lista fica guardada');
    r = await chamar({ acao: 'remover', pedido: '355386' });
    assert.deepEqual(r.data.itens.map(i => i.pedido), ['888888']);
    assert.ok(fs.existsSync(path.join(data, 'pedidos-fixados.json')));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
