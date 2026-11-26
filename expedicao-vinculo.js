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
// Troca de transportadora ("era Retira 4, saiu como Brasil"): a EFETIVA é transportadoraSaiu.para; a original (SC9/Entrega) nunca é alterada.
const trocaAtual = (entry) => (entry && entry.transportadoraSaiu && texto(entry.transportadoraSaiu.para, 60) ? entry.transportadoraSaiu : null);
function visaoEntrada(entry, base) {
  const m = mesclarInfo(entry.info, base);
  let info = m.info;
  if (entry.saiuEntrega && entry.saiuEntrega.transportadora && !(info && info.transportadora)) info = { ...(info || {}), transportadora: entry.saiuEntrega.transportadora };
  const semDado = entry.semDadoSC9 && !base ? true : (base ? false : Boolean(entry.semDadoSC9));
  const troca = trocaAtual(entry);
  const extra = {};
  if (troca) {
    const original = info && info.transportadora ? info.transportadora : '';
    info = { ...(info || {}), transportadora: texto(troca.para, 60) };
    extra.transportadoraOriginal = original; extra.trocada = chaveTransp(troca.para) !== chaveTransp(original); // a leitura mostra a efetiva em info.transportadora
  }
  return { ...entry, info, semDadoSC9: semDado, aguardandoNota: vazio(info && info.nf), ...extra };
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
        transportadoraDiferente: Boolean(e.saiuEntrega) && transportadoraDiferente(trocaAtual(e) ? trocaAtual(e).para : (e.info && e.info.transportadora ? e.info.transportadora : (resolver(e.pedido) || {}).transportadora), transpEntrega),
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

// =====================================================================================================================
// Expedição em 3 abas (Bipar · Planilha de entrega · Entregas/POD). Tudo PURO. Campos novos das entradas (todos opcionais, só se acrescenta):
//   observacoes[{texto,por,nome,em}] (máx. 30) · transportadoraSaiu{de,para,motivo,por,nome,em} + trocas[] (todas as trocas, máx. 20)
//   impressoes[{listaId,em,por,nome,transportadora}] (máx. 10) · pod{status,link,codigo,fotoConfere,obs,verificadoPor,verificadoNome,verificadoEm} + podHistorico[] (máx. 20)
// =====================================================================================================================
const MAX_OBSERVACOES = 30, MAX_TROCAS = 20, MAX_IMPRESSOES = 10, MAX_POD_HISTORICO = 20;
const MAX_PLANILHA = 2000, MAX_TROCA_LOTE = 200, MAX_TEXTO_OBS = 400;
const POD_STATUS = ['pendente', 'entregue', 'divergente', 'nao_entregue'];
const POD_FOTO = ['', 'sim', 'nao', 'nao_vi'];
const SITUACOES_PLANILHA = ['recebido', 'saiu', 'nao_sai_hoje'];
const ID_RE = /^[A-Za-z0-9_.-]{1,80}$/;
const ANTI_REPETIR_MS = 30000; // o mesmo texto, da mesma pessoa, em menos de 30 s é duplo clique: não duplica
const CONTROLE_RE = /[\u0000-\u001f\u007f]/;
const idValido = (id) => typeof id === 'string' && ID_RE.test(id);

// quais perfis dão acesso a quê. recebimento = bipar + planilha; despacho = planilha + importar da Entrega; administrador = tudo.
function acessoDe(role, perfis) {
  const admin = role === 'admin', p = Array.isArray(perfis) ? perfis : [], tem = (x) => p.includes(x);
  return {
    admin,
    bipar: admin || tem('recebimento') || tem('exp_bipar'),
    planilha: admin || tem('recebimento') || tem('despacho') || tem('exp_planilha'),
    pod: admin || tem('exp_pod'),
    importar: admin || tem('despacho')
  };
}

// ---------- validações de entrada ----------
function textoLivre(v, min, max, rotulo) {
  if (typeof v !== 'string') return { erro: rotulo + ': escreva um texto.' };
  const t = v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length < min) return { erro: min <= 1 ? rotulo + ': escreva alguma coisa.' : rotulo + ': escreva pelo menos ' + min + ' letras.' };
  if (t.length > max) return { erro: rotulo + ': no máximo ' + max + ' caracteres.' };
  return { texto: t };
}
function validarObservacao(v) {
  const r = textoLivre(v, 1, MAX_TEXTO_OBS, 'Observação');
  return r.erro ? r : { texto: r.texto };
}
function validarTroca(paraIn, motivoIn) {
  if (typeof paraIn !== 'string') return { erro: 'Informe a transportadora em que o pedido saiu.' };
  if (CONTROLE_RE.test(paraIn)) return { erro: 'A transportadora tem caracteres que não são permitidos.' };
  const para = texto(paraIn, 200);
  if (!para) return { erro: 'Informe a transportadora em que o pedido saiu.' };
  if (para.length > 40) return { erro: 'O nome da transportadora pode ter no máximo 40 caracteres.' };
  if (/[<>]/.test(para)) return { erro: 'A transportadora tem caracteres que não são permitidos.' };
  const m = textoLivre(motivoIn, 3, 200, 'Motivo da troca');
  if (m.erro) return { erro: 'O motivo da troca é obrigatório (de 3 a 200 letras).' };
  return { para, motivo: m.texto };
}
function validarLinkHttps(link) {
  if (link.length > 500) return 'O link pode ter no máximo 500 caracteres.';
  if (/[\s\u0000-\u001f\u007f<>"'\\]/.test(link)) return 'O link tem caracteres que não são permitidos.';
  let u; try { u = new URL(link); } catch { return 'O link não é válido: cole o endereço completo, começando com https://.'; }
  if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return 'O link precisa começar com https:// e não pode ter usuário ou senha.';
  return '';
}
// POD: status obrigatório; link só https; código/obs limitados. Devolve { status, link, codigo, fotoConfere, obs } ou { erro }.
function validarPod(b) {
  const o = b && typeof b === 'object' ? b : {};
  if (typeof o.status !== 'string' || !POD_STATUS.includes(o.status)) return { erro: 'Status inválido: use pendente, entregue, divergente ou não entregue.' };
  for (const k of ['link', 'codigo', 'fotoConfere', 'obs']) if (o[k] != null && typeof o[k] !== 'string') return { erro: 'O campo "' + k + '" precisa ser texto.' };
  const link = String(o.link == null ? '' : o.link).trim(), codigo = String(o.codigo == null ? '' : o.codigo).trim();
  const fotoConfere = String(o.fotoConfere == null ? '' : o.fotoConfere).trim();
  if (!POD_FOTO.includes(fotoConfere)) return { erro: 'A conferência da foto deve ser sim, não ou não vi.' };
  if (link) { const e = validarLinkHttps(link); if (e) return { erro: e }; }
  if (CONTROLE_RE.test(codigo) || /[<>]/.test(codigo)) return { erro: 'O código tem caracteres que não são permitidos.' };
  if (codigo.length > 60) return { erro: 'O código pode ter no máximo 60 caracteres.' };
  let obs = '';
  if (o.obs != null && String(o.obs).trim() !== '') { const r = textoLivre(o.obs, 1, MAX_TEXTO_OBS, 'Observação'); if (r.erro) return { erro: r.erro }; obs = r.texto; }
  return { status: o.status, link, codigo: codigo.replace(/\s+/g, ' '), fotoConfere, obs };
}

// ---------- gravação (puras: devolvem a entrada nova; nunca mexem na original) ----------
const ultimos = (lista, max) => (lista.length > max ? lista.slice(lista.length - max) : lista);
// acrescenta uma observação. Devolve { entry } | { entry, semMudanca:true } (duplo clique) | { erro }.
function aplicarObservacao(entry, texto_, por, nome, agoraIso) {
  const lista = Array.isArray(entry.observacoes) ? entry.observacoes : [];
  const ult = lista[lista.length - 1];
  if (ult && ult.por === por && ult.texto === texto_ && Math.abs(new Date(agoraIso).getTime() - new Date(ult.em).getTime()) < ANTI_REPETIR_MS) return { entry, semMudanca: true };
  if (lista.length >= MAX_OBSERVACOES) return { erro: 'Esse pedido já tem ' + MAX_OBSERVACOES + ' observações. Não dá para acrescentar mais.' };
  return { entry: { ...entry, observacoes: [...lista, { texto: texto_, por, nome, em: agoraIso }] } };
}
// troca a transportadora em que o pedido SAIU. `efetivaAntes` = a que valia (visão). Devolve { entry } | { entry, semMudanca:true } | { erro }.
function aplicarTroca(entry, efetivaAntes, v, por, nome, agoraIso) {
  const atual = trocaAtual(entry);
  const de = texto(efetivaAntes, 60);
  if (chaveTransp(de) === chaveTransp(v.para)) return { entry, semMudanca: true }; // já está nessa transportadora (duplo clique)
  const reg = { de, para: v.para, motivo: v.motivo, por, nome, em: agoraIso };
  const hist = Array.isArray(entry.trocas) ? entry.trocas : [];
  // entrada que já tinha troca gravada sem histórico (não deveria): preserva a atual antes de empilhar a nova
  const base = atual && !hist.length ? [atual] : hist;
  return { entry: { ...entry, transportadoraSaiu: reg, trocas: ultimos([...base, reg], MAX_TROCAS) } };
}
function aplicarImpressao(entry, reg) {
  const hist = Array.isArray(entry.impressoes) ? entry.impressoes : [];
  return { ...entry, impressoes: ultimos([...hist, reg], MAX_IMPRESSOES) };
}
// grava o POD e acrescenta ao histórico. Link/código vazios NÃO apagam o que já estava guardado. Devolve { entry } | { entry, semMudanca:true }.
function aplicarPod(entry, v, por, nome, agoraIso) {
  const ant = entry.pod || null;
  const novo = {
    status: v.status, link: v.link || (ant && ant.link) || '', codigo: v.codigo || (ant && ant.codigo) || '', fotoConfere: v.fotoConfere, obs: v.obs,
    verificadoPor: por, verificadoNome: nome, verificadoEm: agoraIso
  };
  if (ant && ant.status === novo.status && ant.link === novo.link && ant.codigo === novo.codigo && ant.fotoConfere === novo.fotoConfere && ant.obs === novo.obs) return { entry, semMudanca: true };
  const hist = Array.isArray(entry.podHistorico) ? entry.podHistorico : [];
  const h = { status: v.status, por, nome, em: agoraIso, obs: v.obs, fotoConfere: v.fotoConfere, link: novo.link, codigo: novo.codigo };
  return { entry: { ...entry, pod: novo, podHistorico: ultimos([...hist, h], MAX_POD_HISTORICO) } };
}

// ---------- Planilha de entrega (um dia) ----------
const volumeDe = (e) => (e.volumes !== null && e.volumes !== '' && e.volumes !== undefined && Number.isFinite(Number(e.volumes)) ? Number(e.volumes) : null);
const ultimaObs = (e) => { const l = Array.isArray(e.observacoes) ? e.observacoes : []; return l.length ? texto(l[l.length - 1].texto, MAX_TEXTO_OBS) : ''; };
const podStatusDe = (e) => (e.pod && POD_STATUS.includes(e.pod.status) ? e.pod.status : 'pendente');
function linhaPlanilha(e, base, dia) {
  const v = visaoEntrada(e, base);
  const info = v.info || {};
  const imp = Array.isArray(e.impressoes) && e.impressoes.length ? e.impressoes[e.impressoes.length - 1] : null;
  const troca = trocaAtual(e);
  const tr = texto(info.transportadora, 60);
  return {
    id: e.id || '', pedido: e.pedido, data: dia, nf: texto(info.nf, 20), aguardandoNota: v.aguardandoNota, cliente: texto(info.cliente, 80), armazem: texto(info.armazem, 40),
    transportadora: tr, transportadoraOriginal: troca ? texto(v.transportadoraOriginal, 60) : tr, trocada: Boolean(troca && v.trocada),
    troca: troca ? { de: texto(troca.de, 60), para: texto(troca.para, 60), motivo: texto(troca.motivo, 200), por: troca.por || '', nome: troca.nome || '', em: troca.em || '' } : null,
    trocas: Array.isArray(e.trocas) ? e.trocas : (troca ? [troca] : []),
    volumes: volumeDe(e), observacao: ultimaObs(e), observacoes: Array.isArray(e.observacoes) ? e.observacoes : [],
    bipadoEm: e.recebidoEm || null, bipadoPor: texto(e.recebidoPorNome || e.recebidoPorUsuario, 60), origem: e.origem === 'entrega' ? 'entrega' : 'bipe', horaEstimada: e.horaEstimada === true,
    situacao: e.saiuEntrega ? 'saiu' : e.naoSaiHoje ? 'nao_sai_hoje' : 'recebido',
    saiuEntrega: e.saiuEntrega ? { em: e.saiuEntrega.em || null, dataEntrega: diaDeValor(e.saiuEntrega.dataEntrega) || null, transportadora: texto(e.saiuEntrega.transportadora, 60) || null } : null,
    impressoEm: imp ? imp.em || null : null, podStatus: podStatusDe(e)
  };
}
const nomeTransp = (n) => texto(n, 40) || 'Sem transportadora';
const casaTransp = (nome, chaves) => { const k = chaveTransp(nome); return chaves.some((c) => (c === '' ? k === '' : c === k)); };
// chaves de filtro a partir dos nomes pedidos ("Sem transportadora" casa com vazio)
const chavesDeNomes = (lista) => (Array.isArray(lista) ? lista : []).map((n) => (/^sem transportadora$/i.test(texto(n, 60)) ? '' : chaveTransp(n)));
function planilhaDoDia(o) {
  const { dia } = o, f = o.filtros || {};
  const resolver = typeof o.resolver === 'function' ? o.resolver : () => null;
  const todas = (o.entries || []).filter((e) => e && e.pedido).map((e) => linhaPlanilha(e, resolver(e.pedido), dia));
  todas.sort((a, b) => String(a.bipadoEm || '').localeCompare(String(b.bipadoEm || '')) || a.pedido.localeCompare(b.pedido) || String(a.id).localeCompare(String(b.id)));
  const palavras = f.q ? palavrasDaBusca(f.q) : [];
  const chaves = f.transportadoras && f.transportadoras.length ? chavesDeNomes(f.transportadoras) : null;
  const semTransp = todas.filter((r) => {
    if (f.situacao && r.situacao !== f.situacao) return false;
    if (palavras.length) { const p = semAcento([r.pedido, r.nf, r.cliente, r.transportadora, r.transportadoraOriginal, r.armazem, r.bipadoPor, r.observacao].filter(Boolean).join(' ')); if (!palavras.every((w) => p.includes(w))) return false; }
    return true;
  });
  const filtradas = chaves ? semTransp.filter((r) => casaTransp(r.transportadora, chaves)) : semTransp;
  const grupos = new Map(); // os chips mostram todas as transportadoras do dia (já filtrado por busca/situação), mesmo as não marcadas
  for (const r of semTransp) {
    const k = chaveTransp(r.transportadora);
    if (!grupos.has(k)) grupos.set(k, { nome: nomeTransp(r.transportadora), total: 0, volumes: 0, impressos: 0 });
    const g = grupos.get(k); g.total++; g.volumes += r.volumes || 0; if (r.impressoEm) g.impressos++;
  }
  const transportadoras = [...grupos.values()].map((g) => ({ ...g, volumes: Math.round(g.volumes * 100) / 100 })).sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'));
  const truncado = filtradas.length > MAX_PLANILHA;
  const linhas = truncado ? filtradas.slice(0, MAX_PLANILHA) : filtradas;
  const totais = {
    pedidos: linhas.length, volumes: Math.round(linhas.reduce((s, r) => s + (r.volumes || 0), 0) * 100) / 100, aguardandoNota: linhas.filter((r) => r.aguardandoNota).length,
    trocadas: linhas.filter((r) => r.trocada).length, impressos: linhas.filter((r) => r.impressoEm).length
  };
  return { dia, hoje: o.hoje || null, geradoEm: o.geradoEm || null, baseEntregaEm: o.baseEntregaEm || null, linhas, transportadoras, totais, truncado };
}

// ---------- Lista de saída (para a transportadora assinar) ----------
const FMT_HORA_SP = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
// L-AAAAMMDD-HHMMSS-xxxx (data/hora de São Paulo de quando a lista foi gerada; xxxx = 4 letras/números sorteados pelo servidor)
function gerarListaId(agora, sufixo) {
  const d = FMT_HORA_SP.format(agora).replace(/\D/g, '');
  return 'L-' + d.slice(0, 8) + '-' + d.slice(8, 14) + '-' + String(sufixo || '0000').toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(4, '0').slice(0, 4);
}
// linhas = linhas da planilha do dia (SEM filtro). Seleção: ids (todos precisam ser do dia) OU transportadoras. Devolve { lista, selecionadas:[{id,transportadora}] } ou { erro }.
function montarLista(o) {
  const { dia, linhas, ids, transportadoras } = o;
  const agora = o.agora instanceof Date ? o.agora : new Date();
  const temIds = ids !== undefined && ids !== null, temT = transportadoras !== undefined && transportadoras !== null;
  if (temIds === temT) return { erro: 'Informe os pedidos (ids) OU as transportadoras da lista.' };
  let sel;
  if (temIds) {
    if (!Array.isArray(ids) || !ids.length) return { erro: 'Marque pelo menos um pedido.' };
    if (ids.length > MAX_PLANILHA) return { erro: 'Pedidos demais de uma vez (máximo ' + MAX_PLANILHA + ').' };
    if (!ids.every(idValido)) return { erro: 'Há um pedido com identificador inválido.' };
    const unicos = [...new Set(ids)];
    const mapa = new Map(linhas.map((l) => [l.id, l]));
    if (!unicos.every((id) => mapa.has(id))) return { erro: 'Há pedido(s) que não são do dia ' + dia + '. Atualize a planilha e tente de novo.' };
    const quer = new Set(unicos);
    sel = linhas.filter((l) => quer.has(l.id)); // na ordem da planilha (hora do bipe), não na ordem em que foram marcados
  } else {
    if (!Array.isArray(transportadoras) || !transportadoras.length || transportadoras.length > 30) return { erro: 'Escolha de 1 a 30 transportadoras.' };
    if (!transportadoras.every((t) => typeof t === 'string' && t.length <= 60 && !CONTROLE_RE.test(t))) return { erro: 'Transportadora inválida.' };
    const chaves = chavesDeNomes(transportadoras);
    sel = linhas.filter((l) => casaTransp(l.transportadora, chaves));
    if (!sel.length) return { erro: 'Não há pedidos dessas transportadoras no dia ' + dia + '.' };
  }
  const grupos = new Map();
  for (const l of sel) {
    const k = chaveTransp(l.transportadora);
    if (!grupos.has(k)) grupos.set(k, { transportadora: nomeTransp(l.transportadora), totalPedidos: 0, totalVolumes: 0, linhas: [] });
    const g = grupos.get(k);
    g.totalPedidos++; g.totalVolumes += l.volumes || 0;
    g.linhas.push({ id: l.id, pedido: l.pedido, nf: l.nf, aguardandoNota: l.aguardandoNota, cliente: l.cliente, volumes: l.volumes, observacao: l.observacao });
  }
  const lista = [...grupos.values()].sort((a, b) => a.transportadora.localeCompare(b.transportadora, 'pt-BR'));
  for (const g of lista) g.totalVolumes = Math.round(g.totalVolumes * 100) / 100;
  const listaId = o.listaId || gerarListaId(agora, o.sufixo);
  return {
    lista: { listaId, geradoEm: agora.toISOString(), geradoPor: o.geradoPor || '', dia, totalPedidos: sel.length, totalVolumes: Math.round(lista.reduce((s, g) => s + g.totalVolumes, 0) * 100) / 100, grupos: lista },
    selecionadas: sel.map((l) => ({ id: l.id, transportadora: nomeTransp(l.transportadora) }))
  };
}

// ---------- Entregas (POD) ----------
const PADRAO_DIAS_ENTREGAS = 15;
function intervaloEntregas(deIn, ateIn, hoje) {
  const ateOk = ateIn != null && ateIn !== '' && diaValido(ateIn) ? (ateIn > hoje ? hoje : ateIn) : hoje;
  return intervalo(deIn == null || deIn === '' ? addDias(ateOk, -(PADRAO_DIAS_ENTREGAS - 1)) : deIn, ateIn, hoje);
}
const diaSaida = (e, dia) => {
  const d = e.saiuEntrega ? diaDeValor(e.saiuEntrega.dataEntrega) : '';
  if (d) return d;
  const imp = Array.isArray(e.impressoes) && e.impressoes.length ? e.impressoes[e.impressoes.length - 1] : null;
  return (imp && diaDeValor(imp.em)) || dia;
};
function saiu(e) { return Boolean(e.saiuEntrega) || (Array.isArray(e.impressoes) && e.impressoes.length > 0) || Boolean(e.pod); }
function entregasPod(o) {
  const { de, ate } = o, f = o.filtros || {};
  const recebPorDia = o.recebPorDia || {}, resolver = typeof o.resolver === 'function' ? o.resolver : () => null;
  const kT = f.transportadora ? (/^sem transportadora$/i.test(texto(f.transportadora, 60)) ? '' : chaveTransp(f.transportadora)) : null;
  const palavras = f.q ? palavrasDaBusca(f.q) : [];
  const resumo = { pendente: 0, entregue: 0, divergente: 0, nao_entregue: 0 };
  const todas = [];
  for (const dia of diasEntre(de, ate)) {
    for (const e of recebPorDia[dia] || []) {
      if (!e || !e.pedido || !saiu(e)) continue;
      const v = visaoEntrada(e, resolver(e.pedido)), info = v.info || {};
      const tr = texto(info.transportadora, 60);
      if (kT !== null && chaveTransp(tr) !== kT) continue;
      const rast = e.rastreio && (e.rastreio.codigo || e.rastreio.link) ? { codigo: texto(e.rastreio.codigo, 60), link: texto(e.rastreio.link, 500) } : null;
      const pod = e.pod ? { ...e.pod, status: podStatusDe(e) } : null;
      const l = {
        id: e.id || '', dia, pedido: e.pedido, nf: texto(info.nf, 20), aguardandoNota: v.aguardandoNota, cliente: texto(info.cliente, 80), transportadora: tr, volumes: volumeDe(e),
        dataSaida: diaSaida(e, dia), rastreio: rast, pod, podStatus: podStatusDe(e), podHistorico: Array.isArray(e.podHistorico) ? e.podHistorico : [], observacao: ultimaObs(e), recebidoEm: e.recebidoEm || null
      };
      if (palavras.length) { const p = semAcento([l.pedido, l.nf, l.cliente, l.transportadora, rast && rast.codigo, pod && pod.codigo].filter(Boolean).join(' ')); if (!palavras.every((w) => p.includes(w))) continue; }
      resumo[l.podStatus]++;
      todas.push(l);
    }
  }
  const filtradas = f.status ? todas.filter((l) => l.podStatus === f.status) : todas;
  filtradas.sort((a, b) => b.dataSaida.localeCompare(a.dataSaida) || b.dia.localeCompare(a.dia) || String(b.recebidoEm || '').localeCompare(String(a.recebidoEm || '')) || a.pedido.localeCompare(b.pedido));
  const lim = Math.min(Math.max(1, o.limite || 100), 500), pg = Math.max(1, o.pagina || 1);
  return { de, ate, total: filtradas.length, pagina: pg, limite: lim, paginas: Math.max(1, Math.ceil(filtradas.length / lim)), resumo, linhas: filtradas.slice((pg - 1) * lim, pg * lim).map(({ recebidoEm, ...l }) => l) };
}

module.exports = {
  DIAS_DUP, DIAS_ENTREGA, MAX_DIAS, MAX_LISTA, MAX_EXPORTAR, SITUACOES, PENDENTES, CAMPOS_INFO, ORIGEM_IMPORTACAO,
  texto, semAcento, normalizarPedido, diaValido, diaDeValor, addDias, difDias, diasEntre, meioDiaSP, intervalo, normalizarEntrega,
  resumoDe, mesclarInfo, visaoEntrada, reconciliarInfo, transportadoraDiferente, indexarSaidas, desceuDe,
  montarRegistros, montarPainel, filtrar, paginar, linhasExportacao, palavrasDaBusca, planejarImportacao, aplicarAlteracao, validarRastreio, aplicarRastreio, publico,
  // 3 abas
  MAX_OBSERVACOES, MAX_TROCAS, MAX_IMPRESSOES, MAX_POD_HISTORICO, MAX_PLANILHA, MAX_TROCA_LOTE, POD_STATUS, POD_FOTO, SITUACOES_PLANILHA, chaveTransp, trocaAtual, idValido,
  acessoDe, validarObservacao, validarTroca, validarPod, aplicarObservacao, aplicarTroca, aplicarImpressao, aplicarPod,
  planilhaDoDia, gerarListaId, montarLista, intervaloEntregas, entregasPod
};
