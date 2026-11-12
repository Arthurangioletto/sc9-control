(function (root) {
  const label = {
    confirmado: 'Confirmado no 26',
    sem_saldo: 'Sem saldo positivo no 26',
    nao_encontrado: 'Produto e lote ausentes no 26',
    destino_divergente: 'Produto ou lote diferente no destino',
    linha_invalida: 'Linha incompleta ou quantidade inválida'
  };
  const clean = value => String(value ?? '').trim();
  const code = value => clean(value).toUpperCase();
  const header = value => code(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, '');
  const location = value => /^\d+$/.test(clean(value)) ? String(Number(value)) : code(value);
  const key = (product, lot) => JSON.stringify([code(product), code(lot)]);
  const columns = {
    produto: ['PRODUTO', 'PRODUTOORIGEM'], origem: ['ORIGEM', 'ARMORIGEM', 'ARMAZEMORIGEM'],
    lote: ['LOTE', 'LOTEORIGEM'], produtoDestino: ['PRODUTODESTINO'],
    armazemDestino: ['ARMDESTINO', 'ARMAZEMDESTINO', 'DESTINO'], loteDestino: ['LOTEDESTINO'],
    quantidade: ['QTDE', 'QTD', 'QUANTIDADE']
  };

  function readTransfer(workbook, xlsx) {
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet?.['!ref']) continue;
      const start = xlsx.utils.decode_range(sheet['!ref']).s.r;
      const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: true });
      for (let index = 0; index < Math.min(rows.length, 25); index++) {
        const headers = rows[index].map(header);
        const positions = Object.entries(columns).map(([field, aliases]) => [field, headers.findIndex(name => aliases.includes(name))]);
        if (positions.some(([, position]) => position < 0)) continue;
        const items = rows.slice(index + 1).flatMap((row, offset) => {
          const values = Object.fromEntries(positions.map(([field, position]) => [field, clean(row[position])]));
          const { produto, lote, produtoDestino, loteDestino, quantidade } = values;
          if (![produto, lote, produtoDestino, loteDestino, quantidade].some(Boolean)) return [];
          return [{ ...values, linha: start + index + offset + 2 }];
        });
        if (items.length) return items;
      }
    }
    throw new Error('A planilha de transferência precisa ter Produto, Origem, Lote, Produto Destino, Arm Destino, Lote destino e Qtde.');
  }

  function indexStock(rows) {
    const filiais = new Set(), saldos = new Map();
    for (const row of rows) {
      const filial = location(row.filial);
      if (!filial) throw new Error('O SB8 precisa informar a filial em todas as linhas.');
      filiais.add(filial);
      if (location(row.armazem) !== '26') continue;
      if (!clean(row.produto) || !clean(row.lote) || !Number.isFinite(row.saldo)) {
        throw new Error('O SB8 contém produto, lote ou saldo inválido no armazém 26.');
      }
      if (!saldos.has(filial)) saldos.set(filial, new Map());
      const porLote = saldos.get(filial), id = key(row.produto, row.lote);
      porLote.set(id, (porLote.get(id) || 0) + row.saldo);
    }
    return { filiais: [...filiais].sort((a,b) => a.localeCompare(b, 'pt-BR', { numeric: true })), saldos };
  }

  function compare(items, stock, filial) {
    const saldos = stock.saldos.get(filial);
    return items.map(item => {
      const { produto, lote, produtoDestino, loteDestino, origem, armazemDestino, quantidade } = item;
      const total = Number(quantidade.replace(/\s/g, '').replace(/\.(?=\d{3}(?:[.,]|$))/g, '').replace(',', '.'));
      const saldo = saldos?.get(key(produto, lote)) ?? null;
      let status = 'confirmado';
      if (![produto, lote, produtoDestino, loteDestino, origem, armazemDestino].every(Boolean) || !Number.isFinite(total) || total <= 0) status = 'linha_invalida';
      else if (key(produto, lote) !== key(produtoDestino, loteDestino)) status = 'destino_divergente';
      else if (saldo === null) status = 'nao_encontrado';
      else if (saldo <= 0) status = 'sem_saldo';
      return { ...item, saldo, status };
    });
  }

  function Panel({ readStock }) {
    const R = root.React, h = R.createElement;
    const [stock, setStock] = R.useState(null), [transfer, setTransfer] = R.useState(null);
    const [filial, setFilial] = R.useState(''), [busy, setBusy] = R.useState('');
    const [error, setError] = R.useState(''), [onlyReview, setOnlyReview] = R.useState(false);
    const [page, setPage] = R.useState(0);
    async function upload(file, kind) {
      if (!file) return;
      const isStock = kind === 'SB8';
      if (isStock) { setStock(null); setFilial(''); } else setTransfer(null);
      setError(''); setBusy(kind); setPage(0);
      try {
        if (isStock) {
          const index = indexStock(await readStock(file));
          setStock({ ...index, name: file.name });
          setFilial(index.filiais.length === 1 ? index.filiais[0] : '');
        } else {
          const xlsx = root.XLSX;
          const book = xlsx.read(await file.arrayBuffer(), { type: 'array', raw: true });
          setTransfer({ items: readTransfer(book, xlsx), name: file.name });
        }
      } catch (e) { setError(kind + ' · ' + e.message); }
      finally { setBusy(''); }
    }
    const result = R.useMemo(() => stock && transfer && filial ? compare(transfer.items, stock, filial) : [], [stock, transfer, filial]);
    const confirmed = result.filter(item => item.status === 'confirmado').length;
    const visible = onlyReview ? result.filter(item => item.status !== 'confirmado') : result;
    const paging = root.SC9Paging;
    const info = paging.pageInfo(visible.length, page, 30);
    const fileInput = (title, kind, file) => h('label', { className: 'flex flex-col gap-2 text-sm font-medium' }, title,
      h('input', { type: 'file', accept: '.xlsx,.xls,.xlsm,.csv', disabled: !!busy,
        onChange: event => { const file = event.target.files[0]; event.target.value = ''; upload(file, kind); } }),
      file && h('span', { className: 'text-xs font-normal' }, file.name));
    const rows = visible.slice(info.start, info.end);
    const fields = ['Linha', 'Produto', 'Lote', 'Origem → destino', 'Produto / lote no destino', 'Qtd. da transferência', 'Saldo no 26', 'Conferência'];
    return h('section', { className: 'sc9-overview space-y-4', 'aria-label': 'Retem - armazem 26' },
      h('div', { className: 'sc9-analysis-card' },
        h('h2', { className: 'text-lg font-semibold' }, 'Retem - armazem 26'),
        h('p', { className: 'my-2 text-sm' }, 'Cruze o produto e o lote de origem da transferência com o saldo do Retem na filial escolhida. A quantidade da transferência e o saldo no 26 são exibidos separadamente.'),
        h('div', { className: 'grid gap-4 md:grid-cols-2' },
          fileInput('1. Importar SB8 do dia', 'SB8', stock),
          fileInput('2. Importar planilha de transferência', 'Transferência', transfer)),
        stock && h('label', { className: 'mt-4 flex flex-wrap items-center gap-3 text-sm' }, 'Filial no SB8',
          h('select', { value: filial, className: 'rounded border px-2 py-1', onChange: event => { setFilial(event.target.value); setPage(0); } },
            h('option', { value: '' }, 'Selecione a filial'),
            stock.filiais.map(id => h('option', { key: id, value: id }, id.padStart(2, '0'))))),
        busy && h('p', { role: 'status', className: 'mt-3 text-sm' }, 'Lendo ' + busy + '…'),
        error && h('p', { role: 'alert', className: 'mt-3 text-sm text-red-700' }, error)),
      result.length > 0 && h('div', { className: 'sc9-analysis-card' },
        h('div', { className: 'mb-3 flex flex-wrap items-center justify-between gap-3' },
          h('h3', { className: 'font-semibold', role: 'status' }, confirmed + ' confirmadas · ' + (result.length - confirmed) + ' para revisar'),
          h('label', { className: 'flex items-center gap-2 text-sm' },
            h('input', { type: 'checkbox', checked: onlyReview, onChange: event => { setOnlyReview(event.target.checked); setPage(0); } }), 'Mostrar somente pendências')),
        visible.length === 0 ? h('p', { className: 'text-sm' }, 'Nenhuma pendência nesta conferência.') :
          h(R.Fragment, null,
            h('div', { className: 'sc9-overview-table-wrap' }, h('table', null,
              h('thead', null, h('tr', null, fields.map(field => h('th', { key: field, scope: 'col', className: 'px-2 py-2 text-left' }, field)))),
              h('tbody', null, rows.map(item => h('tr', { key: item.linha, className: 'border-t' },
                [item.linha, item.produto, item.lote, item.origem + ' → ' + item.armazemDestino, item.produtoDestino + ' / ' + item.loteDestino,
                  item.quantidade, item.saldo?.toLocaleString('pt-BR') ?? '—'].map((value, index) => h('td', { key: index, className: 'px-2 py-2' }, value || '—')),
                h('td', { className: 'px-2 py-2 font-semibold ' + (item.status === 'confirmado' ? 'text-teal-700' : 'text-red-700') }, label[item.status])))))),
            h(paging.Controls, { info, onPage: setPage, label: 'linhas' }))));
  }

  const api = { readTransfer, indexStock, compare, Panel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SC9Retem = api;
})(typeof window === 'undefined' ? globalThis : window);
