/* Geral lançado × feito: tudo o que foi lançado (liberado) no SC9 num período contra o que a gente fez (Enviado), em pedidos e em peças.
 * Usa a MESMA regra do Consolidado (Cambuci + filiais, sem Implacil; Enviado = está na Entrega no Cambuci / tem nota nas filiais),
 * então os números batem com o Excel que já é apresentado. Só leitura do último SC9 salvo; não grava nada. */
'use strict';
const Consolidado = require('./consolidado.js');

const MAX_DIAS = 400;
const arred = (n, c) => { const f = Math.pow(10, c == null ? 1 : c); return Math.round(n * f) / f; };
const razao = (a, b) => (b > 0 ? a / b : null);
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const mapa = (v) => (Array.isArray(v) ? new Map(v) : v instanceof Map ? v : null);

function dadosDoSnapshot(snap) {
  const s = snap && typeof snap === 'object' ? snap : {};
  return { items: Array.isArray(s.items) ? s.items : [], entregaCounts: mapa(s.entregaCounts), sc5PorPedido: mapa(s.sc5PorPedido), itemNames: mapa(s.itemNames) };
}
const diaDe = (it) => { const d = new Date(it && it.dt); return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10); };

// Primeiro e último dia de liberação do que está carregado.
function intervaloDaBase(dados) {
  let de = '', ate = '';
  for (const it of dados.items) {
    if (!it || !Consolidado.ARMAZENS.includes(it.armazem)) continue;
    const d = diaDe(it); if (!d) continue;
    if (!de || d < de) de = d; if (!ate || d > ate) ate = d;
  }
  return { de, ate };
}

const soma = (l, f) => l.reduce((s, x) => s + (Number(f(x)) || 0), 0);
function resumo(pedidos) {
  const env = pedidos.filter((p) => p.status === 'Enviado'), atr = pedidos.filter((p) => p.status === 'Atrasado'), pen = pedidos.filter((p) => p.status === 'Pendente');
  const pecas = soma(pedidos, (p) => p.qt), pecasEnviadas = soma(env, (p) => p.qt);
  return {
    pedidos: pedidos.length, pecas: Math.round(pecas), enviados: env.length, pecasEnviadas: Math.round(pecasEnviadas),
    atrasados: atr.length, pecasAtrasadas: Math.round(soma(atr, (p) => p.qt)), pendentes: pen.length, pecasPendentes: Math.round(soma(pen, (p) => p.qt)),
    pctPedidos: razao(env.length, pedidos.length) == null ? null : arred(razao(env.length, pedidos.length) * 100, 1),
    pctPecas: razao(pecasEnviadas, pecas) == null ? null : arred(razao(pecasEnviadas, pecas) * 100, 1)
  };
}


// ---------- picos: o volume costuma variar muito (semana de 2.000 peças e semana de 30). Média "normal" = sem os picos. ----------
const ordenar = (v) => v.slice().sort((a, b) => a - b);
function quantil(ord, q) { if (!ord.length) return null; const pos = (ord.length - 1) * q, b = Math.floor(pos), r = pos - b; return ord[b + 1] !== undefined ? ord[b] + r * (ord[b + 1] - ord[b]) : ord[b]; }
const mediaDe = (v) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null);
// Pico = acima de Q3 + 1,5 × (Q3 − Q1) (regra de Tukey). Com poucos pontos (menos de 5) não dá para separar pico: usa 1,5 × a mediana.
function limitePico(valores) {
  const v = ordenar(valores.filter((x) => x > 0));
  if (v.length < 2) return null;
  const q1 = quantil(v, 0.25), q3 = quantil(v, 0.75), med = quantil(v, 0.5);
  return v.length >= 5 ? q3 + 1.5 * (q3 - q1) : med * 1.5;
}
const segundaDe = (dia) => { const d = new Date(dia + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const somaDia = (dia, n) => { const d = new Date(dia + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nz = (x) => (x == null ? null : arred(x, 1));

function analisarPicos(dias, de, ate) {
  // semanas (segunda a domingo) com o que foi lançado e feito; a primeira e a última podem estar cortadas pelo período
  const mapaSem = new Map();
  for (const d of dias) { const s = segundaDe(d.dia); if (!mapaSem.has(s)) mapaSem.set(s, []); mapaSem.get(s).push(d); }
  const semanas = [...mapaSem.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([seg, lista]) => {
    const tot = (k) => lista.reduce((s, d) => s + d[k], 0);
    const base = { pedidos: tot('pedidos'), pecas: tot('pecas'), enviados: tot('enviados'), pecasEnviadas: tot('pecasEnviadas'), atrasados: tot('atrasados'), pecasAtrasadas: tot('pecasAtrasadas'), pendentes: tot('pendentes'), pecasPendentes: tot('pecasPendentes') };
    base.pctPedidos = razao(base.enviados, base.pedidos) == null ? null : arred(razao(base.enviados, base.pedidos) * 100, 1);
    base.pctPecas = razao(base.pecasEnviadas, base.pecas) == null ? null : arred(razao(base.pecasEnviadas, base.pecas) * 100, 1);
    const fim = somaDia(seg, 6);
    return Object.assign({ semana: seg, de: seg < de ? de : seg, ate: fim > ate ? ate : fim, parcial: seg < de || fim > ate, diasComPedidos: lista.length }, base);
  });
  const completas = semanas.filter((s) => !s.parcial);
  const baseSem = completas.length >= 4 ? completas : semanas;
  const limSemana = limitePico(baseSem.map((s) => s.pecas)), limDia = limitePico(dias.map((d) => d.pecas));
  for (const s of semanas) s.pico = limSemana != null && s.pecas > limSemana;
  for (const d of dias) d.pico = limDia != null && d.pecas > limDia;
  const diasNormais = dias.filter((d) => !d.pico), semNormais = baseSem.filter((s) => !s.pico), semPico = semanas.filter((s) => s.pico);
  const pct = (a, b) => (b > 0 ? arred(a / b * 100, 1) : null);
  const soma2 = (l, k) => l.reduce((s, x) => s + x[k], 0);
  const grupo = (l) => ({ semanas: l.length, pedidos: soma2(l, 'pedidos'), pecas: soma2(l, 'pecas'), enviados: soma2(l, 'enviados'), pecasEnviadas: soma2(l, 'pecasEnviadas'), pctPedidos: pct(soma2(l, 'enviados'), soma2(l, 'pedidos')), pctPecas: pct(soma2(l, 'pecasEnviadas'), soma2(l, 'pecas')) });
  return {
    semanas,
    picos: {
      limiteDiaPecas: limDia == null ? null : Math.round(limDia), limiteSemanaPecas: limSemana == null ? null : Math.round(limSemana),
      diasPico: dias.filter((d) => d.pico).length, semanasPico: semPico.length,
      semanasNormais: grupo(semNormais), semanasDePico: grupo(semPico)
    },
    normal: {
      // média por dia e por semana SEM os picos, e a mediana (o valor do meio: não é puxada por pico nenhum)
      porDia: diasNormais.length ? { dias: diasNormais.length, pedidos: nz(mediaDe(diasNormais.map((d) => d.pedidos))), pecas: Math.round(mediaDe(diasNormais.map((d) => d.pecas))), enviados: nz(mediaDe(diasNormais.map((d) => d.enviados))), pecasEnviadas: Math.round(mediaDe(diasNormais.map((d) => d.pecasEnviadas))) } : null,
      medianaDia: dias.length ? { pedidos: nz(quantil(ordenar(dias.map((d) => d.pedidos)), 0.5)), pecas: Math.round(quantil(ordenar(dias.map((d) => d.pecas)), 0.5)), enviados: nz(quantil(ordenar(dias.map((d) => d.enviados)), 0.5)), pecasEnviadas: Math.round(quantil(ordenar(dias.map((d) => d.pecasEnviadas)), 0.5)) } : null,
      porSemana: semNormais.length ? { semanas: semNormais.length, pedidos: Math.round(mediaDe(semNormais.map((s) => s.pedidos))), pecas: Math.round(mediaDe(semNormais.map((s) => s.pecas))), enviados: Math.round(mediaDe(semNormais.map((s) => s.enviados))), pecasEnviadas: Math.round(mediaDe(semNormais.map((s) => s.pecasEnviadas))) } : null
    }
  };
}

// opcoes: { de, ate, arm, tr } (AAAA-MM-DD, armazém, transportadora); sem de/ate = tudo o que está carregado.
function montarGeral(snap, opcoes) {
  const o = opcoes || {};
  const dados = dadosDoSnapshot(snap);
  const base = intervaloDaBase(dados);
  const vazio = { base, de: '', ate: '', total: resumo([]), dias: [], armazens: [], mediaPorDia: null, semBase: !base.de };
  if (!base.de) return vazio;
  let de = DIA.test(o.de || '') ? o.de : base.de, ate = DIA.test(o.ate || '') ? o.ate : base.ate;
  if (de < base.de) de = base.de;
  if (ate > base.ate) ate = base.ate;
  if (de > ate) return Object.assign({}, vazio, { de, ate, base });
  const d0 = new Date(de + 'T00:00:00Z'), d1 = new Date(ate + 'T00:00:00Z');
  if ((d1 - d0) / 864e5 > MAX_DIAS) { const x = new Date(d1); x.setUTCDate(x.getUTCDate() - MAX_DIAS); de = x.toISOString().slice(0, 10); }
  const { pedidos } = Consolidado.montar(dados, de, ate);
  const filtrados = pedidos.filter((p) => (!o.arm || p.armazem === o.arm) && (!o.tr || p.transportadora === o.tr));
  const porDia = new Map();
  for (const p of filtrados) { if (!porDia.has(p.dayKey)) porDia.set(p.dayKey, []); porDia.get(p.dayKey).push(p); }
  const dias = [...porDia.keys()].sort().map((dia) => Object.assign({ dia }, resumo(porDia.get(dia))));
  const total = resumo(filtrados);
  const armazens = Consolidado.ARMAZENS.map((a) => Object.assign({ armazem: a }, resumo(filtrados.filter((p) => p.armazem === a)))).filter((x) => x.pedidos > 0);
  const transportadoras = [...new Set(pedidos.map((p) => p.transportadora))].sort();
  const analise = analisarPicos(dias, de, ate);
  return {
    base, de, ate, total, dias, armazens, transportadoras, semBase: false, semanas: analise.semanas, picos: analise.picos, normal: analise.normal,
    mediaPorDia: dias.length ? { diasComPedidos: dias.length, pedidos: arred(total.pedidos / dias.length, 1), pecas: arred(total.pecas / dias.length, 0), enviados: arred(total.enviados / dias.length, 1), pecasEnviadas: arred(total.pecasEnviadas / dias.length, 0) } : null
  };
}

module.exports = { analisarPicos, limitePico, montarGeral, intervaloDaBase, dadosDoSnapshot, resumo };
