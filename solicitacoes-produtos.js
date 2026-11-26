/* Busca de produto para a vendedora pedir transferência (GET /api/vendedoras/produtos).
 * Puro: monta um ÍNDICE EM MEMÓRIA a partir do catálogo do último snapshot do SC9 (itemNames) e do saldo por lote (saldo-lotes.json ou, se
 * este estiver vazio, a posição do SB8 de cadastro-sb8-atual.json) e responde às buscas sem tocar em disco nem em rede. O servidor só reconstrói
 * o índice quando o snapshot/saldo mudar (ver `chave`). Nunca expõe custo, valor, fornecedor nem dados de cliente. */
'use strict';
const S = require('./solicitacoes-store.js');

const MAX_RESULTADOS = 10, MAX_LOTES = 40, MIN_BUSCA = 2, MAX_BUSCA = 60;
const semAcento = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const semEspaco = (s) => semAcento(s).replace(/\s+/g, '');
const codigoDe = (v) => String(v == null ? '' : v).trim();
const numero = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const arredonda = (n) => Math.round(n * 1000) / 1000;

// Filial e armazém de uma linha de saldo. O SC9 não traz a filial no saldo por lote: sem filial, a linha é da Cambuci (o saldo do SC9 é o do armazém 01).
// Armazém com a sigla de uma filial (BH, CE, DF, RJ) quer dizer "estoque dessa filial" (padrão da posição do SB8).
function localDaLinha(filialBruta, armBruto) {
  const arm = S.armazemDe(armBruto);
  const porArm = S.FILIAIS.includes(arm) ? arm : '';
  let filial = S.filialDe(filialBruta);
  if (!filial) filial = porArm || 'Cambuci';
  else if (porArm && filial === 'Cambuci') filial = porArm;
  return { filial, armazem: porArm && filial === porArm ? '01' : (arm || '01') };
}

// itemNames: [[codigo, descricao]...]; saldoPorLote: [[lote, { itens:[{ arm, produto, saldo }] }]...]; posicao: { rows:[{ filial, armazem, produto, lote, saldo, dtValidade }] }.
function montarIndice({ itemNames, saldoPorLote, posicao } = {}) {
  const catalogo = new Map();
  for (const par of Array.isArray(itemNames) ? itemNames : []) {
    if (!Array.isArray(par)) continue;
    const codigo = codigoDe(par[0]); if (!codigo) continue;
    const descricao = String(par[1] == null ? '' : par[1]).replace(/\s+/g, ' ').trim().slice(0, 200);
    catalogo.set(codigo, { codigo, descricao, cod: codigo.toLowerCase(), codSemEspaco: semEspaco(codigo), norm: semAcento(descricao) });
  }
  const saldos = new Map(); // codigo -> Map(chave filial|armazem|lote -> { lote, saldo, filial, armazem, validade })
  const soma = (produto, lote, loc, saldo, validade) => {
    if (!produto || saldo == null) return;
    let m = saldos.get(produto); if (!m) { m = new Map(); saldos.set(produto, m); }
    const k = loc.filial + '|' + loc.armazem + '|' + lote, atual = m.get(k);
    if (atual) { atual.saldo += saldo; if (!atual.validade && validade) atual.validade = validade; }
    else m.set(k, { lote, saldo, filial: loc.filial, armazem: loc.armazem, validade: validade || '' });
  };
  let fonte = 'nenhuma';
  for (const par of Array.isArray(saldoPorLote) ? saldoPorLote : []) {
    if (!Array.isArray(par) || !par[1]) continue;
    const lote = codigoDe(par[0]);
    for (const it of Array.isArray(par[1].itens) ? par[1].itens : []) soma(codigoDe(it && it.produto), lote, localDaLinha('', it && it.arm), numero(it && it.saldo), '');
  }
  if (saldos.size) fonte = 'saldo-lotes';
  else if (posicao && Array.isArray(posicao.rows)) {
    for (const r of posicao.rows) soma(codigoDe(r && r.produto), codigoDe(r && r.lote), localDaLinha(r && r.filial, r && r.armazem), numero(r && r.saldo), r && r.dtValidade ? String(r.dtValidade).slice(0, 10) : '');
    if (saldos.size) fonte = 'posicao-sb8';
  }
  // produto que só existe no saldo (fora do catálogo) também pode ser buscado, sem descrição
  for (const codigo of saldos.keys()) if (!catalogo.has(codigo)) catalogo.set(codigo, { codigo, descricao: '', cod: codigo.toLowerCase(), codSemEspaco: semEspaco(codigo), norm: '' });
  return { catalogo, lista: [...catalogo.values()], saldos, fonte, construidoEm: Date.now() };
}

const casaLocal = (l, filtro) => (!filtro || !filtro.filial || l.filial === filtro.filial) && (!filtro || !filtro.armazem || l.armazem === filtro.armazem);
function saldoDo(indice, codigo, filtro) {
  const m = indice && indice.saldos.get(codigo);
  if (!m) return null;
  let total = 0; for (const l of m.values()) if (casaLocal(l, filtro)) total += l.saldo;
  return arredonda(total);
}

// Saldo na origem de uma transferência: do lote informado ou, sem lote, de todos os lotes do produto naquele filial+armazém.
// null = não sei (sem saldo carregado para o produto); 0 = o produto tem saldo carregado, mas nada nessa origem.
function consultarProduto(indice, codigo, { filial, armazem, lote } = {}) {
  if (!indice) return null;
  const c = indice.catalogo.get(codigoDe(codigo)) || indice.lista.find((x) => x.cod === codigoDe(codigo).toLowerCase());
  if (!c) return null;
  const m = indice.saldos.get(c.codigo);
  let saldoOrigem = null;
  if (m) {
    saldoOrigem = 0;
    const q = codigoDe(lote).toLowerCase();
    for (const l of m.values()) if (casaLocal(l, { filial, armazem }) && (!q || l.lote.toLowerCase() === q)) saldoOrigem += l.saldo;
    saldoOrigem = arredonda(saldoOrigem);
  }
  return { codigo: c.codigo, descricao: c.descricao, saldoOrigem };
}

function visaoProduto(indice, c, filtro) {
  const m = indice.saldos.get(c.codigo), saldoDisponivel = Boolean(m);
  if (!m) return { codigo: c.codigo, descricao: c.descricao, saldoTotal: null, saldoOrigem: null, saldos: [], lotes: [], saldoDisponivel: false };
  const porLocal = new Map();
  for (const l of m.values()) { const k = l.filial + '|' + l.armazem; porLocal.set(k, (porLocal.get(k) || { filial: l.filial, armazem: l.armazem, saldo: 0 })); porLocal.get(k).saldo += l.saldo; }
  const saldos = [...porLocal.values()].map((x) => ({ filial: x.filial, armazem: x.armazem, saldo: arredonda(x.saldo) })).sort((a, b) => b.saldo - a.saldo || a.filial.localeCompare(b.filial) || a.armazem.localeCompare(b.armazem));
  // com filial/armazém na busca, os lotes mostrados são os daquela origem (é o que dá para transferir)
  const lotes = [...m.values()].filter((l) => l.saldo > 0 && casaLocal(l, filtro)).sort((a, b) => (a.validade || '9999').localeCompare(b.validade || '9999') || b.saldo - a.saldo || a.lote.localeCompare(b.lote))
    .slice(0, MAX_LOTES).map((l) => { const o = { lote: l.lote, saldo: arredonda(l.saldo), filial: l.filial, armazem: l.armazem }; if (l.validade) o.validade = l.validade; return o; });
  return { codigo: c.codigo, descricao: c.descricao, saldoTotal: saldoDo(indice, c.codigo, null), saldoOrigem: filtro && filtro.filial ? saldoDo(indice, c.codigo, filtro) : null, saldos, lotes, saldoDisponivel };
}

// Busca por código (igual ou começando com o digitado) e por trecho da descrição (sem acento, sem diferença de caixa, todas as palavras).
// Ordem: código igual, código começando com, descrição começando com a 1ª palavra, demais; empate pelo código.
function buscar(indice, consulta, { filial, armazem } = {}) {
  if (!indice) return [];
  const q = semAcento(String(consulta == null ? '' : consulta).replace(/[\u0000-\u001f\u007f]/g, ' ')).replace(/\s+/g, ' ').slice(0, MAX_BUSCA).trim();
  if (q.length < MIN_BUSCA) return [];
  const f = S.filialDe(filial), a = S.armazemDe(armazem), filtro = f ? { filial: f, armazem: a || '' } : (a ? { filial: '', armazem: a } : null);
  const palavras = q.split(' ').filter(Boolean), colado = q.replace(/\s+/g, '');
  const achados = [];
  for (const c of indice.lista) {
    let rank = -1;
    if (c.codSemEspaco === colado) rank = 0;
    else if (c.codSemEspaco.startsWith(colado)) rank = 1;
    else if (c.norm && palavras.every((p) => c.norm.includes(p))) rank = c.norm.startsWith(palavras[0]) ? 2 : 3;
    if (rank >= 0) achados.push({ c, rank });
  }
  achados.sort((x, y) => x.rank - y.rank || (indice.saldos.has(y.c.codigo) - indice.saldos.has(x.c.codigo)) || x.c.codigo.localeCompare(y.c.codigo, 'pt-BR', { numeric: true }));
  return achados.slice(0, MAX_RESULTADOS).map((x) => visaoProduto(indice, x.c, filtro));
}

module.exports = { montarIndice, buscar, consultarProduto, saldoDo, localDaLinha, MAX_RESULTADOS, MAX_LOTES, MIN_BUSCA };
