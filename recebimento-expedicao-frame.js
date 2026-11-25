/* Aba "Recebimento Expedição" do SC9: mostra o Painel da Expedição (/expedicao.html, mesma origem, dentro de uma moldura)
 * e mantém a tela anterior (a que já existia) a um clique, em "Tela antiga". Se este arquivo não carregar, o bundle usa a tela antiga. */
(function (root) {
  'use strict';
  const R = root.React;
  if (!R) return;
  const h = R.createElement;
  const barra = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '0 0 10px' };
  const botao = (ativo) => ({ border: '1px solid ' + (ativo ? '#2f5fd0' : 'rgba(127,140,170,.45)'), background: ativo ? '#2f5fd0' : 'transparent', color: ativo ? '#fff' : 'inherit', borderRadius: 10, padding: '8px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer', minHeight: 40 });

  function Panel(props) {
    const [modo, setModo] = R.useState('novo');
    const Antiga = props.Antiga;
    return h('div', { className: 'sc9-receb-frame' },
      h('div', { style: barra, role: 'group', 'aria-label': 'Visão do Recebimento Expedição' },
        h('button', { type: 'button', style: botao(modo === 'novo'), 'aria-pressed': modo === 'novo', onClick: () => setModo('novo') }, 'Painel da Expedição'),
        Antiga ? h('button', { type: 'button', style: botao(modo === 'antiga'), 'aria-pressed': modo === 'antiga', onClick: () => setModo('antiga') }, 'Tela antiga') : null),
      modo === 'novo'
        ? h('iframe', {
            title: 'Painel da Expedição', src: '/expedicao.html?embed=1', allow: 'clipboard-write',
            style: { width: '100%', height: 'calc(100vh - 170px)', minHeight: 720, border: 0, borderRadius: 14, background: 'transparent', display: 'block' }
          })
        : (Antiga ? h(Antiga, { isAdmin: props.isAdmin, authInfo: props.authInfo }) : null));
  }

  root.SC9RecebimentoFrame = { Panel };
})(window);
