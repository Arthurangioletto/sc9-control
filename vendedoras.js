/* Central de Pedidos · área das vendedoras (link com código, sem senha): acompanhar pedido (estilo rastreio de encomendas),
 * solicitar prioridade e acompanhar as próprias solicitações. JavaScript puro; tudo do servidor entra como textContent. */
(function (root) {
  'use strict';
  const C = root.Central, h = C.h, ic = C.icone;
  const chaveLink = new URLSearchParams(root.location.search).get('k') || '';
  const $raiz = root.document.getElementById('raiz');
  const LS = { recentes: 'sc9v_recentes', meus: 'sc9v_meus', nome: 'sc9v_nome', sessao: 'sc9v_sessao', consultas: 'sc9v_consultas', avisos: 'sc9v_avisos', seguindo: 'sc9v_seguindo' };
  const lerLS = (k, padrao) => { try { const v = root.localStorage.getItem(k); return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; } };
  const gravarLS = (k, v) => { try { root.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem armazenamento: segue sem lembrar */ } };
  const LIMITE_BASE_VELHA_H = 10; // carga do SC9 mais velha que isso fica em destaque

  const estado = {
    tela: 'rastrear', digitado: '', consulta: null, varios: null, carregando: false, erro: '', atualizadoEm: null,
    f: { pedido: '', nivel: 'normal', motivo: '', observacao: '', nome: lerLS(LS.nome, ''), etapa: 'form', previa: null, buscando: false, enviando: false, erro: '', enviada: null },
    prio: null, prioErro: '', visao: 'minhas', aberta: null,
    a: { pedido: '', tipo: '', texto: '', nome: lerLS(LS.nome, ''), previa: null, buscando: false, enviando: false, erro: '', enviado: null },
    avisos: null, avisosErro: '', sub: 'prioridades', abertoAviso: null,
    seguindo: lerLS(LS.seguindo, []), seguindoEstado: {}, seguindoCarregando: false, // pedidos que ela acompanha NESTE aparelho: [{ pedido, cliente, visto }]
    conta: lerLS(LS.sessao, null), // { token, nome, login } quando ela entrou com o acesso opcional
    cf: { modo: 'criar', nome: '', email: '', login: '', codigo: '', codigo2: '', erro: '', enviando: false, atual: '', novo: '', erroTroca: '', okTroca: '', trocando: false }
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
    if (!silencioso) { estado.carregando = true; estado.erro = ''; estado.animouRes = ''; desenhar(); }
    try {
      if (lista.length === 1) {
        estado.consulta = await api('/api/vendedoras/pedido?pedido=' + lista[0] + (silencioso ? '&auto=1' : '')); estado.varios = null; estado.atualizadoEm = estado.consulta.atualizadoEm;
        if (seguindoPedido(lista[0])) { estado.seguindoEstado[lista[0]] = estado.consulta; if (!silencioso) marcarVisto(lista[0]); }
        if (estado.consulta.achado) { gravarLS(LS.recentes, [lista[0]].concat(lerLS(LS.recentes, []).filter((x) => x !== lista[0])).slice(0, 8)); if (!silencioso) registrarConsulta(estado.consulta); }
        try { const u = new URL(root.location.href); u.searchParams.set('pedido', lista[0]); root.history.replaceState(null, '', u.toString()); } catch (e) { /* sem histórico */ }
      } else {
        const rs = [];
        for (const p of lista) { try { const r = await api('/api/vendedoras/pedido?pedido=' + p); rs.push(r); registrarConsulta(r); } catch (e) { rs.push({ achado: false, pedido: p, erro: e.message }); } }
        estado.varios = rs; estado.consulta = null;
      }
      estado.erro = '';
    } catch (e) { estado.erro = e.message || 'Não consegui consultar agora. Tente de novo em instantes.'; if (!silencioso) estado.consulta = null; }
    estado.carregando = false; desenhar();
  }
  /* ---------- acompanhar pedidos (neste aparelho): avisa o que mudou desde a última vez que ela olhou ---------- */
  // "chave" = o que, para ela, é uma mudança: etapa atual, situação geral e ocorrência (abriu, mudou de tipo, resolveu)
  const chaveDe = (r) => {
    if (!r || !r.achado) return 'fora';
    const atual = (r.etapas || []).find((e) => e.estado === 'atual');
    return [atual ? atual.cod : 'fim', r.resumo.nivel, r.ocorrencia ? (r.ocorrencia.resolvida ? 'oc-res' : 'oc-' + (r.ocorrencia.tipo || 'x')) : ''].join('|');
  };
  const seguindoPedido = (p) => estado.seguindo.find((x) => x.pedido === p);
  function salvarSeguindo() { gravarLS(LS.seguindo, estado.seguindo); }
  function seguir(r) {
    if (!r || !r.achado || seguindoPedido(r.pedido)) return;
    estado.seguindo = [{ pedido: r.pedido, cliente: (r.detalhes && r.detalhes.cliente) || '', visto: chaveDe(r) }].concat(estado.seguindo).slice(0, 30);
    estado.seguindoEstado[r.pedido] = r; salvarSeguindo();
  }
  function pararDeSeguir(p) { estado.seguindo = estado.seguindo.filter((x) => x.pedido !== p); delete estado.seguindoEstado[p]; salvarSeguindo(); }
  function marcarVisto(p) { const s = seguindoPedido(p), r = estado.seguindoEstado[p]; if (s && r) { s.visto = chaveDe(r); salvarSeguindo(); } }
  const mudou = (p) => { const s = seguindoPedido(p), r = estado.seguindoEstado[p]; return Boolean(s && r && s.visto !== chaveDe(r)); };
  async function carregarSeguindo(silencioso) {
    if (!estado.seguindo.length || estado.seguindoCarregando) return;
    estado.seguindoCarregando = true;
    try {
      const j = await api('/api/vendedoras/pedidos?pedidos=' + estado.seguindo.slice(0, 30).map((s) => s.pedido).join(','));
      (j.pedidos || []).forEach((r) => { if (r && r.pedido) { estado.seguindoEstado[r.pedido] = r; if (r.atualizadoEm) estado.atualizadoEm = r.atualizadoEm; } });
    } catch (e) { /* mantém o último que tinha */ }
    estado.seguindoCarregando = false;
    if (!silencioso || ['rastrear', 'minhas'].includes(estado.tela)) desenhar();
  }
  // mini barra de progresso (uma fatia por etapa) e cor da situação: usadas nos cartões compactos
  const tomDe = (r) => 'nv-' + (r && r.achado ? r.resumo.nivel : 'andamento');
  function miniProgresso(r) {
    const et = (r && r.etapas) || [], f = et.filter((e) => e.estado === 'feita').length;
    if (!et.length) return null;
    return h('div', { class: 'mini-bloco' }, h('div', { class: 'mini', role: 'img', 'aria-label': f + ' de ' + et.length + ' etapas concluídas' }, et.map((e) => h('i', { class: e.estado }))), h('p', { class: 'mini-leg', text: f + ' de ' + et.length + ' etapas concluídas' }));
  }
  function cartaoSeguindo() {
    if (!estado.seguindo.length) return null;
    const mudaram = estado.seguindo.filter((s) => mudou(s.pedido)).length;
    return h('section', { class: 'card', 'aria-label': 'Pedidos que você acompanha' },
      h('div', { class: 'card-titulo' }, h('h2', { text: 'Pedidos que você acompanha' }), h('span', { class: 'mudo peq', text: mudaram ? mudaram + (mudaram === 1 ? ' mudou' : ' mudaram') + ' desde a última vez' : 'nada mudou desde a última vez' })),
      h('div', { class: 'seg-lista' }, estado.seguindo.map((s) => { const r = estado.seguindoEstado[s.pedido], mdd = mudou(s.pedido);
        return h('div', { class: 'seg-card tilt ' + tomDe(r) + (mdd ? ' mudou' : '') },
          h('div', { class: 'l1' }, h('b', { class: 'num', text: 'Pedido ' + s.pedido }), r ? (r.achado ? C.selo(rotuloResumo(r), r.resumo.nivel) : C.selo('Fora do SC9', 'alta')) : C.selo('Carregando…', 'normal'), mdd ? C.selo('Mudou', 'laranja mudou') : null),
          h('p', { class: 'quem', text: (s.cliente ? s.cliente + ' · ' : '') + (r ? (r.achado ? r.resumo.texto : 'Ainda não está no SC9.') : 'Buscando a situação…') }),
          r && r.achado ? miniProgresso(r) : null,
          h('div', { class: 'acoes' },
            h('button', { class: 'btn peq' + (mdd ? '' : ' primario'), type: 'button', onclick: () => { marcarVisto(s.pedido); estado.tela = 'rastrear'; estado.digitado = s.pedido; consultar(s.pedido); root.scrollTo(0, 0); } }, ic('busca'), 'Ver o andamento'),
            mdd ? h('button', { class: 'btn peq', type: 'button', onclick: () => { marcarVisto(s.pedido); desenhar(); } }, ic('ok'), 'Já vi') : null,
            h('button', { class: 'btn peq', type: 'button', onclick: () => { pararDeSeguir(s.pedido); C.toast('Você parou de acompanhar o pedido ' + s.pedido + '.'); desenhar(); } }, ic('fechar'), 'Parar de acompanhar')));
      })),
      h('p', { class: 'dica', style: 'margin-top:12px', text: 'A lista fica neste aparelho. A situação atualiza a cada minuto com a tela aberta, e o que mudou desde a última vez que você olhou aparece com o selo "Mudou".' }));
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
  const rotuloResumo = (r) => (r.resumo.nivel === 'atraso' ? 'Atrasado' : r.resumo.nivel === 'concluido' ? 'Despachado' : r.resumo.nivel === 'pronto' ? 'Pronto para despacho' : 'Em andamento');
  const iconeResumo = (r) => (r.resumo.nivel === 'atraso' ? 'alerta' : r.resumo.nivel === 'concluido' || r.resumo.nivel === 'pronto' ? 'caminhao' : 'relogio');

  function formBusca(compacto) {
    const recentes = lerLS(LS.recentes, []);
    return h('div', { class: compacto ? 'busca-compacta' : 'hero' },
      !compacto ? h('div', { class: 'hero-selo', 'aria-hidden': 'true' }, ic('pacote')) : null,
      !compacto ? h('h1', { text: 'Acompanhe seus pedidos' }) : null,
      !compacto ? h('p', { class: 'sub', text: 'Digite o número do pedido e veja cada etapa: o que já aconteceu, onde ele está agora e o que falta.' }) : null,
      h('form', { class: 'busca', style: compacto ? 'max-width:none;margin-top:0' : null, role: 'search', onsubmit: (ev) => { ev.preventDefault(); consultar(estado.digitado); } },
        h('label', { class: 'campo-ic', for: 'q-pedido' }, ic('busca'), h('span', { class: 'sr', text: 'Número do pedido' }), h('input', { id: 'q-pedido', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'Número do pedido', value: estado.digitado, oninput: (ev) => { estado.digitado = ev.target.value; } })),
        h('button', { class: 'btn primario' + (estado.carregando ? ' girando' : ''), type: 'submit', disabled: estado.carregando, text: estado.carregando ? 'Consultando…' : 'Consultar pedido' })),
      !compacto ? h('p', { class: 'dica', text: 'Dica: pode digitar vários números, separados por vírgula.' }) : null,
      recentes.length ? h('div', { class: 'chips', 'aria-label': 'Consultados por último' }, h('span', { class: 'mudo peq', text: 'Recentes' }), recentes.map((p) => h('button', { class: 'chip', type: 'button', onclick: () => { estado.digitado = p; consultar(p); }, text: p }))) : null);
  }
  function dicas() {
    const d = (i, t, s) => h('div', { class: 'passo-dica' }, h('div', { class: 'bola' }, ic(i)), h('div', null, h('b', { text: t }), h('span', { text: s })));
    return h('div', { class: 'passos' }, d('busca', 'Digite o pedido', 'Só o número, sem pontos.'), d('conferencia', 'Veja cada etapa', 'Com data e hora, quando o sistema registrou.'), d('raio', 'Precisa de pressa?', 'Peça prioridade e acompanhe a resposta.'));
  }

  function cartaoResultado(r) {
    const d = r.detalhes || {}, et = r.etapas || [], nv = r.resumo.nivel;
    const atual = et.find((e) => e.estado === 'atual');
    const quando = (e) => (e.estado === 'feita' ? (e.quando ? (e.soData ? C.dataBR(e.quando) : C.dataHora(e.quando)) : 'Horário não registrado') : e.estado === 'atual' ? (e.quando ? (e.nota || 'Desde') + ' ' + C.dataHora(e.quando) : e.nota || 'Etapa atual') : 'Ainda não aconteceu');
    const velha = idadeBaseH() > LIMITE_BASE_VELHA_H;
    const anima = estado.animouRes !== r.pedido; estado.animouRes = r.pedido; // a entrada animada só toca quando chega um pedido novo, não a cada atualização
    const feitas = et.filter((e) => e.estado === 'feita').length, iAtual = et.findIndex((e) => e.estado === 'atual');
    const fracao = et.length > 1 ? (iAtual >= 0 ? iAtual : et.length - 1) / (et.length - 1) : 0;
    const orbe = (e) => (e.estado === 'feita' ? ic('ok') : ic(C.ICONE_ETAPA[e.cod] || 'pacote'));
    return h('div', { class: anima ? 'anima-res' : '', style: 'display:flex;flex-direction:column;gap:18px' },
      h('section', { class: 'card res-card nv-' + nv, 'aria-label': 'Pedido ' + r.pedido },
        h('div', { class: 'res-faixa' }, h('div', null, h('p', { class: 'res-numero', text: 'Pedido' }), h('h2', { class: 'num', text: r.pedido })), C.selo(rotuloResumo(r), nv)),
        h('div', { class: 'res-corpo' },
          h('div', { class: 'status-destaque' }, h('div', { class: 'bola' }, ic(iconeResumo(r))),
            h('div', null, h('b', { text: r.resumo.texto }), atual && r.paradoDesde && nv !== 'concluido' ? h('span', { text: 'Nesta etapa há cerca de ' + C.duracao(r.paradoDesde) + '.' }) : null)),
          et.length ? h('div', { class: 'trilha-bloco' }, h('div', { class: 'trilha', style: '--p:' + fracao.toFixed(3), 'aria-hidden': 'true' }, h('div', { class: 'fio' }), et.map((e) => h('div', { class: 'orbe ' + e.estado }, orbe(e)))),
            h('div', { class: 'trilha-leg' }, h('span', { text: 'Etapas do pedido' }), h('span', { text: feitas + ' de ' + et.length + ' concluídas' }))) : null,
          h('div', { class: 'fatos' }, C.fato('predio', 'Filial', d.armazem), C.fato('pacote', 'Itens', (d.pecas ? d.pecas + (d.pecas === 1 ? ' peça' : ' peças') : '') + (d.linhas ? ' · ' + d.linhas + (d.linhas === 1 ? ' item' : ' itens') : '')), C.fato('calendario', 'Liberado em', d.liberadoEm ? C.dataHora(d.liberadoEm) : ''), C.fato('caminhao', 'Transportadora', d.transportadora),
            C.fato('pessoa', 'Cliente', d.cliente), C.fato('nota', 'Nota fiscal', d.nf || 'ainda não emitida'), C.fato('relogio', 'Dias desde a liberação', d.diasDesdeLiberacao != null ? String(d.diasDesdeLiberacao) : ''), C.fato('okCirculo', 'Despachado em', d.despachadoEm ? C.dataBR(d.despachadoEm) : 'ainda não')),
          r.ocorrencia ? h('div', { class: 'ocorrencia', role: 'note' }, ic('alerta'), h('div', null, h('b', { text: 'Ocorrência da expedição: ' + r.ocorrencia.status + (r.ocorrencia.tipoTexto ? ' · ' + r.ocorrencia.tipoTexto : '') }), r.ocorrencia.quem && !r.ocorrencia.resolvida ? h('span', { style: 'display:block', text: r.ocorrencia.quem }) : null, r.ocorrencia.detalhes ? h('span', { text: r.ocorrencia.detalhes }) : null, r.ocorrencia.solucao ? h('span', { style: 'display:block;margin-top:4px', text: 'Solução: ' + r.ocorrencia.solucao + (r.ocorrencia.dataSolucao ? ' (' + C.dataBR(r.ocorrencia.dataSolucao + 'T12:00:00Z') + ')' : '') }) : null)) : null,
          h('div', { class: 'acoes' },
            nv !== 'concluido' ? h('button', { class: 'btn peq primario', type: 'button', onclick: () => irParaPrioridade(r.pedido, r) }, ic('raio'), 'Pedir prioridade') : null,
            h('button', { class: 'btn peq', type: 'button', onclick: () => irParaAviso(r.pedido, r) }, ic('comentario'), 'Avisar a expedição'),
            r.achado && nv !== 'concluido' ? (seguindoPedido(r.pedido) ? h('button', { class: 'btn peq seguindo', type: 'button', onclick: () => { pararDeSeguir(r.pedido); C.toast('Você parou de acompanhar este pedido.'); desenhar(); } }, ic('ok'), 'Acompanhando (parar)') : h('button', { class: 'btn peq', type: 'button', onclick: () => { seguir(r); C.toast('Pronto. Você vê o que mudou em Acompanhar e em Minhas.'); desenhar(); } }, ic('sino'), 'Acompanhar este pedido')) : null,
            h('button', { class: 'btn peq', type: 'button', onclick: () => C.copiar(textoParaCopiar(r), 'Status copiado. É só colar no WhatsApp.') }, ic('copiar'), 'Copiar status'),
            h('button', { class: 'btn peq', type: 'button', onclick: () => { const u = new URL(root.location.href); u.searchParams.set('pedido', r.pedido); C.copiar(u.toString(), 'Link copiado.'); } }, ic('link'), 'Copiar link do pedido')))),
      r.mensagemCliente ? h('section', { class: 'card msg-card', 'aria-label': 'Mensagem para a cliente' }, h('h3', null, ic('comentario'), 'Mensagem para a cliente'), h('p', { class: 'dica', text: 'Texto pronto para colar no WhatsApp. Você pode mudar antes de enviar.' }), h('p', { class: 'balao', text: r.mensagemCliente }),
        h('button', { class: 'btn primario', type: 'button', onclick: () => C.copiar(r.mensagemCliente, 'Mensagem para a cliente copiada. É só colar no WhatsApp.') }, ic('copiar'), 'Copiar mensagem para a cliente')) : null,
      h('section', { class: 'card nv-' + nv, 'aria-label': 'Andamento do pedido ' + r.pedido },
        h('div', { class: 'card-titulo' }, h('h3', { text: 'Andamento do pedido' }), h('span', { class: 'mudo peq', text: feitas + ' de ' + et.length + ' etapas concluídas' })),
        h('ol', { class: 'tempo' }, et.map((e, i) => h('li', { class: e.estado, style: '--i:' + i, 'aria-current': e.estado === 'atual' ? 'step' : null },
          h('div', { class: 'marco orbe ' + e.estado }, orbe(e)),
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
    if (modo === 'avisar') itens.push(h('li', null, h('b', { text: 'O aviso vai para a equipe da expedição, que trata e responde: não é na hora. ' }), 'Acompanhe em "Minhas solicitações" → "Avisos à expedição". Não precisa mandar de novo nem cobrar por mensagem.'));
    if (modo === 'prioridade' || modo === 'minhas') itens.push(h('li', null, h('b', { text: 'A análise é feita pela equipe do SC9, não é na hora. ' }), 'Depois de enviar, aguarde a resposta aqui em "Minhas solicitações". Não precisa mandar de novo nem cobrar por mensagem.'));
    if (compacta) return h('div', { class: 'processo compacta', role: 'note' }, ic('info'), h('p', null, h('b', { text: modo === 'rastrear' ? 'Andamento do SC9. ' : 'Aguarde a análise do SC9. ' }), base));
    if (modo === 'rastrear') return h('section', { class: 'processo compacta', role: 'note', 'aria-label': 'Como funciona o acompanhamento', style: 'flex-wrap:wrap' }, ic('info'), h('p', { style: 'flex:1 1 220px' }, h('b', { text: 'Atualizado às ' + (estado.atualizadoEm ? C.horaBR(estado.atualizadoEm) : '—') + '. ' }), 'Pedido novo pode levar algumas horas para aparecer.'),
      h('details', { style: 'flex:1 0 100%' }, h('summary', { class: 'resumo-como', text: 'Como funciona' }), h('ul', { style: 'margin:6px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:6px;font-size:14px;line-height:1.45' }, itens)));
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
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) c.erro = 'Informe seu e-mail corporativo da Implacil (ex.: nome@implacil.com.br).';
      else if (!/(^|\.)implacil[a-z0-9-]*\.(com\.br|com|ind\.br|net\.br|net|br)$/.test(c.email.trim().toLowerCase().split('@')[1])) c.erro = 'Só e-mail corporativo da Implacil libera o acesso (o endereço precisa ter "implacil", ex.: nome@implacil.com.br).';
      else if (c.codigo !== c.codigo2) c.erro = 'Os dois códigos não são iguais.';
    }
    if (c.erro) return desenhar();
    c.enviando = true; desenhar();
    try {
      const corpo = modo === 'criar' ? { acao: 'criar', nome: c.nome, email: c.email, login: c.login, codigo: c.codigo, ids: lerLS(LS.meus, []), idsAvisos: lerLS(LS.avisos, []), idsSolic: lerLS('sc9v_solic', []) } : { acao: 'entrar', login: c.login, codigo: c.codigo, ids: lerLS(LS.meus, []), idsAvisos: lerLS(LS.avisos, []), idsSolic: lerLS('sc9v_solic', []) };
      const j = await api('/api/vendedoras/conta', { method: 'POST', body: JSON.stringify(corpo) });
      salvarSessao(j); c.codigo = ''; c.codigo2 = ''; C.toast(modo === 'criar' ? 'Acesso criado. Você já está dentro.' : 'Bem-vinda, ' + j.conta.nome + '.');
      estado.tela = 'minhas'; estado.visao = 'minhas'; carregarPrioridades(true); carregarAvisos(true); if (root.SolicitacoesVend) root.SolicitacoesVend.carregar(true);
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
    const c = estado.cf, cab = C.cabecalho(estado.conta ? 'usuarioCheck' : 'usuario', estado.conta ? 'Seu acesso' : 'Criar acesso ou entrar', 'Opcional. Sem acesso tudo continua funcionando; com ele, suas solicitações ficam ligadas ao seu login e aparecem em qualquer aparelho.');
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
        criar ? campoTexto('c-email', 'E-mail corporativo da Implacil', 'email', c, { type: 'email', autocomplete: 'email', maxlength: '120', autocapitalize: 'none', placeholder: 'Ex.: ana@implacil.com.br' }) : null,
        criar ? h('div', { class: 'aviso', role: 'note' }, ic('alerta'), h('div', null, h('b', { text: 'Use o seu próprio e-mail corporativo da Implacil. ' }), 'O acesso é liberado na hora, mas tudo o que você pedir, avisar ou consultar fica registrado com o seu e-mail e o seu nome, e a equipe pode ver. Não use o e-mail de outra pessoa. Sem login você continua consultando e avisando pelo link.')) : null,
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
    minhas: () => C.baixarCsv(C.nomeArquivo('minhas-solicitacoes'), ['Protocolo', 'Pedido', 'Prioridade', 'Motivo', 'Status', 'Pedida em', 'Atualizada em', 'Observação', 'Resposta da logística', 'No SC9 agora?', 'Histórico'],
      ((estado.prio && estado.prio.meus) || []).map((l) => [l.protocolo, l.pedido, C.NIVEL[l.nivel], C.MOTIVO[l.motivo] || '', C.STATUS[l.status], C.dataHoraCsv(l.criadoEm), C.dataHoraCsv(l.atualizadoEm), l.observacao, l.resposta, ['recebida', 'em_analise', 'aprovada', 'em_atendimento'].includes(l.status) ? (l.foraDoSc9 ? 'Não' : 'Sim') : '', historicoTexto(l)])),
    avisos: () => C.baixarCsv(C.nomeArquivo('meus-avisos-a-expedicao'), ['Protocolo', 'Pedido', 'Tipo', 'O que informei', 'Status', 'Resposta da expedição', 'Enviado em', 'Atualizado em', 'No SC9 agora?', 'Histórico'],
      ((estado.avisos && estado.avisos.meus) || []).map((l) => [l.protocolo, l.pedido, C.TIPO_AVISO[l.tipo], l.texto, C.STATUS_AVISO[l.status], l.resposta, C.dataHoraCsv(l.criadoEm), C.dataHoraCsv(l.atualizadoEm), l.status === 'resolvido' ? '' : (l.foraDoSc9 ? 'Não' : 'Sim'), (l.historico || []).map((x) => C.dataHoraCsv(x.em) + ' - ' + (x.status ? C.STATUS_AVISO[x.status] || x.status : 'Atualização') + (x.texto ? ' - ' + x.texto : '')).join(' | ')])),
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
    if (!estado.avisos && !estado.avisosErro) carregarAvisos(true);
    if (estado.conta && !estado.consultasServ && !estado.consultasErro) carregarConsultas();
    return [C.cabecalho('baixar', 'Exportar', 'Baixe só o que é seu em planilha (CSV). Abre direto no Excel.'),
      estado.prioErro || estado.consultasErro ? h('div', { class: 'erro' }, ic('alerta'), estado.prioErro || estado.consultasErro) : null,
      cartao('lista', 'Minhas solicitações', 'Protocolo, prioridade, motivo, status, resposta da logística e histórico de cada pedido de prioridade.', meus.length, 'minhas', Boolean(estado.prio)),
      cartao('comentario', 'Meus avisos à expedição', 'Cada aviso que você mandou para a expedição, com o que informou, a resposta da equipe e o histórico.', ((estado.avisos && estado.avisos.meus) || []).length, 'avisos', Boolean(estado.avisos)),
      cartao('busca', 'Pedidos que consultei', estado.conta ? 'Cada pedido que você consultou logada, com data, hora e a situação que aparecia na hora. Vem do seu login, de qualquer aparelho.' : 'Cada pedido que você consultou, com data, hora e a situação que aparecia na hora. Fica guardado só neste aparelho; com acesso criado, passa a valer em qualquer aparelho.', consultas.length, 'consultas', !estado.conta || Boolean(estado.consultasServ)),
      h('p', { class: 'dica', text: estado.conta ? 'Suas solicitações vêm do seu login, de qualquer aparelho.' : 'Sem acesso criado, "Minhas solicitações" e "Pedidos que consultei" são só deste aparelho. Crie seu acesso para ter as solicitações em qualquer lugar.' }),
      !estado.conta ? h('div', { class: 'acoes' }, h('button', { class: 'btn peq', type: 'button', onclick: () => { estado.tela = 'conta'; desenhar(); root.scrollTo(0, 0); } }, ic('usuario'), 'Criar meu acesso')) : null];
  }

  function telaRastrear() {
    const blocos = [];
    const temResultado = estado.carregando || estado.consulta || estado.varios || estado.erro;
    blocos.push(faixaProcesso('rastrear', Boolean(temResultado && !estado.erro)));
    blocos.push(temResultado ? h('section', { class: 'card' }, formBusca(true)) : formBusca(false));
    if (estado.carregando) blocos.push(h('p', { class: 'buscando' }, 'Buscando o andamento do pedido…'), C.esqueleto(3));
    else if (estado.erro) blocos.push(h('div', { class: 'erro erro-bloco', role: 'alert' }, h('div', { class: 'linha-erro' }, ic('alerta'), estado.erro), soNumeros(estado.digitado).length >= 4 ? h('button', { class: 'btn peq', type: 'button', onclick: () => consultar(estado.digitado) }, ic('atualizar'), 'Tentar de novo') : null));
    else if (estado.varios) blocos.push(h('section', { class: 'card' }, h('div', { class: 'card-titulo' }, h('h2', { text: 'Seus pedidos' }), h('span', { class: 'mudo peq', text: estado.varios.length + ' consultados' })),
      estado.varios.map((r) => h('button', { class: 'cartao-lista ' + (r.achado ? (r.resumo.nivel === 'atraso' ? 'nv-urgente' : r.resumo.nivel === 'andamento' ? 'nv-media' : 'st-resolvido') : 'nv-alta') + (r.achado ? ' ' + tomDe(r) : ''), type: 'button', disabled: !r.achado, onclick: () => { estado.digitado = r.pedido; consultar(r.pedido); } },
        h('div', { class: 'l1' }, h('b', { class: 'num', text: 'Pedido ' + r.pedido }), r.achado ? C.selo(rotuloResumo(r), r.resumo.nivel) : C.selo('Fora do SC9', 'alta')),
        h('div', { class: 'l2' }, h('span', { text: r.achado ? r.resumo.texto : (r.erro || 'Ainda não está no SC9. Se o número está certo, peça prioridade: a equipe é avisada para recarregar.') })), r.achado ? h('div', { style: 'margin-top:10px' }, miniProgresso(r)) : null))));
    else if (estado.consulta && estado.consulta.achado) blocos.push(cartaoResultado(estado.consulta));
    else if (estado.consulta) blocos.push(h('section', { class: 'card' }, C.vazio('atualizar', 'O pedido ' + estado.consulta.pedido + ' ainda não está no SC9', 'Confira o número. Se o pedido é de hoje, ele pode ainda não ter chegado: a base só atualiza a cada carga do SC9. Se o número está certo, peça prioridade mesmo assim: a equipe é avisada para recarregar o SC9.' + (estado.consulta.atualizadoEm ? ' Última atualização: ' + C.dataHora(estado.consulta.atualizadoEm) + '.' : '')),
      h('div', { class: 'acoes', style: 'justify-content:center' }, h('button', { class: 'btn peq primario', type: 'button', onclick: () => { estado.consulta = null; estado.digitado = ''; desenhar(); const e = root.document.getElementById('q-pedido'); if (e) e.focus(); } }, ic('busca'), 'Digitar outro número'), h('button', { class: 'btn peq', type: 'button', onclick: () => consultar(estado.digitado) }, ic('atualizar'), 'Tentar de novo'), h('button', { class: 'btn peq', type: 'button', onclick: () => irParaAviso(estado.consulta.pedido) }, ic('comentario'), 'Avisar a expedição'), h('button', { class: 'btn peq', type: 'button', onclick: () => irParaPrioridade(estado.consulta.pedido) }, ic('raio'), 'Pedir prioridade mesmo assim'))));
    else { if (estado.seguindo.length) blocos.push(cartaoSeguindo()); blocos.push(dicas()); }
    return blocos;
  }

  /* ---------- solicitar prioridade ---------- */
  // com o pedido que ela acabou de consultar, o formulário já abre com ele localizado (sem digitar e buscar de novo)
  function irParaPrioridade(pedido, previa) { const f = estado.f; if (pedido && soNumeros(pedido) !== soNumeros(f.pedido)) { f.pedido = pedido; f.previa = previa && previa.achado && previa.resumo.nivel !== 'concluido' ? previa : null; f.etapa = 'form'; } else if (previa && !f.previa && previa.achado && previa.resumo.nivel !== 'concluido') f.previa = previa; f.erro = ''; if (f.etapa === 'enviada') f.etapa = 'form'; estado.tela = 'prioridade'; desenhar(); root.scrollTo(0, 0); }
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
    if (!f.previa || soNumeros(f.previa.pedido) !== soNumeros(f.pedido)) f.erro = 'Toque em "Localizar pedido" antes de continuar.';
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
      if (f.previa && f.previa.achado) seguir(f.previa); // quem pediu prioridade passa a acompanhar o pedido
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
    if (!r.achado) return h('div', { class: 'aviso' }, ic('alerta'), h('div', null, h('b', { text: 'O pedido ' + r.pedido + ' ainda não está no SC9. ' }), 'Ele (a base só atualiza a cada carga). Se o número está certo, você pode enviar a solicitação mesmo assim: a equipe é avisada para recarregar o SC9 e mostrar as informações.'));
    return h('div', { class: 'previa', role: 'group', 'aria-label': 'Dados do pedido ' + r.pedido },
      r.resumo.nivel === 'pronto' ? h('div', { class: 'aviso', style: 'margin-bottom:10px' }, ic('caminhao'), h('div', null, h('b', { text: 'Este pedido já está pronto para despacho. ' }), 'Ele sai na coleta (após as 18h). Peça prioridade só se ele precisa sair antes.')) : null,
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
        f.enviada.naoAchado ? h('div', { class: 'aviso', style: 'width:100%' }, ic('atualizar'), h('div', null, h('b', { text: 'Este pedido ainda não está no SC9. ' }), 'A equipe foi avisada para recarregar o SC9. Assim que ele entrar, o andamento aparece em "Acompanhar pedidos". Se o número estava errado, fale com a expedição.')) : null,
        h('div', { class: 'acoes', style: 'justify-content:center' }, h('button', { class: 'btn primario', type: 'button', onclick: () => { estado.tela = 'minhas'; estado.visao = 'minhas'; desenhar(); root.scrollTo(0, 0); } }, ic('lista'), 'Ver minhas solicitações'), h('button', { class: 'btn', type: 'button', onclick: () => { f.etapa = 'form'; f.enviada = null; desenhar(); } }, 'Nova solicitação'))))];
    }
    const cab = h('div', { style: 'display:flex;flex-direction:column;gap:14px' }, C.cabecalho('raio', 'Precisa de prioridade no pedido?', 'Informe o pedido, explique a necessidade e acompanhe a análise da logística.'), faixaProcesso('prioridade'));
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

  /* ---------- avisar a expedição (ocorrência / informação sobre um pedido) ---------- */
  function irParaAviso(pedido, previa) { const a = estado.a; if (pedido && soNumeros(pedido) !== soNumeros(a.pedido)) { a.pedido = pedido; a.previa = previa && previa.achado ? previa : null; } else if (previa && !a.previa && previa.achado) a.previa = previa; a.erro = ''; a.enviado = null; estado.tela = 'avisar'; desenhar(); root.scrollTo(0, 0); }
  async function localizarA() {
    const a = estado.a; a.erro = '';
    const p = soNumeros(a.pedido);
    if (p.length < 4) { a.erro = 'Digite o número do pedido (só números).'; return desenhar(); }
    a.buscando = true; desenhar();
    try { const r = await api('/api/vendedoras/pedido?pedido=' + p); estado.atualizadoEm = r.atualizadoEm || estado.atualizadoEm; a.previa = r; } catch (e) { a.erro = e.message; a.previa = null; }
    a.buscando = false; desenhar();
  }
  async function enviarA() {
    const a = estado.a; a.erro = '';
    if (soNumeros(a.pedido).length < 4) a.erro = 'Digite o número do pedido (só números).';
    else if (!a.tipo) a.erro = 'Escolha o tipo de aviso.';
    else if (a.texto.trim().length < 5) a.erro = 'Escreva a informação para a expedição (mínimo 5 letras).';
    else if (!estado.conta && a.nome.trim().length < 2) a.erro = 'Diga seu nome para a equipe saber quem avisou.';
    if (a.erro) return desenhar();
    a.enviando = true; desenhar();
    try {
      const j = await api('/api/vendedoras/aviso', { method: 'POST', body: JSON.stringify({ pedido: soNumeros(a.pedido), tipo: a.tipo, texto: a.texto, pedidoPor: estado.conta ? estado.conta.nome : a.nome }) });
      if (!estado.conta) gravarLS(LS.nome, a.nome.trim());
      gravarLS(LS.avisos, [j.linha.id].concat(lerLS(LS.avisos, []).filter((x) => x !== j.linha.id)).slice(0, 60));
      a.enviado = { linha: j.linha, naoAchado: j.naoAchado }; a.pedido = ''; a.texto = ''; a.tipo = ''; a.previa = null;
      C.toast('Aviso enviado para a expedição.'); carregarAvisos(true);
    } catch (e) { a.erro = e.message; }
    a.enviando = false; desenhar();
  }
  function telaAvisar() {
    const a = estado.a;
    if (a.enviado) {
      const l = a.enviado.linha;
      return [h('section', { class: 'card' }, h('div', { class: 'protocolo-ok' }, h('div', { class: 'selo-ok' }, ic('ok')), h('h2', { text: 'Aviso enviado para a expedição' }),
        h('div', { class: 'codigo', text: l.protocolo || '' }),
        h('div', { class: 'resumo-lista' }, [['Pedido', l.pedido], ['Tipo', C.TIPO_AVISO[l.tipo]], ['Enviado em', C.dataHora(l.criadoEm)], ['Status', C.STATUS_AVISO[l.status]]].map(([t, v]) => h('div', null, h('span', { text: t }), h('b', { text: v })))),
        h('div', { class: 'processo compacta forte', role: 'status' }, ic('relogio'), h('p', null, h('b', { text: 'Agora é só aguardar. ' }), 'A equipe da expedição vai ver, tratar e responder. A resposta aparece em "Minhas solicitações" → "Avisos à expedição".')),
        a.enviado.naoAchado ? h('div', { class: 'aviso', style: 'width:100%' }, ic('atualizar'), h('div', null, h('b', { text: 'Este pedido ainda não está no SC9. ' }), 'A equipe também foi avisada para recarregar o SC9. Se o número estava errado, fale com a expedição.')) : null,
        h('div', { class: 'acoes', style: 'justify-content:center' }, h('button', { class: 'btn primario', type: 'button', onclick: () => { estado.tela = 'minhas'; estado.sub = 'avisos'; desenhar(); root.scrollTo(0, 0); } }, ic('lista'), 'Ver meus avisos'), h('button', { class: 'btn', type: 'button', onclick: () => { a.enviado = null; desenhar(); } }, 'Novo aviso'))))];
    }
    const cab = h('div', { style: 'display:flex;flex-direction:column;gap:14px' }, C.cabecalho('comentario', 'Avisar a expedição', 'Tem uma informação ou ocorrência sobre um pedido (endereço, retirada, transportadora...)? Conte aqui para a equipe tratar.'), faixaProcesso('avisar'));
    return [cab, h('section', { class: 'card' }, h('form', { class: 'form', onsubmit: (ev) => { ev.preventDefault(); enviarA(); } },
      h('div', null, h('label', { class: 'rotulo', for: 'a-pedido', text: '1. Número do pedido' }),
        h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, h('input', { id: 'a-pedido', class: 'entrada', style: 'flex:1 1 200px', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'Ex.: 123456', value: a.pedido, oninput: (ev) => { a.pedido = ev.target.value; if (a.previa && soNumeros(a.previa.pedido) !== soNumeros(a.pedido)) a.previa = null; } }),
          h('button', { class: 'btn', type: 'button', disabled: a.buscando, onclick: localizarA }, ic('busca'), a.buscando ? 'Localizando…' : 'Conferir pedido'))),
      a.previa ? previaPedido(a.previa) : null,
      h('div', null, h('label', { class: 'rotulo', for: 'a-tipo', text: '2. Tipo de aviso' }), h('select', { id: 'a-tipo', class: 'entrada', onchange: (ev) => { a.tipo = ev.target.value; } }, h('option', { value: '', text: 'Escolha o tipo', selected: !a.tipo }), Object.keys(C.TIPO_AVISO).map((k) => h('option', { value: k, text: C.TIPO_AVISO[k], selected: a.tipo === k })))),
      h('div', null, h('label', { class: 'rotulo', for: 'a-texto', text: '3. O que a expedição precisa saber' }), h('textarea', { id: 'a-texto', class: 'entrada', maxlength: '500', rows: '4', placeholder: 'Ex.: o cliente mudou o endereço de entrega para Rua X, 100, Santo André. Já avisei o cliente.', oninput: (ev) => { a.texto = ev.target.value; } }, a.texto), h('p', { class: 'dica', text: 'Escreva tudo que a equipe precisa para agir, sem depender de outra mensagem.' })),
      estado.conta ? h('div', null, h('span', { class: 'rotulo', text: 'Quem avisa' }), h('div', { class: 'previa', style: 'display:flex;align-items:center;gap:8px' }, ic('usuarioCheck'), h('b', { text: estado.conta.nome }), h('span', { class: 'mudo peq', text: 'login ' + estado.conta.login })))
        : h('div', null, h('label', { class: 'rotulo', for: 'a-nome', text: 'Seu nome' }), h('input', { id: 'a-nome', class: 'entrada', type: 'text', autocomplete: 'name', maxlength: '60', placeholder: 'Ex.: Ana (Vendas)', value: a.nome, oninput: (ev) => { a.nome = ev.target.value; } })),
      h('button', { class: 'btn primario', type: 'submit', disabled: a.enviando }, ic('enviar'), a.enviando ? 'Enviando…' : 'Enviar aviso'),
      a.erro ? h('div', { class: 'erro', role: 'alert' }, ic('alerta'), a.erro) : null))];
  }
  async function carregarAvisos(silencioso) {
    try { estado.avisos = await api('/api/vendedoras/avisos?ids=' + encodeURIComponent(lerLS(LS.avisos, []).join(',')) + '&nome=' + encodeURIComponent((estado.conta && estado.conta.nome) || lerLS(LS.nome, ''))); estado.avisosErro = ''; } catch (e) { estado.avisosErro = e.message; }
    if (!silencioso || ['minhas', 'exportar'].includes(estado.tela)) desenhar();
  }
  const cartaoAviso = (l) => h('button', { class: 'cartao-lista st-' + l.status, type: 'button', onclick: () => { estado.abertoAviso = l.id; desenhar(); } },
    h('div', { class: 'l1' }, h('b', { class: 'num', text: 'Pedido ' + l.pedido }), C.selo(C.TIPO_AVISO[l.tipo], 'normal', true), C.selo(C.STATUS_AVISO[l.status], l.status), h('span', { class: 'mudo peq', style: 'margin-left:auto', text: l.protocolo || '' })),
    h('div', { class: 'l2' }, h('span', { text: 'Enviado em ' + C.dataHora(l.criadoEm) }), h('span', { text: 'Atualizado há ' + C.duracao(l.atualizadoEm || l.criadoEm) }), l.resposta ? h('span', { style: 'color:var(--tinta-2)', text: 'Expedição: ' + l.resposta }) : null,
      l.foraDoSc9 ? h('span', { class: 'aguarde', text: 'Este pedido ainda não está no SC9: a equipe foi avisada para recarregar.' }) : null, l.status === 'recebido' ? h('span', { class: 'aguarde', text: 'Aguarde: a expedição ainda vai ver este aviso.' }) : null));
  function gavetaAviso(l) {
    const fecha = () => { estado.abertoAviso = null; estado.gavAnim = null; desenhar(); };
    const abre = estado.gavAnim !== l.id ? ' abre' : ''; estado.gavAnim = l.id;
    return [h('div', { class: 'gaveta-fundo' + abre, onclick: fecha }),
      h('aside', { class: 'gaveta' + abre, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Aviso ' + (l.protocolo || l.pedido) },
        h('div', { class: 'gaveta-cab' }, h('div', null, h('p', { class: 'mudo peq', text: l.protocolo || 'Aviso' }), h('h3', { class: 'num', text: 'Pedido ' + l.pedido }), h('div', { style: 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap' }, C.selo(C.TIPO_AVISO[l.tipo], 'normal', true), C.selo(C.STATUS_AVISO[l.status], l.status))), h('button', { class: 'btn peq fantasma', type: 'button', 'aria-label': 'Fechar', onclick: fecha }, ic('fechar'))),
        h('div', { class: 'gaveta-corpo' },
          l.foraDoSc9 ? h('div', { class: 'aviso' }, ic('atualizar'), h('div', null, h('b', { text: 'Este pedido ainda não está no SC9. ' }), 'A equipe foi avisada para recarregar o SC9.')) : null,
          h('div', { class: 'resumo-lista', style: 'margin-top:0' }, [['O que você informou', l.texto], ['Enviado em', C.dataHora(l.criadoEm)], ['Última atualização', C.dataHora(l.atualizadoEm)]].map(([t, v]) => h('div', null, h('span', { text: t }), h('b', { text: v || '—' })))),
          l.resposta ? h('div', { class: 'ok', style: 'background:var(--azul-claro);border-color:var(--azul-borda);color:var(--azul-escuro)' }, ic('comentario'), h('div', null, h('b', { style: 'display:block', text: 'Resposta da expedição' }), l.resposta)) : null,
          h('div', null, h('p', { class: 'bloco-titulo', text: 'Histórico' }), h('ol', { class: 'hist', 'aria-label': 'Histórico do aviso' }, (l.historico || []).slice().reverse().map((x) => h('li', null, h('span', { class: 'hora', text: C.dataHora(x.em) }), ' ', h('b', { text: x.status ? C.STATUS_AVISO[x.status] || x.status : '' }), x.texto ? (x.status ? ' · ' : '') + x.texto : ''))))))];
  }
  const abasMinhas = () => h('div', { class: 'abas-pequenas abas-3', role: 'group', 'aria-label': 'O que mostrar' },
    h('button', { type: 'button', 'aria-pressed': String(estado.sub === 'prioridades'), onclick: () => { estado.sub = 'prioridades'; desenhar(); }, text: 'Prioridades' }), h('button', { type: 'button', 'aria-pressed': String(estado.sub === 'avisos'), onclick: () => { estado.sub = 'avisos'; carregarAvisos(true); desenhar(); }, text: 'Avisos à expedição' }), h('button', { type: 'button', 'aria-pressed': String(estado.sub === 'acompanho'), onclick: () => { estado.sub = 'acompanho'; carregarSeguindo(true); desenhar(); }, text: 'Acompanho' + (estado.seguindo.length ? ' (' + estado.seguindo.length + ')' : '') }));
  function corpoAvisos() {
    const meus = (estado.avisos && estado.avisos.meus) || [], blocos = [];
    if (estado.avisosErro) blocos.push(h('div', { class: 'erro' }, ic('alerta'), estado.avisosErro));
    if (!estado.avisos && !estado.avisosErro) blocos.push(C.esqueleto(2));
    else if (estado.avisos) blocos.push(h('section', { class: 'card', 'aria-label': 'Avisos à expedição' }, meus.length ? [meus.map(cartaoAviso), h('p', { class: 'dica', style: 'margin-top:12px', text: (estado.conta ? 'Avisos do seu login, em qualquer aparelho.' : 'Estes avisos são deste aparelho. Crie seu acesso para vê-los em qualquer aparelho.') + ' Atualiza sozinho a cada minuto.' })]
      : [C.vazio('comentario', 'Nenhum aviso ainda', 'Quando você avisar a expedição sobre um pedido, ele aparece aqui com a resposta da equipe.'), h('div', { class: 'acoes', style: 'justify-content:center' }, h('button', { class: 'btn primario peq', type: 'button', onclick: () => irParaAviso('') }, ic('comentario'), 'Avisar a expedição'))]));
    const aberto = estado.abertoAviso && meus.find((x) => x.id === estado.abertoAviso);
    if (aberto) blocos.push(...gavetaAviso(aberto));
    return blocos;
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
  const cartaoSolicitacao = (l) => h('button', { class: 'cartao-lista nv-' + l.nivel, type: 'button', onclick: () => { estado.aberta = l.id; desenhar(); } },
    h('div', { class: 'l1' }, h('b', { class: 'num', text: 'Pedido ' + l.pedido }), C.selo(C.NIVEL[l.nivel], l.nivel), C.selo(C.STATUS[l.status], l.status), l.reforco ? C.selo('Você reforçou', 'normal', true) : null, h('span', { class: 'mudo peq', style: 'margin-left:auto', text: l.protocolo || '' })),
    h('div', { class: 'l2' }, h('span', { text: 'Pedida em ' + C.dataHora(l.criadoEm) }), h('span', { text: 'Atualizada há ' + C.duracao(l.atualizadoEm || l.criadoEm) }), l.resposta ? h('span', { style: 'color:var(--tinta-2)', text: 'Equipe: ' + l.resposta }) : null, l.foraDoSc9 ? h('span', { class: 'aguarde', text: 'Este pedido ainda não está no SC9: a equipe foi avisada para recarregar.' }) : null, ['recebida', 'em_analise'].includes(l.status) ? h('span', { class: 'aguarde', text: 'Aguarde: a equipe do SC9 ainda vai analisar.' }) : null));
  function gavetaSolicitacao(l) {
    const fecha = () => { estado.aberta = null; estado.gavAnim = null; desenhar(); };
    const abre = estado.gavAnim !== l.id ? ' abre' : ''; estado.gavAnim = l.id;
    return [h('div', { class: 'gaveta-fundo' + abre, onclick: fecha }),
      h('aside', { class: 'gaveta' + abre, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Solicitação ' + (l.protocolo || l.pedido) },
        h('div', { class: 'gaveta-cab' }, h('div', null, h('p', { class: 'mudo peq', text: l.protocolo || 'Solicitação' }), h('h3', { class: 'num', text: 'Pedido ' + l.pedido }), h('div', { style: 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap' }, C.selo(C.NIVEL[l.nivel], l.nivel), C.selo(C.STATUS[l.status], l.status))), h('button', { class: 'btn peq fantasma', type: 'button', 'aria-label': 'Fechar', onclick: fecha }, ic('fechar'))),
        h('div', { class: 'gaveta-corpo' },
          l.foraDoSc9 ? h('div', { class: 'aviso' }, ic('atualizar'), h('div', null, h('b', { text: 'Este pedido ainda não está no SC9. ' }), 'A equipe foi avisada para recarregar o SC9. Quando ele entrar, o andamento aparece em "Acompanhar pedidos".')) : null,
          h('div', { class: 'resumo-lista', style: 'margin-top:0' }, [['Motivo', C.MOTIVO[l.motivo] || '—'], ['Pedida em', C.dataHora(l.criadoEm)], ['Observação', l.observacao || '—'], ['Última atualização', C.dataHora(l.atualizadoEm)]].map(([t, v]) => h('div', null, h('span', { text: t }), h('b', { text: v })))),
          l.resposta ? h('div', { class: 'ok', style: 'background:var(--azul-claro);border-color:var(--azul-borda);color:var(--azul-escuro)' }, ic('comentario'), h('div', null, h('b', { style: 'display:block', text: 'Resposta da logística' }), l.resposta)) : null,
          h('div', null, h('p', { class: 'bloco-titulo', text: 'Histórico' }), h('ol', { class: 'hist', 'aria-label': 'Histórico da solicitação' }, (l.historico || []).slice().reverse().map((x) => h('li', null, h('span', { class: 'hora', text: C.dataHora(x.em) }), ' ', h('b', { text: x.status ? C.STATUS[x.status] || x.status : '' }), x.texto ? (x.status ? ' · ' : '') + x.texto : ''))))))];
  }
  function telaMinhas() {
    const meus = (estado.prio && estado.prio.meus) || [];
    const blocos = [faixaProcesso('minhas', true), C.cabecalho('lista', 'Minhas solicitações', 'Só o que é seu: acompanhe a análise da logística sem precisar mandar mensagem.')];
    blocos.push(abasMinhas());
    if (estado.sub === 'avisos') return blocos.concat(corpoAvisos());
    if (estado.sub === 'acompanho') return blocos.concat([cartaoSeguindo() || h('section', { class: 'card' }, C.vazio('relogio', 'Você ainda não acompanha nenhum pedido', 'Consulte um pedido e toque em "Acompanhar este pedido". Aqui aparece a situação de cada um e o que mudou desde a última vez.'))]);
    if (estado.prioErro) blocos.push(h('div', { class: 'erro' }, ic('alerta'), estado.prioErro));
    if (!estado.prio && !estado.prioErro) blocos.push(C.esqueleto(2));
    else if (estado.prio) blocos.push(h('section', { class: 'card', 'aria-label': 'Minhas solicitações' }, meus.length ? [meus.map(cartaoSolicitacao), h('p', { class: 'dica', style: 'margin-top:12px', text: estado.conta ? 'Lista do seu login, em qualquer aparelho. Atualiza sozinha a cada minuto.' : 'Esta lista é deste aparelho. Crie seu acesso para vê-la em qualquer aparelho. Atualiza sozinha a cada minuto.' })] : C.vazio('caixaEntrada', 'Nenhuma solicitação ainda', 'Quando você pedir prioridade em um pedido, ele aparece aqui com o protocolo e o andamento.')));
    const aberta = estado.aberta && meus.find((x) => x.id === estado.aberta);
    if (aberta) blocos.push(...gavetaSolicitacao(aberta));
    return blocos;
  }

  /* ---------- Central de solicitações (solicitacoes-vend.js): aba "Solicitar" ---------- */
  function telaSolicitar() {
    if (!root.SolicitacoesVend) return [h('div', { class: 'erro', role: 'alert' }, ic('alerta'), 'Não consegui carregar esta aba. Recarregue a página.')];
    root.SolicitacoesVend.ligar({ api, conta: () => estado.conta, redesenhar: desenhar });
    return root.SolicitacoesVend.tela();
  }

  /* ---------- tela ---------- */
  const NAV = [['rastrear', 'busca', 'Acompanhar pedidos', 'Acompanhar'], ['prioridade', 'raio', 'Solicitar prioridade', 'Prioridade'], ['avisar', 'comentario', 'Avisar a expedição', 'Avisar'], ['solicitar', 'enviar', 'Solicitar à logística', 'Solicitar'], ['minhas', 'lista', 'Minhas solicitações', 'Minhas'], ['exportar', 'baixar', 'Exportar', 'Exportar']];
  function desenhar() {
    const foco = root.document.activeElement && root.document.activeElement.id ? root.document.activeElement.id : '';
    const y = root.scrollY;
    const topo = h('header', { class: 'topo' }, h('div', { class: 'topo-in' }, C.marca('Acompanhamento de pedidos'),
      chaveLink ? h('nav', { class: 'nav', 'aria-label': 'Principal' }, NAV.map(([id, i, nome, curto]) => h('button', { type: 'button', 'aria-label': nome, 'aria-current': estado.tela === id ? 'page' : null, onclick: () => { estado.tela = id; estado.aberta = null; if ((id === 'minhas' || id === 'exportar') && !estado.prio) carregarPrioridades(); if (id === 'minhas' || id === 'exportar') carregarAvisos(true); desenhar(); root.scrollTo(0, 0); } }, ic(i), h('span', { class: 'longo', text: nome }), h('span', { class: 'curto', text: curto })))) : null,
      chaveLink ? h('div', { class: 'topo-lado' }, estado.atualizadoEm ? h('span', { class: 'atualizado' + (idadeBaseH() > LIMITE_BASE_VELHA_H ? ' velha' : ''), title: 'Base do SC9 atualizada em ' + C.dataHora(estado.atualizadoEm) }, h('i', { class: 'ponto' }), h('span', { class: 'rotulo-hora', text: 'Atualizado às ' }), C.horaBR(estado.atualizadoEm)) : null,
        h('button', { class: 'btn peq conta-botao' + (estado.tela === 'conta' ? ' ativo' : ''), type: 'button', 'aria-label': estado.conta ? 'Seu acesso: ' + estado.conta.nome : 'Criar acesso ou entrar', onclick: () => { estado.tela = 'conta'; estado.aberta = null; desenhar(); root.scrollTo(0, 0); } }, ic(estado.conta ? 'usuarioCheck' : 'usuario'), h('span', { class: 'conta-nome', text: estado.conta ? estado.conta.nome.split(' ')[0] : 'Entrar' }))) : null));
    let corpo;
    if (!chaveLink) corpo = [h('div', { class: 'erro', role: 'alert' }, ic('alerta'), 'Este link está incompleto. Peça o link das vendedoras ao administrador do SC9.')];
    else corpo = estado.tela === 'solicitar' ? telaSolicitar() : estado.tela === 'avisar' ? telaAvisar() : estado.tela === 'prioridade' ? telaPrioridade() : estado.tela === 'minhas' ? telaMinhas() : estado.tela === 'exportar' ? telaExportar() : estado.tela === 'conta' ? telaConta() : telaRastrear();
    const velha = chaveLink && estado.atualizadoEm && idadeBaseH() > LIMITE_BASE_VELHA_H;
    $raiz.replaceChildren(topo, h('main', { class: 'pagina estreita' + (estado.animada !== estado.tela ? ' anima' : '') },
      velha ? h('div', { class: 'aviso', role: 'status' }, ic('relogio'), 'A base do SC9 foi atualizada em ' + C.dataHora(estado.atualizadoEm) + ' (há ' + C.duracao(estado.atualizadoEm) + '). O andamento pode estar atrasado.') : null, ...corpo));
    estado.animada = estado.tela;
    root.document.title = ({ solicitar: 'Solicitar à logística', prioridade: 'Solicitar prioridade', avisar: 'Avisar a expedição', minhas: 'Minhas solicitações', exportar: 'Exportar', conta: 'Seu acesso' }[estado.tela] || 'Acompanhe seus pedidos') + ' · ' + C.NOME;
    root.scrollTo(0, y);
    if (foco) { const e = root.document.getElementById(foco); if (e && e.focus) { e.focus({ preventScroll: true }); if (e.setSelectionRange && e.type === 'text') { try { e.setSelectionRange(e.value.length, e.value.length); } catch (x) { /* ok */ } } } }
  }

  root.setInterval(() => {
    if (root.document.hidden || !chaveLink || estado.f.enviando) return;
    if (estado.tela === 'rastrear' && estado.consulta && estado.consulta.achado && !estado.carregando) consultar(estado.consulta.pedido, true);
    else if (estado.tela === 'minhas') { carregarPrioridades(true); carregarAvisos(true); }
    else if (estado.tela === 'rastrear' && !estado.consulta && !estado.carregando) { carregarPrioridades(true); carregarSeguindo(true); }
  }, 60000);

  // Inclinação discreta dos cartões (só com mouse; fica desligada com "reduzir movimento").
  if (root.matchMedia && root.matchMedia('(hover: hover) and (pointer: fine)').matches && !root.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let alvo = null;
    root.document.addEventListener('pointermove', (ev) => {
      const el = ev.target.closest ? ev.target.closest('.tilt') : null;
      if (alvo && alvo !== el) alvo.classList.remove('inclina');
      alvo = el; if (!el) return;
      const b = el.getBoundingClientRect();
      el.style.setProperty('--ry', (((ev.clientX - b.left) / b.width - .5) * 5).toFixed(2) + 'deg'); el.style.setProperty('--rx', ((.5 - (ev.clientY - b.top) / b.height) * 5).toFixed(2) + 'deg'); el.classList.add('inclina');
    }, { passive: true });
    root.document.addEventListener('mouseleave', () => { if (alvo) { alvo.classList.remove('inclina'); alvo = null; } });
  }

  const pedidoDaUrl = new URLSearchParams(root.location.search).get('pedido');
  desenhar();
  if (chaveLink && pedidoDaUrl) { estado.digitado = pedidoDaUrl; consultar(pedidoDaUrl); }
  if (chaveLink && (lerLS(LS.avisos, []).length || estado.conta)) carregarAvisos(true);
  if (chaveLink && estado.seguindo.length) carregarSeguindo(true);
  if (chaveLink) carregarPrioridades(true); // traz também a hora da última carga do SC9 e confere a sessão do acesso
})(window);
