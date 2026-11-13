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
  function template(xlsx) {
    const book = xlsx.utils.book_new();
    const headers = {
      SB8: ['Filial', 'Produto', 'Armazem', 'Data Validad', 'Saldo Lote', 'Lote'],
      ZZ2: ['Filial', 'Armazem', 'Endereco', 'Produto', 'Lote'],
      SB1: ['Filial', 'Codigo', 'Descricao', 'Unidade', 'Cod Barras']
    };
    for (const [name, columns] of Object.entries(headers)) {
      xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet([columns]), name);
    }
    return xlsx.write(book, { bookType: 'xlsx', type: 'array' });
  }

  function savePartial(arquivo, items) {
    return JSON.stringify({ format: 'sc9-retem-parcial', version: 1, arquivo, items });
  }

  function readPartial(source) {
    let data;
    try {
      data = JSON.parse(source);
    } catch {
      throw Error('O arquivo de conferência parcial está inválido.');
    }
    const ids = new Set();
    const lots = new Set();
    const textFields = ['id', 'filial', 'lote', 'sku', 'ean', 'descricao', 'validade', 'endereco', 'unidade'];
    const items = data?.items;
    if (data?.format !== 'sc9-retem-parcial' || data.version !== 1 ||
        typeof data.arquivo !== 'string' || !Array.isArray(items) || !items.length) {
      throw Error('Selecione um arquivo salvo em Salvar parcial no Retem.');
    }
    for (const item of items) {
      if (!item || textFields.some(field => typeof item[field] !== 'string') ||
          !item.id || !item.filial || !item.lote || !item.sku || ids.has(item.id) ||
          !Number.isFinite(item.esperado) || item.esperado <= 0 ||
          !Number.isFinite(item.conferido) || item.conferido < 0 ||
          !Number.isFinite(item.avaria) || item.avaria < 0 ||
          (item.validade && validity(item.validade) !== item.validade)) {
        throw Error('O arquivo de conferência parcial contém itens inválidos.');
      }
      ids.add(item.id);
      lots.add(key(item.filial, item.lote));
    }
    return { arquivo: data.arquivo, items, lotCount: lots.size };
  }

  function records(items) {
    return items.filter(item => item.conferido || item.avaria).map(item => ({
      ...item, itemId: item.id, loteId: JSON.stringify([item.filial, item.lote]),
      loteProduto: item.lote, fornecedor: 'Filial ' + item.filial, nf: '—', doca: '—', placa: '—', chegada: '—'
    }));
  }

  function restore(base, saved) {
    const recorded = new Set(saved.map(item => item.id));
    return [...saved, ...base.filter(item => !recorded.has(item.id))];
  }

  function compareTransfer(lines, movements, { filial = '', documento = '' } = {}) {
    const amountEqual = (a, b) => Math.abs(a - b) < 1e-8;
    const expected = new Map();
    for (const row of lines) {
      const produto = code(row.produto), lote = scope(row.lote);
      const origem = scope(row.origem), destino = scope(row.destino);
      if (!produto || !lote || !origem || !destino || origem === destino || !Number.isFinite(row.qtd) || row.qtd <= 0) {
        throw Error('O documento precisa de produto, lote, origem, destino diferente e quantidade positiva em cada linha.');
      }
      const id = key(produto, lote, origem, destino);
      const previous = expected.get(id);
      expected.set(id, { ...row, qtd: (previous?.qtd || 0) + row.qtd });
    }

    const index = new Map();
    for (const row of movements) {
      if (![499,999].includes(row.tp) || row.estornado || row.qt <= 0 || (filial && scope(row.filial) !== scope(filial)) ||
          (documento && scope(row.doc) !== scope(documento))) continue;
      if (row.cf && row.cf !== (row.tp === 999 ? 'RE4' : 'DE4')) continue;
      const id = key(code(row.produto), scope(row.lote));
      if (!index.has(id)) index.set(id, []);
      index.get(id).push(row);
    }

    const routesByItem = new Map();
    for (const row of expected.values()) {
      const id = key(code(row.produto), scope(row.lote));
      if (!routesByItem.has(id)) routesByItem.set(id, []);
      routesByItem.get(id).push(row);
    }

    const result = [...expected.values()].map(row => {
      const id = key(code(row.produto), scope(row.lote));
      const routes = routesByItem.get(id);
      const origin = scope(row.origem), destination = scope(row.destino);
      const groups = new Map();
      const branches = new Set();
      for (const move of index.get(id) || []) {
        const local = scope(move.armazem);
        if (move.tp === 999 ? local !== origin : local !== destination) continue;
        const groupId = key(move.filial, move.dt, move.doc);
        if (!groups.has(groupId)) groups.set(groupId, { out:0, incoming:0, doc:move.doc });
        const group = groups.get(groupId);
        if (move.tp === 999) group.out += move.qt;
        else group.incoming += move.qt;
        branches.add(move.filial);
      }
      const groupsFound = [...groups.values()];
      const saidaSd3 = groupsFound.reduce((sum, group) => sum + group.out, 0);
      const entradaSd3 = groupsFound.reduce((sum, group) => sum + group.incoming, 0);
      const sharedRoute = routes.some(other => other !== row && (scope(other.origem) === origin || scope(other.destino) === destination));
      const matched = !sharedRoute && branches.size === 1 && groupsFound.every(group => amountEqual(group.out, group.incoming)) &&
        amountEqual(saidaSd3, row.qtd) && amountEqual(entradaSd3, row.qtd);
      const detalhe = branches.size > 1 ? 'Há movimentos em mais de uma filial. Informe a filial.' :
        sharedRoute ? 'O produto e lote têm rotas que compartilham uma ponta. Separe os documentos por rota.' :
        groupsFound.some(group => !amountEqual(group.out, group.incoming)) ? 'Há saída e entrada sem par no mesmo documento, filial e data.' : '';
      return {
        produto: row.produto, lote: row.lote, origem: row.origem, destino: row.destino,
        qtdDocumento: row.qtd, saidaSd3, entradaSd3, detalhe,
        situacao: matched ? 'confere' : groupsFound.length ? 'divergente' : 'nao_encontrado',
        documentosSd3: [...new Set(groupsFound.map(group => group.doc))], outrosLotes: []
      };
    });
    const routes = [...new Map([...expected.values()].map(row => [
      key(scope(row.origem), scope(row.destino)), { origem:row.origem, destino:row.destino }
    ])).values()];
    if (documento && routes.length === 1) {
      const { origem, destino } = routes[0];
      for (const [id, moves] of index) {
        if (routesByItem.has(id)) continue;
        const onRoute = moves.filter(move => scope(move.armazem) === scope(move.tp === 999 ? origem : destino));
        if (!onRoute.length) continue;
        result.push({
          produto:onRoute[0].produto,lote:onRoute[0].lote,origem,destino,qtdDocumento:0,
          saidaSd3:onRoute.filter(move=>move.tp===999).reduce((sum,move)=>sum+move.qt,0),
          entradaSd3:onRoute.filter(move=>move.tp===499).reduce((sum,move)=>sum+move.qt,0),
          situacao:'divergente',detalhe:'Produto e lote presentes no SD3 e ausentes na planilha da transferência.',
          documentosSd3:[...new Set(onRoute.map(move=>move.doc))],outrosLotes:[]
        });
      }
    }
    return result;
  }


  const calendar = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});

  function expiryStatus(value, today = calendar.format(new Date())) {
    const date = validity(text(value));
    if (!date) return 'Sem validade informada';
    if (date < today) return 'Vencido';
    if (date === today) return 'Vence hoje';
    return 'Dentro da validade';
  }

  // SheetJS Community Edition does not write cell fills. Add the style to the generated XLSX.
  function highlightExpiredWorkbook(bytes, xlsx, sheets) {
    if (!sheets.some(rows => rows.length)) return bytes;
    const zip = xlsx.CFB.read(new Uint8Array(bytes), {type:'array'});
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    function update(path, edit) {
      const entry = xlsx.CFB.find(zip, "/"+path);
      if (!entry) throw Error('Não foi possível formatar a planilha de vencidos.');
      const data = encoder.encode(edit(decoder.decode(entry.content)));
      entry.content = data;
      entry.size = data.length;
    }
    let fillId, fontId, styleId;
    function append(xml, tag, child, setIndex) {
      return xml.replace(new RegExp('<'+tag+' count="(\\d+)">([\\s\\S]*?)</'+tag+'>'), (_, count, body) => {
        setIndex(Number(count));
        return '<'+tag+' count="'+(Number(count)+1)+'">'+body+child+'</'+tag+'>';
      });
    }
    update('xl/styles.xml', xml => {
      xml=append(xml,'fills','<fill><patternFill patternType="solid"><fgColor rgb="FFB91C1C"/><bgColor indexed="64"/></patternFill></fill>',id=>{fillId=id});
      xml=append(xml,'fonts','<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>',id=>{fontId=id});
      return append(xml,'cellXfs','<xf numFmtId="0" fontId="'+fontId+'" fillId="'+fillId+'" borderId="0" xfId="0" applyFont="1" applyFill="1"/>',id=>{styleId=id});
    });
    if (styleId === undefined) throw Error('Não foi possível aplicar o destaque de validade no Excel.');
    sheets.forEach((rows,index)=>{
      if (!rows.length) return;
      const highlighted = new Set([1,...rows]);
      update('xl/worksheets/sheet'+(index+1)+'.xml', xml => xml.replace(/<c\b[^>]*\br="[A-Z]+(\d+)"[^>]*>/g, (cell,row) => {
        if (!highlighted.has(Number(row))) return cell;
        const plain = cell.replace(/ s="\d+"/,'');
        return plain.replace(/(\/?>)$/, ' s="'+styleId+'"$1');
      }));
    });
    return xlsx.CFB.write(zip,{type:'array',fileType:'zip',compression:true});
  }

  root.SC9RetemInventory = { read, findInventoryScan, template, savePartial, readPartial, records, restore, compareTransfer, expiryStatus, highlightExpiredWorkbook };
  if (typeof module === 'object' && module.exports) module.exports = root.SC9RetemInventory;
})(typeof window === 'object' ? window : globalThis);
