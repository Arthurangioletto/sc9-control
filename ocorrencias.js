/* Aba "Ocorrências da expedição": a expedição registra, por nota fiscal, o que impede o pedido de sair (endereço, cadastro...),
 * quem cuida, a solução e a data. O SC9 procura a nota na base carregada, mostra cliente, pedido e situação e calcula o status.
 *
 * Esta parte (sem tela) é testada em Node: leitura de datas digitadas, status, ação sugerida, resumo e colagem da planilha.
 */
(function (root) {
  'use strict';

  const FUSO = 'America/Sao_Paulo';
  const semAcento = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  function hojeSP(agora) {
    const d = agora instanceof Date ? agora : new Date(agora || Date.now());
    const p = {};
    for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)) p[x.type] = x.value;
    return p.year + '-' + p.month + '-' + p.day;
  }
  const diasEntre = (de, ate) => Math.round((Date.UTC(+ate.slice(0, 4), +ate.slice(5, 7) - 1, +ate.slice(8, 10)) - Date.UTC(+de.slice(0, 4), +de.slice(5, 7) - 1, +de.slice(8, 10))) / 864e5);
  const realData = (a, m, d) => { const x = new Date(Date.UTC(a, m - 1, d)); return x.getUTCFullYear() === a && x.getUTCMonth() === m - 1 && x.getUTCDate() === d; };
  const iso = (a, m, d) => String(a).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');

  // Data digitada → 'AAAA-MM-DD' ('' se não entendi). Aceita 16/11/2026, 16/11/26, 16/11, 11/16/2026 (mês primeiro, só quando o 2º número passa de 12),
  // 16-11-2026, 16.11.2026 e 2026-11-16. Sem ano: usa o ano de hoje (ou o anterior, se cair muito no futuro).
  function lerData(entrada, agora) {
    if (entrada instanceof Date) return Number.isNaN(entrada.getTime()) ? '' : iso(entrada.getFullYear(), entrada.getMonth() + 1, entrada.getDate());
    const t = String(entrada == null ? '' : entrada).trim();
    if (!t) return '';
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
    if (m) return realData(+m[1], +m[2], +m[3]) ? iso(+m[1], +m[2], +m[3]) : '';
    m = /^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2}|\d{4}))?$/.exec(t);
    if (!m) return '';
    let a = +m[1], b = +m[2];
    let dia = a, mes = b;
    if (b > 12 && a <= 12) { dia = b; mes = a; }   // 11/16/2026
    const hoje = hojeSP(agora);
    let ano;
    if (m[3]) ano = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    else {
      ano = +hoje.slice(0, 4);
      if (realData(ano, mes, dia) && diasEntre(hoje, iso(ano, mes, dia)) > 60) ano -= 1;
    }
    return realData(ano, mes, dia) && ano >= 2000 && ano <= 2100 ? iso(ano, mes, dia) : '';
  }
  const mostrarData = (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '');
  const curta = (d) => (d ? d.slice(8, 10) + '/' + d.slice(5, 7) : '');

  // Número da nota (mesma regra do servidor).
  function numeroDaNota(x) {
    const d = String(x == null ? '' : x).trim().replace(/\.0+$/, '').replace(/\D/g, '').replace(/^0+/, '');
    return d.length >= 3 && d.length <= 12 ? d : '';
  }

  const numeroDoPedido = numeroDaNota;

  // Colagem direta da planilha da expedição (Excel copia com TAB). Colunas: Nota fiscal, Data da ocorrência, Detalhes, Responsável, Solução, Data da solução (e, opcional, Pedido).
  // Pula a linha de títulos. Devolve { linhas: [{nf, dataOcorrencia, detalhes, responsavel, solucao, dataSolucao}], invalidas: [{linha, motivo}] }.
  function lerColado(texto, agora) {
    const linhas = [], invalidas = [];
    const brutas = String(texto || '').replace(/\r/g, '').split('\n');
    brutas.forEach((l, i) => {
      if (!l.trim()) return;
      const c = l.split('\t');
      if (c.length < 2) { invalidas.push({ linha: i + 1, motivo: 'Não achei as colunas (cole direto do Excel, com as colunas separadas).' }); return; }
      if (!numeroDaNota(c[0]) && /nota|nf|n[ºo°]/i.test(semAcento(c[0])) ) return;   // linha de títulos
      const nf = numeroDaNota(c[0]);
      const pedido = numeroDoPedido(c[6]);   // 7ª coluna (opcional): pedido, para ocorrência de pedido que ainda não tem nota
      const dataOcorrencia = lerData(c[1], agora);
      if (!nf && !pedido) { invalidas.push({ linha: i + 1, motivo: 'Nota fiscal inválida: "' + String(c[0]).trim() + '" (e sem pedido na 7ª coluna).' }); return; }
      if (!dataOcorrencia) { invalidas.push({ linha: i + 1, motivo: 'Data da ocorrência não entendida: "' + String(c[1] || '').trim() + '".' }); return; }
      const dataSolucao = c[5] && c[5].trim() ? lerData(c[5], agora) : '';
      if (c[5] && c[5].trim() && !dataSolucao) { invalidas.push({ linha: i + 1, motivo: 'Data da solução não entendida: "' + c[5].trim() + '".' }); return; }
      linhas.push({ nf, pedido, dataOcorrencia, detalhes: (c[2] || '').trim(), responsavel: (c[3] || '').trim(), solucao: (c[4] || '').trim(), dataSolucao });
    });
    return { linhas, invalidas };
  }

  /* ---------------------------------------------------------------- situação ---------------------------------------------------------------- */
  const LIMITE_DIAS = 3;   // ocorrência aberta há 3 dias ou mais = atrasada para resolver
  const NIVEL_PESO = { urgente: 0, atencao: 1, andamento: 2, ok: 3, concluido: 4 };

  // Situação do pedido, a partir do que o servidor achou pela nota (info = { pedido, nome, liberadoEm, despachadoEm, ... } ou undefined)
  // e do primeiro registro na Saída p/ Expedição (saidaIso, ou '').
  function situacaoDoPedido(info, saidaIso, hoje) {
    if (!info) return { codigo: 'nao-achado', texto: 'Nota ou pedido não encontrado na base do SC9' };
    if (info.despachadoEm) return { codigo: 'despachado', texto: 'Pedido despachado' + (info.despachadoEm ? ' em ' + curta(String(info.despachadoEm).slice(0, 10)) : '') };
    if (saidaIso) return { codigo: 'na-expedicao', texto: 'Já está na Saída p/ Expedição, falta despachar' };
    const lib = info.liberadoEm ? String(info.liberadoEm).slice(0, 10) : '';
    const dias = lib && hoje ? Math.max(0, diasEntre(lib, hoje)) : null;
    return { codigo: 'pendente', texto: 'Pedido ainda não saiu' + (dias != null ? ' (liberado há ' + dias + (dias === 1 ? ' dia' : ' dias') + ')' : ''), diasLiberado: dias };
  }

  // Avalia uma ocorrência. info = pedido achado pela nota (ou undefined); saidaIso = Saída p/ Expedição (ou '').
  function avaliar(oc, info, saidaIso, agora) {
    const hoje = hojeSP(agora);
    const resolvida = !!oc.dataSolucao || /^resolvid/.test(semAcento(oc.solucao));
    const emAndamento = !resolvida && !!String(oc.solucao || '').trim();
    const fim = oc.dataSolucao && oc.dataSolucao >= oc.dataOcorrencia ? oc.dataSolucao : hoje;
    const dias = Math.max(0, diasEntre(oc.dataOcorrencia, fim));
    const ped = situacaoDoPedido(info, saidaIso, hoje);
    const resp = String(oc.responsavel || '').trim();
    const despachado = ped.codigo === 'despachado';
    let situacao, status, nivel, acao;
    if (resolvida) {
      situacao = 'resolvida';
      if (despachado) { status = 'Resolvida e despachada'; nivel = 'concluido'; acao = 'Nada a fazer.'; }
      else if (ped.codigo === 'nao-achado') { status = 'Resolvida'; nivel = 'ok'; acao = 'Solução registrada. Confira se a nota está certa para acompanhar o pedido.'; }
      else if (ped.codigo === 'na-expedicao') { status = 'Resolvida · falta despachar'; nivel = 'atencao'; acao = 'Resolvida e o pedido já está na expedição: despachar.'; }
      else { status = 'Resolvida · falta despachar'; nivel = 'atencao'; acao = 'Ocorrência resolvida: liberar o pedido para despacho.'; }
    } else if (despachado) {
      situacao = emAndamento ? 'andamento' : 'aberta';
      status = 'Pedido despachado · fechar a ocorrência'; nivel = 'atencao';
      acao = 'O pedido já foi despachado: coloque a solução e a data para fechar a ocorrência.';
    } else if (emAndamento) {
      situacao = 'andamento'; status = 'Em andamento'; nivel = dias >= LIMITE_DIAS ? 'urgente' : 'andamento';
      acao = 'Há retorno registrado. Confirme com ' + (resp || 'o responsável') + ' se resolveu e preencha a data da solução.';
    } else {
      situacao = 'aberta';
      const atrasada = dias >= LIMITE_DIAS;
      status = atrasada ? 'Aberta · atrasada' : 'Aberta';
      nivel = atrasada ? 'urgente' : 'atencao';
      acao = resp ? (atrasada ? 'Cobrar ' + resp + ': ' + dias + (dias === 1 ? ' dia' : ' dias') + ' sem solução.' : 'Acompanhar com ' + resp + '.') : 'Definir quem é o responsável por resolver.';
    }
    return { situacao, status, nivel, acao, dias, pedido: ped, resolvida, hoje };
  }

  function ordenar(lista) {
    return lista.slice().sort((a, b) => (NIVEL_PESO[a.av.nivel] - NIVEL_PESO[b.av.nivel]) || (b.av.dias - a.av.dias) || String(a.oc.nf).localeCompare(String(b.oc.nf)));
  }

  // Resumo para o topo da aba. lista = [{ oc, av }]
  function resumo(lista) {
    const abertas = lista.filter((x) => x.av.situacao === 'aberta').length;
    const andamento = lista.filter((x) => x.av.situacao === 'andamento').length;
    const resolvidas = lista.filter((x) => x.av.situacao === 'resolvida');
    const tempos = resolvidas.filter((x) => x.oc.dataSolucao).map((x) => x.av.dias);
    const naoResolvidas = lista.filter((x) => !x.av.resolvida);
    return {
      total: lista.length, abertas, andamento, resolvidas: resolvidas.length,
      atrasadas: lista.filter((x) => x.av.nivel === 'urgente').length,
      faltaDespachar: lista.filter((x) => x.av.status === 'Resolvida · falta despachar').length,
      fecharOcorrencia: lista.filter((x) => x.av.status === 'Pedido despachado · fechar a ocorrência').length,
      naoAchadas: lista.filter((x) => x.av.pedido.codigo === 'nao-achado').length,
      mediaDiasParaResolver: tempos.length ? Math.round((tempos.reduce((s, v) => s + v, 0) / tempos.length) * 10) / 10 : null,
      maisAntigaEmAberto: naoResolvidas.length ? Math.max(...naoResolvidas.map((x) => x.av.dias)) : null
    };
  }

  const api = { hojeSP, lerData, mostrarData, curta, numeroDaNota, numeroDoPedido, lerColado, situacaoDoPedido, avaliar, ordenar, resumo, LIMITE_DIAS };
  root.SC9Ocorrencias = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
