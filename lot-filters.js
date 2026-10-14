/* SB8 filial codes: 01 = Cambuci; 02 = Santa Catarina; 03 = Tamboré; 04 = Paraíso. Independent of warehouse. */
(function (root) {
  function normalize(value) {
    const text = String(value == null ? '' : value).trim();
    return /^\d+$/.test(text) ? String(Number(text)) : text;
  }
  function records(rows, filial) {
    if (!filial) return rows;
    return rows.filter(row => normalize(row.filial) === normalize(filial));
  }
  function findings(items, filial) {
    if (!filial) return items;
    return items.flatMap(item => {
      const data = item.dados || {};
      if (!Array.isArray(data.registros)) return records([data], filial).length ? [item] : [];
      const scoped = records(data.registros, filial);
      if (!scoped.length) return [];
      // Retain the complete finding's classification, but show/export only this unit's rows.
      return [{ ...item, dados: { ...data, registros: scoped, temSaldoAtivo: scoped.some(row => row.saldo > 0) } }];
    });
  }
  function Selector({ value, onChange }) {
    const h = root.React.createElement;
    return h('label', { className: 'sc9-filial-filter' }, 'Unidade:',
      h('select', { value, onChange: event => onChange(event.target.value), 'aria-label': 'Filtrar cadastro de lotes por unidade' },
        h('option', { value: '' }, 'Todas as unidades'),
        h('option', { value: '1' }, 'Cambuci · 01'),
        h('option', { value: '2' }, 'Santa Catarina · 02'),
        h('option', { value: '3' }, 'Tamboré · 03'),
        h('option', { value: '4' }, 'Paraíso · 04')));
  }
  root.SC9LotFilters = { normalize, records, findings, Selector };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SC9LotFilters;
})(typeof window === 'undefined' ? globalThis : window);
