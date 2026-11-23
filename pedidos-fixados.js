/* Pedidos fixados no painel inicial: acompanhar um pedido de perto, com aviso e alarme.
 *
 * - Fixados: lista compartilhada pela equipe (servidor, /api/pedidos-fixados). Pode fixar qualquer pedido, atrasado ou não.
 * - Atrasados entram sozinhos (status "Atrasado" da base), numa lista logo abaixo.
 * - Horário limite para sair p/ Expedição (hora de Brasília), em dias úteis: Retira 02, 03 e 04 até 16h; Brasil e São Paulo até 17h.
 *   Sem estar na Saída p/ Expedição até lá, o pedido fica "vencido" e o alarme repete a cada 30 min.
 * - Pedido fixado que aparece na Saída p/ Expedição gera um aviso ("saiu"); despachado (aba Entrega) fica como concluído.
 * - Alarme: faixa/aviso na tela, som e notificação do navegador (se permitida) enquanto o SC9 estiver aberto, em qualquer aba.
 *
 * A parte de lógica (sem tela) é testada em Node; a tela usa o React que já está na página.
 */
(function (root) {
  'use strict';

  const FUSO = 'America/Sao_Paulo';
  const semAcento = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  // Número do pedido comparável: só dígitos, sem zeros à esquerda (mesma regra do servidor).
  function numero(x) {
    const d = String(x == null ? '' : x).replace(/\D/g, '').replace(/^0+/, '');
    return d.length >= 4 && d.length <= 10 ? d : '';
  }

  // Horário limite (hora cheia, Brasília) para o pedido sair p/ Expedição, pela transportadora. null = sem limite.
  function limiteDaTransportadora(nome) {
    const n = semAcento(nome).replace(/\s+/g, ' ');
    if (/^retira 0?[234]$/.test(n)) return 16;
    if (n === 'brasil' || n === 'sao paulo') return 17;
    return null;
  }

  // Data e hora no fuso de Brasília: { dia: 'AAAA-MM-DD', min: minutos desde 0h, util: segunda a sexta }
  function relogio(data) {
    const d = data instanceof Date ? data : new Date(data);
    if (Number.isNaN(d.getTime())) return null;
    const p = {};
    for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(d)) p[x.type] = x.value;
    return { dia: p.year + '-' + p.month + '-' + p.day, min: Number(p.hour) * 60 + Number(p.minute), util: !['Sat', 'Sun'].includes(p.weekday) };
  }
  const ddmm = (dia) => dia.slice(8, 10) + '/' + dia.slice(5, 7);
  const hhmm = (min) => String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
  const faltam = (m) => (m >= 60 ? Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + String(m % 60).padStart(2, '0') + ' min' : '') : m + ' min');
  const diasEntre = (de, ate) => Math.round((Date.UTC(+ate.slice(0, 4), +ate.slice(5, 7) - 1, +ate.slice(8, 10)) - Date.UTC(+de.slice(0, 4), +de.slice(5, 7) - 1, +de.slice(8, 10))) / 864e5);

  const PASSOS = ['Separado', 'Conferido', 'Faturado', 'Saída p/ Expedição', 'Despachado'];
  const ETAPAS = {
    'nao-achado': { passo: 0, texto: 'Não está na base carregada' },
    aberto: { passo: 0, texto: 'Em separação' },
    separado: { passo: 1, texto: 'Separado, falta conferir' },
    conferido: { passo: 2, texto: 'Conferido, falta faturar' },
    faturado: { passo: 3, texto: 'Faturado, falta sair p/ Expedição' },
    saida: { passo: 4, texto: 'Na Saída p/ Expedição' },
    despachado: { passo: 5, texto: 'Despachado' }
  };
  const PESO = { vencido: 0, urgente: 1, atencao: 2, atrasado: 3, saiu: 4, ok: 5, info: 6, concluido: 7 };

  function etapaDoPedido(o, saidaIso) {
    if (o && o.status === 'Enviado') return 'despachado';
    if (saidaIso) return 'saida';
    if (!o) return 'nao-achado';
    if (o.nf) return 'faturado';
    if (o.pickEnd && o.confEnd) return 'conferido';
    if (o.pickEnd) return 'separado';
    return 'aberto';
  }

  // Situação de um pedido (fixado ou atrasado) neste momento. pin pode ser { pedido } ou null; o = pedido da base (ou undefined);
  // saidaIso = primeiro registro na Saída p/ Expedição (ISO) ou ''. opcoes.semLimite: ignora o horário limite (lista de atrasados).
  function avaliar(pin, o, saidaIso, agora, opcoes) {
    const rel = relogio(agora || new Date());
    const etapa = etapaDoPedido(o, saidaIso);
    const base = { pedido: pin ? pin.pedido : numero(o && o.pedido), pin: pin || null, ordem: o || null, etapa, passo: ETAPAS[etapa].passo, saidaIso: saidaIso || '', limite: null, minutos: null, dias: 0, atrasado: false };
    const atrasado = !!(o && o.status === 'Atrasado');
    const dias = atrasado && o.dayKey && rel ? Math.max(0, diasEntre(o.dayKey, rel.dia)) : 0;
    Object.assign(base, { atrasado, dias });
    const txtAtraso = ' · em atraso há ' + dias + (dias === 1 ? ' dia' : ' dias');
    if (etapa === 'despachado') return Object.assign(base, { nivel: 'concluido', texto: 'Despachado' });
    if (etapa === 'saida') {
      const r = relogio(saidaIso);
      const quando = r ? (r.dia === (rel && rel.dia) ? 'às ' + hhmm(r.min) : 'em ' + ddmm(r.dia) + ' às ' + hhmm(r.min)) : '';
      return Object.assign(base, { nivel: 'saiu', texto: 'Saiu p/ Expedição ' + quando, saidaHoje: !!(r && rel && r.dia === rel.dia) });
    }
    const limite = o && !(opcoes && opcoes.semLimite) ? limiteDaTransportadora(o.transpNome) : null;
    base.limite = limite;
    if (limite && rel) {
      if (!rel.util) return Object.assign(base, { nivel: atrasado ? 'atrasado' : 'info', texto: 'Limite das ' + limite + 'h só vale em dia útil' + (atrasado ? txtAtraso : '') });
      const m = limite * 60 - rel.min;
      base.minutos = m;
      if (m < 0) return Object.assign(base, { nivel: 'vencido', texto: 'Passou das ' + limite + 'h e ainda não saiu p/ Expedição' + (atrasado ? txtAtraso : '') });
      const txt = 'Faltam ' + faltam(m) + ' para o limite das ' + limite + 'h' + (atrasado ? txtAtraso : '');
      if (m <= 30) return Object.assign(base, { nivel: 'urgente', texto: txt });
      if (m <= 120) return Object.assign(base, { nivel: 'atencao', texto: txt });
      return Object.assign(base, { nivel: atrasado ? 'atrasado' : 'ok', texto: txt });
    }
    if (atrasado) return Object.assign(base, { nivel: 'atrasado', texto: 'Em atraso há ' + dias + (dias === 1 ? ' dia' : ' dias') + ' · ' + ETAPAS[etapa].texto.toLowerCase() });
    return Object.assign(base, { nivel: etapa === 'nao-achado' ? 'info' : 'ok', texto: ETAPAS[etapa].texto });
  }

  function ordenar(avaliacoes) {
    return avaliacoes.slice().sort((a, b) => (PESO[a.nivel] - PESO[b.nivel]) || ((a.minutos == null ? 1e9 : a.minutos) - (b.minutos == null ? 1e9 : b.minutos)) || (b.dias - a.dias) || String(a.pedido).localeCompare(String(b.pedido)));
  }

  // Avisos a disparar agora, sem repetir os que já foram dados (jaDisparados: Set de chaves).
  // Cada aviso: { chave, pedido, titulo, texto, grave }.
  function eventosDoAlarme(fixados, agora, jaDisparados, resumo) {
    const rel = relogio(agora);
    if (!rel) return [];
    const ja = jaDisparados || new Set();
    const novos = [];
    const add = (chave, pedido, titulo, texto, grave) => { if (!ja.has(chave)) novos.push({ chave, pedido, titulo, texto, grave: !!grave }); };
    if (resumo && resumo.total > 0) {
      const partes = [resumo.total + (resumo.total === 1 ? ' pedido fixado' : ' pedidos fixados')];
      if (resumo.comLimite) partes.push(resumo.comLimite + ' com limite hoje');
      if (resumo.vencidos) partes.push(resumo.vencidos + ' já vencido(s)');
      if (resumo.atrasados) partes.push(resumo.atrasados + ' em atraso na base');
      add(rel.dia + '|resumo', '', 'Pedidos fixados de hoje', partes.join(' · '), false);
    }
    for (const a of fixados) {
      const p = a.pedido;
      if (a.nivel === 'saiu' && a.saidaHoje) add(rel.dia + '|' + p + '|saiu', p, 'Pedido ' + p + ' saiu p/ Expedição', a.texto + (a.ordem && a.ordem.nome ? ' · ' + a.ordem.nome : ''), false);
      if (a.limite && a.minutos != null && a.etapa !== 'despachado' && a.etapa !== 'saida') {
        if (a.minutos < 0) add(rel.dia + '|' + p + '|v' + Math.floor(-a.minutos / 30), p, 'Pedido ' + p + ' VENCIDO', a.texto, true);
        else if (a.minutos <= 15) add(rel.dia + '|' + p + '|15', p, 'Pedido ' + p + ': faltam ' + a.minutos + ' min', a.texto, true);
        else if (a.minutos <= 60) add(rel.dia + '|' + p + '|60', p, 'Pedido ' + p + ': faltam ' + faltam(a.minutos), a.texto, false);
      }
    }
    return novos;
  }

  function resumoDosFixados(avaliacoes, totalAtrasados) {
    return {
      total: avaliacoes.length,
      comLimite: avaliacoes.filter((a) => a.limite && a.nivel !== 'concluido' && a.nivel !== 'saiu').length,
      vencidos: avaliacoes.filter((a) => a.nivel === 'vencido').length,
      atrasados: totalAtrasados || 0
    };
  }

  function mapaPorPedido(orders) {
    const m = new Map();
    for (const o of orders || []) { const n = numero(o.pedido); if (n && !m.has(n)) m.set(n, o); }
    return m;
  }

  const api = { limiteDaTransportadora, relogio, numero, etapaDoPedido, avaliar, ordenar, eventosDoAlarme, resumoDosFixados, mapaPorPedido, PASSOS, ETAPAS, PESO };

  /* ------------------------------------------------------------------ tela ------------------------------------------------------------------ */
  const React = root.React;
  if (React) {
    const h = React.createElement;
    const cor = { panel: '#FFFFFF', border: '#dde4ef', ink: '#14233d', mute: '#526079', accent: '#123b7a', soft: '#f3f6fb', red: '#c63828', amber: '#9b4b08', teal: '#0A8571' };
    const NIVEL = {
      vencido: { fundo: '#fdeceb', borda: '#c63828', texto: '#c63828', rotulo: 'VENCIDO' },
      urgente: { fundo: '#fdeceb', borda: '#c63828', texto: '#c63828', rotulo: 'URGENTE' },
      atencao: { fundo: '#fff4e5', borda: '#d98a1f', texto: '#9b4b08', rotulo: 'ATENÇÃO' },
      atrasado: { fundo: '#fff4e5', borda: '#d98a1f', texto: '#9b4b08', rotulo: 'EM ATRASO' },
      saiu: { fundo: '#e6f5f1', borda: '#0A8571', texto: '#0A8571', rotulo: 'SAIU P/ EXPEDIÇÃO' },
      ok: { fundo: '#f3f6fb', borda: '#dde4ef', texto: '#123b7a', rotulo: 'NO PRAZO' },
      info: { fundo: '#f3f6fb', borda: '#dde4ef', texto: '#526079', rotulo: 'ACOMPANHANDO' },
      concluido: { fundo: '#e6f5f1', borda: '#0A8571', texto: '#0A8571', rotulo: 'DESPACHADO' }
    };

    /* ---- dados compartilhados (lista do servidor), atualizados a cada 60 s ---- */
    const store = { itens: [], saidas: {}, carregado: false, erro: '', semAcesso: false, ouvintes: new Set(), timer: null };
    const emitir = () => store.ouvintes.forEach((f) => f());
    const aplicarResposta = (j) => { store.itens = Array.isArray(j.itens) ? j.itens : []; store.saidas = j.saidas || {}; store.carregado = true; store.erro = ''; emitir(); };
    async function pedir(opcoes) {
      const r = await fetch('/api/pedidos-fixados', Object.assign({ cache: 'no-store' }, opcoes, { headers: { 'X-SC9-App': '1', 'Content-Type': 'application/json' } }));
      if (r.status === 401 || r.status === 403) { store.semAcesso = true; emitir(); return null; }
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Não consegui falar com o servidor.');
      return j;
    }
    async function carregar() { try { const j = await pedir({}); if (j) aplicarResposta(j); } catch (e) { store.erro = e.message; emitir(); } }
    async function enviar(corpo) { const j = await pedir({ method: 'POST', body: JSON.stringify(corpo) }); if (j) aplicarResposta(j); return j; }
    function iniciar() { if (store.timer) return; carregar(); store.timer = setInterval(carregar, 60000); }
    function useStore() {
      const [, f] = React.useState(0);
      React.useEffect(() => { const l = () => f((x) => x + 1); store.ouvintes.add(l); return () => { store.ouvintes.delete(l); }; }, []);
      return store;
    }
    function useRelogio(ms) {
      const [agora, set] = React.useState(Date.now());
      React.useEffect(() => { const t = setInterval(() => set(Date.now()), ms); return () => clearInterval(t); }, [ms]);
      return agora;
    }

    /* ---- som e notificação ---- */
    const lerPref = (k, padrao) => { try { const v = root.localStorage.getItem(k); return v == null ? padrao : v; } catch (e) { return padrao; } };
    const gravarPref = (k, v) => { try { root.localStorage.setItem(k, v); } catch (e) { /* sem armazenamento: segue sem lembrar */ } };
    let audio = null;
    function bipe(grave) {
      if (lerPref('sc9-fixados-som', '1') !== '1') return;
      try {
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return;
        audio = audio || new AC();
        if (audio.state === 'suspended') audio.resume();
        const toques = grave ? [0, 0.32, 0.64] : [0];
        for (const t0 of toques) {
          const o = audio.createOscillator(), g = audio.createGain();
          o.type = 'sine'; o.frequency.value = grave ? 880 : 660;
          g.gain.setValueAtTime(0.0001, audio.currentTime + t0);
          g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + t0 + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t0 + 0.25);
          o.connect(g); g.connect(audio.destination); o.start(audio.currentTime + t0); o.stop(audio.currentTime + t0 + 0.27);
        }
      } catch (e) { /* navegador bloqueou o som: o aviso na tela continua */ }
    }
    function notificar(ev) {
      try { if (root.Notification && root.Notification.permission === 'granted') new root.Notification(ev.titulo, { body: ev.texto, tag: ev.chave, requireInteraction: ev.grave }); } catch (e) { /* sem notificação do sistema */ }
    }
    const jaAvisados = (() => { try { return new Set(JSON.parse(root.localStorage.getItem('sc9-fixados-avisados') || '[]')); } catch (e) { return new Set(); } })();
    const lembrar = (chaves) => { for (const c of chaves) jaAvisados.add(c); gravarPref('sc9-fixados-avisados', JSON.stringify(Array.from(jaAvisados).slice(-300))); };

    /* ---- alarme: roda em qualquer aba, enquanto o SC9 estiver aberto ---- */
    function Alarme(props) {
      const st = useStore();
      const agora = useRelogio(30000);
      const [avisos, setAvisos] = React.useState([]);
      const mapa = React.useMemo(() => mapaPorPedido(props.orders), [props.orders]);
      const atrasados = React.useMemo(() => (props.orders || []).filter((o) => o.status === 'Atrasado').length, [props.orders]);
      React.useEffect(() => { iniciar(); }, []);
      const fixados = React.useMemo(() => st.itens.map((pin) => avaliar(pin, mapa.get(pin.pedido), st.saidas[pin.pedido], new Date(agora))), [st.itens, st.saidas, mapa, agora]);
      React.useEffect(() => {
        if (!st.carregado || st.semAcesso) return;
        const novos = eventosDoAlarme(fixados, new Date(agora), jaAvisados, (props.orders || []).length ? resumoDosFixados(fixados, atrasados) : null);
        if (!novos.length) return;
        lembrar(novos.map((n) => n.chave));
        setAvisos((atual) => atual.concat(novos.map((n) => Object.assign({ id: n.chave + '@' + Date.now() }, n))));
        bipe(novos.some((n) => n.grave));
        novos.forEach(notificar);
      }, [fixados, st.carregado]);
      const fechar = (id) => setAvisos((a) => a.filter((x) => x.id !== id));
      React.useEffect(() => {
        const leves = avisos.filter((a) => !a.grave);
        if (!leves.length) return undefined;
        const t = setTimeout(() => setAvisos((a) => a.filter((x) => x.grave)), 30000);
        return () => clearTimeout(t);
      }, [avisos]);
      const criticos = fixados.filter((a) => a.nivel === 'vencido' || a.nivel === 'urgente');
      if (st.semAcesso) return null;
      return h('div', { style: { position: 'fixed', right: 16, bottom: 16, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360, pointerEvents: 'none' } },
        criticos.length ? h('div', { style: { pointerEvents: 'auto', background: cor.red, color: '#fff', borderRadius: 10, padding: '10px 14px', fontWeight: 700, fontSize: 13, boxShadow: '0 6px 20px rgba(0,0,0,.25)' }, role: 'status' },
          '⚠ ' + criticos.length + (criticos.length === 1 ? ' pedido fixado precisa' : ' pedidos fixados precisam') + ' de atenção agora: ' + criticos.slice(0, 4).map((c) => c.pedido).join(', ') + (criticos.length > 4 ? '…' : '')) : null,
        avisos.slice(-4).map((a) => h('div', { key: a.id, role: 'alert', style: { pointerEvents: 'auto', background: '#fff', borderLeft: '5px solid ' + (a.grave ? cor.red : cor.teal), borderRadius: 10, padding: '10px 12px', boxShadow: '0 6px 20px rgba(0,0,0,.2)', fontSize: 13, color: cor.ink } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8 } }, h('strong', null, (a.grave ? '⏰ ' : '📌 ') + a.titulo), h('button', { type: 'button', onClick: () => fechar(a.id), 'aria-label': 'Fechar aviso', style: { border: 0, background: 'transparent', cursor: 'pointer', fontSize: 16, lineHeight: 1, color: cor.mute } }, '×')),
          h('div', { style: { color: cor.mute, marginTop: 2 } }, a.texto))));
    }

    /* ---- peças da tela ---- */
    const chip = (texto, n, tom) => h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: n ? NIVEL[tom].fundo : cor.soft, color: n ? NIVEL[tom].texto : cor.mute, border: '1px solid ' + (n ? NIVEL[tom].borda : cor.border) } }, h('span', null, n), texto);
    const botao = (rotulo, onClick, extra) => h('button', Object.assign({ type: 'button', onClick, style: { border: '1px solid ' + cor.border, background: '#fff', color: cor.accent, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' } }, extra || {}), rotulo);

    function Passos({ passo }) {
      return h('div', { style: { display: 'flex', gap: 3, marginTop: 8 }, 'aria-label': 'Etapas do pedido' }, PASSOS.map((nome, i) => h('div', { key: nome, title: nome, style: { flex: 1 } },
        h('div', { style: { height: 5, borderRadius: 3, background: i < passo ? cor.teal : cor.border } }),
        h('div', { style: { fontSize: 9, marginTop: 2, color: i < passo ? cor.teal : cor.mute, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, nome))));
    }

    function Cartao({ a, onRemover, onNota, onAbrir }) {
      const n = NIVEL[a.nivel], o = a.ordem;
      const [editando, setEditando] = React.useState(false);
      const [nota, setNota] = React.useState(a.pin ? a.pin.nota : '');
      return h('div', { style: { background: n.fundo, border: '1px solid ' + n.borda, borderLeft: '5px solid ' + n.borda, borderRadius: 12, padding: 12 } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 } },
          h('div', null,
            h('div', { style: { fontSize: 10, fontWeight: 800, letterSpacing: '.06em', color: n.texto } }, n.rotulo),
            h('div', { style: { fontSize: 20, fontWeight: 800, color: cor.ink, lineHeight: 1.15 } }, a.pedido)),
          h('button', { type: 'button', onClick: () => onRemover(a.pedido), title: 'Desafixar este pedido', 'aria-label': 'Desafixar pedido ' + a.pedido, style: { border: 0, background: 'transparent', color: cor.mute, cursor: 'pointer', fontSize: 18, lineHeight: 1 } }, '✕')),
        o ? h('div', { style: { fontSize: 13, color: cor.ink, marginTop: 2, fontWeight: 600 } }, o.nome || 'Cliente não informado') : null,
        o ? h('div', { style: { fontSize: 12, color: cor.mute } }, [o.armazem, o.transpNome || 'sem transportadora', o.nf ? 'NF ' + String(o.nf).replace(/\.0$/, '') : 'sem nota', o.qt ? Math.round(Number(o.qt)).toLocaleString('pt-BR') + ' peças' : ''].filter(Boolean).join(' · ')) : null,
        h('div', { style: { fontSize: 13, fontWeight: 700, color: n.texto, marginTop: 6 } }, a.texto),
        a.limite && a.nivel !== 'concluido' && a.nivel !== 'saiu' ? h('div', { style: { fontSize: 11, color: cor.mute } }, 'Limite ' + a.limite + 'h (Brasília, dias úteis)') : null,
        h(Passos, { passo: a.passo }),
        h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' } },
          editando
            ? h('form', { onSubmit: (ev) => { ev.preventDefault(); onNota(a.pedido, nota); setEditando(false); }, style: { display: 'flex', gap: 6, flex: 1 } },
              h('input', { value: nota, maxLength: 120, autoFocus: true, onChange: (ev) => setNota(ev.target.value), placeholder: 'Observação', style: { flex: 1, minWidth: 0, border: '1px solid ' + cor.border, borderRadius: 6, padding: '4px 8px', fontSize: 12 } }),
              botao('Salvar', null, { type: 'submit' }))
            : h('span', { style: { fontSize: 12, color: cor.ink, flex: 1, minWidth: 0 } }, a.pin && a.pin.nota ? '📝 ' + a.pin.nota : h('span', { style: { color: cor.mute } }, 'Sem observação')),
          !editando ? botao('Observação', () => setEditando(true)) : null,
          o && onAbrir ? botao('Abrir pedido', () => onAbrir(o)) : null),
        a.pin && a.pin.por ? h('div', { style: { fontSize: 10, color: cor.mute, marginTop: 6 } }, 'Fixado por ' + a.pin.por) : null);
    }

    function Painel(props) {
      const st = useStore();
      const agora = useRelogio(30000);
      const [pedido, setPedido] = React.useState('');
      const [obs, setObs] = React.useState('');
      const [erro, setErro] = React.useState('');
      const [ocupado, setOcupado] = React.useState(false);
      const [verTodos, setVerTodos] = React.useState(false);
      const [busca, setBusca] = React.useState('');
      const [perm, setPerm] = React.useState(() => (root.Notification ? root.Notification.permission : 'unsupported'));
      const [som, setSom] = React.useState(() => lerPref('sc9-fixados-som', '1') === '1');
      React.useEffect(() => { iniciar(); }, []);
      const orders = props.orders || [];
      const mapa = React.useMemo(() => mapaPorPedido(orders), [orders]);
      const fixadosSet = React.useMemo(() => new Set(st.itens.map((x) => x.pedido)), [st.itens]);
      const fixados = React.useMemo(() => ordenar(st.itens.map((pin) => avaliar(pin, mapa.get(pin.pedido), st.saidas[pin.pedido], new Date(agora)))), [st.itens, st.saidas, mapa, agora]);
      const atrasados = React.useMemo(() => ordenar(orders.filter((o) => o.status === 'Atrasado' && !fixadosSet.has(numero(o.pedido))).map((o) => avaliar(null, o, st.saidas[numero(o.pedido)], new Date(agora), { semLimite: true }))), [orders, fixadosSet, st.saidas, agora]);
      if (st.semAcesso) return null;

      const executar = async (corpo) => {
        setOcupado(true); setErro('');
        try { await enviar(corpo); return true; } catch (e) { setErro(e.message); return false; } finally { setOcupado(false); }
      };
      const fixar = async (ev) => {
        ev.preventDefault();
        if (!numero(pedido)) { setErro('Digite o número do pedido (de 4 a 10 dígitos).'); return; }
        if (await executar({ acao: 'fixar', pedido, nota: obs })) { setPedido(''); setObs(''); }
      };
      const ativarAvisos = async () => {
        try { if (root.Notification) setPerm(await root.Notification.requestPermission()); } catch (e) { /* navegador sem suporte */ }
        bipe(false);
      };
      const alternarSom = () => { const novo = !som; setSom(novo); gravarPref('sc9-fixados-som', novo ? '1' : '0'); if (novo) bipe(false); };

      const cont = (nivel) => fixados.filter((a) => a.nivel === nivel).length;
      const termo = semAcento(busca);
      const listaAtrasados = atrasados.filter((a) => !termo || semAcento([a.pedido, a.ordem && a.ordem.nome, a.ordem && a.ordem.transpNome, a.ordem && a.ordem.armazem].join(' ')).includes(termo));
      const mostrados = verTodos || termo ? listaAtrasados : listaAtrasados.slice(0, 10);

      return h('section', { 'aria-label': 'Pedidos fixados e em atraso', style: { background: cor.panel, border: '1px solid ' + cor.border, borderRadius: 14, padding: 16, margin: '0 0 16px', color: cor.ink } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' } },
          h('div', null, h('h2', { style: { margin: 0, fontSize: 16, fontWeight: 800 } }, '📌 Pedidos fixados'), h('div', { style: { fontSize: 12, color: cor.mute } }, 'Os atrasados entram sozinhos. Retira 02/03/04 até 16h · Brasil e São Paulo até 17h (dias úteis, Brasília).')),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            chip('vencidos', cont('vencido') + cont('urgente'), 'vencido'), chip('em atenção', cont('atencao'), 'atencao'), chip('saíram p/ Expedição', cont('saiu'), 'saiu'), chip('atrasados na base', atrasados.length + fixados.filter((a) => a.atrasado).length, 'atrasado'))),
        h('form', { onSubmit: fixar, style: { display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' } },
          h('input', { value: pedido, inputMode: 'numeric', onChange: (ev) => setPedido(ev.target.value), placeholder: 'Nº do pedido para fixar', 'aria-label': 'Número do pedido para fixar', style: { border: '1px solid ' + cor.border, borderRadius: 8, padding: '7px 10px', fontSize: 13, width: 180 } }),
          h('input', { value: obs, maxLength: 120, onChange: (ev) => setObs(ev.target.value), placeholder: 'Observação (opcional)', 'aria-label': 'Observação do pedido', style: { border: '1px solid ' + cor.border, borderRadius: 8, padding: '7px 10px', fontSize: 13, flex: 1, minWidth: 160 } }),
          h('button', { type: 'submit', disabled: ocupado, style: { background: cor.accent, color: '#fff', border: 0, borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' } }, 'Fixar pedido'),
          perm !== 'granted' && perm !== 'unsupported' ? botao('🔔 Ativar avisos do navegador', ativarAvisos) : null,
          botao(som ? '🔊 Som ligado' : '🔇 Som desligado', alternarSom)),
        erro || st.erro ? h('div', { role: 'alert', style: { color: cor.red, fontSize: 12, marginTop: 6 } }, erro || st.erro) : null,
        !fixados.length && st.carregado ? h('div', { style: { fontSize: 13, color: cor.mute, margin: '14px 0 4px' } }, 'Nenhum pedido fixado. Digite o número acima (ou use "Fixar" na lista de atrasados) para acompanhar de perto e receber alarme.') : null,
        fixados.length ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(290px,1fr))', gap: 12, marginTop: 14 } },
          fixados.map((a) => h(Cartao, { key: a.pedido, a, onRemover: (p) => executar({ acao: 'remover', pedido: p }), onNota: (p, n) => executar({ acao: 'nota', pedido: p, nota: n }), onAbrir: props.onOpenOrder }))) : null,
        atrasados.length ? h('div', { style: { marginTop: 18 } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('h3', { style: { margin: 0, fontSize: 14, fontWeight: 800 } }, 'Em atraso (entram sozinhos) · ' + atrasados.length),
            h('input', { value: busca, onChange: (ev) => setBusca(ev.target.value), placeholder: 'Buscar pedido, cliente ou transportadora', 'aria-label': 'Buscar nos pedidos em atraso', style: { border: '1px solid ' + cor.border, borderRadius: 8, padding: '5px 10px', fontSize: 12, width: 250 } })),
          h('div', { style: { overflowX: 'auto', marginTop: 8 } }, h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 12 } },
            h('thead', null, h('tr', { style: { textAlign: 'left', color: cor.mute } }, ['Pedido', 'Cliente', 'Armazém', 'Transportadora', 'Situação', ''].map((t) => h('th', { key: t || 'acao', style: { padding: '6px 8px', borderBottom: '1px solid ' + cor.border, fontWeight: 700 } }, t)))),
            h('tbody', null, mostrados.map((a) => h('tr', { key: (a.ordem.armazem || '') + a.pedido, style: { borderBottom: '1px solid ' + cor.soft } },
              h('td', { style: { padding: '6px 8px', fontWeight: 800 } }, a.pedido),
              h('td', { style: { padding: '6px 8px', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: a.ordem.nome || '' }, a.ordem.nome || '—'),
              h('td', { style: { padding: '6px 8px' } }, a.ordem.armazem || '—'),
              h('td', { style: { padding: '6px 8px' } }, a.ordem.transpNome || '—'),
              h('td', { style: { padding: '6px 8px', color: NIVEL[a.nivel].texto, fontWeight: 700 } }, a.texto),
              h('td', { style: { padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' } }, botao('📌 Fixar', () => executar({ acao: 'fixar', pedido: a.pedido }), { disabled: ocupado }))))))),
          listaAtrasados.length > 10 && !termo ? h('div', { style: { marginTop: 8 } }, botao(verTodos ? 'Mostrar só os 10 primeiros' : 'Ver todos os ' + listaAtrasados.length, () => setVerTodos(!verTodos))) : null,
          !listaAtrasados.length ? h('div', { style: { fontSize: 12, color: cor.mute, marginTop: 8 } }, 'Nenhum pedido em atraso com essa busca.') : null) : null);
    }

    api.Painel = Painel;
    api.Alarme = Alarme;
  }

  root.SC9PedidosFixados = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
