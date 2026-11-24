/* Central de Pedidos · área das vendedoras (link com código, sem senha): acompanhar pedido (estilo rastreio de encomendas),
 * solicitar prioridade e acompanhar as próprias solicitações. JavaScript puro; tudo do servidor entra como textContent. */
(function (root) {
  'use strict';
  const C = root.Central, h = C.h, ic = C.icone;
  const chaveLink = new URLSearchParams(root.location.search).get('k') || '';
  const $raiz = root.document.getElementById('raiz');
  const LS = { recentes: 'sc9v_recentes', meus: 'sc9v_meus', nome: 'sc9v_nome', sessao: 'sc9v_sessao', consultas: 'sc9v_consultas' };
  const lerLS = (k, padrao) => { try { const v = root.localStorage.getItem(k); return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; } };
  const gravarLS = (k, v) => { try { root.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem armazenamento: segue sem lembrar */ } };
  const LIMITE_BASE_VELHA_H = 10; // carga do SC9 mais velha que isso fica em destaque

  const estado = {
    tela: 'rastrear', digitado: '', consulta: null, varios: null, carregando: false, erro: '', atualizadoEm: null,
    f: { pedido: '', nivel: 'normal', motivo: '', observacao: '', nome: lerLS(LS.nome, ''), etapa: 'form', previa: null, buscando: false, enviando: false, erro: '', enviada: null },
    prio: null, prioErro: '', visao: 'minhas', aberta: null,
    conta: lerLS(LS.sessao, null), // { token, nome, login } quando ela entrou com o acesso opcional
    cf: { modo: 'criar', nome: '', login: '', codigo: '', codigo2: '', erro: '', enviando: false, atual: '', novo: '', erroTroca: '', okTroca: '', trocando: false }
  };

  const api = async (caminho, opcoes) => {
    const url = caminho + (caminho.includes('?') ? '&' : '?') + 'k=' + encodeURIComponent(chaveLink);
    const cab = { 'Content-Type': 'application/json', 'X-SC9-App': '1' };
    if (estado.conta && estado.conta.token) cab['X-Vend-Token'] = estado.conta.token;
    const r = await root.fetch(url, Object.assign({ cache: 'no-store', credentials: 'omit' }, opcoes, { headers: cab }));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'Não consegui falar com o servidor. Tente de novo em instantes.'); e.status = r.status; throw e; }
    return j;
  };
  const soNumeros = (t) => String(t || '').replace(/\D/g, '').replace(/^0+/, '');
  const idadeBaseH = () => (estado.atualizadoEm ? (Date.now() - new Date(estado.atualizadoEm).getTime()) / 36e5 : 0);

  // Registro das consultas deste aparelho (para a aba Exportar): só o que ela mesma consultou, no próprio navegador.
  function registrarConsulta(r) {
    if (!r || !r.achado) return;
    const lista = lerLS(LS.consultas, []), d = r.detalhes || {}, agora = Date.now();
    if (lista[0] && lista[0].pedido === r.pedido && agora - Date.parse(lista[0].em) < 10 * 60 * 1000) return;
    gravarLS(LS.consultas, [{ pedido: r.pedido, em: new Date(agora).toISOString(), situacao: r.resumo.texto, nivel: r.resumo.nivel, filial: d.armazem || '', cliente: d.cliente || '' }].concat(lista).slice(0, 200));
  }

  /* ---------- rastreio ---------- */
  async function consultar(texto, silencioso) {
    const lista = [...new Set(String(texto || '').split(/[\s,;]+/).map(soNumeros).filter((x) => x.length >= 4))].slice(0, 10);
    estado.digitado = String(texto || '').trim();
    if (!lista.length) { estado.erro = 'Digite o número do pedido (só números, no mínimo 4 dígitos).'; estado.consulta = null; estado.varios = null; return desenhar(); }
    if (!silencioso) { estado.carregando = true; estado.erro = ''; desenhar(); }
    try {
      if (lista.length === 1) {
        estado.consulta = await api('/api/vendedoras/pedido?pedido=' + lista[0] + (silencioso ? '&auto=1' : '')); estado.varios = null; estado.atualizadoEm = estado.consulta.atualizadoEm;
        if (estado.consulta.achado) { gravarLS(LS.recentes, [lista[0]].concat(lerLS(LS.recentes, []).filter((x) => x !== lista[0])).slice(0, 8)); if (!silencioso) registrarConsulta(estado.consulta); }
        try { const u = new URL(root.location.href); u.searchParams.set('pedido', lista[0]); root.history.replaceState(null, '', u.toString()); } catch (e) { /* sem histórico */ }
      } else {
        const rs = [];
        for (const p of lista) { try { const r = await api('/api/vendedoras/pedido?pedido=' + p); rs.push(r); registrarConsulta(r); } catch (e) { rs.push({ achado: false, pedido: p, erro: e.message }); } }
        estado.varios = rs; estado.consulta = null;
      }
      estado.erro = '';
    } catch (e) { estado.erro = e.message || 'Não consegui consultar agora.'; if (!silencioso) estado.consulta = null; }
    estado.carregando = false; desenhar();
  }
  function textoParaCopiar(r) {
    const d = r.detalhes || {};
    const atual = (r.etapas || []).find((e) => e.estado === 'atual');
    const partes = ['Pedido ' + r.pedido + (d.cliente ? ' (' + d.cliente + ')' : '') + ': ' + r.resumo.texto];
    if (atual && atual.quando) partes.push((atual.nota ? atual.nota + ' em ' : 'Desde ') + C.dataHora(atual.quando) + '.');
    if (d.transportadora) partes.push('Transportadora: ' + d.transportadora + '.');
    if (d.nf) partes.push('Nota fiscal: ' + d.nf + '.');
    partes.push('Consulta em ' + C.dataHora(new Date().toISOString()) + '.');
    return partes.join(' ');
  }
  const rotuloResumo = (r) => (r.resumo.nivel === 'atraso' ? 'Atrasado' : r.resumo.nivel === 'concluido' ? 'Despachado' : 'Em andamento');
  const iconeResumo = (r) => (r.resumo.nivel === 'atraso' ? 'alerta' : r.resumo.nivel === 'concluido' ? 'caminhao' : 'relogio');

  function formBusca(compacto) {
    const recentes = lerLS(LS.recentes, []);
    return h('div', { class: compacto ? '' : 'hero' },
      !compacto ? h('h1', { text: 'Acompanhe seus pedidos' }) : null,
      !compacto ? h('p', { class: 'sub', text: 'Digite o número do pedido e veja cada etapa: o que já aconteceu, onde ele está agora e o que falta.' }) : null,
      h('form', { class: 'busca', style: compacto ? 'max-width:none;margin-top:0' : null, role: 'search', onsubmit: (ev) => { ev.preventDefault(); consultar(estado.digitado); } },
        h('label', { class: 'campo-ic', for: 'q-pedido' }, ic('busca'), h('span', { class: 'sr', text: 'Número do pedido' }), h('input', { id: 'q-pedido', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'Número do pedido', value: estado.digitado, oninput: (ev) => { estado.digitado = ev.target.value; } })),
        h('button', { class: 'btn primario', type: 'submit', disabled: estado.carregando, text: estado.carregando ? 'Consultando…' : 'Consultar pedido' })),
      !compacto ? h('p', { class: 'dica', text: 'Dica: pode digitar vários números, separados por vírgula.' }) : null,
      recentes.length ? h('div', { class: 'chips', 'aria-label': 'Consultados por último' }, h('span', { class: 'mudo peq', text: 'Recentes' }), recentes.map((p) => h('button', { class: 'chip', type: 'button', onclick: () => { estado.digitado = p; consultar(p); }, text: p }))) : null);
  }
  function dicas() {
    const d = (i, t, s) => h('div', { class: 'passo-dica' }, h('div', { class: 'bola' }, ic(i)), h('div', null, h('b', { text: t }), h('span', { text: s })));
    return h('div', { class: 'passos' }, d('busca', 'Digite o pedido', 'Só o número, sem pontos.'), d('conferencia', 'Veja cada etapa', 'Com data e hora, quando o sistema registrou.'), d('raio', 'Precisa de pressa?', 'Peça prioridade e acompanhe a resposta.'));
  }

  function cartaoResultado(r) {
    const d = r.detalhes || {};
    const atual = (r.etapas || []).find((e) => e.estado === 'atual');
    const quando = (e) => (e.estado === 'feita' ? (e.quando ? (e.soData ? C.dataBR(e.quando) : C.dataHora(e.quando)) : 'Horário não registrado') : e.estado === 'atual' ? (e.quando ? (e.nota || 'Desde') + ' ' + C.dataHora(e.quando) : e.nota || 'Etapa atual') : 'Ainda não aconteceu');
    const velha = idadeBaseH() > LIMITE_BASE_VELHA_H;
    return h('div', { style: 'display:flex;flex-direction:column;gap:18px' },
      h('section', { class: 'card', 'aria-label': 'Pedido ' + r.pedido },
        h('div', { class: 'res-topo' }, h('div', null, h('p', { class: 'res-numero', text: 'Pedido' }), h('h2', { class: 'num', text: r.pedido })), C.selo(rotuloResumo(r), r.resumo.nivel)),
        h('div', { class: 'status-destaque ' + r.resumo.nivel }, h('div', { class: 'bola' }, ic(iconeResumo(r))),
          h('div', null, h('b', { text: r.resumo.texto }), atual && r.paradoDesde && r.resumo.nivel !== 'concluido' ? h('span', { text: 'Nesta etapa há cerca de ' + C.duracao(r.paradoDesde) + '.' }) : null)),
        h('div', { class: 'fatos' }, C.fato('predio', 'Filial', d.armazem), C.fato('pacote', 'Itens', (d.pecas ? d.pecas + (d.pecas === 1 ? ' peça' : ' peças') : '') + (d.linhas ? ' · ' + d.linhas + (d.linhas === 1 ? ' item' : ' itens') : '')), C.fato('calendario', 'Liberado em', d.liberadoEm ? C.dataHora(d.liberadoEm) : ''), C.fato('caminhao', 'Transportadora', d.transportadora),
          C.fato('pessoa', 'Cliente', d.cliente), C.fato('nota', 'Nota fiscal', d.nf || 'ainda não emitida'), C.fato('relogio', 'Dias desde a liberação', d.diasDesdeLiberacao != null ? String(d.diasDesdeLiberacao) : ''), C.fato('okCirculo', 'Despachado em', d.despachadoEm ? C.dataBR(d.despachadoEm) : 'ainda não')),
        r.ocorrencia ? h('div', { class: 'ocorrencia', role: 'note' }, ic('alerta'), h('div', null, h('b', { text: 'Ocorrência da expedição: ' + r.ocorrencia.status }), r.ocorrencia.detalhes ? h('span', { text: r.ocorrencia.detalhes }) : null, r.ocorrencia.solucao ? h('span', { style: 'display:block;margin-top:4px', text: 'Solução: ' + r.ocorrencia.solucao + (r.ocorrencia.dataSolucao ? ' (' + C.dataBR(r.ocorrencia.dataSolucao + 'T12:00:00Z') + ')' : '') }) : null)) : null,
        h('div', { class: 'acoes' },
          h('button', { class: 'btn peq', type: 'button', onclick: () => C.copiar(textoParaCopiar(r), 'Status copiado. É só colar no WhatsApp.') }, ic('copiar'), 'Copiar status'),
          h('button', { class: 'btn peq', type: 'button', onclick: () => { const u = new URL(root.location.href); u.searchParams.set('pedido', r.pedido); C.copiar(u.toString(), 'Link copiado.'); } }, ic('link'), 'Copiar link do pedido'),
          r.resumo.nivel !== 'concluido' ? h('button', { class: 'btn peq primario', type: 'button', onclick: () => irParaPrioridade(r.pedido) }, ic('raio'), 'Pedir prioridade') : null)),
      h('section', { class: 'card', 'aria-label': 'Andamento do pedido ' + r.pedido },
        h('div', { class: 'card-titulo' }, h('h3', { text: 'Andamento do pedido' }), h('span', { class: 'mudo peq', text: (r.etapas || []).filter((e) => e.estado === 'feita').length + ' de ' + (r.etapas || []).length + ' etapas concluídas' })),
        h('ol', { class: 'tempo' }, (r.etapas || []).map((e) => h('li', { class: e.estado, 'aria-current': e.estado === 'atual' ? 'step' : null },
          h('div', { class: 'marco' }, e.estado === 'feita' ? ic('ok') : ic(C.ICONE_ETAPA[e.cod] || 'pacote')),
          h('div', { class: 'corpo' }, h('span', { class: 'sr', text: e.estado === 'feita' ? 'Concluída: ' : e.estado === 'atual' ? 'Etapa atual: ' : 'Ainda não: ' }), h('div', { class: 't', text: e.titulo }), h('div', { class: 'q', text: quando(e) }),
            e.nota && e.estado === 'feita' && e.nota !== 'Horário não registrado' ? h('div', { class: 'q fino', text: e.nota }) : null)))),
        h('p', { class: 'rodape-nota' + (velha ? ' velha' : '') }, ic('atualizar'), 'Base do SC9 atualizada em ' + (r.atualizadoEm ? C.dataHora(r.atualizadoEm) : '—') + (velha ? '. Faz tempo sem atualizar: o andamento pode estar atrasado.' : '. A saída para expedição é em tempo real; o resto atualiza a cada carga do SC9.'))));
  }

  /* ---------- aviso: de onde vem o andamento e quem analisa ---------- */
  // Sempre à vista nas telas de pedido: a base é do SC9, carregada 2 a 3 vezes por dia, e a análise de prioridade é da equipe do SC9.
  function faixaProcesso(modo, compacta) {
    const velha = idadeBaseH() > LIMITE_BASE_VELHA_H;
    const base = estado.atualizadoEm ? 'Base atualizada em ' + C.dataHora(estado.atualizadoEm) + ' (há ' + C.duracao(estado.atualizadoEm) + ').' : 'Verificando a última carga do SC9…';
    const itens = [
      h('li', null, h('b', { text: 'O andamento vem do SC9, que a expedição carrega 2 a 3 vezes por dia. ' }), h('span', { class: velha ? 'velha' : '', text: base + ' Pedido novo ou mudança recente pode demorar a aparecer: aguarde a próxima carga.' }))
    ];
    if (modo === 'prioridade' || modo === 'minhas') itens.push(h('li', null, h('b', { text: 'A análise é feita pela equipe do SC9, não é na hora. ' }), 'Depois de enviar, aguarde a resposta aqui em "Minhas solicitações". Não precisa mandar de novo nem cobrar por mensagem.'));
    if (compacta) return h('div', { class: 'processo compacta', role: 'note' }, ic('info'), h('p', null, h('b', { text: 'Aguarde a análise do SC9. ' }), base));
    return h('section', { class: 'processo', role: 'note', 'aria-label': 'Como funciona o acompanhamento' }, h('div', { class: 'bola' }, ic('info')), h('div', null, h('h2', { text: modo === 'rastrear' ? 'Como funciona o acompanhamento' : 'Antes de pedir: como funciona a análise' }), h('ul', null, itens)));
  }

  /* ---------- acesso opcional (login + código) ---------- */
  function salvarSessao(j) {
    estado.conta = { token: j.token, nome: j.conta.nome, login: j.conta.login };
    gravarLS(LS.sessao, estado.conta); estado.f.nome = j.conta.nome; estado.prio = null;
  }
  async function enviarConta(modo) {
    const c = estado.cf; c.erro = '';
    if (modo === 'criar') {
      if (c.nome.trim().length < 2) c.erro = 'Diga seu nome (como a equipe deve te chamar).';
      else if (c.codigo !== c.codigo2) c.erro = 'Os dois códigos não são iguais.';
    }
    if (c.erro) return desenhar();
    c.enviando = true; desenhar();
    try {
      const corpo = modo === 'criar' ? { acao: 'criar', nome: c.nome, login: c.login, codigo: c.codigo, ids: lerLS(LS.meus, []) } : { acao: 'entrar', login: c.login, codigo: c.codigo, ids: lerLS(LS.meus, []) };
      const j = await api('/api/vendedoras/conta', { method: 'POST', body: JSON.stringify(corpo) });
      salvarSessao(j); c.codigo = ''; c.codigo2 = ''; C.toast(modo === 'criar' ? 'Acesso criado. Você já está dentro.' : 'Bem-vinda, ' + j.conta.nome + '.');
      estado.tela = 'minhas'; estado.visao = 'minhas'; carregarPrioridades(true);
    } catch (e) { c.erro = e.message; }
    c.enviando = false; desenhar(); root.scrollTo(0, 0);
  }
  async function trocarCodigo() {
    const c = estado.cf; c.erroTroca = ''; c.okTroca = ''; c.trocando = true; desenhar();
    try { const j = await api('/api/vendedoras/conta', { method: 'POST', body: JSON.stringify({ acao: 'trocar-codigo', codigoAtual: c.atual, codigoNovo: c.novo }) }); salvarSessao(j); c.atual = ''; c.novo = ''; c.okTroca = 'Código trocado.'; }
    catch (e) { c.erroTroca = e.message; }
    c.trocando = false; desenhar();
  }
  function sairDaConta() { estado.conta = null; gravarLS(LS.sessao, null); estado.prio = null; C.toast('Você saiu deste aparelho.'); estado.tela = 'rastrear'; carregarPrioridades(true); desenhar(); root.scrollTo(0, 0); }
  const campoTexto = (id, rotulo, chave, objeto, opcoes) => h('div', null, h('label', { class: 'rotulo', for: id, text: rotulo }), h('input', Object.assign({ id, class: 'entrada', type: 'text', value: objeto[chave], oninput: (ev) => { objeto[chave] = ev.target.value; } }, opcoes || {})));
  function telaConta() {
    const c = estado.cf, cab = h('div', { style: 'margin-bottom:2px' }, h('h1', { style: 'font-size:clamp(24px,4vw,30px);font-weight:800;letter-spacing:-.02em', text: estado.conta ? 'Seu acesso' : 'Criar acesso ou entrar' }), h('p', { class: 'mudo', style: 'margin-top:6px', text: 'Opcional. Sem acesso tudo continua funcionando; com ele, suas solicitações ficam ligadas ao seu login e aparecem em qualquer aparelho.' }));
    if (estado.conta) return [cab, h('section', { class: 'card' }, h('div', { class: 'resumo-lista', style: 'margin-top:0' }, [['Nome', estado.conta.nome], ['Login', estado.conta.login]].map(([t, v]) => h('div', null, h('span', { text: t }), h('b', { text: v })))),
        h('p', { class: 'dica', style: 'margin-top:10px', text: 'As solicitações que você enviar daqui para frente ficam no seu nome, e a logística vê quem pediu.' }),
        h('div', { class: 'processo compacta', style: 'margin-top:12px', role: 'note' }, ic('info'), h('p', null, h('b', { text: 'Fica registrado: ' }), 'com o acesso, os pedidos que você consulta (número, data, hora e a situação na hora) ficam gravados no seu login. Só você e a administração do SC9 veem. Nenhuma outra vendedora vê o que é seu.')),
        h('div', { class: 'acoes' }, h('button', { class: 'btn primario', type: 'button', onclick: () => { estado.tela = 'minhas'; desenhar(); } }, ic('lista'), 'Minhas solicitações'), h('button', { class: 'btn', type: 'button', onclick: () => { estado.tela = 'exportar'; desenhar(); } }, ic('baixar'), 'Exportar'), h('button', { class: 'btn', type: 'button', onclick: sairDaConta }, ic('sair'), 'Sair deste aparelho'))),
      h('section', { class: 'card' }, h('div', { class: 'card-titulo' }, h('h2', { text: 'Trocar meu código' })),
        h('form', { class: 'form', onsubmit: (ev) => { ev.preventDefault(); trocarCodigo(); } },
          campoTexto('c-atual', 'Código atual', 'atual', c, { type: 'password', autocomplete: 'current-password' }), campoTexto('c-novo', 'Código novo (mínimo 6 caracteres)', 'novo', c, { type: 'password', autocomplete: 'new-password' }),
          h('button', { class: 'btn', type: 'submit', disabled: c.trocando, text: c.trocando ? 'Trocando…' : 'Trocar código' }),
          c.erroTroca ? h('div', { class: 'erro', role: 'alert' }, ic('alerta'), c.erroTroca) : null, c.okTroca ? h('div', { class: 'ok', role: 'status' }, ic('ok'), c.okTroca) : null))];
    const criar = c.modo === 'criar';
    return [cab, criar ? h('div', { class: 'processo compacta', role: 'note' }, ic('info'), h('p', null, h('b', { text: 'Fica registrado: ' }), 'com o acesso, as solicitações e os pedidos que você consulta ficam gravados no seu login. Só você e a administração do SC9 veem.')) : null, h('section', { class: 'card' },
      h('div', { class: 'abas-pequenas', role: 'group', 'aria-label': 'Criar acesso ou entrar', style: 'margin-bottom:14px' }, h('button', { type: 'button', 'aria-pressed': String(criar), onclick: () => { c.modo = 'criar'; c.erro = ''; desenhar(); }, text: 'Criar meu acesso' }), h('button', { type: 'button', 'aria-pressed': String(!criar), onclick: () => { c.modo = 'entrar'; c.erro = ''; desenhar(); }, text: 'Já tenho acesso' })),
      h('form', { class: 'form', onsubmit: (ev) => { ev.preventDefault(); enviarConta(c.modo); } },
        criar ? campoTexto('c-nome', 'Seu nome', 'nome', c, { autocomplete: 'name', maxlength: '60', placeholder: 'Ex.: Ana (Vendas)' }) : null,
        campoTexto('c-login', 'Login', 'login', c, { autocomplete: 'username', maxlength: '24', autocapitalize: 'none', placeholder: 'Ex.: ana.vendas' }),
        criar ? h('p', { class: 'dica', style: 'margin-top:-6px', text: 'De 3 a 24 caracteres: letras, números, ponto, hífen ou sublinhado.' }) : null,
        campoTexto('c-codigo', criar ? 'Código (mínimo 6 caracteres)' : 'Código', 'codigo', c, { type: 'password', autocomplete: criar ? 'new-password' : 'current-password', maxlength: '40' }),
        criar ? campoTexto('c-codigo2', 'Repita o código', 'codigo2', c, { type: 'password', autocomplete: 'new-password', maxlength: '40' }) : null,
        criar ? h('p', { class: 'dica', text: 'Não use a senha de outros sistemas. Esqueceu o código? Peça à expedição para redefinir.' }) : null,
        h('button', { class: 'btn primario', type: 'submit', disabled: c.enviando, text: c.enviando ? 'Aguarde…' : criar ? 'Criar meu acesso' : 'Entrar' }),
        c.erro ? h('div', { class: 'erro', role: 'alert' }, ic('alerta'), c.erro) : null)),
      lerLS(LS.meus, []).length ? h('p', { class: 'dica', style: 'margin-top:12px', text: 'As solicitações que você já fez neste aparelho com o mesmo nome passam a ficar no seu login.' }) : null];
  }

  /* ---------- exportar ---------- */
  const historicoTexto = (l) => (l.historico || []).map((x) => C.dataHoraCsv(x.em) + ' - ' + (x.status ? C.STATUS[x.status] || x.status : 'Atualização') + (x.texto ? ' - ' + x.texto : '')).join(' | ');
  const EXPORTAR = {
    minhas: () => C.baixarCsv(C.nomeArquivo('minhas-solicitacoes'), ['Protocolo', 'Pedido', 'Prioridade', 'Motivo', 'Status', 'Pedida em', 'Atualizada em', 'Observação', 'Resposta da logística', 'Histórico'],
      ((estado.prio && estado.prio.meus) || []).map((l) => [l.protocolo, l.pedido, C.NIVEL[l.nivel], C.MOTIVO[l.motivo] || '', C.STATUS[l.status], C.dataHoraCsv(l.criadoEm), C.dataHoraCsv(l.atualizadoEm), l.observacao, l.resposta, historicoTexto(l)])),
    consultas: () => C.baixarCsv(C.nomeArquivo('pedidos-consultados'), ['Pedido', 'Consultado em', 'Situação na hora', 'Filial', 'Cliente'], listaConsultas().map((x) => [x.pedido, C.dataHoraCsv(x.em), x.situacao, x.filial, x.cliente]))
  };
  // Com acesso (login) as consultas vêm do servidor (qualquer aparelho); sem acesso, só as deste aparelho.
  const listaConsultas = () => (estado.conta ? (estado.consultasServ && estado.consultasServ.consultas) || [] : lerLS(LS.consultas, []));
  async function carregarConsultas() {
    if (!estado.conta) return;
    try { estado.consultasServ = await api('/api/vendedoras/consultas'); estado.consultasErro = ''; } catch (e) { estado.consultasErro = e.message; }
    if (estado.tela === 'exportar') desenhar();
  }
  function telaExportar() {
    const meus = (estado.prio && estado.prio.meus) || [], consultas = listaConsultas();
    const cartao = (icone, titulo, texto, n, chave, pronto) => h('section', { class: 'card cartao-exportar' }, h('div', { class: 'bola' }, ic(icone)), h('div', { class: 'meio' }, h('h2', { text: titulo }), h('p', { class: 'mudo', text: texto }), h('p', { class: 'peq', style: 'margin-top:4px', text: pronto ? n + (n === 1 ? ' linha' : ' linhas') : 'Carregando…' })),
      h('button', { class: 'btn primario', type: 'button', disabled: !pronto || !n, onclick: EXPORTAR[chave], 'aria-label': 'Baixar ' + titulo }, ic('baixar'), 'Baixar (CSV)'));
    if (!estado.prio && !estado.prioErro) carregarPrioridades(true);
    if (estado.conta && !estado.consultasServ && !estado.consultasErro) carregarConsultas();
    return [h('div', null, h('h1', { style: 'font-size:clamp(24px,4vw,30px);font-weight:800;letter-spacing:-.02em', text: 'Exportar' }), h('p', { class: 'mudo', style: 'margin-top:6px', text: 'Baixe só o que é seu em planilha (CSV). Abre direto no Excel.' })),
      estado.prioErro || estado.consultasErro ? h('div', { class: 'erro' }, ic('alerta'), estado.prioErro || estado.consultasErro) : null,
      cartao('lista', 'Minhas solicitações', 'Protocolo, prioridade, motivo, status, resposta da logística e histórico de cada pedido de prioridade.', meus.length, 'minhas', Boolean(estado.prio)),
      cartao('busca', 'Pedidos que consultei', estado.conta ? 'Cada pedido que você consultou logada, com data, hora e a situação que aparecia na hora. Vem do seu login, de qualquer aparelho.' : 'Cada pedido que você consultou, com data, hora e a situação que aparecia na hora. Fica guardado só neste aparelho; com acesso criado, passa a valer em qualquer aparelho.', consultas.length, 'consultas', !estado.conta || Boolean(estado.consultasServ)),
      h('p', { class: 'dica', text: estado.conta ? 'Suas solicitações vêm do seu login, de qualquer aparelho.' : 'Sem acesso criado, "Minhas solicitações" e "Pedidos que consultei" são só deste aparelho. Crie seu acesso para ter as solicitações em qualquer lugar.' }),
      !estado.conta ? h('div', { class: 'acoes' }, h('button', { class: 'btn peq', type: 'button', onclick: () => { estado.tela = 'conta'; desenhar(); root.scrollTo(0, 0); } }, ic('usuario'), 'Criar meu acesso')) : null];
  }

  function telaRastrear() {
    const blocos = [];
    const temResultado = estado.carregando || estado.consulta || estado.varios || estado.erro;
    blocos.push(faixaProcesso('rastrear', Boolean(temResultado && !estado.erro)));
    blocos.push(temResultado ? h('section', { class: 'card' }, formBusca(true)) : formBusca(false));
    if (estado.carregando) blocos.push(C.esqueleto(3));
    else if (estado.erro) blocos.push(h('div', { class: 'erro', role: 'alert' }, ic('alerta'), estado.erro));
    else if (estado.varios) blocos.push(h('section', { class: 'card' }, h('div', { class: 'card-titulo' }, h('h2', { text: 'Seus pedidos' }), h('span', { class: 'mudo peq', text: estado.varios.length + ' consultados' })),
      estado.varios.map((r) => h('button', { class: 'cartao-lista', type: 'button', disabled: !r.achado, onclick: () => { estado.digitado = r.pedido; consultar(r.pedido); } },
        h('div', { class: 'l1' }, h('b', { class: 'num', text: 'Pedido ' + r.pedido }), r.achado ? C.selo(rotuloResumo(r), r.resumo.nivel) : C.selo('Não achado', 'normal')),
        h('div', { class: 'l2' }, h('span', { text: r.achado ? r.resumo.texto : (r.erro || 'Não achamos este pedido na base.') }))))));
    else if (estado.consulta && estado.consulta.achado) blocos.push(cartaoResultado(estado.consulta));
    else if (estado.consulta) blocos.push(h('section', { class: 'card' }, C.vazio('busca', 'Não achamos o pedido ' + estado.consulta.pedido, 'Confira o número. Se o pedido é de hoje, ele pode ainda não ter chegado: a base só atualiza a cada carga do SC9.' + (estado.consulta.atualizadoEm ? ' Última atualização: ' + C.dataHora(estado.consulta.atualizadoEm) + '.' : '')),
      h('div', { class: 'acoes', style: 'justify-content:center' }, h('button', { class: 'btn peq', type: 'button', onclick: () => consultar(estado.digitado) }, ic('atualizar'), 'Tentar de novo'), h('button', { class: 'btn peq', type: 'button', onclick: () => irParaPrioridade(estado.consulta.pedido) }, ic('raio'), 'Pedir prioridade mesmo assim'))));
    else blocos.push(dicas());
    return blocos;
  }

  /* ---------- solicitar prioridade ---------- */
  function irParaPrioridade(pedido) { const f = estado.f; if (pedido && soNumeros(pedido) !== soNumeros(f.pedido)) { f.pedido = pedido; f.previa = null; f.etapa = 'form'; } f.erro = ''; if (f.etapa === 'enviada') f.etapa = 'form'; estado.tela = 'prioridade'; desenhar(); root.scrollTo(0, 0); }
  async function localizar() {
    const f = estado.f; f.erro = '';
    const p = soNumeros(f.pedido);
    if (p.length < 4) { f.erro = 'Digite o número do pedido (só números).'; return desenhar(); }
    f.buscando = true; desenhar();
    try {
      const r = await api('/api/vendedoras/pedido?pedido=' + p); estado.atualizadoEm = r.atualizadoEm || estado.atualizadoEm;
      if (r.achado && r.resumo.nivel === 'concluido') { f.erro = 'Este pedido já foi despachado. ' + r.resumo.texto; f.previa = null; } else f.previa = r;
    } catch (e) { f.erro = e.message; f.previa = null; }
    f.buscando = false; desenhar();
  }
  function revisar() {
    const f = estado.f; f.erro = '';
    if (!f.previa || soNumeros(f.previa.pedido) !== soNumeros(f.pedido)) f.erro = 'Localize o pedido primeiro.';
    else if (!f.motivo) f.erro = 'Escolha o motivo do pedido de prioridade.';
    else if (f.motivo === 'outro' && f.observacao.trim().length < 5) f.erro = 'Explique o motivo na observação.';
    else if (f.nome.trim().length < 2) f.erro = 'Diga seu nome para a equipe saber quem pediu.';
    else f.etapa = 'revisar';
    desenhar();
  }
  async function enviar() {
    const f = estado.f; f.erro = ''; f.enviando = true; desenhar();
    try {
      const j = await api('/api/vendedoras/prioridade', { method: 'POST', body: JSON.stringify({ pedido: soNumeros(f.pedido), nivel: f.nivel, motivo: f.motivo, observacao: f.observacao, pedidoPor: f.nome }) });
      gravarLS(LS.nome, f.nome.trim());
      gravarLS(LS.meus, [j.linha.id].concat(lerLS(LS.meus, []).filter((x) => x !== j.linha.id)).slice(0, 60));
      f.enviada = { linha: j.linha, duplicado: j.duplicado, naoAchado: j.naoAchado }; f.etapa = 'enviada';
      f.pedido = ''; f.observacao = ''; f.motivo = ''; f.nivel = 'normal'; f.previa = null;
      C.toast('Solicitação enviada.');
      carregarPrioridades(true);
    } catch (e) { f.erro = e.message; f.etapa = 'form'; }
    f.enviando = false; desenhar();
  }
  const campoNivel = () => h('div', null, h('span', { class: 'rotulo', text: '2. Nível de prioridade' }), h('div', { class: 'niveis', role: 'radiogroup', 'aria-label': 'Nível de prioridade' },
    ['normal', 'media', 'alta', 'urgente'].map((n) => h('label', null, h('input', { type: 'radio', name: 'nivel', value: n, checked: estado.f.nivel === n, onchange: () => { estado.f.nivel = n; } }), h('span', { class: 'op' }, C.NIVEL[n], h('small', { text: C.NIVEL_DICA[n] }))))));
  function previaPedido(r) {
    const d = r.detalhes || {};
    if (!r.achado) return h('div', { class: 'aviso' }, ic('alerta'), h('div', null, h('b', { text: 'Não achamos o pedido ' + r.pedido + ' na base. ' }), 'Confira o número. Você pode enviar mesmo assim: a equipe vai conferir.'));
    return h('div', { class: 'previa', role: 'group', 'aria-label': 'Dados do pedido ' + r.pedido },
      h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, h('b', { class: 'num', style: 'font-size:18px', text: 'Pedido ' + r.pedido }), C.selo(rotuloResumo(r), r.resumo.nivel)), h('p', { class: 'mudo', style: 'margin-top:4px', text: r.resumo.texto }),
      h('div', { class: 'fatos' }, C.fato('pessoa', 'Cliente', d.cliente), C.fato('predio', 'Filial', d.armazem), C.fato('caminhao', 'Transportadora', d.transportadora), C.fato('pacote', 'Itens', d.pecas ? d.pecas + ' peças' : ''), C.fato('calendario', 'Liberado em', d.liberadoEm ? C.dataHora(d.liberadoEm) : '')));
  }
  function telaPrioridade() {
    const f = estado.f;
    if (f.etapa === 'enviada' && f.enviada) {
      const l = f.enviada.linha;
      return [h('section', { class: 'card' }, h('div', { class: 'protocolo-ok' }, h('div', { class: 'selo-ok' }, ic('ok')), h('h2', { text: f.enviada.duplicado ? 'Pedido reforçado' : 'Solicitação enviada' }), h('p', { class: 'mudo', text: f.enviada.duplicado ? 'Este pedido já estava na fila. Reforçamos a solicitação existente.' : 'Prioridade não passa o pedido na frente sozinha.' }),
        h('div', { class: 'processo compacta forte', role: 'status' }, ic('relogio'), h('p', null, h('b', { text: 'Agora é só aguardar. ' }), 'A equipe do SC9 vai analisar e a resposta aparece em "Minhas solicitações". Não precisa enviar de novo nem cobrar por mensagem.')),
        h('div', { class: 'codigo', text: l.protocolo || '' }),
        h('div', { class: 'resumo-lista' }, [['Pedido', l.pedido], ['Prioridade', C.NIVEL[l.nivel]], ['Data e horário', C.dataHora(l.criadoEm)], ['Status', C.STATUS[l.status]]].map(([t, v]) => h('div', null, h('span', { text: t }), h('b', { text: v })))),
        f.enviada.naoAchado ? h('div', { class: 'aviso', style: 'width:100%' }, ic('alerta'), 'Não achamos este pedido na base. A equipe vai conferir o número.') : null,
        h('div', { class: 'acoes', style: 'justify-content:center' }, h('button', { class: 'btn primario', type: 'button', onclick: () => { estado.tela = 'minhas'; estado.visao = 'minhas'; desenhar(); root.scrollTo(0, 0); } }, ic('lista'), 'Ver minhas solicitações'), h('button', { class: 'btn', type: 'button', onclick: () => { f.etapa = 'form'; f.enviada = null; desenhar(); } }, 'Nova solicitação'))))];
    }
    const cab = h('div', { style: 'display:flex;flex-direction:column;gap:14px' }, h('div', null, h('h1', { style: 'font-size:clamp(24px,4vw,32px);font-weight:800;letter-spacing:-.02em', text: 'Precisa de prioridade no pedido?' }), h('p', { class: 'mudo', style: 'margin-top:6px;font-size:16px', text: 'Informe o pedido, explique a necessidade e acompanhe a análise da logística.' })), faixaProcesso('prioridade'));
    if (f.etapa === 'revisar' && f.previa) {
      return [cab, h('section', { class: 'card' }, h('div', { class: 'card-titulo' }, h('h2', { text: 'Confirme a solicitação' })), previaPedido(f.previa),
        h('div', { class: 'resumo-lista', style: 'margin-top:12px' }, [['Prioridade', C.NIVEL[f.nivel]], ['Motivo', C.MOTIVO[f.motivo]], ['Solicitante', f.nome.trim()], ['Observação', f.observacao.trim() || '—']].map(([t, v]) => h('div', null, h('span', { text: t }), h('b', { text: v })))),
        h('div', { class: 'processo compacta forte', style: 'margin-top:12px', role: 'note' }, ic('relogio'), h('p', null, h('b', { text: 'Depois de enviar, aguarde. ' }), 'A análise é feita pela equipe do SC9 e não é na hora. Você recebe um protocolo e acompanha a resposta aqui.')),
        f.erro ? h('div', { class: 'erro', role: 'alert', style: 'margin-top:12px' }, ic('alerta'), f.erro) : null,
        h('div', { class: 'acoes' }, h('button', { class: 'btn primario', type: 'button', disabled: f.enviando, onclick: enviar }, ic('enviar'), f.enviando ? 'Enviando…' : 'Enviar solicitação'), h('button', { class: 'btn', type: 'button', disabled: f.enviando, onclick: () => { f.etapa = 'form'; f.erro = ''; desenhar(); } }, 'Voltar e corrigir')))];
    }
    return [cab, h('section', { class: 'card' }, h('form', { class: 'form', onsubmit: (ev) => { ev.preventDefault(); if (f.previa && soNumeros(f.previa.pedido) === soNumeros(f.pedido)) revisar(); else localizar(); } },
      h('div', null, h('label', { class: 'rotulo', for: 'p-pedido', text: '1. Número do pedido' }),
        h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, h('input', { id: 'p-pedido', class: 'entrada', style: 'flex:1 1 200px', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'Ex.: 123456', value: f.pedido, oninput: (ev) => { f.pedido = ev.target.value; if (f.previa && soNumeros(f.previa.pedido) !== soNumeros(f.pedido)) { f.previa = null; } } }),
          h('button', { class: 'btn', type: 'button', disabled: f.buscando, onclick: localizar }, ic('busca'), f.buscando ? 'Localizando…' : 'Localizar pedido'))),
      f.previa ? previaPedido(f.previa) : null,
      f.previa ? [campoNivel(),
        h('div', null, h('label', { class: 'rotulo', for: 'p-motivo', text: '3. Motivo' }), h('select', { id: 'p-motivo', class: 'entrada', onchange: (ev) => { f.motivo = ev.target.value; } }, h('option', { value: '', text: 'Escolha o motivo', selected: !f.motivo }), Object.keys(C.MOTIVO).map((k) => h('option', { value: k, text: C.MOTIVO[k], selected: f.motivo === k })))),
        h('div', null, h('label', { class: 'rotulo', for: 'p-obs', text: 'Observações adicionais' }), h('textarea', { id: 'p-obs', class: 'entrada', maxlength: '300', placeholder: 'Ex.: cliente tem prazo na sexta; retira na expedição', oninput: (ev) => { f.observacao = ev.target.value; } }, f.observacao), h('p', { class: 'dica', text: 'Quanto mais claro, mais rápido a logística decide.' })),
        estado.conta ? h('div', null, h('span', { class: 'rotulo', text: 'Solicitante' }), h('div', { class: 'previa', style: 'display:flex;align-items:center;gap:8px' }, ic('usuarioCheck'), h('b', { text: estado.conta.nome }), h('span', { class: 'mudo peq', text: 'login ' + estado.conta.login })))
          : h('div', null, h('label', { class: 'rotulo', for: 'p-nome', text: 'Seu nome' }), h('input', { id: 'p-nome', class: 'entrada', type: 'text', autocomplete: 'name', maxlength: '60', placeholder: 'Ex.: Ana (Vendas)', value: f.nome, oninput: (ev) => { f.nome = ev.target.value; } }), h('p', { class: 'dica' }, 'Quer acompanhar em qualquer aparelho e saber o que já pediu? ', h('button', { class: 'link-botao', type: 'button', onclick: () => { estado.tela = 'conta'; desenhar(); root.scrollTo(0, 0); } }, 'Crie seu acesso (opcional)'))),
        h('button', { class: 'btn primario', type: 'submit' }, 'Revisar solicitação', ic('seta'))] : h('p', { class: 'dica', text: 'Digite o número e toque em "Localizar pedido" para ver os dados dele antes de pedir.' }),
      f.erro ? h('div', { class: 'erro', role: 'alert' }, ic('alerta'), f.erro) : null))];
  }

  /* ---------- minhas solicitações ---------- */
  async function carregarPrioridades(silencioso) {
    const antes = estado.atualizadoEm + '|' + (estado.conta && estado.conta.login);
    try {
      const j = await api('/api/vendedoras/prioridades?ids=' + encodeURIComponent(lerLS(LS.meus, []).join(',')) + '&nome=' + encodeURIComponent((estado.conta && estado.conta.nome) || lerLS(LS.nome, ''))); estado.prio = j; estado.prioErro = '';
      if (j.baseEm && (!estado.atualizadoEm || j.baseEm > estado.atualizadoEm)) estado.atualizadoEm = j.baseEm;
      if (j.sessaoRecusada && estado.conta) { estado.conta = null; gravarLS(LS.sessao, null); C.toast('Sua sessão acabou. Entre de novo para ver as solicitações do seu login.', 'erro'); }
    } catch (e) { estado.prioErro = e.message; }
    if (!silencioso || ['minhas', 'exportar'].includes(estado.tela) || antes !== estado.atualizadoEm + '|' + (estado.conta && estado.conta.login)) desenhar();
  }
  const cartaoSolicitacao = (l) => h('button', { class: 'cartao-lista', type: 'button', onclick: () => { estado.aberta = l.id; desenhar(); } },
    h('div', { class: 'l1' }, h('b', { class: 'num', text: 'Pedido ' + l.pedido }), C.selo(C.NIVEL[l.nivel], l.nivel), C.selo(C.STATUS[l.status], l.status), l.reforco ? C.selo('Você reforçou', 'normal', true) : null, h('span', { class: 'mudo peq', style: 'margin-left:auto', text: l.protocolo || '' })),
    h('div', { class: 'l2' }, h('span', { text: 'Pedida em ' + C.dataHora(l.criadoEm) }), h('span', { text: 'Atualizada há ' + C.duracao(l.atualizadoEm || l.criadoEm) }), l.resposta ? h('span', { style: 'color:var(--tinta-2)', text: 'Equipe: ' + l.resposta }) : null, ['recebida', 'em_analise'].includes(l.status) ? h('span', { class: 'aguarde', text: 'Aguarde: a equipe do SC9 ainda vai analisar.' }) : null));
  function gavetaSolicitacao(l) {
    const fecha = () => { estado.aberta = null; estado.gavAnim = null; desenhar(); };
    const abre = estado.gavAnim !== l.id ? ' abre' : ''; estado.gavAnim = l.id;
    return [h('div', { class: 'gaveta-fundo' + abre, onclick: fecha }),
      h('aside', { class: 'gaveta' + abre, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Solicitação ' + (l.protocolo || l.pedido) },
        h('div', { class: 'gaveta-cab' }, h('div', null, h('p', { class: 'mudo peq', text: l.protocolo || 'Solicitação' }), h('h3', { class: 'num', text: 'Pedido ' + l.pedido }), h('div', { style: 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap' }, C.selo(C.NIVEL[l.nivel], l.nivel), C.selo(C.STATUS[l.status], l.status))), h('button', { class: 'btn peq fantasma', type: 'button', 'aria-label': 'Fechar', onclick: fecha }, ic('fechar'))),
        h('div', { class: 'gaveta-corpo' },
          h('div', { class: 'resumo-lista', style: 'margin-top:0' }, [['Motivo', C.MOTIVO[l.motivo] || '—'], ['Pedida em', C.dataHora(l.criadoEm)], ['Observação', l.observacao || '—'], ['Última atualização', C.dataHora(l.atualizadoEm)]].map(([t, v]) => h('div', null, h('span', { text: t }), h('b', { text: v })))),
          l.resposta ? h('div', { class: 'ok', style: 'background:var(--azul-claro);border-color:var(--azul-borda);color:var(--azul-escuro)' }, ic('comentario'), h('div', null, h('b', { style: 'display:block', text: 'Resposta da logística' }), l.resposta)) : null,
          h('div', null, h('p', { class: 'bloco-titulo', text: 'Histórico' }), h('ol', { class: 'hist', 'aria-label': 'Histórico da solicitação' }, (l.historico || []).slice().reverse().map((x) => h('li', null, h('span', { class: 'hora', text: C.dataHora(x.em) }), ' ', h('b', { text: x.status ? C.STATUS[x.status] || x.status : '' }), x.texto ? (x.status ? ' · ' : '') + x.texto : ''))))))];
  }
  function telaMinhas() {
    const meus = (estado.prio && estado.prio.meus) || [];
    const blocos = [faixaProcesso('minhas', true), h('div', { class: 'card-titulo' }, h('div', null, h('h1', { style: 'font-size:clamp(24px,4vw,30px);font-weight:800;letter-spacing:-.02em', text: 'Minhas solicitações' }), h('p', { class: 'mudo', style: 'margin-top:4px', text: 'Só o que é seu: acompanhe a análise da logística sem precisar mandar mensagem.' })))];
    if (estado.prioErro) blocos.push(h('div', { class: 'erro' }, ic('alerta'), estado.prioErro));
    if (!estado.prio && !estado.prioErro) blocos.push(C.esqueleto(2));
    else if (estado.prio) blocos.push(h('section', { class: 'card', 'aria-label': 'Minhas solicitações' }, meus.length ? [meus.map(cartaoSolicitacao), h('p', { class: 'dica', style: 'margin-top:12px', text: estado.conta ? 'Lista do seu login, em qualquer aparelho. Atualiza sozinha a cada minuto.' : 'Esta lista é deste aparelho. Crie seu acesso para vê-la em qualquer aparelho. Atualiza sozinha a cada minuto.' })] : C.vazio('caixaEntrada', 'Nenhuma solicitação ainda', 'Quando você pedir prioridade em um pedido, ele aparece aqui com o protocolo e o andamento.')));
    const aberta = estado.aberta && meus.find((x) => x.id === estado.aberta);
    if (aberta) blocos.push(...gavetaSolicitacao(aberta));
    return blocos;
  }

  /* ---------- tela ---------- */
  const NAV = [['rastrear', 'busca', 'Acompanhar pedidos', 'Acompanhar'], ['prioridade', 'raio', 'Solicitar prioridade', 'Prioridade'], ['minhas', 'lista', 'Minhas solicitações', 'Minhas'], ['exportar', 'baixar', 'Exportar', 'Exportar']];
  function desenhar() {
    const foco = root.document.activeElement && root.document.activeElement.id ? root.document.activeElement.id : '';
    const y = root.scrollY;
    const topo = h('header', { class: 'topo' }, h('div', { class: 'topo-in' }, C.marca('Acompanhamento de pedidos'),
      chaveLink ? h('nav', { class: 'nav', 'aria-label': 'Principal' }, NAV.map(([id, i, nome, curto]) => h('button', { type: 'button', 'aria-label': nome, 'aria-current': estado.tela === id ? 'page' : null, onclick: () => { estado.tela = id; estado.aberta = null; if ((id === 'minhas' || id === 'exportar') && !estado.prio) carregarPrioridades(); desenhar(); root.scrollTo(0, 0); } }, ic(i), h('span', { class: 'longo', text: nome }), h('span', { class: 'curto', text: curto })))) : null,
      chaveLink ? h('button', { class: 'btn peq conta-botao' + (estado.tela === 'conta' ? ' ativo' : ''), type: 'button', 'aria-label': estado.conta ? 'Seu acesso: ' + estado.conta.nome : 'Criar acesso ou entrar', onclick: () => { estado.tela = 'conta'; estado.aberta = null; desenhar(); root.scrollTo(0, 0); } }, ic(estado.conta ? 'usuarioCheck' : 'usuario'), h('span', { class: 'conta-nome', text: estado.conta ? estado.conta.nome.split(' ')[0] : 'Entrar' })) : null));
    let corpo;
    if (!chaveLink) corpo = [h('div', { class: 'erro', role: 'alert' }, ic('alerta'), 'Este link está incompleto. Peça o link das vendedoras ao administrador do SC9.')];
    else corpo = estado.tela === 'prioridade' ? telaPrioridade() : estado.tela === 'minhas' ? telaMinhas() : estado.tela === 'exportar' ? telaExportar() : estado.tela === 'conta' ? telaConta() : telaRastrear();
    const velha = chaveLink && estado.atualizadoEm && idadeBaseH() > LIMITE_BASE_VELHA_H;
    $raiz.replaceChildren(topo, h('main', { class: 'pagina estreita' + (estado.animada !== estado.tela ? ' anima' : '') },
      velha ? h('div', { class: 'aviso', role: 'status' }, ic('relogio'), 'A base do SC9 foi atualizada em ' + C.dataHora(estado.atualizadoEm) + ' (há ' + C.duracao(estado.atualizadoEm) + '). O andamento pode estar atrasado.') : null, ...corpo));
    estado.animada = estado.tela;
    root.document.title = ({ prioridade: 'Solicitar prioridade', minhas: 'Minhas solicitações', exportar: 'Exportar', conta: 'Seu acesso' }[estado.tela] || 'Acompanhe seus pedidos') + ' · ' + C.NOME;
    root.scrollTo(0, y);
    if (foco) { const e = root.document.getElementById(foco); if (e && e.focus) { e.focus({ preventScroll: true }); if (e.setSelectionRange && e.type === 'text') { try { e.setSelectionRange(e.value.length, e.value.length); } catch (x) { /* ok */ } } } }
  }

  root.setInterval(() => {
    if (root.document.hidden || !chaveLink || estado.f.enviando) return;
    if (estado.tela === 'rastrear' && estado.consulta && estado.consulta.achado && !estado.carregando) consultar(estado.consulta.pedido, true);
    else if (estado.tela === 'minhas') carregarPrioridades(true);
    else if (estado.tela === 'rastrear' && !estado.consulta && !estado.carregando) carregarPrioridades(true);
  }, 60000);

  const pedidoDaUrl = new URLSearchParams(root.location.search).get('pedido');
  desenhar();
  if (chaveLink && pedidoDaUrl) { estado.digitado = pedidoDaUrl; consultar(pedidoDaUrl); }
  if (chaveLink) carregarPrioridades(true); // traz também a hora da última carga do SC9 e confere a sessão do acesso
})(window);
