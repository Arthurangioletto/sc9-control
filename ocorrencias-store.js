/* Ocorrências da expedição (por nota fiscal ou, quando ainda não tem nota, pelo número do pedido): lista compartilhada, guardada em ocorrencias-expedicao.json.
 * Cada linha: { id, nf, pedido, dataOcorrencia (AAAA-MM-DD), tipo (lista fechada, opcional), detalhes, responsavel, solucao, dataSolucao (AAAA-MM-DD ou ''), criadoPor, criadoEm,
 * atualizadoPor, atualizadoEm }. Só validação e mesclagem, sem acesso a disco. */
'use strict';

const MAX_LINHAS = 5000;
const TIPOS = ['endereco', 'cadastro', 'pedido_trocado', 'volume', 'avaria', 'coleta', 'ausente', 'outro']; // lista fechada (nomes em ocorrencias.js)

// Número da nota fiscal: só dígitos, sem zeros à esquerda (aceita "885234.0"), de 3 a 12 dígitos.
function numeroDaNota(x) {
  const bruto = String(x == null ? '' : x).trim().replace(/\.0+$/, '');
  const d = bruto.replace(/\D/g, '').replace(/^0+/, '');
  return d.length >= 3 && d.length <= 12 ? d : null;
}

// Número do pedido: só dígitos, sem zeros à esquerda, de 3 a 12 dígitos.
function numeroDoPedido(x) {
  const d = String(x == null ? '' : x).trim().replace(/\.0+$/, '').replace(/\D/g, '').replace(/^0+/, '');
  return d.length >= 3 && d.length <= 12 ? d : null;
}

const texto = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').trim().slice(0, max) : '');
const diaIso = (v) => {
  const s = typeof v === 'string' ? v.trim() : '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] && +m[1] >= 2000 && +m[1] <= 2100 ? s : '';
};
const dataHoraIso = (v) => { const s = texto(v, 30); return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : ''; };

// Linha limpa, ou { erro } se faltar o essencial (nota fiscal ou, sem nota, o pedido; e a data da ocorrência).
function normalizarLinha(x) {
  if (!x || typeof x !== 'object') return { erro: 'Linha inválida.' };
  const temNf = String(x.nf == null ? '' : x.nf).trim() !== '', temPedido = String(x.pedido == null ? '' : x.pedido).trim() !== '';
  const nf = temNf ? numeroDaNota(x.nf) : '', pedido = temPedido ? numeroDoPedido(x.pedido) : '';
  if (temNf && !nf) return { erro: 'Número da nota fiscal inválido (use de 3 a 12 dígitos).' };
  if (temPedido && !pedido) return { erro: 'Número do pedido inválido (use de 3 a 12 dígitos).' };
  if (!nf && !pedido) return { erro: 'Informe o número da nota fiscal ou, se ainda não tem nota, o número do pedido.' };
  const dataOcorrencia = diaIso(x.dataOcorrencia);
  if (!dataOcorrencia) return { erro: 'Data da ocorrência inválida.' };
  const dataSolucao = x.dataSolucao ? diaIso(x.dataSolucao) : '';
  if (x.dataSolucao && !dataSolucao) return { erro: 'Data da solução inválida.' };
  if (dataSolucao && dataSolucao < dataOcorrencia) return { erro: 'A data da solução não pode ser antes da data da ocorrência.' };
  return {
    linha: {
      id: texto(x.id, 40) || '',
      nf: nf || '', pedido: pedido || '', dataOcorrencia,
      tipo: TIPOS.includes(x.tipo) ? x.tipo : '', detalhes: texto(x.detalhes, 600), responsavel: texto(x.responsavel, 80), solucao: texto(x.solucao, 400), dataSolucao,
      criadoPor: texto(x.criadoPor, 60), criadoEm: dataHoraIso(x.criadoEm), atualizadoPor: texto(x.atualizadoPor, 60), atualizadoEm: dataHoraIso(x.atualizadoEm)
    }
  };
}

function normalizarLista(dado) {
  const lista = [];
  const ids = new Set();
  for (const it of (dado && Array.isArray(dado.linhas) ? dado.linhas : [])) {
    const r = normalizarLinha(it);
    if (r.erro || !r.linha.id || ids.has(r.linha.id)) continue;
    ids.add(r.linha.id);
    lista.push(r.linha);
    if (lista.length >= MAX_LINHAS) break;
  }
  return lista;
}

let contador = 0;
const novoId = (agora) => 'o' + Number(agora || Date.now()).toString(36) + (contador++ % 1296).toString(36).padStart(2, '0') + Math.random().toString(36).slice(2, 6);

const mesmaOcorrencia = (a, b) => a.nf === b.nf && a.pedido === b.pedido && a.dataOcorrencia === b.dataOcorrencia && a.detalhes.toLowerCase() === b.detalhes.toLowerCase();

// Aplica uma ação e devolve { linhas, erro?, resultado? }.
//  salvar   { linha } cria (sem id) ou troca a linha de mesmo id
//  remover  { id }
//  importar { linhas: [...] } acrescenta as que ainda não existem (mesma nota + data + detalhes) e devolve quantas entraram
function aplicar(linhasAtuais, corpo, usuario, agora) {
  const linhas = normalizarLista({ linhas: linhasAtuais });
  const acao = corpo && corpo.acao;
  const quando = new Date(agora || Date.now()).toISOString();
  const quem = texto(usuario, 60);
  if (acao === 'remover') {
    const id = texto(corpo.id, 40);
    const i = linhas.findIndex((l) => l.id === id);
    if (i < 0) return { linhas, erro: 'Linha não encontrada (talvez outra pessoa já apagou).' };
    linhas.splice(i, 1);
    return { linhas };
  }
  if (acao === 'salvar') {
    const r = normalizarLinha(corpo.linha);
    if (r.erro) return { linhas, erro: r.erro };
    const l = r.linha;
    const i = l.id ? linhas.findIndex((x) => x.id === l.id) : -1;
    // editar uma linha que outra pessoa já apagou não a ressuscita com outro id
    if (l.id && i < 0) return { linhas, erro: 'Linha não encontrada (talvez outra pessoa já apagou).' };
    // quem editou com a tela aberta antes de outra pessoa salvar não apaga a alteração dela (a tela manda o atualizadoEm que viu; sem ele, vale como antes)
    const base = corpo.baseAtualizadoEm ? texto(corpo.baseAtualizadoEm, 40) : '';
    if (i >= 0 && base && linhas[i].atualizadoEm && base !== linhas[i].atualizadoEm) return { linhas, erro: 'Esta ocorrência foi alterada por outra pessoa enquanto você editava. Recarregue a lista e confira antes de salvar.', conflito: true };
    if (i >= 0) {
      linhas[i] = Object.assign({}, l, { id: linhas[i].id, criadoPor: linhas[i].criadoPor, criadoEm: linhas[i].criadoEm, atualizadoPor: quem, atualizadoEm: quando });
      return { linhas, resultado: { id: linhas[i].id } };
    }
    if (linhas.length >= MAX_LINHAS) return { linhas, erro: 'Limite de ' + MAX_LINHAS + ' linhas.' };
    const nova = Object.assign({}, l, { id: novoId(agora), criadoPor: quem, criadoEm: quando, atualizadoPor: quem, atualizadoEm: quando });
    linhas.unshift(nova);
    return { linhas, resultado: { id: nova.id } };
  }
  if (acao === 'importar') {
    const entrada = Array.isArray(corpo.linhas) ? corpo.linhas.slice(0, 500) : [];
    let novas = 0, repetidas = 0, completadas = 0; const invalidas = [];
    entrada.forEach((x, k) => {
      const r = normalizarLinha(x);
      if (r.erro) { invalidas.push({ linha: k + 1, motivo: r.erro }); return; }
      const ja = linhas.find((e) => mesmaOcorrencia(e, r.linha));
      if (ja) {
        // já existe: só completa o que está vazio (nunca troca o que já foi preenchido)
        let mudou = false;
        for (const campo of ['responsavel', 'solucao', 'tipo']) if (!ja[campo] && r.linha[campo]) { ja[campo] = r.linha[campo]; mudou = true; }
        if (!ja.dataSolucao && r.linha.dataSolucao && r.linha.dataSolucao >= ja.dataOcorrencia) { ja.dataSolucao = r.linha.dataSolucao; mudou = true; }
        if (mudou) { ja.atualizadoPor = quem; ja.atualizadoEm = quando; completadas++; } else repetidas++;
        return;
      }
      if (linhas.length >= MAX_LINHAS) { invalidas.push({ linha: k + 1, motivo: 'Limite de linhas atingido.' }); return; }
      linhas.push(Object.assign({}, r.linha, { id: novoId(agora), criadoPor: quem, criadoEm: quando, atualizadoPor: quem, atualizadoEm: quando }));
      novas++;
    });
    return { linhas, resultado: { novas, repetidas, completadas, invalidas } };
  }
  return { linhas, erro: 'ação inválida' };
}

// Linhas de exemplo que a expedição já tinha na planilha (entram uma vez, na primeira abertura da aba).
function linhasIniciais(agora) {
  const base = [
    { nf: '885234', dataOcorrencia: '2026-11-16', detalhes: 'endereço insuficiente- vendedor está verificando e cadastro precisa atualizar', responsavel: 'Juliana Abranches', solucao: 'Resolvido', dataSolucao: '2026-11-18' },
    { nf: '886039', dataOcorrencia: '2026-11-21', detalhes: 'cliente mudou de endereço- vendedora está retornando hoje o e-mail.', responsavel: 'Daniela Anselmo', solucao: 'Retornou o e-mail hoje com endereço', dataSolucao: '' },
    { nf: '886511', dataOcorrencia: '2026-11-23', detalhes: 'cliente mudou de endereço- vendedora está retornando hoje o e-mail.', responsavel: 'Natalia (Qualidade)', solucao: 'Retornou o e-mail dia 24/11', dataSolucao: '' }
  ];
  const quando = new Date(agora || Date.now()).toISOString();
  return base.map((l, i) => Object.assign({}, l, { id: 'inicial' + (i + 1), criadoPor: 'sistema', criadoEm: quando, atualizadoPor: 'sistema', atualizadoEm: quando }));
}

module.exports = { TIPOS, MAX_LINHAS, numeroDaNota, numeroDoPedido, normalizarLinha, normalizarLista, aplicar, linhasIniciais };
