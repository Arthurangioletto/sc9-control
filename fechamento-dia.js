/* Fechamento do dia da expedição, por transportadora. Função pura: recebe as linhas do Recebimento na Expedição de um dia
 * (cada uma: { pedido, recebidoEm, info: { cliente, transportadora, nf }, volumes, naoSaiHoje: { motivo }, saiuEntrega: { transportadora, dataEntrega } })
 * e devolve, para cada transportadora: quanto foi recebido, volumes, confirmados na planilha de Entrega, "não sai hoje" (com o motivo),
 * o que ficou sem confirmação e as linhas em que a transportadora da Entrega difere da do SC5. Sem acesso a disco. */
'use strict';

const texto = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 80);
// compara nomes de transportadora sem acento, caixa nem pontuação ("Retira 02" = "RETIRA 02", "TCS" = "TCS TRANSPORTES")
const chave = (v) => texto(v, 60).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const mesmaTransportadora = (a, b) => { const x = chave(a), y = chave(b); return !x || !y || x === y || x.includes(y) || y.includes(x); };
const volumesDe = (e) => (Number.isFinite(Number(e && e.volumes)) && e.volumes !== null && e.volumes !== '' ? Number(e.volumes) : null);

function montarFechamento(entradas, opcoes) {
  const opc = opcoes || {};
  const grupos = new Map();
  const grupo = (nome) => {
    const n = texto(nome, 40) || 'Sem transportadora';
    if (!grupos.has(n)) grupos.set(n, { nome: n, recebidos: 0, volumes: 0, semVolume: 0, confirmados: 0, naoSai: 0, semConfirmacao: 0, naoSaiLista: [], semConfirmacaoLista: [], divergentes: [] });
    return grupos.get(n);
  };
  for (const e of Array.isArray(entradas) ? entradas : []) {
    if (!e || !e.pedido) continue;
    const info = e.info || {}, g = grupo(info.transportadora);
    const base = { pedido: texto(e.pedido, 12), cliente: texto(info.cliente, 60), recebidoEm: e.recebidoEm || '' };
    g.recebidos++;
    const v = volumesDe(e);
    if (v === null) g.semVolume++; else g.volumes += v;
    if (e.saiuEntrega) {
      g.confirmados++;
      const deEntrega = e.saiuEntrega.transportadora;
      if (!mesmaTransportadora(info.transportadora, deEntrega)) g.divergentes.push(Object.assign({}, base, { sc5: texto(info.transportadora, 40), entrega: texto(deEntrega, 40) }));
    } else if (e.naoSaiHoje) {
      g.naoSai++; g.naoSaiLista.push(Object.assign({}, base, { motivo: texto(e.naoSaiHoje.motivo, 80) || 'sem motivo informado' }));
    } else {
      g.semConfirmacao++; g.semConfirmacaoLista.push(Object.assign({}, base, { volumes: v }));
    }
  }
  const lista = [...grupos.values()].sort((a, b) => (b.semConfirmacao - a.semConfirmacao) || (b.recebidos - a.recebidos) || a.nome.localeCompare(b.nome, 'pt-BR'));
  for (const g of lista) { g.semConfirmacaoLista.sort((a, b) => String(a.recebidoEm).localeCompare(String(b.recebidoEm))); g.volumes = Math.round(g.volumes * 100) / 100; }
  const soma = (k) => lista.reduce((s, g) => s + g[k], 0);
  return {
    dia: opc.dia || '',
    totais: { recebidos: soma('recebidos'), volumes: Math.round(soma('volumes') * 100) / 100, semVolume: soma('semVolume'), confirmados: soma('confirmados'), naoSai: soma('naoSai'), semConfirmacao: soma('semConfirmacao'), divergencias: lista.reduce((s, g) => s + g.divergentes.length, 0) },
    transportadoras: lista
  };
}

// Texto curto para colar no WhatsApp/e-mail da diretoria.
function resumoEmTexto(f, dataBr) {
  const t = f.totais;
  const linhas = ['Fechamento da expedição' + (dataBr ? ' · ' + dataBr : '') + ': ' + t.recebidos + ' pedidos recebidos, ' + t.confirmados + ' confirmados na Entrega, ' + t.naoSai + ' que não saem hoje, ' + t.semConfirmacao + ' sem confirmação.'];
  for (const g of f.transportadoras) linhas.push('- ' + g.nome + ': ' + g.recebidos + ' recebidos, ' + g.volumes + ' volumes' + (g.semVolume ? ' (' + g.semVolume + ' sem volume informado)' : '') + ', ' + g.confirmados + ' confirmados' + (g.naoSai ? ', ' + g.naoSai + ' não saem hoje' : '') + (g.semConfirmacao ? ', ' + g.semConfirmacao + ' sem confirmação' : '') + '.');
  if (t.divergencias) linhas.push('Atenção: ' + t.divergencias + ' pedido(s) com transportadora diferente entre o SC5 e a Entrega.');
  return linhas.join('\n');
}

module.exports = { montarFechamento, resumoEmTexto, mesmaTransportadora };
