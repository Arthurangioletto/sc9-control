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
    const [collapsed, setCollapsed] = React.useState(() => {
      try { return window.localStorage.getItem('sc9-sidebar-collapsed') === 'true'; } catch { return false; }
    });
    function toggleSidebar() {
      const next = !collapsed;
      setCollapsed(next);
      try { window.localStorage.setItem('sc9-sidebar-collapsed', String(next)); } catch {}
    }
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
      h('aside', { className: 'sc9-sidebar' + (mobileOpen ? ' is-open' : '') + (collapsed ? ' is-collapsed' : '') },
        h('div', { className: 'sc9-brand' }, h('span', { className: 'sc9-brand-mark', 'aria-hidden': true }, 'S9'), h('div', null, h('strong', null, 'SC9 Control'), h('span', null, 'Gestão da operação')),
          h('button', { type: 'button', className: 'sc9-sidebar-collapse', onClick: toggleSidebar, 'aria-expanded': !collapsed, 'aria-controls': 'sc9-navigation', 'aria-label': collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral', title: collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral' },
            h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true }, h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 3 }), h('path', { d: 'M9 4v16' })))),
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

/* Internal SB8 navigation: imports and analyses share one workspace. */
(function (root) {
  const h = root.React.createElement;
  const labels = {
    duplicado: 'Lote em mais de um produto',
    validadeVariavel: 'Validade inconsistente',
    validade: 'Vencimento',
    saldoNegativo: 'Saldo negativo',
    multiFilial: 'Filiais',
    marcados: 'Marcados',
    finalizados: 'Finalizados'
  };
  root.SC9LotWorkspace = function LotWorkspace({ tabs, active, onNavigate, children }) {
    const [menuOpen, setMenuOpen] = root.React.useState(false);
    const items = root.React.Children.toArray(children);
    const imports = active === 'importacoes';
    function navigate(id) { onNavigate(id); setMenuOpen(false); }
    function link(id, text, count) {
      return h('button', {
        key: id, type: 'button', className: 'sc9-lot-nav-link',
        'aria-current': active === id ? 'page' : undefined,
        onClick: () => navigate(id)
      }, h('span', null, text), count != null && h('span', { className: 'sc9-lot-nav-count' }, count));
    }
    function group(title, ids) {
      return h('div', { className: 'sc9-lot-nav-group', key: title },
        h('p', { className: 'sc9-lot-nav-heading' }, title),
        tabs.filter(([id]) => ids.includes(id)).map(([id, text]) => {
          const count = String(text).match(/\((\d+)\)$/);
          return link(id, labels[id] || text, count ? count[1] : null);
        }));
    }
    return h('div', { className: 'sc9-lot-workspace' },
      h('aside', { className: 'sc9-lot-sidebar' },
        h('div', { className: 'sc9-lot-sidebar-title' }, h('strong', null, 'Cadastro de lotes'),
          h('button', { type: 'button', className: 'sc9-lot-menu-toggle',
            'aria-expanded': menuOpen, 'aria-controls': 'sc9-lot-navigation',
            onClick: () => setMenuOpen(value => !value) }, menuOpen ? 'Fechar menu' : 'Abrir menu')),
        h('nav', { id: 'sc9-lot-navigation', 'aria-label': 'Seções do cadastro de lotes',
          className: 'sc9-lot-navigation' + (menuOpen ? ' is-open' : '') },
          group('Análises', ['duplicado', 'validadeVariavel', 'validade', 'saldoNegativo', 'multiFilial']),
          group('Acompanhamento', ['marcados', 'finalizados']),
          h('div', { className: 'sc9-lot-nav-group' },
            h('p', { className: 'sc9-lot-nav-heading' }, 'Bases de dados'),
            link('importacoes', 'Importações')))),
      h('div', { className: 'sc9-lot-workspace-content' },
        items[0],
        h('section', { hidden: !imports, 'aria-label': 'Importações do cadastro de lotes' },
          h('div', { className: 'sc9-lot-page-heading' },
            h('h2', null, 'Importações'),
            h('p', null, 'Carregue ou atualize o SB8 e as bases complementares.')),
          items[1]),
        h('div', { hidden: imports }, items.slice(2))));
  };
})(window);
