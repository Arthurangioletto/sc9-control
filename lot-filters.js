/* SB8 filial codes: 01 = Cambuci; 02 = Santa Catarina; 03 = Tamboré; 04 = Paraíso. Independent of warehouse. */
(function (root) {
  function normalize(value) {
    const text = String(value == null ? '' : value).trim();
    return /^\d+$/.test(text) ? String(Number(text)) : text;
  }
  function records(rows, filial) {
    if (filial === '__SEM_FILIAL__') return rows.filter(row => !normalize(row.filial));
    if (!filial) return rows;
    return rows.filter(row => normalize(row.filial) === normalize(filial));
  }
  function findings(items, filial, warehouse = '') {
    const hasWarehouse = warehouse && warehouse !== '__TODOS__';
    if (!filial && !hasWarehouse) return items;
    const scope = rows => records(rows, filial).filter(row => !hasWarehouse || normalize(row.armazem) === normalize(warehouse));
    return items.flatMap(item => {
      const data = item.dados || {};
      if (!Array.isArray(data.registros)) return scope([data]).length ? [item] : [];
      const scoped = scope(data.registros);
      if (!scoped.length) return [];
      // Retain the complete finding's classification, but show/export only this unit's rows.
      return [{ ...item, dados: { ...data, registros: scoped, temSaldoAtivo: scoped.some(row => row.saldo > 0) } }];
    });
  }
  function warehouses(rows, savedFindings, filial) {
    const source = rows.length ? rows : (savedFindings || []).flatMap(item => {
      const data = item.dados || {};
      return Array.isArray(data.registros) ? data.registros : [data];
    });
    const codes = records(source, filial).map(row => normalize(row.armazem)).filter(Boolean);
    return Array.from(new Set(codes)).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  }

  function sourceRows(rows, savedFindings) {
    return rows.length ? rows : (savedFindings || []).flatMap(item => {
      const data = item.dados || {};
      return Array.isArray(data.registros) ? data.registros : [data];
    });
  }
  function coverage(rows, savedFindings) {
    const source = sourceRows(rows, savedFindings);
    return { total: source.length, missing: source.filter(row => !normalize(row.filial)).length };
  }
  // Inputs are replaced on import/sync; WeakMaps release obsolete bases automatically.
  const analyses = new WeakMap(), hydrated = new WeakMap();
  function baseAnalysis(rows, analyze) {
    let byFunction = analyses.get(rows);
    if (!byFunction) { byFunction = new Map(); analyses.set(rows, byFunction); }
    if (!byFunction.has(analyze)) byFunction.set(analyze, analyze(rows));
    return byFunction.get(analyze);
  }
  function analysis(rows, type, filial, warehouse, analyze) {
    return findings(baseAnalysis(rows, analyze).map(dados => ({ tipo: type, dados })), filial, warehouse).map(item => item.dados);
  }
  function prepareSaved(saved) {
    if (!saved) return Object.create(null);
    if (hydrated.has(saved)) return hydrated.get(saved);
    const byType = Object.create(null);
    const dateFields = ['dtFabricacao', 'dtEntrada', 'dtValidade'];
    function record(row) {
      const result = { ...row };
      for (const field of dateFields) if (field in row) result[field] = row[field] ? new Date(row[field]) : null;
      return result;
    }
    for (const item of saved) {
      const data = record(item.dados || {});
      if (data.registros) data.registros = data.registros.map(record);
      data.historicoSaldo = item.historicoSaldo || [];
      (byType[item.tipo] || (byType[item.tipo] = [])).push({ ...item, dados: data });
    }
    hydrated.set(saved, byType);
    return byType;
  }
  function savedAnalysis(saved, type, filial, warehouse) {
    return findings(prepareSaved(saved)[type] || [], filial, warehouse).map(item => item.dados);
  }
  function branchHeader(value) {
    const key = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return ['FILIAL','B8FILIAL','CODFILIAL','CODIGOFILIAL','CODDAFILIAL','CODIGODAFILIAL','FILIALSB8','FILIALB8FILIAL'].includes(key);
  }
  function CoverageNotice({ rows, saved, selected }) {
    const info = root.React.useMemo(() => coverage(rows, saved), [rows, saved]);
    if (!info.missing) return null;
    const h = root.React.createElement;
    return h('div', { className: 'sc9-filial-notice', role: 'status' },
      h('strong', null, 'Há registros sem filial informada. '),
      info.missing.toLocaleString('pt-BR') + ' de ' + info.total.toLocaleString('pt-BR') + ' registros não têm filial na base disponível. ',
      'Eles aparecem em “Todas as unidades” ou “Sem filial informada”. Para distribuí-los por unidade, importe o SB8 com a coluna Filial preenchida. O armazém não identifica a filial.',
      selected && selected !== '__SEM_FILIAL__' ? h('p', null, 'A unidade selecionada mostra somente os registros cuja filial está identificada.') : null);
  }
  function Selector({ value, onChange }) {
    const h = root.React.createElement;
    return h('label', { className: 'sc9-filial-filter' }, 'Unidade:',
      h('select', { value, onChange: event => onChange(event.target.value), 'aria-label': 'Filtrar cadastro de lotes por unidade' },
        h('option', { value: '' }, 'Todas as unidades'),
        h('option', { value: '__SEM_FILIAL__' }, 'Sem filial informada'),
        h('option', { value: '1' }, 'Cambuci · 01'),
        h('option', { value: '2' }, 'Santa Catarina · 02'),
        h('option', { value: '3' }, 'Tamboré · 03'),
        h('option', { value: '4' }, 'Paraíso · 04')));
  }
  root.SC9LotFilters = { normalize, records, findings, warehouses, sourceRows, coverage, analysis, baseAnalysis, prepareSaved, savedAnalysis, branchHeader, CoverageNotice, Selector };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SC9LotFilters;
})(typeof window === 'undefined' ? globalThis : window);

/* Render only the current page; callers retain complete data for search/export. */
(function (root) {
  const normalizeLot = value => String(value == null ? '' : value).trim().toUpperCase();
  function pageInfo(total, page, size = 25) {
    size = Math.max(1, Math.floor(Number(size) || 25));
    total = Math.max(0, Math.floor(Number(total) || 0));
    const pages = Math.max(1, Math.ceil(total / size));
    page = Math.min(pages - 1, Math.max(0, Math.floor(Number(page) || 0)));
    const start = page * size;
    return { page, pages, size, start, end: Math.min(total, start + size), total };
  }
  function targetPage(items, target, size = 25) {
    if (!target) return null;
    const lot = normalizeLot(target), index = items.findIndex(item => normalizeLot(item.lote || item.achado?.lote) === lot);
    return index < 0 ? null : Math.floor(index / size);
  }
  function Controls({ info, onPage, label = 'registros' }) {
    if (!info.total) return null;
    const h = root.React.createElement, fmt = n => n.toLocaleString('pt-BR');
    return h('div', { className: 'sc9-page-controls', role: 'group', 'aria-label': 'Paginação de ' + label },
      h('span', { role: 'status' }, fmt(info.start + 1) + '–' + fmt(info.end) + ' de ' + fmt(info.total) + ' ' + label),
      info.pages > 1 && h('div', { className: 'sc9-page-buttons' },
        h('button', { type: 'button', disabled: info.page === 0, onClick: () => onPage(info.page - 1), 'aria-label': 'Página anterior de ' + label }, 'Anterior'),
        h('label', null, 'Página ', h('select', { 'aria-label': 'Página de ' + label, value: info.page, onChange: e => onPage(Number(e.target.value)) },
          Array.from({ length: info.pages }, (_, i) => h('option', { key: i, value: i }, fmt(i + 1)))), ' de ' + fmt(info.pages)),
        h('button', { type: 'button', disabled: info.page === info.pages - 1, onClick: () => onPage(info.page + 1), 'aria-label': 'Próxima página de ' + label }, 'Próxima')));
  }
  function List({ items, renderItem, target, resetKey, size = 25, label = 'lotes', renderPage, hideSingleControls = false }) {
    const R = root.React, h = R.createElement;
    const [position, setPosition] = R.useState(() => ({ key: resetKey, page: targetPage(items, target, size) || 0 }));
    const [lastTarget, setLastTarget] = R.useState(target);
    let page = position.key === resetKey ? position.page : 0;
    // Set the search destination before rendering so the existing lot locator finds it.
    if (target !== lastTarget) {
      const found = targetPage(items, target, size);
      setLastTarget(target);
      if (found !== null) { page = found; setPosition({ key: resetKey, page }); }
    }
    R.useEffect(() => {
      const focus = event => {
        const found = targetPage(items, event.detail, size);
        if (found !== null) setPosition({ key: resetKey, page: found });
      };
      root.addEventListener('sc9-focus-lot', focus);
      return () => root.removeEventListener('sc9-focus-lot', focus);
    }, [items, resetKey, size]);
    const info = pageInfo(items.length, page, size);
    const change = page => setPosition({ key: resetKey, page });
    return h('div', { className: 'sc9-paged-list' },
      (!hideSingleControls || info.pages > 1) && h(Controls, { info, onPage: change, label }),
      renderPage ? renderPage(items.slice(info.start, info.end)) : items.slice(info.start, info.end).map(renderItem),
      info.pages > 1 && h(Controls, { info, onPage: change, label }));
  }
  root.SC9Paging = { pageInfo, targetPage, Controls, List };
  if (typeof module !== 'undefined' && module.exports) module.exports.paging = root.SC9Paging;
})(typeof window === 'undefined' ? globalThis : window);
