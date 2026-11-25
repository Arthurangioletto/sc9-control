/* Vínculo Entrega <-> Recebimento <-> Saída (expedição). Módulo PURO: sem disco, sem rede, sem relógio escondido.
 * Casa o que o ESTOQUE desceu (Saída p/ Expedição), o que a EXPEDIÇÃO recebeu (Recebimento) e o que SAIU (planilha de Entrega do SC9),
 * classifica cada pedido, monta o painel, as linhas (filtros/paginação), a exportação e o plano de importação da Entrega.
 *
 * Regras que valem em tudo aqui:
 *  - o número do pedido é sempre normalizado (só dígitos, sem zeros à esquerda) dos DOIS lados antes de casar;
 *  - data da Entrega que vem como ISO com horário é convertida para o DIA DE SÃO PAULO (nunca se fatia a string UTC);
 *  - pedido repetido na Entrega: vale a data MAIS NOVA;
 *  - nunca se apaga nem se sobrescreve dado preenchido com vazio: só se completa o que falta. */
'use strict';

const { mesmaTransportadora } = require('./fechamento-dia.js');

const DIAS_DUP = 3;        // mesmo valor de RECEB_DIAS_DUP do servidor
const DIAS_ENTREGA = 10;   // mesmo valor de RECEB_DIAS_ENTREGA do servidor
const MAX_DIAS = 62;
const MAX_LISTA = 200;
const MAX_EXPORTAR = 20000;
const SITUACOES = ['saiu', 'recebido', 'nao_sai_hoje', 'desceu_nao_recebido', 'saiu_sem_recebimento'];
const PENDENTES = ['recebido', 'nao_sai_hoje', 'desceu_nao_recebido'];
const CAMPOS_INFO = ['armazem', 'cliente', 'transportadora', 'linhas', 'pecas', 'conferente', 'nf', 'liberadoEm', 'fimConferencia'];
const ORIGEM_IMPORTACAO = 'importação do SC9';

// ---------- texto, pedido, datas ----------
const texto = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 80);
const semAcento = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const chaveTransp = (v) => semAcento(texto(v, 60)).replace(/[^a-z0-9]/g, '');
function normalizarPedido(x) {
  const d = String(x == null ? '' : x).replace(/\.0+$/, '').replace(/\D/g, '').replace(/^0+/, '');
  return d.length >= 4 && d.length <= 10 ? d : null;
}
const FORMATADOR_DIA_SP = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' });
const diaSP = (d) => FORMATADOR_DIA_SP.format(d);
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
function diaValido(s) {
  if (typeof s !== 'string' || !DIA_RE.test(s)) return false;
  const d = new Date(s + 'T12:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && s >= '2000-01-01' && s <= '2100-12-31';
}
// valor qualquer (AAAA-MM-DD, ISO com horário, Date, número) -> dia de São Paulo ('' se não der)
function diaDeValor(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'string' && DIA_RE.test(v.trim())) return diaValido(v.trim()) ? v.trim() : '';
  const d = v instanceof Date ? v : new Date(typeof v === 'number' ? v : String(v).trim());
  return isNaN(d.getTime()) ? '' : diaSP(d);
}
const addDias = (dia, n) => { const d = new Date(dia + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const difDias = (a, b) => Math.round((new Date(a + 'T12:00:00Z') - new Date(b + 'T12:00:00Z')) / 86400000);
function diasEntre(de, ate) { const r = []; for (let d = de; d <= ate && r.length <= 400; d = addDias(d, 1)) r.push(d); return r; }
const meioDiaSP = (dia) => new Date(dia + 'T12:00:00-03:00').toISOString(); // São Paulo está em UTC-3 o ano todo desde 2019
const arred1 = (n) => Math.round(n * 10) / 10;
const minutosEntre = (deIso, ateIso) => { const a = new Date(deIso).getTime(), b = new Date(ateIso).getTime(); return Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / 60000) : null; };
const horasEntre = (deIso, ateMs) => { const t = new Date(deIso).getTime(); return Number.isFinite(t) ? Math.max(0, arred1((ateMs - t) / 3600000)) : null; };

// ---------- intervalo ----------
// Valida/normaliza de..ate. Devolve { de, ate } ou { erro }.
function intervalo(deIn, ateIn, hoje) {
  const padraoDe = hoje.slice(0, 8) + '01';
  const de = deIn == null || deIn === '' ? padraoDe : deIn;
  let ate = ateIn == null || ateIn === '' ? hoje : ateIn;
  if (!diaValido(de) || !diaValido(ate)) return { erro: 'Data inválida: use o formato AAAA-MM-DD.' };
  if (ate > hoje) ate = hoje;
  if (de > ate) return { erro: 'A data inicial é depois da final.' };
  if (difDias(ate, de) + 1 > MAX_DIAS) return { erro: 'O período pode ter no máximo ' + MAX_DIAS + ' dias.' };
  return { de, ate };
}

// ---------- Entrega ----------
// entregaInfo do SC9: [[pedido, { data, transportadora }]] (ou Map/objeto). Devolve Map pedido -> { data (dia SP), transportadora }.
function normalizarEntrega(entregaInfo) {
  const pares = !entregaInfo ? [] : entregaInfo instanceof Map ? [...entregaInfo.entries()] : Array.isArray(entregaInfo) ? entregaInfo : Object.entries(entregaInfo);
  const mapa = new Map();
  for (const par of pares) {
    if (!Array.isArray(par)) continue;
    const ped = normalizarPedido(par[0]); if (!ped) continue;
    const v = par[1] && typeof par[1] === 'object' ? par[1] : {};
    const data = diaDeValor(v.data);
    const novo = { data, transportadora: texto(v.transportadora, 60) };
    const ant = mapa.get(ped);
    if (!ant || (data && (!ant.data || data > ant.data))) mapa.set(ped, novo); // repetido: a data MAIS NOVA vence
  }
  return mapa;
}

// ---------- info do pedido (completa, nunca apaga) ----------
const vazio = (v) => v == null || v === '' || v === 0 || String(v).trim() === '' || String(v).trim() === '0';
function resumoDe(base) {
  if (!base) return null;
  const r = {};
  for (const c of CAMPOS_INFO) r[c] = base[c] === undefined ? null : base[c];
  return r;
}
// completa só o que está vazio em `info` com o que `base` tem. Devolve { info, campos } (campos = quais foram preenchidos).
function mesclarInfo(info, base) {
  if (!base) return { info: info || null, campos: [] };
  if (!info) { const r = resumoDe(base); return { info: r, campos: CAMPOS_INFO.filter((c) => !vazio(r[c])) }; }
  const campos = []; let novo = null;
  for (const c of CAMPOS_INFO) {
    if (vazio(info[c]) && !vazio(base[c])) { novo = novo || { ...info }; novo[c] = base[c]; campos.push(c); }
  }
  return { info: novo || info, campos };
}
// Visão de LEITURA de uma entrada: completa com o pedido mais recente do SC9; sem transportadora, usa a da Entrega (só na visão).
function visaoEntrada(entry, base) {
  const m = mesclarInfo(entry.info, base);
  let info = m.info;
  if (entry.saiuEntrega && entry.saiuEntrega.transportadora && !(info && info.transportadora)) info = { ...(info || {}), transportadora: entry.saiuEntrega.transportadora };
  const semDado = entry.semDadoSC9 && !base ? true : (base ? false : Boolean(entry.semDadoSC9));
  return { ...entry, info, semDadoSC9: semDado, aguardandoNota: vazio(info && info.nf) };
}
// Reconciliação para GRAVAR: completa info das entradas com o SC9 atual. Devolve { entries, mudou, preenchidos }.
function reconciliarInfo(entries, resolver, agoraIso) {
  let mudou = false, preenchidos = 0;
  const saida = entries.map((e) => {
    if (!e || !e.pedido) return e;
    const base = resolver(e.pedido); if (!base) return e;
    const m = mesclarInfo(e.info, base);
    const resolveu = e.semDadoSC9 === true;
    if (!m.campos.length && !resolveu) return e;
    mudou = true; preenchidos += m.campos.length;
    const novo = { ...e, info: m.info };
    if (resolveu) { novo.semDadoSC9 = false; novo.resolvidoEm = agoraIso; }
    if (m.campos.length) novo.infoAtualizadaEm = agoraIso;
    return novo;
  });
  return { entries: mudou ? saida : entries, mudou, preenchidos };
}
const transportadoraDiferente = (a, b) => { const x = chaveTransp(a), y = chaveTransp(b); return Boolean(x && y) && !mesmaTransportadora(a, b); }; // vazio = "sem informação", não "igual"

// ---------- Saída do estoque ----------
// saidaPorDia: { dia: entries[] } -> Map pedido -> [{ dia, em, por, id }] (do mais antigo para o mais novo)
function indexarSaidas(saidaPorDia) {
  const m = new Map();
  for (const dia of Object.keys(saidaPorDia || {}).sort()) {
    for (const e of saidaPorDia[dia] || []) {
      const ped = normalizarPedido(e && e.pedido); if (!ped) continue;
      if (!m.has(ped)) m.set(ped, []);
      m.get(ped).push({ dia, em: e.registradoEm || '', por: e.registradoPorNome || e.registradoPorUsuario || '', id: e.id || '' });
    }
  }
  for (const l of m.values()) l.sort((a, b) => a.dia.localeCompare(b.dia) || String(a.em).localeCompare(String(b.em)));
  return m;
}
// a saída que "vale" para um recebimento do dia X: a mais nova até X; se só há depois, a mais antiga delas; senão o cache de 1ª saída (atraso-saidas)
function desceuDe(saidas, pedido, dia, fallback) {
  const l = saidas.get(pedido);
  if (l && l.length) {
    let achado = null;
    for (const s of l) if (s.dia <= dia) achado = s;
    return achado || l[0];
  }
  const iso = fallback && fallback.get ? fallback.get(pedido) : fallback && fallback[pedido];
  if (iso) { const d = diaDeValor(iso); if (d) return { dia: d, em: iso, por: '', id: '' }; }
  return null;
}

// ---------- registros (uma linha por pedido/situação) ----------
const horaDe = (r) => String(r.recebidoEm || r.desceuEm || '');
function montarRegistros(o) {
  const { de, ate, hoje } = o;
  const agoraMs = o.agora instanceof Date ? o.agora.getTime() : Date.now();
  const recebPorDia = o.recebPorDia || {}, entrega = o.entrega instanceof Map ? o.entrega : new Map();
  const resolver = typeof o.resolver === 'function' ? o.resolver : () => null;
  const saidas = o.saidasIndexadas || indexarSaidas(o.saidaPorDia);
  const fallback = o.fallbackSaida || null;
  const recebidos = new Set();
  for (const dia of Object.keys(recebPorDia)) for (const e of recebPorDia[dia] || []) if (e && e.pedido) recebidos.add(e.pedido);

  const regs = [];
  for (const dia of diasEntre(de, ate)) {
    for (const e of recebPorDia[dia] || []) {
      if (!e || !e.pedido) continue;
      const v = visaoEntrada(e, resolver(e.pedido));
      const info = v.info || {};
      const d = desceuDe(saidas, e.pedido, dia, fallback);
      const situacao = e.saiuEntrega ? 'saiu' : e.naoSaiHoje ? 'nao_sai_hoje' : 'recebido';
      const dataEntrega = e.saiuEntrega ? diaDeValor(e.saiuEntrega.dataEntrega) : '';
      const vol = Number.isFinite(Number(e.volumes)) && e.volumes !== null && e.volumes !== '' ? Number(e.volumes) : null;
      const transpEntrega = e.saiuEntrega ? e.saiuEntrega.transportadora : '';
      const horaReal = e.horaEstimada !== true; // entrada importada da planilha não tem hora real: fica fora de todos os tempos
      const diaReceb = horaReal && e.recebidoEm ? diaDeValor(e.recebidoEm) : '';
      regs.push({
        id: e.id || '', dia, pedido: e.pedido, nf: texto(info.nf, 20), cliente: texto(info.cliente, 80), armazem: texto(info.armazem, 40),
        transportadora: texto(info.transportadora, 60), volumes: vol,
        desceuEm: d ? d.em : null, desceuPor: d ? d.por : null,
        recebidoEm: e.recebidoEm || null, recebidoPor: texto(e.recebidoPorNome || e.recebidoPorUsuario, 60), origem: e.origem === 'entrega' ? 'entrega' : 'bipe', horaEstimada: e.horaEstimada === true,
        dataEntrega: dataEntrega || null, situacao, motivo: e.naoSaiHoje ? texto(e.naoSaiHoje.motivo, 80) || null : null,
        rastreio: e.rastreio && (e.rastreio.codigo || e.rastreio.link) ? { codigo: texto(e.rastreio.codigo, 60), link: texto(e.rastreio.link, 500) } : null,
        aguardandoNota: v.aguardandoNota,
        transportadoraDiferente: Boolean(e.saiuEntrega) && transportadoraDiferente(e.info && e.info.transportadora ? e.info.transportadora : (resolver(e.pedido) || {}).transportadora, transpEntrega),
        transportadoraEntrega: texto(transpEntrega, 60) || null,
        horasParado: situacao === 'saiu' ? null : horasEntre(e.recebidoEm, agoraMs),
        minutosDesceuAteReceber: horaReal && d && d.em && e.recebidoEm ? minutosEntre(d.em, e.recebidoEm) : null,
        horasNaExpedicao: horaReal && situacao !== 'saiu' ? horasEntre(e.recebidoEm, agoraMs) : null,
        diasAteSair: horaReal && situacao === 'saiu' && dataEntrega && diaReceb ? Math.max(0, difDias(dataEntrega, diaReceb)) : null,
        _entry: e
      });
    }
  }
  // desceu e não foi recebido (e também não consta na Entrega)
  const desceramPorDia = new Map();
  const emRegistro = new Set();
  for (const dia of diasEntre(de, ate)) {
    for (const e of (o.saidaPorDia && o.saidaPorDia[dia]) || []) {
      const ped = normalizarPedido(e && e.pedido); if (!ped) continue;
      if (!desceramPorDia.has(dia)) desceramPorDia.set(dia, new Set());
      desceramPorDia.get(dia).add(ped);
    }
  }
  const ultimaSaidaNoPeriodo = new Map();
  for (const [dia, set] of desceramPorDia) for (const ped of set) {
    const l = (saidas.get(ped) || []).filter((s) => s.dia === dia);
    const s = l[l.length - 1]; const ant = ultimaSaidaNoPeriodo.get(ped);
    if (s && (!ant || s.dia > ant.dia || (s.dia === ant.dia && String(s.em) > String(ant.em)))) ultimaSaidaNoPeriodo.set(ped, s);
  }
  for (const [ped, s] of ultimaSaidaNoPeriodo) {
    if (recebidos.has(ped) || entrega.has(ped) || emRegistro.has(ped)) continue;
    emRegistro.add(ped);
    const b = resolver(ped) || {};
    regs.push({
      id: s.id || '', dia: s.dia, pedido: ped, nf: texto(b.nf, 20), cliente: texto(b.cliente, 80), armazem: texto(b.armazem, 40), transportadora: texto(b.transportadora, 60), volumes: null,
      desceuEm: s.em || null, desceuPor: s.por || null, recebidoEm: null, recebidoPor: null, origem: null, horaEstimada: false, dataEntrega: null,
      situacao: 'desceu_nao_recebido', motivo: null, rastreio: null, aguardandoNota: vazio(b.nf), transportadoraDiferente: false, transportadoraEntrega: null,
      horasParado: s.em ? horasEntre(s.em, agoraMs) : null, minutosDesceuAteReceber: null, horasNaExpedicao: null, diasAteSair: null, _entry: null
    });
  }
  // consta na Entrega com data no período e nunca foi recebido
  for (const [ped, en] of entrega) {
    if (!en.data || en.data < de || en.data > ate || recebidos.has(ped)) continue;
    const b = resolver(ped) || {};
    const d = desceuDe(saidas, ped, en.data, fallback);
    regs.push({
      id: 'en_' + ped, dia: en.data, pedido: ped, nf: texto(b.nf, 20), cliente: texto(b.cliente, 80), armazem: texto(b.armazem, 40), transportadora: texto(b.transportadora || en.transportadora, 60), volumes: null,
      desceuEm: d ? d.em : null, desceuPor: d ? d.por : null, recebidoEm: null, recebidoPor: null, origem: null, horaEstimada: false, dataEntrega: en.data,
      situacao: 'saiu_sem_recebimento', motivo: null, rastreio: null, aguardandoNota: vazio(b.nf),
      transportadoraDiferente: transportadoraDiferente(b.transportadora, en.transportadora), transportadoraEntrega: texto(en.transportadora, 60) || null,
      horasParado: null, minutosDesceuAteReceber: null, horasNaExpedicao: null, diasAteSair: null, _entry: null
    });
  }
  regs.sort((a, b) => b.dia.localeCompare(a.dia) || horaDe(b).localeCompare(horaDe(a)) || a.pedido.localeCompare(b.pedido));
  return { registros: regs, desceramPorDia, recebidosSet: recebidos };
}

const publico = (r) => { const { _entry, ...p } = r; return p; };

// ---------- painel ----------
function percentil(ordenados, p) {
  if (!ordenados.length) return null;
  return ordenados[Math.min(ordenados.length - 1, Math.max(0, Math.ceil(p * ordenados.length) - 1))];
}
function montarPainel(m, o) {
  const { de, ate, hoje } = o;
  const regs = m.registros;
  const grupos = new Map();
  const grupo = (nome) => {
    const k = chaveTransp(nome), n = texto(nome, 40) || 'Sem transportadora';
    if (!grupos.has(k)) grupos.set(k, { _perm: [], nome: n, recebidos: 0, saiu: 0, pendentes: 0, naoSaiHoje: 0, volumes: 0, comRastreio: 0, desceuNaoRecebido: 0, saiuSemRecebimento: 0 });
    return grupos.get(k);
  };
  const dias = new Map(diasEntre(de, ate).map((d) => [d, { dia: d, desceram: (m.desceramPorDia.get(d) || new Set()).size, recebidos: 0, saiu: 0, pendentes: 0, naoSaiHoje: 0, volumes: 0 }]));
  const t = { desceram: 0, recebidos: 0, bipados: 0, daPlanilha: 0, saiuEntrega: 0, naoSaiHoje: 0, pendentesDeSaida: 0, desceuNaoRecebido: 0, saiuSemRecebimento: 0, volumes: 0, comRastreio: 0 };
  const todosDesceram = new Set(); for (const s of m.desceramPorDia.values()) for (const p of s) todosDesceram.add(p);
  t.desceram = todosDesceram.size;
  const permanencias = [], descAteReceber = []; let divergentes = 0, saiuMesmoDia = 0, bipadosAntesDeHoje = 0, saiuComRastreio = 0;
  const pend = { desceuNaoRecebido: [], recebidoNaoSaiu: [], saiuSemRecebimento: [] };
  for (const r of regs) {
    const g = grupo(r.transportadora);
    if (r.situacao === 'desceu_nao_recebido') {
      t.desceuNaoRecebido++; g.desceuNaoRecebido++;
      pend.desceuNaoRecebido.push({ pedido: r.pedido, dia: r.dia, desceuEm: r.desceuEm, desceuPor: r.desceuPor, cliente: r.cliente, transportadora: r.transportadora, horasParado: r.horasParado });
      continue;
    }
    if (r.situacao === 'saiu_sem_recebimento') {
      t.saiuSemRecebimento++; g.saiuSemRecebimento++;
      if (r.transportadoraDiferente) divergentes++;
      pend.saiuSemRecebimento.push({ pedido: r.pedido, dataEntrega: r.dataEntrega, transportadora: r.transportadora, cliente: r.cliente });
      continue;
    }
    const dd = dias.get(r.dia);
    t.recebidos++; g.recebidos++; dd.recebidos++;
    if (r.origem === 'entrega') t.daPlanilha++; else t.bipados++;
    if (r.volumes !== null) { t.volumes += r.volumes; g.volumes += r.volumes; dd.volumes += r.volumes; }
    if (r.rastreio) { t.comRastreio++; g.comRastreio++; }
    if (r.situacao === 'saiu') {
      t.saiuEntrega++; g.saiu++; dd.saiu++;
      if (r.rastreio) saiuComRastreio++;
      if (r.transportadoraDiferente) divergentes++;
    } else {
      if (r.situacao === 'nao_sai_hoje') { t.naoSaiHoje++; g.naoSaiHoje++; dd.naoSaiHoje++; }
      else { t.pendentesDeSaida++; g.pendentes++; dd.pendentes++; }
      pend.recebidoNaoSaiu.push({ pedido: r.pedido, dia: r.dia, recebidoEm: r.recebidoEm, cliente: r.cliente, transportadora: r.transportadora, motivo: r.motivo, horasParado: r.horasParado });
    }
    // indicadores de tempo: só entradas bipadas (hora real); a planilha traz só a data
    if (r.origem === 'bipe' && !r.horaEstimada) {
      const diaReal = r.recebidoEm ? diaDeValor(r.recebidoEm) : '';
      if (r.diasAteSair != null) { permanencias.push(r.diasAteSair * 24); g._perm.push(r.diasAteSair * 24); }
      if (r.minutosDesceuAteReceber != null) descAteReceber.push(r.minutosDesceuAteReceber);
      if (r.dia < hoje) { bipadosAntesDeHoje++; if (r.situacao === 'saiu' && r.dataEntrega && r.dataEntrega === diaReal) { saiuMesmoDia++; } }
    }
  }
  t.volumes = Math.round(t.volumes * 100) / 100;
  permanencias.sort((a, b) => a - b);
  t.permanenciaMediaHoras = permanencias.length ? arred1(permanencias.reduce((s, x) => s + x, 0) / permanencias.length) : null;
  t.permanenciaP90Horas = permanencias.length ? arred1(percentil(permanencias, 0.9)) : null;
  t.saidaMesmoDiaPct = bipadosAntesDeHoje ? arred1(saiuMesmoDia * 100 / bipadosAntesDeHoje) : null;
  descAteReceber.sort((a, b) => a - b);
  t.desceuAteReceberMediaMin = descAteReceber.length ? Math.round(descAteReceber.reduce((s, x) => s + x, 0) / descAteReceber.length) : null;
  t.desceuAteReceberP90Min = descAteReceber.length ? percentil(descAteReceber, 0.9) : null;
  t.transportadoraDiferente = divergentes;
  t.rastreioPct = t.saiuEntrega ? arred1(saiuComRastreio * 100 / t.saiuEntrega) : null;
  const porHoras = (a, b) => (b.horasParado == null ? -1 : b.horasParado) - (a.horasParado == null ? -1 : a.horasParado);
  pend.desceuNaoRecebido.sort(porHoras); pend.recebidoNaoSaiu.sort(porHoras);
  pend.saiuSemRecebimento.sort((a, b) => String(b.dataEntrega).localeCompare(String(a.dataEntrega)) || a.pedido.localeCompare(b.pedido));
  const pendenciasTotal = { desceuNaoRecebido: pend.desceuNaoRecebido.length, recebidoNaoSaiu: pend.recebidoNaoSaiu.length, saiuSemRecebimento: pend.saiuSemRecebimento.length };
  for (const k of Object.keys(pend)) pend[k] = pend[k].slice(0, MAX_LISTA);
  const listaDias = [...dias.values()].map((d) => ({ ...d, volumes: Math.round(d.volumes * 100) / 100 }));
  const transportadoras = [...grupos.values()].map(({ _perm, ...g }) => ({ ...g, volumes: Math.round(g.volumes * 100) / 100, permanenciaMediaHoras: _perm.length ? arred1(_perm.reduce((s, x) => s + x, 0) / _perm.length) : null }))
    .sort((a, b) => (b.pendentes + b.desceuNaoRecebido) - (a.pendentes + a.desceuNaoRecebido) || b.recebidos - a.recebidos || a.nome.localeCompare(b.nome, 'pt-BR'));
  const ex = o.extras || {};
  return {
    de, ate, geradoEm: o.geradoEm || null, baseEntregaEm: ex.baseEntregaEm || null, pedidosNaEntrega: ex.pedidosNaEntrega == null ? null : ex.pedidosNaEntrega,
    pedidosNaEntregaAnterior: ex.pedidosNaEntregaAnterior == null ? null : ex.pedidosNaEntregaAnterior, entregaAnteriorEm: ex.entregaAnteriorEm || null,
    entregaPossivelmenteCortada: ex.pedidosNaEntrega != null && ex.pedidosNaEntregaAnterior != null && ex.pedidosNaEntrega < ex.pedidosNaEntregaAnterior,
    hoje, podeImportar: Boolean(ex.podeImportar), totais: t, dias: listaDias, transportadoras, pendencias: pend, pendenciasTotal,
    mes: { base: ate.slice(0, 7), diasComDados: listaDias.filter((d) => d.desceram || d.recebidos).length }
  };
}

// ---------- linhas, filtros, paginação, exportação ----------
// palavras da busca (sem acento, minúsculas); número solto com menos de 3 dígitos é ignorado (casaria com tudo)
const palavrasDaBusca = (q) => semAcento(q).split(/[\s,;]+/).filter((p) => p && !(/^\d+$/.test(p) && p.length < 3)).slice(0, 6);
const palheiro = (r) => semAcento([r.pedido, r.nf, r.cliente, r.transportadora, r.armazem, r.recebidoPor, r.desceuPor, r.motivo, r.rastreio && r.rastreio.codigo].filter(Boolean).join(' '));
function filtrar(registros, f) {
  const o = f || {};
  const kT = o.transportadora ? chaveTransp(o.transportadora) : null;
  const semT = o.transportadora && /^sem transportadora$/i.test(texto(o.transportadora, 60));
  const palavras = o.q ? palavrasDaBusca(o.q) : [];
  return registros.filter((r) => {
    if (o.situacao && r.situacao !== o.situacao) return false;
    if (o.somentePendentes && !PENDENTES.includes(r.situacao)) return false;
    if (kT !== null && !(semT ? !chaveTransp(r.transportadora) : chaveTransp(r.transportadora) === kT)) return false;
    if (palavras.length) { const p = palheiro(r); if (!palavras.every((w) => p.includes(w))) return false; }
    return true;
  });
}
function paginar(lista, pagina, limite) {
  const lim = Math.min(Math.max(1, limite || 100), 500), pg = Math.max(1, pagina || 1);
  return { total: lista.length, pagina: pg, limite: lim, paginas: Math.max(1, Math.ceil(lista.length / lim)), linhas: lista.slice((pg - 1) * lim, pg * lim).map(publico) };
}
function linhasExportacao(registros, f) {
  const lista = filtrar(registros, f).slice().sort((a, b) => (chaveTransp(a.transportadora) || '~').localeCompare(chaveTransp(b.transportadora) || '~') || a.dia.localeCompare(b.dia) || a.pedido.localeCompare(b.pedido));
  return {
    truncado: lista.length > MAX_EXPORTAR,
    linhas: lista.slice(0, MAX_EXPORTAR).map((r) => ({
      dia: r.dia, pedido: r.pedido, nf: r.nf, cliente: r.cliente, armazem: r.armazem, transportadora: r.transportadora || 'Sem transportadora', volumes: r.volumes,
      recebidoEm: r.recebidoEm, dataEntrega: r.dataEntrega, situacao: r.situacao, motivo: r.motivo, rastreioCodigo: r.rastreio ? r.rastreio.codigo : '', rastreioLink: r.rastreio ? r.rastreio.link : ''
    }))
  };
}

// ---------- importação / sincronização da Entrega ----------
// Decide, para cada pedido da Entrega com data em [de, ate], se cria uma entrada nova ou só confirma a que já existe.
// recebPorDia: { dia: entries[] } precisa cobrir de [de - DIAS_ENTREGA] até hoje (um recebimento depois da data da Entrega também conta). removidosPorDia: { dia: removidos[] }. NÃO grava nada: devolve `alteracoes` para quem grava.
function planejarImportacao(o) {
  const { de, ate, agora } = o;
  const entrega = o.entrega instanceof Map ? o.entrega : new Map();
  const recebPorDia = o.recebPorDia || {};
  const resolver = typeof o.resolver === 'function' ? o.resolver : () => null;
  const saidas = o.saidasIndexadas || indexarSaidas(o.saidaPorDia);
  const agoraIso = (agora instanceof Date ? agora : new Date()).toISOString();
  const por = o.por || 'sistema', nome = o.nome || 'Planilha de Entrega', arquivo = o.arquivo || ORIGEM_IMPORTACAO;
  const gerarId = o.gerarId || ((ped) => 'rx_' + ped + '_' + Date.now().toString(36) + '_' + Math.random().toString(16).slice(2, 8));
  const antes = o.diasAntes == null ? DIAS_ENTREGA : o.diasAntes; // sem limite para depois: pedido já recebido em QUALQUER dia posterior à data da Entrega não se duplica
  const porPedido = new Map();
  for (const dia of Object.keys(recebPorDia)) for (const e of recebPorDia[dia] || []) {
    if (!e || !e.pedido) continue;
    if (!porPedido.has(e.pedido)) porPedido.set(e.pedido, []);
    porPedido.get(e.pedido).push({ dia, entry: e });
  }
  const removidosPorPedido = new Map(); // pedidos que alguém desfez (em removidos): a Entrega não os recria
  const remDias = o.removidosPorDia || {};
  for (const dia of Object.keys(remDias)) for (const x of remDias[dia] || []) { if (!x || !x.pedido) continue; if (!removidosPorPedido.has(x.pedido)) removidosPorPedido.set(x.pedido, []); removidosPorPedido.get(x.pedido).push(dia); }
  const r = { candidatos: 0, novos: 0, jaExistiam: 0, confirmados: 0, anteriores: 0, removidosIgnorados: 0, semInfoSC9: 0, porDia: [], porTransportadora: [], alteracoes: [] };
  const alt = new Map(); // dia -> { dia, novas: [], confirmar: [] }
  const doDia = (dia) => { if (!alt.has(dia)) alt.set(dia, { dia, novas: [], confirmar: [] }); return alt.get(dia); };
  const nDia = new Map(), nTransp = new Map();
  const pedidos = [...entrega.keys()].sort();
  for (const ped of pedidos) {
    const en = entrega.get(ped);
    if (!en.data || en.data < de || en.data > ate) continue;
    r.candidatos++;
    const D = en.data, ini = addDias(D, -antes);
    const existentes = (porPedido.get(ped) || []).filter((x) => x.dia >= ini);
    if (existentes.length) {
      r.jaExistiam++;
      const alvo = existentes.filter((x) => !x.entry.saiuEntrega && x.dia <= D).sort((a, b) => b.dia.localeCompare(a.dia))[0];
      if (alvo) {
        r.confirmados++;
        doDia(alvo.dia).confirmar.push({ id: alvo.entry.id, pedido: ped, saiuEntrega: { em: agoraIso, por, nome, dataEntrega: D, transportadora: en.transportadora || null, arquivo } });
      } else if (existentes.some((x) => !x.entry.saiuEntrega && x.dia > D)) r.anteriores++; // consta com saída ANTES de ser recebido: só sinaliza
      continue;
    }
    if ((removidosPorPedido.get(ped) || []).some((dia) => dia >= ini)) { r.removidosIgnorados++; continue; }
    const base = resolver(ped);
    const d = desceuDe(saidas, ped, D, o.fallbackSaida);
    const entry = {
      id: gerarId(ped), pedido: ped, recebidoPorUsuario: 'sistema', recebidoPorNome: 'Planilha de Entrega', recebidoEm: meioDiaSP(D), horaEstimada: true, origem: 'entrega',
      semDadoSC9: !base, info: resumoDe(base), desceuNaHora: d ? 'ok' : 'sem_saida', volumes: null, naoSaiHoje: null,
      saiuEntrega: { em: agoraIso, por, nome, dataEntrega: D, transportadora: en.transportadora || null, arquivo }, importadoEm: agoraIso
    };
    doDia(D).novas.push(entry);
    r.novos++; if (!base) r.semInfoSC9++;
    nDia.set(D, (nDia.get(D) || 0) + 1);
    const nt = texto((base && base.transportadora) || en.transportadora, 40) || 'Sem transportadora';
    nTransp.set(nt, (nTransp.get(nt) || 0) + 1);
  }
  r.porDia = [...nDia].sort((a, b) => a[0].localeCompare(b[0])).map(([dia, novos]) => ({ dia, novos }));
  r.porTransportadora = [...nTransp].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR')).map(([nome, novos]) => ({ nome, novos }));
  r.alteracoes = [...alt.values()].filter((a) => a.novas.length || a.confirmar.length).sort((a, b) => a.dia.localeCompare(b.dia));
  return r;
}
// aplica um item de `alteracoes` sobre as entradas do dia (devolve nova lista; as novas entram DEPOIS das existentes; nada é apagado)
function aplicarAlteracao(entries, a) {
  const conf = new Map(a.confirmar.map((c) => [c.id, c.saiuEntrega]));
  const atuais = entries.map((e) => (conf.has(e.id) && !e.saiuEntrega ? { ...e, saiuEntrega: conf.get(e.id) } : e));
  const ja = new Set(atuais.map((e) => e.id));
  return atuais.concat(a.novas.filter((n) => !ja.has(n.id)));
}

// ---------- rastreio ----------
// Valida código e link informados pelo usuário. Devolve { codigo, link } (já limpos) ou { erro }.
function validarRastreio(codigoIn, linkIn) {
  const limpo = (v) => String(v == null ? '' : v).trim();
  if ((codigoIn != null && typeof codigoIn !== 'string') || (linkIn != null && typeof linkIn !== 'string')) return { erro: 'Código e link precisam ser texto.' };
  const codigo = limpo(codigoIn), link = limpo(linkIn);
  if (!codigo && !link) return { erro: 'Informe o código ou o link de rastreio.' };
  if (/[\u0000-\u001f\u007f<>]/.test(codigo)) return { erro: 'O código tem caracteres que não são permitidos.' };
  if (codigo.length > 60) return { erro: 'O código pode ter no máximo 60 caracteres.' };
  if (link) {
    if (link.length > 500) return { erro: 'O link pode ter no máximo 500 caracteres.' };
    if (/[\s\u0000-\u001f\u007f<>"'\\]/.test(link)) return { erro: 'O link tem caracteres que não são permitidos.' };
    let u; try { u = new URL(link); } catch { return { erro: 'O link não é válido: cole o endereço completo, começando com https://.' }; }
    if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return { erro: 'O link precisa começar com https:// e não pode ter usuário ou senha.' };
  }
  return { codigo: codigo.replace(/\s+/g, ' '), link };
}
// campo vazio no pedido NÃO apaga o que já está guardado
function aplicarRastreio(entry, v, quem, agoraIso) {
  const ant = entry.rastreio || {};
  return { ...entry, rastreio: { codigo: v.codigo || ant.codigo || '', link: v.link || ant.link || '', por: quem, em: agoraIso } };
}

module.exports = {
  DIAS_DUP, DIAS_ENTREGA, MAX_DIAS, MAX_LISTA, MAX_EXPORTAR, SITUACOES, PENDENTES, CAMPOS_INFO, ORIGEM_IMPORTACAO,
  texto, semAcento, normalizarPedido, diaValido, diaDeValor, addDias, difDias, diasEntre, meioDiaSP, intervalo, normalizarEntrega,
  resumoDe, mesclarInfo, visaoEntrada, reconciliarInfo, transportadoraDiferente, indexarSaidas, desceuDe,
  montarRegistros, montarPainel, filtrar, paginar, linhasExportacao, palavrasDaBusca, planejarImportacao, aplicarAlteracao, validarRastreio, aplicarRastreio, publico
};
