// Onda 2 das vendedoras (front): entrada única "Início", regras do que cabe em cada etapa, leitura de lista de pedidos, nav com 4 itens, formulários antigos
// acessíveis, selo de respostas novas e segurança. O visual foi conferido no navegador (Playwright, 390x844 e 1440x900).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RAIZ = path.join(__dirname, '..');
const ler = (f) => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const SS = require('../solicitacoes-store.js');
const win = { Central: { icone: () => ({}), h: () => ({}) } }; win.window = win;
vm.runInNewContext(ler('solicitacoes-comum.js'), win); vm.runInNewContext(ler('vendedoras-inicio.js'), win);
const T = win.VendInicio._teste;
const plano = (x) => JSON.parse(JSON.stringify(x));

test('lista de pedidos: vírgula, espaço e linha; sem duplicados, normalizada, no máximo 20 e o resto é contado', () => {
  assert.deepEqual(plano(T.lerPedidos('123456, 0123457  123458\n123456;abc 12 99999999999 123459.0')), { lista: ['123456', '123457', '123458', '123459'], ruins: 3, excesso: 0 });
  const grande = Array.from({ length: 500 }, (_, i) => String(700000 + i)).join(' ');
  const r = plano(T.lerPedidos(grande)); assert.equal(r.lista.length, 20); assert.equal(r.excesso, 480);
  assert.deepEqual(plano(T.lerPedidos('')), { lista: [], ruins: 0, excesso: 0 }); assert.deepEqual(plano(T.lerPedidos(null)).lista, []);
  assert.deepEqual(plano(T.lerPedidos('constructor __proto__ <script>')).lista, []);
});

test('o que cabe em cada etapa (tabela do UX): cancelar só vira "ainda dá tempo" sem separação; NF só depois de faturar; despachado só aceita nota', () => {
  const ok = (tipo, etapa) => T.regra(tipo, etapa).ok;
  assert.equal(ok('cancelar_pedido', 'nao_separado'), true); assert.match(T.regra('cancelar_pedido', 'nao_separado').texto, /dá tempo/);
  assert.match(T.regra('cancelar_pedido', 'em_separacao').texto, /avalia/); assert.match(T.regra('cancelar_pedido', 'separado').texto, /pode não dar tempo/);
  for (const e of ['faturado', 'despachado', 'nao_achado']) assert.equal(ok('cancelar_pedido', e), false, 'cancelar ' + e);
  for (const e of ['nao_separado', 'em_separacao', 'separado', 'conferido', 'nao_achado']) assert.equal(ok('nota_fiscal', e), false, 'NF ' + e);
  for (const e of ['faturado', 'despachado']) assert.equal(ok('nota_fiscal', e), true, 'NF ' + e);
  assert.equal(ok('sair_hoje', 'faturado'), false); assert.equal(ok('sair_hoje', 'conferido'), true); assert.equal(ok('saida_especial', 'faturado'), true);
  for (const tipo of Object.keys(T.REGRAS)) { assert.equal(ok(tipo, 'despachado'), tipo === 'nota_fiscal', 'despachado ' + tipo); assert.equal(ok(tipo, 'nao_achado'), false, 'não achado ' + tipo); assert.ok(T.regra(tipo, 'despachado').texto || ok(tipo, 'despachado'), 'o que não cabe sempre explica o motivo'); }
  assert.equal(ok('sair_hoje', ''), false, 'sem etapa = tratado como não achado');
});

test('cada cartão leva a um tipo que o servidor conhece, com regra e campos; o formulário não inventa campo fora do servidor', () => {
  for (const [tipo, card] of Object.entries(T.CARTAO_DO_TIPO)) {
    assert.ok(SS.TIPOS[tipo], tipo + ' existe no servidor'); assert.ok(T.CAMPOS[tipo], tipo + ' tem formulário'); assert.ok(T.CARTOES.some((c) => c.id === card && c.opcoes.includes(tipo)), tipo + ' está num cartão');
    if (tipo !== 'subir_pedido') assert.ok(T.REGRAS[tipo], tipo + ' tem regra por etapa');
  }
  assert.equal(T.CARTOES.filter((c) => !c.ir).length + 1, 6, 'cinco cartões de pedido + "Transferência e estoque" = seis; o sétimo é "Outro assunto"');
  const nomes = (tipo) => new Set(T.CAMPOS[tipo].map((c) => c.id));
  assert.deepEqual([...nomes('saida_especial')].sort(), ['detalhe', 'dia', 'filial', 'hora', 'modo', 'quem', 'transportadora']); assert.deepEqual([...nomes('subir_pedido')].sort(), ['filial', 'onde', 'pv']);
  const enums = { sair_hoje: ['motivo', 'motivoSair'], saida_especial: ['modo', 'modoSaida'], nota_fiscal: ['subtipo', 'subtipoNf'], falta_item: ['acao', 'acaoFalta'], erro_pedido: ['modo', 'modoErro'] };
  for (const [tipo, [campo, lista]] of Object.entries(enums)) { const c = T.CAMPOS[tipo].find((x) => x.id === campo), valores = plano(win.SolComum.ENUMS[lista]).map((x) => x[0]); assert.deepEqual(plano(c.op).map((x) => x[0]), valores); }
});

test('navegação: Início · Acompanhar · Minhas · Exportar; formulários antigos e ?aba= continuam acessíveis', () => {
  const v = ler('vendedoras.js'), h = ler('vendedoras.html');
  assert.match(v, /const NAV = \[\['inicio'.*\['rastrear'.*\['minhas'.*\['exportar'[^\]]*\]\];/);
  assert.ok(!/const NAV = .*'prioridade'/.test(v.split('\n').find((l) => l.includes('const NAV ='))), 'prioridade/avisar/solicitar saíram da barra');
  assert.match(v, /ABAS_VALIDAS = \['inicio', 'rastrear', 'prioridade', 'avisar', 'solicitar', 'minhas', 'exportar', 'conta'\]/);
  for (const [id] of [['prioridade'], ['avisar'], ['solicitar']]) assert.ok(ler('vendedoras-inicio.js').includes("['" + id + "'"), 'link "Outros caminhos" para ' + id);
  assert.ok(h.indexOf('/solicitacoes-vend.js') < h.indexOf('/vendedoras-inicio.js') && h.indexOf('/vendedoras-inicio.js') < h.indexOf('/vendedoras.js'));
  assert.match(ler('server.js'), /SERVABLE\.add\("vendedoras-inicio\.js"\)/);
  assert.match(v, /telaInicial\(\)/); assert.match(v, /q\.get\('pedido'\) \? 'rastrear' : 'inicio'/, 'link com ?pedido= continua abrindo o rastreio');
});

test('respostas novas: selo em Minhas, título da aba e atualização de 1 minuto também fora da aba Minhas; modelos e "Pedir de novo" ligados', () => {
  const v = ler('vendedoras.js');
  assert.match(v, /id: 'selo-minhas'/); assert.match(v, /root\.document\.title = \(novosMinhas\(\)\.length \? '\(' \+ novosMinhas\(\)\.length \+ '\) ' : ''\)/);
  assert.match(v, /root\.setInterval\(atualizarEmSilencio, 60000\)/);
  assert.ok(!/function atualizarEmSilencio[\s\S]{0,200}document\.hidden/.test(v), 'atualiza também com a aba em segundo plano (o título é o aviso)');
  assert.match(v, /repetir: \(l\) =>/); assert.match(ler('solicitacoes-vend.js'), /Pedir de novo/); assert.match(ler('vendedoras-inicio.js'), /\/api\/vendedoras\/modelos/);
  assert.match(ler('vendedoras-inicio.js'), /LS_MOD = 'sc9v_modelos'/, 'sem login o modelo fica no aparelho');
});

test('segurança do front novo: nada de HTML cru; textos do servidor entram por textContent', () => {
  for (const f of ['vendedoras-inicio.js', 'vendedoras.js', 'solicitacoes-vend.js', 'solicitacoes-ui.js', 'armazens-ui.js', 'solicitacoes-comum.js']) assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(ler(f)), f);
});
