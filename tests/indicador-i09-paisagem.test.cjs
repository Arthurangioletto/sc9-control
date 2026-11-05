'use strict';
// Abas do I 09 no Relatório Geral saem em paisagem: o .xlsx (zip) é reaberto e só as abas indicadas mudam.
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const M = require('../indicador-i09.js');

const crc = (b) => { let c = ~0 >>> 0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; } return (~c) >>> 0; };
function zipSimples(arq) { // monta um zip (deflate) só para o teste
  const partes = [], cds = []; let pos = 0;
  for (const [nome, txt] of Object.entries(arq)) {
    const dados = Buffer.from(txt), comp = zlib.deflateRawSync(dados), nm = Buffer.from(nome);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8); h.writeUInt32LE(crc(dados), 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(dados.length, 22); h.writeUInt16LE(nm.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc(dados), 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(dados.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(pos, 42);
    partes.push(h, nm, comp); cds.push(Buffer.concat([c, nm])); pos += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(cds), fim = Buffer.alloc(22); fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(cds.length, 8); fim.writeUInt16LE(cds.length, 10); fim.writeUInt32LE(cd.length, 12); fim.writeUInt32LE(pos, 16);
  return new Uint8Array(Buffer.concat([...partes, cd, fim]));
}
function lerArq(u8) { // lê o zip de volta (inflate) para conferir
  const b = Buffer.from(u8); let e = b.length - 22; while (b.readUInt32LE(e) !== 0x06054b50) e--;
  const n = b.readUInt16LE(e + 10); let p = b.readUInt32LE(e + 16); const out = {};
  for (let i = 0; i < n; i++) {
    const nl = b.readUInt16LE(p + 28), xl = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), off = b.readUInt32LE(p + 42), cs = b.readUInt32LE(p + 20), us = b.readUInt32LE(p + 24), cc = b.readUInt32LE(p + 16);
    const nome = b.subarray(p + 46, p + 46 + nl).toString(), lnl = b.readUInt16LE(off + 26), lxl = b.readUInt16LE(off + 28);
    const txt = zlib.inflateRawSync(b.subarray(off + 30 + lnl + lxl, off + 30 + lnl + lxl + cs));
    assert.strictEqual(txt.length, us, nome); assert.strictEqual(crc(txt), cc, 'crc ' + nome);
    out[nome] = txt.toString(); p += 46 + nl + xl + cl;
  }
  return out;
}
const SHEET = (extra = '') => '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + extra + '<dimension ref="A1"/><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
const base = () => zipSimples({
  '[Content_Types].xml': '<Types/>',
  'xl/workbook.xml': '<workbook xmlns:r="x"><sheets><sheet name="Outra" sheetId="1" r:id="rId1"/><sheet name="I09 Dashboard" sheetId="2" r:id="rId2"/><sheet name="I09 M&#xEA;s" sheetId="3" r:id="rId3"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="t" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="t" Target="/xl/worksheets/sheet3.xml"/></Relationships>',
  'xl/worksheets/sheet1.xml': SHEET(), 'xl/worksheets/sheet2.xml': SHEET(), 'xl/worksheets/sheet3.xml': SHEET('<sheetPr/>'),
});

test('paisagemXlsx: só as abas pedidas ficam em paisagem, ajustadas à largura', async () => {
  const out = lerArq(await M.paisagemXlsx(base(), ['I09 Dashboard']));
  assert.match(out['xl/worksheets/sheet2.xml'], /<sheetPr><pageSetUpPr fitToPage="1"\/><\/sheetPr><dimension/);
  assert.match(out['xl/worksheets/sheet2.xml'], /<pageMargins[^>]*\/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"\/><\/worksheet>/);
  assert.strictEqual(out['xl/worksheets/sheet1.xml'], SHEET(), 'a aba "Outra" não muda');
  assert.strictEqual(out['xl/worksheets/sheet3.xml'], SHEET('<sheetPr/>'), 'aba não pedida não muda');
  assert.strictEqual(out['xl/workbook.xml'].includes('I09 Dashboard'), true);
});
test('paisagemXlsx: resolve alvo com caminho absoluto, <sheetPr/> existente e nome com acento (entidade XML)', async () => {
  const out = lerArq(await M.paisagemXlsx(base(), ['I09 Mês']));
  assert.match(out['xl/worksheets/sheet3.xml'], /<sheetPr><pageSetUpPr fitToPage="1"\/><\/sheetPr>/);
  assert.match(out['xl/worksheets/sheet3.xml'], /orientation="landscape"/);
});
test('paisagemXlsx: repetir não duplica e o zip continua íntegro', async () => {
  const uma = await M.paisagemXlsx(base(), ['I09 Dashboard']);
  const duas = lerArq(await M.paisagemXlsx(uma, ['I09 Dashboard']));
  assert.strictEqual((duas['xl/worksheets/sheet2.xml'].match(/<pageSetup\b/g) || []).length, 1);
  assert.strictEqual((duas['xl/worksheets/sheet2.xml'].match(/<pageSetUpPr\b/g) || []).length, 1);
  assert.strictEqual(duas['[Content_Types].xml'], '<Types/>');
});

test('paisagemXlsx: sem pageMargins, entra antes de ignoredErrors/drawing (ordem do esquema que o Excel exige)', async () => {
  const sheet = '<?xml version="1.0"?><worksheet xmlns="x"><dimension ref="A1"/><sheetViews/><sheetData/><ignoredErrors><ignoredError sqref="A1"/></ignoredErrors><drawing r:id="rId1"/></worksheet>';
  const zip = zipSimples({
    'xl/workbook.xml': '<workbook xmlns:r="x"><sheets><sheet name="I09 Dashboard" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheet,
  });
  const x = lerArq(await M.paisagemXlsx(zip, ['I09 Dashboard']))['xl/worksheets/sheet1.xml'];
  const pos = (t) => x.indexOf(t);
  assert.ok(pos('<pageMargins') > pos('<sheetData/>'));
  assert.ok(pos('<pageMargins') < pos('<pageSetup'));
  assert.ok(pos('<pageSetup') < pos('<ignoredErrors'), 'pageSetup antes de ignoredErrors');
  assert.ok(pos('<ignoredErrors') < pos('<drawing'));
  assert.ok(pos('<sheetPr>') < pos('<dimension'));
});

test('paisagemXlsx: estilos — cria fonte/preenchimento/borda/xf, mantém o formato numérico e ajusta contagens, merge, altura e grade', async () => {
  const styles = '<?xml version="1.0"?><styleSheet xmlns="x"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts><fonts count="1"><font><sz val="11"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>';
  const sheet = '<?xml version="1.0"?><worksheet xmlns="x"><dimension ref="A1:B2"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>0.5</v></c></row></sheetData></worksheet>';
  const zip = zipSimples({
    'xl/workbook.xml': '<workbook xmlns:r="x"><sheets><sheet name="I09 Dashboard" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/styles.xml': styles, 'xl/worksheets/sheet1.xml': sheet,
  });
  const out = lerArq(await M.paisagemXlsx(zip, ['I09 Dashboard'], { estilos: { 'I09 Dashboard': { celulas: { A1: 'cab_a', B2: 'dest_om' }, alturas: { 2: 30 }, merges: ['A1:B1'], semGrade: true, corAba: '1F2D5A' } } }));
  const st = out['xl/styles.xml'], sh = out['xl/worksheets/sheet1.xml'];
  assert.match(st, /<fonts count="3">/); assert.match(st, /<fills count="4">/); assert.match(st, /<borders count="2">/); assert.match(st, /<cellXfs count="4">/);
  assert.match(sh, /<c r="A1" t="s" s="2">/);
  assert.match(sh, /<c r="B2" s="3">/);
  assert.match(st, /<xf numFmtId="164"[^>]*fontId="2"[^>]*fillId="3"[^>]*borderId="1"/, 'B2 mantém 0.0% e ganha o estilo');
  assert.match(sh, /<row r="2" ht="30" customHeight="1">/);
  assert.match(sh, /<\/sheetData><mergeCells count="1"><mergeCell ref="A1:B1"\/><\/mergeCells>/);
  assert.match(sh, /<sheetView showGridLines="0" workbookViewId="0"\/>/);
  assert.match(sh, /<sheetPr><tabColor rgb="FF1F2D5A"\/><pageSetUpPr fitToPage="1"\/><\/sheetPr>/);
  assert.ok(sh.indexOf('</mergeCells>') < sh.indexOf('<pageMargins'));
});
