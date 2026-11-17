/* Análise de gaveta — regras puras (leitura dos Excel do Protheus, cruzamento SB8 × ZZ2 × SB1,
 * situação da validade, validação da análise e painel). Roda no navegador e no servidor. */
(function (root) {
  const text = value => String(value ?? '').trim();
  const upper = value => text(value).toUpperCase();
  // Filial e armazém: "01" e "1" são o mesmo lugar; "ES", "BH" etc. ficam como estão.
  const place = value => { const v = upper(value); return /^\d+$/.test(v) ? String(Number(v)) : v; };
  const product = value => upper(value);
  const header = value => upper(value).normalize('NFD').replace(/[̀-ͯ]|[^A-Z0-9]/g, '');
  const armLabel = value => /^\d$/.test(place(value)) ? '0' + place(value) : place(value);
  const DAY = 86400000;
  const BASE_VALID_HOURS = 24;

  // ---------- datas ----------
  function isoDate(value) {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : '';
    const raw = text(value);
    if (!raw) return '';
    let y, m, d;
    if (typeof value === 'number' && value > 20000 && value < 80000) {
      const date = new Date(Math.round((value - 25569) * DAY));
      return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
    }
    let match;
    if ((match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/))) [, y, m, d] = match;            // 2027-05-01
    else if ((match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/))) [, d, m, y] = match;       // 01/05/2027
    else if ((match = raw.match(/^(\d{4})(\d{2})(\d{2})$/))) [, y, m, d] = match;          // 20270501 (Protheus)
    else return '';
    const iso = y + '-' + m + '-' + d;
    const date = new Date(iso + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : '';
  }

  function validity(iso, today) {
    if (!iso) return { key: 'sem', label: 'Sem validade', tone: 'muted', days: null };
    const days = Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / DAY);
    if (days < 0) return { key: 'vencido', label: 'Vencido há ' + (-days) + 'd', tone: 'red', days };
    if (days === 0) return { key: 'hoje', label: 'Vence hoje', tone: 'red', days };
    if (days <= 30) return { key: 'critico', label: 'Vence em ' + days + 'd', tone: 'orange', days };
    if (days <= 90) return { key: 'atencao', label: 'Vence em ' + days + 'd', tone: 'yellow', days };
    return { key: 'ok', label: 'Válido · ' + days + 'd', tone: 'green', days };
  }

  // ---------- leitura dos Excel ----------
  const FIELDS = {
    sb8: {
      filial: ['FILIAL', 'B8FILIAL'], produto: ['PRODUTO', 'B8PRODUTO'], arm: ['ARMAZEM', 'B8LOCAL', 'LOCAL'],
      lote: ['LOTE', 'B8LOTECTL', 'LOTECTL'], saldo: ['SALDO', 'SALDOLOTE', 'B8SALDO'],
      empenho: ['EMPENHO', 'B8EMPENHO'], validade: ['DATAVALIDADE', 'DATAVALIDAD', 'VALIDADE', 'B8DTVALID', 'DTVALID'],
      excluido: ['DELET', 'DELETE']
    },
    zz2: {
      filial: ['FILIAL', 'ZZ2FILIAL'], arm: ['ARMAZEM', 'ZZ2LOCAL', 'ZZ2ARM', 'LOCAL'],
      endereco: ['ENDERECO', 'ZZ2ENDERE', 'ZZ2ENDERECO', 'ZZ2LOCALIZ', 'LOCALIZ'], produto: ['PRODUTO', 'ZZ2PRODUTO', 'ZZ2COD'],
      lote: ['LOTE', 'ZZ2LOTECTL', 'ZZ2LOTE'], armario: ['ARMARIO', 'ZZ2ARMARIO'], excluido: ['DELET', 'DELETE']
    },
    sb1: {
      codigo: ['CODIGO', 'B1COD', 'PRODUTO'], descricao: ['DESCRICAO', 'B1DESC', 'DESC'],
      unidade: ['UNIDADE', 'UM', 'B1UM'], ean: ['CODBARRAS', 'CODIGODEBARRAS', 'CODIGOBARRAS', 'EAN', 'B1CODBAR', 'CODGTIN']
    }
  };
  const REQUIRED = {
    sb8: ['produto', 'arm', 'lote', 'saldo'], zz2: ['endereco', 'produto'], sb1: ['codigo', 'descricao']
  };

  function columnsFor(kind, names) {
    const out = {};
    for (const [field, aliases] of Object.entries(FIELDS[kind])) {
      const index = aliases.map(alias => names.indexOf(alias)).find(position => position >= 0);
      if (index !== undefined) out[field] = index;
    }
    return REQUIRED[kind].every(field => field in out) ? out : null;
  }

  // Descobre qual é cada aba (SB8, ZZ2 ou SB1) pelos cabeçalhos, em qualquer arquivo.
  function detectSheet(rows) {
    for (let i = 0; i < Math.min(25, rows.length); i++) {
      const names = rows[i].map(header);
      for (const kind of ['sb8', 'zz2', 'sb1']) {
        const columns = columnsFor(kind, names);
        if (columns) return { kind, columns, start: i + 1 };
      }
    }
    return null;
  }

  const number = value => {
    if (typeof value === 'number') return value;
    const raw = text(value);
    if (!raw) return NaN;
    return Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
  };
  const deleted = value => text(value) === '*';

  // Lê as linhas de dados uma a uma (serve tanto para a aba inteira quanto para a leitura em fluxo).
  function sheetParser(detected) {
    const { kind, columns } = detected;
    const cell = (row, field) => field in columns ? row[columns[field]] : '';
    const out = [];
    const stats = { lidas: 0, ignoradas: 0 };
    const push = row => {
      if (!row || row.every(value => !text(value))) return;
      stats.lidas++;
      if (deleted(cell(row, 'excluido'))) { stats.ignoradas++; return; }
      if (kind === 'sb8') {
        const saldo = number(cell(row, 'saldo')), empenho = number(cell(row, 'empenho'));
        const prod = product(cell(row, 'produto')), lote = upper(cell(row, 'lote')), arm = place(cell(row, 'arm'));
        // Só interessa quem tem saldo positivo e identifica produto, lote e armazém.
        if (!prod || !lote || !arm || !Number.isFinite(saldo) || saldo <= 0) { stats.ignoradas++; return; }
        out.push([place(cell(row, 'filial')), prod, arm, lote, saldo, Number.isFinite(empenho) && empenho > 0 ? empenho : 0, isoDate(cell(row, 'validade'))]);
      } else if (kind === 'zz2') {
        const prod = product(cell(row, 'produto')), endereco = upper(cell(row, 'endereco'));
        if (!prod || !endereco) { stats.ignoradas++; return; }
        out.push([place(cell(row, 'filial')), place(cell(row, 'arm')), endereco, prod, upper(cell(row, 'lote')), upper(cell(row, 'armario'))]);
      } else {
        const code = product(cell(row, 'codigo'));
        if (!code) { stats.ignoradas++; return; }
        out.push([code, text(cell(row, 'descricao')), text(cell(row, 'unidade')), text(cell(row, 'ean'))]);
      }
    };
    return { push, result: () => ({ kind, rows: out, stats }) };
  }

  function parseSheet(detected, rows) {
    const parser = sheetParser(detected);
    for (let i = detected.start; i < rows.length; i++) parser.push(rows[i]);
    return parser.result();
  }

  // Lê um workbook do SheetJS e devolve o que encontrou: { sb8?, zz2?, sb1? }.
  function readWorkbook(book, xlsx) {
    const found = {};
    for (const name of book.SheetNames) {
      const sheet = book.Sheets[name];
      if (!sheet) continue;
      // Primeiro só o topo da aba (cabeçalho): evita converter 400 mil linhas de abas que não interessam.
      const head = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', range: { s: { r: 0, c: 0 }, e: { r: 24, c: 60 } } });
      const peek = detectSheet(head);
      if (!peek || found[peek.kind]) continue;
      const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
      const detected = detectSheet(rows) || peek;
      found[detected.kind] = parseSheet(detected, rows);
    }
    return found;
  }

  // ---------- planilhas gigantes (leitura em fluxo) ----------
  // O SB8 completo do Protheus (~400 mil linhas × 38 colunas) vira um XML de ~850 MB dentro do .xlsx de ~65 MB,
  // maior que o limite de texto do navegador: o SheetJS descarta essa aba sem avisar. Aqui o .xlsx é aberto
  // como zip, a aba é descompactada aos pedaços e só as colunas necessárias são lidas, linha a linha.
  const XML_ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
  const unescapeXml = value => value.includes('&')
    ? value.replace(/&#x([0-9a-f]+);|&#(\d+);|&(lt|gt|amp|quot|apos);/gi, (all, hex, dec, name) =>
      name ? XML_ENTITIES[name.toLowerCase()] : String.fromCodePoint(hex ? parseInt(hex, 16) : Number(dec)))
    : value;
  const columnIndex = letters => { let n = 0; for (let i = 0; i < letters.length; i++) n = n * 26 + letters.charCodeAt(i) - 64; return n - 1; };

  function zipEntries(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
    if (end < 0) throw Error('Arquivo .xlsx inválido (não é um zip).');
    const count = view.getUint16(end + 10, true);
    const decoder = new TextDecoder();
    const entries = {};
    let at = view.getUint32(end + 16, true);
    for (let i = 0; i < count && view.getUint32(at, true) === 0x02014b50; i++) {
      const nameLength = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true);
      const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
      entries[name] = { method: view.getUint16(at + 10, true), size: view.getUint32(at + 20, true), total: view.getUint32(at + 24, true), offset: view.getUint32(at + 42, true) };
      at += 46 + nameLength + extra + comment;
    }
    return entries;
  }

  function entryText(bytes, entry) {
    if (entry.size === 0xFFFFFFFF || entry.offset === 0xFFFFFFFF) throw Error('Arquivo .xlsx grande demais (zip64).');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true);
    let stream = new Blob([bytes.subarray(start, start + entry.size)]).stream();
    if (entry.method === 8) {
      if (typeof DecompressionStream === 'undefined') throw Error('Este navegador não consegue abrir planilha tão grande. Use um Chrome atualizado no computador.');
      stream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
    } else if (entry.method !== 0) throw Error('Compressão do .xlsx não suportada.');
    return stream.pipeThrough(new TextDecoderStream());
  }

  // Quebra o XML da aba em <row>…</row> e entrega cada linha como vetor (só as colunas pedidas, se "wanted" existir).
  async function streamRows(textStream, shared, onRow, onProgress) {
    const reader = textStream.getReader();
    const cellPattern = /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    const rowToArray = (xml, wanted) => {
      const row = [];
      cellPattern.lastIndex = 0;
      let match;
      while ((match = cellPattern.exec(xml))) {
        const column = columnIndex(match[1]);
        if (wanted && !wanted.has(column)) continue;
        const body = match[3];
        if (body === undefined) continue;
        const type = /\bt="(\w+)"/.exec(match[2]);
        const kind = type ? type[1] : 'n';
        let value;
        if (kind === 'inlineStr') { value = ''; body.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, (all, part) => { value += unescapeXml(part); return all; }); }
        else {
          const raw = /<v>([\s\S]*?)<\/v>/.exec(body);
          if (!raw) continue;
          value = kind === 's' ? (shared[Number(raw[1])] ?? '') : kind === 'n' ? Number(raw[1]) : kind === 'b' ? raw[1] === '1' : unescapeXml(raw[1]);
        }
        row[column] = value;
      }
      return row;
    };
    let buffer = '', read = 0, stop = false;
    const wantedBox = { set: null };
    while (!stop) {
      const { value, done } = await reader.read();
      if (value) { buffer += value; read += value.length; }
      let from = 0;
      for (;;) {
        const open = buffer.indexOf('<row ', from);
        if (open < 0) break;
        const close = buffer.indexOf('>', open);
        if (close < 0) break;
        if (buffer.charCodeAt(close - 1) === 47) { from = close + 1; continue; }   // <row … /> (linha vazia)
        const end = buffer.indexOf('</row>', close);
        if (end < 0) break;
        const result = onRow(xml => rowToArray(xml, wantedBox.set), buffer.slice(close + 1, end), wantedBox);
        from = end + 6;
        if (result === false) { stop = true; break; }
      }
      buffer = from ? buffer.slice(from) : buffer;
      if (!stop && buffer.length > 64 && buffer.indexOf('<row ') < 0) buffer = buffer.slice(-8);
      if (onProgress) onProgress(read);
      if (done) break;
    }
    if (stop) await reader.cancel().catch(() => {});
  }

  async function sharedStringsFrom(bytes, entries) {
    const entry = entries['xl/sharedStrings.xml'];
    if (!entry) return [];
    const reader = entryText(bytes, entry).getReader();
    let xml = '';
    for (;;) { const { value, done } = await reader.read(); if (value) xml += value; if (done) break; }
    const list = [];
    xml.replace(/<si>([\s\S]*?)<\/si>/g, (all, body) => {
      let value = '';
      body.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, (inner, part) => { value += unescapeXml(part); return inner; });
      list.push(value);
      return all;
    });
    return list;
  }

  // Lê um .xlsx aos pedaços e devolve { sb8?, zz2?, sb1? } como o readWorkbook. onProgress(0..1) opcional.
  async function readWorkbookStream(buffer, onProgress) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const entries = zipEntries(bytes);
    const names = Object.keys(entries).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    if (!names.length) throw Error('Arquivo .xlsx sem abas.');
    const shared = await sharedStringsFrom(bytes, entries);
    const found = {};
    for (const name of names) {
      const entry = entries[name];
      const head = [];
      let parser = null;
      await streamRows(entryText(bytes, entry), shared, (parse, xml, box) => {
        if (parser) { parser.push(parse(xml)); return true; }
        head.push(parse(xml));
        const detected = detectSheet(head.map(row => Array.from(row, value => value ?? '')));
        if (detected) {
          if (found[detected.kind]) return false;
          box.set = new Set(Object.values(detected.columns));
          parser = sheetParser(detected);
          for (let i = detected.start; i < head.length; i++) parser.push(head[i]);
          return true;
        }
        return head.length < 25;
      }, onProgress && (chars => onProgress(Math.min(1, chars / Math.max(1, entry.total)))));
      if (parser) { const result = parser.result(); found[result.kind] = result; }
    }
    return found;
  }

  // ---------- validação do que chega ao servidor ----------
  function cleanSb8(rows) {
    if (!Array.isArray(rows) || !rows.length || rows.length > 300000) throw Error('O SB8 precisa ter de 1 a 300.000 linhas com saldo.');
    return rows.map(row => {
      if (!Array.isArray(row) || row.length !== 7) throw Error('Linha inválida no SB8.');
      const [filial, prod, arm, lote, saldo, empenho, validade] = row;
      if (!text(prod) || !text(arm) || !text(lote) || !Number.isFinite(Number(saldo)) || Number(saldo) <= 0) throw Error('Linha inválida no SB8.');
      return [place(filial), product(prod), place(arm), upper(lote), Number(saldo), Math.max(0, Number(empenho) || 0), isoDate(validade)];
    });
  }
  function cleanZz2(rows) {
    if (!Array.isArray(rows) || !rows.length || rows.length > 200000) throw Error('O ZZ2 precisa ter de 1 a 200.000 linhas.');
    return rows.map(row => {
      if (!Array.isArray(row) || row.length !== 6 || !text(row[2]) || !text(row[3])) throw Error('Linha inválida no ZZ2.');
      return [place(row[0]), place(row[1]), upper(row[2]).slice(0, 60), product(row[3]), upper(row[4]).slice(0, 60), upper(row[5]).slice(0, 60)];
    });
  }
  function cleanSb1(rows) {
    if (!Array.isArray(rows) || !rows.length || rows.length > 400000) throw Error('O SB1 precisa ter de 1 a 400.000 produtos.');
    const map = {};
    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== 4 || !text(row[0])) throw Error('Linha inválida no SB1.');
      map[product(row[0])] = [text(row[1]).slice(0, 120), text(row[2]).slice(0, 10), text(row[3]).slice(0, 30)];
    }
    return map;
  }

  // ---------- cruzamentos ----------
  // No ZZ2 os armários vêm como endereços ZARM01, ZARM02…; o resto são gavetas.
  const isArmario = codigo => /^ZARM/.test(upper(codigo));
  // O QR da gaveta traz o número dela (AA01); aceita também texto com prefixo, URL ou espaços.
  function matchGaveta(content, codes) {
    const known = new Map();
    for (const code of codes) known.set(upper(code), code);
    const raw = upper(content);
    if (!raw) return '';
    if (known.has(raw)) return known.get(raw);
    const tokens = raw.split(/[^A-Z0-9]+/).filter(Boolean);
    for (let i = tokens.length - 1; i >= 0; i--) if (known.has(tokens[i])) return known.get(tokens[i]);
    const joined = tokens.join('');
    return known.has(joined) ? known.get(joined) : '';
  }
  const gavetaId = (filial, arm, codigo) => [place(filial), place(arm), upper(codigo)].join('|');

  // Uma gaveta = um endereço do ZZ2 num armazém e filial.
  function gavetasFrom(zz2Rows) {
    const map = new Map();
    for (const [filial, arm, endereco, prod, lote, armario] of zz2Rows) {
      const id = gavetaId(filial, arm, endereco);
      if (!map.has(id)) map.set(id, { id, filial, arm, codigo: endereco, armario: '', itens: new Map() });
      const gaveta = map.get(id);
      if (armario && !gaveta.armario) gaveta.armario = armario;
      if (!gaveta.itens.has(prod)) gaveta.itens.set(prod, new Set());
      if (lote) gaveta.itens.get(prod).add(lote);
    }
    return map;
  }

  function indexSb8(rows) {
    const byProduct = new Map(), byLote = new Map();
    for (const row of rows) {
      if (!byProduct.has(row[1])) byProduct.set(row[1], []);
      byProduct.get(row[1]).push(row);
      if (!byLote.has(row[3])) byLote.set(row[3], []);
      byLote.get(row[3]).push(row);
    }
    return { byProduct, byLote };
  }

  // Ordem de consulta quando o produto não tem (ou além do) saldo no armazém da gaveta:
  // 01 é o principal, 02 o secundário, depois 59/30/20/25 e as filiais; o resto vem por último.
  const ARM_PRIORITY = ['1', '2', '59', '30', '20', '25', 'ES', 'BH', 'DF', 'RJ', 'CE', 'ET', 'BT', 'RT', 'CT', 'DT'];
  const armRank = arm => { const index = ARM_PRIORITY.indexOf(place(arm)); return index < 0 ? ARM_PRIORITY.length : index; };
  const byArm = (a, b) => armRank(a[2]) - armRank(b[2]) || a[2].localeCompare(b[2], 'pt-BR', { numeric: true });
  const byValidity = (a, b) => (a[6] || '9999') < (b[6] || '9999') ? -1 : (a[6] || '9999') > (b[6] || '9999') ? 1 : a[3].localeCompare(b[3], 'pt-BR', { numeric: true });
  const stockRow = row => ({ filial: row[0], arm: row[2], lote: row[3], saldo: row[4], empenho: row[5], validade: row[6] });

  // Tudo o que a pessoa precisa ver ao abrir uma gaveta.
  function detail(ctx, id) {
    const gaveta = ctx.gavetas.get(id);
    if (!gaveta) return null;
    const itens = [];
    for (const [prod, restritos] of gaveta.itens) {
      const info = ctx.sb1[prod] || [];
      const rows = (ctx.sb8.byProduct.get(prod) || []).filter(row => !gaveta.filial || !row[0] || row[0] === gaveta.filial);
      const aqui = rows.filter(row => row[2] === gaveta.arm && (!restritos.size || restritos.has(row[3]))).sort(byValidity);
      const outros = rows.filter(row => row[2] !== gaveta.arm).sort((a, b) => byArm(a, b) || byValidity(a, b));
      const enderecos = (ctx.enderecos.get(prod) || [])
        .filter(item => !gaveta.filial || !item.filial || item.filial === gaveta.filial)
        .map(item => ({ arm: item.arm, endereco: item.endereco, armario: item.armario, aqui: item.arm === gaveta.arm && item.endereco === gaveta.codigo }));
      itens.push({
        produto: prod, descricao: info[0] || '', unidade: info[1] || '', ean: info[2] || '',
        enderecos, lotes: aqui.map(stockRow), outros: outros.map(stockRow),
        semSaldo: !aqui.length
      });
    }
    itens.sort((a, b) => (a.descricao || a.produto).localeCompare(b.descricao || b.produto, 'pt-BR', { numeric: true }));
    return { id, filial: gaveta.filial, arm: gaveta.arm, codigo: gaveta.codigo, armario: gaveta.armario, itens };
  }

  function makeContext(zz2Rows, sb1, sb8Rows) {
    const enderecos = new Map();
    for (const [filial, arm, endereco, prod, , armario] of zz2Rows) {
      if (!enderecos.has(prod)) enderecos.set(prod, []);
      const list = enderecos.get(prod);
      if (!list.some(item => item.filial === filial && item.arm === arm && item.endereco === endereco)) list.push({ filial, arm, endereco, armario });
    }
    return { gavetas: gavetasFrom(zz2Rows), sb1, sb8: indexSb8(sb8Rows), enderecos };
  }

  // Onde um lote (ou código/EAN) está no SB8, em todos os armazéns.
  function findLote(ctx, query, limit = 60) {
    const q = upper(query);
    if (!q) return [];
    let rows = ctx.sb8.byLote.get(q) || [];
    if (!rows.length) {
      const eanProducts = Object.entries(ctx.sb1).filter(([, info]) => upper(info[2]) === q).map(([code]) => code);
      const products = new Set([q, ...eanProducts]);
      rows = [...products].flatMap(code => ctx.sb8.byProduct.get(code) || []);
    }
    return [...rows].sort((a, b) => byArm(a, b) || byValidity(a, b)).slice(0, limit).map(row => ({
      ...stockRow(row), produto: row[1], descricao: (ctx.sb1[row[1]] || [])[0] || '',
      enderecos: (ctx.enderecos.get(row[1]) || []).map(item => ({ arm: item.arm, endereco: item.endereco }))
    }));
  }

  // ---------- análise gravada ----------
  const clip = (value, size) => text(value).slice(0, size);

  function cleanAnalysis(body, gaveta) {
    if (!body || !Array.isArray(body.itens) || !body.itens.length || body.itens.length > 600) throw Error('A análise precisa ter itens.');
    const known = new Set(gaveta.itens.keys());
    const itens = body.itens.map(item => {
      const prod = product(item.produto);
      if (!known.has(prod)) throw Error('Produto ' + prod + ' não pertence a esta gaveta.');
      const lotes = (Array.isArray(item.lotes) ? item.lotes : []).slice(0, 100).map(lote => ({
        lote: upper(lote.lote).slice(0, 60), saldo: Number(lote.saldo) || 0,
        validadeSistema: isoDate(lote.validadeSistema), validadeNova: isoDate(lote.validadeNova)
      }));
      const transferir = (Array.isArray(item.transferir) ? item.transferir : []).slice(0, 100).map(move => {
        const qtd = Number(move.qtd);
        if (!Number.isFinite(qtd) || qtd <= 0) throw Error('A quantidade a transferir precisa ser positiva.');
        return { arm: place(move.arm), lote: upper(move.lote).slice(0, 60), qtd, obs: clip(move.obs, 300) };
      });
      return { produto: prod, conferido: item.conferido === true, semSaldo: item.semSaldo === true, obs: clip(item.obs, 500), lotes, transferir };
    });
    if (itens.length !== known.size || new Set(itens.map(item => item.produto)).size !== known.size) throw Error('Faltam produtos da gaveta na análise.');
    if (itens.some(item => !item.conferido)) throw Error('Marque todos os produtos como conferidos antes de finalizar.');
    const extras = (Array.isArray(body.extras) ? body.extras : []).slice(0, 100).map(extra => ({
      lote: upper(extra.lote).slice(0, 60), produto: product(extra.produto).slice(0, 60), obs: clip(extra.obs, 500)
    })).filter(extra => extra.lote);
    return { itens, extras, obs: clip(body.obs, 1000) };
  }

  function summarize(itens, today) {
    let validadesAlteradas = 0, vencidos = 0, transferencias = 0, semSaldo = 0;
    for (const item of itens) {
      if (item.semSaldo) semSaldo++;
      transferencias += item.transferir.length;
      for (const lote of item.lotes) {
        const date = lote.validadeNova || lote.validadeSistema;
        if (lote.validadeNova && lote.validadeNova !== lote.validadeSistema) validadesAlteradas++;
        if (date && validity(date, today).days < 0) vencidos++;
      }
    }
    return { produtos: itens.length, semSaldo, validadesAlteradas, vencidos, transferencias };
  }

  // ---------- painel ----------
  function dashboard(gavetas, records, today, days = 30) {
    const active = new Set(gavetas.map(item => item.id));
    const last = new Map(), perDay = new Map(), perUserToday = new Map();
    for (const record of records) {
      const id = record.gaveta.id;
      const previous = last.get(id);
      if (!previous || record.em > previous.em) last.set(id, record);
      if (!perDay.has(record.dia)) perDay.set(record.dia, { dia: record.dia, gavetas: new Set(), analises: 0 });
      const day = perDay.get(record.dia);
      day.gavetas.add(id); day.analises++;
      if (record.dia === today) perUserToday.set(record.por, (perUserToday.get(record.por) || 0) + 1);
    }
    const analisadas = gavetas.filter(item => last.has(item.id)).length;
    const dates = [];
    for (let i = days - 1; i >= 0; i--) dates.push(new Date(Date.parse(today + 'T12:00:00Z') - i * DAY).toISOString().slice(0, 10));
    const porDia = dates.map(dia => ({ dia, gavetas: perDay.get(dia)?.gavetas.size || 0 }));
    const totalDias = [...perDay.values()].reduce((sum, day) => sum + day.gavetas.size, 0);
    const durations = records.filter(record => record.duracaoSeg > 0).map(record => record.duracaoSeg);
    return {
      total: gavetas.length, analisadas, faltam: gavetas.length - analisadas,
      percentual: gavetas.length ? Math.round(analisadas / gavetas.length * 100) : 0,
      hoje: perDay.get(today)?.gavetas.size || 0, porDia,
      mediaDiaria: perDay.size ? Math.round(totalDias / perDay.size * 10) / 10 : 0,
      duracaoMediaSeg: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
      porUsuarioHoje: [...perUserToday].map(([usuario, quantidade]) => ({ usuario, quantidade })).sort((a, b) => b.quantidade - a.quantidade),
      foraDoZz2: [...last.keys()].filter(id => !active.has(id)).length,
      ultimas: Object.fromEntries([...last].map(([id, record]) => [id, { em: record.em, por: record.por, resumo: record.resumo }]))
    };
  }

  function baseState(meta, now = Date.now()) {
    if (!meta || !meta.updatedAt) return { presente: false, expirada: false };
    const expiresAt = Date.parse(meta.updatedAt) + BASE_VALID_HOURS * 3600000;
    return { presente: true, updatedAt: meta.updatedAt, expiresAt: new Date(expiresAt).toISOString(), expirada: now >= expiresAt };
  }

  const api = {
    BASE_VALID_HOURS, isoDate, validity, armLabel, place, product, upper, isArmario, ARM_PRIORITY, armRank, matchGaveta, readWorkbook, readWorkbookStream, detectSheet, parseSheet,
    cleanSb8, cleanZz2, cleanSb1, gavetaId, gavetasFrom, makeContext, detail, findLote, cleanAnalysis, summarize,
    dashboard, baseState
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SC9GavetaCore = api;
})(typeof window === 'undefined' ? globalThis : window);
