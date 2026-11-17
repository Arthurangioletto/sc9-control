/* Botão "Consolidado" do painel: escolhe semana ou mês e baixa o Excel do consolidado (Cambuci + filiais). */
(function (root) {
  const React = root.React;
  if (!React || !root.SC9Consolidado) return;
  const h = React.createElement;
  const C = () => root.SC9Consolidado;
  const cor = { panel: '#FFFFFF', border: '#dde4ef', ink: '#14233d', mute: '#526079', accent: '#123b7a', soft: '#f3f6fb', red: '#c63828' };
  const baseBtn = { border: '1px solid ' + cor.border, background: cor.panel, color: cor.mute };

  function Consolidado(props) {
    const data = props.data;
    const [aberto, setAberto] = React.useState(false);
    const [tipo, setTipo] = React.useState('semana');
    const [escolha, setEscolha] = React.useState('');
    const [erro, setErro] = React.useState('');
    const [lado, setLado] = React.useState('right');
    const caixa = React.useRef(null);
    const per = React.useMemo(() => (data && data.items ? C().periodos(data.items) : { semanas: [], meses: [] }), [data && data.items]);
    const lista = tipo === 'mes' ? per.meses : per.semanas;
    const atual = lista.find(p => p.id === escolha) || lista.find(p => !p.parcial) || lista[0] || null; // padrão: o último período fechado

    React.useEffect(() => {
      if (!aberto) return undefined;
      const fora = ev => { if (caixa.current && !caixa.current.contains(ev.target)) setAberto(false); };
      const esc = ev => { if (ev.key === 'Escape') setAberto(false); };
      document.addEventListener('mousedown', fora); document.addEventListener('keydown', esc);
      return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
    }, [aberto]);

    const baixar = () => {
      if (!atual) return;
      try {
        const r = C().construir(data, atual.de, atual.ate);
        const livro = C().paraPlanilha(r);
        root.SC9Exports.downloadWorkbook(livro, C().nomeArquivo(atual.de, atual.ate, tipo));
        setErro(r.avisos.join(' '));
      } catch (e) { setErro(e.message || 'Não consegui gerar o consolidado.'); }
    };

    const seg = (id, rotulo) => h('button', {
      key: id, type: 'button', 'aria-pressed': tipo === id,
      onClick: () => { setTipo(id); setEscolha(''); setErro(''); },
      style: { flex: 1, padding: '6px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: '1px solid ' + cor.border, background: tipo === id ? cor.accent : cor.panel, color: tipo === id ? '#fff' : cor.mute, borderRadius: id === 'semana' ? '8px 0 0 8px' : '0 8px 8px 0' }
    }, rotulo);

    return h('div', { ref: caixa, style: { position: 'relative' } },
      h('button', {
        type: 'button', onClick: () => { if (!aberto && caixa.current) setLado(caixa.current.getBoundingClientRect().right - 300 < 8 ? 'left' : 'right'); setAberto(!aberto); }, 'aria-expanded': aberto, className: 'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium', style: baseBtn,
        title: 'Baixa o consolidado de Cambuci e filiais (semana ou mês) com Dashboard, Base de Dados, Ranking e Transportadora'
      }, 'Consolidado'),
      aberto && h('div', { role: 'dialog', 'aria-label': 'Exportar consolidado', style: { position: 'absolute', [lado]: 0, top: '100%', marginTop: 6, zIndex: 60, width: 300, maxWidth: 'calc(100vw - 32px)', padding: 14, borderRadius: 12, background: cor.panel, border: '1px solid ' + cor.border, boxShadow: '0 12px 32px rgba(20,35,61,.18)', color: cor.ink } },
        h('div', { style: { fontSize: 13, fontWeight: 700, marginBottom: 4 } }, 'Consolidado Cambuci + filiais'),
        h('div', { style: { fontSize: 11, color: cor.mute, marginBottom: 10 } }, 'Cambuci, BH, CE, DF e RJ · sem pedidos Implacil · status pela Entrega (Cambuci) e NF (filiais).'),
        h('div', { style: { display: 'flex', marginBottom: 10 } }, seg('semana', 'Semana'), seg('mes', 'Mês')),
        lista.length
          ? h('select', { value: atual ? atual.id : '', onChange: ev => { setEscolha(ev.target.value); setErro(''); }, 'aria-label': tipo === 'mes' ? 'Mês' : 'Semana', style: { width: '100%', padding: '7px 8px', fontSize: 13, borderRadius: 8, border: '1px solid ' + cor.border, background: cor.soft, color: cor.ink } },
            lista.map(p => h('option', { key: p.id, value: p.id }, p.label)))
          : h('div', { style: { fontSize: 12, color: cor.red } }, 'Carregue a base SC9 pra escolher o período.'),
        h('button', { type: 'button', onClick: baixar, disabled: !atual, style: { marginTop: 12, width: '100%', padding: '8px 12px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', cursor: atual ? 'pointer' : 'not-allowed', background: cor.accent, color: '#fff', opacity: atual ? 1 : .5 } }, 'Baixar Excel'),
        erro && h('div', { role: 'alert', style: { marginTop: 8, fontSize: 11, color: cor.red } }, erro)
      )
    );
  }

  // Chamada pelo painel (bundle.js) dentro do cabeçalho; o componente é fixo pra não perder o estado a cada render.
  root.SC9Consolidado.button = function (props) { return h(Consolidado, props); };
})(typeof window === 'object' ? window : globalThis);
