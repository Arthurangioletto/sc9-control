/* Aba "Ocorrências da expedição": a expedição digita o que impede um pedido de sair (nota fiscal, o que aconteceu, quem resolve, a solução).
 * O SC9 procura a nota na base, mostra o cliente e o pedido e diz sozinho o status e o que fazer.
 * Tela cheia, usada pelo administrador e por quem tem o acesso "Ocorrências". A lógica (datas, status) fica em ocorrencias.js. */
(function (root) {
  'use strict';
  const React = root.React;
  const O = root.SC9Ocorrencias;
  if (!React || !O) return;
  const h = React.createElement;
  const { useState, useEffect, useMemo, useRef, useCallback } = React;

  const cor = { border: '#dde4ef', ink: '#14233d', mute: '#526079', accent: '#123b7a', soft: '#f3f6fb', red: '#c63828', amber: '#9b4b08', teal: '#0A8571' };
  const NIVEL = {
    urgente: { fundo: '#fdeceb', borda: '#c63828', texto: '#c63828' },
    atencao: { fundo: '#fff4e5', borda: '#d98a1f', texto: '#9b4b08' },
    andamento: { fundo: '#eaf1fd', borda: '#7aa2e3', texto: '#123b7a' },
    ok: { fundo: '#f3f6fb', borda: '#dde4ef', texto: '#123b7a' },
    concluido: { fundo: '#e6f5f1', borda: '#0A8571', texto: '#0A8571' }
  };
  const moeda = (v) => (v > 0 ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
  const normPedido = (x) => String(x == null ? '' : x).replace(/\D/g, '').replace(/^0+/, '');

  // chave = código do link sem senha (?k=): libera só a LEITURA; gravar sempre exige usuário e senha
  async function pedir(opcoes, chave) {
    const r = await fetch('/api/ocorrencias' + (chave && !(opcoes && opcoes.method === 'POST') ? '?k=' + encodeURIComponent(chave) : ''), Object.assign({ cache: 'no-store' }, opcoes, { headers: { 'X-SC9-App': '1', 'Content-Type': 'application/json' } }));
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) throw new Error(chave && !(opcoes && opcoes.method === 'POST') ? 'Link sem acesso. Peça um link novo ao administrador.' : 'Sem acesso. Entre com seu usuário e senha, ou peça ao administrador para liberar "Ocorrências" no seu usuário.');
    if (!r.ok) throw new Error(j.error || 'Não consegui falar com o servidor.');
    return j;
  }

  const VAZIO = { id: '', nf: '', dataOcorrencia: '', detalhes: '', responsavel: '', solucao: '', dataSolucao: '' };

  function csv(itens) {
    const aspas = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const cab = ['Nº da Nota Fiscal', 'Data da Ocorrência', 'Detalhes da Ocorrência', 'Responsável', 'Solução da Ocorrência', 'Data da Solução', 'Pedido', 'Cliente', 'Armazém', 'Situação do pedido', 'Status', 'Dias', 'O que fazer'];
    const linhas = itens.map(({ oc, info, av }) => [oc.nf, O.mostrarData(oc.dataOcorrencia), oc.detalhes, oc.responsavel, oc.solucao, O.mostrarData(oc.dataSolucao),
      info ? info.pedido : '', info ? info.nome : '', info ? info.armazem : '', av.pedido.texto, av.status, av.dias, av.acao].map(aspas).join(';'));
    return '﻿' + [cab.map(aspas).join(';')].concat(linhas).join('\r\n');
  }

  // embedded + chaveLink: usado dentro da página do Histórico de Atraso (link sem senha): todo mundo lê e analisa; para registrar,
  // a pessoa da expedição entra com usuário e senha aqui mesmo (quem tem o acesso "Ocorrências", ou o administrador).
  function Panel({ isAdmin, onBack, onLogout, embedded, chaveLink }) {
    const chamar = (opcoes) => pedir(opcoes, chaveLink);
    const [sessao, setSessao] = useState(embedded ? null : { pode: true, authed: true });
    const [login, setLogin] = useState({ usuario: '', senha: '', entrando: false, erro: '' });
    const verSessao = useCallback(async () => {
      if (!embedded) return;
      try {
        const r = await fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' });
        const j = await r.json();
        setSessao({ authed: Boolean(j.authed), nome: j.nome || j.usuario || '', pode: Boolean(j.authed && (j.role === 'admin' || (j.perfis || []).includes('ocorrencias'))) });
      } catch (e) { setSessao({ pode: false, authed: false }); }
    }, []);
    useEffect(() => { verSessao(); }, [verSessao]);
    const pode = !embedded || Boolean(sessao && sessao.pode);
    const avisarPagina = () => { try { root.dispatchEvent(new root.Event('sc9-ocorrencias')); } catch (e) { /* sem página para avisar */ } };
    async function entrar() {
      setLogin((l) => Object.assign({}, l, { entrando: true, erro: '' }));
      try {
        const r = await fetch('/api/login', { method: 'POST', credentials: 'same-origin', headers: { 'X-SC9-App': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario: login.usuario, password: login.senha }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || 'Não consegui entrar.');
        setLogin({ usuario: '', senha: '', entrando: false, erro: '' });
        await verSessao();
      } catch (e) { setLogin((l) => Object.assign({}, l, { entrando: false, erro: e.message })); }
    }
    async function sair() {
      try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-SC9-App': '1' } }); } catch (e) { /* segue */ }
      await verSessao();
    }
    const [dados, setDados] = useState(null);
    const [erro, setErro] = useState('');
    const [aviso, setAviso] = useState('');
    const [rascunho, setRascunho] = useState(Object.assign({}, VAZIO));
    const [salvando, setSalvando] = useState(false);
    const [filtro, setFiltro] = useState('abertas');
    const [busca, setBusca] = useState('');
    const [colar, setColar] = useState(null);
    const [ajuda, setAjuda] = useState(true);
    const [agora, setAgora] = useState(Date.now());
    const nfRef = useRef(null);

    const carregar = useCallback(async () => {
      try { setDados(await chamar({})); setErro(''); } catch (e) { setErro(e.message); }
    }, []);
    useEffect(() => {
      carregar();
      const t = setInterval(carregar, 60000);
      const r = setInterval(() => setAgora(Date.now()), 60000);
      return () => { clearInterval(t); clearInterval(r); };
    }, [carregar]);

    const itens = useMemo(() => {
      if (!dados) return [];
      const lista = (dados.linhas || []).map((oc) => {
        const info = (dados.notas || {})[oc.nf];
        const saida = info ? ((dados.saidas || {})[normPedido(info.pedido)] || '') : '';
        return { oc, info, av: O.avaliar(oc, info, saida, new Date(agora)) };
      });
      return O.ordenar(lista);
    }, [dados, agora]);
    const res = useMemo(() => O.resumo(itens), [itens]);

    const visiveis = useMemo(() => {
      const q = busca.trim().toLowerCase();
      return itens.filter(({ oc, info, av }) => {
        if (filtro === 'abertas' && av.situacao === 'resolvida' && av.nivel === 'concluido') return false;
        if (filtro === 'abertas' && av.situacao === 'resolvida' && av.status === 'Resolvida') return false;
        if (filtro === 'resolvidas' && av.situacao !== 'resolvida') return false;
        if (filtro === 'precisa' && !(av.nivel === 'urgente' || av.nivel === 'atencao')) return false;
        if (!q) return true;
        return [oc.nf, oc.detalhes, oc.responsavel, oc.solucao, info && info.pedido, info && info.nome].join(' ').toLowerCase().includes(q);
      });
    }, [itens, filtro, busca]);

    const campo = (k) => (e) => setRascunho((r) => Object.assign({}, r, { [k]: e.target.value }));

    async function salvar() {
      setAviso(''); setErro('');
      const nf = O.numeroDaNota(rascunho.nf);
      if (!nf) return setErro('Digite o número da nota fiscal (só números).');
      const dataOcorrencia = O.lerData(rascunho.dataOcorrencia, new Date(agora));
      if (!dataOcorrencia) return setErro('A data da ocorrência é obrigatória. Escreva assim: 24/11/2026.');
      let dataSolucao = '';
      if (rascunho.dataSolucao.trim()) {
        dataSolucao = O.lerData(rascunho.dataSolucao, new Date(agora));
        if (!dataSolucao) return setErro('Não entendi a data da solução. Escreva assim: 24/11/2026.');
      }
      setSalvando(true);
      try {
        const j = await chamar({ method: 'POST', body: JSON.stringify({ acao: 'salvar', linha: { id: rascunho.id || undefined, nf, dataOcorrencia, detalhes: rascunho.detalhes, responsavel: rascunho.responsavel, solucao: rascunho.solucao, dataSolucao } }) });
        setDados(j); setRascunho(Object.assign({}, VAZIO)); avisarPagina();
        setAviso(rascunho.id ? 'Alteração salva.' : 'Ocorrência registrada.');
        if (nfRef.current) nfRef.current.focus();
      } catch (e) { setErro(e.message); }
      setSalvando(false);
    }
    function editar(oc) {
      setRascunho({ id: oc.id, nf: oc.nf, dataOcorrencia: O.mostrarData(oc.dataOcorrencia), detalhes: oc.detalhes, responsavel: oc.responsavel, solucao: oc.solucao, dataSolucao: O.mostrarData(oc.dataSolucao) });
      setAviso(''); setErro('');
      if (root.scrollTo) root.scrollTo({ top: 0, behavior: 'smooth' });
      if (nfRef.current) nfRef.current.focus();
    }
    async function apagar(oc) {
      if (!root.confirm('Apagar a ocorrência da nota ' + oc.nf + '? Isso não pode ser desfeito.')) return;
      try { setDados(await chamar({ method: 'POST', body: JSON.stringify({ acao: 'remover', id: oc.id }) })); setAviso('Ocorrência apagada.'); avisarPagina(); } catch (e) { setErro(e.message); }
    }
    async function importar() {
      const lido = O.lerColado(colar, new Date(agora));
      if (!lido.linhas.length) return setErro(lido.invalidas.length ? 'Nada foi importado: ' + lido.invalidas.slice(0, 3).map((x) => 'linha ' + x.linha + ': ' + x.motivo).join(' ') : 'Cole as linhas copiadas do Excel.');
      try {
        const j = await chamar({ method: 'POST', body: JSON.stringify({ acao: 'importar', linhas: lido.linhas }) });
        setDados(j); setColar(null); avisarPagina();
        const r = j.resultado || {};
        const lixo = lido.invalidas.length + ((r.invalidas || []).length);
        setAviso((r.novas || 0) + ' ocorrência(s) nova(s)' + (r.repetidas ? ', ' + r.repetidas + ' já existia(m)' : '') + (lixo ? ', ' + lixo + ' linha(s) com problema' : '') + '.'); setErro('');
      } catch (e) { setErro(e.message); }
    }
    function baixar() {
      const blob = new Blob([csv(itens)], { type: 'text/csv;charset=utf-8' });
      const a = root.document.createElement('a');
      a.href = root.URL.createObjectURL(blob); a.download = 'ocorrencias-expedicao-' + O.hojeSP(new Date(agora)) + '.csv';
      root.document.body.appendChild(a); a.click(); a.remove();
    }

    const entrada = (k, placeholder, extra) => h('input', Object.assign({ value: rascunho[k], onChange: campo(k), placeholder, 'aria-label': placeholder, style: { width: '100%', boxSizing: 'border-box', border: '1px solid ' + cor.border, borderRadius: 8, padding: '8px 10px', fontSize: 13, color: cor.ink, background: '#fff' } }, extra || {}));
    const rotulo = (t, dica) => h('label', { style: { display: 'block', fontSize: 11, fontWeight: 700, color: cor.mute, marginBottom: 3 } }, t, dica && h('span', { style: { fontWeight: 400 } }, ' ' + dica));
    const botao = (t, onClick, extra) => h('button', Object.assign({ type: 'button', onClick, style: { border: '1px solid ' + cor.border, background: '#fff', color: cor.accent, borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' } }, extra || {}), t);
    const kpi = (n, t, tom, dica) => h('div', { title: dica, style: { flex: '1 1 130px', minWidth: 120, background: (NIVEL[tom] || NIVEL.ok).fundo, border: '1px solid ' + (NIVEL[tom] || NIVEL.ok).borda, borderRadius: 12, padding: '10px 12px' } },
      h('div', { style: { fontSize: 24, fontWeight: 800, color: (NIVEL[tom] || NIVEL.ok).texto, lineHeight: 1 } }, n), h('div', { style: { fontSize: 11, color: cor.mute, marginTop: 4, fontWeight: 600 } }, t));
    const selo = (av) => { const n = NIVEL[av.nivel] || NIVEL.ok; return h('span', { style: { display: 'inline-block', padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 800, background: n.fundo, color: n.texto, border: '1px solid ' + n.borda } }, av.status); };
    const th = (t, w) => h('th', { style: { textAlign: 'left', padding: '8px 8px', fontSize: 11, color: cor.mute, fontWeight: 800, borderBottom: '2px solid ' + cor.border, background: cor.soft, whiteSpace: 'nowrap', minWidth: w } }, t);
    const td = (c, extra) => h('td', { style: Object.assign({ padding: '8px', fontSize: 12.5, color: cor.ink, borderBottom: '1px solid ' + cor.border, verticalAlign: 'top' }, extra || {}) }, c);

    const abas = [['abertas', 'Para acompanhar'], ['precisa', 'Precisam de ação'], ['resolvidas', 'Resolvidas'], ['todas', 'Todas']];

    return h('div', { style: embedded ? { background: '#f6f8fc', fontFamily: 'inherit', color: cor.ink, borderRadius: 14, border: '1px solid ' + cor.border } : { minHeight: '100vh', background: '#f6f8fc', fontFamily: 'Manrope, ui-sans-serif, system-ui', color: cor.ink } },
      h('header', { style: Object.assign({ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: '#fff', borderBottom: '1px solid ' + cor.border }, embedded ? { borderRadius: '14px 14px 0 0' } : { position: 'sticky', top: 0, zIndex: 5 }) },
        onBack && h('button', { type: 'button', onClick: onBack, 'aria-label': 'Voltar ao SC9', style: { border: 0, background: cor.soft, borderRadius: 8, width: 34, height: 34, fontSize: 20, cursor: 'pointer', color: cor.accent } }, '‹'),
        h('div', { style: { flex: 1 } }, h('div', { style: { fontWeight: 800, fontSize: 17 } }, 'Ocorrências da expedição'), h('div', { style: { fontSize: 12, color: cor.mute } }, embedded ? 'O que impede cada pedido de sair, quem resolve e o que fazer. Todos veem; para registrar, entre com usuário e senha.' : 'Digite o que impede o pedido de sair. O SC9 acha o cliente e diz o que falta.')),
        botao('↻ Atualizar', carregar),
        embedded && sessao && sessao.authed && botao('Sair (' + (sessao.nome || 'conta') + ')', sair),
        onLogout && botao('Sair', onLogout)),
      h('main', { style: { maxWidth: 1280, margin: '0 auto', padding: 16, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14 } },
        erro && h('div', { role: 'alert', style: { background: '#fdeceb', border: '1px solid ' + cor.red, color: cor.red, borderRadius: 10, padding: '10px 12px', fontSize: 13, fontWeight: 600 } }, erro),
        aviso && h('div', { role: 'status', onClick: () => setAviso(''), style: { background: '#e6f5f1', border: '1px solid ' + cor.teal, color: cor.teal, borderRadius: 10, padding: '10px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' } }, aviso),

        h('section', { style: { background: '#fff', border: '1px solid ' + cor.border, borderRadius: 12, padding: 14 } },
          h('button', { type: 'button', onClick: () => setAjuda(!ajuda), style: { border: 0, background: 'transparent', fontWeight: 800, fontSize: 13, color: cor.accent, cursor: 'pointer', padding: 0 }, 'aria-expanded': ajuda }, (ajuda ? '▾' : '▸') + ' Como usar esta aba'),
          ajuda && pode && h('div', { style: { margin: '8px 0 0', fontSize: 13, color: cor.mute, lineHeight: 1.6 } },
            h('div', null, h('b', null, '1. ' + 'Registre'), ': preencha a linha em branco da tabela (nota fiscal e data são obrigatórias) e clique em Registrar. Pode também colar várias linhas copiadas do Excel.'),
            h('div', null, h('b', null, '2. ' + 'O SC9 procura a nota'), ': mostra o pedido, o cliente, o armazém e se o pedido já saiu ou foi despachado. Você não digita isso.'),
            h('div', null, h('b', null, '3. ' + 'Acompanhe'), ': a coluna Status diz em que ponto está (Aberta, Em andamento, Resolvida) e "O que fazer" diz o próximo passo. Ocorrência aberta há 3 dias ou mais fica em vermelho.'),
            h('div', null, h('b', null, '4. ' + 'Feche'), ': quando resolver, escreva a solução e a data da solução (ou clique em Editar na linha).'))),

        h('section', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
          kpi(res.abertas, 'Abertas', res.abertas ? 'atencao' : 'ok', 'Ainda sem solução registrada'),
          kpi(res.andamento, 'Em andamento', 'andamento', 'Tem retorno escrito, mas sem data de solução'),
          kpi(res.atrasadas, 'Há 3 dias ou mais', res.atrasadas ? 'urgente' : 'ok', 'Sem resolver há 3 dias ou mais'),
          kpi(res.faltaDespachar, 'Resolvidas, falta despachar', res.faltaDespachar ? 'atencao' : 'ok', 'Já resolvidas, mas o pedido ainda não foi despachado'),
          kpi(res.resolvidas, 'Resolvidas', 'concluido', res.mediaDiasParaResolver != null ? 'Média de ' + res.mediaDiasParaResolver + ' dias para resolver' : ''),
          res.naoAchadas ? kpi(res.naoAchadas, 'Nota não achada na base', 'atencao', 'Confira o número da nota ou se o SC9 já foi atualizado') : null),

        embedded && sessao && !pode && h('section', { style: { background: '#fff', border: '1px solid ' + cor.border, borderRadius: 12, padding: 14 } },
          h('strong', { style: { fontSize: 14 } }, 'Registrar ocorrência'),
          h('p', { style: { margin: '4px 0 10px', fontSize: 12.5, color: cor.mute } }, sessao.authed ? 'Seu usuário não tem o acesso "Ocorrências". Peça ao administrador para liberar, ou entre com outro usuário.' : 'Quem registra entra com usuário e senha (os mesmos do SC9). Deixe o usuário vazio se for o administrador.'),
          h('form', { onSubmit: (e) => { e.preventDefault(); entrar(); }, style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } },
            h('input', { value: login.usuario, onChange: (e) => setLogin(Object.assign({}, login, { usuario: e.target.value })), placeholder: 'Usuário', 'aria-label': 'Usuário', autoComplete: 'username', style: { flex: '1 1 140px', border: '1px solid ' + cor.border, borderRadius: 8, padding: '8px 10px', fontSize: 13 } }),
            h('input', { type: 'password', value: login.senha, onChange: (e) => setLogin(Object.assign({}, login, { senha: e.target.value })), placeholder: 'Senha', 'aria-label': 'Senha', autoComplete: 'current-password', style: { flex: '1 1 140px', border: '1px solid ' + cor.border, borderRadius: 8, padding: '8px 10px', fontSize: 13 } }),
            h('button', { type: 'submit', disabled: login.entrando || !login.senha, style: { border: 0, background: cor.accent, color: '#fff', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer' } }, login.entrando ? 'Entrando…' : 'Entrar para registrar')),
          login.erro && h('div', { role: 'alert', style: { marginTop: 8, color: cor.red, fontSize: 12.5, fontWeight: 600 } }, login.erro)),

        pode && h('section', { style: { background: '#fff', border: '1px solid ' + cor.border, borderRadius: 12, padding: 14 } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 } },
            h('strong', { style: { fontSize: 14 } }, rascunho.id ? 'Editando a ocorrência da nota ' + rascunho.nf : 'Nova ocorrência'),
            h('div', { style: { display: 'flex', gap: 8 } }, botao(colar == null ? 'Colar do Excel' : 'Fechar colagem', () => setColar(colar == null ? '' : null)))),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(135px,1fr))', gap: 10 } },
            h('div', null, rotulo('Nº da Nota Fiscal', '*'), entrada('nf', 'ex.: 885234', { ref: nfRef, inputMode: 'numeric' })),
            h('div', null, rotulo('Data da Ocorrência', '* dd/mm/aaaa'), entrada('dataOcorrencia', 'ex.: 24/11/2026')),
            h('div', { style: { gridColumn: 'span 2' } }, rotulo('Detalhes da Ocorrência', 'o que aconteceu'), entrada('detalhes', 'ex.: endereço insuficiente, vendedor verificando')),
            h('div', null, rotulo('Responsável', 'quem resolve'), entrada('responsavel', 'ex.: Juliana')),
            h('div', { style: { gridColumn: 'span 2' } }, rotulo('Solução da Ocorrência', 'deixe vazio se ainda não resolveu'), entrada('solucao', 'ex.: cadastro atualizado, pedido liberado')),
            h('div', null, rotulo('Data da Solução', 'dd/mm/aaaa'), entrada('dataSolucao', 'ex.: 25/11/2026'))),
          h('div', { style: { display: 'flex', gap: 8, marginTop: 12 } },
            botao(salvando ? 'Salvando…' : rascunho.id ? 'Salvar alteração' : 'Registrar ocorrência', salvar, { disabled: salvando, style: { border: 0, background: cor.accent, color: '#fff', borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer' } }),
            (rascunho.id || rascunho.nf) && botao('Limpar', () => setRascunho(Object.assign({}, VAZIO)))),
          colar != null && h('div', { style: { marginTop: 12 } },
            h('div', { style: { fontSize: 12, color: cor.mute, marginBottom: 4 } }, 'No Excel, selecione as linhas (colunas na ordem: Nota, Data da ocorrência, Detalhes, Responsável, Solução, Data da solução), copie e cole aqui. Notas que já estão na lista com a mesma data e detalhe são puladas.'),
            h('textarea', { value: colar, onChange: (e) => setColar(e.target.value), rows: 5, 'aria-label': 'Linhas copiadas do Excel', style: { width: '100%', boxSizing: 'border-box', border: '1px solid ' + cor.border, borderRadius: 8, padding: 8, fontSize: 12, fontFamily: 'monospace' } }),
            h('div', { style: { marginTop: 6 } }, botao('Importar linhas coladas', importar, { disabled: !colar.trim() })))),

        h('section', { style: { background: '#fff', border: '1px solid ' + cor.border, borderRadius: 12, padding: 14 } },
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 } },
            abas.map(([id, nome]) => h('button', { key: id, type: 'button', onClick: () => setFiltro(id), 'aria-pressed': filtro === id, style: { border: '1px solid ' + (filtro === id ? cor.accent : cor.border), background: filtro === id ? cor.accent : '#fff', color: filtro === id ? '#fff' : cor.accent, borderRadius: 999, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' } }, nome)),
            h('input', { value: busca, onChange: (e) => setBusca(e.target.value), placeholder: 'Buscar nota, pedido, cliente, responsável…', 'aria-label': 'Buscar', style: { flex: '1 1 200px', border: '1px solid ' + cor.border, borderRadius: 8, padding: '7px 10px', fontSize: 12 } }),
            botao('Baixar para Excel', baixar, { disabled: !itens.length })),
          !dados && !erro && h('p', { style: { color: cor.mute, fontSize: 13 } }, 'Carregando…'),
          dados && !visiveis.length && h('p', { style: { color: cor.mute, fontSize: 13 } }, itens.length ? 'Nenhuma ocorrência neste filtro.' : 'Nenhuma ocorrência registrada ainda. '+ (pode ? 'Preencha o quadro acima.' : 'Quem registra entra acima com usuário e senha.')),
          visiveis.length ? h('div', { style: { overflowX: 'auto' } },
            h('table', { style: { width: '100%', borderCollapse: 'collapse', minWidth: pode ? 1100 : 1010 } },
              h('thead', null, h('tr', null,
                th('Nº da Nota Fiscal', 90), th('Pedido e cliente (automático)', 200), th('Data da Ocorrência', 90), th('Detalhes da Ocorrência', 220), th('Responsável', 110), th('Solução da Ocorrência', 190), th('Data da Solução', 90),
                th('Status (automático)', 150), th('O que fazer (automático)', 220), pode && th('', 90))),
              h('tbody', null, visiveis.map(({ oc, info, av }) => h('tr', { key: oc.id, style: { background: av.nivel === 'urgente' ? '#fff7f6' : undefined } },
                td(h('strong', null, oc.nf)),
                td(info ? h('div', null,
                  h('div', { style: { fontWeight: 700 } }, info.nome || 'Cliente sem nome na base'),
                  h('div', { style: { color: cor.mute, fontSize: 11.5 } }, 'Pedido ' + info.pedido + (info.armazem ? ' · ' + info.armazem : '') + (info.transportadora ? ' · ' + info.transportadora : '') + (info.valor ? ' · ' + moeda(info.valor) : '')),
                  h('div', { style: { color: cor.mute, fontSize: 11.5 } }, av.pedido.texto)) : h('span', { style: { color: cor.amber, fontSize: 12 } }, 'Nota não encontrada na base do SC9. Confira o número ou aguarde a próxima atualização da base.')),
                td(O.mostrarData(oc.dataOcorrencia) + ' ', { whiteSpace: 'nowrap' }),
                td(oc.detalhes),
                td(oc.responsavel),
                td(oc.solucao || h('span', { style: { color: cor.mute } }, 'sem solução ainda')),
                td(oc.dataSolucao ? O.mostrarData(oc.dataSolucao) : h('span', { style: { color: cor.mute } }, '—'), { whiteSpace: 'nowrap' }),
                td(h('div', null, selo(av), h('div', { style: { color: cor.mute, fontSize: 11, marginTop: 3 } }, av.resolvida ? 'resolvida em ' + av.dias + (av.dias === 1 ? ' dia' : ' dias') : 'aberta há ' + av.dias + (av.dias === 1 ? ' dia' : ' dias')))),
                td(av.acao),
                pode && td(h('div', { style: { display: 'flex', gap: 6, flexDirection: 'column' } }, botao('Editar', () => editar(oc)), botao('Apagar', () => apagar(oc), { style: { border: '1px solid #f0c4bf', background: '#fff', color: cor.red, borderRadius: 8, padding: '6px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' } })))))))) : null),

        h('p', { style: { fontSize: 11.5, color: cor.mute, margin: 0 } }, 'Os dados de cliente e pedido vêm do último SC9 exportado pelo administrador; "Saída p/ Expedição" e "despachado" vêm dos registros da expedição. Se a nota não aparece, atualize a base.')));
  }

  O.Panel = Panel;
  O.csv = csv;
})(typeof window !== 'undefined' ? window : globalThis);
