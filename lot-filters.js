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
  function analysis(rows, type, filial, warehouse, analyze) {
    return findings(analyze(rows).map(dados => ({ tipo: type, dados })), filial, warehouse).map(item => item.dados);
  }
  function branchHeader(value) {
    const key = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return ['FILIAL','B8FILIAL','CODFILIAL','CODIGOFILIAL','CODDAFILIAL','CODIGODAFILIAL','FILIALSB8','FILIALB8FILIAL'].includes(key);
  }
  function CoverageNotice({ rows, saved, selected }) {
    const info = coverage(rows, saved);
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
  root.SC9LotFilters = { normalize, records, findings, warehouses, sourceRows, coverage, analysis, branchHeader, CoverageNotice, Selector };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SC9LotFilters;
})(typeof window === 'undefined' ? globalThis : window);
