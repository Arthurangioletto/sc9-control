(function (root) {
  const text = value => String(value ?? '').trim();
  const code = value => text(value).toUpperCase();
  const scope = value => code(value).replace(/^0+(?=\d+$)/, '');
  const header = value => code(value).normalize('NFD').replace(/[\u0300-\u036f]|[^A-Z0-9]/g, '');
  const key = (...parts) => JSON.stringify(parts);

  function sheetRows(book, xlsx, name, columns, optional = []) {
    const sheetName = book.SheetNames.find(value => header(value) === name);
    if (!sheetName) throw Error('Inclua a aba ' + name + ' no arquivo.');
    const rows = xlsx.utils.sheet_to_json(book.Sheets[sheetName], { header: 1, raw: true, defval: '' });
    for (let i = 0; i < Math.min(20, rows.length); i++) {
      const names = rows[i].map(header);
      const positions = Object.entries(columns).map(([field, aliases]) => [field, aliases.map(alias => names.indexOf(alias)).filter(index => index >= 0)]);
      if (positions.some(([field, indexes]) => !indexes.length && !optional.includes(field))) continue;
      return rows.slice(i + 1).map(row => Object.fromEntries(positions.map(([field, indexes]) => {
        const value = indexes.map(index => row[index]).find(value => text(value));
        return [field, field === 'validade' ? validity(value, xlsx) : text(value)];
      })));
    }
    throw Error('Confira os cabeçalhos da aba ' + name + '.');
  }

  function validity(value, xlsx) {
    const raw = text(value);
    if (!raw) return '';
    const serial = typeof value === 'number' ? xlsx.SSF.parse_date_code(value) : null;
    const brazil = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const iso = serial
      ? [serial.y, serial.m, serial.d].map(n => String(n).padStart(2, '0')).join('-')
      : brazil ? [brazil[3], brazil[2], brazil[1]].join('-') : raw.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
    const date = new Date(iso + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : '';
  }

  function read(book, xlsx) {
    const stock = sheetRows(book, xlsx, 'SB8', {
      filial: ['FILIAL','B8FILIAL'], arm: ['ARMAZEM','B8LOCAL'],
      sku: ['PRODUTO','B8PRODUTO'], lote: ['LOTE','B8LOTECTL'],
      saldo: ['SALDOLOTE','SALDO','B8SALDO'], validade: ['DATAVALIDAD','DATAVALIDADE','VALIDADE','B8DTVALID']
    }, ['validade']);
    const addresses = sheetRows(book, xlsx, 'ZZ2', {
      filial: ['FILIAL','ZZ2FILIAL'], arm: ['ARMAZEM','ZZ2LOCAL','ZZ2ARM'],
      sku: ['PRODUTO','ZZ2PRODUTO','ZZ2COD'], endereco: ['ENDERECO','ZZ2ENDERE','ZZ2ENDERECO','ZZ2LOCALIZ'],
      lote: ['LOTE','ZZ2LOTECTL','ZZ2LOTE']
    }, ['lote']);
    const products = sheetRows(book, xlsx, 'SB1', {
      filial: ['FILIAL','B1FILIAL'], sku: ['CODIGO','PRODUTO','B1COD'],
      descricao: ['DESCRICAO','B1DESC'], unidade: ['UNIDADE','UM','B1UM'],
      ean: ['CODBARRAS','CODIGODEBARRAS','CODIGOBARRAS','EAN','B1CODBAR','CODIGOEAN','CODGTIN']
    }, ['filial','unidade','ean']);

    const catalog = new Map(), locations = new Map(), lots = new Map();
    for (const row of products) if (row.sku) catalog.set(key(scope(row.filial), code(row.sku)), row);
    for (const row of addresses) {
      const arm = scope(row.arm);
      if (!['26', '1'].includes(arm) || !row.sku || !row.endereco) continue;
      const id = key(scope(row.filial), arm, code(row.sku), code(row.lote));
      if (!locations.has(id)) locations.set(id, new Set());
      locations.get(id).add(row.endereco);
    }
    for (const row of stock) {
      if (scope(row.arm) !== '26') continue;
      const filial = scope(row.filial), sku = code(row.sku), lote = code(row.lote);
      const amount = Number(row.saldo.includes(',') ? row.saldo.replace(/\./g, '').replace(',', '.') : row.saldo);
      if (!filial || !sku || !lote || !row.saldo || !Number.isFinite(amount)) throw Error('Há uma linha inválida do armazém 26 no SB8. Confira filial, produto, lote e saldo.');
      const id = key(filial, lote);
      if (!lots.has(id)) lots.set(id, { id, lote, filial: filial.padStart(2, '0'), itens: new Map() });
      const group = lots.get(id);
      const existing = group.itens.get(sku);
      if (existing) {
        existing.esperado += amount;
        if (existing.validade !== row.validade) existing.validade = '';
        continue;
      }
      const product = catalog.get(key(filial, sku)) || catalog.get(key('', sku));
      const addressFor = arm => locations.get(key(filial, arm, sku, lote)) || locations.get(key(filial, arm, sku, ''));
      const retemAddress = addressFor('26');
      const addressesForItem = retemAddress || addressFor('1');
      const endereco = addressesForItem
        ? [...addressesForItem].sort().join(' / ') + (retemAddress ? '' : ' (Arm. 01)')
        : '';
      group.itens.set(sku, { id: key(filial, sku, lote), sku: row.sku, lote,
        validade: row.validade, descricao: product?.descricao || sku, ean: product?.ean || '',
        unidade: product?.unidade || '', endereco,
        esperado: amount, conferido: 0, avaria: 0 });
    }
    return [...lots.values()].map(group => ({
      ...group, itens: [...group.itens.values()].filter(item => item.esperado > 0)
    })).filter(group => group.itens.length);
  }

  function findInventoryScan(items, value) {
    const input = code(value);
    if (!input) return { ambiguous: false };
    const matches = items.filter(item => [item.lote, item.sku, item.ean].some(value => code(value) === input));
    return matches.length === 1 ? { item: matches[0] } : { ambiguous: matches.length > 1 };
  }
  root.SC9RetemInventory = { read, findInventoryScan };
  if (typeof module === 'object' && module.exports) module.exports = root.SC9RetemInventory;
})(typeof window === 'object' ? window : globalThis);
