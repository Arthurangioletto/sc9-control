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

  function openDocumentStore() {
    return new Promise((resolve, reject) => {
      const request = root.indexedDB.open('sc9-retem', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('documents');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function Panel({ onBack }) {
    const React = root.React;
    const h = React.createElement;
    const frame = React.useRef(null);
    React.useEffect(() => {
      let store;
      async function receive(event) {
        const message = event.data;
        if (event.source !== frame.current?.contentWindow || message?.type !== 'sc9-retem-storage') return;
        const { requestId, action, key, value, revision, base } = message;
        if (!Number.isSafeInteger(requestId) || !['read','write','commit'].includes(action) ||
            !/^(index|settings|base:[a-f0-9-]+)$/.test(key)) return;
        const reply = { type: 'sc9-retem-storage-result', requestId };
        try {
          store ||= openDocumentStore();
          const db = await store;
          const result = await new Promise((resolve, reject) => {
            const transaction = db.transaction('documents', action === 'read' ? 'readonly' : 'readwrite');
            const items = transaction.objectStore('documents');
            if (action === 'commit') {
              const request = items.get('index');
              let conflict = false;
              request.onsuccess = () => {
                if ((request.result?.revision || 0) !== revision) {
                  conflict = true;
                  transaction.abort();
                  return;
                }
                if (base && /^base:[a-f0-9-]+$/.test(base.key)) {
                  if (base.remove) items.delete(base.key);
                  else items.put(base.value, base.key);
                }
                items.put({...value, revision: revision + 1}, 'index');
              };
              transaction.oncomplete = () => resolve(revision + 1);
              transaction.onabort = () => conflict ? resolve(null) : reject(transaction.error);
              return;
            }
            const request = action === 'read' ? items.get(key) : items.put(value, key);
            transaction.oncomplete = () => resolve(request.result);
            transaction.onabort = () => reject(transaction.error);
          });
          reply.value = result;
        } catch {
          reply.error = 'Não foi possível acessar os documentos neste navegador.';
        }
        event.source.postMessage(reply, '*');
      }
      root.addEventListener('message', receive);
      return () => {
        root.removeEventListener('message', receive);
        store?.then(db => db.close()).catch(() => {});
      };
    }, []);
    return h('main', { className: 'sc9-retem-screen', 'aria-label': 'Retem – armazém 26' },
      h('div', { className: 'sc9-retem-return' },
        h('button', { type: 'button', onClick: onBack, autoFocus: true }, '← Voltar ao SC9')),
      h('iframe', {
        ref: frame,
        className: 'sc9-retem-prototype',
        title: 'Conferência de lotes do Retem',
        src: '/conferencia-de-lotes.html',
        sandbox: 'allow-scripts allow-downloads allow-forms'
      }));
  }

  const api = { readTransfer, indexStock, compare, Panel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SC9Retem = api;
})(typeof window === 'undefined' ? globalThis : window);
