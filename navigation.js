/* Shared navigation: all routes come from the tabs authorized by the app. */
(function(root){
  const R=root.React,h=R.createElement;
  const groups=[
    {name:'Visão geral',description:'Resumo e prioridades',icon:'grid',ids:['geral','dashboard','alertas','criticos']},
    {name:'Operação',description:'Acompanhe cada etapa',icon:'route',ids:['fluxo','controle0201','controle','saida','recebimento','expedicao','movimentacao']},
    {name:'Produtividade',description:'Equipe e desempenho',icon:'chart',ids:['separadores','conferencia','performance','horarios']},
    {name:'Análises',description:'Clientes, produtos e evolução',icon:'trend',ids:['clientes','itens','tendencias']},
    {name:'Administração',description:'Cadastros e acessos',icon:'settings',ids:['alteracoes_sep','cadastro_sb8','acessos']}
  ];
  const pages={
    geral:{label:'Resumo da operação',icon:'grid',description:'Indicadores e prioridades no recorte selecionado.'},
    dashboard:{label:'Monitor ao vivo',icon:'chart',description:'Filas, pendências e tempos de espera da operação.'},
    alertas:{icon:'alert',description:'Identifique pendências e situações que exigem atenção.'},
    criticos:{icon:'alert',description:'Consulte os itens prioritários do recorte selecionado.'},
    fluxo:{icon:'route',description:'Acompanhe os pedidos nas etapas do fluxo operacional.'},
    controle0201:{label:'Controle 02 → 01',icon:'swap',description:'Registre envios e confira recebimentos entre os armazéns 02 e 01.'},
    controle:{label:'Controle 02 → 01',icon:'swap',description:'Registre envios e confira recebimentos entre os armazéns 02 e 01.'},
    saida:{label:'Saída para expedição',icon:'out',description:'Confira os pedidos encaminhados para expedição.'},
    recebimento:{label:'Recebimento',icon:'in',description:'Acompanhe os pedidos recebidos e suas conferências.'},
    expedicao:{icon:'box',description:'Consulte a situação dos pedidos e da expedição.'},
    movimentacao:{icon:'swap',description:'Consulte transferências e movimentações internas.'},
    separadores:{icon:'users',description:'Acompanhe volumes e atividade de separação no período.'},
    conferencia:{icon:'check',description:'Consulte os resultados e a atividade de conferência.'},
    performance:{icon:'chart',description:'Compare os indicadores de desempenho no recorte atual.'},
    horarios:{icon:'clock',description:'Veja a distribuição da atividade ao longo da operação.'},
    clientes:{icon:'users',description:'Analise os pedidos e volumes por cliente.'},
    itens:{label:'Produtos · Curva ABC',icon:'box',description:'Analise os produtos e sua participação nos volumes da operação.'},
    tendencias:{icon:'trend',description:'Compare a evolução dos resultados ao longo do tempo.'},
    alteracoes_sep:{label:'Revisão de alterações',icon:'edit',description:'Confira as alterações e os registros que precisam de revisão.'},
    cadastro_sb8:{label:'Cadastro de lotes',icon:'box',description:'Consulte lotes, saldos, vencimentos e divergências de estoque.',keywords:'SB8 estoque produtos filiais validade duplicados'},
    acessos:{icon:'lock',description:'Gerencie usuários e os perfis de acesso ao sistema.'}
  };
  const paths={
    grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    route:'M4 5h5v5H4zM15 14h5v5h-5zM9 7h6a3 3 0 0 1 3 3v4M6 10v7h9',
    chart:'M4 3v17h17M8 16v-5M13 16V7M18 16V4',
    trend:'M3 17l6-6 4 4 8-10M15 5h6v6',
    settings:'M4 7h16M4 17h16M9 4v6M15 14v6',
    swap:'M3 7h17l-4-4M21 17H4l4 4',
    out:'M4 4h9v4M13 16v4H4V4M9 12h12l-4-4M21 12l-4 4',
    in:'M11 4h9v16h-9v-4M3 12h12l-4-4M15 12l-4 4',
    box:'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
    users:'M4 20v-3a4 4 0 0 1 4-4h3a4 4 0 0 1 4 4v3M16 5a3 3 0 0 1 0 6M18 14a4 4 0 0 1 3 4v2M12 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    check:'M4 4h16v16H4zM8 12l3 3 5-6',
    clock:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 7v5l3 2',
    edit:'M14 5l5 5M4 20l2-7L17 2l5 5-11 11z',
    lock:'M5 10h14v11H5zM8 10V7a4 4 0 0 1 8 0v3M12 14v3',
    alert:'M12 3l10 18H2zM12 9v5M12 17v1',
    search:'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0M15 15l6 6'
  };
  function Icon({name,className=''}){return h('svg',{className:'sc9-nav-icon '+className,width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.6,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d:paths[name]||paths.grid}));}
  const normalize=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  function page(tab){const [id,originalLabel]=tab,meta=pages[id]||{};return {id,originalLabel,...meta,label:meta.label||originalLabel,icon:meta.icon||'grid',description:meta.description||'Consulte as informações desta área.'};}
  function availableSections(tabs,query=''){
    const known=new Set(groups.flatMap(group=>group.ids)),extra=tabs.filter(([id])=>!known.has(id));
    const sections=extra.length?[...groups,{name:'Outras telas',icon:'grid',description:'Outras funções disponíveis',ids:extra.map(([id])=>id)}]:groups;
    const terms=normalize(query).split(/\s+/).filter(Boolean);
    return sections.map(group=>({...group,items:group.ids.map(id=>tabs.find(([tab])=>tab===id)).filter(Boolean).map(page).filter(item=>terms.every(term=>normalize([item.label,item.originalLabel,item.description,item.keywords,group.name].join(' ')).includes(term)))})).filter(group=>group.items.length);
  }
  root.SC9NavigationModel={availableSections,page};
  root.SC9Navigation=function SC9Navigation({tabs,active,onNavigate}){
    const [mobileOpen,setMobileOpen]=R.useState(false),[expanded,setExpanded]=R.useState({}),[query,setQuery]=R.useState('');
    const [collapsed,setCollapsed]=R.useState(()=>{try{return root.localStorage.getItem('sc9-sidebar-collapsed')==='true';}catch{return false;}});
    const [desktop,setDesktop]=R.useState(()=>root.matchMedia?root.matchMedia('(min-width:1024px)').matches:true);
    R.useEffect(()=>{if(!root.matchMedia)return;const media=root.matchMedia('(min-width:1024px)'),changed=e=>setDesktop(e.matches);media.addEventListener('change',changed);return()=>media.removeEventListener('change',changed);},[]);
    const allSections=availableSections(tabs),sections=availableSections(tabs,query),current=tabs.find(([id])=>id===active),selected=current?page(current):{label:'Painel de controle',icon:'grid',description:'Escolha uma área no menu para continuar.'};
    const section=allSections.find(group=>group.ids.includes(active)),rail=desktop&&collapsed,results=sections.flatMap(group=>group.items);
    R.useEffect(()=>{if(section)setExpanded(previous=>({...previous,[section.name]:true}));},[active]);
    function toggleSidebar(){const next=!collapsed;setCollapsed(next);setQuery('');try{root.localStorage.setItem('sc9-sidebar-collapsed',String(next));}catch{}}
    function navigate(id){if(!tabs.some(([tab])=>tab===id))return;onNavigate(id);setMobileOpen(false);setQuery('');const group=allSections.find(g=>g.ids.includes(id));if(group)setExpanded(previous=>({...previous,[group.name]:true}));}
    return h(R.Fragment,null,
      h('div',{className:'sc9-page-heading'},h('div',{className:'sc9-page-heading-main'},h('span',{className:'sc9-page-heading-icon'},h(Icon,{name:selected.icon})),h('div',null,h('nav',{className:'sc9-breadcrumb','aria-label':'Localização atual'},h('span',null,'SC9 Control'),h('span',{'aria-hidden':true},'/'),h('span',null,section?.name||'Painel')),h('h1',null,selected.label),h('p',{className:'sc9-page-description'},selected.description))),h('button',{type:'button',className:'sc9-menu-toggle',onClick:()=>setMobileOpen(!mobileOpen),'aria-expanded':mobileOpen,'aria-controls':'sc9-navigation'},mobileOpen?'Fechar menu':'Abrir menu')),
      h('aside',{className:'sc9-sidebar'+(mobileOpen?' is-open':'')+(rail?' is-collapsed':'')},
        h('div',{className:'sc9-brand'},h('span',{className:'sc9-brand-mark','aria-hidden':true},'S9'),h('div',null,h('strong',null,'SC9 Control'),h('span',null,'Gestão da operação')),h('button',{type:'button',className:'sc9-sidebar-collapse',onClick:toggleSidebar,'aria-expanded':!rail,'aria-controls':'sc9-navigation','aria-label':rail?'Expandir barra lateral':'Recolher barra lateral',title:rail?'Expandir barra lateral':'Recolher barra lateral'},h('svg',{width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.8,'aria-hidden':true},h('rect',{x:3,y:4,width:18,height:16,rx:3}),h('path',{d:'M9 4v16'})))),
        !rail&&h('div',{className:'sc9-nav-search'},h(Icon,{name:'search'}),h('input',{type:'search',value:query,onChange:e=>setQuery(e.target.value),onKeyDown:e=>{if(e.key==='Escape')setQuery('');if(e.key==='Enter'&&results.length===1){e.preventDefault();navigate(results[0].id);}},placeholder:'Buscar tela…','aria-label':'Buscar tela no menu',autoComplete:'off'}),query&&h('button',{type:'button',onClick:()=>setQuery(''),'aria-label':'Limpar busca de telas'},'×')),
        h('nav',{id:'sc9-navigation','aria-label':'Áreas do painel'},sections.map(group=>{
          const open=!!query||rail||(expanded[group.name]??group.ids.includes(active)),panelId='sc9-group-'+allSections.findIndex(g=>g.name===group.name);
          return h('section',{key:group.name,className:'sc9-nav-section'},h('button',{type:'button',className:'sc9-group-toggle','aria-expanded':open,'aria-controls':panelId,title:group.description,onClick:()=>setExpanded(previous=>({...previous,[group.name]:!open}))},h('span',{className:'sc9-group-name'},h(Icon,{name:group.icon}),group.name),h('span',{className:'sc9-group-meta','aria-hidden':true},h('span',{className:'sc9-group-count'},group.items.length),h('span',null,open?'−':'+'))),h('div',{id:panelId,hidden:!open},group.items.map(item=>{const count=item.id==='controle0201'&&item.originalLabel.match(/\((\d+)\)$/);return h('button',{type:'button',key:item.id,className:'sc9-nav-link'+(item.id===active?' is-active':''),'aria-label':item.label+(count?' · '+count[1]+' aguardando':''),'aria-current':item.id===active?'page':undefined,title:rail?item.label:item.description,onClick:()=>navigate(item.id)},h(Icon,{name:item.icon}),h('span',{className:'sc9-nav-label'},item.label),count&&h('span',{className:'sc9-nav-count','aria-label':count[1]+' aguardando'},count[1]));})));})),
        !sections.length&&h('p',{className:'sc9-nav-empty',role:'status'},'Nenhuma tela encontrada. Tente outro nome.'),
        !rail&&h('div',{className:'sc9-sidebar-footer',role:query?'status':undefined},query?results.length+(results.length===1?' tela encontrada':' telas encontradas'):tabs.length+(tabs.length===1?' tela disponível no seu perfil':' telas disponíveis no seu perfil'))));
  };
})(window);

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

/* Operational details stay in the document flow; product records retain Sheet. */
(function(root){
  const R=root.React,h=R.createElement;
  root.SC9UI.InlineDetails=function InlineDetails({title,subtitle,children,onClose,footer,closeLabel='Recolher lista',showListHelp=true}){
    const reference=R.useRef(null),id=R.useId();
    R.useEffect(()=>{
      const section=reference.current;if(!section)return;
      const previous=root.document.activeElement;
      section.scrollIntoView({behavior:'smooth',block:'start'});section.focus({preventScroll:true});
      return()=>{if(previous?.isConnected&&(section.contains(root.document.activeElement)||root.document.activeElement===root.document.body))previous.focus({preventScroll:true});};
    },[title]);
    return h('section',{ref:reference,className:'sc9-inline-details',tabIndex:-1,'aria-labelledby':id,'aria-describedby':subtitle?id+'-subtitle':undefined,onKeyDown:event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}}},
      h('div',{className:'sc9-inline-details-heading'},h('div',null,h('h2',{id},title),subtitle&&h('p',{id:id+'-subtitle'},subtitle)),h('button',{type:'button',className:'sc9-ui-button',onClick:onClose,'aria-label':closeLabel},closeLabel)),
      showListHelp&&h('p',{className:'sc9-inline-details-help'},'Até 50 pedidos por página. A exportação inclui a lista completa.'),
      h('div',{className:'sc9-inline-details-body'},children),footer&&h('div',{className:'sc9-inline-details-footer'},footer));
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
        h('div', { className: 'sc9-lot-sidebar-title' }, h('strong', null, 'Estoque e lotes'),
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
