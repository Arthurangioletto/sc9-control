/* Cálculos do painel executivo do Histórico de Atraso (puros, sem DOM: rodam no Node e no navegador).
 * Só LEEM o que a página já carregou (resultado de SC9HistoricoAtraso.preparar); não gravam nada e não mudam nenhum cálculo existente.
 * Definições adotadas (todas em um lugar só, para a diretoria ler sempre a mesma regra):
 *  - em atraso: o que está na foto do dia (Atrasado + Em processo do tipo faturamento), como no Excel e na página atual;
 *  - 5+ dias: dias de atraso >= 5 (mesma regra que a página já pinta de vermelho);
 *  - aguardando despacho: pedido da foto cuja próxima ação é "levar para a expedição" (já tem nota) ou "despachar" (já está na Saída p/ Expedição);
 *  - ocorrência aberta: ocorrência sem solução entre os pedidos da foto (sem histórico: o SC9 só guarda o estado atual das ocorrências);
 *  - valor em atraso: só pedidos já faturados (o valor vem da nota fiscal). */
(function (root) {
  'use strict';

  const H = () => root.SC9HistoricoAtraso || require('./historico-atraso.js');
  const CRITICO = 5;
  const ETAPAS = ['S', 'C', 'F', 'D'];
  const FAIXAS = [
    { id: 'f0', rotulo: 'até 2 dias', de: 0, ate: 2, nivel: 'neutro' },
    { id: 'f3', rotulo: '3 a 4 dias', de: 3, ate: 4, nivel: 'atencao' },
    { id: 'f5', rotulo: '5 a 7 dias', de: 5, ate: 7, nivel: 'ruim' },
    { id: 'f8', rotulo: '8 a 14 dias', de: 8, ate: 14, nivel: 'critico' },
    { id: 'f15', rotulo: '15 dias ou mais', de: 15, ate: Infinity, nivel: 'critico' }
  ];
  const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

  // ---------- datas ----------
  const ms = (dia) => Date.UTC(+dia.slice(0, 4), +dia.slice(5, 7) - 1, +dia.slice(8, 10));
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const somaDias = (dia, n) => iso(ms(dia) + n * 864e5);
  const diaDaSemana = (dia) => new Date(ms(dia)).getUTCDay();
  const diasEntre = (de, ate) => Math.round((ms(ate) - ms(de)) / 864e5);
  const intervalo = (de, ate) => { const l = []; for (let d = de; d <= ate; d = somaDias(d, 1)) l.push(d); return l; };
  function diasUteisEntre(de, ate) {
    let n = 0;
    for (let d = somaDias(de, 1); d <= ate; d = somaDias(d, 1)) { const w = diaDaSemana(d); if (w !== 0 && w !== 6) n++; }
    return n;
  }

  // ---------- cor por polaridade ----------
  // sobeEhBom: true para despachados/faturados/saíram/saldo; false para atrasos, 5+ dias, idade, ocorrências.
  // Melhorou = bom (verde). Piorou menos de 5% = atenção (amarelo). Piorou 5% ou mais = ruim (vermelho). Sem mudança = neutro (cinza).
  function tom(sobeEhBom, delta, ref) {
    if (delta == null || !Number.isFinite(delta) || delta === 0) return 'neutro';
    if (sobeEhBom ? delta > 0 : delta < 0) return 'bom';
    const rel = ref ? Math.abs(delta) / Math.abs(ref) : 1;
    if (rel < 0.01) return 'neutro';
    return rel < 0.05 ? 'atencao' : 'ruim';
  }
  const variacao = (atual, ref) => (atual == null || ref == null ? { delta: null, pct: null } : { delta: atual - ref, pct: ref ? (atual - ref) / Math.abs(ref) * 100 : null });

  // ---------- itens ----------
  const filtroVazio = () => ({ arm: '', transp: '' });
  const temFiltro = (g) => Boolean(g && (g.arm || g.transp));
  const selecionar = (itens, g) => (temFiltro(g) ? itens.filter((it) => (!g.arm || it[1] === g.arm) && (!g.transp || (it[7] || '') === g.transp)) : itens);
  const valorNota = (it) => Number((H().extra(it) || {}).v) || 0;

  function resumoItens(itens) {
    let e = 0, f = 0, ep = 0, fp = 0, cinco = 0, pecasCinco = 0, soma = 0, max = 0, valor = 0;
    for (const it of itens) {
      if (it[4] === 'F') { f++; fp += it[3]; } else { e++; ep += it[3]; }
      const d = Number(it[6]) || 0;
      soma += d; if (d > max) max = d;
      if (d >= CRITICO) { cinco++; pecasCinco += it[3]; }
      valor += valorNota(it);
    }
    const tot = e + f;
    return { tot, e, f, ep, fp, pecas: ep + fp, cinco, pecasCinco, idadeMedia: tot ? soma / tot : 0, maxDias: max, valor };
  }

  const fotoAnterior = (p, dia) => {
    let ant = null;
    for (const a of p.analises) { if (a.reg.dia < dia) ant = a; else break; }
    return ant;
  };

  function contarAguardando(p, itens, dia, agora) {
    let n = 0, pecas = 0;
    for (const it of itens) {
      const cod = H().avaliarPedido(p, it, dia, agora).acao.cod;
      if (cod === 'levar' || cod === 'despachar') { n++; pecas += it[3]; }
    }
    return { n, pecas };
  }
  function contarAbertas(p, itens, dia, agora) {
    let n = 0;
    for (const it of itens) { const v = H().avaliarPedido(p, it, dia, agora); if (v.ocor && !v.ocor.av.resolvida) n++; }
    return n;
  }

  // Despachados/faturados de UM armazém: só existe nos dias gravados com o detalhe por armazém (campo "por").
  // Devolve { atual, ref, refDia } ou null se o dia não tem o detalhe (aí o painel mostra o total da empresa e avisa).
  function porArmazem(mapa, dia, arm) {
    const doDia = mapa[dia] && mapa[dia].por && mapa[dia].por[arm];
    if (!doDia) return null;
    let refDia = null;
    for (const d of Object.keys(mapa).sort()) { if (d < dia && mapa[d].por && mapa[d].por[arm]) refDia = d; }
    return { atual: doDia, ref: refDia ? mapa[refDia].por[arm] : null, refDia };
  }

  // ---------- cartões do topo ----------
  // Cada cartão: valor, referência (dia anterior com foto), variação, % e tom. "filtro" abre os pedidos na lista; "alvo" rola até o bloco.
  function cartoes(p, dia, g, agora) {
    const a = p.porDia.get(dia);
    const sem = temFiltro(g);
    const itens = a ? selecionar(a.reg.itens, g) : [];
    const r = a ? resumoItens(itens) : null;
    const ant = a ? fotoAnterior(p, dia) : null;
    const itensAnt = ant ? selecionar(ant.reg.itens, g) : [];
    const ra = ant ? resumoItens(itensAnt) : null;
    let dp = H().despacho(p, dia);
    let semArm = sem;
    const dpArm = g && g.arm && !g.transp ? porArmazem(p.exp, dia, g.arm) : null;
    if (dpArm) { dp = { atual: dpArm.atual, ref: dpArm.ref, refDia: dpArm.refDia }; semArm = false; }
    const dias = Object.keys(p.fat).sort();
    const refFat = dias.filter((d) => d < dia).pop() || null;
    let ft = p.fat[dia] || null, ftRef = refFat ? p.fat[refFat] : null;
    let refFatDia = refFat;
    const ftArm = g && g.arm && !g.transp ? porArmazem(p.fat, dia, g.arm) : null;
    if (ftArm) { ft = ftArm.atual; ftRef = ftArm.ref; refFatDia = ftArm.refDia; }
    const refTxt = ant ? ant.reg.dia : null;
    const cartao = (id, titulo, valor, refValor, refDia, sobeEhBom, extra) => {
      const v = variacao(valor, refValor);
      return Object.assign({ id, titulo, valor, ref: refValor, refDia, delta: v.delta, pct: v.pct, tom: tom(sobeEhBom, v.delta, refValor), sobeEhBom, formato: 'n', filtro: null, alvo: '', semFiltroArmazem: false, nota: '' }, extra || {});
    };
    const lista = [];
    lista.push(cartao('atraso', 'Pedidos em atraso', r ? r.tot : null, ra ? ra.tot : null, refTxt, false, { filtro: {}, destaque: true, estoque: r ? r.e : null, faturamento: r ? r.f : null, base: a ? (g && g.arm && !g.transp ? ((a.reg.totalPorArmazem && a.reg.totalPorArmazem[g.arm]) || null) : (!sem ? a.resumo.total : null)) : null }));
    lista.push(cartao('cinco', 'Atrasados há 5 dias ou mais', r ? r.cinco : null, ra ? ra.cinco : null, refTxt, false, { filtro: { diasMin: CRITICO } }));
    lista.push(cartao('pecas', 'Peças em atraso', r ? r.pecas : null, ra ? ra.pecas : null, refTxt, false, { filtro: {} }));
    lista.push(cartao('estoque', 'Atraso de estoque', r ? r.e : null, ra ? ra.e : null, refTxt, false, { filtro: { tipo: 'E' } }));
    lista.push(cartao('faturamento', 'Atraso de faturamento', r ? r.f : null, ra ? ra.f : null, refTxt, false, { filtro: { tipo: 'F' } }));
    const ag = a ? contarAguardando(p, itens, dia, agora) : null;
    const agAnt = ant ? contarAguardando(p, itensAnt, ant.reg.dia, agora) : null;
    lista.push(cartao('aguardando', 'Aguardando despacho', ag ? ag.n : null, agAnt ? agAnt.n : null, refTxt, false, { filtro: { acao: 'levar,despachar' }, nota: 'já têm nota ou já estão na Saída p/ Expedição' }));
    lista.push(cartao('despachados', 'Despachados no dia', dp.atual ? dp.atual.pedidos : null, dp.ref ? dp.ref.pedidos : null, dp.refDia, true, { alvo: 'produtividade', semFiltroArmazem: semArm }));
    lista.push(cartao('pecas-despachadas', 'Peças despachadas no dia', dp.atual ? dp.atual.pecas : null, dp.ref ? dp.ref.pecas : null, dp.refDia, true, { alvo: 'produtividade', semFiltroArmazem: semArm }));
    lista.push(cartao('faturados', 'Pedidos faturados no dia', ft ? ft.pedidos : null, ftRef ? ftRef.pedidos : null, refFatDia, true, { alvo: 'produtividade', semFiltroArmazem: ftArm ? false : sem }));
    lista.push(cartao('valor', 'Valor em atraso (já faturado)', r ? r.valor : null, ra ? ra.valor : null, refTxt, false, { formato: 'brl', filtro: {}, nota: 'só pedidos com nota fiscal' }));
    const ab = a ? contarAbertas(p, itens, dia, agora) : null;
    lista.push(cartao('ocorrencias', 'Ocorrências abertas', ab, null, null, false, { filtro: { ocorr: 'aberta' }, nota: 'estado de agora (o SC9 não guarda histórico de ocorrências)' }));
    return { dia, refDia: refTxt, cartoes: lista, resumo: r };
  }

  // ---------- séries no tempo ----------
  // Uma entrada por dia do calendário (inclusive dias sem foto, que NÃO são zero).
  function serie(p, de, ate, g) {
    return intervalo(de, ate).map((dia) => {
      const a = p.porDia.get(dia);
      const r = a ? resumoItens(selecionar(a.reg.itens, g)) : null;
      const w = diaDaSemana(dia);
      return { dia, semana: SEMANA[w], fimDeSemana: w === 0 || w === 6, foto: r, total: a && !temFiltro(g) ? a.resumo.total : null, exp: p.exp[dia] || null, fat: p.fat[dia] || null };
    });
  }
  // Entraram e saíram do atraso em relação à foto anterior (só dias com foto e com foto anterior).
  function fluxo(p, de, ate, g) {
    const out = [];
    for (const a of p.analises) {
      if (a.reg.dia < de || a.reg.dia > ate || !a.cmp) continue;
      const entraram = selecionar(a.cmp.novos, g).length, sairam = selecionar(a.cmp.saiu, g).length;
      out.push({ dia: a.reg.dia, entraram, sairam, saldo: sairam - entraram, ref: a.cmp.ant.dia });
    }
    return out;
  }
  // Média móvel sobre os últimos n valores existentes (null é ignorado, não vira zero).
  function mediaMovel(valores, n) {
    const out = [], janela = [];
    for (const v of valores) {
      if (v != null && Number.isFinite(v)) { janela.push(v); if (janela.length > n) janela.shift(); out.push(janela.reduce((s, x) => s + x, 0) / janela.length); }
      else out.push(null);
    }
    return out;
  }

  // Períodos do filtro: 7, 15, 30 dias terminando no dia de referência, mês atual (do dia 1 ao dia de referência) ou personalizado.
  function periodo(tipo, dia, personalizado) {
    if (tipo === 'mes') return { tipo, de: dia.slice(0, 8) + '01', ate: dia };
    if (tipo === 'custom' && personalizado && personalizado.de && personalizado.ate) {
      const de = personalizado.de <= personalizado.ate ? personalizado.de : personalizado.ate;
      const ate = personalizado.de <= personalizado.ate ? personalizado.ate : personalizado.de;
      return { tipo, de, ate: ate > dia ? ate : ate };
    }
    const n = Math.max(1, Number(tipo) || 30);
    return { tipo: String(n), de: somaDias(dia, -(n - 1)), ate: dia };
  }

  // ---------- blocos do dia ----------
  function gargalos(p, dia, g) {
    const a = p.porDia.get(dia);
    if (!a) return null;
    const itens = selecionar(a.reg.itens, g), ex = H().extra;
    const por = Object.fromEntries(ETAPAS.map((e) => [e, { etapa: e, rotulo: H().ETAPA[e], qtd: 0, pecas: 0, cinco: 0, somaParado: 0, comParado: 0 }]));
    let semEtapa = 0;
    for (const it of itens) {
      const x = ex(it);
      const e = x.e || (it[4] === 'F' ? 'F' : '');
      if (!por[e]) { semEtapa++; continue; }
      const b = por[e];
      b.qtd++; b.pecas += it[3]; if (it[6] >= CRITICO) b.cinco++;
      const desde = H().extra(it) && (x.fa || x.ce || x.pe || x.h);
      if (desde && a.reg.atualizadoEm) { const d = (new Date(a.reg.atualizadoEm) - new Date(desde)) / 864e5; if (Number.isFinite(d) && d >= 0) { b.somaParado += d; b.comParado++; } }
    }
    const lista = ETAPAS.map((e) => { const b = por[e]; return Object.assign({}, b, { pct: itens.length ? b.qtd / itens.length * 100 : 0, paradoMedio: b.comParado ? b.somaParado / b.comParado : null }); });
    const maior = lista.reduce((m, b) => (b.cinco > (m ? m.cinco : -1) || (m && b.cinco === m.cinco && b.qtd > m.qtd) ? b : m), null);
    return { etapas: lista, maior: maior && maior.qtd ? maior.etapa : '', total: itens.length, semEtapa, temEtapa: itens.length > semEtapa };
  }

  function armazens(p, dia, g) {
    const a = p.porDia.get(dia);
    if (!a) return null;
    const itens = selecionar(a.reg.itens, g);
    const mapa = new Map();
    for (const it of itens) { const k = it[1] || '—'; if (!mapa.has(k)) mapa.set(k, []); mapa.get(k).push(it); }
    const tpa = a.reg.totalPorArmazem || null;
    const lista = [...mapa.entries()].map(([nome, its]) => { const base = tpa && tpa[nome] ? tpa[nome] : null; return Object.assign({ nome, pct: itens.length ? its.length / itens.length * 100 : 0, base, pctBase: base ? its.length / base * 100 : null }, resumoItens(its)); });
    lista.sort((x, y) => y.tot - x.tot || String(x.nome).localeCompare(String(y.nome), 'pt-BR'));
    return { lista, total: itens.length, temBase: Boolean(tpa) };
  }

  function faixas(itens) {
    const total = itens.length;
    const lista = FAIXAS.map((f) => ({ id: f.id, rotulo: f.rotulo, nivel: f.nivel, qtd: 0, pecas: 0, pct: 0 }));
    for (const it of itens) {
      const d = Number(it[6]) || 0;
      const i = FAIXAS.findIndex((f) => d >= f.de && d <= f.ate);
      if (i >= 0) { lista[i].qtd++; lista[i].pecas += it[3]; }
    }
    lista.forEach((f) => { f.pct = total ? f.qtd / total * 100 : 0; });
    return { lista, total };
  }
  // distribuição do dia e da foto de 7 dias antes (ou a mais próxima antes dessa data)
  function distribuicao(p, dia, g) {
    const a = p.porDia.get(dia);
    if (!a) return null;
    const alvo = somaDias(dia, -7);
    let ref = null;
    for (const x of p.analises) { if (x.reg.dia <= alvo) ref = x; else break; }
    const atual = faixas(selecionar(a.reg.itens, g));
    const antes = ref ? faixas(selecionar(ref.reg.itens, g)) : null;
    const cincoAtual = atual.lista.slice(2).reduce((s, f) => s + f.qtd, 0);
    return { atual, antes, refDia: ref ? ref.reg.dia : null, cincoAtual, cincoAntes: antes ? antes.lista.slice(2).reduce((s, f) => s + f.qtd, 0) : null };
  }

  // Produtividade: pedidos e peças em medidas separadas (nunca no mesmo eixo). Dia sem registro não é zero.
  function produtividade(serieDias) {
    const comExp = serieDias.filter((d) => d.exp), comFat = serieDias.filter((d) => d.fat);
    const media = (lista, campo) => (lista.length ? lista.reduce((s, d) => s + d[campo], 0) / lista.length : null);
    const extremos = (lista, campo) => {
      if (!lista.length) return { melhor: null, pior: null };
      let m = lista[0], w = lista[0];
      for (const d of lista) { if (d[campo] > m[campo]) m = d; if (d[campo] < w[campo]) w = d; }
      return { melhor: { dia: m.dia, v: m[campo] }, pior: { dia: w.dia, v: w[campo] } };
    };
    const expPed = comExp.map((d) => ({ dia: d.dia, pedidos: d.exp.pedidos, pecas: d.exp.pecas }));
    const fatPed = comFat.map((d) => ({ dia: d.dia, pedidos: d.fat.pedidos, pecas: d.fat.pecas }));
    const semana = SEMANA.map((s, w) => {
      const dd = expPed.filter((d) => diaDaSemana(d.dia) === w), ff = fatPed.filter((d) => diaDaSemana(d.dia) === w);
      return { semana: s, n: dd.length, despachados: media(dd, 'pedidos'), pecasDespachadas: media(dd, 'pecas'), faturados: media(ff, 'pedidos') };
    }).filter((x) => x.semana !== 'dom' && x.semana !== 'sáb');
    return {
      despachados: { dias: expPed.length, mediaPedidos: media(expPed, 'pedidos'), mediaPecas: media(expPed, 'pecas'), totalPedidos: expPed.reduce((s, d) => s + d.pedidos, 0), totalPecas: expPed.reduce((s, d) => s + d.pecas, 0), pedidos: extremos(expPed, 'pedidos'), pecas: extremos(expPed, 'pecas') },
      faturados: { dias: fatPed.length, mediaPedidos: media(fatPed, 'pedidos'), mediaPecas: media(fatPed, 'pecas'), totalPedidos: fatPed.reduce((s, d) => s + d.pedidos, 0), pedidos: extremos(fatPed, 'pedidos') },
      semana
    };
  }

  // Quando a última posição foi gravada: em dia (hoje ou o último dia útil), atenção (1 dia útil sem gravar) ou desatualizado (2 ou mais).
  function frescor(p, hojeDia) {
    const ultimo = p.analises.length ? p.analises[p.analises.length - 1] : null;
    if (!ultimo) return { estado: 'vazio', diasUteis: null, dia: '', atualizadoEm: '' };
    const u = diasUteisEntre(ultimo.reg.dia, hojeDia);
    return { estado: u <= 0 ? 'em-dia' : u === 1 ? 'atencao' : 'desatualizado', diasUteis: Math.max(0, u), dia: ultimo.reg.dia, atualizadoEm: ultimo.reg.atualizadoEm || '' };
  }

  // Armazéns e transportadoras que existem no período (para os filtros globais).
  function opcoesGlobais(p) {
    const arm = new Set(), tr = new Set();
    for (const a of p.analises) for (const it of a.reg.itens) { if (it[1]) arm.add(it[1]); if (it[7]) tr.add(it[7]); }
    const ord = (s) => [...s].sort((x, y) => String(x).localeCompare(String(y), 'pt-BR', { numeric: true }));
    return { armazens: ord(arm), transportadoras: ord(tr) };
  }

  const api = { CRITICO, FAIXAS, ETAPAS, SEMANA, tom, variacao, porArmazem, filtroVazio, temFiltro, selecionar, resumoItens, cartoes, serie, fluxo, mediaMovel, periodo, gargalos, armazens, faixas, distribuicao, produtividade, frescor, opcoesGlobais, somaDias, diasEntre, intervalo, diasUteisEntre, diaDaSemana };
  root.SC9AtrasoPainel = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis);
