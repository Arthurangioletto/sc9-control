const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const H = require('../historico-atraso.js');
const P = require('../atraso-painel.js');
const Oc = require('../ocorrencias-store.js');
const AH = require('../atraso-historico.js');

// [pedido, armazém, liberadoEm, peças, 'E'|'F', 'A'|'P', dias, transportadora, extras]
const it = (ped, arm, pecas, tipo, dias, extra, transp) => [ped, arm, '2026-11-01', pecas, tipo, 'A', dias, transp || 'TCS', extra || {}];
const reg = (dia, total, itens) => ({ dia, total, pecas: 0, atualizadoEm: dia + 'T20:00:00.000Z', itens });
const dados = () => ({
  meses: { '2026-11': { mes: '2026-11', dias: {
    '2026-11-16': reg('2026-11-16', 200, [it('1', 'Cambuci', 10, 'E', 2, { e: 'S' }), it('2', 'BH', 5, 'E', 6, { e: 'C' }), it('3', 'BH', 7, 'F', 9, { e: 'D', nf: '8', v: 250 }), it('4', 'Cambuci', 1, 'F', 20, { e: 'D', nf: '9', v: 100 })]),
    '2026-11-19': reg('2026-11-19', 200, [it('2', 'BH', 5, 'E', 9, { e: 'C' }), it('3', 'BH', 7, 'F', 12, { e: 'D', nf: '8', v: 250 }), it('5', 'Cambuci', 4, 'E', 3, { e: 'S' })])
  } } },
  expedicao: { '2026-11': {} }, faturados: { '2026-11': {} },
  entregues: {}, saidas: {}, ocorrencias: []
});
const filtroDoClique = (f) => Object.assign({ tipo: '', sit: '', status: '', arm: '', transp: '', busca: '', acao: '', ocorr: '', ordem: 'dias', desc: true }, f);
const contaNaLista = (p, dia, card) => H.filtrar(p.porDia.get(dia).reg.itens, filtroDoClique(card.filtro), p.entregues, { p, dia, agora: new Date('2026-11-25T12:00:00Z') }).length;

test('aguardando despacho conta o pedido como ele estava NAQUELE dia: despacho que veio depois não apaga o número do dia antigo', () => {
  const d = dados();
  d.entregues = { '3': '2026-11-18', '4': '2026-11-18' }; // despachados DEPOIS da foto de 16/11
  const p = H.preparar(d);
  const agora = new Date('2026-11-25T12:00:00Z');
  const c16 = P.cartoes(p, '2026-11-16', P.filtroVazio(), agora).cartoes.find((x) => x.id === 'aguardando');
  assert.equal(c16.valor, 2, 'em 16/11 os pedidos 3 e 4 (já com nota) ainda aguardavam despacho');
  assert.equal(contaNaLista(p, '2026-11-16', c16), 2, 'o clique no cartão abre a mesma contagem');
  const c19 = P.cartoes(p, '2026-11-19', P.filtroVazio(), agora).cartoes.find((x) => x.id === 'aguardando');
  assert.equal(c19.valor, 0, 'em 19/11 o pedido 3 já tinha sido despachado (18/11)');
  assert.equal(c19.ref, 2, 'a comparação com o dia anterior usa a situação de 16/11, não a de hoje');
  assert.equal(contaNaLista(p, '2026-11-19', c19), 0);
});

test('ocorrência só conta como aberta a partir da data em que foi aberta e até a data da solução', () => {
  const d = dados();
  d.ocorrencias = [{ nf: '8', pedido: '3', dataOcorrencia: '2026-11-18', detalhes: 'sem etiqueta', responsavel: 'Erica', solucao: '', dataSolucao: '2026-11-21' }];
  const p = H.preparar(d);
  const agora = new Date('2026-11-25T12:00:00Z');
  const c16 = P.cartoes(p, '2026-11-16', P.filtroVazio(), agora).cartoes.find((x) => x.id === 'ocorrencias');
  const c19 = P.cartoes(p, '2026-11-19', P.filtroVazio(), agora).cartoes.find((x) => x.id === 'ocorrencias');
  assert.equal(c16.valor, 0, 'em 16/11 a ocorrência ainda não existia');
  assert.equal(c19.valor, 1, 'em 19/11 estava aberta (resolvida só em 21/11)');
  assert.equal(c19.ref, 0);
  assert.equal(contaNaLista(p, '2026-11-19', c19), 1, 'o clique abre a mesma contagem');
});

test('período personalizado inválido ou enorme não quebra: volta para 30 dias, nunca passa do dia nem de 1 ano', () => {
  assert.deepEqual(P.periodo('custom', '2026-11-24', { de: 'xx', ate: 'yy' }), { tipo: '30', de: '2026-10-26', ate: '2026-11-24' });
  assert.deepEqual(P.periodo('custom', '2026-11-24', { de: '2026-02-31', ate: '2026-03-01' }), { tipo: '30', de: '2026-10-26', ate: '2026-11-24' });
  const futuro = P.periodo('custom', '2026-11-24', { de: '2026-11-10', ate: '2027-03-01' });
  assert.equal(futuro.ate, '2026-11-24', 'não passa do dia escolhido');
  const longo = P.periodo('custom', '2026-11-24', { de: '2000-01-01', ate: '2026-11-24' });
  assert.equal(P.diasEntre(longo.de, longo.ate), 365, 'no máximo 1 ano');
});

test('faixas aceitam dias com fração e o valor do cartão de valor não fica vermelho quando só o faturamento avança', () => {
  const f = P.faixas([[1, 'A', '', 1, 'E', 'A', 2.5, 'T', {}], [2, 'A', '', 1, 'E', 'A', 4.5, 'T', {}]]);
  assert.equal(f.lista.reduce((s, x) => s + x.qtd, 0), 2, 'nenhum pedido some entre uma faixa e outra');
  const c = P.cartoes(H.preparar(dados()), '2026-11-19', P.filtroVazio(), new Date()).cartoes.find((x) => x.id === 'valor');
  assert.equal(c.tom, 'neutro');
  assert.match(c.nota, /1 de 3 pedidos/);
});

test('% da base só aparece sem filtro de transportadora', () => {
  const d = dados();
  d.meses['2026-11'].dias['2026-11-19'].totalPorArmazem = { BH: 20, Cambuci: 100 };
  const p = H.preparar(d);
  assert.equal(P.armazens(p, '2026-11-19', P.filtroVazio()).lista.find((x) => x.nome === 'BH').pctBase, 10);
  assert.equal(P.armazens(p, '2026-11-19', { arm: '', transp: 'TCS' }).lista.find((x) => x.nome === 'BH').pctBase, null);
});

test('ocorrências: editar linha apagada por outra pessoa não a ressuscita, e edição com tela velha não apaga a alteração da outra pessoa', () => {
  const agora = 1763990000000;
  const criada = Oc.aplicar([], { acao: 'salvar', linha: { nf: '123456', dataOcorrencia: '2026-11-24', detalhes: 'faltou etiqueta' } }, 'Link do histórico', agora);
  const linha = criada.linhas[0];
  // a outra pessoa edita primeiro
  const editada = Oc.aplicar(criada.linhas, { acao: 'salvar', baseAtualizadoEm: linha.atualizadoEm, linha: { id: linha.id, nf: '123456', dataOcorrencia: '2026-11-24', detalhes: 'etiqueta colada' } }, 'Link do histórico', agora + 60000);
  assert.equal(editada.erro, undefined);
  // quem ainda tem a tela velha tenta salvar por cima
  const velha = Oc.aplicar(editada.linhas, { acao: 'salvar', baseAtualizadoEm: linha.atualizadoEm, linha: { id: linha.id, nf: '123456', dataOcorrencia: '2026-11-24', detalhes: 'texto antigo' } }, 'Link do histórico', agora + 120000);
  assert.equal(velha.conflito, true);
  assert.equal(velha.linhas[0].detalhes, 'etiqueta colada', 'a alteração da outra pessoa continua lá');
  // sem baseAtualizadoEm tudo funciona como antes
  assert.equal(Oc.aplicar(editada.linhas, { acao: 'salvar', linha: { id: linha.id, nf: '123456', dataOcorrencia: '2026-11-24', detalhes: 'sem base' } }, 'x', agora + 180000).erro, undefined);
  // linha apagada
  const apagada = Oc.aplicar(editada.linhas, { acao: 'remover', id: linha.id }, 'admin', agora + 200000);
  const ressuscitar = Oc.aplicar(apagada.linhas, { acao: 'salvar', linha: { id: linha.id, nf: '123456', dataOcorrencia: '2026-11-24', detalhes: 'tarde demais' } }, 'x', agora + 300000);
  assert.match(ressuscitar.erro, /Linha não encontrada/);
  assert.equal(ressuscitar.linhas.length, 0, 'não cria outra linha com id novo');
});

test('um dado antigo (sem detalhe por armazém) não apaga o detalhe já gravado do mesmo dia', () => {
  const guardado = { '2026-11-19': { pedidos: 10, pecas: 50, por: { BH: { pedidos: 4, pecas: 20 } } } };
  const novo = AH.mesclarDespachados(guardado, { '2026-11-19': { pedidos: 10, pecas: 50 } });
  assert.deepEqual(novo['2026-11-19'].por, { BH: { pedidos: 4, pecas: 20 } });
  const mes = AH.mesclarDia({ dias: { '2026-11-19': { dia: '2026-11-19', total: 3, pecas: 9, itens: [], totalPorArmazem: { BH: 20 } } } }, { dia: '2026-11-19', total: 3, pecas: 9, itens: [] });
  assert.deepEqual(mes.dias['2026-11-19'].totalPorArmazem, { BH: 20 });
});

test('o servidor não apaga o arquivo quando a leitura falha, e o link das meninas edita sem mostrar o valor da nota', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-revisao-'));
  for (const name of ['server.js', 'stock-position.js', 'inventory-integrity.js', 'atraso-historico.js', 'ocorrencias-store.js', 'ocorrencias-lookup.js', 'ocorrencias.js']) {
    if (fs.existsSync(path.join(__dirname, '..', name))) fs.copyFileSync(path.join(__dirname, '..', name), path.join(dir, name));
  }
  fs.mkdirSync(path.join(dir, 'data'));
  const arquivo = path.join(dir, 'data', 'ocorrencias-expedicao.json');
  const quebrado = '{"linhas":[{"id":"o1","nf":"111222","detalhes":"importante"'; // JSON cortado: a leitura falha
  fs.writeFileSync(arquivo, quebrado);
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1' }, body: JSON.stringify({ password: process.env.APP_PASSWORD }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const adm = (url, corpo) => fetch(base + url, { method: corpo ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1', Cookie: cookie }, body: corpo ? JSON.stringify(corpo) : undefined });
    const link = (url, corpo) => fetch(base + url, { method: corpo ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1' }, body: corpo ? JSON.stringify(corpo) : undefined });
    const t = (await (await adm('/api/atraso-historico-link', { acao: 'gerar' })).json()).token;
    const nova = { acao: 'salvar', linha: { nf: '333444', dataOcorrencia: '2026-11-24', detalhes: 'nova' } };
    const r = await link('/api/ocorrencias?k=' + t, nova);
    assert.equal(r.status, 500, 'leitura falhou: o servidor recusa em vez de gravar por cima');
    assert.equal(fs.readFileSync(arquivo, 'utf8'), quebrado, 'o arquivo continua exatamente como estava');

    fs.writeFileSync(arquivo, JSON.stringify({ linhas: [] }));
    const ok = await link('/api/ocorrencias?k=' + t, nova);
    assert.equal(ok.status, 200);
    const corpo = await ok.json();
    const criada = corpo.linhas.find((l) => l.nf === '333444');
    assert.ok(criada && criada.id && criada.atualizadoEm);
    for (const o of Object.values(corpo.notas || {}).concat(Object.values(corpo.pedidos || {}))) assert.equal(o.valor, undefined, 'o link não mostra o valor em R$');
    // edição com a tela velha: 409, e o texto da outra pessoa continua
    const editar = (texto, base) => link('/api/ocorrencias?k=' + t, { acao: 'salvar', baseAtualizadoEm: base, linha: { id: criada.id, nf: '333444', dataOcorrencia: '2026-11-24', detalhes: texto } });
    assert.equal((await editar('primeira', criada.atualizadoEm)).status, 200);
    assert.equal((await editar('tela velha', criada.atualizadoEm)).status, 409);
    const lista = await (await link('/api/ocorrencias?k=' + t)).json();
    assert.equal(lista.linhas.find((l) => l.id === criada.id).detalhes, 'primeira');
    // editar linha que não existe mais: 404, e não cria outra
    assert.equal((await link('/api/ocorrencias?k=' + t, { acao: 'salvar', linha: { id: 'inexistente', nf: '333444', dataOcorrencia: '2026-11-24', detalhes: 'x' } })).status, 404);
    assert.equal((await (await link('/api/ocorrencias?k=' + t)).json()).linhas.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
