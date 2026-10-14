/* Editable navigation source. Receives only the tabs authorized by the app. */
(function () {
  const h = React.createElement;
  const groups = [
    { name: 'Visão geral', description: 'Resumo e prioridades', ids: ['geral', 'dashboard', 'alertas', 'criticos'] },
    { name: 'Operação', description: 'Acompanhe cada etapa', ids: ['fluxo', 'controle0201', 'saida', 'recebimento', 'expedicao', 'movimentacao'] },
    { name: 'Produtividade', description: 'Equipe e desempenho', ids: ['separadores', 'conferencia', 'performance', 'horarios'] },
    { name: 'Análises', description: 'Clientes, produtos e evolução', ids: ['clientes', 'itens', 'tendencias'] },
    { name: 'Administração', description: 'Cadastros e acessos', ids: ['alteracoes_sep', 'cadastro_sb8', 'acessos'] }
  ];
  const labels = { geral: 'Resumo da operação', dashboard: 'Monitor ao vivo', controle0201: 'Controle 02 → 01', saida: 'Saída para expedição', recebimento: 'Recebimento', alteracoes_sep: 'Revisão de alterações', cadastro_sb8: 'Cadastro de lotes', itens: 'Produtos · Curva ABC' };
  window.SC9Navigation = function SC9Navigation({ tabs, active, onNavigate }) {
    const [mobileOpen, setMobileOpen] = React.useState(false);
    const [expanded, setExpanded] = React.useState({});
    const known = new Set(groups.flatMap(group => group.ids));
    const extra = tabs.filter(([id]) => !known.has(id));
    const sections = extra.length ? [...groups, { name: 'Outras telas', ids: extra.map(([id]) => id) }] : groups;
    const current = tabs.find(([id]) => id === active);
    const section = sections.find(group => group.ids.includes(active));
    const title = current ? labels[active] || current[1] : 'Painel de controle';
    function navigate(id) { onNavigate(id); setMobileOpen(false); }
    return h(React.Fragment, null,
      h('div', { className: 'sc9-page-heading' },
        h('div', null, h('p', { className: 'sc9-breadcrumb' }, section ? section.name : 'SC9 Control'), h('h1', null, title), h('p', { className: 'sc9-page-description' }, 'Consulte os indicadores e acompanhe sua operação.')),
        h('button', { type: 'button', className: 'sc9-menu-toggle', onClick: () => setMobileOpen(!mobileOpen), 'aria-expanded': mobileOpen, 'aria-controls': 'sc9-navigation' }, mobileOpen ? 'Fechar menu' : 'Abrir menu')),
      h('aside', { className: 'sc9-sidebar' + (mobileOpen ? ' is-open' : '') },
        h('div', { className: 'sc9-brand' }, h('span', { className: 'sc9-brand-mark', 'aria-hidden': true }, 'S9'), h('div', null, h('strong', null, 'SC9 Control'), h('span', null, 'Gestão da operação'))),
        h('nav', { id: 'sc9-navigation', 'aria-label': 'Áreas do painel' }, sections.map(group => {
          const items = group.ids.map(id => tabs.find(([tab]) => tab === id)).filter(Boolean);
          if (!items.length) return null;
          const selected = group.ids.includes(active);
          const open = expanded[group.name] ?? selected;
          const panelId = 'sc9-group-' + sections.indexOf(group);
          return h('section', { key: group.name, className: 'sc9-nav-section' },
            h('button', { type: 'button', className: 'sc9-group-toggle', 'aria-expanded': open, 'aria-controls': panelId, onClick: () => setExpanded(previous => ({ ...previous, [group.name]: !open })) }, h('span', null, group.name), h('span', { 'aria-hidden': true }, open ? '−' : '+')),
            h('div', { id: panelId, hidden: !open }, items.map(([id, originalLabel]) => {
              const count = id === 'controle0201' && originalLabel.match(/\((\d+)\)$/);
              return h('button', { type: 'button', key: id, className: 'sc9-nav-link' + (id === active ? ' is-active' : ''), 'aria-current': id === active ? 'page' : undefined, onClick: () => navigate(id) }, h('span', null, labels[id] || originalLabel), count && h('span', { className: 'sc9-nav-count', 'aria-label': count[1] + ' aguardando' }, count[1]));
            })));
        })),
        h('div', { className: 'sc9-sidebar-footer' }, h('span', { className: 'sc9-footer-dot', 'aria-hidden': true }), 'Controle e acompanhamento')));
  };
})();
