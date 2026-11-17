/* Consolidado semanal/mensal (Cambuci + filiais): mesma conferência que era feita fora do sistema.
 * Usa só o que o painel já carregou (pedidos, itens, SC5, Entrega e nomes dos itens) e gera as abas do Excel.
 * Regras: armazéns Cambuci, BH, CE, DF e RJ; pedidos Implacil (transferência interna) ficam de fora.
 * Cambuci = Enviado se está na Entrega; sem Entrega mas separado+conferido = Pendente; senão Atrasado.
 * Filiais = Enviado só precisa de NF; sem NF e liberado antes do corte (último dia do recorte) = Atrasado. */
(function (root) {
  const ARMAZENS = ['Cambuci', 'BH', 'CE', 'DF', 'RJ'];
  const TRANSPORTADORAS = { 2: 'Brasil', 4: 'Retira 01', 5: 'Retira 02', 6: 'Retira 03', 7: 'Retira 04', 10057: 'Emergência', 10023: 'São Paulo', 10085: 'TCS' };
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  const pad = n => String(n).padStart(2, '0');
  const diaKey = d => (d instanceof Date && !isNaN(d) ? d.toISOString().slice(0, 10) : '');
  const fmt = key => key ? key.slice(8, 10) + '/' + key.slice(5, 7) + '/' + key.slice(0, 4) : '';
  const fmtCurto = key => key ? key.slice(8, 10) + '/' + key.slice(5, 7) : '';
  const serial = key => key ? Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / 86400000 + 25569 : null;
  const addDias = (key, n) => { const d = new Date(key + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const diaSemana = key => new Date(key + 'T00:00:00Z').getUTCDay(); // 0 = domingo
  const segunda = key => addDias(key, -((diaSemana(key) + 6) % 7));
  const texto = v => { const s = v == null ? '' : String(v).trim(); return s === '0' ? '' : s; };
  const get = (m, k) => (m && typeof m.get === 'function' ? m.get(k) : m ? m[k] : undefined);
  const temEntrega = (m, k) => !!m && (typeof m.has === 'function' ? m.has(k) : Object.prototype.hasOwnProperty.call(m, k));

  function nomeTransportadora(codigo) {
    const c = String(codigo == null ? '' : codigo).trim().replace(/\.0$/, '').replace(/^0+(?=\d)/, '');
    if (!c) return '';
    return TRANSPORTADORAS[c] || 'Código ' + c;
  }

  const ehImplacil = o => /IMPLACIL/i.test(String((o && o.nome) || ''));
  const data_ = v => (v instanceof Date ? v : typeof v === 'string' && v ? new Date(v) : null);
  // Linha (item) do SC9 que entra no consolidado: armazém do recorte, com data de liberação, fora Implacil.
  const valido = it => { const d = data_(it && it.dt); return !!it && ARMAZENS.includes(it.armazem) && !!d && !isNaN(d) && !ehImplacil(it); };

  // Meses e semanas (segunda a domingo) que têm linha liberada. O fim de cada recorte é o último dia com dado dentro dele.
  function periodos(items) {
    const dias = new Set();
    for (const it of items || []) if (valido(it)) dias.add(diaKey(data_(it.dt)));
    const ordenados = [...dias].sort();
    if (!ordenados.length) return { semanas: [], meses: [], ultimoDia: '' };
    const ultimoDia = ordenados[ordenados.length - 1];
    const semanas = new Map(), meses = new Map();
    for (const d of ordenados) {
      const s = segunda(d);
      const w = semanas.get(s) || { id: s, de: d, ate: d };
      w.ate = d; semanas.set(s, w);
      const mk = d.slice(0, 7);
      const m = meses.get(mk) || { id: mk, de: d, ate: d };
      m.ate = d; meses.set(mk, m);
    }
    const semanasLista = [...semanas.values()].sort((a, b) => (a.id < b.id ? 1 : -1)).map(w => {
      const parcial = w.ate === ultimoDia && diaSemana(w.ate) >= 1 && diaSemana(w.ate) <= 4;
      return { ...w, parcial, label: fmtCurto(w.de) + ' a ' + fmt(w.ate) + (parcial ? ' (parcial)' : '') };
    });
    const mesesLista = [...meses.values()].sort((a, b) => (a.id < b.id ? 1 : -1)).map(m => {
      const fim = new Date(Date.UTC(+m.id.slice(0, 4), +m.id.slice(5, 7), 0)).toISOString().slice(0, 10);
      const parcial = m.ate === ultimoDia && ultimoDia < fim;
      return { ...m, parcial, label: MESES[+m.id.slice(5, 7) - 1] + '/' + m.id.slice(0, 4) + (parcial ? ' (parcial)' : '') };
    });
    return { semanas: semanasLista, meses: mesesLista, ultimoDia };
  }

  function statusDe(o, entrega, corte, temItemFeito) {
    const nf = texto(o.nf) !== '';
    if (o.armazem === 'Cambuci') {
      if (!entrega) return nf ? 'Enviado' : o.dayKey < corte ? 'Atrasado' : 'Pendente';
      if (temEntrega(entrega, o.pedido)) return 'Enviado';
      return temItemFeito ? 'Pendente' : 'Atrasado';
    }
    if (nf) return 'Enviado';
    return o.dayKey < corte ? 'Atrasado' : 'Pendente';
  }

  const cel = (v, z) => ({ t: 'n', v, z });
  const pct = v => cel(v, '0.0%');

  // O pedido entra no recorte pelas linhas liberadas dentro dele (um pedido liberado em partes conta em cada
  // período só com as linhas daquele período), como nos consolidados feitos antes fora do sistema.
  function montar(data, de, ate) {
    const entrega = data.entregaCounts || null;
    const sc5 = data.sc5PorPedido || null;
    const nomes = data.itemNames || null;
    const itensPorPedido = new Map();
    for (const it of data.items || []) {
      if (!valido(it)) continue;
      const dayKey = diaKey(data_(it.dt));
      if (dayKey < de || dayKey > ate) continue;
      const k = it.armazem + '|' + it.pedido;
      let l = itensPorPedido.get(k); if (!l) itensPorPedido.set(k, l = []);
      l.push({ ...it, dayKey });
    }
    const pedidos = [];
    for (const [k, itens] of itensPorPedido) {
      const o = itens[0];
      const dayKey = itens.reduce((m, i) => (i.dayKey < m ? i.dayKey : m), o.dayKey);
      const feito = itens.some(i => i.pickEnd) && itens.some(i => i.confEnd);
      const primeiro = campo => itens.map(i => texto(i[campo])).find(Boolean) || '';
      const nf = primeiro('nf');
      const codigo = texto(get(sc5, o.pedido)) || primeiro('transportadora');
      pedidos.push({
        armazem: o.armazem, dayKey, pedido: String(o.pedido), cliente: primeiro('cliente'), nome: primeiro('nome'), itens: itens.length,
        nf, qt: soma(itens, i => i.qt || 0), separador: primeiro('separador'), conferente: primeiro('conferente'),
        transportadora: nomeTransportadora(codigo) || '(não definida)',
        status: statusDe({ armazem: o.armazem, pedido: String(o.pedido), nf, dayKey }, entrega, ate, feito)
      });
    }
    pedidos.sort((a, b) => ARMAZENS.indexOf(a.armazem) - ARMAZENS.indexOf(b.armazem) || (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : 0) || (a.pedido < b.pedido ? -1 : a.pedido > b.pedido ? 1 : 0));
    const chaves = new Set(pedidos.map(p => p.armazem + '|' + p.pedido));
    return { pedidos, chaves, itensPorPedido, nomes };
  }

  const soma = (arr, f) => arr.reduce((t, x) => t + f(x), 0);
  const conta = (arr, s) => arr.filter(p => p.status === s).length;
  const razao = (a, b) => (b ? a / b : 0);

  function dashboard(pedidos, de, ate, ultimaEntrega) {
    const total = pedidos.length, qt = soma(pedidos, p => p.qt);
    const env = conta(pedidos, 'Enviado'), atr = conta(pedidos, 'Atrasado'), pen = conta(pedidos, 'Pendente');
    const linhas = [];
    linhas.push(['CONFERÊNCIA SC9 — CONSOLIDADO CAMBUCI + FILIAIS — ' + (de === ate ? fmt(de) : fmtCurto(de) + ' A ' + fmt(ate))]);
    linhas.push(['Armazéns: ' + ARMAZENS.join(', ') + ' — ' + fmtCurto(de) + ' a ' + fmt(ate) + '; corte ' + fmtCurto(ate) + (ultimaEntrega ? '; Entrega até ' + fmt(ultimaEntrega) : '') + '. Pedidos Implacil (transferência interna) fora.']);
    linhas.push(['Status: Cambuci = Enviado se está na Entrega; sem Entrega mas já separado+conferido = Pendente; sem Entrega e sem separar/conferir = Atrasado. Filiais = Enviado só precisa de NF.']);
    linhas.push([]);
    linhas.push(['Pedidos (Combinado)', 'Peças Liberadas (Qt.)', 'Pedidos Enviados', 'Pedidos em Atraso', 'Pedidos Pendentes']);
    linhas.push([cel(total, '#,##0'), cel(qt, '#,##0'), cel(env, '#,##0'), cel(atr, '#,##0'), cel(pen, '#,##0')]);
    linhas.push([]);
    linhas.push(['Status Geral']);
    linhas.push(['Status', 'Pedidos', '%']);
    for (const [s, n] of [['Enviado', env], ['Atrasado', atr], ['Pendente', pen]]) linhas.push([s, n, pct(razao(n, total))]);
    linhas.push([]);
    linhas.push(['Por Armazém — Pedidos e Peças que Saíram (Enviados)']);
    linhas.push(['Armazém', 'Total Pedidos', 'Pedidos Enviados', 'Peças Liberadas (Total)', 'Peças Enviadas', 'Atrasados', 'Pendentes', '% Enviado']);
    const linhaArm = (nome, g) => [nome, g.length, conta(g, 'Enviado'), soma(g, p => p.qt), soma(g.filter(p => p.status === 'Enviado'), p => p.qt), conta(g, 'Atrasado'), conta(g, 'Pendente'), pct(razao(conta(g, 'Enviado'), g.length))];
    for (const a of ARMAZENS) linhas.push(linhaArm(a, pedidos.filter(p => p.armazem === a)));
    linhas.push(linhaArm('Total Geral', pedidos));
    linhas.push([]);
    linhas.push(['TENDÊNCIA DIÁRIA']);
    linhas.push(['Dia', 'Pedidos', 'Peças', 'Enviados', 'Atrasados', 'Pendentes', '% Enviado']);
    const dias = [...new Set(pedidos.map(p => p.dayKey))].sort();
    for (const d of dias) {
      const g = pedidos.filter(p => p.dayKey === d);
      linhas.push([{ t: 'n', v: serial(d), z: 'dd/mm/yyyy' }, g.length, soma(g, p => p.qt), conta(g, 'Enviado'), conta(g, 'Atrasado'), conta(g, 'Pendente'), pct(razao(conta(g, 'Enviado'), g.length))]);
    }
    if (dias.length > 7) {
      linhas.push([]);
      linhas.push(['POR SEMANA']);
      linhas.push(['Semana', 'Pedidos', 'Peças', 'Enviados', 'Atrasados', 'Pendentes', '% Enviado']);
      const sem = new Map();
      for (const p of pedidos) { const s = segunda(p.dayKey); if (!sem.has(s)) sem.set(s, []); sem.get(s).push(p); }
      for (const [s, g] of [...sem.entries()].sort()) {
        const ds = g.map(p => p.dayKey).sort();
        linhas.push([fmtCurto(ds[0]) + ' a ' + fmtCurto(ds[ds.length - 1]), g.length, soma(g, p => p.qt), conta(g, 'Enviado'), conta(g, 'Atrasado'), conta(g, 'Pendente'), pct(razao(conta(g, 'Enviado'), g.length))]);
      }
    }
    return linhas;
  }

  function base(pedidos) {
    const linhas = [['Armazém', 'Data Liberação', 'Cliente', 'Nome Cliente', 'Pedido', 'Itens', 'Nota Fiscal', 'Tem NF?', 'Status', 'Qt Liberada', 'Separador(a)', 'Conferente', 'Transportadora']];
    for (const p of pedidos) {
      linhas.push([p.armazem, { t: 'n', v: serial(p.dayKey), z: 'dd/mm/yyyy' }, p.cliente, p.nome, p.pedido, p.itens, /^\d+$/.test(p.nf) ? Number(p.nf) : p.nf, p.nf ? 'Sim' : 'Não', p.status, p.qt, p.separador, p.conferente, p.transportadora]);
    }
    return linhas;
  }

  function ranking(chaves, itensPorPedido, nomes) {
    const linhas = [['Armazém', 'Posição', 'Código', 'Item', 'Qt Liberada']];
    for (const a of ARMAZENS) {
      const por = new Map();
      for (const k of chaves) {
        if (!k.startsWith(a + '|')) continue;
        for (const it of itensPorPedido.get(k) || []) por.set(it.produto, (por.get(it.produto) || 0) + (it.qt || 0));
      }
      [...por.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10).forEach(([cod, q], i) => {
        linhas.push([a, i + 1, cod, get(nomes, cod) || get(nomes, String(cod).replace(/^0+/, '')) || '(sem descrição)', q]);
      });
    }
    return linhas;
  }

  function porTransportadora(pedidos) {
    const total = soma(pedidos, p => p.qt), por = new Map();
    for (const p of pedidos) { const g = por.get(p.transportadora) || { n: 0, q: 0 }; g.n++; g.q += p.qt; por.set(p.transportadora, g); }
    const linhas = [['Transportadora', 'Pedidos', 'Peças', '% do Total de Peças']];
    for (const [nome, g] of [...por.entries()].sort((a, b) => b[1].q - a[1].q || b[1].n - a[1].n)) linhas.push([nome, g.n, g.q, pct(razao(g.q, total))]);
    return linhas;
  }

  // data = { orders, items, itemNames, sc5PorPedido, entregaCounts, entregaInfo }; de/ate = 'AAAA-MM-DD'
  function construir(data, de, ate) {
    if (!data || !Array.isArray(data.items)) throw new Error('Carregue a base SC9 antes de exportar o consolidado.');
    const { pedidos, chaves, itensPorPedido, nomes } = montar(data, de, ate);
    if (!pedidos.length) throw new Error('Não há pedidos entre ' + fmt(de) + ' e ' + fmt(ate) + '.');
    let ultimaEntrega = '';
    if (data.entregaInfo && typeof data.entregaInfo.forEach === 'function') data.entregaInfo.forEach(v => { const d = diaKey(v && v.data); if (d > ultimaEntrega) ultimaEntrega = d; });
    return {
      de, ate, pedidos: pedidos.length,
      resumo: { pedidos: pedidos.length, pecas: soma(pedidos, p => p.qt), enviados: conta(pedidos, 'Enviado'), atrasados: conta(pedidos, 'Atrasado'), pendentes: conta(pedidos, 'Pendente') },
      avisos: [data.entregaCounts ? '' : 'A aba Entrega não foi carregada: o Cambuci foi classificado só pela nota fiscal.'].filter(Boolean),
      abas: [
        { nome: 'Dashboard', linhas: dashboard(pedidos, de, ate, ultimaEntrega), larguras: [34, 16, 18, 20, 16, 14, 14, 12] },
        { nome: 'Base de Dados', linhas: base(pedidos), larguras: [11, 14, 10, 42, 10, 7, 12, 9, 11, 11, 22, 22, 18], filtro: true, congelar: 1 },
        { nome: 'Ranking Itens por Armazém', linhas: ranking(chaves, itensPorPedido, nomes), larguras: [11, 9, 12, 60, 12] },
        { nome: 'Por Transportadora', linhas: porTransportadora(pedidos), larguras: [24, 10, 10, 20] }
      ]
    };
  }

  function nomeArquivo(de, ate, tipo) {
    const mes = MESES[+ate.slice(5, 7) - 1].slice(0, 3);
    const a = tipo === 'mes' ? MESES[+de.slice(5, 7) - 1] + de.slice(0, 4) : de.slice(8, 10) + 'a' + ate.slice(8, 10) + mes + ate.slice(0, 4);
    return 'Consolidado_Cambuci_' + a + '.xlsx';
  }

  function paraPlanilha(resultado, X) {
    X = X || root.XLSX;
    const livro = X.utils.book_new();
    for (const aba of resultado.abas) {
      const ws = X.utils.aoa_to_sheet(aba.linhas);
      ws['!cols'] = aba.larguras.map(wch => ({ wch }));
      if (aba.filtro && ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] };
      X.utils.book_append_sheet(livro, ws, aba.nome);
    }
    return livro;
  }

  const api = { ARMAZENS, nomeTransportadora, periodos, construir, nomeArquivo, paraPlanilha };
  root.SC9Consolidado = Object.assign(root.SC9Consolidado || {}, api);
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis);
