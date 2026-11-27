/* Lista de armazéns que a vendedora pode pedir em uma transferência, por filial. Mantida pela logística (aba "Armazéns" do painel), guardada em
 * armazens-vendedoras.json. Cada item: { filial, codigo, rotulo, origem, destino, vendavel, nota }.
 *  - origem / destino: a vendedora pode escolher esse armazém como origem / destino de uma transferência (o servidor RECUSA o que estiver fora).
 *  - vendavel: o saldo entra no "Total em todas as filiais" da busca de produtos; os que não são vendáveis aparecem à parte, como "saldo separado".
 * A lista inicial (PADRAO) foi CONFIRMADA pelo Arthur em 27/11/2026 (PADRAO_CONFIRMADO). Continua editável pela equipe na aba "Armazéns"; o significado de 30, 20, 25 e do sufixo T ainda não está documentado.
 * Puro: sem disco e sem rede. */
'use strict';
const S = require('./solicitacoes-store.js');

const MAX_ITENS = 100;
const MAX_HISTORICO = 50;
const texto = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const item = (filial, codigo, rotulo, origem, destino, vendavel, nota) => ({ filial, codigo, rotulo, origem, destino, vendavel, nota: nota || '' });

// Padrão inicial CONSERVADOR, confirmado em 27/11/2026. Cambuci: 01 e 02. Tamboré: 01. 59 (TDC) e 26 (Retem) existem mas não são estoque de venda e não se pedem.
// BH, CE, DF e RJ: o armazém da própria filial (no índice de saldo o app guarda o armazém "com a sigla da filial" como "01" daquela filial).
const PADRAO = [
  item('Cambuci', '01', 'Estoque principal', true, true, true),
  item('Cambuci', '02', 'Controle', true, true, true),
  item('Cambuci', '59', 'TDC (entrada de NF)', false, false, false, 'Saldo separado: não é estoque de venda.'),
  item('Cambuci', '26', 'Retem', false, false, false, 'Saldo separado: não é estoque de venda.'),
  item('Tambore', '01', 'Estoque principal', true, true, true),
  item('BH', '01', 'Armazém da filial', true, true, true),
  item('CE', '01', 'Armazém da filial', true, true, true),
  item('DF', '01', 'Armazém da filial', true, true, true),
  item('RJ', '01', 'Armazém da filial', true, true, true)
];

const PADRAO_CONFIRMADO = true; // a tela da equipe só mostra o aviso "lista provisória" quando for false
const chave = (filial, codigo) => filial + '|' + codigo;
const bool = (v) => v === true || v === 'true' || v === 1;

// Limpa a lista (do arquivo ou do que a equipe enviou). estrito = devolve { erro } no primeiro problema; senão só descarta o que não presta.
function normalizar(bruto, estrito) {
  const origem = Array.isArray(bruto) ? bruto : bruto && Array.isArray(bruto.armazens) ? bruto.armazens : null;
  if (!origem) return estrito ? { erro: 'Envie a lista de armazéns.' } : { lista: null };
  if (estrito && origem.length > MAX_ITENS) return { erro: 'A lista aceita no máximo ' + MAX_ITENS + ' armazéns.' };
  const lista = [], vistos = new Set();
  for (let i = 0; i < Math.min(origem.length, MAX_ITENS); i++) {
    const b = origem[i] && typeof origem[i] === 'object' && !Array.isArray(origem[i]) ? origem[i] : {};
    const filial = S.filialDe(b.filial), codigo = S.armazemDe(b.codigo != null ? b.codigo : b.armazem);
    if (!filial || !codigo) { if (estrito) return { erro: 'Linha ' + (i + 1) + ': escolha a filial da lista e informe o código do armazém (1 a 6 letras ou números).' }; continue; }
    const k = chave(filial, codigo);
    if (vistos.has(k)) { if (estrito) return { erro: 'Linha ' + (i + 1) + ': o armazém ' + codigo + ' de ' + (S.FILIAIS_ROTULO[filial] || filial) + ' está repetido.' }; continue; }
    vistos.add(k);
    const vendavel = bool(b.vendavel);
    lista.push({ filial, codigo, rotulo: texto(b.rotulo, 40), origem: bool(b.origem), destino: bool(b.destino), vendavel, nota: texto(b.nota, 120) });
  }
  if (estrito) {
    if (!lista.some((x) => x.origem)) return { erro: 'Deixe pelo menos um armazém liberado como origem.' };
    if (!lista.some((x) => x.destino)) return { erro: 'Deixe pelo menos um armazém liberado como destino.' };
  }
  return { lista };
}
// O que vale agora: o arquivo da logística, ou o padrão provisório se ainda não existir (ou estiver quebrado).
function efetiva(arquivo) {
  const n = arquivo ? normalizar(arquivo, false).lista : null;
  return n && n.length ? { lista: n, padrao: arquivo.provisoria === true, atualizadoEm: typeof arquivo.atualizadoEm === 'string' ? texto(arquivo.atualizadoEm, 30) : '', atualizadoPor: texto(arquivo.atualizadoPor, 60) }
    : { lista: PADRAO.map((x) => Object.assign({}, x)), padrao: true, atualizadoEm: '', atualizadoPor: '' };
}

const acha = (lista, filial, armazem) => { const f = S.filialDe(filial), a = S.armazemDe(armazem); return f && a ? lista.find((x) => x.filial === f && x.codigo === a) || null : null; };
// Vendável? Quem não está na lista não conta como vendável (conservador: só entra no total o que a logística marcou).
const vendavel = (lista, filial, armazem) => { const x = acha(lista, filial, armazem); return Boolean(x && x.vendavel); };
// Mensagem em português se o armazém não pode ser usado nesse papel ('origem' | 'destino'); '' se pode.
function erroDoArmazem(lista, filial, armazem, papel) {
  const f = S.filialDe(filial), a = S.armazemDe(armazem), nomeF = (f && S.FILIAIS_ROTULO[f]) || String(filial || '');
  const x = acha(lista, f, a);
  if (!x) return 'O armazém ' + (a || String(armazem || '?')) + ' não existe na lista de armazéns de ' + nomeF + '. Escolha um armazém da lista (não digite outro código).';
  if (!x[papel]) return 'O armazém ' + x.codigo + ' de ' + nomeF + ' não está liberado como ' + papel + ' de transferência pela logística. Escolha um armazém da lista.';
  return '';
}

// Locais (filial|armazém) que realmente têm saldo no índice de produtos (solicitacoes-produtos.js). Guarda o resultado no próprio índice.
function locaisComSaldo(indice) {
  if (!indice || !indice.saldos) return new Set();
  if (indice.__locais) return indice.__locais;
  const set = new Set();
  for (const porLote of indice.saldos.values()) for (const l of porLote.values()) if (l.saldo > 0) set.add(chave(l.filial, l.armazem));
  indice.__locais = set;
  return set;
}
// O que a vendedora vê: por filial, só os armazéns que ela pode pedir (origem ou destino), cruzados com o saldo que existe de verdade.
function visaoVendedora(lista, indice) {
  const com = locaisComSaldo(indice), saidas = [];
  for (const info of S.FILIAIS_INFO) {
    const armazens = lista.filter((x) => x.filial === info.chave && (x.origem || x.destino)).map((x) => ({ codigo: x.codigo, rotulo: x.rotulo, origem: x.origem, destino: x.destino, comSaldo: com.has(chave(x.filial, x.codigo)), nota: x.nota }));
    if (armazens.length) saidas.push({ filial: info.chave, nome: info.nome, codigo: info.codigo, armazens });
  }
  return saidas;
}
// Visão da equipe: a lista inteira + o que existe no saldo e ainda não foi classificado.
function visaoEquipe(efetivaLista, indice) {
  const com = locaisComSaldo(indice), conhecidos = new Set(efetivaLista.lista.map((x) => chave(x.filial, x.codigo)));
  const naoClassificados = [...com].filter((k) => !conhecidos.has(k)).sort().map((k) => { const [filial, codigo] = k.split('|'); return { filial, codigo }; });
  return { armazens: efetivaLista.lista.map((x) => Object.assign({}, x, { comSaldo: com.has(chave(x.filial, x.codigo)) })), padrao: efetivaLista.padrao, provisoria: efetivaLista.padrao && !PADRAO_CONFIRMADO, naoClassificados, atualizadoEm: efetivaLista.atualizadoEm, atualizadoPor: efetivaLista.atualizadoPor };
}
// Histórico de quem mudou a lista (só cresce; guarda os últimos MAX_HISTORICO): [{ em, por, resumo }].
const limparHistorico = (bruto) => (Array.isArray(bruto) ? bruto : []).slice(-MAX_HISTORICO).map((h) => ({ em: texto(h && h.em, 30), por: texto(h && h.por, 60), resumo: texto(h && h.resumo, 400) }));
// Resumo curto do que mudou (para o histórico).
function resumoMudanca(antes, depois) {
  const a = new Map(antes.map((x) => [chave(x.filial, x.codigo), x])), b = new Map(depois.map((x) => [chave(x.filial, x.codigo), x])), partes = [];
  const nome = (x) => (S.FILIAIS_ROTULO[x.filial] || x.filial) + ' ' + x.codigo;
  for (const [k, x] of b) { const y = a.get(k); if (!y) partes.push('+' + nome(x)); else if (['origem', 'destino', 'vendavel', 'rotulo', 'nota'].some((c) => x[c] !== y[c])) partes.push('~' + nome(x)); }
  for (const [k, y] of a) if (!b.has(k)) partes.push('-' + nome(y));
  return (partes.join(', ') || 'sem mudança').slice(0, 400);
}

module.exports = { PADRAO, MAX_ITENS, MAX_HISTORICO, normalizar, efetiva, acha, vendavel, erroDoArmazem, locaisComSaldo, visaoVendedora, visaoEquipe, resumoMudanca, limparHistorico, chave };
