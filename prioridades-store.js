/* Pedidos de prioridade das vendedoras: lista compartilhada, guardada em prioridades-vendedoras.json.
 * A vendedora CRIA o pedido (nasce "recebida", com protocolo); só a equipe (logada) muda o status, assume, comenta e responde.
 * Cada linha: { id, protocolo, pedido, nivel, motivo, observacao, pedidoPor, filial, status, resposta, responsavel, respondidoPor, naoAchado,
 *               conta (login da vendedora, quando ela criou acesso; vazio se enviou só com o nome), criadoEm, atualizadoEm, historico[] }. O histórico só cresce (cada mudança: quem, quando, o quê).
 * Só validação e mesclagem, sem acesso a disco. */
'use strict';

const MAX_LINHAS = 3000;
const MAX_HISTORICO = 60;
const NIVEIS = ['normal', 'media', 'alta', 'urgente'];
const PESO_NIVEL = { normal: 0, media: 1, alta: 2, urgente: 3 };
const STATUS = ['recebida', 'em_analise', 'aprovada', 'em_atendimento', 'concluida', 'nao_aprovada'];
const ATIVOS = ['recebida', 'em_analise', 'aprovada', 'em_atendimento'];
const MOTIVOS = ['cliente_aguardando', 'prazo_combinado', 'cliente_importante', 'erro_nosso', 'retirada', 'outro'];
const ACOES_HIST = ['criado', 'reforco', 'status', 'assumir', 'interno'];
const LIMITE_POR_DIA = 10; // pedidos de prioridade por vendedora (nome) em 24 h, para a fila não virar tudo urgente
const DIAS_PARA_LIMPAR = 60;
const FUSO = 'America/Sao_Paulo';
// nomes antigos (versão de teste) viram os novos
const STATUS_ANTIGO = { recebido: 'recebida', atendido: 'concluida', nao_foi_possivel: 'nao_aprovada', cancelado: 'nao_aprovada' };

// Número do pedido: só dígitos, sem zeros à esquerda, de 4 a 10 dígitos (igual ao servidor).
function numeroDoPedido(x) {
  const d = String(x == null ? '' : x).trim().replace(/\.0+$/, '').replace(/\D/g, '').replace(/^0+/, '');
  return d.length >= 4 && d.length <= 10 ? d : null;
}
const texto = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, max) : '');
const dataHora = (v) => { const s = texto(v, 30); return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : ''; };
const statusDe = (v) => (STATUS.includes(v) ? v : STATUS_ANTIGO[v] || '');

let contador = 0;
const novoId = (agora) => 'p' + Number(agora || Date.now()).toString(36) + (contador++ % 1296).toString(36).padStart(2, '0') + Math.random().toString(36).slice(2, 6);

function normalizarLinha(x) {
  if (!x || typeof x !== 'object') return null;
  const pedido = numeroDoPedido(x.pedido);
  const id = texto(x.id, 40);
  if (!pedido || !id) return null;
  return {
    id, pedido, protocolo: texto(x.protocolo, 30),
    nivel: NIVEIS.includes(x.nivel) ? x.nivel : 'normal',
    motivo: MOTIVOS.includes(x.motivo) ? x.motivo : 'outro',
    observacao: texto(x.observacao, 300), pedidoPor: texto(x.pedidoPor, 60), conta: texto(x.conta, 24), filial: texto(x.filial, 40),
    status: statusDe(x.status) || 'recebida',
    resposta: texto(x.resposta, 300), responsavel: texto(x.responsavel, 60), respondidoPor: texto(x.respondidoPor, 60),
    naoAchado: Boolean(x.naoAchado),
    criadoEm: dataHora(x.criadoEm), atualizadoEm: dataHora(x.atualizadoEm),
    historico: (Array.isArray(x.historico) ? x.historico : []).slice(-MAX_HISTORICO).map((h) => ({
      em: dataHora(h && h.em), acao: ACOES_HIST.includes(h && h.acao) ? h.acao : 'status', por: texto(h && h.por, 60), conta: texto(h && h.conta, 24), texto: texto(h && h.texto, 300),
      nivel: NIVEIS.includes(h && h.nivel) ? h.nivel : '', status: statusDe(h && h.status)
    }))
  };
}

function normalizarLista(dado) {
  const lista = [], ids = new Set();
  for (const it of (dado && Array.isArray(dado.linhas) ? dado.linhas : [])) {
    const l = normalizarLinha(it);
    if (!l || ids.has(l.id)) continue;
    ids.add(l.id); lista.push(l);
    if (lista.length >= MAX_LINHAS) break;
  }
  return lista;
}

// Os que já terminaram há mais de 60 dias saem da lista (a lista não cresce para sempre).
function limpar(linhas, agora) {
  const corte = (agora || Date.now()) - DIAS_PARA_LIMPAR * 864e5;
  return linhas.filter((l) => ATIVOS.includes(l.status) || Date.parse(l.atualizadoEm || l.criadoEm || 0) >= corte);
}

// Protocolo legível: PRI-AAAAMMDD-NNN (NNN = ordem do dia). Como a lista guarda 60 dias, o número não se repete no mesmo dia.
function novoProtocolo(linhas, agora) {
  const dia = new Date(agora || Date.now()).toLocaleDateString('sv-SE', { timeZone: FUSO }).replace(/-/g, '');
  const prefixo = 'PRI-' + dia + '-';
  let maior = 0;
  for (const l of linhas) if (l.protocolo && l.protocolo.startsWith(prefixo)) maior = Math.max(maior, Number(l.protocolo.slice(prefixo.length)) || 0);
  return prefixo + String(maior + 1).padStart(3, '0');
}

const add = (l, h) => { l.historico = l.historico.concat([h]).slice(-MAX_HISTORICO); };

// Aplica uma ação e devolve { linhas, erro?, resultado? }.
//  criar   { pedido, nivel, motivo, observacao, pedidoPor, filial?, naoAchado? }  (a vendedora; quem = nome digitado)
//  status  { id, status, resposta }                                              (a equipe logada; quem = usuário)
//  assumir { id }                                                                (a equipe: registra quem pegou; recebida vira em análise)
//  interno { id, texto }                                                         (comentário só da equipe, a vendedora nunca vê)
function aplicar(linhasAtuais, corpo, quem, agora) {
  const linhas = limpar(normalizarLista({ linhas: linhasAtuais }), agora);
  const acao = corpo && corpo.acao;
  const quando = new Date(agora || Date.now()).toISOString();
  const por = texto(quem, 60);
  if (acao === 'criar') {
    const pedido = numeroDoPedido(corpo.pedido);
    if (!pedido) return { linhas, erro: 'Número do pedido inválido (só números, de 4 a 10 dígitos).' };
    const nivel = corpo.nivel;
    if (!NIVEIS.includes(nivel)) return { linhas, erro: 'Escolha o nível de prioridade.' };
    const motivo = corpo.motivo;
    if (!MOTIVOS.includes(motivo)) return { linhas, erro: 'Escolha o motivo do pedido de prioridade.' };
    const pedidoPor = texto(corpo.pedidoPor, 60);
    if (pedidoPor.length < 2) return { linhas, erro: 'Diga seu nome para a equipe saber quem pediu.' };
    const observacao = texto(corpo.observacao, 300);
    if (motivo === 'outro' && observacao.length < 5) return { linhas, erro: 'Explique o motivo na observação.' };
    const ativa = linhas.find((l) => l.pedido === pedido && ATIVOS.includes(l.status));
    if (ativa) {
      // já está na fila: não cria outro, reforça o existente (sobe o nível se for maior) e registra a observação
      if (PESO_NIVEL[nivel] > PESO_NIVEL[ativa.nivel]) ativa.nivel = nivel;
      add(ativa, { em: quando, acao: 'reforco', por: pedidoPor, conta: texto(corpo.conta, 24), texto: observacao, nivel, status: '' });
      ativa.atualizadoEm = quando;
      return { linhas, resultado: { id: ativa.id, duplicado: true } };
    }
    const desde = (agora || Date.now()) - 864e5, quemPediu = pedidoPor.toLowerCase();
    if (linhas.filter((l) => l.pedidoPor.toLowerCase() === quemPediu && Date.parse(l.criadoEm) >= desde).length >= LIMITE_POR_DIA) return { linhas, erro: 'Você já fez ' + LIMITE_POR_DIA + ' pedidos de prioridade hoje. Fale direto com a equipe da expedição.' };
    if (linhas.length >= MAX_LINHAS) return { linhas, erro: 'A fila está cheia no momento. Fale com a equipe da expedição.' };
    const nova = {
      id: novoId(agora), protocolo: novoProtocolo(linhas, agora), pedido, nivel, motivo, observacao, pedidoPor, conta: texto(corpo.conta, 24), filial: texto(corpo.filial, 40), status: 'recebida', resposta: '', responsavel: '', respondidoPor: '', naoAchado: Boolean(corpo.naoAchado),
      criadoEm: quando, atualizadoEm: quando, historico: [{ em: quando, acao: 'criado', por: pedidoPor, texto: observacao, nivel, status: 'recebida' }]
    };
    linhas.unshift(nova);
    return { linhas, resultado: { id: nova.id, duplicado: false } };
  }
  const l = linhas.find((x) => x.id === texto(corpo && corpo.id, 40));
  if (acao === 'status' || acao === 'assumir' || acao === 'interno') {
    if (!l) return { linhas, erro: 'Pedido de prioridade não encontrado.' };
  }
  if (acao === 'status') {
    if (!STATUS.includes(corpo.status)) return { linhas, erro: 'Status inválido.' };
    const resposta = texto(corpo.resposta, 300);
    if (corpo.status === 'nao_aprovada' && !resposta) return { linhas, erro: 'Explique o motivo na resposta para a vendedora.' };
    l.status = corpo.status;
    if (resposta) l.resposta = resposta;
    if (!l.responsavel && por) l.responsavel = por; // quem mexeu primeiro assume
    l.respondidoPor = por; l.atualizadoEm = quando;
    add(l, { em: quando, acao: 'status', por, texto: resposta, nivel: '', status: corpo.status });
    return { linhas, resultado: { id: l.id } };
  }
  if (acao === 'assumir') {
    if (!por) return { linhas, erro: 'Quem está assumindo?' };
    if (!ATIVOS.includes(l.status)) return { linhas, erro: 'Este pedido de prioridade já foi finalizado.' };
    l.responsavel = por; l.atualizadoEm = quando;
    const muda = l.status === 'recebida';
    if (muda) l.status = 'em_analise';
    add(l, { em: quando, acao: 'assumir', por, texto: '', nivel: '', status: muda ? 'em_analise' : '' });
    return { linhas, resultado: { id: l.id } };
  }
  if (acao === 'interno') {
    const t = texto(corpo.texto, 300);
    if (!t) return { linhas, erro: 'Escreva o comentário.' };
    l.atualizadoEm = quando;
    add(l, { em: quando, acao: 'interno', por, texto: t, nivel: '', status: '' });
    return { linhas, resultado: { id: l.id } };
  }
  return { linhas, erro: 'ação inválida' };
}

// Liga ao login da vendedora as solicitações que ela já tinha feito neste aparelho (só as sem conta e com o mesmo nome).
function vincularConta(linhasAtuais, ids, nome, login) {
  const linhas = normalizarLista({ linhas: linhasAtuais });
  const quero = new Set((Array.isArray(ids) ? ids : []).map((x) => texto(x, 40)).filter(Boolean).slice(0, 100)), n = texto(nome, 60).toLowerCase();
  let mudou = 0;
  for (const l of linhas) if (quero.has(l.id) && !l.conta && l.pedidoPor.toLowerCase() === n) { l.conta = login; mudou++; }
  return { linhas, mudou };
}

// Pedidos que já foram despachados deixam de precisar de prioridade: o sistema conclui sozinho (registrado como "Sistema").
function fecharDespachados(linhasAtuais, despachados, agora) {
  const linhas = normalizarLista({ linhas: linhasAtuais });
  const quando = new Date(agora || Date.now()).toISOString();
  let mudou = 0;
  for (const l of linhas) {
    if (!ATIVOS.includes(l.status) || !despachados.has(l.pedido)) continue;
    l.status = 'concluida'; l.resposta = 'Pedido despachado.'; l.respondidoPor = 'Sistema'; l.atualizadoEm = quando;
    add(l, { em: quando, acao: 'status', por: 'Sistema', texto: 'Pedido despachado.', nivel: '', status: 'concluida' });
    mudou++;
  }
  return { linhas, mudou };
}

// O que a vendedora vê do histórico: o que aconteceu e quando, sem nomes da equipe e sem comentários internos.
function historicoPublico(l) {
  const saida = [];
  for (const h of l.historico) {
    if (h.acao === 'criado') saida.push({ em: h.em, status: 'recebida', texto: '' });
    else if (h.acao === 'reforco') saida.push({ em: h.em, status: '', texto: 'Pedido reforçado' + (h.nivel ? ' (nível ' + h.nivel + ')' : '') });
    else if (h.acao === 'status') saida.push({ em: h.em, status: h.status, texto: h.texto });
    else if (h.acao === 'assumir' && h.status) saida.push({ em: h.em, status: h.status, texto: '' });
  }
  return saida;
}

// Cada vendedora vê só o que é dela. "Dela" = criou a solicitação (pelo login, ou pelo nome quando não tem login) ou reforçou uma que já existia.
// Dono vê motivo, observação e nome; quem só reforçou o pedido de outra pessoa vê status, nível e resposta, sem a observação nem o nome de quem pediu.
const mesmoNome = (a, b) => Boolean(a) && Boolean(b) && String(a).toLowerCase() === String(b).toLowerCase();
const ehDono = (l, quem) => (l.conta ? Boolean(quem && quem.login) && l.conta === quem.login : mesmoNome(l.pedidoPor, quem && quem.nome));
const reforcou = (l, login) => Boolean(login) && l.historico.some((h) => h.acao === 'reforco' && h.conta === login);
const ehDela = (l, login) => Boolean(login) && (l.conta === login || reforcou(l, login));
// Quem só reforçou o pedido de outra pessoa recebe um id DIFERENTE (idReforco(id), que não dá para desfazer): o id verdadeiro só fica com quem criou.
// Assim ninguém consegue pedir a linha de outra pessoa pelo id e ler a observação dela.
const visaoMeu = (l, dono, idReforco) => ({ id: dono === false && typeof idReforco === 'function' ? idReforco(l.id) : l.id, protocolo: l.protocolo, pedido: l.pedido, nivel: l.nivel, motivo: dono === false ? '' : l.motivo, status: l.status, observacao: dono === false ? '' : l.observacao, pedidoPor: dono === false ? '' : l.pedidoPor, resposta: l.resposta, reforco: dono === false, criadoEm: l.criadoEm, atualizadoEm: l.atualizadoEm, historico: historicoPublico(l) });
const visaoFila = (l) => ({ pedido: l.pedido, nivel: l.nivel, status: l.status, criadoEm: l.criadoEm });

// Fila ordenada: urgente primeiro, depois a mais antiga.
function ordenarFila(linhas) {
  return linhas.slice().sort((a, b) => (PESO_NIVEL[b.nivel] - PESO_NIVEL[a.nivel]) || String(a.criadoEm).localeCompare(String(b.criadoEm)));
}

module.exports = { MAX_LINHAS, LIMITE_POR_DIA, NIVEIS, STATUS, ATIVOS, MOTIVOS, numeroDoPedido, normalizarLinha, normalizarLista, limpar, novoProtocolo, aplicar, fecharDespachados, vincularConta, ehDono, ehDela, historicoPublico, visaoMeu, visaoFila, ordenarFila };
