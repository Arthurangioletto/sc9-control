/* Editable card layout for SB8 records. Reuses the existing fields and handlers. */
(function (root) {
  const h = root.React.createElement;
  const children = value => root.React.Children.toArray(value);
  function Field({ label, cell, extraClass = '' }) {
    return h('div', { className: 'sc9-lot-field ' + extraClass },
      h('span', { className: 'sc9-lot-field-label' }, label),
      h('div', { className: 'sc9-lot-field-value', style: { color: cell.props.style && cell.props.style.color } }, label === 'Filial' && ['', '—'].includes(String(cell.props.children || '').trim()) ? 'Não informada' : cell.props.children));
  }
  root.SC9LotRecords = function LotRecords({ lot, children: tableChildren }) {
    const [head, body] = children(tableChildren);
    const labels = children(children(head.props.children)[0].props.children).map(cell => cell.props.children);
    const rows = children(body.props.children);

    return h('div', { className: 'sc9-lot-records' }, h(root.SC9Paging.List, { items: rows, size: 20, hideSingleControls: true, label: 'registros do lote ' + lot, renderItem: (row, index) => {
      const cells = children(row.props.children);
      if (cells.some(cell => cell.props.colSpan)) {
        return h('div', { key: row.key || index, className: 'sc9-lot-total' }, cells.map((cell, i) => h('span', { key: i, style: cell.props.style }, cell.props.children)));
      }
      const fields = cells.map((cell, i) => ({ label: labels[i], cell }));
      const manualStart = labels.indexOf('Fabricação (sistema)');
      const saldoEnd = labels.indexOf('Saldo') + 1;
      const main = fields.slice(2, saldoEnd);
      const financial = fields.slice(saldoEnd, manualStart);
      const manual = fields.slice(manualStart);

      return h('section', { key: row.key || index, className: 'sc9-lot-record', 'aria-label': 'Registro do lote ' + lot + ' · ' + (index + 1), style: { borderLeftColor: cells[0].props.style && cells[0].props.style.borderLeft ? cells[0].props.style.borderLeft.split(' ').pop() : undefined, background: row.props.style.background } },
        h('div', { className: 'sc9-lot-data-row' },
          h('div', { className: 'sc9-lot-field' }, h('span', { className: 'sc9-lot-field-label' }, 'Lote'), h('strong', { className: 'sc9-lot-field-value' }, lot)),
          h('div', { className: 'sc9-lot-field sc9-lot-decision' }, h('span', { className: 'sc9-lot-field-label' }, 'Correto / ação'), h('div', { className: 'sc9-lot-field-value' }, cells[0].props.children, h('span', { style: cells[1].props.style }, cells[1].props.children))),
          main.map((field, i) => h(Field, { key: i, ...field, extraClass: field.label === 'Descrição' ? 'sc9-lot-description' : field.label === 'Produto' ? 'sc9-lot-product' : '' }))),
        h('div', { className: 'sc9-lot-manual-row', role: 'group', 'aria-label': 'Conferência manual do registro ' + (index + 1) }, manual.map((field, i) => {
          const title = field.label === 'Fabricação (físico)' ? 'Fabricação · físico' : field.label === 'Validade (físico)' ? 'Validade · físico' : field.label;
          return h(Field, { key: i, ...field, label: title, extraClass: 'sc9-lot-manual-field' });
        })),
        financial.length > 0 && h('details', { className: 'sc9-lot-financial' }, h('summary', null, 'Valores e impacto financeiro'), h('div', { className: 'sc9-lot-financial-fields' }, financial.map((field, i) => h(Field, { key: i, ...field })))));
    } }));
  };
})(window);

/* All duplicate-lot cards share the same disclosure, including follow-up cards. */
(function (root) {
  const R = root.React, h = R.createElement;
  const list = value => R.Children.toArray(value);
  const lotKey = value => String(value || '').trim().toUpperCase();
  root.SC9DuplicatePanel = function DuplicatePanel({ lot, target, enabled = true, embedded = false, children }) {
    const [open, setOpen] = R.useState(() => Boolean(target) && lotKey(target) === lotKey(lot));
    const id = R.useId();
    R.useEffect(() => {
      if (enabled && target && lotKey(target) === lotKey(lot)) setOpen(true);
    }, [lot, target, enabled]);
    R.useEffect(() => {
      if (!enabled) return;
      const focus = event => { if (lotKey(event.detail) === lotKey(lot)) setOpen(true); };
      root.addEventListener('sc9-focus-lot', focus);
      return () => root.removeEventListener('sc9-focus-lot', focus);
    }, [lot, enabled]);
    const panel = list(children)[0];
    if (!enabled || !panel) return panel || null;
    const parts = list(panel.props.children), heading = parts[0];

    if (embedded) return h('article', { className: 'sc9-lots-v4-detail', 'data-sc9lote': lotKey(lot) },
      h('div', { className: 'sc9-lots-v4-detail-head' },
        h('h2', null, 'Lote ', lot), heading),
      h('div', { className: 'sc9-lots-v4-detail-body' }, parts.slice(1)));
    const headingParts = list(heading?.props?.children);
    const actions = headingParts.filter(child => child?.type === 'button');
    const title = headingParts.filter(child => child?.type !== 'button').flatMap(child =>
      child?.type === 'div' ? list(child.props.children) : [child]);
    return h('section', {
      ...panel.props, className: (panel.props.className || '') + ' sc9-duplicate-panel',
      'data-sc9lote': lotKey(lot)
    },
      h('div', { className: 'sc9-duplicate-heading' },
        h('button', {
          type: 'button', className: 'sc9-duplicate-toggle',
          'aria-expanded': open, 'aria-controls': id,
          'aria-label': (open ? 'Recolher' : 'Expandir') + ' informações do lote ' + lot,
          onClick: () => setOpen(value => !value)
        }, h('span', { className: 'sc9-duplicate-summary' }, title),
        h('span', { className: 'sc9-duplicate-indicator', 'aria-hidden': true },
          open ? 'Recolher' : 'Expandir',
          h('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 },
            h('path', { d: open ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6' })))),
        actions.length > 0 && h('div', { className: 'sc9-duplicate-actions' }, actions)),
      h('div', { id, hidden: !open, className: 'sc9-duplicate-content' }, open ? parts.slice(1) : null));
  };
  function hasStock(item) {
    return (item.registros || [item]).some(row => Number(row.saldo) > 0);
  }

  root.SC9LotMetrics = analyses => Object.fromEntries(Object.entries(analyses).map(([name, items]) => [
    name, items.reduce((total, item) => total + Number(hasStock(item)), 0)
  ]));

  root.SC9LotQueue = function LotQueue({ items, target, renderItem, byProduct = false }) {
    const [selection, select] = R.useState('');
    R.useEffect(() => { if (target) select(lotKey(target)); }, [target]);
    R.useEffect(() => {
      const focus = event => select(lotKey(event.detail));
      root.addEventListener('sc9-focus-lot', focus);
      return () => root.removeEventListener('sc9-focus-lot', focus);
    }, []);

    const record = item => item.achado || item;
    const lot = item => record(item).lote || String(item.chave || '').split('|')[0];
    const product = item => record(item).produto || record(item).produtoBase;
    const itemKey = item => byProduct ? item.product : item.chave || JSON.stringify([lotKey(lot(item)), product(item), item.filial, item.armazem, item.dtValidade]);
    const selected = items.find(item => itemKey(item) === selection) || items.find(item => selection &&
      (byProduct ? item.items.some(row => lotKey(row.lote) === selection) : lotKey(lot(item)) === selection)) || items[0];
    if (!selected) return h("p", { role: "status", className: "sc9-view-empty" }, "Nenhum lote corresponde à busca.");
    return h('div', { className: 'sc9-lots-v4-grid' },
      h('section', { className: 'sc9-lots-v4-queue', 'aria-label': byProduct ? 'Produtos do recorte' : 'Lotes do recorte' },
        h('div', { className: 'sc9-lots-v4-queue-head' }, h('strong', null, byProduct ? 'Produtos do recorte' : 'Lotes do recorte'), h('span', null, items.length, ' nesta página')),
        h('div', { className: 'sc9-lots-v4-queue-list' }, items.map(item =>
          h('button', { key: itemKey(item), type: 'button', 'aria-pressed': item === selected, onClick: () => select(itemKey(item)) },

h('strong', null, byProduct ? 'Produto ' + item.product : 'Lote ' + lot(item)),
            h('span', null, byProduct ? item.description : item.qtdProdutosDistintos ? item.qtdProdutosDistintos + ' produtos diferentes' : product(item) ? 'Produto ' + product(item) : null),
            !byProduct && hasStock(record(item)) && h('small', null, 'Com saldo ativo'))))),
      h('div', { className: 'sc9-lots-v4-selection' }, renderItem(selected)));
  };
  root.SC9LotQueue.matches = (item, search) => {
    const normalize = root.SC9ViewModel.normalize;
    const terms = normalize(search).split(/\s+/).filter(Boolean);
    const content = normalize([item.lote, ...(item.registros || []).flatMap(row => [row.produto, row.descricao])].join(" "));
    return terms.every(term => content.includes(term));
  };
})(window);
