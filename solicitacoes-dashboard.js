/* Dashboard da Central de solicitações: junta as solicitações novas com os pedidos de prioridade e os avisos das vendedoras (só leitura).
 * Puro: recebe as listas já normalizadas e devolve os números; nada de disco nem de rede.
 * Contrato em README.md ("Central de solicitações"). Sem dados: zeros/null e listas vazias, nunca erro. */
'use strict';
const S = require('./solicitacoes-store.js');

const FUSO = 'America/Sao_Paulo';
const DIAS_PADRAO = 30, DIAS_MAX = 90;
const SLA_OUTRAS_MIN = 120; // prioridades e avisos não têm prazo próprio: ativos há mais de 2 h sem ninguém responsável contam como atrasados
const ATIVOS_PRIORIDADE = ['recebida', 'em_analise', 'aprovada', 'em_atendimento'];
const ATIVOS_AVISO = ['recebido', 'em_andamento'];
const ROTULO_AVISO = { endereco: 'Aviso: endereço', retirada: 'Aviso: retirada', transportadora: 'Aviso: transportadora', cancelar: 'Aviso: cancelar', produto: 'Aviso: produto', outro: 'Aviso: outro' };
const ROTULO_NIVEL = { normal: 'normal', media: 'média', alta: 'alta', urgente: 'urgente' };

const diaSP = (ms) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: FUSO });
const ms = (v) => { const n = Date.parse(v); return Number.isNaN(n) ? null : n; };
const media = (lista) => (lista.length ? Math.round(lista.reduce((a, b) => a + b, 0) / lista.length) : null);
const pct = (parte, todo) => (todo ? Math.round((parte / todo) * 100) : null);
const somaDias = (dia, n) => { const d = new Date(dia + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const emDia = (v, dias) => { const t = ms(v); return t != null && dias.has(diaSP(t)); };

function montarDashboard({ solicitacoes, prioridades, avisos, agora, dias } = {}) {
  const now = Number.isFinite(agora) ? agora : Date.now();
  const nDias = Math.min(DIAS_MAX, Math.max(1, Math.floor(Number(dias)) || DIAS_PADRAO));
  const ate = diaSP(now), de = somaDias(ate, -(nDias - 1));
  const lista = []; for (let i = 0; i < nDias; i++) lista.push(somaDias(de, i));
  const noPeriodo = new Set(lista);
  const sol = Array.isArray(solicitacoes) ? solicitacoes : [], pri = Array.isArray(prioridades) ? prioridades : [], avi = Array.isArray(avisos) ? avisos : [];

  const criadas = sol.filter((l) => emDia(l.criadoEm, noPeriodo));
  const concluidasPer = sol.filter((l) => l.status === 'concluida' && emDia(l.concluidaEm, noPeriodo));
  const negadasPer = sol.filter((l) => l.status === 'negada' && emDia(l.concluidaEm, noPeriodo));
  const abertas = sol.filter((l) => S.ATIVOS.includes(l.status));

  // no prazo: das solicitações com 1ª resposta (ou com o prazo já vencido sem resposta), quantas foram respondidas dentro do prazo do tipo
  const noPrazo = (grupo) => {
    let ok = 0, total = 0;
    for (const l of grupo) {
      const sla = S.slaDe(l, now), venceu = ms(sla.slaVenceEm);
      if (l.primeiraRespostaEm) { total++; if (ms(l.primeiraRespostaEm) <= venceu) ok++; }
      else if (venceu != null && now > venceu) total++;
    }
    return pct(ok, total);
  };
  const tempos = (grupo, campo) => grupo.filter((l) => l[campo]).map((l) => S.minutos(l.criadoEm, l[campo])).filter((x) => x != null);

  const porTipo = S.TIPOS_IDS.map((tipo) => {
    const g = criadas.filter((l) => l.tipo === tipo);
    return {
      tipo, rotulo: S.TIPOS[tipo].rotulo, total: g.length, abertas: g.filter((l) => S.ATIVOS.includes(l.status)).length, concluidas: g.filter((l) => l.status === 'concluida').length,
      negadas: g.filter((l) => l.status === 'negada').length, medResp: media(tempos(g, 'primeiraRespostaEm')), medResolucao: media(tempos(g.filter((l) => l.status === 'concluida'), 'concluidaEm')), pctNoPrazo: noPrazo(g)
    };
  });

  const porDiaMapa = new Map(lista.map((d) => [d, { dia: d, solicitacoes: 0, prioridades: 0, avisos: 0, concluidas: 0 }]));
  const soma = (v, campo) => { const t = ms(v); const x = t != null && porDiaMapa.get(diaSP(t)); if (x) x[campo]++; return Boolean(x); };
  let nPri = 0, nAvi = 0;
  for (const l of criadas) soma(l.criadoEm, 'solicitacoes');
  for (const l of pri) if (soma(l.criadoEm, 'prioridades')) nPri++;
  for (const l of avi) if (soma(l.criadoEm, 'avisos')) nAvi++;
  for (const l of concluidasPer) soma(l.concluidaEm, 'concluidas');

  const vend = new Map();
  for (const l of criadas) {
    const chave = l.pedidoPor.toLowerCase(), v = vend.get(chave) || { nome: l.pedidoPor, total: 0, abertas: 0, tipos: {} };
    v.total++; if (S.ATIVOS.includes(l.status)) v.abertas++; v.tipos[l.tipo] = (v.tipos[l.tipo] || 0) + 1;
    vend.set(chave, v);
  }
  const porVendedora = [...vend.values()].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome)).slice(0, 15).map((v) => {
    const tipoMais = Object.keys(v.tipos).sort((a, b) => v.tipos[b] - v.tipos[a] || S.TIPOS_IDS.indexOf(a) - S.TIPOS_IDS.indexOf(b))[0];
    return { nome: v.nome, total: v.total, abertas: v.abertas, tipoMaisComum: tipoMais, tipoMaisComumRotulo: S.TIPOS[tipoMais].rotulo };
  });

  const fil = new Map();
  for (const l of criadas) if (l.filial) fil.set(l.filial, (fil.get(l.filial) || 0) + 1);
  const porFilial = [...fil].map(([filial, total]) => ({ filial, total })).sort((a, b) => b.total - a.total || a.filial.localeCompare(b.filial));

  const canc = criadas.filter((l) => (l.tipo === 'cancelar_pedido' || l.tipo === 'segurar_pedido') && l.etapa && l.etapa !== 'nao_achado');
  const cancelamentos = { total: canc.length, aTempo: canc.filter((l) => l.aTempo).length, tarde: canc.filter((l) => !l.aTempo).length, pctATempo: pct(canc.filter((l) => l.aTempo).length, canc.length) };

  // transferências: rotas origem -> destino (filial + armazém) e produtos mais pedidos, com a descrição e o total de peças
  const rotas = new Map(), prods = new Map();
  const transf = criadas.filter((l) => l.tipo === 'transferencia_peca');
  let totalPecas = 0;
  for (const l of transf) {
    const d = l.dados || {}, o = d.origem || {}, t = d.destino || {}, itens = Array.isArray(d.itens) ? d.itens : [];
    const pecas = itens.reduce((a, it) => a + (Number(it.qt) || 0), 0);
    totalPecas += pecas;
    const chaveRota = [o.filial, o.armazem, t.filial, t.armazem].join('|');
    const r = rotas.get(chaveRota) || {
      origem: o.filial || '', origemArmazem: o.armazem || '', origemRotulo: S.rotuloLocal(o), destino: t.filial || '', destinoArmazem: t.armazem || '', destinoRotulo: S.rotuloLocal(t),
      tipoTransferencia: d.tipoTransferencia || (o.filial && o.filial === t.filial ? 'entre_armazens' : 'entre_filiais'), total: 0, pecas: 0
    };
    r.total++; r.pecas += pecas; rotas.set(chaveRota, r);
    for (const it of itens) {
      const chaveProd = String(it.produto).toLowerCase(), p = prods.get(chaveProd) || { produto: it.produto, descricao: '', pedidos: 0, pecas: 0 };
      p.pedidos++; p.pecas += Number(it.qt) || 0; if (!p.descricao && it.descricao) p.descricao = it.descricao; prods.set(chaveProd, p);
    }
  }
  const transferencias = {
    total: transf.length, totalPecas, totalProdutos: prods.size,
    rotas: [...rotas.values()].sort((a, b) => b.total - a.total || b.pecas - a.pecas).slice(0, 10),
    produtos: [...prods.values()].sort((a, b) => b.pecas - a.pecas || b.pedidos - a.pedidos || a.produto.localeCompare(b.produto)).slice(0, 10)
  };

  // fila: tudo o que está aberto, das três fontes, mais antigo primeiro
  const velha = (l) => { const t = ms(l.criadoEm); return t != null && now - t > SLA_OUTRAS_MIN * 60000; };
  const fila = []
    .concat(abertas.map((l) => ({ fonte: 'solicitacao', id: l.id, protocolo: l.protocolo, rotulo: S.TIPOS[l.tipo].rotulo, pedido: l.pedido, vendedora: l.pedidoPor, status: l.status, criadoEm: l.criadoEm, atrasada: S.slaDe(l, now).atrasada })))
    .concat(pri.filter((l) => ATIVOS_PRIORIDADE.includes(l.status)).map((l) => ({ fonte: 'prioridade', id: l.id, protocolo: l.protocolo, rotulo: 'Prioridade (' + (ROTULO_NIVEL[l.nivel] || l.nivel) + ')', pedido: l.pedido, vendedora: l.pedidoPor, status: l.status, criadoEm: l.criadoEm, atrasada: !l.responsavel && velha(l) })))
    .concat(avi.filter((l) => ATIVOS_AVISO.includes(l.status)).map((l) => ({ fonte: 'aviso', id: l.id, protocolo: l.protocolo, rotulo: ROTULO_AVISO[l.tipo] || 'Aviso', pedido: l.pedido, vendedora: l.pedidoPor, status: l.status, criadoEm: l.criadoEm, atrasada: !l.responsavel && velha(l) })))
    .sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm))).slice(0, 50);

  return {
    periodo: { de, ate, dias: nDias }, geradoEm: new Date(now).toISOString(),
    kpis: {
      abertas: abertas.length, atrasadasSla: abertas.filter((l) => S.slaDe(l, now).atrasada).length, criadasNoPeriodo: criadas.length, concluidasNoPeriodo: concluidasPer.length, negadas: negadasPer.length,
      tempoMedio1aRespostaMin: media(tempos(criadas, 'primeiraRespostaEm')), tempoMedioResolucaoMin: media(tempos(concluidasPer, 'concluidaEm')), pctNoPrazo: noPrazo(criadas)
    },
    porTipo, porDia: [...porDiaMapa.values()], porVendedora, porFilial, cancelamentos, transferencias,
    fontes: { solicitacoes: criadas.length, prioridades: nPri, avisos: nAvi }, fila
  };
}

module.exports = { montarDashboard, DIAS_PADRAO, DIAS_MAX, SLA_OUTRAS_MIN };
