const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');

test('análise de gaveta: carga só do admin, perfil por usuário, SB8 some em 24h e histórico permanece', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-gaveta-'));
  for (const name of ['server.js', 'stock-position.js', 'inventory-integrity.js', 'gaveta-core.js']) fs.copyFileSync(path.join(__dirname, '..', name), path.join(dir, name));
  fs.mkdirSync(path.join(dir, 'data'));
  // um SB8 de 25 horas atrás já gravado: tem que sumir na primeira leitura
  const old = { updatedAt: new Date(Date.now() - 25 * 3600000).toISOString(), nome: 'velho.xlsx', por: 'admin', rows: [['1', 'P1', '1', 'L1', 1, 0, '']] };
  fs.writeFileSync(path.join(dir, 'data', 'gaveta-sb8.json'), JSON.stringify(old));
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise(resolve => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (url, body, cookie) => {
    const r = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Sc9-App': '1', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
  };
  try {
    const admin = (await call('/api/login', { password: process.env.APP_PASSWORD })).cookie;
    for (const [usuario, perfis] of [['ana', ['gaveta']], ['bia', ['saida']]]) assert.equal((await call('/api/usuarios', { acao: 'criar', usuario, nome: usuario, senha: 'ficticio-123', perfis }, admin)).status, 200);
    const ana = (await call('/api/login', { usuario: 'ana', password: 'ficticio-123' })).cookie;
    const bia = (await call('/api/login', { usuario: 'bia', password: 'ficticio-123' })).cookie;

    assert.equal((await call('/api/gaveta/resumo')).status, 401);
    assert.equal((await call('/api/gaveta/resumo', null, bia)).status, 403, 'sem o perfil gaveta não entra');
    const vazio = await call('/api/gaveta/resumo', null, ana);
    assert.equal(vazio.status, 200);
    assert.equal(vazio.data.bases.sb8.presente, false, 'SB8 de 25h some');
    assert.equal(fs.existsSync(path.join(dir, 'data', 'gaveta-sb8.json')), false, 'e é apagado do armazenamento');

    const zz2 = [['1', '1', 'AB1', 'P1', '', ''], ['1', '1', 'AB2', 'P1', '', ''], ['1', '1', 'AB1', 'P2', '', '']];
    const sb8 = [['1', 'P1', '1', 'L1', 10, 0, '2026-11-01'], ['1', 'P1', '59', 'L1', 4, 0, '2027-05-01'], ['1', 'P2', '20', 'L9', 2, 0, '']];
    assert.equal((await call('/api/gaveta/carga', { tipo: 'zz2', rows: zz2 }, ana)).status, 403, 'só o admin carrega');
    assert.equal((await call('/api/gaveta/carga', { tipo: 'zz2', rows: [['x']] }, admin)).status, 400);
    assert.equal((await call('/api/gaveta/carga', { tipo: 'zz2', nome: 'ZZ2.xlsx', rows: zz2 }, admin)).data.gavetas, 2);
    assert.equal((await call('/api/gaveta/carga', { tipo: 'sb1', nome: 'SB1.xlsx', rows: [['P1', 'IMPLANTE', 'UN', ''], ['P2', 'PARAFUSO', 'UN', '']] }, admin)).status, 200);
    assert.equal((await call('/api/gaveta/detalhe?id=1%7C1%7CAB1', null, ana)).status, 409, 'sem SB8 não abre gaveta');
    assert.equal((await call('/api/gaveta/carga', { tipo: 'sb8', nome: 'SB8.xlsx', rows: sb8 }, admin)).status, 200);

    const resumo = (await call('/api/gaveta/resumo', null, ana)).data;
    assert.equal(resumo.bases.sb8.presente, true);
    assert.equal(resumo.painel.total, 2);
    assert.equal(resumo.painel.faltam, 2);
    const detalhe = (await call('/api/gaveta/detalhe?id=' + encodeURIComponent('1|1|AB1'), null, ana)).data.detalhe;
    assert.deepEqual(detalhe.itens.map(i => i.produto), ['P1', 'P2']);
    assert.equal(detalhe.itens[0].outros[0].arm, '59');
    assert.equal((await call('/api/gaveta/lote?q=L1', null, ana)).data.resultados.length, 2);

    const clientId = crypto.randomUUID();
    const item = (produto, extra = {}) => ({ produto, conferido: true, lotes: [], transferir: [], ...extra });
    const body = { id: '1|1|AB1', clientId, duracaoSeg: 95, itens: [item('P1', { lotes: [{ lote: 'L1', saldo: 10, validadeSistema: '2026-11-01', validadeNova: '2027-01-01' }], transferir: [{ arm: '59', lote: 'L1', qtd: 4, obs: 'trazer' }] }), item('P2', { semSaldo: true })] };
    assert.equal((await call('/api/gaveta/analise', { ...body, itens: [item('P1')] }, ana)).status, 400);
    const salvo = await call('/api/gaveta/analise', body, ana);
    assert.equal(salvo.status, 200);
    assert.equal(salvo.data.resumo.transferencias, 1);
    assert.equal((await call('/api/gaveta/analise', body, ana)).data.repetido, true, 'reenvio do celular não duplica');

    const depois = (await call('/api/gaveta/resumo', null, ana)).data;
    assert.equal(depois.painel.analisadas, 1);
    assert.equal(depois.painel.faltam, 1);
    assert.equal(depois.painel.hoje, 1);
    assert.equal(depois.gavetas.find(g => g.codigo === 'AB1').ultima.por, 'ana');
    assert.equal((await call('/api/gaveta/analises', null, ana)).status, 403);
    const historico = (await call('/api/gaveta/analises', null, admin)).data.registros;
    assert.equal(historico.length, 1);
    assert.equal(historico[0].duracaoSeg, 95);
    assert.equal(historico[0].itens[0].descricao, 'IMPLANTE');
    assert.equal(historico[0].itens[0].lotes[0].validadeNova, '2027-01-01');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'data', 'gaveta-analises.json'))).registros.length, 1, 'histórico fica gravado');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
