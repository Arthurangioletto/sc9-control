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

/* Shared detail panel: native modal handles focus containment and Escape. */
(function(root){
  const R=root.React,h=R.createElement;
  root.SC9UI=root.SC9UI||{};
  root.SC9UI.Sheet=function Sheet({title,subtitle,children,onClose,footer,closeLabel='Fechar painel'}){
    const reference=R.useRef(null),id=R.useId();
    R.useEffect(()=>{
      const dialog=reference.current;if(!dialog)return;
      const previous=root.document.activeElement,body=root.document.body,overflow=body.style.overflow;
      dialog.showModal();body.style.overflow='hidden';
      return()=>{if(dialog.open)dialog.close();body.style.overflow=overflow;if(previous?.isConnected)previous.focus({preventScroll:true});};
    },[]);
    const keyboard=e=>{if(e.key!=='Tab')return;const controls=[...e.currentTarget.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(el=>el.getClientRects().length&&!el.closest('[hidden]'));if(!controls.length)return;const first=controls[0],last=controls[controls.length-1],active=root.document.activeElement;if(e.shiftKey&&(active===first||active===e.currentTarget)){e.preventDefault();last.focus();}else if(!e.shiftKey&&active===last){e.preventDefault();first.focus();}};
    return h('dialog',{ref:reference,className:'sc9-sheet','aria-labelledby':id,'aria-describedby':subtitle?id+'-subtitle':undefined,onKeyDown:keyboard,onCancel:e=>{e.preventDefault();onClose();},onClick:e=>{if(e.target!==e.currentTarget)return;const box=e.currentTarget.getBoundingClientRect();if(e.clientX<box.left||e.clientX>box.right||e.clientY<box.top||e.clientY>box.bottom)onClose();}},
      h('div',{className:'sc9-sheet-layout'},
        h('header',{className:'sc9-sheet-heading'},h('div',null,subtitle&&h('p',{id:id+'-subtitle',className:'sc9-sheet-subtitle'},subtitle),h('h2',{id},title)),h('button',{type:'button',className:'sc9-sheet-close','aria-label':closeLabel,onClick:onClose,autoFocus:true},'×')),
        h('div',{className:'sc9-sheet-body'},children),
        footer&&h('footer',{className:'sc9-sheet-footer'},footer)));
  };
})(window);

/* SB8 analyses contain their own follow-up views. */
(function (root) {
  const R = root.React, h = R.createElement;
  root.SC9LotWorkspace = function LotWorkspace({ tabs, active, analysis, followup, onNavigate, children }) {
    const [menuOpen, setMenuOpen] = R.useState(false);
    const [expanded, setExpanded] = R.useState({});
    const items = R.Children.toArray(children), imports = active === 'importacoes';
    R.useEffect(() => {
      if (!imports) setExpanded(previous => ({ ...previous, [analysis]: true }));
    }, [analysis, active, imports]);
    function navigate(view, type) { onNavigate(view, type); setMenuOpen(false); }
    function link(view, type, text, count) {
      const selected = active === view && analysis === type;
      return h('button', {
        key: view, type: 'button', className: 'sc9-lot-nav-link sc9-lot-sub-link',
        'aria-current': selected ? 'page' : undefined,
        onClick: () => navigate(view, type)
      }, h('span', null, text), h('span', { className: 'sc9-lot-nav-count' }, count || 0));
    }
    const title = imports ? 'Importações' : root.SC9Followup.labelFor(analysis);
    return h('div', { className: 'sc9-lot-workspace' },
      h('aside', { className: 'sc9-lot-sidebar' },
        h('div', { className: 'sc9-lot-sidebar-title' }, h('strong', null, 'Produtos Duplicados'),
          h('button', { type: 'button', className: 'sc9-lot-menu-toggle',
            'aria-expanded': menuOpen, 'aria-controls': 'sc9-lot-navigation',
            onClick: () => setMenuOpen(value => !value) }, menuOpen ? 'Fechar menu' : 'Abrir menu')),
        h('nav', { id: 'sc9-lot-navigation', 'aria-label': 'Seções do cadastro de lotes',
          className: 'sc9-lot-navigation' + (menuOpen ? ' is-open' : '') },
          root.SC9Followup.analyses.map(item => {
            const tab = tabs.find(([id]) => id === item.id);
            if (!tab) return null;
            const open = expanded[item.type] ?? (!imports && analysis === item.type);
            const panelId = 'sc9-lot-analysis-' + item.id;
            const count = String(tab[1]).match(/\((\d+)\)$/)?.[1] || 0;
            return h('section', { key: item.id, className: 'sc9-lot-analysis-group' },
              h('button', {
                type: 'button', className: 'sc9-lot-analysis-toggle',
                'aria-label': item.label, 'aria-expanded': open, 'aria-controls': panelId,
                onClick: () => setExpanded(previous => ({ ...previous, [item.type]: !open }))
              }, h('span', null, item.label), h('span', { 'aria-hidden': true }, open ? '−' : '+')),
              h('div', { id: panelId, hidden: !open, className: 'sc9-lot-sub-tabs' },
                link(item.id, item.type, 'Análise', count),
                link('marcados', item.type, 'Marcados', followup?.marked[item.type]),
                link('finalizados', item.type, 'Finalizados', followup?.finalized[item.type])));
          }),
          h('div', { className: 'sc9-lot-nav-group sc9-lot-bases' },
            h('p', { className: 'sc9-lot-nav-heading' }, 'Bases de dados'),
            h('button', { type: 'button', className: 'sc9-lot-nav-link', 'aria-current': imports ? 'page' : undefined,
              onClick: () => navigate('importacoes') }, 'Importações')))),
      h('div', { className: 'sc9-lot-workspace-content' },
        h('p', { className: 'sc9-lot-current-analysis' }, title,
          !imports && ' / ' + (active === 'marcados' ? 'Marcados' : active === 'finalizados' ? 'Finalizados' : 'Análise')),
        h('section', { hidden: !imports, 'aria-label': 'Importações do cadastro de lotes' },
          h('div', { className: 'sc9-lot-page-heading' },
            h('h2', null, 'Importações'),
            h('p', null, 'Carregue ou atualize o SB8 e as bases complementares.')),
          items[0]),
        h('div', { hidden: imports }, items.slice(1))));
  };
})(window);
