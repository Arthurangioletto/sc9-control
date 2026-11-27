const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

// Onda 2 das vendedoras: tipos novos da Central (sair hoje, saída especial, subir pedido, falta de item, erro, subtipos de nota), lote de pedidos (um protocolo,
// concluir por pedido), motoboy aguardando aprovação, modelos rápidos por login e ataques (constructor, __proto__, lista gigante).
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

const amanha = () => new Date(Date.now() + 36 * 3600000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

const sol = (call, U, token, corpo) => call(U('solicitacao'), Object.assign({ pedidoPor: 'Ana' }, corpo), { token });

test('tipos novos: dados validados no servidor, área e prazo padrão, prioridade inicial; tipo "constructor"/"__proto__" recusado', async () => {
  const { call, U, novaConta, equipe, fechar } = await subir();
  try {
    const ana = await novaConta('Ana', 'ana.v'), logi = await equipe('logi', ['ocorrencias']);
    const v = (extra) => sol(call, U, ana, extra);
    for (const tipo of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) assert.equal((await v({ tipo, pedido: '400001', dados: {} })).status, 400, tipo);
    const ruins = [
      [{ tipo: 'sair_hoje', pedido: '400001', dados: {} }, /motivo/i], [{ tipo: 'sair_hoje', pedido: '400001', dados: { motivo: 'constructor' } }, /motivo/i],
      [{ tipo: 'sair_hoje', pedido: '400001', dados: { motivo: 'outro' } }, /recado/i],
      [{ tipo: 'saida_especial', pedido: '400001', dados: { modo: 'retirada' } }, /quem|retirar/i], [{ tipo: 'saida_especial', pedido: '400001', dados: { modo: 'retirada', quem: 'João', dia: '2020-01-01' } }, /passado/],
      [{ tipo: 'saida_especial', pedido: '400001', dados: { modo: 'outra_transportadora' } }, /transportadora/i], [{ tipo: 'saida_especial', pedido: '400001', dados: { modo: 'saida_filial', filial: 'Marte' } }, /filial/i],
      [{ tipo: 'saida_especial', pedido: '400001', dados: { modo: '__proto__' } }, /como o pedido vai sair/i],
      [{ tipo: 'subir_pedido', dados: { pv: '', onde: 'no e-mail' } }, /PV/i], [{ tipo: 'subir_pedido', dados: { pv: 'PV-123', onde: '' } }, /onde/i],
      [{ tipo: 'falta_item', pedido: '400001', dados: { acao: 'cortar' } }, /produto/i], [{ tipo: 'falta_item', pedido: '400001', dados: { acao: 'cortar', itens: [{ produto: '10.100', qt: 0 }] } }, /1 a 99999/],
      [{ tipo: 'falta_item', pedido: '400001', dados: { acao: 'substituir', itens: [{ produto: '10.100', qt: 1 }] } }, /substituir/i],
      [{ tipo: 'falta_item', pedido: '400001', dados: { acao: 'cortar', itens: [{ produto: '10.100', qt: 1 }, { produto: '10.100', qt: 2 }] } }, /mais de uma vez/],
      [{ tipo: 'erro_pedido', pedido: '400001', dados: { modo: 'erro' } }, /o que/i], [{ tipo: 'nota_fiscal', pedido: '400004', dados: { subtipo: 'inventado', o_que: 'x'.repeat(10) } }, /tipo de pedido sobre a nota/i]
    ];
    const contas = [ana, await novaConta('Bia', 'bia.v'), await novaConta('Cida', 'cida.v')];
    let n = 0; for (const [corpo, re] of ruins) { const r = await sol(call, U, contas[n++ % 3], corpo); assert.equal(r.status, 400, JSON.stringify(corpo)); assert.match(r.data.error, re); }
    const dia = amanha();
    const dani = await novaConta('Dani', 'dani.v'), edu = await novaConta('Edu', 'edu.v'), fabi = await novaConta('Fabi', 'fabi.v');
    const sair = await sol(call, U, dani, { tipo: 'sair_hoje', pedido: '400001', dados: { motivo: 'cliente_aguardando' }, paraQuando: { tipo: 'hoje_coleta' } });
    assert.equal(sair.status, 200);
    const ret = await sol(call, U, dani, { tipo: 'saida_especial', pedido: '400002', dados: { modo: 'retirada', quem: 'João da Silva', dia, hora: '14:30', lixo: 'x' } });
    assert.equal(ret.status, 200); assert.deepEqual(Object.keys(ret.data.linha.dados).sort(), ['dia', 'hora', 'modo', 'quem'], 'campos que não são do tipo ficam de fora');
    const sedex = await sol(call, U, edu, { tipo: 'saida_especial', pedido: '400003', dados: { modo: 'sedex', quem: 'ignorado', detalhe: 'caixa pequena' } });
    assert.equal(sedex.status, 200); assert.ok(!('quem' in sedex.data.linha.dados), 'quem só vale na retirada'); assert.equal(sedex.data.linha.status, 'recebida');
    const moto = await sol(call, U, edu, { tipo: 'saida_especial', pedido: '400004', dados: { modo: 'motoboy' } });
    assert.equal(moto.status, 200); assert.equal(moto.data.linha.status, 'aguardando_aprovacao', 'motoboy urgente espera a equipe');
    const subir = await sol(call, U, fabi, { tipo: 'subir_pedido', dados: { pv: 'PV-7788', filial: 'Tamboré', onde: 'No e-mail de hoje, pasta Vendas' } });
    assert.equal(subir.status, 200); assert.equal(subir.data.linha.dados.filial, 'Tambore'); assert.equal(subir.data.linha.pedido, '');
    const falta = await sol(call, U, fabi, { tipo: 'falta_item', pedido: '400001', dados: { acao: 'cortar', itens: [{ produto: '10.100', qt: 3, descricao: 'MENTIRA' }, { produto: '99.999', qt: 1 }] } });
    assert.equal(falta.status, 200); assert.equal(falta.data.linha.dados.itens[0].descricao, 'Cabo de Aço 8 mm', 'a descrição vem do catálogo, não do aparelho'); assert.equal(falta.data.linha.dados.itens[1].descricao, '');
    const erro = await sol(call, U, fabi, { tipo: 'erro_pedido', pedido: '400002', dados: { modo: 'revisao', o_que: 'confira a quantidade do item 2' } });
    assert.equal(erro.status, 200);
    const nf = await sol(call, U, ana, { tipo: 'nota_fiscal', pedido: '400004', dados: { subtipo: 'segunda_via' } });
    assert.equal(nf.status, 200, 'segunda via não exige explicação'); assert.equal(nf.data.linha.dados.subtipo, 'segunda_via');
    const antigo = await sol(call, U, ana, { tipo: 'nota_fiscal', pedido: '400004', dados: { o_que: 'reemitir a nota (formato antigo, sem subtipo)' } });
    assert.equal(antigo.status, 200, 'o formato antigo continua valendo');
    // aparecem na caixa de entrada da equipe, no dashboard e no CSV
    const lista = (await call('/api/solicitacoes', null, { cookie: logi })).data;
    const por = (r) => lista.ativos.find((l) => l.id === r.data.linha.id);
    assert.deepEqual([por(sair).area, por(sair).prioridade, por(sair).slaMin], ['estoque', 'urgente', 60], 'sair hoje: estoque, urgente por ser para hoje, 1 h');
    assert.deepEqual([por(ret).area, por(ret).slaMin], ['expedicao', 60]); assert.deepEqual([por(moto).prioridade, por(moto).status], ['alta', 'aguardando_aprovacao']);
    assert.deepEqual([por(subir).area, por(erro).area, por(erro).slaMin], ['faturamento', 'expedicao', 120]);
    const tipos = new Set(lista.ativos.map((l) => l.tipo)); for (const t of ['sair_hoje', 'saida_especial', 'subir_pedido', 'falta_item', 'erro_pedido', 'nota_fiscal']) assert.ok(tipos.has(t), t);
    const dash = (await call('/api/solicitacoes/dashboard?dias=7', null, { cookie: logi })).data;
    for (const t of ['sair_hoje', 'saida_especial', 'subir_pedido', 'falta_item', 'erro_pedido']) assert.ok(dash.porTipo.some((x) => x.tipo === t && x.total >= 1), 'dashboard: ' + t);
    const csv = (await call('/api/solicitacoes/exportar', null, { cookie: logi })).texto;
    for (const t of ['sair_hoje', 'saida_especial', 'subir_pedido', 'falta_item', 'erro_pedido']) assert.ok(csv.includes(require('../solicitacoes-store.js').TIPOS[t].rotulo), 'csv: ' + t);
    // a equipe aprova o motoboy
    const ap = await call('/api/solicitacoes', { id: moto.data.linha.id, acao: 'status', status: 'em_andamento', resposta: 'Aprovado, motoboy às 15h' }, { cookie: logi });
    assert.equal(ap.status, 200); assert.equal(ap.data.ativos.find((l) => l.id === moto.data.linha.id).status, 'em_andamento');
    assert.equal(ret.data.linha.dados.dia, dia);
  } finally { await fechar(); }
});

test('lote de pedidos: um protocolo, normalizado e sem duplicados; limite de 20; a logística conclui por pedido e a solicitação conclui sozinha no fim', async () => {
  const { call, U, novaConta, equipe, fechar } = await subir();
  try {
    const ana = await novaConta('Ana', 'ana.v'), bia = await novaConta('Bia', 'bia.v'), logi = await equipe('logi', ['ocorrencias']);
    const v = (token, corpo) => sol(call, U, token, corpo);
    const ruins = [
      [{ tipo: 'segurar_pedido', pedidos: 'x', dados: { motivo: 'cliente confirma' } }, /inválida/], [{ tipo: 'segurar_pedido', pedidos: ['400001', 'abc'], dados: { motivo: 'cliente confirma' } }, /não é um pedido válido/],
      [{ tipo: 'segurar_pedido', pedidos: ['400001', { a: 1 }], dados: { motivo: 'cliente confirma' } }, /inválida/], [{ tipo: 'segurar_pedido', pedidos: ['400001', null], dados: { motivo: 'cliente confirma' } }, /inválida/],
      [{ tipo: 'consulta_estoque', pedidos: ['400001', '400002'], dados: { produto: '10.100', qt: 1 } }, /um pedido por vez/],
      [{ tipo: 'segurar_pedido', pedidos: Array.from({ length: 21 }, (_, i) => String(500100 + i)), dados: { motivo: 'cliente confirma' } }, /No máximo 20/],
      [{ tipo: 'segurar_pedido', pedidos: Array.from({ length: 500 }, (_, i) => String(600000 + i)), dados: { motivo: 'cliente confirma' } }, /No máximo 20/],
      [{ tipo: 'segurar_pedido', pedidos: ['9'.repeat(5000)], dados: { motivo: 'cliente confirma' } }, /não é um pedido válido/]
    ];
    for (const [corpo, re] of ruins) { const r = await v(ana, corpo); assert.equal(r.status, 400, JSON.stringify(corpo).slice(0, 80)); assert.match(r.data.error, re); }
    const ok = await v(bia, { tipo: 'segurar_pedido', pedidos: ['400001', '0400002', '400002', '400003.0', ' 400004 '], dados: { motivo: 'o cliente vai confirmar o endereço' } });
    assert.equal(ok.status, 200);
    const l = ok.data.linha;
    assert.equal(l.pedido, '400001', 'o pedido singular é o primeiro'); assert.deepEqual(l.pedidos.map((p) => p.pedido), ['400001', '400002', '400003', '400004'], 'sem duplicados e normalizado');
    assert.deepEqual(l.pedidos.map((p) => p.etapa), ['nao_separado', 'em_separacao', 'separado', 'faturado'].map((e, i) => l.pedidos[i].etapa), 'cada pedido guarda a etapa de quando foi pedido'); assert.ok(l.pedidos.every((p) => p.etapa));
    assert.match(l.protocolo, /^S-\d{6}-\d{3}$/);
    assert.equal((await v(bia, { tipo: 'segurar_pedido', pedido: '400001', dados: { motivo: 'de novo o mesmo pedido' } })).status, 400, 'o mesmo pedido ainda ativo em outra solicitação é recusado, como sempre');
    const mine = (await call(U('solicitacoes?ids=' + l.id), null, { token: bia })).data.ativas.find((x) => x.id === l.id);
    assert.equal(mine.pedidos.length, 4); assert.ok(!JSON.stringify(mine).includes('concluidoPor') || mine.pedidos.every((p) => p.concluido === false));
    const acao = (corpo) => call('/api/solicitacoes', Object.assign({ id: l.id }, corpo), { cookie: logi });
    assert.equal((await acao({ acao: 'concluir_pedido', pedido: '999999' })).status, 400, 'pedido que não é da solicitação');
    assert.equal((await acao({ acao: 'concluir_pedido', pedido: 'constructor' })).status, 400);
    for (const p of ['400001', '400002', '400003']) { const r = await acao({ acao: 'concluir_pedido', pedido: p }); assert.equal(r.status, 200); assert.equal(r.data.ativos.find((x) => x.id === l.id).status === 'concluida', false, 'ainda faltam pedidos'); }
    const fim = await acao({ acao: 'concluir_pedido', pedido: '400004' });
    const depois = fim.data.ativos.concat(fim.data.demais).find((x) => x.id === l.id);
    assert.equal(depois.status, 'concluida', 'todos atendidos: conclui sozinha'); assert.ok(depois.pedidos.every((p) => p.concluido));
    const reabre = await acao({ acao: 'concluir_pedido', pedido: '400002', desfazer: true });
    assert.equal(reabre.data.ativos.find((x) => x.id === l.id).status, 'em_andamento', 'reabrir um pedido reabre a solicitação');
    const csv = (await call('/api/solicitacoes/exportar', null, { cookie: logi })).texto; assert.ok(csv.includes('400003'), 'o CSV lista os pedidos do lote');
    // sem lote nada muda: pedido singular de sempre
    const um = await v(ana, { tipo: 'alterar_pedido', pedido: '400002', dados: { o_que: 'trocar o endereço de entrega' } });
    assert.equal(um.status, 200); assert.deepEqual(um.data.linha.pedidos, []);
  } finally { await fechar(); }
});

test('modelos rápidos: só com login, por vendedora, limpos e limitados; sem login o servidor manda ficar no aparelho', async () => {
  const { call, U, novaConta, fechar } = await subir();
  try {
    const ana = await novaConta('Ana', 'ana.v'), bia = await novaConta('Bia', 'bia.v');
    assert.equal((await call('/api/vendedoras/modelos?k=errado')).status, 401); assert.equal((await call(U('modelos'))).status, 401, 'sem login: fica no aparelho');
    const salvar = (token, modelo) => call(U('modelos'), { acao: 'salvar', modelo }, { token });
    assert.equal((await salvar(ana, { nome: 'x', tipo: 'sair_hoje' })).status, 400, 'nome curto');
    for (const tipo of ['constructor', '__proto__', 'inventado', '', null]) assert.equal((await salvar(ana, { nome: 'Modelo ruim', tipo })).status, 400, String(tipo));
    assert.equal((await call(U('modelos'), { acao: 'apagar-tudo' }, { token: ana })).status, 400);
    const m = await salvar(ana, { nome: 'Cliente retira hoje', tipo: 'saida_especial', dados: { modo: 'retirada', quem: 'João', dia: '2020-01-01', lixo: '<script>alert(1)</script>', pedido: '400001' }, texto: 'avisar na portaria', paraQuando: { tipo: 'data', data: '2099-01-01' }, pedidos: ['400001'] });
    assert.equal(m.status, 200); const mod = m.data.modelo;
    assert.deepEqual(Object.keys(mod.dados).sort(), ['dia', 'modo', 'quem'], 'só campos do tipo (lixo e pedido ficam de fora)');
    assert.equal(mod.paraQuando, null, 'data fixa não vira modelo (ia vencer)'); assert.ok(!('pedidos' in mod) && !('pedido' in mod), 'o modelo não guarda pedido');
    assert.equal((await salvar(ana, { nome: 'cliente retira hoje', tipo: 'sair_hoje', dados: { motivo: 'retirada' } })).status, 400, 'nome repetido');
    assert.equal((await salvar(ana, { nome: 'Sair às 16h', tipo: 'sair_hoje', dados: { motivo: 'prazo_combinado' }, paraQuando: { tipo: 'hoje_16h' } })).data.modelos.length, 2);
    assert.deepEqual((await call(U('modelos'), null, { token: bia })).data.modelos, [], 'cada vendedora só vê os dela');
    assert.equal((await call(U('modelos'), null, { token: ana })).data.modelos.length, 2);
    for (let i = 0; i < 18; i++) assert.equal((await salvar(ana, { nome: 'Modelo ' + (i + 10), tipo: 'outro', dados: {}, texto: 'texto ' + i })).status, 200);
    const cheio = await salvar(ana, { nome: 'Um a mais', tipo: 'outro' }); assert.equal(cheio.status, 400); assert.match(cheio.data.error, /20 modelos/);
    const apagado = await call(U('modelos'), { acao: 'apagar', id: mod.id }, { token: bia }); assert.equal(apagado.data.modelos.length, 0, 'apagar com o id de outra pessoa não mexe nos dela');
    assert.equal((await call(U('modelos'), null, { token: ana })).data.modelos.length, 20);
    const ap = await call(U('modelos'), { acao: 'apagar', id: mod.id }, { token: ana }); assert.equal(ap.data.modelos.length, 19);
  } finally { await fechar(); }
});

test('vendedoras-modelos.js: arquivo adulterado é limpo (login "__proto__", modelos demais, tipos inválidos)', () => {
  const VM = require('../vendedoras-modelos.js');
  const arq = VM.normalizarArquivo({ contas: [{ login: '__proto__', modelos: [{ id: 'a', nome: 'Ok', tipo: 'outro' }, { id: 'b', nome: 'Ruim', tipo: 'constructor' }, { id: 'a', nome: 'Repetido', tipo: 'outro' }] }, { login: 'ana', modelos: Array.from({ length: 80 }, (_, i) => ({ id: 'm' + i, nome: 'Modelo ' + i, tipo: 'outro' })) }, null, 'lixo'] });
  assert.equal(arq.contas.length, 2); assert.equal(VM.doLogin(arq, '__proto__').length, 1); assert.equal(VM.doLogin(arq, 'ANA').length, VM.MAX_MODELOS); assert.deepEqual(VM.doLogin(arq, 'ninguem'), []);
  assert.deepEqual(VM.normalizarArquivo(null).contas, []); assert.deepEqual(VM.normalizarArquivo({ contas: 'x' }).contas, []);
});
