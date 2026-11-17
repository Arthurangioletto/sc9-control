/* Análise de gaveta — tela para celular e tablet (admin também carrega as bases por aqui). */
(function (root) {
  const Core = root.SC9GavetaCore;
  const React = root.React;
  const { useState, useEffect, useMemo, useRef, useCallback } = React;
  const h = React.createElement;

  // ---------- utilidades ----------
  async function api(path, body) {
    const response = await fetch(path, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json', 'X-Sc9-App': '1' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || 'Erro ' + response.status);
    return data;
  }
  const num = value => Number(value || 0).toLocaleString('pt-BR');
  const fmtDate = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '—';
  const fmtShort = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '';
  const fmtTime = iso => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  const fmtDay = iso => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
  const clock = seconds => String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
  const uuid = () => root.crypto?.randomUUID ? root.crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  const store = {
    get(key) { try { return JSON.parse(root.localStorage.getItem(key)); } catch { return null; } },
    set(key, value) { try { root.localStorage.setItem(key, JSON.stringify(value)); } catch { /* sem armazenamento */ } },
    del(key) { try { root.localStorage.removeItem(key); } catch { /* sem armazenamento */ } }
  };
  const hoursLeft = (iso, now) => Math.max(0, (Date.parse(iso) - Date.parse(now)) / 3600000);

  function Chip({ tone, children, title }) {
    return h('span', { className: 'sc9g-chip sc9g-' + tone, title }, children);
  }
  function ValidityChip({ iso, today }) {
    const info = Core.validity(iso, today);
    return h(Chip, { tone: info.tone }, info.key === 'sem' ? info.label : info.label + ' · ' + fmtDate(iso));
  }
  const Button = ({ kind = 'ghost', ...props }) => h('button', { type: 'button', ...props, className: 'sc9g-btn sc9g-btn-' + kind + (props.className ? ' ' + props.className : '') });

  // ---------- topo e avisos ----------
  function BaseBanner({ data, isAdmin, goBases }) {
    const sb8 = data.bases.sb8;
    if (!sb8.presente) {
      return h('div', { className: 'sc9g-banner sc9g-banner-red', role: 'alert' },
        h('span', null, h('strong', null, 'SB8 de hoje não carregado.'), ' ', isAdmin ? 'Carregue o SB8 para liberar a análise.' : 'Peça ao administrador para carregar o SB8.'),
        isAdmin && h(Button, { kind: 'light', onClick: goBases }, 'Carregar agora'));
    }
    const left = hoursLeft(sb8.expiresAt, data.agora);
    return h('div', { className: 'sc9g-banner ' + (left < 3 ? 'sc9g-banner-amber' : 'sc9g-banner-ok'), role: 'status' },
      h('span', null, 'SB8 carregado às ', h('strong', null, fmtTime(sb8.updatedAt)), ' de ', fmtDay(sb8.updatedAt), ' · some em ', h('strong', null, left < 1 ? 'menos de 1h' : Math.floor(left) + 'h')),
      isAdmin && left < 3 && h(Button, { kind: 'light', onClick: goBases }, 'Atualizar'));
  }

  // ---------- lista de gavetas ----------
  function GavetaList({ data, onOpen }) {
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState('faltam');
    const [kind, setKind] = useState('gaveta');
    const [limit, setLimit] = useState(60);
    // Armários (ZARM…) têm dezenas de produtos: ficam separados das gavetas.
    const scope = useMemo(() => data.gavetas.filter(item => kind === 'todos' || (kind === 'armario') === Core.isArmario(item.codigo)), [data, kind]);
    const kindCounts = useMemo(() => ({
      gaveta: data.gavetas.filter(item => !Core.isArmario(item.codigo)).length,
      armario: data.gavetas.filter(item => Core.isArmario(item.codigo)).length,
      todos: data.gavetas.length
    }), [data]);
    const counts = useMemo(() => ({
      faltam: scope.filter(item => !item.ultima).length,
      feitas: scope.filter(item => item.ultima).length,
      todas: scope.length
    }), [scope]);
    const rows = useMemo(() => {
      const q = Core.upper(query);
      return scope.filter(item => (filter === 'todas' || (filter === 'faltam') === !item.ultima) &&
        (!q || item.codigo.includes(q) || item.armario.includes(q)));
    }, [scope, query, filter]);
    useEffect(() => setLimit(60), [query, filter, kind]);
    const blocked = !data.bases.sb8.presente;
    return h('div', { className: 'sc9g-stack' },
      h('input', { className: 'sc9g-input sc9g-search', type: 'search', inputMode: 'search', autoCapitalize: 'characters', placeholder: 'Buscar gaveta ou armário', value: query, onChange: event => setQuery(event.target.value), 'aria-label': 'Buscar gaveta' }),
      kindCounts.armario > 0 && h('div', { className: 'sc9g-seg', role: 'tablist', 'aria-label': 'Tipo de endereço' }, [['gaveta', 'Gavetas'], ['armario', 'Armários'], ['todos', 'Ambos']].map(([id, label]) =>
        h('button', { key: id, type: 'button', role: 'tab', 'aria-selected': kind === id, className: kind === id ? 'is-on' : '', onClick: () => setKind(id) }, label, h('span', null, num(kindCounts[id]))))),
      h('div', { className: 'sc9g-seg', role: 'tablist' }, [['faltam', 'Faltam'], ['feitas', 'Analisadas'], ['todas', 'Todas']].map(([id, label]) =>
        h('button', { key: id, type: 'button', role: 'tab', 'aria-selected': filter === id, className: filter === id ? 'is-on' : '', onClick: () => setFilter(id) }, label, h('span', null, num(counts[id]))))),
      !data.gavetas.length && h('p', { className: 'sc9g-empty' }, 'Nenhuma gaveta cadastrada. O administrador precisa carregar o ZZ2.'),
      data.gavetas.length > 0 && !rows.length && h('p', { className: 'sc9g-empty' }, filter === 'faltam' && !query ? 'Todas as gavetas já foram analisadas.' : 'Nenhuma gaveta encontrada.'),
      h('ul', { className: 'sc9g-list' }, rows.slice(0, limit).map(item => h('li', { key: item.id },
        h('button', { type: 'button', className: 'sc9g-row', onClick: () => onOpen(item), disabled: blocked },
          h('span', { className: 'sc9g-row-main' },
            h('strong', null, item.codigo),
            h('small', null, (item.armario ? 'Armário ' + item.armario + ' · ' : '') + num(item.itens) + (item.itens === 1 ? ' produto' : ' produtos') + ' · arm. ' + Core.armLabel(item.arm))),
          item.ultima
            ? h(Chip, { tone: item.ultima.resumo.vencidos || item.ultima.resumo.transferencias ? 'orange' : 'green' }, '✓ ' + fmtDay(item.ultima.em) + ' · ' + item.ultima.por)
            : h(Chip, { tone: 'muted' }, 'Falta'),
          h('span', { className: 'sc9g-go', 'aria-hidden': true }, '›'))))),
      rows.length > limit && h(Button, { kind: 'ghost', onClick: () => setLimit(limit + 60) }, 'Mostrar mais (' + num(rows.length - limit) + ')'));
  }

  // ---------- painel ----------
  function Dashboard({ data, isAdmin, xlsx }) {
    const p = data.painel;
    const max = Math.max(1, ...p.porDia.map(day => day.gavetas));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const exportar = async () => {
      setBusy(true); setError('');
      try {
        const { registros } = await api('/api/gaveta/analises');
        const gavetas = [['Data', 'Hora', 'Usuário', 'Gaveta', 'Armário', 'Armazém', 'Produtos', 'Sem saldo', 'Validades alteradas', 'Vencidos', 'Transferências marcadas', 'Duração (min)', 'Observação']];
        const itens = [['Data', 'Gaveta', 'Produto', 'Descrição', 'Lote', 'Saldo', 'Validade (SB8)', 'Validade informada', 'Sem saldo no armazém', 'Observação do produto']];
        const transf = [['Data', 'Gaveta', 'Produto', 'Descrição', 'Lote', 'Armazém de origem', 'Destino', 'Quantidade', 'Observação']];
        for (const r of registros) {
          const when = fmtDate(r.dia);
          gavetas.push([when, fmtTime(r.em), r.por, r.gaveta.codigo, r.gaveta.armario, Core.armLabel(r.gaveta.arm), r.resumo.produtos, r.resumo.semSaldo, r.resumo.validadesAlteradas, r.resumo.vencidos, r.resumo.transferencias, Math.round(r.duracaoSeg / 6) / 10, r.obs]);
          for (const item of r.itens) {
            if (!item.lotes.length) itens.push([when, r.gaveta.codigo, item.produto, item.descricao, '', '', '', '', item.semSaldo ? 'Sim' : '', item.obs]);
            for (const lote of item.lotes) itens.push([when, r.gaveta.codigo, item.produto, item.descricao, lote.lote, lote.saldo, fmtDate(lote.validadeSistema), lote.validadeNova ? fmtDate(lote.validadeNova) : '', item.semSaldo ? 'Sim' : '', item.obs]);
            for (const move of item.transferir) transf.push([when, r.gaveta.codigo, item.produto, item.descricao, move.lote, Core.armLabel(move.arm), Core.armLabel(r.gaveta.arm), move.qtd, move.obs]);
          }
          for (const extra of r.extras) itens.push([when, r.gaveta.codigo, extra.produto, '', extra.lote, '', '', '', 'Lote fora do cadastro', extra.obs]);
        }
        const book = xlsx.utils.book_new();
        [['Gavetas', gavetas], ['Itens', itens], ['Transferir p-01', transf]].forEach(([name, rows]) => xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet(rows), name));
        const bytes = xlsx.write(book, { type: 'array', bookType: 'xlsx' });
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        const link = document.createElement('a');
        link.href = url; link.download = 'Analise_de_gaveta_' + data.hoje + '.xlsx';
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e) { setError(e.message); } finally { setBusy(false); }
    };
    const stat = (label, value, tone, note) => h('div', { className: 'sc9g-stat' + (tone ? ' sc9g-stat-' + tone : '') }, h('span', null, label), h('strong', null, value), note && h('small', null, note));
    return h('div', { className: 'sc9g-stack' },
      h('div', { className: 'sc9g-stats' },
        stat('Analisadas', num(p.analisadas) + '/' + num(p.total), 'green', p.percentual + '% do total'),
        stat('Faltam', num(p.faltam), p.faltam ? 'amber' : 'green', p.faltam ? 'gavetas por analisar' : 'tudo analisado'),
        stat('Hoje', num(p.hoje), '', p.hoje === 1 ? 'gaveta' : 'gavetas'),
        stat('Média por dia', num(p.mediaDiaria), '', p.duracaoMediaSeg ? clock(p.duracaoMediaSeg) + ' por gaveta' : 'nos dias com análise')),
      h('div', { className: 'sc9g-progress', role: 'img', 'aria-label': p.percentual + '% das gavetas analisadas' }, h('span', { style: { width: p.percentual + '%' } })),
      h('section', { className: 'sc9g-card' },
        h('h3', null, 'Gavetas analisadas por dia'), h('p', { className: 'sc9g-muted' }, 'Últimos 30 dias. Este histórico nunca é apagado.'),
        h('div', { className: 'sc9g-bars', role: 'list' }, p.porDia.map(day => h('div', { key: day.dia, className: 'sc9g-bar', role: 'listitem', title: fmtDate(day.dia) + ': ' + day.gavetas + ' gavetas' },
          h('em', null, day.gavetas || ''), h('span', { style: { height: Math.max(day.gavetas ? 6 : 2, day.gavetas / max * 100) + '%' }, className: day.dia === data.hoje ? 'is-today' : '' }), h('small', null, fmtShort(day.dia)))))),
      p.porUsuarioHoje.length > 0 && h('section', { className: 'sc9g-card' }, h('h3', null, 'Hoje por pessoa'),
        h('ul', { className: 'sc9g-plain' }, p.porUsuarioHoje.map(item => h('li', { key: item.usuario }, h('span', null, item.usuario), h('strong', null, num(item.quantidade)))))),
      p.foraDoZz2 > 0 && h('p', { className: 'sc9g-muted' }, num(p.foraDoZz2) + ' gaveta(s) analisada(s) não constam mais no ZZ2 atual; o histórico delas foi mantido.'),
      isAdmin && h('section', { className: 'sc9g-card' }, h('h3', null, 'Exportar histórico'),
        h('p', { className: 'sc9g-muted' }, 'Excel com todas as análises, validades informadas e transferências marcadas para o 01.'),
        h(Button, { kind: 'primary', onClick: exportar, disabled: busy }, busy ? 'Gerando…' : 'Exportar análises'),
        error && h('p', { className: 'sc9g-error', role: 'alert' }, error)));
  }

  // ---------- carga das bases (administrador) ----------
  function Bases({ data, xlsx, reload }) {
    const [staged, setStaged] = useState([]);
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const input = useRef(null);
    const names = { sb8: 'SB8 (saldos e validades)', zz2: 'ZZ2 (endereços das gavetas)', sb1: 'SB1 (descrição dos produtos)' };
    const read = async files => {
      setBusy(true); setError('');
      const found = [];
      try {
        for (const file of files) {
          setStatus('Lendo ' + file.name + '…');
          await new Promise(resolve => setTimeout(resolve, 30));
          const buffer = await file.arrayBuffer();
          let result = {}, incomplete = false;
          try {
            const book = xlsx.read(buffer, { type: 'array', dense: true, raw: true });
            result = Core.readWorkbook(book, xlsx);
            incomplete = book.SheetNames.some(sheet => !book.Sheets[sheet]);
          } catch (e) { incomplete = true; }
          // Planilha gigante (SB8 completo): o leitor comum descarta a aba grande; lemos o arquivo aos pedaços.
          if (incomplete || !Object.keys(result).length) {
            try {
              const streamed = await Core.readWorkbookStream(buffer, fraction => setStatus('Lendo ' + file.name + ' (planilha grande) ' + Math.round(fraction * 100) + '%…'));
              for (const kind of Object.keys(streamed)) if (!result[kind]) result[kind] = streamed[kind];
            } catch (e) { if (!Object.keys(result).length) throw e; }
          }
          const kinds = Object.keys(result);
          if (!kinds.length) throw Error(file.name + ': não achei SB8, ZZ2 ou SB1 (confira os cabeçalhos).');
          kinds.forEach(kind => found.push({ kind, nome: file.name, rows: result[kind].rows, stats: result[kind].stats }));
        }
        setStaged(previous => [...previous.filter(item => !found.some(next => next.kind === item.kind)), ...found]);
        setStatus('');
      } catch (e) { setError(e.message); setStatus(''); } finally { setBusy(false); }
    };
    const send = async () => {
      setBusy(true); setError('');
      try {
        for (const item of staged) {
          setStatus('Enviando ' + item.kind.toUpperCase() + '…');
          await api('/api/gaveta/carga', { tipo: item.kind, nome: item.nome, rows: item.rows });
        }
        setStaged([]); setStatus('Bases salvas.');
        await reload();
      } catch (e) { setError(e.message); setStatus(''); } finally { setBusy(false); }
    };
    const current = (kind, meta) => meta
      ? h('p', { className: 'sc9g-muted' }, num(meta.linhas) + (kind === 'zz2' ? ' endereços · ' + num(meta.gavetas) + ' gavetas' : kind === 'sb8' ? ' linhas com saldo' : ' produtos') + ' · ' + meta.nome + ' · ' + fmtDay(meta.updatedAt) + ' ' + fmtTime(meta.updatedAt))
      : h('p', { className: 'sc9g-muted' }, 'Ainda não carregado.');
    return h('div', { className: 'sc9g-stack' },
      h('section', { className: 'sc9g-card' },
        h('h3', null, 'Carregar bases'),
        h('p', { className: 'sc9g-muted' }, 'Selecione os arquivos do Protheus (pode ser um de cada vez ou vários juntos). O SB8 vale ' + data.baseValidaHoras + 'h: se não for atualizado, ele some para quem analisa. ZZ2 e SB1 ficam até você trocar.'),
        h('input', { ref: input, type: 'file', accept: '.xlsx,.xls,.xlsm', multiple: true, className: 'sc9g-file', onChange: event => { const files = [...event.target.files]; event.target.value = ''; if (files.length) read(files); } }),
        h(Button, { kind: 'primary', onClick: () => input.current?.click(), disabled: busy }, 'Escolher arquivos'),
        status && h('p', { className: 'sc9g-muted', role: 'status' }, status),
        error && h('p', { className: 'sc9g-error', role: 'alert' }, error),
        staged.length > 0 && h('div', { className: 'sc9g-stack' },
          h('ul', { className: 'sc9g-plain' }, staged.map(item => h('li', { key: item.kind }, h('span', null, names[item.kind]), h('strong', null, num(item.rows.length) + ' linhas'),
            h('small', null, item.nome + (item.kind === 'sb8' ? ' · ' + num(item.stats.lidas) + ' lidas, só saldo > 0 entra' : ''))))),
          h(Button, { kind: 'primary', onClick: send, disabled: busy }, 'Salvar na base'))),
      ['sb8', 'zz2', 'sb1'].map(kind => h('section', { key: kind, className: 'sc9g-card' }, h('h3', null, names[kind]), current(kind, data.bases[kind]))));
  }

  // ---------- análise de uma gaveta ----------
  const emptyItem = () => ({ c: false, o: '', v: {}, t: {} });

  function GavetaView({ summary, data, onClose, onDone }) {
    const draftKey = 'sc9g:' + summary.id + ':' + (data.bases.sb8.updatedAt || '');
    const [detail, setDetail] = useState(null);
    const [error, setError] = useState('');
    const [draft, setDraft] = useState(() => store.get(draftKey) || { clientId: uuid(), inicio: new Date().toISOString(), seg: 0, itens: {}, extras: [] });
    const [showAll, setShowAll] = useState(false);
    const [seg, setSeg] = useState(draft.seg || 0);
    const [scan, setScan] = useState('');
    const [found, setFound] = useState(null);
    const [flash, setFlash] = useState('');
    const [confirm, setConfirm] = useState(false);
    const [obs, setObs] = useState('');
    const [saving, setSaving] = useState(false);
    const [done, setDone] = useState(null);
    const today = data.hoje;
    const segRef = useRef(seg);
    const bodyRef = useRef(null);
    const showFound = value => { setFound(value); setTimeout(() => bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' }), 30); };

    useEffect(() => {
      let alive = true;
      api('/api/gaveta/detalhe?id=' + encodeURIComponent(summary.id)).then(result => { if (alive) setDetail(result.detalhe); }).catch(e => { if (alive) setError(e.message); });
      return () => { alive = false; };
    }, [summary.id]);
    // Cronômetro: conta só enquanto a tela está aberta e visível.
    useEffect(() => {
      const timer = setInterval(() => { if (!document.hidden && !done) { segRef.current++; setSeg(segRef.current); } }, 1000);
      return () => clearInterval(timer);
    }, [done]);
    useEffect(() => { if (!done) store.set(draftKey, { ...draft, seg: segRef.current }); }, [draft, draftKey, done, Math.floor(seg / 15)]);

    const itemState = produto => draft.itens[produto] || emptyItem();
    const patch = (produto, change) => setDraft(previous => ({ ...previous, itens: { ...previous.itens, [produto]: { ...emptyItem(), ...previous.itens[produto], ...change(previous.itens[produto] || emptyItem()) } } }));
    const total = detail ? detail.itens.length : 0;
    const checked = detail ? detail.itens.filter(item => itemState(item.produto).c).length : 0;
    const visible = detail ? detail.itens.filter(item => showAll || !itemState(item.produto).c) : [];

    const search = async event => {
      event.preventDefault();
      const q = Core.upper(scan);
      if (!q || !detail) return;
      const local = detail.itens.find(item => item.produto === q || item.ean.toUpperCase() === q || item.lotes.some(l => l.lote === q) || item.outros.some(l => l.lote === q));
      setScan('');
      if (local) {
        setFound(null); setShowAll(true); setFlash(local.produto);
        setTimeout(() => document.getElementById('sc9g-item-' + local.produto)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60);
        setTimeout(() => setFlash(''), 2500);
        return;
      }
      try {
        const result = await api('/api/gaveta/lote?q=' + encodeURIComponent(q));
        showFound({ q, rows: result.resultados });
      } catch (e) { showFound({ q, rows: [], error: e.message }); }
    };
    const addExtra = (lote, produto, note) => {
      setDraft(previous => ({ ...previous, extras: [...previous.extras.filter(extra => extra.lote !== lote), { lote, produto: produto || '', obs: note }] }));
      setFound(null);
    };

    const finish = async () => {
      setSaving(true); setError('');
      try {
        const body = {
          id: summary.id, clientId: draft.clientId, inicio: draft.inicio, duracaoSeg: segRef.current, obs,
          extras: draft.extras,
          itens: detail.itens.map(item => {
            const state = itemState(item.produto);
            return {
              produto: item.produto, conferido: state.c, semSaldo: item.semSaldo, obs: state.o,
              lotes: item.lotes.map(l => ({ lote: l.lote, saldo: l.saldo, validadeSistema: l.validade, validadeNova: state.v[l.lote + '|' + l.validade] && state.v[l.lote + '|' + l.validade] !== l.validade ? state.v[l.lote + '|' + l.validade] : '' })),
              transferir: Object.values(state.t).map(move => ({ arm: move.arm, lote: move.lote, qtd: move.q, obs: move.o || '' }))
            };
          })
        };
        const result = await api('/api/gaveta/analise', body);
        store.del(draftKey);
        setDone(result); setConfirm(false);
      } catch (e) { setError(e.message); } finally { setSaving(false); }
    };

    const summaryLines = useMemo(() => {
      if (!detail) return null;
      let validades = 0, transfer = 0, vencidos = 0, semSaldo = 0;
      for (const item of detail.itens) {
        const state = itemState(item.produto);
        if (item.semSaldo) semSaldo++;
        transfer += Object.keys(state.t).length;
        for (const l of item.lotes) {
          const edited = state.v[l.lote + '|' + l.validade];
          if (edited && edited !== l.validade) validades++;
          const date = edited || l.validade;
          if (date && Core.validity(date, today).days < 0) vencidos++;
        }
      }
      return { validades, transfer, vencidos, semSaldo };
    }, [detail, draft, today]);

    if (done) {
      return h('div', { className: 'sc9g-done' },
        h('div', { className: 'sc9g-done-mark', 'aria-hidden': true }, '✓'),
        h('h2', null, 'Gaveta ' + summary.codigo + ' analisada'),
        h('p', null, 'Tempo: ' + clock(segRef.current) + (done.repetido ? ' · já estava salva' : '')),
        h(Button, { kind: 'primary', onClick: () => onDone(true) }, 'Próxima gaveta'),
        h(Button, { kind: 'ghost', onClick: () => onDone(false) }, 'Voltar à lista'));
    }

    return h('div', { className: 'sc9g-gaveta' },
      h('header', { className: 'sc9g-gh' },
        h('button', { type: 'button', className: 'sc9g-back', onClick: onClose, 'aria-label': 'Voltar à lista' }, '‹'),
        h('div', { className: 'sc9g-gh-title' }, h('strong', null, summary.codigo), h('small', null, (summary.armario ? 'Armário ' + summary.armario + ' · ' : '') + 'armazém ' + Core.armLabel(summary.arm))),
        h('div', { className: 'sc9g-timer', 'aria-label': 'Tempo de análise' }, clock(seg))),
      h('div', { className: 'sc9g-progress sc9g-progress-top', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': checked }, h('span', { style: { width: (total ? checked / total * 100 : 0) + '%' } })),
      h('div', { className: 'sc9g-body', ref: bodyRef },
        h('form', { className: 'sc9g-scan', onSubmit: search },
          h('input', { className: 'sc9g-input', value: scan, onChange: event => setScan(event.target.value), placeholder: 'Bipe ou digite o lote / código', autoCapitalize: 'characters', autoCorrect: 'off', autoComplete: 'off', enterKeyHint: 'search', 'aria-label': 'Buscar lote' }),
          h(Button, { kind: 'primary', type: 'submit' }, 'Buscar')),
        error && h('p', { className: 'sc9g-error', role: 'alert' }, error),
        found && h(FoundPanel, { found, today, arm: summary.arm, onAdd: addExtra, onClose: () => setFound(null) }),
        !detail && !error && h('p', { className: 'sc9g-empty' }, 'Carregando gaveta…'),
        detail && h('div', { className: 'sc9g-seg sc9g-seg-2' }, [[false, 'Pendentes', total - checked], [true, 'Todos', total]].map(([all, label, count]) =>
          h('button', { key: label, type: 'button', className: showAll === all ? 'is-on' : '', onClick: () => setShowAll(all) }, label, h('span', null, count)))),
        detail && !visible.length && h('p', { className: 'sc9g-empty' }, 'Tudo conferido. Revise e finalize a gaveta.'),
        visible.map(item => h(ProductCard, { key: item.produto, item, state: itemState(item.produto), patch: change => patch(item.produto, change), today, arm: detail.arm, flash: flash === item.produto })),
        draft.extras.length > 0 && h('section', { className: 'sc9g-card' }, h('h3', null, 'Lotes encontrados fora do cadastro'),
          h('ul', { className: 'sc9g-plain' }, draft.extras.map(extra => h('li', { key: extra.lote }, h('span', null, extra.lote), h('small', null, extra.obs || 'sem observação'),
            h(Button, { kind: 'ghost', onClick: () => setDraft(previous => ({ ...previous, extras: previous.extras.filter(x => x.lote !== extra.lote) })) }, 'Remover')))))),
      detail && h('footer', { className: 'sc9g-foot' },
        h('span', null, checked + ' de ' + total + ' conferidos'),
        h(Button, { kind: 'primary', disabled: checked < total, onClick: () => setConfirm(true) }, 'Finalizar gaveta')),
      confirm && h('div', { className: 'sc9g-sheet-wrap', role: 'dialog', 'aria-modal': true, 'aria-label': 'Finalizar gaveta' },
        h('div', { className: 'sc9g-sheet' },
          h('h3', null, 'Finalizar gaveta ' + summary.codigo + '?'),
          h('ul', { className: 'sc9g-plain' },
            h('li', null, h('span', null, 'Produtos conferidos'), h('strong', null, total)),
            h('li', null, h('span', null, 'Sem saldo no armazém'), h('strong', null, summaryLines.semSaldo)),
            h('li', null, h('span', null, 'Validades alteradas'), h('strong', null, summaryLines.validades)),
            h('li', null, h('span', null, 'Lotes vencidos'), h('strong', null, summaryLines.vencidos)),
            h('li', null, h('span', null, 'Marcados p/ transferir ao ' + Core.armLabel(detail.arm)), h('strong', null, summaryLines.transfer)),
            h('li', null, h('span', null, 'Lotes fora do cadastro'), h('strong', null, draft.extras.length))),
          h('textarea', { className: 'sc9g-input', rows: 3, placeholder: 'Observação da gaveta (opcional)', value: obs, onChange: event => setObs(event.target.value), maxLength: 1000 }),
          error && h('p', { className: 'sc9g-error', role: 'alert' }, error),
          h('div', { className: 'sc9g-actions' },
            h(Button, { kind: 'ghost', onClick: () => setConfirm(false), disabled: saving }, 'Voltar'),
            h(Button, { kind: 'primary', onClick: finish, disabled: saving }, saving ? 'Salvando…' : 'Confirmar')))));
  }

  function FoundPanel({ found, today, arm, onAdd, onClose }) {
    const [note, setNote] = useState('');
    const first = found.rows[0];
    return h('section', { className: 'sc9g-card sc9g-found', role: 'status' },
      h('div', { className: 'sc9g-found-head' }, h('h3', null, 'Lote ' + found.q + ' não está nesta gaveta'), h(Button, { kind: 'ghost', onClick: onClose, 'aria-label': 'Fechar' }, '✕')),
      found.error && h('p', { className: 'sc9g-error' }, found.error),
      found.rows.length
        ? h('ul', { className: 'sc9g-plain' }, found.rows.map((row, index) => h('li', { key: index },
            h('span', null, h('strong', null, 'Arm. ' + Core.armLabel(row.arm)), ' · ', row.descricao || row.produto, ' · saldo ', num(row.saldo)),
            h(ValidityChip, { iso: row.validade, today }),
            row.enderecos.length > 0 && h('small', null, 'Endereços: ' + row.enderecos.map(item => Core.armLabel(item.arm) + ' ' + item.endereco).join(' · ')))))
        : !found.error && h('p', { className: 'sc9g-muted' }, 'Nada com saldo no SB8 para esse código.'),
      h('input', { className: 'sc9g-input', value: note, onChange: event => setNote(event.target.value), placeholder: 'Observação (ex.: lote físico sem cadastro)', maxLength: 500, 'aria-label': 'Observação do lote' }),
      h(Button, { kind: 'primary', onClick: () => onAdd(found.q, first?.produto, note) }, 'Anotar como encontrado nesta gaveta'));
  }

  function ProductCard({ item, state, patch, today, arm, flash }) {
    const [obsOpen, setObsOpen] = useState(Boolean(state.o));
    const home = Core.armLabel(arm);
    if (state.c) {
      return h('section', { id: 'sc9g-item-' + item.produto, className: 'sc9g-card sc9g-product is-done' + (flash ? ' is-flash' : '') },
        h('div', { className: 'sc9g-p-done' }, h('span', { className: 'sc9g-tick', 'aria-hidden': true }, '✓'),
          h('div', null, h('strong', null, item.descricao || item.produto), h('small', null, item.produto)),
          h(Button, { kind: 'ghost', onClick: () => patch(() => ({ c: false })) }, 'Reabrir')));
    }
    return h('section', { id: 'sc9g-item-' + item.produto, className: 'sc9g-card sc9g-product' + (flash ? ' is-flash' : '') },
      h('header', null, h('strong', null, item.descricao || 'Sem descrição no SB1'), h('small', null, item.produto + (item.ean ? ' · ' + item.ean : '') + (item.unidade ? ' · ' + item.unidade : ''))),
      h('div', { className: 'sc9g-chips' }, item.enderecos.map((place, index) => h(Chip, { key: index, tone: place.aqui ? 'dark' : 'muted' }, (place.aqui ? 'Aqui: ' : '') + Core.armLabel(place.arm) + ' · ' + place.endereco + (place.armario ? ' (arm. ' + place.armario + ')' : '')))),
      item.semSaldo && h('p', { className: 'sc9g-warn', role: 'alert' }, 'Sem saldo no armazém ' + home + ' (SB8). Veja abaixo se está em outro armazém.'),
      item.lotes.length > 0 && h('div', { className: 'sc9g-block' },
        h('h4', null, 'Armazém ' + home + ' · saldo e validade'),
        item.lotes.map(l => {
          const key = l.lote + '|' + l.validade, edited = state.v[key], date = edited || l.validade;
          return h('div', { key, className: 'sc9g-lote' },
            h('div', { className: 'sc9g-lote-top' }, h('strong', null, l.lote), h('span', null, 'saldo ' + num(l.saldo) + (item.unidade ? ' ' + item.unidade : '') + (l.empenho ? ' · emp. ' + num(l.empenho) : ''))),
            h('div', { className: 'sc9g-lote-val' },
              h(ValidityChip, { iso: date, today }),
              edited && edited !== l.validade && h('small', null, 'SB8: ' + fmtDate(l.validade)),
              h('label', { className: 'sc9g-date' }, h('span', null, 'Validade correta'),
                h('input', { type: 'date', className: 'sc9g-input', value: date || '', onChange: event => { const value = event.target.value; patch(previous => ({ v: { ...previous.v, [key]: value } })); }, 'aria-label': 'Validade do lote ' + l.lote }))));
        })),
      item.outros.length > 0 && h('div', { className: 'sc9g-block sc9g-other' },
        h('h4', null, 'Saldo em outros armazéns'),
        item.outros.map(l => {
          const key = l.arm + '|' + l.lote + '|' + l.validade, move = state.t[key];
          return h('div', { key, className: 'sc9g-lote' },
            h('div', { className: 'sc9g-lote-top' }, h('span', null, h(Chip, { tone: 'dark' }, 'Arm. ' + Core.armLabel(l.arm)), ' ', h('strong', null, l.lote)), h('span', null, 'saldo ' + num(l.saldo) + (l.empenho ? ' · emp. ' + num(l.empenho) : ''))),
            h('div', { className: 'sc9g-lote-val' }, h(ValidityChip, { iso: l.validade, today }),
              h(Button, { kind: move ? 'primary' : 'ghost', onClick: () => patch(previous => { const next = { ...previous.t }; if (next[key]) delete next[key]; else next[key] = { arm: l.arm, lote: l.lote, q: l.saldo, o: '' }; return { t: next }; }) }, move ? '✓ Transferir p/ ' + home : 'Transferir p/ ' + home)),
            move && h('div', { className: 'sc9g-move' },
              h('label', null, h('span', null, 'Quantidade'), h('input', { className: 'sc9g-input', type: 'number', inputMode: 'decimal', min: 0, step: 'any', value: move.q, onChange: event => { const value = event.target.value; patch(previous => ({ t: { ...previous.t, [key]: { ...previous.t[key], q: value === '' ? '' : Number(value) } } })); } })),
              h('label', null, h('span', null, 'Observação'), h('input', { className: 'sc9g-input', value: move.o, maxLength: 300, placeholder: 'Ex.: trazer do ' + Core.armLabel(l.arm), onChange: event => { const value = event.target.value; patch(previous => ({ t: { ...previous.t, [key]: { ...previous.t[key], o: value } } })); } }))));
        })),
      obsOpen
        ? h('textarea', { className: 'sc9g-input', rows: 2, maxLength: 500, placeholder: 'Observação do produto', value: state.o, onChange: event => { const value = event.target.value; patch(() => ({ o: value })); } })
        : h(Button, { kind: 'ghost', onClick: () => setObsOpen(true) }, '+ Observação'),
      h(Button, { kind: 'ok', className: 'sc9g-check', onClick: () => patch(previous => ({ c: Object.values(previous.t).every(move => Number(move.q) > 0) })), disabled: Object.values(state.t).some(move => !(Number(move.q) > 0)) }, '✓ Conferido'));
  }

  // ---------- tela principal ----------
  function Panel({ isAdmin, xlsx, onBack, onLogout }) {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [tab, setTab] = useState('gavetas');
    const [open, setOpen] = useState(null);
    const [toast, setToast] = useState('');
    const reload = useCallback(async () => {
      try { setData(await api('/api/gaveta/resumo')); setError(''); } catch (e) { setError(e.message); }
    }, []);
    useEffect(() => { reload(); }, [reload]);
    const tabs = [['gavetas', 'Gavetas'], ['painel', 'Painel'], ...(isAdmin ? [['bases', 'Bases']] : [])];
    const close = async next => {
      const previous = open;
      setOpen(null);
      await reload();
      if (next && data) {
        const pending = data.gavetas.find(item => !item.ultima && item.id !== previous.id);
        if (pending) setOpen(pending); else setToast('Todas as gavetas foram analisadas.');
      }
    };
    return h('div', { className: 'sc9g-screen' },
      !open && h('header', { className: 'sc9g-top' },
        h('button', { type: 'button', className: 'sc9g-back', onClick: onBack, 'aria-label': 'Voltar ao SC9' }, '‹'),
        h('div', { className: 'sc9g-gh-title' }, h('strong', null, 'Análise de gaveta'), h('small', null, 'Saldo, validade e armazéns')),
        h('button', { type: 'button', className: 'sc9g-refresh', onClick: reload, 'aria-label': 'Atualizar' }, '↻'),
        onLogout && h('button', { type: 'button', className: 'sc9g-logout', onClick: onLogout }, 'Sair')),
      open && data
        ? h(GavetaView, { summary: open, data, onClose: () => { setOpen(null); reload(); }, onDone: close })
        : h('div', { className: 'sc9g-scroll' },
          error && h('p', { className: 'sc9g-error', role: 'alert' }, error),
          !data && !error && h('p', { className: 'sc9g-empty' }, 'Carregando…'),
          data && h('div', { className: 'sc9g-content' },
            h(BaseBanner, { data, isAdmin, goBases: () => setTab('bases') }),
            toast && h('p', { className: 'sc9g-toast', role: 'status', onClick: () => setToast('') }, toast),
            h('nav', { className: 'sc9g-tabs', role: 'tablist' }, tabs.map(([id, label]) => h('button', { key: id, type: 'button', role: 'tab', 'aria-selected': tab === id, className: tab === id ? 'is-on' : '', onClick: () => setTab(id) }, label))),
            tab === 'gavetas' && h(GavetaList, { data, onOpen: setOpen }),
            tab === 'painel' && h(Dashboard, { data, isAdmin, xlsx }),
            tab === 'bases' && isAdmin && h(Bases, { data, xlsx, reload }))));
  }

  root.SC9Gaveta = { Panel };
})(window);
