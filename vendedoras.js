/* Página das vendedoras (link com código, sem senha): "Cadê o meu pedido?" no estilo do rastreio dos Correios + pedido de prioridade.
 * JavaScript puro (sem React e sem nada de fora). Tudo que vem do servidor é mostrado com textContent (nunca innerHTML). */
(function (root) {
  'use strict';

  const FUSO = 'America/Sao_Paulo';
  const chaveLink = new URLSearchParams(root.location.search).get('k') || '';
  const $app = root.document.getElementById('app');
  const LS = { recentes: 'sc9v_recentes', meus: 'sc9v_meus', nome: 'sc9v_nome' };
  const lerLS = (k, padrao) => { try { const v = root.localStorage.getItem(k); return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; } };
  const gravarLS = (k, v) => { try { root.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem armazenamento: segue sem lembrar */ } };

  const estado = { aba: 'rastrear', digitado: '', consulta: null, carregando: false, erro: '', varios: null, prioridade: { pedido: '', nivel: 'normal', motivo: '', observacao: '', nome: lerLS(LS.nome, ''), etapa: 'form', previa: null, enviando: false, erro: '', ok: '', aviso: '' }, prio: null, prioErro: '', atualizadoEm: null };

  const h = (tag, props, ...filhos) => {
    const e = root.document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, v);
    }
    for (const f of filhos.flat(Infinity)) { if (f == null || f === false) continue; e.appendChild(typeof f === 'string' || typeof f === 'number' ? root.document.createTextNode(String(f)) : f); }
    return e;
  };

  /* ---------- formatação ---------- */
  const dataBR = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: FUSO }) : '');
  const curta = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' }) : '');
  const horaBR = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' }) : '');
  const dataHora = (iso) => (iso ? curta(iso) + ' às ' + horaBR(iso) : '');
  const duracao = (deIso, ateMs) => {
    const min = Math.max(0, Math.round(((ateMs || Date.now()) - new Date(deIso).getTime()) / 60000));
    const d = Math.floor(min / 1440), hh = Math.floor((min % 1440) / 60), m = min % 60;
    if (d >= 1) return d + (d === 1 ? ' dia' : ' dias') + (hh ? ' e ' + hh + ' h' : '');
    if (hh >= 1) return hh + ' h' + (m ? ' ' + m + ' min' : '');
    return Math.max(1, m) + ' min';
  };
  const NIVEL = { normal: 'Normal', media: 'Média', alta: 'Alta', urgente: 'Urgente' };
  const STATUS = { recebida: 'Recebida', em_analise: 'Em análise', aprovada: 'Aprovada', em_atendimento: 'Em atendimento', concluida: 'Concluída', nao_aprovada: 'Não aprovada' };
  const MOTIVO = { cliente_aguardando: 'Cliente esperando o pedido', prazo_combinado: 'Prazo combinado com o cliente', cliente_importante: 'Cliente estratégico', erro_nosso: 'Atraso por erro nosso', retirada: 'Cliente vai retirar', outro: 'Outro (explique na observação)' };
  const LIMITE_BASE_VELHA_H = 10; // base sem carga há mais que isso aparece em amarelo

  /* ---------- servidor ---------- */
  async function api(caminho, opcoes) {
    const url = caminho + (caminho.includes('?') ? '&' : '?') + 'k=' + encodeURIComponent(chaveLink);
    const r = await root.fetch(url, Object.assign({ cache: 'no-store', credentials: 'omit' }, opcoes, { headers: { 'Content-Type': 'application/json', 'X-SC9-App': '1' } }));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || 'Não consegui falar com o servidor. Tente de novo em instantes.'); e.status = r.status; throw e; }
    return j;
  }
  const soNumeros = (t) => String(t || '').replace(/\D/g, '').replace(/^0+/, '');

  /* ---------- rastreio ---------- */
  async function consultar(pedidoDigitado, silencioso) {
    const lista = [...new Set(String(pedidoDigitado || '').split(/[\s,;]+/).map(soNumeros).filter((x) => x.length >= 4))].slice(0, 10);
    estado.digitado = String(pedidoDigitado || '').trim();
    if (!lista.length) { estado.erro = 'Digite o número do pedido (só números, no mínimo 4 dígitos).'; estado.consulta = null; estado.varios = null; return desenhar(); }
    if (!silencioso) { estado.carregando = true; estado.erro = ''; desenhar(); }
    try {
      if (lista.length === 1) {
        estado.consulta = await api('/api/vendedoras/pedido?pedido=' + lista[0]); estado.varios = null;
        estado.atualizadoEm = estado.consulta.atualizadoEm;
        if (estado.consulta.achado) lembrar(lista[0]);
        try { const u = new URL(root.location.href); u.searchParams.set('pedido', lista[0]); root.history.replaceState(null, '', u.toString()); } catch (e) { /* sem histórico */ }
      } else {
        const resultados = [];
        for (const p of lista) { try { resultados.push(await api('/api/vendedoras/pedido?pedido=' + p)); } catch (e) { resultados.push({ achado: false, pedido: p, erro: e.message }); } }
        estado.varios = resultados; estado.consulta = null;
      }
      estado.erro = '';
    } catch (e) { estado.erro = e.status === 401 ? e.message : (e.message || 'Não consegui consultar agora.'); if (!silencioso) estado.consulta = null; }
    estado.carregando = false; desenhar();
  }
  function lembrar(pedido) { const l = [pedido].concat(lerLS(LS.recentes, []).filter((x) => x !== pedido)).slice(0, 8); gravarLS(LS.recentes, l); }

  function textoParaCopiar(r) {
    const d = r.detalhes || {};
    const atual = (r.etapas || []).find((e) => e.estado === 'atual');
    const partes = ['Pedido ' + r.pedido + (d.cliente ? ' (' + d.cliente + ')' : '') + ': ' + r.resumo.texto];
    if (atual && atual.quando) partes.push((atual.nota ? atual.nota + ' em ' : 'Desde ') + dataHora(atual.quando) + '.');
    if (d.transportadora) partes.push('Transportadora: ' + d.transportadora + '.');
    if (d.nf) partes.push('Nota fiscal: ' + d.nf + '.');
    partes.push('Consulta em ' + dataHora(new Date().toISOString()) + '.');
    return partes.join(' ');
  }
  async function copiar(texto, aviso) {
    try { await root.navigator.clipboard.writeText(texto); estado.aviso = aviso; } catch (e) { estado.aviso = 'Não consegui copiar. Selecione o texto e copie.'; }
    desenhar(); setTimeout(() => { estado.aviso = ''; desenhar(); }, 2500);
  }

  function selo(r) { return h('span', { class: 'tag ' + r.resumo.nivel, text: r.resumo.nivel === 'atraso' ? 'Atrasado' : r.resumo.nivel === 'concluido' ? 'Despachado' : 'Em andamento' }); }

  function cartaoPedido(r) {
    const d = r.detalhes || {};
    const atual = (r.etapas || []).find((e) => e.estado === 'atual');
    const campo = (t, v) => h('div', { class: 'cd' }, h('span', { text: t }), h('b', { text: v || '—' }));
    const quando = (e) => (e.estado === 'feita' ? (e.quando ? (e.soData ? dataBR(e.quando) : dataHora(e.quando)) : 'Horário não registrado') : e.estado === 'atual' ? (e.quando ? (e.nota || 'Desde') + ' ' + dataHora(e.quando) : 'Etapa atual') : 'Ainda não');
    return h('section', { class: 'cartao', 'aria-label': 'Andamento do pedido ' + r.pedido },
      h('div', { class: 'topo-ped' }, h('div', null, h('p', { class: 'mudo peq', text: 'Pedido' }), h('h2', { text: r.pedido })), selo(r)),
      h('p', { class: 'resumo', text: r.resumo.texto }),
      atual && r.paradoDesde && r.resumo.nivel !== 'concluido' ? h('p', { class: 'mudo peq', text: 'Nesta etapa há cerca de ' + duracao(r.paradoDesde) + '.' }) : null,
      h('ol', { class: 'linha', 'aria-label': 'Andamento do pedido ' + r.pedido }, (r.etapas || []).map((e) => h('li', { class: e.estado, 'aria-current': e.estado === 'atual' ? 'step' : null },
        h('span', { class: 'sr', text: e.estado === 'feita' ? 'Concluída: ' : e.estado === 'atual' ? 'Etapa atual: ' : 'Ainda não: ' }),
        h('div', { class: 'et-t', text: e.titulo }), h('div', { class: 'et-q', text: quando(e) }),
        e.nota && e.estado !== 'atual' && e.nota !== 'Horário não registrado' ? h('div', { class: 'et-q', text: e.nota }) : null,
        e.estado === 'atual' && !e.quando && e.nota ? h('div', { class: 'et-q', text: e.nota }) : null))),
      r.ocorrencia ? h('div', { class: 'caixa-oc', role: 'note' }, h('b', { text: 'Ocorrência da expedição: ' }), r.ocorrencia.status + (r.ocorrencia.detalhes ? ' · ' + r.ocorrencia.detalhes : ''), r.ocorrencia.solucao ? h('div', { text: 'Solução: ' + r.ocorrencia.solucao + (r.ocorrencia.dataSolucao ? ' (' + dataBR(r.ocorrencia.dataSolucao + 'T12:00:00Z') + ')' : '') }) : null) : null,
      h('div', { class: 'grade' },
        campo('Cliente', d.cliente), campo('Armazém', d.armazem), campo('Transportadora', d.transportadora), campo('Peças', d.pecas ? String(d.pecas) : ''),
        campo('Nota fiscal', d.nf || 'ainda não emitida'), campo('Liberado em', d.liberadoEm ? dataHora(d.liberadoEm) : ''),
        campo('Dias desde a liberação', d.diasDesdeLiberacao != null ? String(d.diasDesdeLiberacao) : ''), campo('Despachado em', d.despachadoEm ? dataBR(d.despachadoEm) : 'ainda não')),
      h('div', { class: 'acoes' },
        h('button', { class: 'btn peq', type: 'button', onclick: () => copiar(textoParaCopiar(r), 'Status copiado. É só colar no WhatsApp.'), text: 'Copiar status' }),
        h('button', { class: 'btn peq', type: 'button', onclick: () => { const u = new URL(root.location.href); u.searchParams.set('pedido', r.pedido); copiar(u.toString(), 'Link copiado.'); }, text: 'Copiar link deste pedido' }),
        r.resumo.nivel !== 'concluido' ? h('button', { class: 'btn peq', type: 'button', onclick: () => { estado.prioridade.pedido = r.pedido; estado.prioridade.erro = ''; estado.prioridade.ok = ''; estado.aba = 'pedir'; desenhar(); }, text: 'Pedir prioridade' }) : null),
      h('p', { class: 'mudo peq', style: 'margin-top:12px', text: 'Base do SC9 atualizada em ' + (r.atualizadoEm ? dataHora(r.atualizadoEm) : '—') + '. A Saída para expedição é em tempo real; o resto atualiza quando o SC9 é exportado.' }));
  }

  function telaRastrear() {
    const recentes = lerLS(LS.recentes, []);
    const blocos = [];
    blocos.push(h('section', { class: 'cartao' },
      h('form', { onsubmit: (ev) => { ev.preventDefault(); consultar(estado.digitado); } },
        h('div', null, h('label', { for: 'q-pedido', text: 'Número do pedido' }),
          h('div', { class: 'linha-busca' },
            h('input', { id: 'q-pedido', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'Ex.: 123456 (pode colocar vários, separados por vírgula)', value: estado.digitado, oninput: (ev) => { estado.digitado = ev.target.value; } }),
            h('button', { class: 'btn primario', type: 'submit', disabled: estado.carregando, text: estado.carregando ? 'Buscando…' : 'Ver andamento' }))),
        recentes.length ? h('div', { class: 'chips', 'aria-label': 'Pedidos consultados por último' }, h('span', { class: 'mudo peq', text: 'Recentes:' }), recentes.map((p) => h('button', { class: 'chip', type: 'button', onclick: () => { estado.digitado = p; consultar(p); }, text: p }))) : null)));
    if (estado.aviso) blocos.push(h('p', { class: 'ok', role: 'status', text: estado.aviso }));
    const regiao = h('div', { role: 'status', 'aria-live': 'polite', style: 'display:flex;flex-direction:column;gap:14px' });
    if (estado.carregando) regiao.appendChild(h('div', { class: 'esq', 'aria-label': 'Buscando seu pedido' }));
    else if (estado.erro) regiao.appendChild(h('p', { class: 'erro', role: 'alert', text: estado.erro }));
    else if (estado.varios) regiao.appendChild(h('section', { class: 'cartao' }, h('h3', { text: 'Seus pedidos' }), estado.varios.map((r) => h('div', { class: 'item' },
      h('div', { class: 'l1' }, h('b', { text: r.pedido }), r.achado ? selo(r) : h('span', { class: 'tag cancelado', text: 'Não achado' })),
      h('div', { class: 'mudo peq', text: r.achado ? r.resumo.texto : (r.erro || 'Não achamos este pedido na base.') }),
      r.achado ? h('button', { class: 'btn peq', type: 'button', style: 'align-self:flex-start', onclick: () => { estado.digitado = r.pedido; consultar(r.pedido); }, text: 'Ver andamento' }) : null))));
    else if (estado.consulta && estado.consulta.achado) regiao.appendChild(cartaoPedido(estado.consulta));
    else if (estado.consulta) regiao.appendChild(h('div', { class: 'aviso' }, h('b', { text: 'Não achamos o pedido ' + estado.consulta.pedido + '. ' }), 'Confira o número. Se o pedido é de hoje, ele pode ainda não ter chegado: a base só atualiza quando o SC9 é exportado.' + (estado.consulta.atualizadoEm ? ' Última atualização: ' + dataHora(estado.consulta.atualizadoEm) + '.' : ''),
      h('div', { class: 'acoes' }, h('button', { class: 'btn peq', type: 'button', onclick: () => consultar(estado.digitado), text: 'Tentar de novo' }), h('button', { class: 'btn peq', type: 'button', onclick: () => { estado.prioridade.pedido = estado.consulta.pedido; estado.aba = 'pedir'; desenhar(); }, text: 'Pedir prioridade mesmo assim' }))));
    else regiao.appendChild(h('p', { class: 'mudo', text: 'Digite o número do pedido para ver em que etapa ele está.' }));
    blocos.push(regiao);
    return blocos;
  }

  /* ---------- prioridade ---------- */
  async function carregarPrioridades(silencioso) {
    try {
      const ids = lerLS(LS.meus, []).join(',');
      estado.prio = await api('/api/vendedoras/prioridades?ids=' + encodeURIComponent(ids)); estado.prioErro = '';
    } catch (e) { estado.prioErro = e.message; }
    if (!silencioso || estado.aba !== 'rastrear') desenhar();
  }
  // Passo 1: confere os campos e busca os dados do pedido para a vendedora ver antes de confirmar.
  async function conferirPrioridade() {
    const f = estado.prioridade; f.erro = ''; f.ok = ''; f.aviso = '';
    const pedido = soNumeros(f.pedido);
    if (pedido.length < 4) { f.erro = 'Digite o número do pedido (só números).'; return desenhar(); }
    if (!f.motivo) { f.erro = 'Escolha o motivo do pedido de prioridade.'; return desenhar(); }
    if (f.motivo === 'outro' && f.observacao.trim().length < 5) { f.erro = 'Explique o motivo na observação.'; return desenhar(); }
    if (f.nome.trim().length < 2) { f.erro = 'Diga seu nome para a equipe saber quem pediu.'; return desenhar(); }
    f.enviando = true; desenhar();
    try {
      f.previa = await api('/api/vendedoras/pedido?pedido=' + pedido);
      if (f.previa.achado && f.previa.resumo.nivel === 'concluido') { f.erro = 'Este pedido já foi despachado. ' + f.previa.resumo.texto; f.previa = null; }
      else f.etapa = 'confirmar';
    } catch (e) { f.erro = e.message; }
    f.enviando = false; desenhar();
  }
  async function enviarPrioridade() {
    const f = estado.prioridade; f.erro = ''; f.ok = ''; f.aviso = '';
    f.enviando = true; desenhar();
    try {
      const j = await api('/api/vendedoras/prioridade', { method: 'POST', body: JSON.stringify({ pedido: soNumeros(f.pedido), nivel: f.nivel, motivo: f.motivo, observacao: f.observacao, pedidoPor: f.nome }) });
      gravarLS(LS.nome, f.nome.trim());
      const meus = [j.linha.id].concat(lerLS(LS.meus, []).filter((x) => x !== j.linha.id)).slice(0, 60); gravarLS(LS.meus, meus);
      f.ok = j.duplicado ? 'Este pedido já estava na fila (protocolo ' + j.linha.protocolo + '). Reforçamos o pedido, nível ' + NIVEL[j.linha.nivel].toLowerCase() + '.' : 'Pedido de prioridade enviado. Protocolo ' + j.linha.protocolo + '. Status: Recebida. A equipe responde aqui, em "Meus pedidos de prioridade".';
      if (j.naoAchado) f.aviso = 'Não achamos este pedido na base. A equipe vai conferir o número.';
      f.pedido = ''; f.observacao = ''; f.motivo = ''; f.nivel = 'normal'; f.previa = null; f.etapa = 'form';
      await carregarPrioridades();
    } catch (e) { f.erro = e.message; f.etapa = 'form'; }
    f.enviando = false; desenhar();
  }
  const itemPrio = (l, detalhado) => h('div', { class: 'item' },
    h('div', { class: 'l1' }, h('b', { text: 'Pedido ' + l.pedido }), h('span', { class: 'tag ' + l.nivel, text: NIVEL[l.nivel] || l.nivel }), h('span', { class: 'tag ' + l.status, text: STATUS[l.status] || l.status }), h('span', { class: 'mudo peq', text: 'há ' + duracao(l.criadoEm) })),
    detalhado && l.protocolo ? h('div', { class: 'mudo peq', text: 'Protocolo ' + l.protocolo + (l.motivo && MOTIVO[l.motivo] ? ' · ' + MOTIVO[l.motivo] : '') }) : null,
    detalhado && l.observacao ? h('div', { class: 'mudo peq', text: 'Seu pedido: ' + l.observacao }) : null,
    detalhado && l.resposta ? h('div', { class: 'resp' }, h('b', { text: 'Equipe: ' }), l.resposta) : null,
    detalhado && l.historico && l.historico.length ? h('ol', { class: 'hist', 'aria-label': 'Histórico do protocolo ' + l.protocolo }, l.historico.map((x) => h('li', null,
      h('span', { class: 'hora', text: dataHora(x.em) }), ' ', h('span', { text: x.status ? (STATUS[x.status] || x.status) + (x.texto ? ': ' + x.texto : '') : x.texto })))) : null);

  function previaDoPedido(r) {
    const d = r.detalhes || {};
    if (!r.achado) return h('div', { class: 'aviso' }, h('b', { text: 'Não achamos o pedido ' + r.pedido + ' na base. ' }), 'Confira o número. Você pode enviar mesmo assim: a equipe vai conferir.');
    const campo = (t, v) => h('div', { class: 'cd' }, h('span', { text: t }), h('b', { text: v || '—' }));
    return h('div', { class: 'previa', role: 'group', 'aria-label': 'Dados do pedido ' + r.pedido },
      h('div', { class: 'l1' }, h('b', { text: 'Pedido ' + r.pedido }), selo(r)), h('p', { class: 'mudo', style: 'margin-top:4px', text: r.resumo.texto }),
      h('div', { class: 'grade' }, campo('Cliente', d.cliente), campo('Filial', d.armazem), campo('Transportadora', d.transportadora), campo('Peças', d.pecas ? String(d.pecas) : ''), campo('Liberado em', d.liberadoEm ? dataHora(d.liberadoEm) : ''), campo('Dias desde a liberação', d.diasDesdeLiberacao != null ? String(d.diasDesdeLiberacao) : '')));
  }

  function telaPedir() {
    const f = estado.prioridade;
    const meus = (estado.prio && estado.prio.meus) || [];
    const blocos = [];
    const resultado = [f.erro ? h('p', { class: 'erro', role: 'alert', text: f.erro }) : null, f.ok ? h('p', { class: 'ok', role: 'status', text: f.ok }) : null, f.aviso ? h('p', { class: 'aviso', role: 'status', text: f.aviso }) : null];
    if (f.etapa === 'confirmar' && f.previa) {
      blocos.push(h('section', { class: 'cartao' }, h('h2', { text: 'Confirme o pedido de prioridade' }), h('p', { class: 'mudo peq', style: 'margin:4px 0 12px', text: 'Confira os dados do pedido. Prioridade não passa o pedido na frente automaticamente: a equipe analisa e responde aqui.' }),
        previaDoPedido(f.previa),
        h('div', { class: 'resumo-pedido' }, h('div', null, h('span', { class: 'mudo peq', text: 'Nível ' }), h('span', { class: 'tag ' + f.nivel, text: NIVEL[f.nivel] })), h('div', null, h('span', { class: 'mudo peq', text: 'Motivo: ' }), h('b', { text: MOTIVO[f.motivo] })), f.observacao.trim() ? h('div', { class: 'mudo', text: 'Observação: ' + f.observacao.trim() }) : null, h('div', { class: 'mudo peq', text: 'Pedido por: ' + f.nome.trim() })),
        h('div', { class: 'acoes' }, h('button', { class: 'btn primario', type: 'button', disabled: f.enviando, onclick: enviarPrioridade, text: f.enviando ? 'Enviando…' : 'Confirmar e enviar' }), h('button', { class: 'btn', type: 'button', disabled: f.enviando, onclick: () => { f.etapa = 'form'; f.erro = ''; desenhar(); }, text: 'Voltar e corrigir' })),
        ...resultado));
    } else {
      blocos.push(h('section', { class: 'cartao' }, h('h2', { text: 'Pedir prioridade' }), h('p', { class: 'mudo peq', style: 'margin:4px 0 12px', text: 'A equipe da expedição recebe na hora, analisa e responde aqui. Use quando o cliente precisa do pedido com urgência.' }),
        h('form', { onsubmit: (ev) => { ev.preventDefault(); conferirPrioridade(); } },
          h('div', null, h('label', { for: 'p-pedido', text: 'Número do pedido' }), h('input', { id: 'p-pedido', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'Ex.: 123456', value: f.pedido, oninput: (ev) => { f.pedido = ev.target.value; } })),
          h('div', null, h('label', { text: 'Nível de prioridade' }), h('div', { class: 'niveis', role: 'radiogroup', 'aria-label': 'Nível de prioridade' }, ['normal', 'media', 'alta', 'urgente'].map((n) => h('label', null, h('input', { type: 'radio', name: 'nivel', value: n, checked: f.nivel === n, onchange: () => { f.nivel = n; } }), h('span', { text: NIVEL[n] }))))),
          h('div', null, h('label', { for: 'p-motivo', text: 'Motivo' }), h('select', { id: 'p-motivo', onchange: (ev) => { f.motivo = ev.target.value; } }, h('option', { value: '', text: 'Escolha o motivo', selected: !f.motivo }), Object.keys(MOTIVO).map((k) => h('option', { value: k, text: MOTIVO[k], selected: f.motivo === k })))),
          h('div', null, h('label', { for: 'p-obs', text: 'Observação (conta mais para a equipe)' }), h('textarea', { id: 'p-obs', maxlength: '300', placeholder: 'Ex.: cliente tem prazo na sexta; retira na expedição', oninput: (ev) => { f.observacao = ev.target.value; } }, f.observacao)),
          h('div', null, h('label', { for: 'p-nome', text: 'Seu nome' }), h('input', { id: 'p-nome', type: 'text', autocomplete: 'name', maxlength: '60', placeholder: 'Ex.: Ana (Vendas)', value: f.nome, oninput: (ev) => { f.nome = ev.target.value; } })),
          h('button', { class: 'btn primario', type: 'submit', disabled: f.enviando, text: f.enviando ? 'Buscando o pedido…' : 'Conferir pedido e continuar' }),
          ...resultado)));
    }
    blocos.push(h('section', { class: 'cartao', 'aria-label': 'Meus pedidos de prioridade' }, h('h3', { text: 'Meus pedidos de prioridade' }),
      estado.prioErro ? h('p', { class: 'erro', text: estado.prioErro }) : null,
      meus.length ? meus.map((l) => itemPrio(l, true)) : h('p', { class: 'mudo peq', style: 'margin-top:6px', text: 'Você ainda não pediu prioridade para nenhum pedido neste aparelho.' }),
      meus.length ? h('p', { class: 'mudo peq', style: 'margin-top:8px', text: 'A lista é deste aparelho/navegador. Atualiza sozinha a cada minuto.' }) : null));
    return blocos;
  }
  function telaFila() {
    const fila = (estado.prio && estado.prio.fila) || [];
    return [h('section', { class: 'cartao' }, h('h2', { text: 'Prioridades em andamento' }), h('p', { class: 'mudo peq', style: 'margin:4px 0 8px', text: 'Pedidos que as vendedoras pediram prioridade e a equipe ainda não terminou. Mostramos só o número, o nível e o status.' }),
      estado.prioErro ? h('p', { class: 'erro', text: estado.prioErro }) : null,
      fila.length ? fila.map((l) => itemPrio(l, false)) : h('p', { class: 'mudo', text: estado.prio ? 'Nenhum pedido com prioridade na fila agora.' : 'Carregando…' }))];
  }

  /* ---------- tela ---------- */
  const ABAS = [['rastrear', 'Rastrear pedido'], ['pedir', 'Pedir prioridade'], ['fila', 'Prioridades em andamento']];
  function desenhar() {
    const foco = root.document.activeElement && root.document.activeElement.id ? root.document.activeElement.id : '';
    const y = root.scrollY;
    let corpo;
    if (!chaveLink) corpo = [h('p', { class: 'erro', text: 'Este link está incompleto. Peça o link das vendedoras ao administrador do SC9.' })];
    else corpo = estado.aba === 'pedir' ? telaPedir() : estado.aba === 'fila' ? telaFila() : telaRastrear();
    $app.replaceChildren(
      h('header', null, h('p', { class: 'sobre', text: 'SC9 Control · Expedição' }), h('h1', { text: 'Cadê o meu pedido?' }),
        estado.atualizadoEm ? h('p', { class: 'mudo peq' + (Date.now() - new Date(estado.atualizadoEm).getTime() > LIMITE_BASE_VELHA_H * 36e5 ? ' velha' : ''), text: 'Base atualizada em ' + dataHora(estado.atualizadoEm) + ' (há ' + duracao(estado.atualizadoEm) + ')' + (Date.now() - new Date(estado.atualizadoEm).getTime() > LIMITE_BASE_VELHA_H * 36e5 ? '. Faz tempo sem atualizar: o andamento pode estar atrasado.' : '') }) : null),
      chaveLink ? h('div', { class: 'abas', role: 'tablist' }, ABAS.map(([id, nome]) => h('button', { class: 'aba', type: 'button', role: 'tab', id: 'aba-' + id, 'aria-selected': estado.aba === id ? 'true' : 'false', onclick: () => { estado.aba = id; if (id !== 'rastrear' && !estado.prio) carregarPrioridades(); desenhar(); }, text: nome }))) : null,
      ...corpo);
    root.scrollTo(0, y);
    if (foco) { const e = root.document.getElementById(foco); if (e && e.focus) { e.focus({ preventScroll: true }); if (e.setSelectionRange && e.type === 'text') { try { e.setSelectionRange(e.value.length, e.value.length); } catch (x) { /* ok */ } } } }
  }

  // atualiza sozinho (1 min) só com a página à vista
  root.setInterval(() => {
    if (root.document.hidden || !chaveLink) return;
    if (estado.aba === 'rastrear' && estado.consulta && estado.consulta.achado && !estado.carregando) consultar(estado.consulta.pedido, true);
    else if (estado.aba !== 'rastrear') carregarPrioridades(true);
  }, 60000);

  const pedidoDaUrl = new URLSearchParams(root.location.search).get('pedido');
  desenhar();
  if (chaveLink && pedidoDaUrl) { estado.digitado = pedidoDaUrl; consultar(pedidoDaUrl); }
  if (chaveLink && lerLS(LS.meus, []).length) carregarPrioridades(true);
})(window);
