'use strict';
const test = require('node:test');
const assert = require('node:assert');
const T = require('../entradas-tdc.js');

const sd1 = (nota, produto, lote, qt, dtDigit, usuario = 'tdc1') => ({ nota, serie: '1', fornecedor: 'FORN', produto, lote, qt, armazem: '59', dtDigit, emissao: dtDigit, hora: '09:00', usuario, validade: '', tipo: '', cfop: '' });
const mv = (o) => ({ estornado: false, usuario: 'est1', ...o });
// par de transferência RE4 (saída) + DE4 (entrada)
const transf = (doc, produto, qt, dia, armOrig, loteOrig, armDest, loteDest) => [
  mv({ tp: 999, cf: 'RE4', doc, produto, qt, dia, armazem: armOrig, lote: loteOrig }),
  mv({ tp: 499, cf: 'DE4', doc, produto, qt, dia, armazem: armDest, lote: loteDest }),
];

function cenario() {
  const s1 = [
    sd1('100', 'P1', 'L1', 8, '2026-10-01'),
    sd1('101', 'P2', 'L2', 10, '2026-10-01'),
    sd1('102', 'P4', 'L4', 10, '2026-10-01'),
    sd1('103', 'P5', 'L5', 10, '2026-10-01', 'tdc2'),
    sd1('104', 'P6', 'L6', 5, '2026-10-01', 'tdc2'),
    sd1('105', 'P7', 'L7', 10, '2026-10-01', 'tdc2'),
    sd1('106', 'P8', 'L8', 6, '2026-10-01'),
  ];
  const s3 = [
    // A: qtd maior (nota 8, físico 10)
    mv({ tp: 5, cf: 'DE0', doc: 'M-A', produto: 'P1', qt: 2, dia: '2026-10-03', armazem: '59', lote: 'L1' }),
    ...transf('T1', 'P1', 10, '2026-10-03', '59', 'L1', '01', 'L1'),
    // B: qtd menor
    mv({ tp: 501, cf: 'RE0', doc: 'M-B', produto: 'P2', qt: 3, dia: '2026-10-02', armazem: '59', lote: 'L2' }),
    ...transf('T2', 'P2', 7, '2026-10-03', '59', 'L2', '01', 'L2'),
    // C: item fora da nota
    mv({ tp: 5, cf: 'DE0', doc: 'M-C', produto: 'P3', qt: 5, dia: '2026-10-04', armazem: '59', lote: 'L3' }),
    // D: lote trocado dentro do 59
    ...transf('X1', 'P4', 10, '2026-10-02', '59', 'L4', '59', 'L4B'),
    // E: lote misturado por ajuste manual
    mv({ tp: 501, cf: 'RE0', doc: 'M-E', produto: 'P5', qt: 4, dia: '2026-10-05', armazem: '59', lote: 'L5' }),
    mv({ tp: 5, cf: 'DE0', doc: 'M-E', produto: 'P5', qt: 4, dia: '2026-10-05', armazem: '59', lote: 'L5B' }),
    // F: subiu com outro lote
    ...transf('Y1', 'P6', 5, '2026-10-02', '59', 'L6', '01', 'L6B'),
    // G: suspeita
    ...transf('Z1', 'P7', 10, '2026-10-04', '59', 'L7B', '01', 'L7B'),
    // H: limpo
    ...transf('H1', 'P8', 6, '2026-10-02', '59', 'L8', '01', 'L8'),
    // estornado deve ser ignorado
    mv({ tp: 5, cf: 'DE0', doc: 'M-Z', produto: 'P8', qt: 99, dia: '2026-10-03', armazem: '59', lote: 'L8', estornado: true }),
  ];
  return T.analisar(s1, s3, { hoje: '2026-10-10' });
}

const achar = (res, nota, tipo) => res.findings.find((f) => f.nota === nota && f.tipo === tipo);

test('qtd maior: nota 8, físico 10', () => {
  const f = achar(cenario(), '100', 'qtd_maior');
  assert.ok(f); assert.strictEqual(f.qtdNota, 8); assert.strictEqual(f.qtdFisica, 10); assert.strictEqual(f.diferenca, 2); assert.strictEqual(f.confianca, 'forte');
});
test('qtd menor', () => {
  const f = achar(cenario(), '101', 'qtd_menor');
  assert.ok(f); assert.strictEqual(f.qtdFisica, 7); assert.strictEqual(f.diferenca, 3);
});
test('item fora da nota', () => {
  const f = cenario().findings.find((x) => x.tipo === 'item_fora_nota');
  assert.ok(f); assert.strictEqual(f.produto, 'P3'); assert.strictEqual(f.qtdFisica, 5); assert.ok(f.id.startsWith('SEM-NOTA|'));
});
test('lote trocado: transferência interna no 59', () => {
  const f = achar(cenario(), '102', 'lote_trocado');
  assert.ok(f); assert.strictEqual(f.lote, 'L4'); assert.strictEqual(f.loteFisico, 'L4B'); assert.strictEqual(f.confianca, 'forte');
});
test('lote misturado: ajuste manual saída X + entrada Y', () => {
  const f = achar(cenario(), '103', 'lote_trocado');
  assert.ok(f); assert.strictEqual(f.lote, 'L5'); assert.strictEqual(f.loteFisico, 'L5B'); assert.strictEqual(f.diferenca, 4);
  assert.ok(/misturado/i.test(f.descricao));
});
test('lote trocado ao subir para o 01 com outro lote', () => {
  const f = achar(cenario(), '104', 'lote_trocado');
  assert.ok(f); assert.strictEqual(f.loteFisico, 'L6B'); assert.strictEqual(f.confianca, 'forte');
});
test('suspeita: nota ficou parada e outro lote subiu', () => {
  const f = achar(cenario(), '105', 'lote_trocado');
  assert.ok(f); assert.strictEqual(f.confianca, 'suspeita'); assert.ok(f.loteFisico.includes('L7B'));
});
test('item limpo não gera achado e mede o tempo', () => {
  const r = cenario();
  assert.strictEqual(r.findings.filter((f) => f.nota === '106').length, 0);
  const it = r.itens.find((i) => i.nota === '106');
  assert.strictEqual(it.diasAteSubir, 1); assert.strictEqual(it.diasAteConcluir, 1); assert.strictEqual(it.erroForte, false);
});
test('resumo e tempo com erro x sem erro', () => {
  const r = cenario();
  assert.strictEqual(r.resumo.notas, 7);
  assert.strictEqual(r.resumo.suspeitas, 1);
  assert.ok(r.resumo.notasErro >= 5);
  assert.strictEqual(r.resumo.diasMediaLimpos, 1);
  const p1 = r.itens.find((i) => i.nota === '100'); assert.strictEqual(p1.diasAteConcluir, 2); assert.strictEqual(p1.erroForte, true);
  assert.ok(r.resumo.porUsuario.find((u) => u.usuario === 'tdc2').notasErro >= 2);
});
test('estornado é ignorado', () => {
  const r = cenario();
  assert.strictEqual(r.findings.filter((f) => f.produto === 'P8').length, 0);
});
test('item aguardando subir passa do limite', () => {
  const r = T.analisar([sd1('200', 'PX', 'LX', 3, '2026-10-01')], [...transf('Z', 'PY', 1, '2026-09-25', '59', 'LY', '01', 'LY'), ...transf('Z2', 'PY', 1, '2026-10-09', '59', 'LY', '01', 'LY')], { hoje: '2026-10-10' });
  assert.strictEqual(r.itens[0].aguardandoSubir, true); assert.strictEqual(r.resumo.aguardando, 1);
});
test('ids são estáveis e revisões se aplicam', () => {
  const a = cenario(), b = cenario();
  assert.deepStrictEqual(a.findings.map((f) => f.id), b.findings.map((f) => f.id));
  const f0 = a.findings[0];
  const rev = T.aplicarRevisoes(a.findings, { [f0.id]: { status: 'confirmado', por: 'x' } });
  assert.strictEqual(rev[0].status, 'confirmado'); assert.strictEqual(rev[1].status, 'pendente');
});
test('paraISO / paraHora', () => {
  assert.strictEqual(T.paraISO('03/10/2026'), '2026-10-03');
  assert.strictEqual(T.paraISO('20261003'), '2026-10-03');
  assert.strictEqual(T.paraISO(46298), '2026-10-03');
  assert.strictEqual(T.paraISO(new Date(Date.UTC(2026, 9, 3))), '2026-10-03');
  assert.strictEqual(T.paraHora(0.5), '12:00'); assert.strictEqual(T.paraHora('9:05:11'), '09:05');
});
test('detecta colunas do SD1 e lê as linhas', () => {
  const aoa = [['Relatório de entradas'], [], ['Filial', 'Documento', 'Série', 'Nome Fornecedor', 'Produto', 'Lote', 'Quantidade', 'Armazém', 'Dt Digit', 'Usuário'],
    ['01', '000123', '1', 'ACME', '0000450', 'abc1', '1.250,5', '59', '03/10/2026', 'MARIA'], ['01', '000123', '1', 'ACME', '', '', 5, '59', '03/10/2026', 'MARIA']];
  const d = T.detectarColunasSD1(aoa);
  assert.strictEqual(d.linhaCab, 2); assert.deepStrictEqual(d.faltando, []);
  const l = T.lerSD1(aoa, d.mapa, d.linhaCab);
  assert.strictEqual(l.length, 1);
  assert.deepStrictEqual([l[0].nota, l[0].produto, l[0].lote, l[0].qt, l[0].dtDigit, l[0].usuario, l[0].armazem], ['000123', '450', 'ABC1', 1250.5, '2026-10-03', 'maria', '59']);
});
test('compactar/expandir SD1 ida e volta', () => {
  const l = [sd1('1', 'P', 'L', 3, '2026-10-01', 'ana')];
  assert.deepStrictEqual(T.expandirSD1(T.compactarSD1(l)), l);
});
test('linhas da súmula', () => {
  const r = cenario();
  const ach = T.aplicarRevisoes(r.findings, {}).map((a, i) => (i === 0 ? { ...a, status: 'confirmado', revisao: { status: 'confirmado', por: 'est1', em: '2026-10-06T10:00:00Z' } } : a));
  const s = T.linhasSumula(r, ach, { somenteConfirmados: true });
  assert.strictEqual(s.detalhe.length, 2);
  assert.ok(s.resumo.length > 10); assert.strictEqual(s.tempo.length, r.itens.length + 1);
  const todos = T.linhasSumula(r, ach, { somenteConfirmados: false });
  assert.strictEqual(todos.detalhe.length, r.findings.length + 1);
});
test('ignorar descartados refaz o resumo; revisão sobrescreve físico e tipo', () => {
  const s1 = [sd1('100', 'P1', 'L1', 8, '2026-10-01')];
  const s3 = [mv({ tp: 5, cf: 'DE0', doc: 'M', produto: 'P1', qt: 2, dia: '2026-10-03', armazem: '59', lote: 'L1' })];
  const r = T.analisar(s1, s3, { hoje: '2026-10-10' });
  assert.strictEqual(r.resumo.notasErro, 1);
  const r2 = T.analisar(s1, s3, { hoje: '2026-10-10', ignorar: new Set([r.findings[0].id]) });
  assert.strictEqual(r2.resumo.notasErro, 0); assert.strictEqual(r2.findings.length, 1);
  const a = T.aplicarRevisoes(r.findings, { [r.findings[0].id]: { status: 'confirmado', tipo: 'qtd_menor', fisicoQtd: 5, fisicoLote: 'zz' } })[0];
  assert.strictEqual(a.tipo, 'qtd_menor'); assert.strictEqual(a.qtdFisica, 5); assert.strictEqual(a.diferenca, 3); assert.strictEqual(a.loteFisico, 'ZZ');
});
test('buscarNota: acha pelo número digitado (com/sem zeros) e separa séries', () => {
  const l = [sd1('000123', 'P1', 'L1', 8, '2026-10-01'), sd1('000123', 'P2', 'L2', 3, '2026-10-01'), sd1('000124', 'P1', 'L1', 8, '2026-10-05'), { ...sd1('123', 'P9', 'L9', 1, '2026-10-01'), serie: '2' }];
  const b = T.buscarNota(l, '123');
  assert.strictEqual(b.itens.length, 3); assert.deepStrictEqual(b.series.sort(), ['1', '2']);
  assert.strictEqual(T.buscarNota(l, '123', '2').itens.length, 1);
  assert.strictEqual(T.buscarNota(l, '999').itens.length, 0);
});
test('escopo por nota: mesmo lote em outra nota não se mistura, e o item fora da nota vira candidato', () => {
  // NF 1 (01/10) e NF 2 (08/10) com o MESMO produto/lote. Ajuste manual dia 09/10 pertence à NF 2 (a mais recente), não à NF 1.
  const s1 = [sd1('1', 'P1', 'L1', 8, '2026-10-01'), sd1('2', 'P1', 'L1', 5, '2026-10-08')];
  const s3 = [
    ...transf('T1', 'P1', 8, '2026-10-02', '59', 'L1', '01', 'L1'),
    mv({ tp: 5, cf: 'DE0', doc: 'M1', produto: 'P1', qt: 2, dia: '2026-10-09', armazem: '59', lote: 'L1' }),
    mv({ tp: 5, cf: 'DE0', doc: 'M2', produto: 'P7', qt: 4, dia: '2026-10-03', armazem: '59', lote: 'LZ' }),
  ];
  const r1 = T.analisar(s1, s3, { hoje: '2026-10-10', notas: [{ nota: '000001' }] });
  assert.strictEqual(r1.findings.length, 0); assert.strictEqual(r1.itens.length, 1); assert.strictEqual(r1.itens[0].subiu, 8);
  assert.deepStrictEqual(r1.itens[0].outrasNotas.map((o) => o.nota), ['2']);
  const r2 = T.analisar(s1, s3, { hoje: '2026-10-10', notas: [{ nota: '2' }] });
  assert.strictEqual(r2.findings.length, 1); assert.strictEqual(r2.findings[0].tipo, 'qtd_maior'); assert.strictEqual(r2.findings[0].nota, '2');
  assert.strictEqual(r2.resumo.notas, 1);
  assert.strictEqual(r2.candidatos.length, 1); assert.strictEqual(r2.candidatos[0].produto, 'P7');
  const todas = T.analisar(s1, s3, { hoje: '2026-10-10' });
  assert.strictEqual(todas.resumo.notas, 2);
});
test('nota anterior ao período da movimentação não vira "parada"', () => {
  const s1 = [sd1('1', 'P1', 'L1', 8, '2026-01-10'), sd1('2', 'P2', 'L2', 3, '2026-10-01')];
  const s3 = [...transf('T', 'P9', 1, '2026-09-20', '59', 'L9', '01', 'L9'), ...transf('T2', 'P9', 1, '2026-10-20', '59', 'L9', '01', 'L9')];
  const r = T.analisar(s1, s3, { hoje: '2026-10-30' });
  assert.strictEqual(r.itens.find((i) => i.nota === '1').semCobertura, true);
  assert.strictEqual(r.itens.find((i) => i.nota === '1').aguardandoSubir, false);
  assert.strictEqual(r.itens.find((i) => i.nota === '2').aguardandoSubir, true);
  assert.strictEqual(r.cobertura.sd3De, '2026-09-20');
});
test('lerSD1 soma itens repetidos da mesma nota/produto/lote', () => {
  const aoa = [['Documento', 'Produto', 'Lote', 'Quantidade', 'DT Digitacao'], ['5', 'P', 'L', 2, '2026-10-01'], ['5', 'P', 'L', 3, '2026-10-01'], ['5', 'P', 'M', 1, '2026-10-01']];
  const d = T.detectarColunasSD1(aoa);
  const l = T.lerSD1(aoa, d.mapa, d.linhaCab);
  assert.strictEqual(l.length, 2); assert.strictEqual(l.find((x) => x.lote === 'L').qt, 5);
});
test('SD3 desatualizado: nota depois do último SD3 não vira "parada"', () => {
  const r = T.analisar([sd1('1', 'P1', 'L1', 3, '2026-10-20')], transf('T', 'P9', 1, '2026-10-21', '59', 'L9', '01', 'L9'), { hoje: '2026-10-30' });
  assert.strictEqual(r.itens[0].aguardandoSubir, false); assert.strictEqual(r.itens[0].depoisSD3, false);
  const r2 = T.analisar([sd1('1', 'P1', 'L1', 3, '2026-10-25')], transf('T', 'P9', 1, '2026-10-21', '59', 'L9', '01', 'L9'), { hoje: '2026-10-30' });
  assert.strictEqual(r2.itens[0].depoisSD3, true); assert.strictEqual(r2.itens[0].aguardandoSubir, false); assert.strictEqual(r2.cobertura.sd3Ate, '2026-10-21');
});
test('CFOP: devolução de venda, consignação, bonificação e origem', () => {
  assert.deepStrictEqual([T.infoCFOP('1201').grupo, T.infoCFOP('2201').rotulo], ['devolucao', 'Devolução de venda (produção própria) (interestadual)']);
  assert.strictEqual(T.infoCFOP('1918').grupo, 'consig'); assert.strictEqual(T.infoCFOP('1910').grupo, 'bonif'); assert.strictEqual(T.infoCFOP('1913').grupo, 'consig');
  assert.strictEqual(T.infoCFOP('9999').grupo, 'outras'); assert.strictEqual(T.infoCFOP('').rotulo, 'Sem CFOP');
});
test('lerSD1 lê Tipo Entrada e Cód. Fiscal do Protheus', () => {
  const aoa = [['Documento', 'Produto', 'Lote', 'Quantidade', 'DT Digitacao', 'Tipo Entrada', 'Cod. Fiscal'], ['5', 'P', 'L', 2, '2026-10-01', 22, 1201]];
  const d = T.detectarColunasSD1(aoa); const l = T.lerSD1(aoa, d.mapa, d.linhaCab);
  assert.deepStrictEqual([l[0].tipo, l[0].cfop], ['22', '1201']);
});
