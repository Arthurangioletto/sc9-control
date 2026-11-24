/* Rastreio do pedido (como o rastreio dos Correios) para a página das vendedoras.
 * Função pura: recebe a base salva do SC9 (snapshot), o número do pedido, onde ele aparece na Saída p/ Expedição e as ocorrências da
 * expedição, e devolve SÓ o que a vendedora pode ver (lista de campos permitidos): etapas com data/hora, atraso e detalhes básicos.
 * Não devolve valor da nota, nome de separador/conferente, itens ou lotes. */
(function (root) {
  'use strict';

  const OC = () => root.SC9Ocorrencias || require('./ocorrencias.js');
  const FUSO = 'America/Sao_Paulo';
  const LIMITE_ATRASO_DIAS = 5;

  // Número do pedido: só dígitos, sem zeros à esquerda (4 a 10 dígitos), igual ao do servidor.
  function normalizarPedido(x) {
    const d = String(x == null ? '' : x).replace(/\.0+$/, '').replace(/\D/g, '').replace(/^0+/, '');
    return d.length >= 4 && d.length <= 10 ? d : '';
  }
  const numeroDaNota = (x) => { const d = String(x == null ? '' : x).trim().replace(/\.0+$/, '').replace(/\D/g, '').replace(/^0+/, ''); return d.length >= 3 && d.length <= 12 ? d : ''; };

  const mapa = (v) => (!v ? new Map() : v instanceof Map ? v : Array.isArray(v) ? new Map(v) : new Map(Object.entries(v)));
  const iso = (v) => {
    if (!v) return '';
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  };
  const diaSP = (v) => { const s = iso(v); return s ? new Date(s).toLocaleDateString('sv-SE', { timeZone: FUSO }) : ''; };
  const diasEntre = (de, ate) => Math.round((Date.UTC(+ate.slice(0, 4), +ate.slice(5, 7) - 1, +ate.slice(8, 10)) - Date.UTC(+de.slice(0, 4), +de.slice(5, 7) - 1, +de.slice(8, 10))) / 864e5);
  const texto = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 80);
  const menorIso = (lista) => lista.filter(Boolean).sort()[0] || '';
  const maiorIso = (lista) => lista.filter(Boolean).sort().slice(-1)[0] || '';

  /* O pedido pode ter linhas em mais de um armazém: junta tudo numa visão só. */
  function juntarLinhas(linhas) {
    const todas = (campo) => linhas.map((o) => iso(o[campo]));
    const separado = (o) => Boolean(iso(o.pickEnd) || (texto(o.separador) && texto(o.separador) !== '0'));
    const conferido = (o) => Boolean(iso(o.confEnd) || (texto(o.conferente) && texto(o.conferente) !== '0'));
    const armazens = [...new Set(linhas.map((o) => texto(o.armazem, 20)).filter(Boolean))];
    const nfs = [...new Set(linhas.map((o) => numeroDaNota(o.nf)).filter(Boolean))];
    return {
      armazens, nfs,
      nome: texto((linhas.find((o) => o.nome) || {}).nome, 80),
      liberadoEm: menorIso(linhas.map((o) => iso(o.dtLiberacaoHora) || iso(o.dt))),
      pickStart: menorIso(todas('pickStart')), pickEnd: linhas.every((o) => iso(o.pickEnd)) ? maiorIso(todas('pickEnd')) : '',
      confStart: menorIso(todas('confStart')), confEnd: linhas.every((o) => iso(o.confEnd)) ? maiorIso(todas('confEnd')) : '',
      separado: linhas.every(separado), conferido: linhas.every(conferido),
      pecas: Math.round(linhas.reduce((s, o) => s + (Number(o.qt) || 0), 0) * 100) / 100,
      linhasDoPedido: linhas.reduce((s, o) => s + (Number(o.itens) || 0), 0),
      atrasado: linhas.some((o) => o.status === 'Atrasado'),
      soCambuci: linhas.every((o) => texto(o.armazem, 20) === 'Cambuci'),
      codTransp: (linhas.find((o) => o.transportadora != null && o.transportadora !== '') || {}).transportadora
    };
  }

  // Ocorrência mais importante do pedido (aberta mais antiga; senão a resolvida mais recente), só com o que a vendedora precisa.
  function ocorrenciaDoPedido(ocorrencias, pedido, nfs, info, saidaIso, agora) {
    const O = OC();
    const lista = (ocorrencias || []).filter((l) => (l.nf && nfs.includes(numeroDaNota(l.nf))) || (l.pedido && normalizarPedido(l.pedido) === pedido));
    if (!lista.length) return null;
    const todas = lista.map((oc) => ({ oc, av: O.avaliar(oc, info, saidaIso || '', agora) }));
    const abertas = todas.filter((x) => !x.av.resolvida).sort((a, b) => b.av.dias - a.av.dias);
    const resolvidas = todas.filter((x) => x.av.resolvida).sort((a, b) => String(b.oc.dataOcorrencia).localeCompare(String(a.oc.dataOcorrencia)));
    const x = abertas[0] || resolvidas[0];
    return { status: x.av.status, resolvida: x.av.resolvida, dias: x.av.dias, desde: x.oc.dataOcorrencia, detalhes: texto(x.oc.detalhes, 300), solucao: texto(x.oc.solucao, 300), dataSolucao: x.oc.dataSolucao || '', total: lista.length };
  }

  /* Monta o rastreio. snapshot = base salva do SC9; opcoes = { saidaIso, ocorrencias, agora, nomeTransportadora }.
   * Devolve { achado:false, atualizadoEm } quando o pedido não está na base. */
  function montarRastreio(snapshot, pedidoDigitado, opcoes) {
    const opc = opcoes || {};
    const agora = opc.agora instanceof Date ? opc.agora : new Date();
    const pedido = normalizarPedido(pedidoDigitado);
    const atualizadoEm = snapshot ? iso(snapshot.savedAt) : '';
    if (!pedido || !snapshot) return { achado: false, pedido: pedido || '', atualizadoEm };
    const linhas = (snapshot.orders || []).filter((o) => o && normalizarPedido(o.pedido) === pedido);
    if (!linhas.length) return { achado: false, pedido, atualizadoEm };

    const v = juntarLinhas(linhas);
    const entrega = mapa(snapshot.entregaInfo), sc5 = mapa(snapshot.sc5PorPedido), faturamento = mapa(snapshot.faturamento);
    const bruto = String((linhas[0] || {}).pedido || '').trim();
    const e = entrega.get(bruto) || entrega.get(bruto.replace(/^0+/, '')) || entrega.get(pedido);
    const despachadoEm = e ? iso(e.data) : '';
    const codigo = sc5.has(bruto) ? sc5.get(bruto) : sc5.has(pedido) ? sc5.get(pedido) : v.codTransp;
    const transportadora = opc.nomeTransportadora ? texto(opc.nomeTransportadora(codigo), 40) : texto(codigo, 40);
    const nf = v.nfs[0] || '';
    const nfBruta = nf ? String(linhas.find((o) => numeroDaNota(o.nf) === nf).nf).trim().replace(/\.0+$/, '') : '';
    const emissao = nf ? iso(faturamento.get(nfBruta) || faturamento.get(nf)) : '';
    const saidaIso = iso(opc.saidaIso);

    // evidências de cada etapa: feita? quando?
    const ev = {
      liberado: { feita: true, quando: v.liberadoEm },
      sep: { feita: v.separado, quando: v.pickEnd, inicio: v.pickStart },
      conf: { feita: v.conferido, quando: v.confEnd, inicio: v.confStart },
      fat: { feita: Boolean(nf), quando: emissao },
      saida: { feita: Boolean(saidaIso), quando: saidaIso },
      desp: { feita: Boolean(despachadoEm), quando: despachadoEm, soData: true }
    };
    // a nota pode sair depois de o pedido sair do estoque (falta só a nota): nesse caso a Saída vem antes
    const ordem = ev.saida.feita && !ev.fat.feita ? ['liberado', 'sep', 'conf', 'saida', 'fat', 'desp'] : ['liberado', 'sep', 'conf', 'fat', 'saida', 'desp'];
    const TITULO = { liberado: 'Pedido liberado', sep: 'Separação', conf: 'Conferência', fat: 'Faturado (nota fiscal)', saida: 'Saída para expedição', desp: 'Despachado para a transportadora' };
    let ultimaFeita = -1;
    ordem.forEach((c, i) => { if (ev[c].feita) ultimaFeita = i; });
    const etapas = ordem.map((c, i) => {
      const x = ev[c];
      const estado = i < ultimaFeita || x.feita ? 'feita' : i === ultimaFeita + 1 ? 'atual' : 'pendente';
      const item = { cod: c, titulo: TITULO[c], estado, quando: estado === 'feita' ? (x.quando || '') : '', soData: Boolean(x.soData), semHorario: estado === 'feita' && !x.quando, nota: '' };
      if (estado === 'feita' && !x.quando) item.nota = 'Horário não registrado';
      if (estado === 'atual') {
        if (c === 'sep') { item.titulo = x.inicio ? 'Em separação' : 'Aguardando separação'; item.quando = x.inicio || ''; item.nota = x.inicio ? 'Iniciada' : ''; }
        if (c === 'conf') { item.titulo = x.inicio ? 'Em conferência' : 'Aguardando conferência'; item.quando = x.inicio || ''; item.nota = x.inicio ? 'Iniciada' : ''; }
        if (c === 'fat') item.titulo = 'Aguardando nota fiscal';
        if (c === 'saida') item.titulo = 'Aguardando saída para expedição';
        if (c === 'desp') item.titulo = v.soCambuci ? 'Aguardando despacho' : 'Aguardando despacho (' + v.armazens.join(', ') + ')';
      }
      if (c === 'desp' && estado !== 'feita' && !v.soCambuci) item.nota = 'O despacho dos armazéns de fora de Cambuci não é registrado aqui: confirme com a expedição.';
      return item;
    });

    // desde quando está na etapa atual (horário da última etapa concluída com horário)
    const feitasComHora = etapas.filter((s) => s.estado === 'feita' && s.quando && !s.soData).map((s) => s.quando);
    const paradoDesde = despachadoEm ? '' : maiorIso(feitasComHora) || v.liberadoEm;

    const hoje = diaSP(agora), lib = diaSP(v.liberadoEm);
    const dias = lib ? Math.max(0, diasEntre(lib, hoje)) : null;
    const atual = etapas.find((s) => s.estado === 'atual');
    const atrasado = !despachadoEm && (v.atrasado || (dias != null && dias >= LIMITE_ATRASO_DIAS));
    let resumo;
    if (despachadoEm) resumo = { nivel: 'concluido', texto: 'Despachado em ' + diaSP(despachadoEm).split('-').reverse().slice(0, 2).join('/') + '.' };
    else if (atrasado) resumo = { nivel: 'atraso', texto: 'Atrasado' + (dias != null ? ' há ' + dias + (dias === 1 ? ' dia' : ' dias') : '') + (atual ? '. Agora: ' + atual.titulo.toLowerCase() + '.' : '.') };
    else resumo = { nivel: 'andamento', texto: atual ? 'Agora: ' + atual.titulo.toLowerCase() + '.' : 'Em andamento.' };

    const info = { pedido, liberadoEm: v.liberadoEm ? diaSP(v.liberadoEm) : '', despachadoEm: despachadoEm ? diaSP(despachadoEm) : '' };
    return {
      achado: true, pedido, atualizadoEm,
      resumo: Object.assign(resumo, { atrasado, dias }),
      etapas, paradoDesde,
      detalhes: {
        cliente: v.nome, armazem: v.armazens.join(', '), transportadora, pecas: v.pecas, linhas: v.linhasDoPedido, nf: v.nfs.join(', '),
        liberadoEm: v.liberadoEm, despachadoEm, saidaEm: saidaIso, diasDesdeLiberacao: dias
      },
      ocorrencia: ocorrenciaDoPedido(opc.ocorrencias, pedido, v.nfs, info, saidaIso, agora)
    };
  }

  const api = { normalizarPedido, montarRastreio, LIMITE_ATRASO_DIAS };
  root.SC9Rastreio = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
