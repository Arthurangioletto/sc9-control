/* Botão "Histórico de Atraso" do painel, ao lado do Relatório Geral: escolhe o mês e baixa o Excel com uma aba por dia
 * e o comparativo com o dia anterior. Baixar também grava a foto de hoje no servidor (os dias anteriores não são apagados). */
(function (root) {
  const React = root.React;
  if (!React || !root.SC9AtrasoHistoricoXlsx) return;
  const h = React.createElement;
  const X = () => root.SC9AtrasoHistoricoXlsx;
  const cor = { panel: '#FFFFFF', border: '#dde4ef', ink: '#14233d', mute: '#526079', accent: '#123b7a', soft: '#f3f6fb', red: '#c63828' };

  function HistoricoAtraso(props) {
    const [aberto, setAberto] = React.useState(false);
    const [meses, setMeses] = React.useState([]);
    const [escolha, setEscolha] = React.useState('');
    const [erro, setErro] = React.useState('');
    const [gerando, setGerando] = React.useState(false);
    const [lado, setLado] = React.useState('right');
    const caixa = React.useRef(null);
    const [link, setLink] = React.useState(undefined); // undefined = carregando; null = sem link; texto = código
    const [copiado, setCopiado] = React.useState(false);
    const atual = meses.find(m => m.id === escolha) || meses[0] || null;

    React.useEffect(() => {
      if (!aberto) return undefined;
      let vivo = true;
      X().listarMeses().then(l => { if (vivo) setMeses(l); }).catch(() => { if (vivo) setMeses([]); });
      fetch('/api/atraso-historico-link', { cache: 'no-store' }).then(r => (r.ok ? r.json() : { token: null })).then(j => { if (vivo) setLink(j.token || null); }).catch(() => { if (vivo) setLink(null); });
      const fora = ev => { if (caixa.current && !caixa.current.contains(ev.target)) setAberto(false); };
      const esc = ev => { if (ev.key === 'Escape') setAberto(false); };
      document.addEventListener('mousedown', fora); document.addEventListener('keydown', esc);
      return () => { vivo = false; document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc); };
    }, [aberto]);

    const baixar = async () => {
      if (gerando) return;
      setGerando(true); setErro('');
      try {
        const r = await X().baixar({ orders: props.orders, agora: props.agora, sc5: props.sc5, entrega: props.entrega, faturamento: props.faturamento, valores: props.valores, mes: atual ? atual.id : undefined });
        if (!r.salvo) setErro('Baixei o Excel, mas não consegui gravar a foto de hoje no servidor.');
      } catch (e) { setErro(e.message || 'Não consegui gerar o histórico de atraso.'); }
      finally { setGerando(false); }
    };

    const urlDoLink = link ? location.origin + '/historico-atraso.html?k=' + link : '';
    const mudarLink = async (acao) => {
      setErro(''); setCopiado(false);
      if (acao === 'gerar' && link && !root.confirm('Gerar um link novo desativa o link antigo (quem estiver com ele deixa de ver). Continuar?')) return;
      try {
        const r = await fetch('/api/atraso-historico-link', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SC9-App': '1' }, body: JSON.stringify({ acao }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'não consegui mudar o link');
        setLink(j.token || null);
      } catch (e) { setErro(e.message || 'Não consegui mudar o link.'); }
    };
    const copiar = async () => {
      try { await root.navigator.clipboard.writeText(urlDoLink); setCopiado(true); } catch (e) { setErro('Não consegui copiar sozinho. Selecione o endereço e copie.'); }
    };
    const miniBtn = { padding: '6px 10px', fontSize: 12, fontWeight: 700, borderRadius: 8, border: '1px solid ' + cor.border, background: cor.panel, color: cor.ink, cursor: 'pointer' };

    return h('div', { ref: caixa, style: { position: 'relative' } },
      h('button', {
        type: 'button', 'aria-expanded': aberto, className: 'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium',
        style: { border: '1px solid ' + cor.border, background: cor.panel, color: cor.mute },
        onClick: () => { if (!aberto && caixa.current) setLado(caixa.current.getBoundingClientRect().right - 320 < 8 ? 'left' : 'right'); setAberto(!aberto); },
        title: 'Baixa o histórico de atraso do mês: uma aba por dia, com o comparativo com o dia anterior'
      }, 'Histórico de Atraso'),
      aberto && h('div', { role: 'dialog', 'aria-label': 'Exportar histórico de atraso', style: { position: 'absolute', [lado]: 0, top: '100%', marginTop: 6, zIndex: 60, width: 320, maxWidth: 'calc(100vw - 32px)', padding: 14, borderRadius: 12, background: cor.panel, border: '1px solid ' + cor.border, boxShadow: '0 12px 32px rgba(20,35,61,.18)', color: cor.ink } },
        h('div', { style: { fontSize: 13, fontWeight: 700, marginBottom: 4 } }, 'Histórico de Atraso'),
        h('div', { style: { fontSize: 11, color: cor.mute, marginBottom: 10 } }, 'Uma aba por dia com os pedidos em atraso (estoque e faturamento), peças, transportadora e o comparativo com o dia anterior. Ao baixar, a foto de hoje é gravada; os dias anteriores ficam guardados.'),
        h('select', { value: atual ? atual.id : '', onChange: ev => { setEscolha(ev.target.value); setErro(''); }, 'aria-label': 'Mês', style: { width: '100%', padding: '7px 8px', fontSize: 13, borderRadius: 8, border: '1px solid ' + cor.border, background: cor.soft, color: cor.ink } },
          meses.map(m => h('option', { key: m.id, value: m.id }, m.label + (m.dias ? ' · ' + m.dias + (m.dias === 1 ? ' dia gravado' : ' dias gravados') : '')))),
        h('button', { type: 'button', onClick: baixar, disabled: gerando, style: { marginTop: 12, width: '100%', padding: '8px 12px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', cursor: gerando ? 'not-allowed' : 'pointer', background: cor.accent, color: '#fff', opacity: gerando ? .5 : 1 } }, gerando ? 'Gerando…' : 'Baixar Excel'),
        h('a', { href: '/historico-atraso.html', target: '_blank', rel: 'noopener', style: { display: 'block', marginTop: 10, textAlign: 'center', fontSize: 12, fontWeight: 700, color: cor.accent, textDecoration: 'underline' }, title: 'Página com link fixo: escolha um dia e veja todos os pedidos em atraso, o comparativo e os despachos por dia' }, 'Abrir a página do histórico (link para acompanhar)'),
        h('div', { style: { marginTop: 12, paddingTop: 10, borderTop: '1px solid ' + cor.border } },
          h('div', { style: { fontSize: 12, fontWeight: 700, marginBottom: 4 } }, 'Link para qualquer pessoa ver (sem senha)'),
          link === undefined ? h('div', { style: { fontSize: 11, color: cor.mute } }, 'Carregando…')
            : link ? h('div', null,
              h('input', { readOnly: true, value: urlDoLink, 'aria-label': 'Link sem senha', onFocus: ev => ev.target.select(), style: { width: '100%', padding: '6px 8px', fontSize: 11, border: '1px solid ' + cor.border, borderRadius: 8, color: cor.mute } }),
              h('div', { style: { display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' } },
                h('button', { type: 'button', onClick: copiar, style: miniBtn }, copiado ? 'Copiado!' : 'Copiar link'),
                h('button', { type: 'button', onClick: () => mudarLink('gerar'), style: miniBtn, title: 'O link antigo deixa de funcionar' }, 'Gerar novo'),
                h('button', { type: 'button', onClick: () => mudarLink('desativar'), style: { ...miniBtn, color: cor.red } }, 'Desativar')),
              h('div', { style: { fontSize: 11, color: cor.mute, marginTop: 4 } }, 'Quem tiver este link vê os pedidos em atraso, sem login. Só leitura.'))
              : h('div', null,
                h('div', { style: { fontSize: 11, color: cor.mute, marginBottom: 6 } }, 'Ainda não existe. Ao gerar, qualquer pessoa com o link vê o histórico sem senha (só leitura).'),
                h('button', { type: 'button', onClick: () => mudarLink('gerar'), style: miniBtn }, 'Gerar link sem senha'))),
        erro && h('div', { role: 'alert', style: { marginTop: 8, fontSize: 11, color: cor.red } }, erro)
      )
    );
  }

  root.SC9AtrasoHistorico = { button: props => h(HistoricoAtraso, props) };
})(typeof window === 'object' ? window : globalThis);
