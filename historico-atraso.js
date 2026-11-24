/* Página "Histórico de Atraso" (link fixo /historico-atraso.html).
 * Mostra, dia a dia, a foto dos pedidos em atraso que o SC9 grava ao exportar o Histórico de Atraso (estoque e faturamento),
 * o comparativo com o dia anterior e quantos pedidos/peças foram despachados em cada dia (Saída p/ Expedição).
 * Linha de pedido: [pedido, armazém, liberadoEm, peças, 'E'|'F', 'A'|'P', diasDeAtraso, transportadora].
 * A parte de cálculo (preparar, filtrar, csv...) é pura e testada no Node; a tela só roda no navegador. */
(function (root) {
  'use strict';

  const X = () => root.SC9AtrasoHistoricoXlsx || require('./atraso-historico-xlsx.js');
  const OC = () => root.SC9Ocorrencias || require('./ocorrencias.js');
  const chave = (it) => it[1] + '|' + it[0];
  const fmtN = (n) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  const pct = (a, b) => (b ? (a / b * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%' : '—');
  const ddmm = (dia) => dia.slice(8, 10) + '/' + dia.slice(5, 7);
  const ddmmaaaa = (dia) => dia.slice(8, 10) + '/' + dia.slice(5, 7) + '/' + dia.slice(0, 4);
  const semana = (dia, estilo) => new Date(dia + 'T12:00:00Z').toLocaleDateString('pt-BR', { weekday: estilo || 'long', timeZone: 'UTC' });
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const rotuloMes = (mes) => MESES[Number(mes.slice(5, 7)) - 1] + ' de ' + mes.slice(0, 4);
  const diasDoMes = (mes) => { const [a, m] = mes.split('-').map(Number); const n = new Date(Date.UTC(a, m, 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => mes + '-' + String(i + 1).padStart(2, '0')); };

  // ---------- cálculo (puro) ----------
  const extra = (it) => (it && it[8]) || {};
  const ETAPA = { S: 'Separação', C: 'Conferência', F: 'Faturamento (falta a nota)', D: 'Despacho (já tem nota)' };
  const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  // há quanto tempo o pedido está parado na etapa em que está (a partir do último passo concluído até a hora da foto)
  function paradoDesde(it) {
    const x = extra(it);
    return x.fa || x.ce || x.pe || x.h || '';
  }
  function duracao(desdeIso, ateIso) {
    const ms = new Date(ateIso) - new Date(desdeIso);
    if (!Number.isFinite(ms) || ms < 0) return '';
    const h = Math.floor(ms / 36e5), d = Math.floor(h / 24);
    return d ? d + (d === 1 ? ' dia' : ' dias') + (h % 24 ? ' e ' + (h % 24) + ' h' : '') : h + ' h';
  }
  const nfNum = (v) => String(v == null ? '' : v).replace(/\.0+$/, '').replace(/\D/g, '').replace(/^0+/, '');
  const pedidoNormal = (v) => String(v == null ? '' : v).replace(/\D/g, '').replace(/^0+/, '');
  const entregaDe = (entregues, pedido) => (entregues && (entregues[String(pedido)] || entregues[pedidoNormal(pedido)])) || '';
  const diaSP = (iso) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

  // Pedido achado na Saída p/ Expedição (saidas: { pedido: ISO }) já saiu do estoque: o atraso dele deixa de ser de estoque e passa a ser
  // de faturamento (falta a nota), desde que a saída tenha sido registrada até o dia da foto. Marca a linha: [9] = ISO da saída,
  // [10] = 'E' quando o SC9 tinha marcado como estoque e a página reclassificou.
  function aplicarSaidas(meses, saidas) {
    const copia = {};
    for (const [mes, m] of Object.entries(meses || {})) {
      const dias = {};
      for (const [dia, reg] of Object.entries((m && m.dias) || {})) {
        const itens = reg.itens.map((it) => {
          const iso = saidas && saidas[pedidoNormal(it[0])];
          if (!iso) return it;
          const novo = it.slice(0, 9);
          novo[9] = iso;
          if (novo[4] === 'E' && diaSP(iso) <= reg.dia) { novo[4] = 'F'; novo[10] = 'E'; }
          return novo;
        });
        dias[dia] = Object.assign({}, reg, { itens });
      }
      copia[mes] = Object.assign({}, m, { dias });
    }
    return copia;
  }

  // Junta as fotos de atraso e o despacho por dia numa estrutura só.
  function preparar(data) {
    const analises = X().analisar(aplicarSaidas((data && data.meses) || {}, data && data.saidas));
    const exp = {};
    for (const m of Object.values((data && data.expedicao) || {})) Object.assign(exp, m);
    const fat = {}; // pedidos e peças faturados por dia (data de emissão da nota)
    for (const m of Object.values((data && data.faturados) || {})) Object.assign(fat, m);
    const dias = new Set(analises.map((a) => a.reg.dia));
    Object.keys(exp).forEach((d) => dias.add(d));
    Object.keys(fat).forEach((d) => dias.add(d));
    const meses = [...new Set([...dias].map((d) => d.slice(0, 7)))].sort().reverse();
    const porDia = new Map(analises.map((a) => [a.reg.dia, a]));
    const entregues = (data && data.entregues) || {};
    const saidas = (data && data.saidas) || {};
    const historico = new Map(); // pedido → dias (fotos) em que estava em atraso
    for (const a of analises) for (const it of a.reg.itens) { const k = chave(it); if (!historico.has(k)) historico.set(k, []); historico.get(k).push(a.reg.dia); }
    const diasExp = Object.keys(exp).sort();
    const ocorr = new Map(); // nota fiscal → ocorrências registradas pela expedição
    for (const l of (data && data.ocorrencias) || []) {
      // ligada pela nota fiscal; sem nota, pelo número do pedido (chave "p" + pedido)
      const chaves = [nfNum(l && l.nf), nfNum(l && l.pedido) ? 'p' + nfNum(l.pedido) : ''].filter(Boolean);
      for (const n of chaves) { if (!ocorr.has(n)) ocorr.set(n, []); ocorr.get(n).push(l); }
    }
    return { analises, porDia, exp, fat, meses, historico, diasExp, entregues, saidas, ocorr };
  }

  // Quantas fotos seguidas o pedido está em atraso, terminando no dia escolhido.
  function sequencia(p, k, dia) {
    const dias = p.analises.map((a) => a.reg.dia);
    const tem = new Set(p.historico.get(k) || []);
    let i = dias.indexOf(dia), n = 0, desde = dia;
    while (i >= 0 && tem.has(dias[i])) { n++; desde = dias[i]; i--; }
    return { n, desde };
  }

  // Despacho do dia e do dia de despacho anterior (para a variação).
  function despacho(p, dia) {
    const atual = p.exp[dia] || null;
    const antes = p.diasExp.filter((d) => d < dia);
    const refDia = antes.length ? antes[antes.length - 1] : null;
    return { atual, ref: refDia ? p.exp[refDia] : null, refDia };
  }

  const ORDEM = {
    pedido: (a, b) => String(a[0]).localeCompare(String(b[0]), 'pt-BR', { numeric: true }),
    arm: (a, b) => String(a[1]).localeCompare(String(b[1]), 'pt-BR', { numeric: true }),
    lib: (a, b) => String(a[2]).localeCompare(String(b[2])),
    pecas: (a, b) => a[3] - b[3],
    tipo: (a, b) => String(a[4]).localeCompare(String(b[4])),
    sit: (a, b) => String(a[5]).localeCompare(String(b[5])),
    dias: (a, b) => a[6] - b[6],
    transp: (a, b) => String(a[7]).localeCompare(String(b[7]), 'pt-BR', { numeric: true }),
    cliente: (a, b) => String(extra(a).n || '').localeCompare(String(extra(b).n || ''), 'pt-BR')
  };

  // Status do pedido: foi despachado (planilha de Entrega)? aba = 'atraso' | 'novos' | 'saiu'.
  function statusDoPedido(entregues, it, dia, aba) {
    const ent = entregaDe(entregues, it[0]);
    if (ent) return { tipo: 'desp', em: ent, texto: (aba !== 'saiu' && ent > dia ? 'Estava em atraso · despachado em ' : 'Despachado em ') + ddmm(ent) };
    if (it[9]) return { tipo: 'exp', em: it[9], texto: 'Saída p/ expedição em ' + ddmm(diaSP(it[9])) + ' às ' + new Date(it[9]).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) };
    return aba === 'saiu' ? { tipo: 'saiu', em: '', texto: 'Saiu do atraso · sem despacho' } : { tipo: 'atr', em: '', texto: 'Em atraso' };
  }


  // ---------- ocorrências da expedição e "o que fazer" ----------
  // Ocorrência do pedido (achada pela nota fiscal): a mais importante, com o status já calculado. null se não há.
  // Todas as ocorrências do pedido: pela nota fiscal e/ou pelo número do pedido, sem repetir.
  function ocorrenciasDoPedido(p, it) {
    const nfDoPedido = nfNum(extra(it).nf);
    return p && p.ocorr ? [...new Set([].concat((nfDoPedido && p.ocorr.get(nfDoPedido)) || [], p.ocorr.get('p' + nfNum(it[0])) || []))] : [];
  }
  function ocorrenciaDoPedido(p, it, agora) {
    const lista = ocorrenciasDoPedido(p, it);
    if (!lista.length) return null;
    const info = { pedido: String(it[0]), liberadoEm: it[2] || '', despachadoEm: entregaDe(p.entregues, it[0]) };
    const quando = agora || new Date();
    const todas = lista.map((oc) => ({ oc, av: OC().avaliar(oc, info, it[9] || '', quando) }));
    const abertas = todas.filter((x) => !x.av.resolvida).sort((x, y) => y.av.dias - x.av.dias);
    const resolvidas = todas.filter((x) => x.av.resolvida).sort((x, y) => String(y.oc.dataOcorrencia).localeCompare(String(x.oc.dataOcorrencia)));
    return Object.assign({}, (abertas[0] || resolvidas[0]), { total: lista.length });
  }

  // Próximo passo do pedido, em frase simples. cod: ok | fechar | ocorrencia | despachar | levar | faturar | conferir | separar
  function acaoDoPedido(it, st, ocor) {
    const x = extra(it);
    const aberta = ocor && !ocor.av.resolvida;
    if (st.tipo === 'desp') return aberta ? { cod: 'fechar', texto: 'Já foi despachado: feche a ocorrência (solução e data da solução).' } : { cod: 'ok', texto: 'Nada a fazer: já foi despachado.' };
    if (aberta) return { cod: 'ocorrencia', texto: ocor.av.acao };
    let r;
    if (st.tipo === 'exp') r = ['despachar', 'Já está na Saída p/ Expedição: conferir a nota e despachar.'];
    else if (x.e === 'D') r = ['levar', 'Já tem nota fiscal: levar para a Saída p/ Expedição e despachar.'];
    else if (x.e === 'F' || (!x.e && it[4] === 'F')) r = ['faturar', 'Separado e conferido: faturar (emitir a nota fiscal).'];
    else if (x.e === 'C') r = ['conferir', 'Separado: falta conferir.'];
    else r = ['separar', 'Ainda em separação: separar e conferir.'];
    return { cod: r[0], texto: (ocor ? 'Ocorrência resolvida. ' : '') + r[1] + (it[6] >= 5 ? ' Atrasado há ' + fmtN(it[6]) + ' dias: prioridade.' : '') };
  }
  const TITULO_ACAO = {
    ocorrencia: 'com ocorrência aberta: resolver o problema', fechar: 'despachados com ocorrência aberta: fechar a ocorrência', despachar: 'na Saída p/ Expedição: falta despachar',
    levar: 'já têm nota fiscal: levar para a expedição e despachar', faturar: 'separados e conferidos: falta faturar (nota fiscal)', conferir: 'separados: falta conferir', separar: 'ainda em separação'
  };
  const TITULO_ACAO_MAIUSCULO = Object.fromEntries(Object.entries(TITULO_ACAO).map(([c, t]) => [c, t.charAt(0).toUpperCase() + t.slice(1)]));
  const ORDEM_ACAO = ['ocorrencia', 'fechar', 'despachar', 'levar', 'faturar', 'conferir', 'separar'];

  // Avaliação completa de um pedido da foto: status, ocorrência e ação.
  function avaliarPedido(p, it, dia, agora) {
    const st = statusDoPedido(p.entregues, it, dia || '', 'atraso'), ocor = ocorrenciaDoPedido(p, it, agora);
    return { st, ocor, acao: acaoDoPedido(it, st, ocor) };
  }

  // "O que fazer agora": pedidos da foto agrupados pelo próximo passo (sem os já despachados) + atrasados há 5+ dias sem ocorrência.
  function prioridades(p, itens, dia, agora) {
    const grupos = new Map(), sem = { qtd: 0, pecas: 0 };
    let despachados = 0;
    for (const it of itens) {
      const v = avaliarPedido(p, it, dia, agora);
      if (v.acao.cod === 'ok') { despachados++; continue; }
      const g = grupos.get(v.acao.cod) || { cod: v.acao.cod, titulo: TITULO_ACAO[v.acao.cod], qtd: 0, pecas: 0, antigos: 0 };
      g.qtd++; g.pecas += it[3]; if (it[6] >= 5) g.antigos++;
      grupos.set(v.acao.cod, g);
      if (!v.ocor && it[6] >= 5 && v.st.tipo !== 'desp') { sem.qtd++; sem.pecas += it[3]; }
    }
    return { grupos: ORDEM_ACAO.filter((c) => grupos.has(c)).map((c) => grupos.get(c)), semOcorrencia: sem, despachados };
  }

  // f = { tipo:'E'|'F'|'', sit:'A'|'P'|'', arm:'', transp:'', busca:'', status:'desp'|'nao'|'', acao:'', ocorr:'com'|'aberta'|'sem'|'sem5'|'', ordem:'dias', desc:true }
  // ctx (opcional) = { p, dia, agora }: necessário só para filtrar por acao e ocorr.
  function filtrar(itens, f, entregues, ctx) {
    const busca = String((f && f.busca) || '').trim().toLowerCase();
    const precisaAvaliar = ctx && ctx.p && (f.acao || f.ocorr);
    let lista = itens.filter((it) => {
      if (precisaAvaliar) {
        const v = avaliarPedido(ctx.p, it, ctx.dia, ctx.agora);
        if (f.acao && !String(f.acao).split(',').includes(v.acao.cod)) return false;
        if (f.ocorr === 'com' && !v.ocor) return false;
        if (f.ocorr === 'aberta' && !(v.ocor && !v.ocor.av.resolvida)) return false;
        if (f.ocorr === 'sem' && v.ocor) return false;
        if (f.ocorr === 'sem5' && (v.ocor || it[6] < 5 || v.st.tipo === 'desp')) return false;
      }
      if (f.diasMin && !(it[6] >= f.diasMin)) return false;
      return (!f.status || (f.status === 'desp') === Boolean(entregaDe(entregues, it[0]))) && (!f.etapa || extra(it).e === f.etapa) && (!f.tipo || it[4] === f.tipo) && (!f.sit || it[5] === f.sit) && (!f.arm || it[1] === f.arm) && (!f.transp || (it[7] || '') === f.transp)
      && (!busca || String(it[0]).toLowerCase().includes(busca) || String(it[7] || '').toLowerCase().includes(busca) || String(extra(it).n || '').toLowerCase().includes(busca) || String(extra(it).nf || '').includes(busca) || String(extra(it).c || '').toLowerCase().includes(busca));
    });
    const cmp = ORDEM[f.ordem] || ORDEM.dias;
    lista = lista.slice().sort((a, b) => (f.desc ? -1 : 1) * cmp(a, b) || ORDEM.pedido(a, b));
    return lista;
  }

  const TIPO = { E: 'Estoque', F: 'Faturamento' };
  const SIT = { A: 'Atrasado', P: 'Em processo' };
  const FILTRO_VAZIO = () => ({ tipo: '', sit: '', status: '', arm: '', transp: '', busca: '', acao: '', ocorr: '', ordem: 'dias', desc: true });

  // Vocabulário da página, em linguagem simples (aparece em "Como ler esta página").
  const GLOSSARIO = [
    ['Em atraso', 'pedido ainda não despachado que passou do prazo ("Atrasado"), ou já conferido e esperando só a nota ("Em processo"). A foto do dia lista todos.'],
    ['Estoque', 'atraso que não está só esperando a nota: o pedido ainda está em separação ou conferência, ou já tem nota e falta despachar.'],
    ['Faturamento', 'pedido que já saiu do estoque e só espera a nota fiscal: separado e conferido sem nota, ou já registrado na Saída p/ Expedição (o SC9 ainda marcava como estoque).'],
    ['Atrasado / Em processo', '"Atrasado" já passou do prazo; "Em processo" ainda está no prazo, mas já conferido esperando a nota.'],
    ['Dias de atraso', 'dias desde a liberação do pedido. Número vermelho = 5 dias ou mais.'],
    ['Etapa em que parou', 'Separação, Conferência, Faturamento (falta a nota) ou Despacho (já tem nota, falta sair).'],
    ['Status do pedido', 'Despachado (está na planilha de Entrega), Saída p/ expedição (saiu do estoque, falta despachar) ou Em atraso.'],
    ['Ocorrência (expedição)', 'problema que a expedição registrou na aba Ocorrências do SC9 (endereço, cadastro...). A página liga a ocorrência ao pedido pela nota fiscal. Aberta = sem solução; Em andamento = tem retorno, falta a data da solução; Resolvida = solução registrada. Vermelho = aberta há 3 dias ou mais.'],
    ['O que fazer', 'próximo passo sugerido, calculado sozinho pela etapa do pedido, pela ocorrência e pelos dias de atraso. "O que fazer agora" agrupa os pedidos da foto por esse passo.'],
    ['Saíram / Continuam / Entraram', 'comparação com a foto gravada imediatamente antes (pode ser de mais de um dia atrás, se algum dia não foi gravado).'],
    ['Despachados', 'pedidos que estão na planilha de Entrega, no dia da data de entrega; cada pedido conta uma vez. As peças são a soma dos itens desse pedido na base do SC9.'],
    ['Setas e cores', '▲ vermelho = piorou em relação ao dia anterior; ▼ verde = melhorou (em despachados, subir é bom e fica verde).']
  ];

  // colunas extras do CSV: o que fazer + ocorrência da expedição
  function linhaDeAcao(it, ctx, dia, aba) {
    if (!ctx || !ctx.p) return ['', '', '', '', '', ''];
    const v = avaliarPedido(ctx.p, it, dia || '', ctx.agora);
    const o = v.ocor;
    return [v.acao.texto, o ? o.av.status : '', o ? o.oc.detalhes : '', o ? o.oc.responsavel : '', o ? o.oc.solucao : '', o && o.oc.dataSolucao ? ddmmaaaa(o.oc.dataSolucao) : ''];
  }

  // CSV (separador ";", com BOM para o Excel abrir com acento) da lista que está na tela.
  function csv(itens, entregues, dia, aba, ctx) {
    const cel = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const linhas = [['Pedido', 'Cliente', 'Código do cliente', 'Nota fiscal', 'Valor (R$)', 'Armazém', 'Liberado em', 'Peças', 'Linhas', 'Tipo', 'Etapa', 'Situação', 'Dias de atraso', 'Transportadora', 'Separador', 'Conferente', 'Parado desde', 'Status do pedido', 'O que fazer', 'Ocorrência', 'Detalhes da ocorrência', 'Responsável', 'Solução', 'Data da solução']];
    for (const it of itens) {
      const x = extra(it), desde = paradoDesde(it);
      linhas.push([it[0], x.n || '', x.c || '', x.nf || '', x.v != null ? String(x.v).replace('.', ',') : '', it[1], it[2] ? ddmmaaaa(it[2]) : '', String(it[3]).replace('.', ','), x.l || '', TIPO[it[4]] || it[4], ETAPA[x.e] || '', SIT[it[5]] || it[5], it[6], it[7] || '', x.sp || '', x.cf || '', desde ? new Date(desde).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '', statusDoPedido(entregues, it, dia || '', aba || 'atraso').texto].concat(linhaDeAcao(it, ctx, dia, aba)));
    }
    return '﻿' + linhas.map((l) => l.map(cel).join(';')).join('\r\n');
  }

  const api = { extra, ETAPA, aplicarSaidas, preparar, ocorrenciasDoPedido, ocorrenciaDoPedido, acaoDoPedido, avaliarPedido, prioridades, GLOSSARIO, sequencia, despacho, filtrar, csv, statusDoPedido, chave, rotuloMes, diasDoMes, ddmm, ddmmaaaa, fmtN, pct, TIPO, SIT };
  root.SC9HistoricoAtraso = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof document === 'undefined' || !document.getElementById || !document.getElementById('app')) return;

  // ---------- tela ----------
  const h = (tag, props, ...filhos) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    }
    for (const f of filhos.flat(Infinity)) { if (f == null || f === false) continue; e.appendChild(typeof f === 'string' || typeof f === 'number' ? document.createTextNode(String(f)) : f); }
    return e;
  };
  const $app = document.getElementById('app');
  // Link sem senha: /historico-atraso.html?k=CÓDIGO (só leitura). Sem código, a página pede o login do SC9.
  const chaveLink = new URLSearchParams(location.search).get('k') || '';
  const comChave = (url) => url + (chaveLink ? (url.includes('?') ? '&' : '?') + 'k=' + encodeURIComponent(chaveLink) : '');
  const estado = { data: null, p: null, mes: '', dia: '', aba: 'atraso', filtro: FILTRO_VAZIO(), aberto: '', limite: 100, ajuda: true, aviso: '' };

  const seta = (atual, ref, pioraSobe) => {
    if (ref == null) return null;
    const d = atual - ref;
    if (!d) return h('span', { class: 'delta neutro', text: '= igual' });
    const ruim = pioraSobe ? d > 0 : d < 0;
    return h('span', { class: 'delta ' + (ruim ? 'ruim' : 'bom'), text: (d > 0 ? '▲ +' : '▼ ') + fmtN(d) });
  };

  async function carregar() {
    $app.replaceChildren(h('p', { class: 'carregando', text: 'Carregando o histórico…' }));
    let r;
    try { r = await fetch(comChave('/api/atraso-historico?meses=24'), { cache: 'no-store', credentials: 'same-origin' }); }
    catch (e) { return telaErro('Não consegui falar com o servidor. Verifique a internet e tente de novo.'); }
    if (r.status === 401) return chaveLink ? telaErro('Este link não vale mais. Peça um link novo ao administrador do SC9.') : telaLogin('');
    if (r.status === 403) return telaErro('Seu usuário não tem acesso a esta página. Peça ao administrador o perfil "Geral".');
    if (!r.ok) return telaErro('O servidor não conseguiu abrir o histórico agora. Tente de novo em instantes.');
    estado.data = await r.json();
    estado.p = preparar(estado.data);
    const hash = (location.hash || '').replace('#', '');
    const todos = new Set([...estado.p.porDia.keys(), ...estado.p.diasExp]);
    const ultimo = [...estado.p.porDia.keys()].sort().pop() || [...todos].sort().pop() || '';
    estado.dia = /^\d{4}-\d{2}-\d{2}$/.test(hash) && todos.has(hash) ? hash : ultimo;
    estado.mes = estado.dia ? estado.dia.slice(0, 7) : (estado.p.meses[0] || '');
    desenhar();
    if (estado.dia && estado.dia === hash) setTimeout(() => { const alvo = document.getElementById('dia-detalhe'); if (alvo) alvo.scrollIntoView({ block: 'start' }); }, 50);
  }

  function telaErro(msg) {
    $app.replaceChildren(h('div', { class: 'cartao centro' }, h('h2', { text: 'Não deu para abrir' }), h('p', { text: msg }), chaveLink ? null : h('button', { class: 'btn primario', onclick: carregar, text: 'Tentar de novo' })));
  }

  function telaLogin(erro) {
    const usuario = h('input', { id: 'u', type: 'text', autocomplete: 'username', placeholder: 'admin (deixe vazio se for o administrador)' });
    const senha = h('input', { id: 's', type: 'password', autocomplete: 'current-password', required: true });
    const msg = h('p', { class: 'erro', role: 'alert', text: erro });
    const form = h('form', { class: 'cartao centro login', onsubmit: async (ev) => {
      ev.preventDefault(); msg.textContent = '';
      try {
        const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SC9-App': '1' }, credentials: 'same-origin', body: JSON.stringify({ usuario: usuario.value.trim(), password: senha.value }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) { msg.textContent = j.error || 'Usuário ou senha incorretos.'; return; }
        carregar();
      } catch (e) { msg.textContent = 'Não consegui falar com o servidor.'; }
    } },
      h('h2', { text: 'Entre para ver o histórico' }),
      h('p', { class: 'mudo', text: 'Use o mesmo usuário e senha do SC9.' }),
      h('label', { for: 'u', text: 'Usuário' }), usuario,
      h('label', { for: 's', text: 'Senha' }), senha, msg,
      h('button', { class: 'btn primario', type: 'submit', text: 'Entrar' }));
    $app.replaceChildren(form);
    senha.focus();
  }

  function escolherDia(dia, rolar) {
    estado.dia = dia; estado.mes = dia.slice(0, 7); estado.aba = 'atraso'; estado.aberto = ''; estado.limite = 100;
    estado.filtro = FILTRO_VAZIO();
    try { history.replaceState(null, '', '#' + dia); } catch (e) { /* sem histórico de navegação */ }
    desenhar();
    if (rolar !== false) { const alvo = document.getElementById('dia-detalhe'); if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }

  function trocarMes(mes) {
    estado.mes = mes;
    const dias = diasDoMes(mes).filter((d) => estado.p.porDia.has(d) || estado.p.exp[d]);
    if (dias.length) { estado.dia = dias[dias.length - 1]; estado.aberto = ''; estado.aba = 'atraso'; try { history.replaceState(null, '', '#' + estado.dia); } catch (e) { /* ok */ } }
    else estado.dia = '';
    desenhar();
  }

  // ---------- blocos ----------
  function cabecalho() {
    const meses = estado.p.meses.slice();
    if (estado.mes && !meses.includes(estado.mes)) meses.unshift(estado.mes);
    const i = meses.indexOf(estado.mes);
    const sel = h('select', { 'aria-label': 'Mês', onchange: (ev) => trocarMes(ev.target.value) }, meses.map((m) => h('option', { value: m, selected: m === estado.mes, text: rotuloMes(m) })));
    return h('header', { class: 'topo' },
      h('div', null,
        h('p', { class: 'sobre', text: 'SC9 Control' }),
        h('h1', { text: 'Histórico de Atraso' }),
        h('p', { class: 'mudo', text: 'Foto diária dos pedidos em atraso (estoque e faturamento), com o que mudou em relação ao dia anterior e o que foi despachado (planilha de Entrega).' }),
        h('p', { class: 'atualizado', text: ultimaAtualizacao() })),
      h('div', { class: 'acoes' },
        h('button', { class: 'btn', onclick: () => i < meses.length - 1 && trocarMes(meses[i + 1]), disabled: i >= meses.length - 1, 'aria-label': 'Mês anterior', text: '◀' }),
        sel,
        h('button', { class: 'btn', onclick: () => i > 0 && trocarMes(meses[i - 1]), disabled: i <= 0, 'aria-label': 'Próximo mês', text: '▶' }),
        h('button', { class: 'btn', type: 'button', title: 'Ver e registrar as ocorrências da expedição (quem registra entra com usuário e senha)', onclick: () => { const c = document.getElementById('ocorrencias-box'); if (c && c.scrollIntoView) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, text: 'Ocorrências da expedição ↓' }),
        painelLigado ? h('a', { class: 'btn', href: urlComPainel('0'), title: 'Esconde o painel e mostra só a página de antes', text: 'Só a página antiga' }) : h('a', { class: 'btn primario', href: urlComPainel('1'), text: 'Painel executivo' }),
        chaveLink ? null : h('a', { class: 'btn', href: '/', text: 'Voltar ao SC9' })));
  }

  // Esta página só muda quando alguém exporta o Histórico de Atraso no SC9; mostra quando foi a última vez.
  function ultimaAtualizacao() {
    let ultimo = '';
    for (const a of estado.p.analises) if (a.reg.atualizadoEm && a.reg.atualizadoEm > ultimo) ultimo = a.reg.atualizadoEm;
    if (!ultimo) return 'Atualizada sempre que o Histórico de Atraso é exportado no SC9.';
    // (a Saída p/ Expedição é cruzada em tempo real, abaixo)
    const q = new Date(ultimo);
    return 'Atualizada em ' + q.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' às ' + q.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) + ', na última exportação do Histórico de Atraso (fotos e despachados da Entrega só mudam quando o atraso é exportado de novo). A Saída p/ Expedição é cruzada em tempo real, a cada 30 segundos.';
  }

  function faixaDeDias() {
    const dias = diasDoMes(estado.mes);
    return h('section', { class: 'cartao', 'aria-label': 'Dias do mês' },
      h('h2', { text: 'Escolha o dia' }),
      h('p', { class: 'mudo', text: 'Clique em um dia para ver todos os pedidos em atraso daquela foto. Dias sem foto aparecem apagados (o histórico só é gravado quando o Histórico de Atraso é exportado no SC9).' }),
      h('div', { class: 'dias' }, dias.map((d) => {
        const a = estado.p.porDia.get(d), ex = estado.p.exp[d];
        const tem = Boolean(a || ex);
        const ant = a && a.cmp ? a.cmp.resumoAnt.tot : null;
        const delta = a && ant != null ? a.resumo.tot - ant : 0;
        return h('button', { class: 'dia' + (d === estado.dia ? ' ativo' : '') + (tem ? '' : ' vazio') + (a ? '' : ' semfoto'), disabled: !tem, 'aria-pressed': d === estado.dia, title: tem ? ddmmaaaa(d) + (a ? ' · ' + a.resumo.tot + ' em atraso' : ' · sem foto de atraso') + (ex ? ' · ' + ex.pedidos + ' despachados' : '') : ddmmaaaa(d) + ' · sem dados', onclick: () => escolherDia(d) },
          h('span', { class: 'n', text: d.slice(8, 10) }),
          h('span', { class: 's', text: semana(d, 'short').replace('.', '') }),
          h('span', { class: 'v', text: a ? String(a.resumo.tot) : (ex ? '—' : '') }),
          a && ant != null && delta ? h('span', { class: 'm ' + (delta > 0 ? 'ruim' : 'bom'), text: (delta > 0 ? '▲' : '▼') + Math.abs(delta) }) : null);
      })));
  }

  function barras(titulo, ajuda, serie, cor, formato) {
    const max = Math.max(1, ...serie.map((s) => s.v));
    return h('div', { class: 'grafico' },
      h('h3', { text: titulo }), h('p', { class: 'mudo peq', text: ajuda }),
      serie.length ? h('div', { class: 'barras' + (serie.length <= 8 ? ' todos' : '') }, serie.map((s) => h('button', { class: 'barra' + (s.dia === estado.dia ? ' ativa' : ''), title: ddmmaaaa(s.dia) + ': ' + formato(s.v), onclick: () => escolherDia(s.dia, false) },
        h('span', { class: 'val', text: formato(s.v) }),
        h('span', { class: 'col', style: 'height:calc((100% - 32px) * ' + (s.v / max).toFixed(3) + ');background:' + cor }),
        h('span', { class: 'lab', text: s.dia.slice(8, 10) })))) : h('p', { class: 'vazio-msg', text: 'Sem dados neste mês.' }));
  }

  function graficos() {
    const dias = diasDoMes(estado.mes);
    const atraso = dias.filter((d) => estado.p.porDia.has(d)).map((d) => ({ dia: d, v: estado.p.porDia.get(d).resumo.tot }));
    const desp = dias.filter((d) => estado.p.exp[d]).map((d) => ({ dia: d, v: estado.p.exp[d].pedidos }));
    const pecas = dias.filter((d) => estado.p.exp[d]).map((d) => ({ dia: d, v: estado.p.exp[d].pecas }));
    const fatur = dias.filter((d) => estado.p.fat[d]).map((d) => ({ dia: d, v: estado.p.fat[d].pedidos }));
    return h('section', { class: 'cartao', 'aria-label': 'Gráficos do mês' },
      h('h2', { text: 'O mês em números' }),
      h('p', { class: 'mudo', text: 'Cada barra é um dia (clique para destacar o dia; o número aparece na barra escolhida ou ao passar o mouse). Em atraso: quantos pedidos estavam atrasados na foto. Despachados: pedidos da planilha de Entrega com a data daquele dia.' }),
      h('div', { class: 'graficos' },
        barras('Pedidos em atraso por dia', 'Estoque + faturamento', atraso, '#c63828', (v) => fmtN(v)),
        barras('Pedidos despachados por dia', 'Pedidos da planilha de Entrega', desp, '#1f8a4c', (v) => fmtN(v)),
        fatur.length ? barras('Pedidos faturados por dia', 'Notas emitidas (pode faturar mais do que despachar)', fatur, '#b87708', (v) => fmtN(v)) : null,
        barras('Peças despachadas por dia', 'Soma das peças desses pedidos', pecas, '#123b7a', (v) => (v >= 1000 ? (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : fmtN(v)))));
  }

  function tabelaDoMes() {
    const dias = diasDoMes(estado.mes).filter((d) => estado.p.porDia.has(d) || estado.p.exp[d] || estado.p.fat[d]);
    if (!dias.length) return null;
    let sd = 0, sp = 0, nd = 0, sf = 0, sfp = 0, nf = 0;
    const linhas = dias.map((d) => {
      const a = estado.p.porDia.get(d), ex = estado.p.exp[d], ft = estado.p.fat[d];
      if (ex) { sd += ex.pedidos; sp += ex.pecas; nd++; }
      if (ft) { sf += ft.pedidos; sfp += ft.pecas; nf++; }
      const ant = a && a.cmp ? a.cmp.resumoAnt.tot : null;
      return h('tr', { class: 'clicavel' + (d === estado.dia ? ' sel' : ''), onclick: () => escolherDia(d) },
        h('td', { class: 'ped', text: ddmm(d) + ' · ' + semana(d, 'short').replace('.', '') }),
        h('td', { class: 'num', 'data-l': 'Em atraso', text: a ? fmtN(a.resumo.tot) : '—' }),
        h('td', { class: 'num', 'data-l': 'Estoque', text: a ? fmtN(a.resumo.e) : '—' }),
        h('td', { class: 'num', 'data-l': 'Faturamento', text: a ? fmtN(a.resumo.f) : '—' }),
        h('td', { class: 'num', 'data-l': '% dos pedidos', text: a ? pct(a.resumo.tot, a.resumo.total) : '—' }),
        h('td', { class: 'num', 'data-l': 'Mudou vs dia anterior' }, a && ant != null ? seta(a.resumo.tot, ant, true) : (a ? h('span', { class: 'mudo', text: 'primeiro dia' }) : '—')),
        h('td', { class: 'num', 'data-l': 'Pedidos despachados', text: ex ? fmtN(ex.pedidos) : '—' }),
        h('td', { class: 'num', 'data-l': 'Peças despachadas', text: ex ? fmtN(ex.pecas) : '—' }),
        h('td', { class: 'num', 'data-l': 'Pedidos faturados', text: ft ? fmtN(ft.pedidos) : '—' }),
        h('td', { class: 'num', 'data-l': 'Peças faturadas', text: ft ? fmtN(ft.pecas) : '—' }));
    });
    return h('section', { class: 'cartao', 'aria-label': 'Dia a dia do mês' },
      h('h2', { text: 'Dia a dia de ' + rotuloMes(estado.mes) }),
      h('p', { class: 'mudo', text: 'Todos os dias do mês em uma tabela. Clique na linha para abrir os pedidos do dia.' }),
      h('div', { class: 'rolagem' }, h('table', { class: 'tab mes' },
        h('thead', null, h('tr', null, ['Dia', 'Em atraso', 'Estoque', 'Faturamento', '% dos pedidos', 'Mudou vs dia anterior', 'Pedidos despachados', 'Peças despachadas', 'Pedidos faturados', 'Peças faturadas'].map((t, i) => h('th', { class: i ? 'num' : '', title: i === 7 || i === 8 ? 'Pedidos com nota fiscal emitida neste dia (aba SF2 do SC9). Pode faturar mais do que despachar.' : '', text: t })))),
        h('tbody', null, linhas),
        nd || nf ? h('tfoot', null, h('tr', null, h('td', { text: 'Total do mês' }), h('td', { colspan: 5, class: 'mudo', text: [nd ? nd + (nd === 1 ? ' dia com despacho' : ' dias com despacho') + ' · média de ' + fmtN(sd / nd) + ' pedidos por dia' : '', nf ? nf + (nf === 1 ? ' dia com faturamento' : ' dias com faturamento') + ' · média de ' + fmtN(sf / nf) + ' pedidos por dia' : ''].filter(Boolean).join(' · ') }), h('td', { class: 'num', text: nd ? fmtN(sd) : '—' }), h('td', { class: 'num', text: nd ? fmtN(sp) : '—' }), h('td', { class: 'num', text: nf ? fmtN(sf) : '—' }), h('td', { class: 'num', text: nf ? fmtN(sfp) : '—' }))) : null)));
  }

  function cartaoKpi(titulo, valor, sub, delta, tom, dica) {
    return h('div', { class: 'kpi ' + (tom || ''), title: dica || '' }, h('p', { class: 'kt', text: titulo }), h('p', { class: 'kv', text: valor }), sub ? h('p', { class: 'ks', text: sub }) : null, delta || null);
  }

  function detalheDoDia() {
    const dia = estado.dia;
    if (!dia) return h('section', { class: 'cartao centro', id: 'dia-detalhe' }, h('h2', { text: 'Nenhuma foto gravada neste mês' }), h('p', { class: 'mudo', text: 'No SC9, abra o painel e use o botão "Histórico de Atraso" (ao lado do Relatório Geral). Ao exportar, ele grava a foto do dia aqui.' }));
    const a = estado.p.porDia.get(dia), dp = despacho(estado.p, dia);
    const caixa = h('section', { class: 'cartao', id: 'dia-detalhe', 'aria-label': 'Detalhe do dia' });
    const hora = a && a.reg.atualizadoEm ? new Date(a.reg.atualizadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '';
    caixa.appendChild(h('div', { class: 'dia-titulo' },
      h('div', null, h('h2', { text: semana(dia).replace(/^./, (c) => c.toUpperCase()) + ', ' + ddmmaaaa(dia) }), h('p', { class: 'mudo', text: a ? 'Foto gravada' + (hora ? ' às ' + hora : '') + '.' : 'Sem foto de atraso neste dia (só há dados de despacho).' })),
      h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(location.origin + location.pathname + location.search + '#' + dia); estado.aviso = 'Link do dia copiado.'; } catch (e) { estado.aviso = 'Não consegui copiar sozinho. Copie o endereço que está na barra do navegador.'; } desenhar(); }, text: 'Copiar link deste dia' })));
    if (estado.aviso) { caixa.appendChild(h('p', { class: 'aviso', role: 'status', text: estado.aviso })); estado.aviso = ''; }
    const reclass = a ? a.reg.itens.filter((it) => it[10]).length : 0;
    if (a) caixa.appendChild(h('p', { class: 'frase ' + (a.cmp ? (a.resumo.tot < a.cmp.resumoAnt.tot ? 'bom' : a.resumo.tot > a.cmp.resumoAnt.tot ? 'ruim' : '') : ''), text: X().frase(a) }));
    if (reclass) caixa.appendChild(h('p', { class: 'resumo-status', text: fmtN(reclass) + (reclass === 1 ? ' pedido que o SC9 marcou como estoque foi contado' : ' pedidos que o SC9 marcou como estoque foram contados') + ' como atraso de faturamento, porque já passou' + (reclass === 1 ? '' : 'ram') + ' pela Saída p/ Expedição (só falta a nota).' }));
    const r = a ? a.resumo : null, ra = a && a.cmp ? a.cmp.resumoAnt : null;
    const refTxt = a && a.cmp ? ' vs ' + ddmm(a.cmp.ant.dia) : '';
    const kpis = h('div', { class: 'kpis' });
    if (r) {
      kpis.append(
        cartaoKpi('Em atraso', fmtN(r.tot), pct(r.tot, r.total) + ' dos ' + fmtN(r.total) + ' pedidos', ra ? h('span', { class: 'ks' }, seta(r.tot, ra.tot, true), refTxt) : null, 'atraso', 'Pedidos em atraso na foto deste dia (estoque + faturamento).'),
        cartaoKpi('Atraso de estoque', fmtN(r.e), pct(r.e, r.total) + ' · ' + fmtN(r.ep) + ' peças', ra ? h('span', { class: 'ks' }, seta(r.e, ra.e, true), refTxt) : null, '', 'Atrasados que não estão só esperando a nota: em separação/conferência, ou com nota e sem despacho.'),
        cartaoKpi('Atraso de faturamento', fmtN(r.f), pct(r.f, r.total) + ' · ' + fmtN(r.fp) + ' peças', ra ? h('span', { class: 'ks' }, seta(r.f, ra.f, true), refTxt) : null, '', 'Pedidos que já saíram do estoque e esperam a nota fiscal (inclui os que o SC9 marcava como estoque mas já estão na Saída p/ Expedição).'),
        cartaoKpi('Valor em atraso', somaValor(a.reg.itens) ? brl(somaValor(a.reg.itens)) : '—', somaValor(a.reg.itens) ? 'só pedidos já faturados (valor da nota)' : 'sem nota fiscal ainda', null, '', 'Soma do valor das notas dos pedidos em atraso que já têm nota fiscal.'),
        cartaoKpi('Peças em atraso', fmtN(r.pecas), 'estoque + faturamento', ra ? h('span', { class: 'ks' }, seta(r.pecas, ra.pecas, true), refTxt) : null, '', 'Soma das peças dos pedidos em atraso.'));
    }
    kpis.append(
      cartaoKpi('Pedidos despachados', dp.atual ? fmtN(dp.atual.pedidos) : '—', dp.atual ? 'na planilha de Entrega neste dia' : 'sem pedidos na planilha de Entrega', dp.atual && dp.ref ? h('span', { class: 'ks' }, seta(dp.atual.pedidos, dp.ref.pedidos, false), ' vs ' + ddmm(dp.refDia)) : null, 'ok', 'Pedidos da planilha de Entrega com a data deste dia (cada pedido conta uma vez).'),
      cartaoKpi('Peças despachadas', dp.atual ? fmtN(dp.atual.pecas) : '—', dp.atual ? 'peças desses pedidos' : '', dp.atual && dp.ref ? h('span', { class: 'ks' }, seta(dp.atual.pecas, dp.ref.pecas, false), ' vs ' + ddmm(dp.refDia)) : null, 'ok', 'Soma das peças dos pedidos despachados neste dia (itens do pedido na base do SC9).'));
    const ft = estado.p.fat[dia];
    const diasFat = Object.keys(estado.p.fat).sort().filter((d) => d < dia);
    const ftRef = diasFat.length ? estado.p.fat[diasFat[diasFat.length - 1]] : null;
    kpis.append(
      cartaoKpi('Pedidos faturados', ft ? fmtN(ft.pedidos) : '—', ft ? (dp.atual ? (ft.pedidos > dp.atual.pedidos ? 'faturou ' + fmtN(ft.pedidos - dp.atual.pedidos) + ' a mais do que despachou' : ft.pedidos < dp.atual.pedidos ? 'faturou ' + fmtN(dp.atual.pedidos - ft.pedidos) + ' a menos do que despachou' : 'o mesmo que despachou') : 'notas emitidas neste dia') : 'sem faturamento registrado neste dia', ft && ftRef ? h('span', { class: 'ks' }, seta(ft.pedidos, ftRef.pedidos, false), ' vs ' + ddmm(diasFat[diasFat.length - 1])) : null, 'ok', 'Pedidos com nota fiscal emitida neste dia (data de emissão da aba SF2 do SC9); cada pedido conta uma vez. Pode faturar mais do que despachar.'),
      cartaoKpi('Peças faturadas', ft ? fmtN(ft.pecas) : '—', ft ? 'peças desses pedidos' : '', ft && ftRef ? h('span', { class: 'ks' }, seta(ft.pecas, ftRef.pecas, false), ' vs ' + ddmm(diasFat[diasFat.length - 1])) : null, 'ok', 'Soma das peças dos pedidos faturados neste dia (itens do pedido na base do SC9).'));
    caixa.appendChild(kpis);
    const painel = a ? painelDeAcoes(a) : null;
    if (painel) caixa.appendChild(painel);
    caixa.appendChild(h('details', { class: 'ajuda', open: estado.ajuda, ontoggle: (ev) => { estado.ajuda = ev.target.open; } },
      h('summary', { text: 'Como ler esta página' }),
      h('ul', null, GLOSSARIO.map(([t, d]) => h('li', null, h('b', { text: t + ': ' }), d)))));
    if (a) caixa.appendChild(listaDePedidos(a));
    return caixa;
  }

  /* ---------- justificar o atraso na própria lista (sem sair do pedido) ----------
   * O formulário fica dentro do detalhe do pedido. Todos veem as ocorrências; para registrar, a pessoa da expedição entra com usuário e senha
   * ali mesmo (quem tem o acesso "Ocorrências" ou o administrador). Não depende de React. */
  const CAB_POST = { 'Content-Type': 'application/json', 'X-SC9-App': '1' };
  estado.sessao = null; estado.login = { usuario: '', senha: '', erro: '', entrando: false }; estado.just = null;
  const hojeBR = () => OC().mostrarData(OC().hojeSP(new Date()));
  const justVazia = (k, extraCampos) => Object.assign({ k, id: '', data: hojeBR(), detalhes: '', responsavel: '', solucao: '', dataSolucao: '', erro: '', aviso: '', salvando: false }, extraCampos || {});

  async function carregarSessao() {
    try {
      const r = await fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' });
      const j = await r.json();
      estado.sessao = { authed: Boolean(j.authed), nome: j.nome || j.usuario || '', pode: Boolean(j.authed && (j.role === 'admin' || (j.perfis || []).includes('ocorrencias'))) };
    } catch (e) { estado.sessao = { authed: false, nome: '', pode: false }; }
  }
  function abrirJustificativa(it, k) {
    estado.aberto = k; estado.just = justVazia(k);
    if (!estado.sessao) carregarSessao().then(desenhar);
    desenhar();
    setTimeout(() => { const e = document.getElementById('just-detalhes') || document.getElementById('just-usuario'); if (e) { e.scrollIntoView({ block: 'center' }); e.focus({ preventScroll: true }); } }, 60);
  }
  async function entrarParaJustificar() {
    const l = estado.login; l.entrando = true; l.erro = ''; desenhar();
    try {
      const r = await fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: CAB_POST, body: JSON.stringify({ usuario: l.usuario, password: l.senha }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || 'Não consegui entrar.');
      l.senha = ''; await carregarSessao();
    } catch (e) { l.erro = e.message; }
    l.entrando = false; desenhar();
  }
  async function sairDaConta() {
    try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin', headers: CAB_POST }); } catch (e) { /* segue */ }
    await carregarSessao(); desenhar();
  }
  async function salvarJustificativa(it) {
    const j = estado.just; j.erro = ''; j.aviso = '';
    const nf = nfNum(extra(it).nf), pedido = nfNum(it[0]);
    const dataOcorrencia = OC().lerData(j.data, new Date());
    if (!dataOcorrencia) { j.erro = 'A data não foi entendida. Escreva assim: 24/11/2026.'; return desenhar(); }
    if (!j.detalhes.trim()) { j.erro = 'Escreva o motivo do atraso (observação).'; return desenhar(); }
    let dataSolucao = '';
    if (j.dataSolucao.trim()) { dataSolucao = OC().lerData(j.dataSolucao, new Date()); if (!dataSolucao) { j.erro = 'Não entendi a data da solução. Escreva assim: 24/11/2026.'; return desenhar(); } }
    j.salvando = true; desenhar();
    try {
      const r = await fetch(comChave('/api/ocorrencias'), { method: 'POST', credentials: 'same-origin', headers: CAB_POST, body: JSON.stringify({ acao: 'salvar', linha: { id: j.id || undefined, nf, pedido, dataOcorrencia, detalhes: j.detalhes, responsavel: j.responsavel, solucao: j.solucao, dataSolucao } }) });
      const resp = await r.json().catch(() => ({}));
      if (r.status === 401 || r.status === 403) { await carregarSessao(); throw new Error(chaveLink ? 'O link não vale mais. Peça um link novo ao administrador.' : 'Sem acesso para registrar. Entre com usuário e senha de quem tem o acesso "Ocorrências".'); }
      if (!r.ok) throw new Error(resp.error || 'Não consegui salvar.');
      estado.data.ocorrencias = (resp.linhas || []).map((l) => ({ nf: l.nf, pedido: l.pedido || '', dataOcorrencia: l.dataOcorrencia, detalhes: l.detalhes, responsavel: l.responsavel, solucao: l.solucao, dataSolucao: l.dataSolucao, id: l.id }));
      ultimaSaidas = JSON.stringify([estado.data.saidas || {}, estado.data.ocorrencias]);
      estado.p = preparar(estado.data);
      estado.just = justVazia(j.k, { aviso: j.id ? 'Alteração salva.' : 'Ocorrência registrada.' });
      try { root.dispatchEvent(new root.Event('sc9-ocorrencias-mudou')); } catch (e) { /* painel do fim da página não carregou */ }
    } catch (e) { j.erro = e.message; }
    j.salvando = false; desenhar();
  }
  function formularioDeJustificativa(it, k) {
    const lista = ocorrenciasDoPedido(estado.p, it);
    const j = estado.just && estado.just.k === k ? estado.just : null;
    const pode = Boolean((estado.sessao && estado.sessao.pode) || chaveLink); // o link do histórico também registra e edita
    const campo = (rot, id, chave, opc) => h('label', { class: 'campo' + ((opc && opc.larga) ? ' larga' : '') }, h('span', { text: rot }),
      opc && opc.area ? h('textarea', { id, rows: 2, placeholder: opc.dica || '', oninput: (ev) => { j[chave] = ev.target.value; } }, j[chave])
        : h('input', { id, value: j[chave], placeholder: (opc && opc.dica) || '', oninput: (ev) => { j[chave] = ev.target.value; } }));
    const itens = lista.map((oc) => {
      const av = OC().avaliar(oc, { pedido: String(it[0]), liberadoEm: it[2] || '', despachadoEm: entregaDe(estado.p.entregues, it[0]) }, it[9] || '', new Date());
      return h('li', null, h('span', { class: 'tag oc-' + av.nivel, text: av.status }), ' ', h('b', { text: OC().mostrarData(oc.dataOcorrencia) }), ' · ', oc.detalhes || '(sem detalhes)', oc.responsavel ? ' · ' + oc.responsavel : '', oc.solucao ? ' · Solução: ' + oc.solucao + (oc.dataSolucao ? ' (' + OC().mostrarData(oc.dataSolucao) + ')' : '') : '',
        pode ? [' ', h('button', { class: 'btn peq', type: 'button', onclick: (ev) => { ev.stopPropagation(); estado.just = justVazia(k, { id: oc.id || '', data: OC().mostrarData(oc.dataOcorrencia), detalhes: oc.detalhes, responsavel: oc.responsavel, solucao: oc.solucao, dataSolucao: OC().mostrarData(oc.dataSolucao) }); desenhar(); setTimeout(() => { const e = document.getElementById('just-detalhes'); if (e) e.focus({ preventScroll: true }); }, 60); } }, 'Editar')] : null);
    });
    const caixa = h('div', { class: 'just', id: 'just-' + k.replace(/\W/g, '_'), onclick: (ev) => ev.stopPropagation() },
      h('h3', { text: 'Por que este pedido está atrasado? (ocorrência)' }),
      lista.length ? h('ul', { class: 'just-lista' }, itens) : h('p', { class: 'mudo peq', text: 'Nenhuma ocorrência registrada para este pedido' + (extra(it).nf ? ' (nota ' + extra(it).nf + ')' : ' (ainda sem nota fiscal)') + '. Registre o motivo para explicar o atraso (por exemplo cliente pediu para segurar, endereço, cadastro).' }));
    if (!j) {
      caixa.appendChild(h('button', { class: 'btn primario', type: 'button', onclick: () => abrirJustificativa(it, k), text: lista.length ? '+ Nova ocorrência' : 'Justificar atraso' }));
      return caixa;
    }
    if (j.aviso) caixa.appendChild(h('p', { class: 'aviso', role: 'status', text: j.aviso }));
    if (!estado.sessao) { caixa.appendChild(h('p', { class: 'mudo peq', text: 'Carregando…' })); return caixa; }
    if (!pode) {
      const l = estado.login;
      caixa.appendChild(h('p', { class: 'mudo peq', text: estado.sessao.authed ? 'Seu usuário não tem o acesso "Ocorrências". Peça ao administrador para liberar, ou entre com outro usuário.' : 'Quem registra entra com usuário e senha (os mesmos do SC9). O administrador deixa o usuário vazio.' }));
      caixa.appendChild(h('form', { class: 'just-form', onsubmit: (ev) => { ev.preventDefault(); entrarParaJustificar(); } },
        h('label', { class: 'campo' }, h('span', { text: 'Usuário' }), h('input', { id: 'just-usuario', value: l.usuario, autocomplete: 'username', oninput: (ev) => { l.usuario = ev.target.value; } })),
        h('label', { class: 'campo' }, h('span', { text: 'Senha' }), h('input', { id: 'just-senha', type: 'password', value: l.senha, autocomplete: 'current-password', oninput: (ev) => { l.senha = ev.target.value; } })),
        h('button', { class: 'btn primario', type: 'submit', disabled: l.entrando, text: l.entrando ? 'Entrando…' : 'Entrar para registrar' })));
      if (l.erro) caixa.appendChild(h('p', { class: 'erro', role: 'alert', text: l.erro }));
      return caixa;
    }
    caixa.appendChild(h('div', { class: 'just-form' },
      campo('Data da ocorrência', 'just-data', 'data', { dica: 'dd/mm/aaaa' }),
      campo('Motivo do atraso (observação) *', 'just-detalhes', 'detalhes', { area: true, larga: true, dica: 'ex.: cliente pediu para segurar a entrega' }),
      campo('Responsável (quem resolve)', 'just-resp', 'responsavel', { dica: 'ex.: Juliana' }),
      campo('Solução', 'just-solucao', 'solucao', { dica: 'deixe vazio se ainda não resolveu' }),
      campo('Data da solução', 'just-datasol', 'dataSolucao', { dica: 'dd/mm/aaaa' })));
    caixa.appendChild(h('div', { class: 'acoes-just' },
      h('button', { class: 'btn primario', type: 'button', disabled: j.salvando, onclick: () => salvarJustificativa(it), text: j.salvando ? 'Salvando…' : j.id ? 'Salvar alteração' : 'Registrar ocorrência' }),
      j.id ? h('button', { class: 'btn', type: 'button', onclick: () => { estado.just = justVazia(k); desenhar(); }, text: 'Cancelar edição' }) : null,
      estado.sessao.pode ? [h('span', { class: 'mudo peq', text: 'Entrou como ' + (estado.sessao.nome || 'usuário') + ' · ' }), h('button', { class: 'btn peq', type: 'button', onclick: sairDaConta, text: 'Sair' })] : h('span', { class: 'mudo peq', text: 'Registrando pelo link do histórico' })));
    if (j.erro) caixa.appendChild(h('p', { class: 'erro', role: 'alert', text: j.erro }));
    return caixa;
  }

  // Célula "Ocorrência (expedição)" da tabela, com o botão de justificar o atraso.
  function celulaOcorrencia(v, it, k) {
    const botao = v.st.tipo !== 'desp' ? h('button', { class: 'btn peq', type: 'button', title: 'Escrever o motivo deste pedido estar atrasado (ocorrência), por exemplo cliente, endereço ou cadastro', onclick: (ev) => { ev.stopPropagation(); abrirJustificativa(it, k); } }, v.ocor ? '+ Ocorrência' : 'Justificar atraso') : null;
    return h('div', null, celulaOcorrenciaTexto(v, it), botao);
  }
  function celulaOcorrenciaTexto(v, it) {
    if (!v.ocor) return h('span', { class: it[6] >= 5 && v.st.tipo !== 'desp' ? 'peq forte' : 'mudo peq', text: it[6] >= 5 && v.st.tipo !== 'desp' ? 'sem registro' : '—' });
    const o = v.ocor;
    return h('div', null, h('span', { class: 'tag oc-' + o.av.nivel, text: o.av.status }), h('div', { class: 'mudo peq', text: (o.oc.responsavel || 'sem responsável') + (o.total > 1 ? ' · +' + (o.total - 1) : '') }));
  }

  // "O que fazer agora": pedidos da foto agrupados pelo próximo passo; clicar mostra só esses pedidos na lista.
  function painelDeAcoes(a) {
    const pr = prioridades(estado.p, a.reg.itens, a.reg.dia, new Date());
    if (!pr.grupos.length && !pr.despachados) return null;
    const ir = (filtro) => () => { estado.aba = 'atraso'; estado.aberto = ''; estado.limite = 100; estado.filtro = Object.assign(FILTRO_VAZIO(), filtro); desenhar(); const alvo = document.getElementById('f-busca'); if (alvo) alvo.scrollIntoView({ block: 'center' }); };
    return h('section', { class: 'acoes-agora', 'aria-label': 'O que fazer agora' },
      h('h3', { text: 'O que fazer agora' }),
      h('p', { class: 'mudo peq', text: 'Os pedidos desta foto agrupados pelo próximo passo (considera a ocorrência registrada pela expedição). Clique para ver só esses pedidos na lista.' }),
      h('div', { class: 'grupos' },
        pr.grupos.map((g) => h('button', { class: 'grupo' + (g.cod === 'ocorrencia' || g.cod === 'fechar' ? ' ruim' : ''), type: 'button', onclick: ir({ acao: g.cod }) },
          h('b', { text: fmtN(g.qtd) }), ' ' + g.titulo + ' · ' + fmtN(g.pecas) + ' peças', g.antigos ? h('span', { class: 'forte', text: ' · ' + fmtN(g.antigos) + ' com 5+ dias' }) : null)),
        pr.semOcorrencia.qtd ? h('button', { class: 'grupo', type: 'button', onclick: ir({ ocorr: 'sem5' }) }, h('b', { text: fmtN(pr.semOcorrencia.qtd) }), ' atrasados há 5+ dias sem ocorrência registrada: a expedição precisa informar o motivo na aba Ocorrências do SC9') : null,
        pr.despachados ? h('span', { class: 'mudo peq', text: fmtN(pr.despachados) + (pr.despachados === 1 ? ' pedido desta foto já foi despachado (nada a fazer).' : ' pedidos desta foto já foram despachados (nada a fazer).') }) : null));
  }

  const hora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '—');

  function opcoes(itens, i) { return [...new Set(itens.map((it) => it[i] || '').filter(Boolean))].sort((x, y) => String(x).localeCompare(String(y), 'pt-BR', { numeric: true })); }

  const somaValor = (itens) => itens.reduce((t, it) => t + (extra(it).v || 0), 0);

  function listaDePedidos(a) {
    const cmp = a.cmp;
    const abas = [{ id: 'atraso', nome: 'Em atraso', itens: a.reg.itens, dica: 'Todos os pedidos em atraso neste dia.' }];
    if (cmp) {
      abas.push({ id: 'novos', nome: 'Entraram', itens: cmp.novos, dica: 'Não estavam em atraso na foto anterior.' });
      abas.push({ id: 'saiu', nome: 'Saíram do atraso', itens: cmp.saiu, dica: 'Estavam em atraso na foto anterior e não estão mais (despachados, faturados ou regularizados).' });
    }
    if (!abas.some((x) => x.id === estado.aba)) estado.aba = 'atraso';
    const aba = abas.find((x) => x.id === estado.aba);
    const f = estado.filtro;
    const ctx = { p: estado.p, dia: a.reg.dia, agora: new Date() };
    const lista = filtrar(aba.itens, f, estado.p.entregues, ctx);
    const desp = aba.itens.filter((it) => entregaDe(estado.p.entregues, it[0])).length;
    const pecas = lista.reduce((s, it) => s + it[3], 0);
    const mostrados = lista.slice(0, estado.limite);

    const sel = (id, rotulo, valores, mapa) => h('label', { class: 'campo' }, h('span', { text: rotulo }),
      h('select', { id: 'f-' + id, onchange: (ev) => { f[id] = ev.target.value; estado.limite = 100; desenhar(); } }, h('option', { value: '', text: 'Todos' }), valores.map((v) => h('option', { value: v, selected: f[id] === v, text: mapa ? mapa[v] : v }))));

    const cabecas = [['pedido', 'Pedido'], ['cliente', 'Cliente'], ['arm', 'Armazém'], ['lib', 'Liberado em'], ['pecas', 'Peças'], ['tipo', 'Tipo'], ['sit', 'Situação'], ['dias', 'Dias de atraso'], ['transp', 'Transportadora']];
    const tabela = h('table', { class: 'tab pedidos' },
      h('thead', null, h('tr', null,
        cabecas.slice(0, 2).concat([['_oc', 'Ocorrência (expedição)'], ['_acao', 'O que fazer']]).concat(cabecas.slice(2)).map(([id, nome]) => id.startsWith('_') ? h('th', { title: id === '_oc' ? 'Problema registrado pela expedição na aba Ocorrências do SC9 (ligado pela nota fiscal)' : 'Próximo passo sugerido para este pedido', text: nome }) : h('th', { class: id === 'pecas' || id === 'dias' ? 'num' : '', 'aria-sort': f.ordem === id ? (f.desc ? 'descending' : 'ascending') : 'none' },
          h('button', { class: 'ord', id: 'ord-' + id, onclick: () => { if (f.ordem === id) f.desc = !f.desc; else { f.ordem = id; f.desc = id === 'dias' || id === 'pecas'; } desenhar(); }, text: nome + (f.ordem === id ? (f.desc ? ' ▼' : ' ▲') : '') }))),
        h('th', { text: 'Status do pedido' }),
        aba.id === 'novos' ? null : h('th', { text: aba.id === 'saiu' ? 'Estava em' : 'Mudou' }))),
      h('tbody', null, mostrados.map((it) => linhaDoPedido(a, it, aba))));

    return h('div', { class: 'pedidos-bloco' },
      h('div', { class: 'abas', role: 'tablist' }, abas.map((x) => h('button', { class: 'aba' + (x.id === estado.aba ? ' ativa' : ''), id: 'aba-' + x.id, role: 'tab', 'aria-selected': x.id === estado.aba, title: x.dica, onclick: () => { estado.aba = x.id; estado.aberto = ''; estado.limite = 100; estado.filtro = FILTRO_VAZIO(); desenhar(); }, text: x.nome + ' (' + fmtN(x.itens.length) + ')' }))),
      h('p', { class: 'mudo peq', text: aba.dica + ' Clique em um pedido para ver todos os dados dele.' }),
      h('div', { class: 'filtros' },
        h('label', { class: 'campo busca' }, h('span', { text: 'Buscar pedido, cliente, nota ou transportadora' }), h('input', { type: 'search', id: 'f-busca', value: f.busca, placeholder: 'Pedido, cliente ou nota fiscal…', oninput: (ev) => { f.busca = ev.target.value; estado.limite = 100; const pos = ev.target.selectionStart; desenhar(); const novo = document.querySelector('.filtros input[type=search]'); if (novo) { novo.focus(); novo.setSelectionRange(pos, pos); } } })),
        sel('etapa', 'Etapa em que parou', ['S', 'C', 'F', 'D'], { S: 'Separação', C: 'Conferência', F: 'Faturamento (falta a nota)', D: 'Despacho (tem nota)' }), sel('status', 'Status do pedido', ['desp', 'nao'], { desp: 'Despachados', nao: 'Sem despacho registrado' }), sel('tipo', 'Tipo', ['E', 'F'], TIPO), sel('sit', 'Situação', ['A', 'P'], SIT), sel('arm', 'Armazém', opcoes(aba.itens, 1)), sel('transp', 'Transportadora', opcoes(aba.itens, 7)),
        sel('acao', 'O que fazer', ORDEM_ACAO, TITULO_ACAO_MAIUSCULO), sel('ocorr', 'Ocorrência', ['aberta', 'com', 'sem', 'sem5'], { aberta: 'Com ocorrência aberta', com: 'Com ocorrência registrada', sem: 'Sem ocorrência', sem5: 'Sem ocorrência e 5+ dias de atraso' }),
        h('button', { class: 'btn', id: 'f-limpar', onclick: () => { estado.filtro = FILTRO_VAZIO(); desenhar(); }, text: 'Limpar filtros' }),
        h('button', { class: 'btn', disabled: !lista.length, onclick: () => baixarCsv(lista, aba.nome, aba.id), text: 'Baixar lista (CSV)' })),
      resumoDeStatus(aba, desp),
      h('p', { class: 'mudo peq' }, 'Cores: "Dias de atraso" vermelho = 5 dias ou mais · ocorrência vermelha = aberta há 3 dias ou mais.', h('span', { class: 'so-desk', text: ' Clique no título da coluna para ordenar.' })),
      h('p', { class: 'contagem', 'aria-live': 'polite', text: 'Mostrando ' + fmtN(Math.min(mostrados.length, lista.length)) + ' de ' + fmtN(lista.length) + ' pedidos · ' + fmtN(pecas) + ' peças' + (f.diasMin ? ' · só com ' + f.diasMin + ' ou mais dias de atraso' : '') + (f.acao && String(f.acao).includes(',') ? ' · só os que aguardam despacho' : '') }),
      lista.length ? h('div', { class: 'rolagem' }, tabela) : h('p', { class: 'vazio-msg', text: aba.itens.length ? 'Nenhum pedido com esses filtros.' : 'Nenhum pedido nesta lista.' }),
      lista.length > estado.limite ? h('button', { class: 'btn primario', onclick: () => { estado.limite += 200; desenhar(); }, text: 'Mostrar mais ' + Math.min(200, lista.length - estado.limite) }) : null);
  }

  function resumoDeStatus(aba, desp) {
    const total = aba.itens.length;
    if (!total) return null;
    if (aba.id === 'saiu') return h('p', { class: 'resumo-status', text: 'Dos ' + fmtN(total) + (total === 1 ? ' pedido que saiu' : ' pedidos que saíram') + ' do atraso, ' + fmtN(desp) + (desp === 1 ? ' foi despachado' : ' foram despachados') + ' (planilha de Entrega) e ' + fmtN(total - desp) + ' saíram sem despacho registrado (faturados ou regularizados).' });
    return desp ? h('p', { class: 'resumo-status', text: fmtN(desp) + (desp === 1 ? ' pedido desta lista já foi despachado' : ' pedidos desta lista já foram despachados') + ' depois da foto (planilha de Entrega).' }) : null;
  }

  function status(a, it, aba) {
    if (aba.id === 'saiu') return a.cmp ? 'Atraso em ' + ddmm(a.cmp.ant.dia) : '';
    if (!a.cmp) return '—';
    const k = chave(it);
    if (!a.cmp.antes.has(k)) return 'Entrou';
    return a.cmp.antes.get(k)[4] !== it[4] ? 'Estoque → Faturamento' : 'Continua';
  }

  function linhaDoPedido(a, it, aba) {
    const k = aba.id + '|' + chave(it), aberto = estado.aberto === k, st = statusDoPedido(estado.p.entregues, it, a.reg.dia, aba.id);
    const v = Object.assign(avaliarPedido(estado.p, it, a.reg.dia, new Date()), { st });
    const tr = h('tr', { class: 'clicavel' + (aberto ? ' sel' : ''), tabindex: '0', 'aria-expanded': aberto, onclick: () => { estado.aberto = aberto ? '' : k; desenhar(); }, onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); tr.click(); } } },
      h('td', { class: 'ped', text: it[0] }), h('td', { class: 'cli', 'data-l': 'Cliente', title: extra(it).n || '', text: extra(it).n || '—' }), h('td', { 'data-l': 'Ocorrência' }, celulaOcorrencia(v, it, k)), h('td', { class: 'acao', 'data-l': 'O que fazer', text: v.acao.texto }), h('td', { 'data-l': 'Armazém', text: it[1] || '—' }), h('td', { 'data-l': 'Liberado em', text: it[2] ? ddmmaaaa(it[2]) : '—' }), h('td', { class: 'num', 'data-l': 'Peças', text: fmtN(it[3]) }),
      h('td', { 'data-l': 'Tipo' }, h('span', { class: 'tag ' + (it[4] === 'F' ? 'fat' : 'est'), title: it[10] ? 'O SC9 marcou como estoque, mas o pedido foi achado na Saída p/ Expedição: contado como faturamento (falta a nota).' : '', text: TIPO[it[4]] + (it[10] ? ' (saída)' : '') })), h('td', { 'data-l': 'Situação' }, h('span', { class: 'tag ' + (it[5] === 'A' ? 'atr' : 'proc'), text: SIT[it[5]] })),
      h('td', { class: 'num' + (it[6] >= 5 ? ' forte' : ''), 'data-l': 'Dias de atraso', text: fmtN(it[6]) }), h('td', { 'data-l': 'Transportadora', text: it[7] || '—' }), h('td', { 'data-l': 'Status' }, h('span', { class: 'tag ' + st.tipo, text: st.texto })), aba.id === 'novos' ? null : h('td', { 'data-l': aba.id === 'saiu' ? 'Estava em' : 'Mudou', text: status(a, it, aba) }));
    if (!aberto) return tr;
    const p = estado.p, seq = sequencia(p, chave(it), a.reg.dia), dias = p.historico.get(chave(it)) || [];
    const campo = (t, v) => h('div', { class: 'cd' }, h('span', { text: t }), h('b', { text: v }));
    const det = h('tr', { class: 'detalhe' }, h('td', { colspan: 13, class: 'det-td' },
      h('div', { class: 'det-grid' },
        campo('Pedido', it[0]), campo('Cliente', extra(it).n ? extra(it).n + (extra(it).c ? ' (cód. ' + extra(it).c + ')' : '') : '—'), campo('Armazém', it[1] || '—'), campo('Transportadora', it[7] || '—'),
        campo('Nota fiscal', extra(it).nf || 'ainda sem nota'), campo('Valor da nota', extra(it).v ? brl(extra(it).v) : '—'), campo('Linhas do pedido', extra(it).l ? fmtN(extra(it).l) : '—'),
        campo('Etapa em que parou', ETAPA[extra(it).e] || '—'), campo('Separador', extra(it).sp || '—'), campo('Conferente', extra(it).cf || '—'),
        campo('Fim da separação', hora(extra(it).pe)), campo('Fim da conferência', hora(extra(it).ce)), campo('Faturado em', hora(extra(it).fa)),
        campo('Parado nessa etapa há', paradoDesde(it) && a.reg.atualizadoEm ? duracao(paradoDesde(it), a.reg.atualizadoEm) || '—' : '—'), campo('Liberado em', it[2] ? ddmmaaaa(it[2]) + ' (' + semana(it[2], 'short').replace('.', '') + ')' : '—'),
        campo('Peças', fmtN(it[3])), campo('Dias de atraso', fmtN(it[6])),
        campo('Tipo de atraso', it[10] ? 'Faturamento (reclassificado): o SC9 marcava estoque, mas o pedido está na Saída p/ Expedição; falta a nota fiscal' : it[4] === 'F' ? 'Faturamento: já conferido, falta a nota fiscal' : 'Estoque: ainda em separação/conferência, ou já tem nota e falta despachar'),
        campo('Situação', it[5] === 'A' ? 'Atrasado: passou do prazo' : 'Em processo: andando dentro do atraso'),
        campo('Status do pedido', st.tipo === 'exp' ? 'Está na Saída p/ Expedição (' + st.texto.replace('Saída p/ expedição em ', '') + '); ainda sem despacho na planilha de Entrega' : st.tipo === 'desp' ? 'Despachado em ' + ddmmaaaa(st.em) + (aba.id !== 'saiu' && st.em > a.reg.dia ? ' (estava em atraso nesta foto)' : '') : st.tipo === 'saiu' ? 'Saiu do atraso; não há despacho registrado na planilha de Entrega' : 'Em atraso; sem despacho registrado'),
        campo('O que fazer', v.acao.texto),
        campo('Ocorrência da expedição', v.ocor ? v.ocor.av.status + ' (' + fmtN(v.ocor.av.dias) + (v.ocor.av.dias === 1 ? ' dia' : ' dias') + ')' + (v.ocor.total > 1 ? ' · mais ' + (v.ocor.total - 1) + ' na mesma nota' : '') : 'nenhuma registrada para esta nota'),
        v.ocor ? campo('Detalhes da ocorrência', v.ocor.oc.detalhes || '—') : null, v.ocor ? campo('Responsável', v.ocor.oc.responsavel || 'não informado') : null,
        v.ocor ? campo('Solução', (v.ocor.oc.solucao || 'sem solução ainda') + (v.ocor.oc.dataSolucao ? ' (' + ddmmaaaa(v.ocor.oc.dataSolucao) + ')' : '')) : null,
        campo('Comparado ao dia anterior', status(a, it, { id: 'atraso' }) || '—'),
        campo('Dias seguidos em atraso', seq.n ? seq.n + (seq.n === 1 ? ' dia' : ' dias') + ' (desde ' + ddmm(seq.desde) + ')' : aba.id === 'saiu' ? 'saiu do atraso nesta foto (estava na anterior)' : 'não estava em atraso neste dia')),
      formularioDeJustificativa(it, k),
      dias.length ? h('div', { class: 'linha-tempo' }, h('span', { class: 'mudo', text: 'Dias gravados em que apareceu em atraso: ' }), dias.map((d) => h('button', { class: 'chip' + (d === a.reg.dia ? ' ativo' : ''), onclick: (ev) => { ev.stopPropagation(); escolherDia(d); }, text: ddmm(d) }))) : null));
    return [tr, det];
  }

  function baixarCsv(lista, nome, abaId) {
    const blob = new Blob([csv(lista, estado.p.entregues, estado.dia, abaId, { p: estado.p, agora: new Date() })], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'historico-atraso-' + estado.dia + '-' + nome.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.csv' });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Painel executivo (?painel=1): arquivos atraso-painel.js e atraso-painel-ui.js. Fica acima do conteúdo de sempre; nada foi removido.
  // O painel é o padrão no link de sempre; ?painel=0 mostra só a página antiga (que continua inteira abaixo do painel).
  const painelLigado = new URLSearchParams(location.search).get('painel') !== '0';
  const urlComPainel = (v) => { const u = new URL(location.href); u.searchParams.set('painel', v); return u.pathname + u.search + u.hash; };
  function painelExecutivo() { return painelLigado && root.SC9AtrasoPainelUI && estado.p ? root.SC9AtrasoPainelUI.montar() : null; }
  function irParaLista(filtro) {
    estado.aba = 'atraso'; estado.aberto = ''; estado.limite = 100;
    estado.filtro = Object.assign(FILTRO_VAZIO(), filtro || {});
    desenhar();
    const alvo = document.getElementById('f-busca'); if (alvo) alvo.scrollIntoView({ block: 'center' });
  }
  root.SC9HistAtrasoTela = { get estado() { return estado; }, escolherDia, irParaLista, desenhar: () => desenhar(), temDia: (d) => Boolean(estado.p && estado.p.porDia.has(d)) };

  function desenhar() {
    const y = root.scrollY;
    const foco = document.activeElement && document.activeElement.id ? document.activeElement.id : '';
    const vazio = !estado.p.porDia.size && !Object.keys(estado.p.exp).length;
    const blocos = vazio ? [h('section', { class: 'cartao centro' }, h('h2', { text: 'Ainda não há histórico gravado' }), h('p', { class: 'mudo', text: 'No SC9, abra o painel e use o botão "Histórico de Atraso" (ao lado do Relatório Geral). Cada vez que o atraso é exportado, a foto do dia fica guardada aqui.' }))]
      : [painelExecutivo(), faixaDeDias(), detalheDoDia(), graficos(), tabelaDoMes()];
    $app.replaceChildren(cabecalho(), ...blocos.filter(Boolean));
    montarOcorrencias();
    root.scrollTo(0, y);
    if (foco) { const e = document.getElementById(foco); if (e && e.focus) e.focus({ preventScroll: true }); }
  }

  // Ocorrências da expedição dentro da própria página: todo mundo lê e analisa (o link libera a leitura); para registrar, a pessoa da
  // expedição entra com usuário e senha no próprio painel. O painel fica fora da parte redesenhada, então não perde o que foi digitado.
  let ocorrenciasMontadas = false;
  function montarOcorrencias() {
    if (ocorrenciasMontadas) return;
    const caixa = document.getElementById('ocorrencias-box'), Painel = root.SC9Ocorrencias && root.SC9Ocorrencias.Panel;
    if (!caixa || !Painel || !root.React || !root.ReactDOM || !root.ReactDOM.createRoot) return;
    ocorrenciasMontadas = true;
    caixa.style.display = 'block';
    root.ReactDOM.createRoot(caixa).render(root.React.createElement(Painel, { embedded: true, chaveLink }));
    root.addEventListener('sc9-ocorrencias', () => { atualizarSaidas(); });
  }

  // Tempo real: a cada 30 s (com a aba aberta) cruza de novo os pedidos com a Saída p/ Expedição e só redesenha se algo mudou.
  // As fotos de atraso e os despachados da Entrega não mudam aqui: só quando o atraso é exportado no SC9.
  let ultimaSaidas = null;
  async function atualizarSaidas() {
    if (!estado.p || document.hidden) return;
    try {
      const r = await fetch(comChave('/api/atraso-historico?meses=24&so=saidas'), { cache: 'no-store', credentials: 'same-origin' });
      if (!r.ok) return;
      const resp = await r.json();
      const novas = resp.saidas || {}, ocs = resp.ocorrencias || estado.data.ocorrencias || [];
      const chave = JSON.stringify([novas, ocs]);
      if (ultimaSaidas === null) ultimaSaidas = JSON.stringify([estado.data.saidas || {}, estado.data.ocorrencias || []]);
      if (chave === ultimaSaidas) return;
      ultimaSaidas = chave;
      estado.data.saidas = novas;
      estado.data.ocorrencias = ocs;
      estado.p = preparar(estado.data);
      desenhar();
    } catch (e) { /* sem rede: tenta de novo no próximo ciclo */ }
  }
  setInterval(atualizarSaidas, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizarSaidas(); });

  window.addEventListener('hashchange', () => { const d = (location.hash || '').replace('#', ''); if (estado.p && d !== estado.dia && (estado.p.porDia.has(d) || estado.p.exp[d])) { estado.dia = d; estado.mes = d.slice(0, 7); desenhar(); } });
  carregar();
})(typeof window === 'object' ? window : globalThis);
