'use strict';
const test = require('node:test');
const assert = require('node:assert');
const T = require('../entradas-tdc.js');
const Rp = require('../entradas-tdc-relatorio.js');

const sd1 = (nota, produto, lote, qt, dtDigit, usuario = 'tdc1') => ({ nota, serie: '1', fornecedor: '14239', produto, lote, qt, armazem: '59', dtDigit, emissao: dtDigit, hora: '', usuario, validade: '', tipo: '22', cfop: '1201' });
const mv = (o) => ({ estornado: false, usuario: 'est1', ...o });
const transf = (doc, produto, qt, dia, lo, ld) => [mv({ tp: 999, cf: 'RE4', doc, produto, qt, dia, armazem: '59', lote: lo }), mv({ tp: 499, cf: 'DE4', doc, produto, qt, dia, armazem: '01', lote: ld })];

function base() {
  const s1 = [sd1('100', 'P1', 'L1', 8, '2026-10-01'), sd1('101', 'P2', 'L2', 10, '2026-10-02'), sd1('102', 'P3', 'L3', 5, '2026-10-02')];
  const s3 = [mv({ tp: 5, cf: 'DE0', doc: 'M1', produto: 'P1', qt: 2, dia: '2026-10-03', armazem: '59', lote: 'L1' }), ...transf('T1', 'P1', 10, '2026-10-03', 'L1', 'L1'), ...transf('T2', 'P2', 10, '2026-10-03', 'L2', 'L2'), ...transf('T3', 'P3', 5, '2026-10-04', 'L3', 'L3')];
  const res = T.analisar(s1, s3, { hoje: '2026-10-10' });
  const rev = {}; rev[res.findings[0].id] = { status: 'confirmado', por: 'maria', em: '2026-10-05T15:00:00Z', obs: 'Contei 10 <b>caixas</b>, a nota dizia 8', fotos: ['a'.repeat(24)], fisicoQtd: 10 };
  const achados = T.aplicarRevisoes(res.findings, rev);
  return { res, achados };
}

test('montarRelatorio: só confirmados, período, KPIs e tempo', () => {
  const { res, achados } = base();
  const d = Rp.montarRelatorio(res, achados, { de: '2026-10-01', ate: '2026-10-31' });
  assert.strictEqual(d.erros.length, 1); assert.strictEqual(d.kpis.notasConferidas, 3); assert.strictEqual(d.kpis.notasComErro, 1);
  assert.strictEqual(d.kpis.pecas, 2); assert.strictEqual(d.kpis.comFoto, 1);
  assert.strictEqual(d.porTipo.qtd_maior.n, 1); assert.strictEqual(d.porDia.length, 1);
  assert.ok(d.kpis.diasLimpos != null);
  assert.strictEqual(Rp.montarRelatorio(res, achados, { de: '2026-11-01' }).erros.length, 0);
  const auto = Rp.montarRelatorio(res, achados, {});
  assert.strictEqual(auto.periodo.de, '2026-10-01'); assert.strictEqual(auto.periodo.ate, '2026-10-02'); assert.strictEqual(auto.periodo.definido, false);
});
test('gerarHTML: período, data/hora de geração, foto, justificativa e escape de HTML', () => {
  const { res, achados } = base();
  const d = Rp.montarRelatorio(res, achados, { de: '2026-10-01', ate: '2026-10-31' });
  const html = Rp.gerarHTML(d, { fotos: { ['a'.repeat(24)]: 'data:image/jpeg;base64,AAAA' }, geradoEm: new Date('2026-10-30T19:20:00Z'), geradoPor: 'Ana <script>', cobertura: { sd1Ate: '2026-10-30', sd3Ate: '2026-10-29' } });
  assert.match(html, /Período: 01\/10\/2026 a 31\/10\/2026/);
  assert.match(html, /30\/10\/2026 às 16:20/);
  assert.match(html, /<img src="data:image\/jpeg;base64,AAAA"/);
  assert.match(html, /Contei 10 &lt;b&gt;caixas&lt;\/b&gt;/); assert.doesNotMatch(html, /<b>caixas<\/b>/);
  assert.match(html, /Ana &lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Veio MAIS do que a nota/); assert.match(html, /<svg/);
  assert.match(html, /SD3 \(movimentação\) até 29\/10\/2026/);
  assert.match(html, /Forn\. 14239/);
});
test('gerarHTML: sem erros e sem foto não quebra', () => {
  const { res } = base();
  const d = Rp.montarRelatorio(res, [], {});
  const html = Rp.gerarHTML(d, {});
  assert.match(html, /Nenhum erro confirmado/);
  const man = T.fichaManualParaFinding('MANUAL|x', { tipo: 'item_fora_nota', produto: 'PX', lote: 'Z', qtdNota: 0, qtdFisica: 4, dtEntrada: '2026-10-02', status: 'confirmado', por: 'joao', protheus: 'Nada no SD1' });
  const h2 = Rp.gerarHTML(Rp.montarRelatorio(res, [man], {}), {});
  assert.match(h2, /Sem foto anexada/); assert.match(h2, /Item que NÃO estava na nota/); assert.match(h2, /Nada no SD1/);
});
test('súmula Excel traz coluna de fotos com links', () => {
  const { res, achados } = base();
  const s = T.linhasSumula(res, achados, { somenteConfirmados: true, baseUrl: 'https://x.com' });
  assert.strictEqual(s.detalhe[0][s.detalhe[0].length - 1], 'Fotos');
  assert.match(s.detalhe[1][s.detalhe[1].length - 1], /1 foto\(s\): https:\/\/x\.com\/api\/entradas-tdc\/fotos\?id=a+/);
});
test('erro reportado à mão que o Protheus já apontou conta uma vez, juntando as fotos', () => {
  const { res, achados } = base();
  const auto = achados.find((a) => a.status === 'confirmado');
  const man = T.fichaManualParaFinding('MANUAL|y', { tipo: auto.tipo, nota: auto.nota, serie: auto.serie, produto: auto.produto, lote: auto.lote, qtdNota: auto.qtdNota, qtdFisica: 10, dtEntrada: auto.dtEntrada, status: 'confirmado', por: 'joao', fotos: ['b'.repeat(24)], obs: 'outro texto' });
  const d = Rp.montarRelatorio(res, [...achados, man], {});
  assert.strictEqual(d.erros.length, 1); assert.strictEqual(d.erros[0].fotos.length, 2); assert.strictEqual(d.kpis.pecas, 2);
  assert.strictEqual(achados.find((a) => a.status === 'confirmado').fotos.length, 1); // não altera a entrada
});
