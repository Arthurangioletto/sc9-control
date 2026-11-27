/* Painel da logística · aba "Armazéns das vendedoras": a lista de armazéns que as vendedoras podem escolher em "Transferência de peça", por filial.
 * Só a equipe edita (mesma permissão da Central). O servidor RECUSA qualquer armazém fora da lista. A lista inicial é PROVISÓRIA: a logística confere.
 * JavaScript puro; tudo que vem do servidor entra como textContent. Plugado em prioridades.js (ArmazensUI.tela). */
(function (root) {
  'use strict';
  const C = root.Central, S = root.SolComum, h = C.h, ic = S.ic;
  const a = { ctx: null, dados: null, erro: '', carregando: false, lista: null, sujo: false, salvando: false, aviso: '', ok: '', historicoAberto: false };
  const redesenhar = () => { if (a.ctx) a.ctx.redesenhar(); };
  const copia = (l) => l.map((x) => ({ filial: x.filial, codigo: x.codigo, rotulo: x.rotulo || '', origem: Boolean(x.origem), destino: Boolean(x.destino), vendavel: Boolean(x.vendavel), nota: x.nota || '', comSaldo: Boolean(x.comSaldo) }));
  const nomeFilial = (k) => (a.dados && a.dados.filiais.find((f) => f.chave === k) || {}).nome || k;

  async function carregar() {
    if (!a.ctx || a.carregando) return;
    a.carregando = true; a.erro = '';
    try { a.dados = await a.ctx.pedir('/api/armazens-vendedoras'); a.lista = copia(a.dados.armazens); a.sujo = false; }
    catch (x) { a.erro = x.message; }
    a.carregando = false; redesenhar();
  }
  async function enviar(corpo, ok) {
    a.salvando = true; a.aviso = ''; a.ok = ''; redesenhar();
    try { a.dados = await a.ctx.pedir('/api/armazens-vendedoras', { method: 'POST', body: JSON.stringify(corpo) }); a.lista = copia(a.dados.armazens); a.sujo = false; a.ok = ok; C.toast(ok); }
    catch (x) { a.aviso = x.message; }
    a.salvando = false; redesenhar();
  }
  const salvar = () => enviar({ acao: 'salvar', armazens: a.lista.map((x) => ({ filial: x.filial, codigo: x.codigo, rotulo: x.rotulo, origem: x.origem, destino: x.destino, vendavel: x.vendavel, nota: x.nota })) }, 'Lista de armazéns salva. As vendedoras já enxergam a nova lista.');
  const mexeu = () => { a.sujo = true; a.ok = ''; };

  function linhaArmazem(x, i) {
    const id = 'arm-' + i, chk = (campo, rot) => h('label', { class: 'sol-check', for: id + '-' + campo }, h('input', { id: id + '-' + campo, type: 'checkbox', checked: x[campo], onchange: (ev) => { x[campo] = ev.target.checked; mexeu(); redesenhar(); } }), h('span', { text: rot }));
    return h('div', { class: 'arm-linha' + (x.vendavel ? '' : ' separado'), role: 'group', 'aria-label': 'Armazém ' + x.codigo + ' de ' + nomeFilial(x.filial) },
      h('div', { class: 'arm-cod' }, h('b', { class: 'num', text: x.codigo }), x.comSaldo ? h('span', { class: 'sol-saldo ok', text: 'tem saldo' }) : h('span', { class: 'sol-saldo nd', text: 'sem saldo agora' })),
      h('div', { class: 'sol-campo' }, h('label', { class: 'rotulo', for: id + '-r', text: 'Nome para a vendedora' }), h('input', { id: id + '-r', class: 'entrada', type: 'text', maxlength: '40', value: x.rotulo, placeholder: 'Ex.: Estoque principal', oninput: (ev) => { x.rotulo = ev.target.value; mexeu(); } })),
      h('div', { class: 'arm-marcas' }, chk('origem', 'Pode ser origem'), chk('destino', 'Pode ser destino'), chk('vendavel', 'Estoque de venda')),
      h('div', { class: 'sol-campo' }, h('label', { class: 'rotulo', for: id + '-n', text: 'Aviso (opcional)' }), h('input', { id: id + '-n', class: 'entrada', type: 'text', maxlength: '120', value: x.nota, oninput: (ev) => { x.nota = ev.target.value; mexeu(); } })),
      h('button', { class: 'btn peq fantasma perigo', type: 'button', 'aria-label': 'Tirar o armazém ' + x.codigo + ' de ' + nomeFilial(x.filial) + ' da lista', onclick: () => { a.lista = a.lista.filter((y) => y !== x); mexeu(); redesenhar(); } }, ic('fechar'), 'Tirar'));
  }
  const novos = {};
  function cartaoFilial(f) {
    const linhas = a.lista.map((x, i) => [x, i]).filter(([x]) => x.filial === f.chave), nv = novos[f.chave] || (novos[f.chave] = { codigo: '' }), id = 'arm-novo-' + f.chave;
    const adicionar = () => {
      const cod = nv.codigo.trim().toUpperCase().replace(/^(\d)$/, '0$1');
      if (!/^[A-Z0-9]{1,6}$/.test(cod)) { a.aviso = 'O código do armazém tem de 1 a 6 letras ou números.'; return redesenhar(); }
      if (a.lista.some((y) => y.filial === f.chave && y.codigo === cod)) { a.aviso = 'O armazém ' + cod + ' de ' + f.nome + ' já está na lista.'; return redesenhar(); }
      a.lista.push({ filial: f.chave, codigo: cod, rotulo: '', origem: false, destino: false, vendavel: false, nota: '', comSaldo: false }); nv.codigo = ''; a.aviso = ''; mexeu(); redesenhar();
    };
    return h('section', { class: 'card arm-filial', 'aria-label': 'Filial ' + f.nome }, h('div', { class: 'card-titulo' }, h('h2', null, f.nome, h('span', { class: 'mudo peq', text: '  código ' + f.codigo }))),
      linhas.length ? linhas.map(([x, i]) => linhaArmazem(x, i)) : h('p', { class: 'mudo', text: 'Nenhum armazém desta filial na lista: as vendedoras não conseguem pedir transferência daqui nem para cá.' }),
      h('form', { class: 'arm-novo', onsubmit: (ev) => { ev.preventDefault(); adicionar(); } }, h('div', { class: 'sol-campo' }, h('label', { class: 'rotulo', for: id, text: 'Incluir armazém (código)' }), h('input', { id, class: 'entrada', type: 'text', maxlength: '6', autocomplete: 'off', autocapitalize: 'characters', placeholder: 'Ex.: 03', value: nv.codigo, oninput: (ev) => { nv.codigo = ev.target.value; } })),
        h('button', { class: 'btn peq', type: 'submit' }, ic('enviar'), 'Incluir')));
  }
  function tela(ctx) {
    a.ctx = ctx;
    if (!a.dados && !a.carregando && !a.erro) carregar();
    if (a.erro && !a.dados) return [h('div', { class: 'erro', role: 'alert' }, ic('alerta'), a.erro), h('div', { class: 'acoes' }, h('button', { class: 'btn peq', type: 'button', onclick: () => { a.erro = ''; carregar(); } }, ic('atualizar'), 'Tentar de novo'))];
    if (!a.dados || !a.lista) return C.esqueleto(3);
    const d = a.dados, hist = d.historico || [];
    return [
      d.provisoria ? h('div', { class: 'aviso', role: 'note' }, ic('alerta'), h('div', null, h('b', { text: 'Lista provisória. ' }), 'Foi montada de forma conservadora (Cambuci 01 e 02, e o armazém da própria filial nas outras). A logística precisa conferir cada armazém e salvar a lista. Os armazéns 59 (TDC) e 26 (Retem) existem, mas não são estoque de venda: ficam fora do total e não podem ser pedidos.')) : null,
      h('section', { class: 'card' }, h('div', { class: 'card-titulo' }, h('div', null, h('h2', { text: 'Armazéns que as vendedoras podem pedir' }), h('p', { class: 'mudo peq', text: d.atualizadoEm ? 'Última alteração: ' + C.dataHora(d.atualizadoEm) + (d.atualizadoPor ? ' por ' + d.atualizadoPor : '') : 'Ainda não foi salva pela logística (vale o padrão provisório).' }))),
        h('p', { class: 'mudo', text: 'A vendedora só escolhe da lista, sem digitar. O servidor recusa qualquer armazém fora dela. "Estoque de venda" decide o que entra no "Total em todas as filiais"; o que não for de venda aparece à parte, como saldo separado.' }),
        a.aviso ? h('div', { class: 'erro', role: 'alert' }, ic('alerta'), a.aviso) : null, a.ok ? h('div', { class: 'ok', role: 'status' }, ic('ok'), a.ok) : null,
        h('div', { class: 'acoes' }, h('button', { class: 'btn primario', type: 'button', disabled: a.salvando || !a.sujo, onclick: salvar }, ic('ok'), a.salvando ? 'Salvando…' : a.sujo ? 'Salvar lista' : 'Sem mudanças para salvar'),
          h('button', { class: 'btn', type: 'button', disabled: a.salvando || !a.sujo, onclick: () => { a.lista = copia(a.dados.armazens); a.sujo = false; a.aviso = ''; redesenhar(); } }, ic('voltar'), 'Desfazer o que mudei'),
          h('button', { class: 'btn', type: 'button', disabled: a.salvando, onclick: () => { if (root.confirm('Voltar à lista padrão provisória? A lista atual será substituída.')) enviar({ acao: 'restaurar' }, 'Voltou ao padrão provisório.'); } }, ic('atualizar'), 'Restaurar o padrão'))),
      d.naoClassificados && d.naoClassificados.length ? h('section', { class: 'card' }, h('div', { class: 'card-titulo' }, h('h2', { text: 'Com saldo, mas fora da lista' })),
        h('p', { class: 'mudo', text: 'Estes armazéns têm saldo no SC9 e ainda não foram classificados. Enquanto não entrarem na lista, as vendedoras não podem pedi-los e o saldo deles não entra no total.' }),
        h('div', { class: 'chips', style: 'justify-content:flex-start;margin-top:10px' }, d.naoClassificados.map((x) => h('button', { class: 'chip', type: 'button', onclick: () => { if (!a.lista.some((y) => y.filial === x.filial && y.codigo === x.codigo)) { a.lista.push({ filial: x.filial, codigo: x.codigo, rotulo: '', origem: false, destino: false, vendavel: false, nota: '', comSaldo: true }); mexeu(); redesenhar(); } } }, nomeFilial(x.filial) + ' · ' + x.codigo + ' (incluir)')))) : null,
      d.filiais.map(cartaoFilial),
      hist.length ? h('details', { class: 'sol-detalhes card', open: a.historicoAberto, ontoggle: (ev) => { a.historicoAberto = ev.target.open; } }, h('summary', { class: 'resumo-como', text: 'Histórico de alterações (' + hist.length + ')' }),
        h('ol', { class: 'hist' }, hist.map((x) => h('li', null, h('span', { class: 'hora', text: C.dataHora(x.em) }), ' ', h('b', { text: x.por || '—' }), ' · ' + (x.resumo || '')))))
        : null];
  }
  root.ArmazensUI = { tela, carregar };
})(window);
