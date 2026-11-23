/* Página "Histórico de Atraso" (link fixo /historico-atraso.html).
 * Mostra, dia a dia, a foto dos pedidos em atraso que o SC9 grava ao exportar o Histórico de Atraso (estoque e faturamento),
 * o comparativo com o dia anterior e quantos pedidos/peças foram despachados em cada dia (Saída p/ Expedição).
 * Linha de pedido: [pedido, armazém, liberadoEm, peças, 'E'|'F', 'A'|'P', diasDeAtraso, transportadora].
 * A parte de cálculo (preparar, filtrar, csv...) é pura e testada no Node; a tela só roda no navegador. */
(function (root) {
  'use strict';

  const X = () => root.SC9AtrasoHistoricoXlsx || require('./atraso-historico-xlsx.js');
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
  // Junta as fotos de atraso e o despacho por dia numa estrutura só.
  function preparar(data) {
    const analises = X().analisar((data && data.meses) || {});
    const exp = {};
    for (const m of Object.values((data && data.expedicao) || {})) Object.assign(exp, m);
    const dias = new Set(analises.map((a) => a.reg.dia));
    Object.keys(exp).forEach((d) => dias.add(d));
    const meses = [...new Set([...dias].map((d) => d.slice(0, 7)))].sort().reverse();
    const porDia = new Map(analises.map((a) => [a.reg.dia, a]));
    const historico = new Map(); // pedido → dias (fotos) em que estava em atraso
    for (const a of analises) for (const it of a.reg.itens) { const k = chave(it); if (!historico.has(k)) historico.set(k, []); historico.get(k).push(a.reg.dia); }
    const diasExp = Object.keys(exp).sort();
    return { analises, porDia, exp, meses, historico, diasExp };
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
    transp: (a, b) => String(a[7]).localeCompare(String(b[7]), 'pt-BR', { numeric: true })
  };

  // f = { tipo:'E'|'F'|'', sit:'A'|'P'|'', arm:'', transp:'', busca:'', ordem:'dias', desc:true }
  function filtrar(itens, f) {
    const busca = String((f && f.busca) || '').trim().toLowerCase();
    let lista = itens.filter((it) =>
      (!f.tipo || it[4] === f.tipo) && (!f.sit || it[5] === f.sit) && (!f.arm || it[1] === f.arm) && (!f.transp || (it[7] || '') === f.transp)
      && (!busca || String(it[0]).toLowerCase().includes(busca) || String(it[7] || '').toLowerCase().includes(busca)));
    const cmp = ORDEM[f.ordem] || ORDEM.dias;
    lista = lista.slice().sort((a, b) => (f.desc ? -1 : 1) * cmp(a, b) || ORDEM.pedido(a, b));
    return lista;
  }

  const TIPO = { E: 'Estoque', F: 'Faturamento' };
  const SIT = { A: 'Atrasado', P: 'Em processo' };

  // CSV (separador ";", com BOM para o Excel abrir com acento) da lista que está na tela.
  function csv(itens) {
    const cel = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const linhas = [['Pedido', 'Armazém', 'Liberado em', 'Peças', 'Tipo', 'Situação', 'Dias de atraso', 'Transportadora']];
    for (const it of itens) linhas.push([it[0], it[1], it[2] ? ddmmaaaa(it[2]) : '', String(it[3]).replace('.', ','), TIPO[it[4]] || it[4], SIT[it[5]] || it[5], it[6], it[7] || '']);
    return '﻿' + linhas.map((l) => l.map(cel).join(';')).join('\r\n');
  }

  const api = { preparar, sequencia, despacho, filtrar, csv, chave, rotuloMes, diasDoMes, ddmm, ddmmaaaa, fmtN, pct, TIPO, SIT };
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
  const estado = { data: null, p: null, mes: '', dia: '', aba: 'atraso', filtro: { tipo: '', sit: '', arm: '', transp: '', busca: '', ordem: 'dias', desc: true }, aberto: '', limite: 100, ajuda: true, aviso: '' };

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
    try { r = await fetch('/api/atraso-historico?meses=24', { cache: 'no-store', credentials: 'same-origin' }); }
    catch (e) { return telaErro('Não consegui falar com o servidor. Verifique a internet e tente de novo.'); }
    if (r.status === 401) return telaLogin('');
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
    $app.replaceChildren(h('div', { class: 'cartao centro' }, h('h2', { text: 'Não deu para abrir' }), h('p', { text: msg }), h('button', { class: 'btn primario', onclick: carregar, text: 'Tentar de novo' })));
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
    estado.filtro = { tipo: '', sit: '', arm: '', transp: '', busca: '', ordem: 'dias', desc: true };
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
        h('a', { class: 'btn', href: '/', text: 'Voltar ao SC9' })));
  }

  // Esta página só muda quando alguém exporta o Histórico de Atraso no SC9; mostra quando foi a última vez.
  function ultimaAtualizacao() {
    let ultimo = '';
    for (const a of estado.p.analises) if (a.reg.atualizadoEm && a.reg.atualizadoEm > ultimo) ultimo = a.reg.atualizadoEm;
    if (!ultimo) return 'Atualizada sempre que o Histórico de Atraso é exportado no SC9.';
    const q = new Date(ultimo);
    return 'Atualizada em ' + q.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' às ' + q.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) + ', na última exportação do Histórico de Atraso. Ela só muda quando o atraso é exportado de novo.';
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
    return h('section', { class: 'cartao', 'aria-label': 'Gráficos do mês' },
      h('h2', { text: 'O mês em números' }),
      h('p', { class: 'mudo', text: 'Cada barra é um dia (clique para destacar o dia; o número aparece na barra escolhida ou ao passar o mouse). Em atraso: quantos pedidos estavam atrasados na foto. Despachados: pedidos da planilha de Entrega com a data daquele dia.' }),
      h('div', { class: 'graficos' },
        barras('Pedidos em atraso por dia', 'Estoque + faturamento', atraso, '#c63828', (v) => fmtN(v)),
        barras('Pedidos despachados por dia', 'Pedidos da planilha de Entrega', desp, '#1f8a4c', (v) => fmtN(v)),
        barras('Peças despachadas por dia', 'Soma das peças desses pedidos', pecas, '#123b7a', (v) => (v >= 1000 ? (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : fmtN(v)))));
  }

  function tabelaDoMes() {
    const dias = diasDoMes(estado.mes).filter((d) => estado.p.porDia.has(d) || estado.p.exp[d]);
    if (!dias.length) return null;
    let sd = 0, sp = 0, nd = 0;
    const linhas = dias.map((d) => {
      const a = estado.p.porDia.get(d), ex = estado.p.exp[d];
      if (ex) { sd += ex.pedidos; sp += ex.pecas; nd++; }
      const ant = a && a.cmp ? a.cmp.resumoAnt.tot : null;
      return h('tr', { class: 'clicavel' + (d === estado.dia ? ' sel' : ''), onclick: () => escolherDia(d) },
        h('td', { class: 'ped', text: ddmm(d) + ' · ' + semana(d, 'short').replace('.', '') }),
        h('td', { class: 'num', 'data-l': 'Em atraso', text: a ? fmtN(a.resumo.tot) : '—' }),
        h('td', { class: 'num', 'data-l': 'Estoque', text: a ? fmtN(a.resumo.e) : '—' }),
        h('td', { class: 'num', 'data-l': 'Faturamento', text: a ? fmtN(a.resumo.f) : '—' }),
        h('td', { class: 'num', 'data-l': '% dos pedidos', text: a ? pct(a.resumo.tot, a.resumo.total) : '—' }),
        h('td', { class: 'num', 'data-l': 'Mudou vs dia anterior' }, a && ant != null ? seta(a.resumo.tot, ant, true) : (a ? h('span', { class: 'mudo', text: 'primeiro dia' }) : '—')),
        h('td', { class: 'num', 'data-l': 'Pedidos despachados', text: ex ? fmtN(ex.pedidos) : '—' }),
        h('td', { class: 'num', 'data-l': 'Peças despachadas', text: ex ? fmtN(ex.pecas) : '—' }));
    });
    return h('section', { class: 'cartao', 'aria-label': 'Dia a dia do mês' },
      h('h2', { text: 'Dia a dia de ' + rotuloMes(estado.mes) }),
      h('p', { class: 'mudo', text: 'Todos os dias do mês em uma tabela. Clique na linha para abrir os pedidos do dia.' }),
      h('div', { class: 'rolagem' }, h('table', { class: 'tab mes' },
        h('thead', null, h('tr', null, ['Dia', 'Em atraso', 'Estoque', 'Faturamento', '% dos pedidos', 'Mudou vs dia anterior', 'Pedidos despachados', 'Peças despachadas'].map((t, i) => h('th', { class: i ? 'num' : '', text: t })))),
        h('tbody', null, linhas),
        nd ? h('tfoot', null, h('tr', null, h('td', { text: 'Total do mês' }), h('td', { colspan: 5, class: 'mudo', text: nd + (nd === 1 ? ' dia com despacho' : ' dias com despacho') + ' · média de ' + fmtN(sd / nd) + ' pedidos e ' + fmtN(sp / nd) + ' peças por dia' }), h('td', { class: 'num', text: fmtN(sd) }), h('td', { class: 'num', text: fmtN(sp) }))) : null)));
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
      h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(location.origin + location.pathname + '#' + dia); estado.aviso = 'Link do dia copiado.'; } catch (e) { estado.aviso = 'Não consegui copiar sozinho. Copie o endereço que está na barra do navegador.'; } desenhar(); }, text: 'Copiar link deste dia' })));
    if (estado.aviso) { caixa.appendChild(h('p', { class: 'aviso', role: 'status', text: estado.aviso })); estado.aviso = ''; }
    if (a) caixa.appendChild(h('p', { class: 'frase ' + (a.cmp ? (a.resumo.tot < a.cmp.resumoAnt.tot ? 'bom' : a.resumo.tot > a.cmp.resumoAnt.tot ? 'ruim' : '') : ''), text: X().frase(a) }));
    const r = a ? a.resumo : null, ra = a && a.cmp ? a.cmp.resumoAnt : null;
    const refTxt = a && a.cmp ? ' vs ' + ddmm(a.cmp.ant.dia) : '';
    const kpis = h('div', { class: 'kpis' });
    if (r) {
      kpis.append(
        cartaoKpi('Em atraso', fmtN(r.tot), pct(r.tot, r.total) + ' dos ' + fmtN(r.total) + ' pedidos', ra ? h('span', { class: 'ks' }, seta(r.tot, ra.tot, true), refTxt) : null, 'atraso', 'Pedidos em atraso na foto deste dia (estoque + faturamento).'),
        cartaoKpi('Atraso de estoque', fmtN(r.e), pct(r.e, r.total) + ' · ' + fmtN(r.ep) + ' peças', ra ? h('span', { class: 'ks' }, seta(r.e, ra.e, true), refTxt) : null, '', 'Pedidos que ainda estão em separação/conferência e passaram do prazo.'),
        cartaoKpi('Atraso de faturamento', fmtN(r.f), pct(r.f, r.total) + ' · ' + fmtN(r.fp) + ' peças', ra ? h('span', { class: 'ks' }, seta(r.f, ra.f, true), refTxt) : null, '', 'Pedidos já conferidos, só faltando a nota fiscal.'),
        cartaoKpi('Peças em atraso', fmtN(r.pecas), 'estoque + faturamento', ra ? h('span', { class: 'ks' }, seta(r.pecas, ra.pecas, true), refTxt) : null, '', 'Soma das peças dos pedidos em atraso.'));
    }
    kpis.append(
      cartaoKpi('Pedidos despachados', dp.atual ? fmtN(dp.atual.pedidos) : '—', dp.atual ? 'na planilha de Entrega neste dia' : 'sem pedidos na planilha de Entrega', dp.atual && dp.ref ? h('span', { class: 'ks' }, seta(dp.atual.pedidos, dp.ref.pedidos, false), ' vs ' + ddmm(dp.refDia)) : null, 'ok', 'Pedidos da planilha de Entrega com a data deste dia (cada pedido conta uma vez).'),
      cartaoKpi('Peças despachadas', dp.atual ? fmtN(dp.atual.pecas) : '—', dp.atual ? 'peças desses pedidos' : '', dp.atual && dp.ref ? h('span', { class: 'ks' }, seta(dp.atual.pecas, dp.ref.pecas, false), ' vs ' + ddmm(dp.refDia)) : null, 'ok', 'Soma das peças dos pedidos despachados neste dia (itens do pedido na base do SC9).'));
    caixa.appendChild(kpis);
    caixa.appendChild(h('details', { class: 'ajuda', open: estado.ajuda, ontoggle: (ev) => { estado.ajuda = ev.target.open; } },
      h('summary', { text: 'Como ler esta página' }),
      h('ul', null,
        h('li', null, h('b', { text: 'Estoque: ' }), 'pedido que passou do prazo ainda na separação ou conferência.'),
        h('li', null, h('b', { text: 'Faturamento: ' }), 'pedido já conferido que só falta a nota fiscal.'),
        h('li', null, h('b', { text: 'Atrasado / Em processo: ' }), '"Atrasado" já passou do prazo; "Em processo" está dentro do atraso do dia mas ainda andando.'),
        h('li', null, h('b', { text: 'Dias de atraso: ' }), 'há quantos dias o pedido foi liberado além do prazo.'),
        h('li', null, h('b', { text: 'Saíram / Continuam / Entraram: ' }), 'comparação com a foto gravada imediatamente antes (pode ser de mais de um dia atrás, se algum dia não foi gravado).'),
        h('li', null, h('b', { text: 'Despachados: ' }), 'pedidos que estão na planilha de Entrega, no dia da data de entrega; cada pedido conta uma vez. As peças são a soma dos itens desse pedido na base do SC9.'))));
    if (a) caixa.appendChild(listaDePedidos(a));
    return caixa;
  }

  function opcoes(itens, i) { return [...new Set(itens.map((it) => it[i] || '').filter(Boolean))].sort((x, y) => String(x).localeCompare(String(y), 'pt-BR', { numeric: true })); }

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
    const lista = filtrar(aba.itens, f);
    const pecas = lista.reduce((s, it) => s + it[3], 0);
    const mostrados = lista.slice(0, estado.limite);

    const sel = (id, rotulo, valores, mapa) => h('label', { class: 'campo' }, h('span', { text: rotulo }),
      h('select', { id: 'f-' + id, onchange: (ev) => { f[id] = ev.target.value; estado.limite = 100; desenhar(); } }, h('option', { value: '', text: 'Todos' }), valores.map((v) => h('option', { value: v, selected: f[id] === v, text: mapa ? mapa[v] : v }))));

    const cabecas = [['pedido', 'Pedido'], ['arm', 'Armazém'], ['lib', 'Liberado em'], ['pecas', 'Peças'], ['tipo', 'Tipo'], ['sit', 'Situação'], ['dias', 'Dias de atraso'], ['transp', 'Transportadora']];
    const tabela = h('table', { class: 'tab pedidos' },
      h('thead', null, h('tr', null,
        cabecas.map(([id, nome]) => h('th', { class: id === 'pecas' || id === 'dias' ? 'num' : '', 'aria-sort': f.ordem === id ? (f.desc ? 'descending' : 'ascending') : 'none' },
          h('button', { class: 'ord', id: 'ord-' + id, onclick: () => { if (f.ordem === id) f.desc = !f.desc; else { f.ordem = id; f.desc = id === 'dias' || id === 'pecas'; } desenhar(); }, text: nome + (f.ordem === id ? (f.desc ? ' ▼' : ' ▲') : '') }))),
        aba.id === 'novos' ? null : h('th', { text: aba.id === 'saiu' ? 'Estava em' : 'Mudou' }))),
      h('tbody', null, mostrados.map((it) => linhaDoPedido(a, it, aba))));

    return h('div', { class: 'pedidos-bloco' },
      h('div', { class: 'abas', role: 'tablist' }, abas.map((x) => h('button', { class: 'aba' + (x.id === estado.aba ? ' ativa' : ''), id: 'aba-' + x.id, role: 'tab', 'aria-selected': x.id === estado.aba, title: x.dica, onclick: () => { estado.aba = x.id; estado.aberto = ''; estado.limite = 100; estado.filtro = { tipo: '', sit: '', arm: '', transp: '', busca: '', ordem: 'dias', desc: true }; desenhar(); }, text: x.nome + ' (' + fmtN(x.itens.length) + ')' }))),
      h('p', { class: 'mudo peq', text: aba.dica + ' Clique em um pedido para ver todos os dados dele.' }),
      h('div', { class: 'filtros' },
        h('label', { class: 'campo busca' }, h('span', { text: 'Buscar pedido ou transportadora' }), h('input', { type: 'search', id: 'f-busca', value: f.busca, placeholder: 'Digite o número do pedido…', oninput: (ev) => { f.busca = ev.target.value; estado.limite = 100; const pos = ev.target.selectionStart; desenhar(); const novo = document.querySelector('.filtros input[type=search]'); if (novo) { novo.focus(); novo.setSelectionRange(pos, pos); } } })),
        sel('tipo', 'Tipo', ['E', 'F'], TIPO), sel('sit', 'Situação', ['A', 'P'], SIT), sel('arm', 'Armazém', opcoes(aba.itens, 1)), sel('transp', 'Transportadora', opcoes(aba.itens, 7)),
        h('button', { class: 'btn', id: 'f-limpar', onclick: () => { estado.filtro = { tipo: '', sit: '', arm: '', transp: '', busca: '', ordem: 'dias', desc: true }; desenhar(); }, text: 'Limpar filtros' }),
        h('button', { class: 'btn', disabled: !lista.length, onclick: () => baixarCsv(lista, aba.nome), text: 'Baixar lista (CSV)' })),
      h('p', { class: 'mudo peq' }, 'Número vermelho em "Dias de atraso" = 5 dias ou mais.', h('span', { class: 'so-desk', text: ' Clique no título da coluna para ordenar.' })),
      h('p', { class: 'contagem', 'aria-live': 'polite', text: 'Mostrando ' + fmtN(Math.min(mostrados.length, lista.length)) + ' de ' + fmtN(lista.length) + ' pedidos · ' + fmtN(pecas) + ' peças' }),
      lista.length ? h('div', { class: 'rolagem' }, tabela) : h('p', { class: 'vazio-msg', text: aba.itens.length ? 'Nenhum pedido com esses filtros.' : 'Nenhum pedido nesta lista.' }),
      lista.length > estado.limite ? h('button', { class: 'btn primario', onclick: () => { estado.limite += 200; desenhar(); }, text: 'Mostrar mais ' + Math.min(200, lista.length - estado.limite) }) : null);
  }

  function status(a, it, aba) {
    if (aba.id === 'saiu') return a.cmp ? 'Atraso em ' + ddmm(a.cmp.ant.dia) : '';
    if (!a.cmp) return '—';
    const k = chave(it);
    if (!a.cmp.antes.has(k)) return 'Entrou';
    return a.cmp.antes.get(k)[4] !== it[4] ? 'Estoque → Faturamento' : 'Continua';
  }

  function linhaDoPedido(a, it, aba) {
    const k = aba.id + '|' + chave(it), aberto = estado.aberto === k;
    const tr = h('tr', { class: 'clicavel' + (aberto ? ' sel' : ''), tabindex: '0', 'aria-expanded': aberto, onclick: () => { estado.aberto = aberto ? '' : k; desenhar(); }, onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); tr.click(); } } },
      h('td', { class: 'ped', text: it[0] }), h('td', { 'data-l': 'Armazém', text: it[1] || '—' }), h('td', { 'data-l': 'Liberado em', text: it[2] ? ddmmaaaa(it[2]) : '—' }), h('td', { class: 'num', 'data-l': 'Peças', text: fmtN(it[3]) }),
      h('td', { 'data-l': 'Tipo' }, h('span', { class: 'tag ' + (it[4] === 'F' ? 'fat' : 'est'), text: TIPO[it[4]] })), h('td', { 'data-l': 'Situação' }, h('span', { class: 'tag ' + (it[5] === 'A' ? 'atr' : 'proc'), text: SIT[it[5]] })),
      h('td', { class: 'num' + (it[6] >= 5 ? ' forte' : ''), 'data-l': 'Dias de atraso', text: fmtN(it[6]) }), h('td', { 'data-l': 'Transportadora', text: it[7] || '—' }), aba.id === 'novos' ? null : h('td', { 'data-l': aba.id === 'saiu' ? 'Estava em' : 'Mudou', text: status(a, it, aba) }));
    if (!aberto) return tr;
    const p = estado.p, seq = sequencia(p, chave(it), a.reg.dia), dias = p.historico.get(chave(it)) || [];
    const campo = (t, v) => h('div', { class: 'cd' }, h('span', { text: t }), h('b', { text: v }));
    const det = h('tr', { class: 'detalhe' }, h('td', { colspan: 9, class: 'det-td' },
      h('div', { class: 'det-grid' },
        campo('Pedido', it[0]), campo('Armazém', it[1] || '—'), campo('Transportadora', it[7] || '—'), campo('Liberado em', it[2] ? ddmmaaaa(it[2]) + ' (' + semana(it[2], 'short').replace('.', '') + ')' : '—'),
        campo('Peças', fmtN(it[3])), campo('Dias de atraso', fmtN(it[6])),
        campo('Tipo de atraso', it[4] === 'F' ? 'Faturamento: já conferido, falta a nota fiscal' : 'Estoque: ainda em separação/conferência'),
        campo('Situação', it[5] === 'A' ? 'Atrasado: passou do prazo' : 'Em processo: andando dentro do atraso'),
        campo('Comparado ao dia anterior', status(a, it, { id: 'atraso' }) || '—'),
        campo('Dias seguidos em atraso', seq.n ? seq.n + (seq.n === 1 ? ' dia' : ' dias') + ' (desde ' + ddmm(seq.desde) + ')' : 'não estava em atraso neste dia')),
      dias.length ? h('div', { class: 'linha-tempo' }, h('span', { class: 'mudo', text: 'Dias gravados em que apareceu em atraso: ' }), dias.map((d) => h('button', { class: 'chip' + (d === a.reg.dia ? ' ativo' : ''), onclick: (ev) => { ev.stopPropagation(); escolherDia(d); }, text: ddmm(d) }))) : null));
    return [tr, det];
  }

  function baixarCsv(lista, nome) {
    const blob = new Blob([csv(lista)], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'historico-atraso-' + estado.dia + '-' + nome.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.csv' });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function desenhar() {
    const y = root.scrollY;
    const foco = document.activeElement && document.activeElement.id ? document.activeElement.id : '';
    const vazio = !estado.p.porDia.size && !Object.keys(estado.p.exp).length;
    const blocos = vazio ? [h('section', { class: 'cartao centro' }, h('h2', { text: 'Ainda não há histórico gravado' }), h('p', { class: 'mudo', text: 'No SC9, abra o painel e use o botão "Histórico de Atraso" (ao lado do Relatório Geral). Cada vez que o atraso é exportado, a foto do dia fica guardada aqui.' }))]
      : [faixaDeDias(), detalheDoDia(), graficos(), tabelaDoMes()];
    $app.replaceChildren(cabecalho(), ...blocos.filter(Boolean));
    root.scrollTo(0, y);
    if (foco) { const e = document.getElementById(foco); if (e && e.focus) e.focus({ preventScroll: true }); }
  }

  window.addEventListener('hashchange', () => { const d = (location.hash || '').replace('#', ''); if (estado.p && d !== estado.dia && (estado.p.porDia.has(d) || estado.p.exp[d])) { estado.dia = d; estado.mes = d.slice(0, 7); desenhar(); } });
  carregar();
})(typeof window === 'object' ? window : globalThis);
