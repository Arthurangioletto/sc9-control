const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

// Expedição em 3 abas (Bipar · Planilha de entrega · Entregas/POD): permissões, planilha de um dia, observação, troca de transportadora,
// lista de saída, POD, nota que aparece sozinha e concorrência. Servidor local de verdade, igual aos outros testes da expedição.
const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' });
const hojeSP = () => fmt.format(new Date());
const add = (dia, n) => { const d = new Date(dia + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function subir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc9-exp3-'));
  for (const f of fs.readdirSync(path.join(__dirname, '..'))) if (/\.(js|html|css)$/.test(f)) fs.copyFileSync(path.join(__dirname, '..', f), path.join(dir, f));
  fs.mkdirSync(path.join(dir, 'data'));
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
  process.env.PORT = '0'; process.env.APP_PASSWORD = crypto.randomUUID(); process.env.SESSION_SECRET = crypto.randomUUID(); process.env.NODE_ENV = 'test';
  const server = require(path.join(dir, 'server.js'));
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const hdr = { 'Content-Type': 'application/json', 'X-Sc9-App': '1' };
  const login = async (corpo) => { const r = await fetch(base + '/api/login', { method: 'POST', headers: hdr, body: JSON.stringify(corpo) }); return r.headers.get('set-cookie') ? r.headers.get('set-cookie').split(';')[0] : null; };
  const adminCk = await login({ password: process.env.APP_PASSWORD });
  const como = (cookie) => (rota, corpo) => fetch(base + rota, { method: corpo ? 'POST' : 'GET', headers: Object.assign({}, hdr, cookie ? { Cookie: cookie } : {}), body: corpo ? JSON.stringify(corpo) : undefined });
  const adm = como(adminCk);
  const criar = async (usuario, perfis) => { const r = await adm('/api/usuarios', { acao: 'criar', usuario, nome: 'Pessoa ' + usuario, senha: 'senha-' + usuario + '-xyz', perfis }); assert.equal(r.status, 200, 'criar ' + usuario); return como(await login({ usuario, password: 'senha-' + usuario + '-xyz' })); };
  const lerDia = (dia) => JSON.parse(fs.readFileSync(path.join(dir, 'data', `recebimento-exp-${dia}.json`), 'utf8'));
  return { server, adm, base, dir, como, criar, sem: como(null), lerDia };
}
const ordem = (pedido, extra) => Object.assign({ pedido, armazem: 'Cambuci', nf: '', nome: 'CLIENTE ' + pedido, cliente: '001', dt: '2026-11-18', dtLiberacaoHora: '2026-11-18T12:10:00.000Z', qt: 5, itens: 2, status: 'Pendente', transportadora: 'Retira 02', separador: '', conferente: '', pickEnd: '2026-11-18T15:00:00.000Z' }, extra || {});
const snapshot = (orders, entregaInfo) => ({ orders, items: [], itemNames: [], warehousesPresent: ['Cambuci'], cutoff: hojeSP(), entregaInfo, faturamento: [], valores: [] });
const json = async (r) => r.json();

// 6 pedidos de hoje em 4 transportadoras; 2 já têm nota
const PEDIDOS = [['810001', 'Retira 02', '9101'], ['810002', 'Retira 02', ''], ['810003', 'Retira 03', ''], ['810004', 'Brasil', '9104'], ['810005', 'Brasil', ''], ['810006', 'TCE', '']];
async function prepararDia(adm, bipa) {
  const r = await adm('/api/save', snapshot(PEDIDOS.map(([p, t, nf]) => ordem(p, { transportadora: t, nf })), []));
  assert.equal(r.status, 200);
  const ids = {};
  for (const [p] of PEDIDOS) { const b = await bipa('/api/recebimento/bipar', { pedido: p }); assert.equal(b.status, 200, 'bipar ' + p); ids[p] = (await b.json()).entry.id; }
  return ids;
}

test('permissões: cada perfil vê só o que pode (401/403) e quem só bipa não lê planilha, não importa e não vê POD', async () => {
  const { server, adm, criar, sem } = await subir();
  try {
    const hoje = hojeSP(), ontem = add(hoje, -1);
    const bip = await criar('bip', ['exp_bipar']), pla = await criar('pla', ['exp_planilha']), pod = await criar('pod', ['exp_pod']);
    const rec = await criar('rec', ['recebimento']), desp = await criar('desp', ['despacho']), nada = await criar('nada', ['saida']);
    await adm('/api/save', snapshot([ordem('811001', { nf: '77' }), ordem('811002')], []));

    // /api/expedicao/acesso
    const ac = await (await adm('/api/expedicao/acesso')).json();
    assert.deepEqual(ac.abas, { bipar: true, planilha: true, pod: true, visaoGeral: true }); assert.equal(ac.admin, true);
    const so = async (u) => (await (await u('/api/expedicao/acesso')).json());
    assert.deepEqual((await so(bip)).abas, { bipar: true, planilha: false, pod: false, visaoGeral: false });
    assert.deepEqual((await so(pla)).abas, { bipar: false, planilha: true, pod: false, visaoGeral: true });
    assert.deepEqual((await so(pod)).abas, { bipar: false, planilha: false, pod: true, visaoGeral: false });
    assert.deepEqual((await so(rec)).abas, { bipar: true, planilha: true, pod: false, visaoGeral: true }, 'recebimento = bipar + planilha');
    assert.deepEqual((await so(desp)).abas, { bipar: false, planilha: true, pod: false, visaoGeral: true }, 'despacho = planilha + importar');
    assert.deepEqual((await so(nada)).abas, { bipar: false, planilha: false, pod: false, visaoGeral: false });
    const eu = await so(bip); assert.equal(eu.usuario, 'bip'); assert.equal(eu.nome, 'Pessoa bip'); assert.equal(eu.admin, false);
    assert.equal((await sem('/api/expedicao/acesso')).status, 401);

    // sem login: 401 em tudo
    const rotas = [['GET', 'planilha'], ['POST', 'observacao'], ['POST', 'transportadora'], ['POST', 'lista'], ['GET', 'entregas'], ['POST', 'pod']];
    for (const [m, r] of rotas) assert.equal((await sem('/api/expedicao/' + r, m === 'POST' ? { id: 'a', dia: hoje } : undefined)).status, 401, r);
    // 405 e 404 continuam como na v1
    assert.equal((await adm('/api/expedicao/planilha', { dia: hoje })).status, 405);
    assert.equal((await adm('/api/expedicao/nao-existe')).status, 404);

    // quem só bipa, quem só vê a planilha, quem só confere POD e quem não tem nada
    const corpo = { id: 'a', dia: hoje, texto: 'oi', para: 'X', motivo: 'motivo', status: 'entregue', ids: ['a'] };
    const planilhaRotas = [['GET', 'planilha'], ['POST', 'observacao'], ['POST', 'transportadora'], ['POST', 'lista'], ['GET', 'painel'], ['GET', 'pedidos'], ['GET', 'exportar'], ['POST', 'rastreio']];
    const podRotas = [['GET', 'entregas'], ['POST', 'pod']];
    const chama = (u, [m, r]) => u('/api/expedicao/' + r, m === 'POST' ? corpo : undefined);
    for (const x of [...planilhaRotas, ...podRotas]) { assert.equal((await chama(bip, x)).status, 403, 'exp_bipar ' + x[1]); assert.equal((await chama(nada, x)).status, 403, 'saida ' + x[1]); }
    for (const x of podRotas) { assert.equal((await chama(pla, x)).status, 403, 'exp_planilha ' + x[1]); assert.equal((await chama(rec, x)).status, 403, 'recebimento ' + x[1]); assert.equal((await chama(desp, x)).status, 403, 'despacho ' + x[1]); }
    for (const x of planilhaRotas) assert.equal((await chama(pod, x)).status, 403, 'exp_pod ' + x[1]);
    assert.equal((await pla('/api/expedicao/planilha')).status, 200); assert.equal((await rec('/api/expedicao/planilha')).status, 200); assert.equal((await desp('/api/expedicao/planilha')).status, 200);
    assert.equal((await pod('/api/expedicao/entregas')).status, 200); assert.equal((await adm('/api/expedicao/entregas')).status, 200);
    // importar da Entrega só despacho/admin; exp_planilha e recebimento não
    assert.equal((await pla('/api/expedicao/importar-entrega', { simular: true })).status, 403);
    assert.equal((await rec('/api/expedicao/importar-entrega', { simular: true })).status, 403);
    assert.equal((await bip('/api/expedicao/importar-entrega', { simular: true })).status, 403);
    assert.equal((await desp('/api/expedicao/importar-entrega', { simular: true })).status, 200);
    assert.equal((await pla('/api/expedicao/painel')).status, 200, 'perfil novo aceito nas rotas da v1');
    assert.equal((await pla('/api/recebimento/fechamento')).status, 200);
    assert.equal((await bip('/api/recebimento/fechamento')).status, 403); assert.equal((await bip('/api/recebimento/pesquisar?q=8110')).status, 403);
    assert.equal((await pod('/api/recebimento/pesquisar?q=8110')).status, 403);

    // bipar: exp_bipar e recebimento bipam; exp_planilha, exp_pod e despacho não
    assert.equal((await pla('/api/recebimento/bipar', { pedido: '811001' })).status, 403);
    assert.equal((await pod('/api/recebimento/bipar', { pedido: '811001' })).status, 403);
    assert.equal((await desp('/api/recebimento/bipar', { pedido: '811001' })).status, 403, 'despacho nunca bipou');
    const b1 = await bip('/api/recebimento/bipar', { pedido: '811001' });
    assert.equal(b1.status, 200);
    const eb1 = (await b1.json()).entry;
    assert.equal((await rec('/api/recebimento/bipar', { pedido: '811002' })).status, 200);

    // GET /api/recebimento: exp_bipar só vê o que ELE bipou hoje, sem campos internos
    await adm('/api/expedicao/observacao', { id: eb1.id, dia: hoje, texto: 'nota interna do chefe' });
    await adm('/api/expedicao/pod', { id: eb1.id, dia: hoje, status: 'entregue' });
    const lb = await (await bip('/api/recebimento')).json();
    assert.deepEqual(lb.entries.map((e) => e.pedido), ['811001'], 'só o dele');
    for (const k of ['pod', 'podHistorico', 'observacoes', 'trocas', 'transportadoraSaiu', 'impressoes', 'rastreio']) assert.equal(lb.entries[0][k], undefined, k);
    assert.deepEqual(lb.faltando, []); assert.equal(lb.ultimaEntrega, null); assert.equal(lb.podeReceber, true);
    assert.equal((await bip('/api/recebimento?dia=' + ontem)).status, 403, 'só hoje');
    // quem tem a planilha vê as duas, com os campos
    const lr = await (await rec('/api/recebimento')).json();
    assert.deepEqual(lr.entries.map((e) => e.pedido).sort(), ['811001', '811002']);
    assert.equal(lr.entries.find((e) => e.pedido === '811001').observacoes.length, 1);
    assert.equal((await pod('/api/recebimento')).status, 200, 'POD lê a lista do dia');
    assert.equal((await pla('/api/recebimento')).status, 200); assert.equal((await nada('/api/recebimento')).status, 403);
    // duplicado: a resposta de 409 não vaza campos internos de outra pessoa
    const dup = await bip('/api/recebimento/bipar', { pedido: '811002' });
    assert.equal(dup.status, 409);
    const dj = await dup.json(); assert.equal(dj.duplicado.observacoes, undefined);
    // exp_bipar só mexe no próprio bipe (volumes) e não marca "não sai hoje"
    const dois = (await (await rec('/api/recebimento')).json()).entries.find((e) => e.pedido === '811002');
    assert.equal((await bip('/api/recebimento/atualizar', { id: dois.id, volumes: 3 })).status, 403);
    assert.equal((await bip('/api/recebimento/atualizar', { id: eb1.id, volumes: 3 })).status, 200);
    assert.equal((await bip('/api/recebimento/atualizar', { id: eb1.id, naoSaiHoje: { motivo: 'Outro', obs: 'x' } })).status, 403);
    assert.equal((await bip('/api/recebimento/desfazer', { id: dois.id })).status, 403, 'desfazer: só o próprio bipe (como antes)');
  } finally { server.close(); }
});

test('planilha de um dia: colunas, filtro de várias transportadoras, busca, situação, validação e ordem pelo bipe', async () => {
  const { server, adm, criar, lerDia } = await subir();
  try {
    const hoje = hojeSP(), ontem = add(hoje, -1);
    const rec = await criar('rec', ['recebimento']);
    const ids = await prepararDia(adm, rec);
    const P = async (q = '') => (await adm('/api/expedicao/planilha' + q)).json();

    let j = await P();
    assert.equal(j.dia, hoje); assert.equal(j.hoje, hoje); assert.ok(j.geradoEm); assert.ok(j.baseEntregaEm); assert.equal(j.truncado, false);
    assert.deepEqual(j.linhas.map((l) => l.pedido), PEDIDOS.map((p) => p[0]), 'ordenado pela hora do bipe');
    const l1 = j.linhas[0];
    for (const k of ['id', 'pedido', 'data', 'nf', 'aguardandoNota', 'cliente', 'armazem', 'transportadora', 'transportadoraOriginal', 'trocada', 'volumes', 'observacao', 'observacoes', 'bipadoEm', 'bipadoPor', 'origem', 'horaEstimada', 'situacao', 'saiuEntrega', 'impressoEm', 'podStatus']) assert.ok(k in l1, 'campo ' + k);
    assert.equal(l1.data, hoje); assert.equal(l1.nf, '9101'); assert.equal(l1.aguardandoNota, false); assert.equal(l1.cliente, 'CLIENTE 810001'); assert.equal(l1.armazem, 'Cambuci');
    assert.equal(l1.transportadora, 'Retira 02'); assert.equal(l1.trocada, false); assert.equal(l1.bipadoPor, 'Pessoa rec'); assert.equal(l1.origem, 'bipe'); assert.equal(l1.situacao, 'recebido'); assert.equal(l1.podStatus, 'pendente');
    assert.equal(l1.impressoEm, null); assert.equal(l1.observacao, ''); assert.deepEqual(l1.observacoes, []);
    assert.equal(j.linhas[1].aguardandoNota, true); assert.equal(j.linhas[1].nf, '');
    assert.deepEqual(j.totais, { pedidos: 6, volumes: 0, aguardandoNota: 4, trocadas: 0, impressos: 0 });
    assert.deepEqual(j.transportadoras.map((t) => [t.nome, t.total]).sort(), [['Brasil', 2], ['Retira 02', 2], ['Retira 03', 1], ['TCE', 1]]);

    // várias transportadoras de uma vez (lista separada por vírgula ou parâmetro repetido); os chips continuam mostrando todas
    j = await P('?transportadoras=' + encodeURIComponent('Retira 02,Brasil'));
    assert.deepEqual(j.linhas.map((l) => l.pedido), ['810001', '810002', '810004', '810005']);
    assert.equal(j.totais.pedidos, 4); assert.equal(j.transportadoras.length, 4);
    j = await P('?transportadoras=Retira%2003&transportadoras=TCE');
    assert.deepEqual(j.linhas.map((l) => l.pedido), ['810003', '810006']);
    assert.equal((await P('?transportadoras=' + encodeURIComponent('RETIRA  03'))).linhas.length, 1, 'sem diferenciar caixa nem espaço');
    assert.equal((await P('?transportadoras=Inexistente')).linhas.length, 0);
    // busca e situação
    assert.deepEqual((await P('?q=810005')).linhas.map((l) => l.pedido), ['810005']);
    assert.deepEqual((await P('?q=9104')).linhas.map((l) => l.pedido), ['810004'], 'busca pela nota');
    assert.equal((await P('?situacao=saiu')).linhas.length, 0); assert.equal((await P('?situacao=recebido')).linhas.length, 6);
    // volumes entram nos totais
    assert.equal((await rec('/api/recebimento/atualizar', { id: ids['810001'], volumes: 2 })).status, 200);
    assert.equal((await rec('/api/recebimento/atualizar', { id: ids['810004'], volumes: 3 })).status, 200);
    j = await P(); assert.equal(j.totais.volumes, 5); assert.equal(j.transportadoras.find((t) => t.nome === 'Brasil').volumes, 3);
    // outro dia: só o dia pedido (vazio)
    j = await P('?dia=' + ontem); assert.equal(j.dia, ontem); assert.deepEqual(j.linhas, []); assert.equal(j.totais.pedidos, 0);
    // validação
    for (const q of ['?dia=2026-02-30', '?dia=abc', '?dia=' + add(hoje, 1), '?dia=' + add(hoje, -400), '?situacao=qualquer', '?q=' + 'x'.repeat(81), '?q=1', '?transportadoras=' + 'x'.repeat(61), '?transportadoras=' + Array.from({ length: 31 }, (_, i) => 'T' + i).join(',')]) assert.equal((await adm('/api/expedicao/planilha' + q)).status, 400, q);
    assert.equal((await adm('/api/expedicao/planilha')).headers.get('cache-control'), 'no-store');
    // a leitura não grava nada
    assert.equal(lerDia(hoje).versao > 0, true);
  } finally { server.close(); }
});

test('observação só acrescenta; troca de transportadora exige motivo, guarda a original e o histórico e vale para vários ids', async () => {
  const { server, adm, criar, lerDia } = await subir();
  try {
    const hoje = hojeSP(), ontem = add(hoje, -1);
    const rec = await criar('rec', ['recebimento']);
    const pla = await criar('pla', ['exp_planilha']);
    const ids = await prepararDia(adm, rec);
    const P = async (q = '') => (await adm('/api/expedicao/planilha' + q)).json();
    const linha = async (ped) => (await P()).linhas.find((l) => l.pedido === ped);
    const obs = (id, texto, dia = hoje, quem = adm) => quem('/api/expedicao/observacao', { id, dia, texto });
    const antes = JSON.stringify(lerDia(hoje).entries.find((e) => e.id === ids['810001']));

    // ---- observação
    let r = await obs(ids['810001'], '  Cliente  vai retirar\n   às 16h ');
    assert.equal(r.status, 200);
    let j = await r.json();
    assert.equal(j.ok, true); assert.equal(j.observacao, 'Cliente vai retirar às 16h'); assert.equal(j.observacoes.length, 1);
    assert.equal(j.observacoes[0].por, 'admin'); assert.ok(j.observacoes[0].em); assert.equal(j.observacoes[0].nome, 'Administrador');
    assert.equal((await (await obs(ids['810001'], 'Segunda observação', hoje, pla)).json()).observacoes.length, 2, 'exp_planilha também escreve');
    let l = await linha('810001');
    assert.equal(l.observacao, 'Segunda observação', 'a planilha mostra a última'); assert.equal(l.observacoes.length, 2); assert.equal(l.observacoes[0].texto, 'Cliente vai retirar às 16h'); assert.equal(l.observacoes[1].por, 'pla');
    // duplo clique (mesmo texto, mesma pessoa) não duplica
    j = await (await obs(ids['810001'], 'Segunda observação', hoje, pla)).json();
    assert.equal(j.semMudanca, true); assert.equal(j.observacoes.length, 2);
    // dado original continua igual (só foi acrescentado)
    const depois = lerDia(hoje).entries.find((e) => e.id === ids['810001']);
    const semNovos = { ...depois }; delete semNovos.observacoes;
    assert.deepEqual(semNovos, JSON.parse(antes), 'nada do que existia foi alterado');
    // validação
    for (const t of ['', '   ', 'x'.repeat(401), null, 5, { a: 1 }, ['a']]) assert.equal((await obs(ids['810002'], t)).status, 400, JSON.stringify(t).slice(0, 20));
    assert.equal((await obs(ids['810002'], 'x'.repeat(400))).status, 200, '400 cabe');
    assert.equal((await obs('nao-existe', 'oi')).status, 404);
    assert.equal((await obs(ids['810003'], 'oi', ontem)).status, 404, 'o id existe, mas não nesse dia');
    for (const [id, dia] of [['../etc', hoje], ['a'.repeat(100), hoje], [5, hoje], [ids['810003'], '2026-02-30'], [ids['810003'], add(hoje, 1)], [ids['810003'], undefined]]) assert.equal((await adm('/api/expedicao/observacao', { id, dia, texto: 'oi' })).status, 400, String(id).slice(0, 10) + dia);
    // no máximo 30
    for (let i = 0; i < 30; i++) assert.equal((await obs(ids['810003'], 'obs ' + i)).status, 200);
    assert.equal((await obs(ids['810003'], 'a 31ª')).status, 400);
    assert.equal((await linha('810003')).observacoes.length, 30);

    // ---- troca de transportadora
    const troca = (corpo, quem = adm) => quem('/api/expedicao/transportadora', corpo);
    for (const c of [
      { id: ids['810001'], dia: hoje, para: 'Brasil' }, { id: ids['810001'], dia: hoje, para: 'Brasil', motivo: '' }, { id: ids['810001'], dia: hoje, para: 'Brasil', motivo: 'ab' },
      { id: ids['810001'], dia: hoje, para: 'Brasil', motivo: 'x'.repeat(201) }, { id: ids['810001'], dia: hoje, para: '', motivo: 'sem nome' }, { id: ids['810001'], dia: hoje, para: 'T'.repeat(41), motivo: 'nome grande' },
      { id: ids['810001'], dia: hoje, para: 5, motivo: 'nome numérico' }, { id: ids['810001'], dia: hoje, para: 'Brasil', motivo: 7 }, { id: ids['810001'], dia: hoje, para: '<b>x</b>', motivo: 'html' },
      { id: ids['810001'], dia: hoje, ids: [{ id: ids['810001'], dia: hoje }], para: 'Brasil', motivo: 'os dois' }, { ids: [], para: 'Brasil', motivo: 'vazio' }, { ids: 'x', para: 'Brasil', motivo: 'não é lista' },
      { ids: [{ id: '../x', dia: hoje }], para: 'Brasil', motivo: 'id ruim' }, { ids: [{ id: ids['810001'], dia: add(hoje, 2) }], para: 'Brasil', motivo: 'dia futuro' }, { ids: ['texto'], para: 'Brasil', motivo: 'item ruim' },
      { ids: Array.from({ length: 201 }, (_, i) => ({ id: 'a' + i, dia: hoje })), para: 'Brasil', motivo: 'lote grande' },
    ]) assert.equal((await troca(c)).status, 400, JSON.stringify(c).slice(0, 80));
    assert.equal((await linha('810001')).trocada, false, 'nada mudou com pedidos inválidos');
    assert.equal((await troca({ id: 'nao-existe', dia: hoje, para: 'Brasil', motivo: 'não existe' })).status, 404);

    r = await troca({ id: ids['810001'], dia: hoje, para: 'Brasil', motivo: 'Cliente pediu para sair pela Brasil' });
    assert.equal(r.status, 200); j = await r.json();
    assert.equal(j.ok, true); assert.equal(j.alterados, 1); assert.equal(j.transportadora, 'Brasil'); assert.equal(j.transportadoraOriginal, 'Retira 02'); assert.equal(j.troca.de, 'Retira 02'); assert.equal(j.troca.para, 'Brasil');
    l = await linha('810001');
    assert.equal(l.transportadora, 'Brasil'); assert.equal(l.transportadoraOriginal, 'Retira 02'); assert.equal(l.trocada, true);
    assert.equal(l.troca.motivo, 'Cliente pediu para sair pela Brasil'); assert.equal(l.troca.por, 'admin'); assert.ok(l.troca.em);
    // a original NUNCA é alterada no que está gravado
    let gravada = lerDia(hoje).entries.find((e) => e.id === ids['810001']);
    assert.equal(gravada.info.transportadora, 'Retira 02'); assert.equal(gravada.transportadoraSaiu.para, 'Brasil'); assert.equal(gravada.transportadoraSaiu.de, 'Retira 02'); assert.equal(gravada.trocas.length, 1);
    // filtro, totais e chips já usam a efetiva
    let f = await P('?transportadoras=Brasil');
    assert.deepEqual(f.linhas.map((x) => x.pedido), ['810001', '810004', '810005']);
    assert.deepEqual((await P('?transportadoras=' + encodeURIComponent('Retira 02'))).linhas.map((x) => x.pedido), ['810002']);
    assert.equal(f.totais.trocadas, 1); assert.equal(f.transportadoras.find((t) => t.nome === 'Brasil').total, 3);
    assert.equal((await P('?q=retira')).linhas.some((x) => x.pedido === '810001'), true, 'a busca ainda acha pela original');
    // trocar de novo: atualiza o destino, mantém a original e acumula o histórico (inclusive de quem trocou)
    j = await (await troca({ id: ids['810001'], dia: hoje, para: 'TCE', motivo: 'TCE tinha espaço no caminhão' }, pla)).json();
    assert.equal(j.transportadora, 'TCE'); assert.equal(j.troca.de, 'Brasil');
    gravada = lerDia(hoje).entries.find((e) => e.id === ids['810001']);
    assert.equal(gravada.info.transportadora, 'Retira 02'); assert.equal(gravada.transportadoraSaiu.para, 'TCE');
    assert.deepEqual(gravada.trocas.map((t) => [t.de, t.para, t.por]), [['Retira 02', 'Brasil', 'admin'], ['Brasil', 'TCE', 'pla']]);
    assert.equal((await linha('810001')).transportadoraOriginal, 'Retira 02');
    // mesma troca de novo = duplo clique, sem mudança e sem histórico novo
    j = await (await troca({ id: ids['810001'], dia: hoje, para: 'tce', motivo: 'duplo clique' })).json();
    assert.equal(j.semMudanca, 1); assert.equal(j.alterados, 0); assert.equal(lerDia(hoje).entries.find((e) => e.id === ids['810001']).trocas.length, 2);
    // volta para a original: vale (efetiva = Retira 02), histórico cresce, trocada = false
    j = await (await troca({ id: ids['810001'], dia: hoje, para: 'Retira 02', motivo: 'voltou para a retirada' })).json();
    assert.equal(j.transportadora, 'Retira 02'); l = await linha('810001'); assert.equal(l.trocada, false); assert.equal(l.trocas.length, 3);

    // vários ids de uma vez (inclusive de dias diferentes dentro do mesmo pedido de troca)
    j = await (await troca({ ids: [{ id: ids['810002'], dia: hoje }, { id: ids['810003'], dia: hoje }, { id: ids['810004'], dia: hoje }, { id: ids['810002'], dia: hoje }], para: 'Brasil', motivo: 'Retira lotou, tudo na Brasil' })).json();
    assert.equal(j.ok, true); assert.equal(j.alterados, 2, '810004 já era Brasil; o repetido conta uma vez'); assert.equal(j.semMudanca, 1); assert.equal(j.itens.length, 3);
    assert.deepEqual(j.itens.map((x) => [x.pedido, x.transportadora]).sort(), [['810002', 'Brasil'], ['810003', 'Brasil'], ['810004', 'Brasil']]);
    j = await P('?transportadoras=Brasil'); assert.deepEqual(j.linhas.map((x) => x.pedido), ['810002', '810003', '810004', '810005']);
    assert.equal(j.linhas.find((x) => x.pedido === '810003').transportadoraOriginal, 'Retira 03');
    assert.equal(lerDia(hoje).entries.find((e) => e.id === ids['810004']).trocas, undefined, 'quem já estava na Brasil não ganhou troca');
    // um id inexistente no lote: nada é gravado
    const v0 = lerDia(hoje).versao;
    r = await troca({ ids: [{ id: ids['810005'], dia: hoje }, { id: 'fantasma', dia: hoje }], para: 'TCE', motivo: 'lote com fantasma' });
    assert.equal(r.status, 404); assert.equal((await r.json()).naoEncontrados.length, 1);
    assert.equal(lerDia(hoje).versao, v0); assert.equal((await linha('810005')).trocada, false);
    // tudo o que é por transportadora usa a efetiva: v1 (pedidos/exportar) e o fechamento do dia
    const de = add(hoje, -2);
    const ped = await (await adm(`/api/expedicao/pedidos?de=${de}&ate=${hoje}&transportadora=Brasil`)).json();
    assert.deepEqual(ped.linhas.map((x) => x.pedido).sort(), ['810002', '810003', '810004', '810005']);
    const exp = await (await adm(`/api/expedicao/exportar?de=${de}&ate=${hoje}`)).json();
    assert.equal(exp.linhas.find((x) => x.pedido === '810003').transportadora, 'Brasil');
    const fech = await (await adm('/api/recebimento/fechamento')).json();
    assert.deepEqual(fech.transportadoras.map((t) => [t.nome, t.recebidos]).sort(), [['Brasil', 4], ['Retira 02', 1], ['TCE', 1]]);
    const lista = await (await adm('/api/recebimento')).json();
    assert.equal(lista.entries.find((e) => e.pedido === '810003').info.transportadora, 'Brasil');
    assert.equal(lista.entries.find((e) => e.pedido === '810003').transportadoraOriginal, 'Retira 03');
    // as observações continuam lá
    assert.equal((await linha('810001')).observacoes.length, 2);
  } finally { server.close(); }
});

test('lista de saída: só ids do dia, listaId, impressões registradas, uma entrada por transportadora e "aguardando nota"', async () => {
  const { server, adm, criar, lerDia } = await subir();
  try {
    const hoje = hojeSP(), ontem = add(hoje, -1);
    const rec = await criar('rec', ['recebimento']);
    const ids = await prepararDia(adm, rec);
    // um pedido de ONTEM (veio da Entrega) para provar que ids de outro dia dão 400
    await adm('/api/save', snapshot([...PEDIDOS.map(([p, t, nf]) => ordem(p, { transportadora: t, nf })), ordem('810099', { nf: '5' })], [['810099', { data: ontem, transportadora: 'TCE' }]]));
    const deOntem = lerDia(ontem).entries.find((e) => e.pedido === '810099');
    assert.ok(deOntem);
    const lista = (c, quem = adm) => quem('/api/expedicao/lista', c);
    const P = async () => (await adm('/api/expedicao/planilha')).json();

    let r = await lista({ dia: hoje, ids: [ids['810002'], ids['810001'], ids['810004'], ids['810002']] });
    assert.equal(r.status, 200);
    let j = await r.json();
    assert.match(j.listaId, /^L-\d{8}-\d{6}-[a-z0-9]{4}$/); assert.equal(j.listaId.slice(2, 10), hoje.replace(/-/g, ''));
    assert.ok(j.geradoEm); assert.equal(j.geradoPor, 'Administrador'); assert.equal(j.dia, hoje);
    assert.deepEqual(j.grupos.map((g) => g.transportadora), ['Brasil', 'Retira 02'], 'uma entrada por transportadora');
    const retira = j.grupos[1];
    assert.equal(retira.totalPedidos, 2); assert.deepEqual(retira.linhas.map((x) => x.pedido), ['810001', '810002']);
    assert.deepEqual(Object.keys(retira.linhas[0]).sort(), ['aguardandoNota', 'cliente', 'id', 'nf', 'observacao', 'pedido', 'volumes']);
    assert.equal(retira.linhas[0].nf, '9101'); assert.equal(retira.linhas[0].aguardandoNota, false);
    assert.equal(retira.linhas[1].nf, ''); assert.equal(retira.linhas[1].aguardandoNota, true, 'pedido sem nota imprime "aguardando nota"');
    assert.equal(j.grupos[0].totalPedidos, 1); assert.equal(j.totalPedidos, 3);
    // a impressão foi registrada em cada entrada e aparece na planilha
    const g1 = lerDia(hoje).entries.find((e) => e.id === ids['810001']);
    assert.equal(g1.impressoes.length, 1); assert.equal(g1.impressoes[0].listaId, j.listaId); assert.equal(g1.impressoes[0].transportadora, 'Retira 02'); assert.equal(g1.impressoes[0].por, 'admin'); assert.equal(g1.impressoes[0].nome, 'Administrador'); assert.ok(g1.impressoes[0].em);
    assert.equal(lerDia(hoje).entries.find((e) => e.id === ids['810003']).impressoes, undefined, 'quem não saiu na lista não foi marcado');
    let p = await P();
    assert.equal(p.linhas.find((l) => l.pedido === '810001').impressoEm, g1.impressoes[0].em); assert.equal(p.linhas.find((l) => l.pedido === '810003').impressoEm, null);
    assert.equal(p.totais.impressos, 3); assert.equal(p.transportadoras.find((t) => t.nome === 'Retira 02').impressos, 2);

    // reimpressão é permitida: novo listaId e nova linha em impressoes
    const j2 = await (await lista({ dia: hoje, ids: [ids['810001']] })).json();
    assert.notEqual(j2.listaId, j.listaId);
    assert.deepEqual(lerDia(hoje).entries.find((e) => e.id === ids['810001']).impressoes.map((x) => x.listaId), [j.listaId, j2.listaId]);
    // por transportadoras (várias): um grupo para cada, com todos os pedidos do dia delas
    const j3 = await (await lista({ dia: hoje, transportadoras: ['Brasil', 'tce', 'Retira 03'] })).json();
    assert.deepEqual(j3.grupos.map((g) => [g.transportadora, g.totalPedidos]), [['Brasil', 2], ['Retira 03', 1], ['TCE', 1]]);
    assert.equal((await lista({ dia: hoje, transportadoras: ['Brasil'] }, rec)).status, 200);
    // só guarda as 10 últimas impressões
    for (let i = 0; i < 11; i++) assert.equal((await lista({ dia: hoje, ids: [ids['810006']] })).status, 200);
    assert.equal(lerDia(hoje).entries.find((e) => e.id === ids['810006']).impressoes.length, 10);

    // ids de outro dia / inexistentes / mistos = 400, sem registrar nada
    const antes = JSON.stringify(lerDia(hoje).entries), antesOntem = JSON.stringify(lerDia(ontem).entries);
    assert.equal((await lista({ dia: hoje, ids: [deOntem.id] })).status, 400);
    assert.equal((await lista({ dia: hoje, ids: [ids['810001'], deOntem.id] })).status, 400);
    assert.equal((await lista({ dia: hoje, ids: ['fantasma'] })).status, 400);
    assert.equal(JSON.stringify(lerDia(hoje).entries), antes); assert.equal(JSON.stringify(lerDia(ontem).entries), antesOntem);
    const jo = await (await lista({ dia: ontem, ids: [deOntem.id] })).json();
    assert.equal(jo.dia, ontem); assert.equal(jo.grupos[0].linhas[0].nf, '5'); assert.equal(lerDia(ontem).entries.find((e) => e.id === deOntem.id).impressoes.length, 1);
    // formatos inválidos
    for (const c of [{ ids: [ids['810001']] }, { dia: '2026-02-30', ids: [ids['810001']] }, { dia: add(hoje, 1), ids: [ids['810001']] }, { dia: hoje }, { dia: hoje, ids: [] }, { dia: hoje, ids: 'x' }, { dia: hoje, ids: ['../x'] }, { dia: hoje, ids: [5] },
      { dia: hoje, transportadoras: [] }, { dia: hoje, transportadoras: ['Inexistente'] }, { dia: hoje, transportadoras: [5] }, { dia: hoje, transportadoras: 'Brasil' }, { dia: hoje, ids: [ids['810001']], transportadoras: ['Brasil'] },
      { dia: hoje, ids: Array.from({ length: 2001 }, (_, i) => 'a' + i) }]) assert.equal((await lista(c)).status, 400, JSON.stringify(c).slice(0, 70));
    // lista não deixa a nota "congelada": a nota nova do SC9 sai na lista seguinte
    await adm('/api/save', snapshot(PEDIDOS.map(([p0, t, nf]) => ordem(p0, { transportadora: t, nf: nf || '9' + p0.slice(2) })), []));
    const jn = await (await lista({ dia: hoje, ids: [ids['810002']] })).json();
    assert.equal(jn.grupos[0].linhas[0].nf, '90002'); assert.equal(jn.grupos[0].linhas[0].aguardandoNota, false);
  } finally { server.close(); }
});

test('POD: status, link https, "foto confere", histórico, filtros e só entram os pedidos que saíram', async () => {
  const { server, adm, criar, lerDia } = await subir();
  try {
    const hoje = hojeSP(), ontem = add(hoje, -1);
    const rec = await criar('rec', ['recebimento']), pod = await criar('conf', ['exp_pod']);
    const ids = await prepararDia(adm, rec);
    // 810001..810003 saem na lista; 810004 sai pela planilha de Entrega (ontem); 810005/810006 ainda não saíram
    await adm('/api/expedicao/lista', { dia: hoje, ids: [ids['810001'], ids['810002']] });
    await adm('/api/expedicao/lista', { dia: hoje, ids: [ids['810003']] });
    await adm('/api/save', snapshot([...PEDIDOS.map(([p, t, nf]) => ordem(p, { transportadora: t, nf })), ordem('810090', { nf: '90', transportadora: 'TCE' })], [['810004', { data: hoje, transportadora: 'Brasil' }], ['810090', { data: ontem, transportadora: 'TCE' }]]));
    await adm('/api/expedicao/rastreio', { id: ids['810001'], dia: hoje, codigo: 'VX123', link: 'https://velox.exemplo.com/VX123' });
    const E = async (q = '') => (await pod('/api/expedicao/entregas' + q)).json();

    let j = await E();
    assert.deepEqual(j.linhas.map((l) => l.pedido).sort(), ['810001', '810002', '810003', '810004', '810090'], 'só os que saíram (lista impressa ou Entrega)');
    assert.equal(j.total, 5); assert.equal(j.pagina, 1); assert.deepEqual(j.resumo, { pendente: 5, entregue: 0, divergente: 0, nao_entregue: 0 });
    const l1 = j.linhas.find((l) => l.pedido === '810001');
    for (const k of ['id', 'dia', 'pedido', 'nf', 'cliente', 'transportadora', 'volumes', 'dataSaida', 'rastreio', 'pod', 'observacao']) assert.ok(k in l1, 'campo ' + k);
    assert.deepEqual(l1.rastreio, { codigo: 'VX123', link: 'https://velox.exemplo.com/VX123' }); assert.equal(l1.pod, null); assert.equal(l1.nf, '9101'); assert.equal(l1.dataSaida, hoje);
    assert.equal(j.linhas.find((l) => l.pedido === '810090').dataSaida, ontem); assert.equal(j.linhas.find((l) => l.pedido === '810090').rastreio, null);

    // ---- gravar o POD
    const gr = (c, quem = pod) => quem('/api/expedicao/pod', Object.assign({ id: ids['810001'], dia: hoje }, c));
    for (const c of [
      {}, { status: 'qualquer' }, { status: 5 }, { status: 'ENTREGUE' }, { status: 'entregue', link: 'http://velox.exemplo.com/x' }, { status: 'entregue', link: 'javascript:alert(1)' }, { status: 'entregue', link: 'ftp://x.com/a' }, { status: 'entregue', link: 'https://' },
      { status: 'entregue', link: 'https://u:p@x.com/a' }, { status: 'entregue', link: 'https://x.com/a b' }, { status: 'entregue', link: 'https://x.com/' + 'a'.repeat(500) }, { status: 'entregue', link: 123 }, { status: 'entregue', fotoConfere: 'talvez' }, { status: 'entregue', fotoConfere: 1 },
      { status: 'entregue', obs: 'x'.repeat(401) }, { status: 'entregue', obs: { a: 1 } }, { status: 'entregue', codigo: 'c'.repeat(61) }, { status: 'entregue', codigo: '<script>' }, { id: '../x', status: 'entregue' }, { dia: '2026-02-30', status: 'entregue' }, { dia: add(hoje, 1), status: 'entregue' },
    ]) assert.equal((await gr(c)).status, 400, JSON.stringify(c).slice(0, 80));
    assert.equal((await gr({ id: 'fantasma', status: 'entregue' })).status, 404);
    assert.equal((await gr({ status: 'entregue' }, rec)).status, 403, 'recebimento não confere POD');
    assert.equal((await pod('/api/expedicao/entregas')).status, 200); // nada acima mexeu no registro
    assert.equal(lerDia(hoje).entries.find((e) => e.id === ids['810001']).pod, undefined);

    let r = await gr({ status: 'entregue', link: 'https://velox.exemplo.com/comprovante/1', codigo: 'VX123', fotoConfere: 'sim', obs: 'Foto legível, assinatura confere' });
    assert.equal(r.status, 200); j = await r.json();
    assert.equal(j.ok, true); assert.equal(j.pod.status, 'entregue'); assert.equal(j.pod.link, 'https://velox.exemplo.com/comprovante/1'); assert.equal(j.pod.fotoConfere, 'sim'); assert.equal(j.pod.verificadoPor, 'conf'); assert.equal(j.pod.verificadoNome, 'Pessoa conf'); assert.ok(j.pod.verificadoEm);
    assert.equal(j.podHistorico.length, 1);
    r = await gr({ status: 'divergente', fotoConfere: 'nao', obs: 'A foto é de outro pedido' }, adm);
    j = await r.json();
    assert.equal(j.pod.status, 'divergente'); assert.equal(j.pod.link, 'https://velox.exemplo.com/comprovante/1', 'link vazio não apaga o que já estava guardado'); assert.equal(j.pod.codigo, 'VX123');
    assert.deepEqual(j.podHistorico.map((h) => [h.status, h.por, h.obs]), [['entregue', 'conf', 'Foto legível, assinatura confere'], ['divergente', 'admin', 'A foto é de outro pedido']]);
    // repetir a mesma conferência não enche o histórico
    j = await (await gr({ status: 'divergente', fotoConfere: 'nao', obs: 'A foto é de outro pedido' }, adm)).json();
    assert.equal(j.semMudanca, true); assert.equal(j.podHistorico.length, 2);
    for (const s of ['nao_entregue', 'pendente', 'entregue']) assert.equal((await gr({ status: s, fotoConfere: 'nao_vi' })).status, 200);
    assert.equal(lerDia(hoje).entries.find((e) => e.id === ids['810001']).podHistorico.length, 5);
    await gr({ id: ids['810002'], status: 'entregue' }); await gr({ id: ids['810003'], status: 'nao_entregue', obs: 'Cliente ausente' });

    // ---- leitura: resumo, filtros, paginação
    j = await E();
    assert.deepEqual(j.resumo, { pendente: 2, entregue: 2, divergente: 0, nao_entregue: 1 }, '810001 voltou a entregue; 810002 entregue; 810003 não entregue');
    assert.equal(j.linhas.find((l) => l.pedido === '810003').pod.obs, 'Cliente ausente');
    j = await E('?status=entregue'); assert.deepEqual(j.linhas.map((l) => l.pedido).sort(), ['810001', '810002']); assert.equal(j.total, 2); assert.equal(j.resumo.pendente, 2, 'os KPIs não somem ao filtrar o status');
    assert.deepEqual((await E('?status=pendente')).linhas.map((l) => l.pedido).sort(), ['810004', '810090']);
    assert.deepEqual((await E('?transportadora=TCE')).linhas.map((l) => l.pedido), ['810090']);
    assert.deepEqual((await E('?q=vx123')).linhas.map((l) => l.pedido), ['810001'], 'busca pelo código');
    assert.deepEqual((await E('?q=810003')).linhas.map((l) => l.pedido), ['810003']);
    j = await E('?limite=2&pagina=2'); assert.equal(j.linhas.length, 2); assert.equal(j.total, 5); assert.equal(j.paginas, 3);
    assert.equal((await E('?de=' + ontem + '&ate=' + ontem)).linhas.length, 1, 'período');
    for (const q of ['?status=qualquer', '?de=2026-13-01', `?de=${add(hoje, -70)}&ate=${hoje}`, `?de=${hoje}&ate=${add(hoje, -2)}`, '?limite=501', '?limite=0', '?pagina=0', '?q=1', '?transportadora=' + 'x'.repeat(61)]) assert.equal((await pod('/api/expedicao/entregas' + q)).status, 400, q);
    assert.equal((await pod(`/api/expedicao/entregas?de=${add(hoje, -61)}&ate=${hoje}`)).status, 200, '62 dias cabem');
    // a troca de transportadora aparece aqui também
    await adm('/api/expedicao/transportadora', { id: ids['810002'], dia: hoje, para: 'Brasil', motivo: 'saiu pela Brasil' });
    assert.equal((await E('?transportadora=Brasil')).linhas.some((l) => l.pedido === '810002'), true);
    // o POD sobrevive ao SC9 novo
    await adm('/api/save', snapshot(PEDIDOS.map(([p, t, nf]) => ordem(p, { transportadora: t, nf: nf || '1' })), []));
    assert.equal(lerDia(hoje).entries.find((e) => e.id === ids['810003']).pod.status, 'nao_entregue');
  } finally { server.close(); }
});

test('a nota aparece sozinha depois de /api/save, sem sobrescrever com vazio, e troca/observação/POD sobrevivem ao SC9 novo', async () => {
  const { server, adm, criar, lerDia } = await subir();
  try {
    const hoje = hojeSP();
    const rec = await criar('rec', ['recebimento']), bip = await criar('bip', ['exp_bipar']);
    await adm('/api/save', snapshot([ordem('830001', { transportadora: 'Retira 02' }), ordem('830002', { transportadora: 'TCE', nf: '4002' })], []));
    const b = await (await bip('/api/recebimento/bipar', { pedido: '830001' })).json();
    assert.equal(b.resumo.aguardandoNota, true);
    const id = b.entry.id;
    const linha = async () => (await (await adm('/api/expedicao/planilha')).json()).linhas.find((l) => l.pedido === '830001');
    let l = await linha();
    assert.equal(l.aguardandoNota, true); assert.equal(l.nf, ''); assert.equal(l.bipadoPor, 'Pessoa bip');
    await adm('/api/expedicao/observacao', { id, dia: hoje, texto: 'Aguardando faturar' });
    await adm('/api/expedicao/transportadora', { id, dia: hoje, para: 'Brasil', motivo: 'Mudou na hora do embarque' });
    await adm('/api/expedicao/lista', { dia: hoje, ids: [id] });
    await adm('/api/expedicao/pod', { id, dia: hoje, status: 'entregue' });

    // SC9 novo com a nota: aparece sozinha na planilha, na lista do bipar e na lista de saída
    const s = await (await adm('/api/save', snapshot([ordem('830001', { transportadora: 'Retira 03', nf: '8301', nome: 'NOME NOVO' }), ordem('830002', { transportadora: 'TCE', nf: '4002' })], []))).json();
    assert.ok(s.expedicao.preenchidos >= 1);
    l = await linha();
    assert.equal(l.nf, '8301'); assert.equal(l.aguardandoNota, false);
    assert.equal(l.transportadora, 'Brasil', 'a troca vale mais do que a transportadora que o SC9 trouxe depois'); assert.equal(l.trocada, true);
    assert.equal(l.observacao, 'Aguardando faturar'); assert.equal(l.podStatus, 'entregue'); assert.ok(l.impressoEm);
    assert.equal(l.cliente, 'CLIENTE 830001', 'dado já preenchido não é trocado');
    const meu = (await (await bip('/api/recebimento')).json()).entries[0];
    assert.equal(meu.info.nf, '8301'); assert.equal(meu.aguardandoNota, false);
    const li = await (await adm('/api/expedicao/lista', { dia: hoje, ids: [id] })).json();
    assert.equal(li.grupos[0].linhas[0].nf, '8301'); assert.equal(li.grupos[0].transportadora, 'Brasil');
    // SC9 seguinte sem nota (planilha parcial): nunca apaga
    await adm('/api/save', snapshot([ordem('830001', { nf: '', transportadora: '' })], []));
    l = await linha();
    assert.equal(l.nf, '8301'); assert.equal(l.transportadoraOriginal, 'Retira 02'); assert.equal(l.transportadora, 'Brasil');
    const g = lerDia(hoje).entries.find((e) => e.id === id);
    assert.equal(g.info.transportadora, 'Retira 02', 'a original gravada não muda'); assert.equal(g.observacoes.length, 1); assert.equal(g.impressoes.length, 2); assert.equal(g.pod.status, 'entregue');
  } finally { server.close(); }
});

test('idempotência e concorrência: pedidos simultâneos não perdem observação, troca, POD nem impressão, nem com um /api/save no meio', async () => {
  const { server, adm, criar, lerDia } = await subir();
  try {
    const hoje = hojeSP();
    const rec = await criar('rec', ['recebimento']), pod = await criar('conf', ['exp_pod']);
    const ids = await prepararDia(adm, rec);
    const id = ids['810001'];
    // 12 observações ao mesmo tempo + salvar o SC9 no meio
    const rs = await Promise.all([
      ...Array.from({ length: 12 }, (_, i) => adm('/api/expedicao/observacao', { id, dia: hoje, texto: 'obs simultânea ' + i })),
      adm('/api/save', snapshot(PEDIDOS.map(([p, t, nf]) => ordem(p, { transportadora: t, nf: nf || '5' })), [])),
      adm('/api/expedicao/observacao', { id: ids['810002'], dia: hoje, texto: 'outra' }),
    ]);
    assert.ok(rs.every((r) => r.status === 200), rs.map((r) => r.status).join());
    let g = lerDia(hoje).entries.find((e) => e.id === id);
    assert.equal(g.observacoes.length, 12); assert.deepEqual([...g.observacoes.map((o) => o.texto)].sort(), Array.from({ length: 12 }, (_, i) => 'obs simultânea ' + i).sort());
    assert.equal(g.info.nf, '9101'); assert.equal(lerDia(hoje).entries.find((e) => e.id === ids['810002']).info.nf, '5', 'o save simultâneo também preencheu a nota');
    // o mesmo pedido de troca em dobro: um muda, o outro é "sem mudança"
    const [t1, t2] = await Promise.all([1, 2].map(() => adm('/api/expedicao/transportadora', { ids: [{ id, dia: hoje }, { id: ids['810003'], dia: hoje }], para: 'Brasil', motivo: 'duplo clique na troca' })));
    assert.equal(t1.status, 200); assert.equal(t2.status, 200);
    const [a, b] = [await t1.json(), await t2.json()];
    assert.equal(a.alterados + b.alterados, 2); assert.equal(a.semMudanca + b.semMudanca, 2);
    assert.equal(lerDia(hoje).entries.find((e) => e.id === id).trocas.length, 1);
    // POD simultâneos de pessoas diferentes: todos entram no histórico
    const pods = await Promise.all(['entregue', 'divergente', 'nao_entregue', 'pendente', 'entregue'].map((s, i) => (i % 2 ? pod : adm)('/api/expedicao/pod', { id, dia: hoje, status: s, obs: 'conferência ' + i })));
    assert.ok(pods.every((r) => r.status === 200));
    g = lerDia(hoje).entries.find((e) => e.id === id);
    assert.equal(g.podHistorico.length, 5); assert.equal(g.pod.status, g.podHistorico[4].status);
    // listas simultâneas: cada uma com o seu listaId
    const ls = await Promise.all([1, 2, 3].map(() => adm('/api/expedicao/lista', { dia: hoje, ids: [id] })));
    const lids = (await Promise.all(ls.map(json))).map((x) => x.listaId);
    assert.equal(new Set(lids).size, 3);
    assert.deepEqual(lerDia(hoje).entries.find((e) => e.id === id).impressoes.map((x) => x.listaId).sort(), [...lids].sort());
    // bipar o mesmo pedido ao mesmo tempo: um entra, o outro é duplicado
    await adm('/api/save', snapshot([ordem('810777', { nf: '1' })], []));
    const bs = await Promise.all([1, 2, 3].map(() => rec('/api/recebimento/bipar', { pedido: '810777' })));
    assert.deepEqual(bs.map((r) => r.status).sort(), [200, 409, 409]);
    // tudo continua legível e coerente
    const p = await (await adm('/api/expedicao/planilha')).json();
    assert.equal(p.linhas.length, 7); assert.equal(new Set(p.linhas.map((l) => l.id)).size, 7);
  } finally { server.close(); }
});

test('compatibilidade: perfis antigos (recebimento, despacho) seguem como antes e as rotas novas têm limite por minuto', async () => {
  const { server, adm, criar } = await subir();
  try {
    const hoje = hojeSP();
    const rec = await criar('rec', ['recebimento']), desp = await criar('desp', ['despacho']);
    await adm('/api/save', snapshot([ordem('840001', { nf: '1' })], [['840001', { data: hoje, transportadora: 'Retira 02' }]]));
    // recebimento: bipa, lê tudo do dia, fecha o dia, pesquisa, mexe na planilha; não confirma com a Entrega nem importa
    const lp = await (await desp('/api/expedicao/planilha')).json();
    assert.equal(lp.linhas.length, 1); assert.equal(lp.linhas[0].origem, 'entrega'); assert.equal(lp.linhas[0].situacao, 'saiu'); assert.equal(lp.linhas[0].saiuEntrega.dataEntrega, hoje);
    assert.equal((await rec('/api/recebimento/bipar', { pedido: '840001' })).status, 200, 'o bipe promove a entrada que veio da planilha (v1)');
    assert.equal((await rec('/api/recebimento')).status, 200); assert.equal((await rec('/api/recebimento/fechamento')).status, 200); assert.equal((await rec('/api/recebimento/pesquisar?q=840001')).status, 200);
    assert.equal((await rec('/api/expedicao/painel')).status, 200); assert.equal((await rec('/api/expedicao/planilha')).status, 200);
    assert.equal((await rec('/api/recebimento/entrega', { linhas: [['840001', hoje, 'X']] })).status, 403);
    // despacho: lê, importa/confirma com a Entrega, planilha; continua sem bipar
    assert.equal((await desp('/api/recebimento')).status, 200); assert.equal((await desp('/api/recebimento/fechamento')).status, 200);
    assert.equal((await desp('/api/recebimento/entrega', { linhas: [['840001', hoje, 'X']] })).status, 200);
    assert.equal((await desp('/api/recebimento/bipar', { pedido: '840002' })).status, 403);
    // perfis desconhecidos continuam sendo descartados; os novos são aceitos no cadastro e ficam no perfil
    const u = await (await adm('/api/usuarios', { acao: 'criar', usuario: 'novo', nome: 'Pessoa Nova', senha: 'senha-novo-xyz1', perfis: ['exp_bipar', 'exp_pod', 'perfil_que_nao_existe'] })).json();
    assert.deepEqual(u.usuarios.find((x) => x.usuario === 'novo').perfis, ['exp_bipar', 'exp_pod']);
    const u2 = await (await adm('/api/usuarios', { acao: 'perfis', usuario: 'novo', perfis: ['exp_planilha'] })).json();
    assert.deepEqual(u2.usuarios.find((x) => x.usuario === 'novo').perfis, ['exp_planilha']);
    // limite por minuto: lista 60/min por pessoa
    const e = (await (await adm('/api/expedicao/planilha')).json()).linhas[0];
    let ultimo = 0;
    for (let i = 0; i < 62; i++) ultimo = (await adm('/api/expedicao/lista', { dia: hoje, ids: [e.id] })).status;
    assert.equal(ultimo, 429);
  } finally { server.close(); }
});

test('bundle.js: só entraram os 3 perfis novos (cadastro, botões da lista e aba Recebimento Expedição); o resto ficou byte a byte igual', () => {
  const crypto2 = require('node:crypto');
  const atual = fs.readFileSync(path.join(__dirname, '..', 'bundle.js'), 'utf8');
  const trocas = [
    ['et.includes("recebimento")||et.includes("despacho"),Ae=', 'et.includes("recebimento")||et.includes("despacho")||et.includes("exp_bipar")||et.includes("exp_planilha")||et.includes("exp_pod"),Ae='],
    ['["ocorrencias","Ocorrências da expedição (digitar e acompanhar)"]]', '["ocorrencias","Ocorrências da expedição (digitar e acompanhar)"],["exp_bipar","Expedição: só bipar o pedido recebido"],["exp_planilha","Expedição: planilha de entrega (ver, filtrar, imprimir)"],["exp_pod","Expedição: conferir entregas (POD)"]]'],
    ['["ocorrencias","Ocorr."]]', '["ocorrencias","Ocorr."],["exp_bipar","Exp. bipar"],["exp_planilha","Exp. planilha"],["exp_pod","Exp. POD"]]'],
  ];
  let original = atual;
  for (const [antes, depois] of trocas) {
    assert.equal(original.split(depois).length - 1, 1, 'cada trecho novo aparece exatamente uma vez');
    original = original.replace(depois, antes);
  }
  assert.ok(!/exp_(bipar|planilha|pod)/.test(original), 'nenhum outro uso dos perfis novos no bundle');
  // o bundle do commit db4a9cf (main antes desta mudança) tem este SHA-256; desfazendo os 3 trechos, volta exatamente a ele.
  // Se OUTRA mudança no bundle for feita depois, atualize este hash (ele serve para provar que a mudança dos perfis foi cirúrgica).
  assert.equal(crypto2.createHash('sha256').update(original).digest('hex'), '84ac1b4ddfe40104a52cc78f2bd99019da321cec14e053e000ca5c9864a6b61d');
  // finais de linha preservados (CRLF) e o arquivo continua sendo JavaScript válido
  const buf = fs.readFileSync(path.join(__dirname, '..', 'bundle.js'));
  const crlf = (buf.toString('latin1').match(/\r\n/g) || []).length, lf = (buf.toString('latin1').match(/\n/g) || []).length;
  assert.equal(crlf, lf, 'nenhum LF solto'); assert.equal(crlf, 28);
  assert.doesNotThrow(() => new Function(atual));
});

test('revisão: exp_bipar não vê troca e não desfaz bipe que já tem dados registrados', async () => {
  const { server, adm, criar } = await subir();
  try {
    const bip = await criar('bipx', ['exp_bipar']);
    await adm('/api/save', snapshot([ordem('812001'), ordem('812002')], []));
    const b1 = await (await bip('/api/recebimento/bipar', { pedido: '812001' })).json();
    const b2 = await (await bip('/api/recebimento/bipar', { pedido: '812002' })).json();
    const dia = hojeSP();
    const t = await adm('/api/expedicao/transportadora', { id: b1.entry.id, dia, para: 'Brasil', motivo: 'Era Retira 02, saiu Brasil' });
    assert.equal(t.status, 200);
    const lista = await (await bip('/api/recebimento')).json();
    const e = JSON.stringify(lista);
    assert.ok(!/transportadoraOriginal|trocada/.test(e), 'não vaza troca para quem só bipa');
    const d1 = await bip('/api/recebimento/desfazer', { id: b1.entry.id });
    assert.equal(d1.status, 409);
    const d2 = await bip('/api/recebimento/desfazer', { id: b2.entry.id });
    assert.equal(d2.status, 200);
  } finally { server.close(); }
});
