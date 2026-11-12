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
    const [error, setError] = R.useState(''), [filter, setFilter] = R.useState('todos');
    const [page, setPage] = R.useState(0);
    async function upload(file, kind) {
      if (!file) return;
      const isStock = kind === 'SB8';
      if (isStock) { setStock(null); setFilial(''); } else setTransfer(null);
      setError(''); setBusy(kind); setFilter('todos'); setPage(0);
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
    const ready = Boolean(stock && transfer && filial);
    const result = R.useMemo(() => ready ? compare(transfer.items, stock, filial) : [], [ready, stock, transfer, filial]);
    const group = item => {
      if (item.status === 'confirmado') return 'confirmados';
      if (item.status === 'sem_saldo' || item.status === 'nao_encontrado') return 'estoque';
      return 'planilha';
    };
    const counts = { todos: result.length, confirmados: 0, estoque: 0, planilha: 0 };
    for (const item of result) counts[group(item)]++;
    const percentage = ready ? Math.round(counts.confirmados * 100 / counts.todos) : 0;
    const visible = result.filter(item => {
      if (filter === 'todos') return true;
      if (filter === 'revisar') return item.status !== 'confirmado';
      return group(item) === filter;
    });
    const paging = root.SC9Paging;
    const info = paging.pageInfo(visible.length, page, 30);
    const fileInput = (title, kind, file) => h('div', { className: 'sc9-retem-file' },
      h('label', null, h('strong', null, title),
        h('span', { className: 'sc9-retem-file-action', 'aria-hidden': true }, file ? 'Trocar arquivo' : 'Selecionar arquivo'),
        h('input', { type: 'file', accept: '.xlsx,.xls,.xlsm,.csv', disabled: !!busy, 'aria-label': title,
          onChange: event => { const selected = event.target.files[0]; event.target.value = ''; upload(selected, kind); } })),
      file && h('span', { className: 'sc9-retem-filename', title: file.name }, file.name));
    const rows = visible.slice(info.start, info.end);
    const fields = ['Linha', 'Produto', 'Lote', 'Origem → destino', 'Produto / lote no destino', 'Qtd. da transferência', 'Saldo no 26', 'Conferência'];
    const tabs = [['todos','Todos'], ['confirmados','Conferidos'], ['estoque','Pendências de saldo'], ['planilha','Divergências na planilha']];
    const filters = [tabs[0], ['revisar','Para revisar'], ...tabs.slice(1)];
    const format = value => value.toLocaleString('pt-BR');
    return h('section', { className: 'sc9-retem', 'aria-labelledby': 'sc9-retem-title' },
      h('header', { className: 'sc9-retem-banner' },
        h('div', null, h('span', { className: 'sc9-retem-mark', 'aria-hidden': true }, '26'),
          h('strong', null, 'Conferência de lotes')),
        h('span', null, filial ? 'Filial ' + filial.padStart(2, '0') : 'Retem')),
      h('div', { className: 'sc9-retem-layout' },
        h('aside', { className: 'sc9-retem-rail', 'aria-label': 'Arquivos da conferência' },
          h('h3', { className: 'sc9-retem-caps' }, 'Arquivos da conferência'),
          fileInput('Importar SB8 do dia', 'SB8', stock),
          fileInput('Importar planilha de transferência', 'Transferência', transfer),
          h('label', { className: 'sc9-retem-branch' }, 'Filial no SB8',
            h('select', { value: filial, disabled: !stock || !!busy, onChange: event => { setFilial(event.target.value); setFilter('todos'); setPage(0); } },
            h('option', { value: '' }, 'Selecione a filial'),
            stock?.filiais.map(id => h('option', { key: id, value: id }, id.padStart(2, '0'))))),
          busy && h('p', { role: 'status' }, 'Lendo ' + busy + '…'),
          error && h('p', { role: 'alert', className: 'sc9-retem-error' }, error)),
        h('div', { className: 'sc9-retem-work' },
          h('div', { className: 'sc9-retem-heading' },
            h('div', null,
              h('p', { className: 'sc9-retem-caps' }, 'Conferência de estoque'),
              h('h2', { id: 'sc9-retem-title' }, 'Retem – armazém 26'),
              h('p', null, 'Confira o produto e o lote de origem com o SB8 da filial selecionada.')),
            ready && h('div', { className: 'sc9-retem-progress', role: 'img', 'aria-label': percentage + '% das linhas conferidas' },
              h('div', null, h('span', { className: 'sc9-retem-caps' }, 'Linhas conferidas'),
                h('strong', null, format(counts.confirmados) + ' / ' + format(counts.todos))),
              h('div', { className: 'sc9-retem-ring', style: { '--sc9-retem-progress': percentage + '%' } }, h('strong', null, percentage + '%')))),
          ready ? h(R.Fragment, null,
            h('div', { className: 'sc9-retem-metrics', 'aria-label': 'Resumo da conferência' },
              tabs.map(([id,title]) => h('div', { key: id, className: 'sc9-retem-metric ' + id },
                h('span', { className: 'sc9-retem-caps' }, id === 'todos' ? 'Linhas da transferência' : title),
                h('strong', null, format(counts[id]))))),
            h('div', { className: 'sc9-retem-filters', role: 'group', 'aria-label': 'Filtrar por resultado' },
              filters.map(([id,title]) => h('button', { key: id, type: 'button', 'aria-pressed': filter === id,
                onClick: () => { setFilter(id); setPage(0); } }, title, h('span', null, format(id === 'revisar' ? counts.estoque + counts.planilha : counts[id]))))),
            visible.length === 0 ? h('p', { className: 'sc9-retem-empty' }, 'Nenhum item neste filtro.') :
              h('div', { className: 'sc9-retem-results' },
                h('div', { className: 'sc9-retem-table-scroll', tabIndex: 0, role: 'region', 'aria-label': 'Linhas da conferência' },
                  h('table', null,
                    h('thead', null, h('tr', null, fields.map(field => h('th', { key: field, scope: 'col' }, field)))),
                    h('tbody', null, rows.map(item => h('tr', { key: item.linha },
                      [item.linha, item.produto, item.lote, item.origem + ' → ' + item.armazemDestino, item.produtoDestino + ' / ' + item.loteDestino,
                        item.quantidade, item.saldo == null ? '—' : format(item.saldo)].map((value, index) => h('td', { key: index }, value || '—')),
                      h('td', null, h('span', { className: 'sc9-retem-badge ' + group(item) }, label[item.status]))))))),
                h(paging.Controls, { info, onPage: setPage, label: visible.length === 1 ? 'linha' : 'linhas' }))) :
            h('p', { className: 'sc9-retem-empty' }, stock && transfer ? 'Selecione a filial para ver o resultado.' : 'Importe o SB8 do dia e a planilha de transferência para iniciar.'))));
  }

  const api = { readTransfer, indexStock, compare, Panel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SC9Retem = api;
})(typeof window === 'undefined' ? globalThis : window);
