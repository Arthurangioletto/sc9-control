/* Relatório das divergências de entrada do TDC (armazém 59): dados do período + HTML autocontido para imprimir/salvar em PDF.
 * Módulo puro (sem DOM): roda no navegador (window.SC9EntradasTDCRelatorio) e no Node (testes). Todo texto digitado pelo usuário é escapado. */
(function(root){
  'use strict';
  const TIPOS={
    qtd_maior:{rotulo:'Veio MAIS do que a nota',cor:'#B3261E'},
    qtd_menor:{rotulo:'Veio MENOS do que a nota',cor:'#C2630A'},
    item_fora_nota:{rotulo:'Item que NÃO estava na nota',cor:'#7A3FB0'},
    lote_trocado:{rotulo:'Lote trocado / misturado',cor:'#0B6FA4'},
  };
  const ORDEM=['qtd_maior','qtd_menor','item_fora_nota','lote_trocado'];
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtN=(n,d)=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString('pt-BR',{maximumFractionDigits:d==null?1:d});
  const fmtD=iso=>iso&&/^\d{4}-\d{2}-\d{2}/.test(iso)?iso.slice(8,10)+'/'+iso.slice(5,7)+'/'+iso.slice(0,4):'—';
  const fmtDC=iso=>iso&&/^\d{4}-\d{2}-\d{2}/.test(iso)?iso.slice(8,10)+'/'+iso.slice(5,7):'—';
  function fmtAgora(v){
    const d=v instanceof Date?v:new Date(v);if(!Number.isFinite(d.getTime()))return '—';
    const tz='America/Sao_Paulo';
    return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:tz})+' às '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:tz});
  }
  const media=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
  const forn=v=>/^\d+$/.test(String(v||''))?'Forn. '+v:(v||'');

  /* ---------------------------- dados do período ---------------------------- */
  function montarRelatorio(res,achados,{de='',ate='',escopo='notas informadas'}={}){
    const dentro=d=>(!de||(d&&d>=de))&&(!ate||(d&&d<=ate));
    const todos=(achados||[]).filter(a=>a.status!=='descartado'&&(a.status==='confirmado'||a.manual)&&dentro(a.dtEntrada||''))
      .map(a=>({...a,fotos:(a.fotos||[]).slice(),revisao:a.revisao?{...a.revisao}:a.revisao}));
    /* o mesmo erro reportado à mão e já apontado pelo Protheus conta uma vez só: as fotos e a justificativa do relato manual vão para a ficha do Protheus */
    const chaveE=e=>[e.nota,e.serie||'',e.produto,e.lote,e.tipo].join('|');
    const autos=new Map(todos.filter(e=>!e.manual&&e.nota).map(e=>[chaveE(e),e]));
    const erros=[];
    for(const e of todos){
      const a=e.manual&&e.nota?autos.get(chaveE(e)):null;
      if(a){a.fotos=[...new Set([...a.fotos,...e.fotos])].slice(0,4);if(!(a.revisao&&a.revisao.obs)&&e.revisao&&e.revisao.obs)a.revisao={...(a.revisao||{}),obs:e.revisao.obs};continue;}
      erros.push(e);
    }
    erros.sort((a,b)=>(a.dtEntrada||'').localeCompare(b.dtEntrada||'')||String(a.nota).localeCompare(String(b.nota)));
    const itens=((res&&res.itens)||[]).filter(i=>dentro(i.dtEntrada||''));
    const datas=[...itens.map(i=>i.dtEntrada),...erros.map(e=>e.dtEntrada)].filter(Boolean).sort();
    const periodo={de:de||datas[0]||'',ate:ate||datas[datas.length-1]||'',definido:Boolean(de||ate)};
    const kNota=x=>x.nota?x.nota+'|'+(x.serie||''):'';
    const notasConf=new Set(itens.map(kNota).filter(Boolean)),notasErro=new Set(erros.map(kNota).filter(Boolean));
    const porTipo={};for(const t of ORDEM)porTipo[t]={n:0,pecas:0};
    for(const e of erros){const t=porTipo[e.tipo]?e.tipo:'qtd_maior';porTipo[t].n++;porTipo[t].pecas+=Math.abs(Number(e.diferenca)||0);}
    const dia=new Map();for(const e of erros){const d=e.dtEntrada||'';dia.set(d,(dia.get(d)||0)+1);}
    const usu=new Map();for(const e of erros){const u=(e.usuarioTDC||'').trim();if(!u)continue;usu.set(u,(usu.get(u)||0)+1);}
    const chaveErro=new Set(erros.filter(e=>e.nota).map(e=>[e.nota,e.serie||'',e.produto,e.lote].join('|')));
    const comErroItens=itens.filter(i=>chaveErro.has([i.nota,i.serie||'',i.produto,i.lote].join('|'))||i.erroForte);
    const limposItens=itens.filter(i=>!comErroItens.includes(i)&&!i.erro);
    const dLimpos=media(limposItens.filter(i=>i.diasAteConcluir!=null).map(i=>i.diasAteConcluir));
    const dErro=media(comErroItens.filter(i=>i.diasAteConcluir!=null).map(i=>i.diasAteConcluir));
    const pecas=erros.reduce((s,e)=>s+Math.abs(Number(e.diferenca)||0),0);
    return {escopo,periodo,erros,
      kpis:{notasConferidas:notasConf.size,notasComErro:notasErro.size,pctNotas:notasConf.size?notasErro.size/notasConf.size:null,erros:erros.length,pecas,diasLimpos:dLimpos,diasErro:dErro,
        atrasoMedio:dLimpos!=null&&dErro!=null?Math.max(0,dErro-dLimpos):null,comFoto:erros.filter(e=>(e.fotos||[]).length).length},
      porTipo,porDia:[...dia.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([d,n])=>({dia:d,n})),
      porUsuario:[...usu.entries()].sort((a,b)=>b[1]-a[1]).map(([u,n])=>({usuario:u,n}))};
  }
  function manchete(d){
    const k=d.kpis;if(!k.erros)return 'Nenhum erro confirmado pelo estoque no período.';
    let t=`O estoque confirmou <b>${k.erros} erro${k.erros>1?'s':''}</b> de entrada do TDC`;
    if(k.notasConferidas)t+=`, em <b>${k.notasComErro} de ${k.notasConferidas} nota${k.notasConferidas>1?'s':''}</b> conferida${k.notasConferidas>1?'s':''} (${fmtN(k.pctNotas*100,0)}%)`;
    t+=`, somando <b>${fmtN(k.pecas,0)} peça${k.pecas===1?'':'s'}</b> divergente${k.pecas===1?'':'s'}.`;
    if(k.atrasoMedio!=null&&k.atrasoMedio>0)t+=` Entradas com erro levaram em média <b>${fmtN(k.atrasoMedio)} dia${k.atrasoMedio===1?'':'s'} a mais</b> para subir pro 01.`;
    return t;
  }

  /* ---------------------------- gráficos (SVG) ---------------------------- */
  function barrasH(linhas,{largura=420}={}){
    const max=Math.max(1,...linhas.map(l=>l.v)),alt=30,lab=150,val=70,w=largura-lab-val;
    const corpo=linhas.map((l,i)=>{const y=i*alt;const bw=Math.max(l.v?3:0,Math.round(l.v/max*w));
      return `<text x="0" y="${y+19}" class="lb">${esc(l.rotulo)}</text><rect x="${lab}" y="${y+6}" width="${w}" height="14" rx="7" fill="#EEF1F7"/><rect x="${lab}" y="${y+6}" width="${bw}" height="14" rx="7" fill="${l.cor}"/><text x="${lab+w+8}" y="${y+19}" class="vl">${esc(l.texto)}</text>`;}).join('');
    return `<svg viewBox="0 0 ${largura} ${linhas.length*alt+4}" role="img" aria-label="Gráfico de barras">${corpo}</svg>`;
  }
  function colunas(pontos,{largura=420,altura=150,cor='#4F63D2'}={}){
    if(!pontos.length)return '<p class="vazio">Sem dados no período.</p>';
    const max=Math.max(1,...pontos.map(p=>p.n)),base=altura-26,topo=16,w=largura/pontos.length,bw=Math.min(34,w*0.62);
    const passo=Math.ceil(pontos.length/10);
    const corpo=pontos.map((p,i)=>{const h=Math.max(3,Math.round(p.n/max*(base-topo)));const x=i*w+(w-bw)/2;
      return `<rect x="${x.toFixed(1)}" y="${base-h}" width="${bw.toFixed(1)}" height="${h}" rx="4" fill="${cor}"/><text x="${(x+bw/2).toFixed(1)}" y="${base-h-4}" class="vl" text-anchor="middle">${p.n}</text>${i%passo===0?`<text x="${(x+bw/2).toFixed(1)}" y="${altura-8}" class="lb" text-anchor="middle">${esc(fmtDC(p.dia))}</text>`:''}`;}).join('');
    return `<svg viewBox="0 0 ${largura} ${altura}" role="img" aria-label="Erros por dia"><line x1="0" y1="${base}" x2="${largura}" y2="${base}" stroke="#D3DAEA"/>${corpo}</svg>`;
  }

  /* ---------------------------- HTML ---------------------------- */
  const CSS=`
*{box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:#EEF1F7;color:#1B2138;font:14px/1.5 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.pg{max-width:1000px;margin:0 auto;padding:24px}
.cab{background:linear-gradient(135deg,#2C3A8C,#4F63D2);color:#fff;border-radius:18px;padding:28px 32px;display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap}
.cab h1{margin:0 0 6px;font-size:26px;letter-spacing:-.4px}.cab p{margin:0;opacity:.92}
.cab .meta{text-align:right;font-size:13px;line-height:1.7}.cab .meta b{font-weight:650}
.periodo{display:inline-block;margin-top:12px;background:rgba(255,255,255,.18);border-radius:999px;padding:6px 14px;font-weight:650}
.manchete{background:#fff;border:1px solid #D3DAEA;border-left:5px solid #4F63D2;border-radius:12px;padding:16px 20px;margin:18px 0;font-size:15.5px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:18px}
.kpi{background:#fff;border:1px solid #E1E6F2;border-radius:14px;padding:14px 16px}
.kpi span{display:block;font-size:12px;color:#4F587A}.kpi strong{display:block;font-size:28px;letter-spacing:-.5px;margin-top:4px}.kpi em{font-style:normal;font-size:11.5px;color:#6B7496}
.kpi.red strong{color:#B3261E}.kpi.green strong{color:#0A8571}.kpi.amber strong{color:#966119}
.graf{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:22px}
.card{background:#fff;border:1px solid #E1E6F2;border-radius:14px;padding:16px 18px}
.card h2{margin:0 0 2px;font-size:14px}.card p.sub{margin:0 0 10px;font-size:12px;color:#6B7496}
svg{width:100%;height:auto;display:block}svg .lb{font:11.5px sans-serif;fill:#4F587A}svg .vl{font:600 11.5px sans-serif;fill:#1B2138}
.vazio{color:#6B7496;font-size:12.5px;margin:6px 0}
h2.sec{font-size:18px;margin:26px 0 4px}p.secsub{margin:0 0 14px;color:#4F587A;font-size:13px}
.erro{display:grid;grid-template-columns:260px 1fr;gap:0;background:#fff;border:1px solid #E1E6F2;border-radius:16px;overflow:hidden;margin-bottom:16px;break-inside:avoid;page-break-inside:avoid}
.fotos{background:#F3F5FA;padding:12px;display:flex;flex-direction:column;gap:10px;justify-content:center}
.fotos img{width:100%;border-radius:10px;border:1px solid #D3DAEA;display:block;background:#fff}
.sem-foto{border:2px dashed #C9D0E4;border-radius:10px;color:#6B7496;text-align:center;padding:30px 10px;font-size:12.5px}
.corpo{padding:16px 20px;border-left:5px solid var(--c)}
.topo{display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.tag{display:inline-block;background:var(--c);color:#fff;border-radius:999px;padding:3px 12px;font-size:12px;font-weight:650}
.nf{font-weight:650}.dt{color:#6B7496;font-size:12.5px}
.ident{color:#4F587A;font-size:13px;margin-bottom:10px}.ident b{color:#1B2138}
.comp{display:flex;gap:10px;align-items:stretch;margin:6px 0 12px;flex-wrap:wrap}
.comp>div{background:#F3F5FA;border-radius:10px;padding:8px 14px;min-width:120px}.comp small{display:block;font-size:11px;color:#6B7496}.comp strong{font-size:22px}
.comp .seta{background:none;align-self:center;font-size:22px;color:#6B7496;min-width:0;padding:0}
.comp .real{background:#FDECEA}.comp .real strong{color:#B3261E}
.blk{margin-top:10px}.blk h3{margin:0 0 3px;font-size:11.5px;text-transform:uppercase;letter-spacing:.5px;color:#6B7496}
.blk p{margin:0;font-size:13.5px}.just{border-left:3px solid #4F63D2;background:#F6F8FE;padding:8px 12px;border-radius:0 8px 8px 0;font-style:italic}
.mov{margin:4px 0 0;padding:0;list-style:none;font-size:12px;color:#4F587A}.mov li{padding:2px 0}
.rod{font-size:11.5px;color:#6B7496;margin-top:10px;padding-top:8px;border-top:1px dashed #D3DAEA}
.met{background:#fff;border:1px solid #E1E6F2;border-radius:14px;padding:14px 18px;font-size:12.5px;color:#4F587A;margin-top:22px}.met b{color:#1B2138}
.acoes{position:sticky;top:0;z-index:5;background:#EEF1F7;padding:10px 0;display:flex;gap:10px;justify-content:flex-end}
.acoes button{border:0;background:#4F63D2;color:#fff;border-radius:8px;padding:9px 16px;font-weight:650;cursor:pointer}
@media print{body{background:#fff}.pg{padding:0;max-width:none}.acoes{display:none}.cab{border-radius:12px}.kpis{grid-template-columns:repeat(5,1fr);gap:8px}.kpi{padding:10px 12px}.kpi strong{font-size:22px}.card,.kpi,.manchete{break-inside:avoid;page-break-inside:avoid}h2.sec,p.secsub{break-after:avoid;page-break-after:avoid}@page{size:A4;margin:12mm}}
@media(max-width:760px){.graf{grid-template-columns:1fr}.erro{grid-template-columns:1fr}}
`;
  function cartaoErro(e,fotos){
    const T=TIPOS[e.tipo]||{rotulo:e.tipo,cor:'#4F63D2'};const rev=e.revisao||{};
    const imgs=(e.fotos||[]).map(id=>fotos&&fotos[id]?`<img src="${esc(fotos[id])}" alt="Foto do pacote — ${esc(e.nota?'NF '+e.nota:'ficha manual')}">`:'').filter(Boolean);
    const fisico=e.qtdFisica;
    const comp=e.tipo==='lote_trocado'
      ?`<div><small>Lote na nota</small><strong>${esc(e.lote||'—')}</strong></div><div class="seta">→</div><div class="real"><small>Lote no físico</small><strong>${esc(e.loteFisico||'—')}</strong></div>${e.diferenca?`<div><small>Peças afetadas</small><strong>${fmtN(e.diferenca,0)}</strong></div>`:''}`
      :`<div><small>Na nota</small><strong>${fmtN(e.qtdNota,0)}</strong></div><div class="seta">→</div><div class="real"><small>No físico</small><strong>${fisico==null||fisico===''?'—':fmtN(fisico,0)}</strong></div><div><small>Diferença</small><strong>${fmtN(e.diferenca,0)}</strong></div>`;
    const movs=(e.movimentos||[]).slice(0,6).map(m=>`<li>${esc(fmtD(m.dia))} · ${esc(m.cf)} doc ${esc(m.doc)} · ${m.dir==='saida'?'saída':'entrada'} de <b>${fmtN(m.qt,0)}</b> pç · armazém ${esc(m.armazem)} · lote ${esc(m.lote)}</li>`).join('');
    const por=rev.por?`Confirmado por <b>${esc(rev.por)}</b>${rev.em?' em '+esc(fmtAgora(rev.em)):''}`:'';
    return `<article class="erro" style="--c:${T.cor}"><div class="fotos">${imgs.length?imgs.join(''):'<div class="sem-foto">Sem foto anexada</div>'}</div><div class="corpo">
      <div class="topo"><span class="tag">${esc(T.rotulo)}</span><span class="dt">Entrada no 59 em <b>${esc(fmtD(e.dtEntrada))}</b></span></div>
      <div class="ident">${e.nota?`<span class="nf">NF ${esc(e.nota)}${e.serie?'/'+esc(e.serie):''}</span> · ${esc(forn(e.fornecedor)||'fornecedor não informado')}`:'<span class="nf">Sem nota no SD1</span>'} · Produto <b>${esc(e.produto)}</b>${e.tipo!=='lote_trocado'&&e.lote?' · lote '+esc(e.lote):''}${e.usuarioTDC?' · lançada por <b>'+esc(e.usuarioTDC)+'</b>':''}</div>
      <div class="comp">${comp}</div>
      ${(e.protheus||e.descricao)?`<div class="blk"><h3>O que o Protheus mostra</h3><p>${esc(e.protheus||e.descricao)}</p>${movs?`<ul class="mov">${movs}</ul>`:''}</div>`:''}
      ${rev.obs?`<div class="blk"><h3>Justificativa do estoque</h3><p class="just">“${esc(rev.obs)}”</p></div>`:''}
      ${por?`<div class="rod">${por}</div>`:''}</div></article>`;
  }
  function gerarHTML(d,{fotos={},geradoEm=new Date(),geradoPor='',cobertura={}}={}){
    const k=d.kpis,p=d.periodo;
    const tipoLinhas=ORDEM.map(t=>({rotulo:TIPOS[t].rotulo,v:d.porTipo[t].n,cor:TIPOS[t].cor,texto:d.porTipo[t].n+' · '+fmtN(d.porTipo[t].pecas,0)+' pç'}));
    const dias=[['Entradas sem erro',k.diasLimpos,'#0A8571'],['Entradas com erro',k.diasErro,'#C2453B']];
    const maxD=Math.max(1,...dias.map(x=>x[1]||0));
    const tempoLinhas=dias.map(x=>({rotulo:x[0],v:(x[1]||0)/maxD*100,cor:x[2],texto:x[1]==null?'—':fmtN(x[1])+' d'}));
    const usuarioBloco=d.porUsuario.length?`<div class="card"><h2>Por quem lançou no TDC</h2><p class="sub">Erros confirmados por usuário que deu entrada na nota.</p>${barrasH(d.porUsuario.slice(0,8).map(u=>({rotulo:u.usuario,v:u.n,cor:'#4F63D2',texto:String(u.n)})))}</div>`:'';
    const metodo=[cobertura.sd1Ate?'SD1 (notas de entrada) até '+esc(fmtD(cobertura.sd1Ate)):'',cobertura.sd3Ate?'SD3 (movimentação) até '+esc(fmtD(cobertura.sd3Ate)):''].filter(Boolean).join(' · ');
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Relatório de divergências — Entradas do TDC (59) — ${esc(fmtD(p.de))} a ${esc(fmtD(p.ate))}</title><style>${CSS}</style></head><body><div class="pg">
<div class="acoes"><button onclick="window.print()">Imprimir / salvar em PDF</button></div>
<header class="cab"><div><h1>Divergências nas entradas do TDC</h1><p>Armazém 59 · nota de entrada (SD1) × movimentação do Protheus (SD3)</p><span class="periodo">Período: ${esc(fmtD(p.de))} a ${esc(fmtD(p.ate))}${p.definido?'':' (todas as entradas conferidas)'}</span></div>
<div class="meta">Relatório gerado em<br><b>${esc(fmtAgora(geradoEm))}</b>${geradoPor?'<br>por <b>'+esc(geradoPor)+'</b>':''}<br>Base: ${esc(d.escopo)}</div></header>
<div class="manchete">${manchete(d)}</div>
<div class="kpis">
<div class="kpi"><span>Notas conferidas</span><strong>${fmtN(k.notasConferidas,0)}</strong><em>no período</em></div>
<div class="kpi red"><span>Notas com erro</span><strong>${fmtN(k.notasComErro,0)}</strong><em>${k.pctNotas==null?'':fmtN(k.pctNotas*100,0)+'% das conferidas'}</em></div>
<div class="kpi red"><span>Erros confirmados</span><strong>${fmtN(k.erros,0)}</strong><em>${fmtN(k.comFoto,0)} com foto do pacote</em></div>
<div class="kpi amber"><span>Peças divergentes</span><strong>${fmtN(k.pecas,0)}</strong><em>diferença entre nota e físico</em></div>
<div class="kpi green"><span>Dias até subir pro 01</span><strong>${k.diasLimpos==null?'—':fmtN(k.diasLimpos)}</strong><em>sem erro${k.diasErro!=null?' · com erro: '+fmtN(k.diasErro):''}</em></div></div>
<div class="graf">
<div class="card"><h2>Que tipo de erro acontece</h2><p class="sub">Ocorrências confirmadas e peças envolvidas.</p>${barrasH(tipoLinhas)}</div>
<div class="card"><h2>Quanto o erro atrasa</h2><p class="sub">Média de dias da entrada no 59 até a última peça subir pro 01.</p>${barrasH(tempoLinhas)}${k.atrasoMedio!=null&&k.atrasoMedio>0?`<p class="sub" style="margin-top:8px">Diferença média: <b>${fmtN(k.atrasoMedio)} dia(s)</b> a mais quando há erro.</p>`:''}</div>
<div class="card"><h2>Erros por dia de entrada</h2><p class="sub">Quantos erros confirmados vieram de entradas de cada dia.</p>${colunas(d.porDia,{cor:'#C2453B'})}</div>
${usuarioBloco}</div>
<h2 class="sec">Os erros, um a um</h2><p class="secsub">Cada ficha traz a foto do pacote, o que o Protheus registrou e a justificativa de quem conferiu no físico.</p>
${d.erros.length?d.erros.map(e=>cartaoErro(e,fotos)).join(''):'<div class="card"><p class="vazio">Nenhum erro confirmado neste período.</p></div>'}
<div class="met"><b>Como ler:</b> só entram erros <b>confirmados pelo estoque</b> (suspeitas descartadas ou ainda não conferidas ficam de fora). O Protheus aponta o que foi corrigido no sistema; as fichas manuais registram o que foi visto no físico.${metodo?' <br><b>Dados usados:</b> '+metodo+'.':''}</div>
</div></body></html>`;
  }

  const api={montarRelatorio,gerarHTML,manchete,esc,barrasH,colunas,fmtAgora};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.SC9EntradasTDCRelatorio=api;
})(typeof window==='object'?window:globalThis);
