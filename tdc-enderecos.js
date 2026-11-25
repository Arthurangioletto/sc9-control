/* Endereço do armazém 01 (ZZ2) de cada produto/lote das Entradas TDC. Funções puras: o servidor lê as bases já salvas
 * (ZZ2 da Análise de gaveta e a base da Transferência) e monta os índices; aqui só se indexa e consulta. */
'use strict';

const texto = (v) => String(v == null ? '' : v).trim().toUpperCase();
// mesmo critério do TDC: código só de dígitos perde os zeros à esquerda
const chaveProduto = (v) => { const s = texto(v); return /^\d+$/.test(s) ? s.replace(/^0+(?=\d)/, '') : s; };
const arm1 = (v) => { const s = texto(v); return /^\d+$/.test(s) ? String(Number(s)) === '1' : false; };

function novoIndice(fonte) { return { fonte, produtos: new Map() }; }
function guardar(ind, produto, lote, endereco) {
  const p = chaveProduto(produto), e = texto(endereco);
  if (!p || !e) return;
  let r = ind.produtos.get(p);
  if (!r) { r = { todos: new Set(), porLote: new Map() }; ind.produtos.set(p, r); }
  r.todos.add(e);
  const l = texto(lote);
  if (l) { if (!r.porLote.has(l)) r.porLote.set(l, new Set()); r.porLote.get(l).add(e); }
}

// ZZ2 da Análise de gaveta: linhas [filial, armazém, endereço, produto, lote, armário]
function indexarZz2(rows) {
  const ind = novoIndice('zz2');
  for (const r of rows || []) if (Array.isArray(r) && arm1(r[1])) guardar(ind, r[3], r[4], r[2]);
  return ind;
}

// Base da Transferência: itens do 59 com enderecosDestino { '1': 'A-01 / B-02', ... } (endereço no armazém de destino, por lote)
function indexarTransferencia(items) {
  const ind = novoIndice('transferencia');
  for (const r of items || []) {
    const e = r && r.enderecosDestino && typeof r.enderecosDestino === 'object' ? r.enderecosDestino['1'] : '';
    if (!e) continue;
    for (const parte of String(e).split(' / ')) guardar(ind, r.sku, r.lote || r.loteProduto, parte);
  }
  return ind;
}

// Para cada { produto, lote } devolve { chave: { e: 'A-01 / B-02', x: 1 se o endereço é do lote, f: fonte } } (só os que achou).
// Procura nos índices na ordem; prefere o endereço do lote e, sem ele, mostra os do produto (x = 0).
function consultar(indices, itens) {
  const saida = {};
  for (const it of itens || []) {
    const p = chaveProduto(it && it.produto), l = texto(it && it.lote);
    if (!p) continue;
    const chave = p + '|' + l;
    if (saida[chave]) continue;
    for (const ind of indices) {
      const r = ind && ind.produtos.get(p);
      if (!r) continue;
      const doLote = l && r.porLote.get(l);
      const lista = [...(doLote || r.todos)].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
      if (!lista.length) continue;
      saida[chave] = { e: lista.slice(0, 6).join(' / ') + (lista.length > 6 ? ' …' : ''), x: doLote ? 1 : 0, f: ind.fonte };
      break;
    }
  }
  return saida;
}

module.exports = { chaveProduto, indexarZz2, indexarTransferencia, consultar };
