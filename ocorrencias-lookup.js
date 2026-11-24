/* Procura, no último SC9 salvo no servidor (snapshot), o pedido de cada nota fiscal das ocorrências: cliente, armazém, valor, data de liberação,
 * transportadora e se já foi despachado (planilha de Entrega). Função pura: recebe o snapshot já carregado. */
'use strict';

const numeroDaNota = (x) => {
  const d = String(x == null ? '' : x).trim().replace(/\.0+$/, '').replace(/\D/g, '').replace(/^0+/, '');
  return d.length >= 3 && d.length <= 12 ? d : '';
};
const dia = (v) => { if (!v) return ''; const s = typeof v === 'string' ? v : v instanceof Date ? v.toISOString() : ''; return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ''; };
const mapa = (v) => {
  if (!v) return new Map();
  if (v instanceof Map) return v;
  if (Array.isArray(v)) return new Map(v);
  return new Map(Object.entries(v));
};

const numeroDoPedido = numeroDaNota;

// nfs: lista de números de nota (já normalizados). Devolve { nota: info } só das que foram achadas.
function procurarNotas(snapshot, nfs, nomeTransportadora) {
  const saida = {};
  const procuradas = new Set((nfs || []).map(numeroDaNota).filter(Boolean));
  if (!snapshot || !procuradas.size) return saida;
  percorrer(snapshot, nomeTransportadora, (o, nf) => Boolean(nf && procuradas.has(nf) && !saida[nf]), (o, nf, info) => { saida[nf] = info; });
  return saida;
}

// pedidos: lista de números de pedido. Devolve { pedido: info } (com a nota, se já tiver) só dos que foram achados.
function procurarPedidos(snapshot, pedidos, nomeTransportadora) {
  const saida = {};
  const procurados = new Set((pedidos || []).map(numeroDoPedido).filter(Boolean));
  if (!snapshot || !procurados.size) return saida;
  percorrer(snapshot, nomeTransportadora, (o) => { const k = numeroDoPedido(o && o.pedido); return Boolean(k && procurados.has(k) && !saida[k]); }, (o, nf, info) => { saida[numeroDoPedido(o.pedido)] = info; });
  return saida;
}

function percorrer(snapshot, nomeTransportadora, interessa, aoAchar) {
  const entrega = mapa(snapshot.entregaInfo), sc5 = mapa(snapshot.sc5PorPedido), valores = mapa(snapshot.valores);
  const chaveValor = (nf) => { const v = valores.get(nf); return v || valores.get(nf.replace(/^0+/, '')); };
  for (const o of snapshot.orders || []) {
    const nf = numeroDaNota(o && o.nf);
    if (!interessa(o, nf)) continue;
    const pedido = String(o.pedido == null ? '' : o.pedido).trim();
    const e = entrega.get(pedido) || entrega.get(pedido.replace(/^0+/, ''));
    const codigo = sc5.has(pedido) ? sc5.get(pedido) : o.transportadora;
    const val = chaveValor(String(o.nf == null ? '' : o.nf).trim().replace(/\.0+$/, '')) || chaveValor(nf);
    const valor = val ? Number(val.fatura) || Number(val.mercad) || 0 : 0;
    aoAchar(o, nf, {
      nf, pedido, armazem: String(o.armazem || ''), nome: String(o.nome || '').trim().slice(0, 80), cliente: String(o.cliente == null ? '' : o.cliente).trim().slice(0, 20),
      liberadoEm: dia(o.dt), pecas: Number(o.qt) || 0, valor: valor > 0 ? Math.round(valor * 100) / 100 : 0,
      transportadora: nomeTransportadora ? nomeTransportadora(codigo) : String(codigo == null ? '' : codigo),
      despachadoEm: e ? dia(e.data) : ''
    });
  }
}

module.exports = { numeroDaNota, numeroDoPedido, procurarNotas, procurarPedidos };
