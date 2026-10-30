/* Entradas do TDC no 59 — tela (dashboard + fichário + envio do SD1). Módulo aditivo: monta sozinho
 * um botão flutuante "Entradas TDC" e um painel por cima do app. Não altera nenhuma tela existente.
 * Depende de: entradas-tdc.js (modelo), React/ReactDOM (CDN) e SheetJS (window.XLSX). */
(function(root){
  'use strict';
  if(!root.document||!root.React||!root.ReactDOM||!root.SC9EntradasTDC)return;
  const M=root.SC9EntradasTDC,R=root.React,h=R.createElement,{useState,useEffect,useMemo,useCallback}=R;
  const forn=v=>/^\d+$/.test(String(v||''))?'Forn. '+v:(v||'');
  const fmtN=n=>n==null||n===''?'—':Number(n).toLocaleString('pt-BR',{maximumFractionDigits:2});
  const fmtD=iso=>iso?iso.split('-').reverse().join('/'):'—';
  const fmtDH=iso=>{try{return new Date(iso).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});}catch(e){return iso||'';}};
  const pct=x=>(Math.round(x*1000)/10).toLocaleString('pt-BR')+'%';

  /* ------------------------------ estilos ------------------------------ */
  const CSS=`
#sc9-tdc-root{font-family:inherit;color:var(--sc9-ink,#1B2138)}
.sc9-tdc-fab{position:fixed;right:20px;bottom:20px;z-index:55;border:0;border-radius:999px;padding:12px 18px;background:var(--sc9-accent,#4F63D2);color:#fff;font-family:inherit;font-weight:600;font-size:13px;box-shadow:0 6px 20px rgba(40,50,110,.28);cursor:pointer}
.sc9-tdc-fab:hover{filter:brightness(1.08)}
.sc9-tdc-fab b{display:inline-block;margin-left:8px;padding:2px 7px;border-radius:99px;background:#fff;color:var(--sc9-accent,#4F63D2);font-size:11px}
.sc9-tdc-overlay{position:fixed;inset:0;z-index:70;background:var(--sc9-bg,#F3F5FA);overflow:auto;font-size:13px}
.sc9-tdc-top{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:16px;padding:14px 24px;background:var(--sc9-panel,#fff);border-bottom:1px solid var(--sc9-border-soft,#E5E9F3);flex-wrap:wrap}
.sc9-tdc-top h1{font-size:17px;font-weight:650;margin:0;flex:1;min-width:220px}
.sc9-tdc-top h1 small{display:block;font-size:11px;font-weight:400;color:var(--sc9-dim,#6B7496);margin-top:3px}
.sc9-tdc-tabs{display:flex;gap:4px;background:var(--sc9-panel2,#F1F3F9);padding:4px;border-radius:10px}
.sc9-tdc-tab{border:0;background:transparent;padding:8px 14px;border-radius:7px;font-family:inherit;font-weight:500;font-size:13px;color:var(--sc9-muted,#4F587A);cursor:pointer}
.sc9-tdc-tab[aria-selected=true]{background:var(--sc9-panel,#fff);color:var(--sc9-accent,#4F63D2);font-weight:650;box-shadow:0 1px 3px rgba(40,50,110,.15)}
.sc9-tdc-body{max-width:1240px;margin:0 auto;padding:22px 24px 60px}
.sc9-tdc-btn{border:1px solid var(--sc9-border,#D3DAEA);background:var(--sc9-panel,#fff);color:var(--sc9-ink,#1B2138);border-radius:8px;padding:8px 14px;font-family:inherit;font-weight:500;font-size:12.5px;cursor:pointer}
.sc9-tdc-btn:hover{background:var(--sc9-highlight,#E4EAFB)}
.sc9-tdc-btn.pri{background:var(--sc9-accent,#4F63D2);border-color:var(--sc9-accent,#4F63D2);color:#fff}
.sc9-tdc-btn.ok{background:#0A8571;border-color:#0A8571;color:#fff}
.sc9-tdc-btn.bad{background:#fff;border-color:#C9A9A6;color:#9B2C22}
.sc9-tdc-btn:disabled{opacity:.5;cursor:not-allowed}
.sc9-tdc-card{background:var(--sc9-panel,#fff);border:1px solid var(--sc9-border-soft,#E5E9F3);border-radius:14px;padding:18px}
.sc9-tdc-card h2{font-size:14px;font-weight:650;margin:0 0 4px}
.sc9-tdc-sub{font-size:11.5px;color:var(--sc9-dim,#6B7496);line-height:1.6;margin:0 0 12px}
.sc9-tdc-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px}
.sc9-tdc-kpi{background:var(--sc9-panel,#fff);border:1px solid var(--sc9-border-soft,#E5E9F3);border-radius:14px;padding:16px}
.sc9-tdc-kpi span{display:block;font-size:11.5px;color:var(--sc9-muted,#4F587A);font-weight:500}
.sc9-tdc-kpi strong{display:block;font-size:28px;letter-spacing:-.5px;margin:6px 0 2px;font-variant-numeric:tabular-nums}
.sc9-tdc-kpi em{font-style:normal;font-size:11px;color:var(--sc9-dim,#6B7496)}
.sc9-tdc-kpi.bad strong{color:#B3261E}.sc9-tdc-kpi.warn strong{color:#966119}.sc9-tdc-kpi.good strong{color:#0A8571}
.sc9-tdc-grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
@media(max-width:900px){.sc9-tdc-grid2{grid-template-columns:1fr}}
.sc9-tdc-bar{display:grid;grid-template-columns:150px 1fr 64px;align-items:center;gap:10px;margin:9px 0;font-size:12px}
.sc9-tdc-bar i{display:block;height:12px;border-radius:6px;background:var(--c,#4F63D2);min-width:2px}
.sc9-tdc-bar div{background:var(--sc9-panel2,#F1F3F9);border-radius:6px;overflow:hidden}
.sc9-tdc-bar b{text-align:right;font-variant-numeric:tabular-nums}
.sc9-tdc-table{width:100%;border-collapse:collapse;font-size:12px}
.sc9-tdc-table th,.sc9-tdc-table td{padding:9px 8px;border-bottom:1px solid var(--sc9-border-soft,#E5E9F3);text-align:right;font-variant-numeric:tabular-nums}
.sc9-tdc-table th:first-child,.sc9-tdc-table td:first-child{text-align:left}
.sc9-tdc-table th{font-weight:600;color:var(--sc9-muted,#4F587A);font-size:11px}
.sc9-tdc-days{display:flex;align-items:flex-end;gap:5px;height:120px;overflow-x:auto;padding-bottom:4px}
.sc9-tdc-day{flex:1 0 26px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%;font-size:10px;color:var(--sc9-dim,#6B7496)}
.sc9-tdc-day i{display:block;width:100%;background:#E3B7B2;border-radius:4px 4px 0 0}
.sc9-tdc-day i.t{background:var(--sc9-highlight,#E4EAFB)}
.sc9-tdc-wrap{position:relative;width:100%;flex:1;min-height:0}
.sc9-tdc-wrap i.t{position:absolute;bottom:0}
.sc9-tdc-wrap i.e{position:absolute;bottom:0;background:#C2453B}
.sc9-tdc-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px}
.sc9-tdc-toolbar input,.sc9-tdc-toolbar select,.sc9-tdc-in,.sc9-tdc-ta{border:1px solid var(--sc9-border,#D3DAEA);border-radius:8px;padding:8px 10px;font-family:inherit;font-size:13px;background:#fff;color:inherit;min-width:0}
.sc9-tdc-ta{width:100%;min-height:54px;resize:vertical;box-sizing:border-box}
.sc9-tdc-chips{display:flex;gap:6px;flex-wrap:wrap}
.sc9-tdc-chip{border:1px solid var(--sc9-border,#D3DAEA);background:#fff;border-radius:99px;padding:6px 13px;font-family:inherit;font-weight:500;font-size:12px;cursor:pointer;color:var(--sc9-muted,#4F587A)}
.sc9-tdc-chip[aria-pressed=true]{background:var(--sc9-accent,#4F63D2);border-color:var(--sc9-accent,#4F63D2);color:#fff}
.sc9-tdc-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px}
.sc9-tdc-ficha{background:var(--sc9-panel,#fff);border:1px solid var(--sc9-border-soft,#E5E9F3);border-left:5px solid var(--c,#4F63D2);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.sc9-tdc-ficha.confirmado{background:#F2FAF7}.sc9-tdc-ficha.descartado{opacity:.6}
.sc9-tdc-fh{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
.sc9-tdc-tag{display:inline-block;padding:3px 9px;border-radius:99px;font-size:11px;font-weight:650;background:var(--c,#4F63D2);color:#fff}
.sc9-tdc-tag.s{background:#fff;color:#966119;border:1px solid #D7B26A}
.sc9-tdc-meta{font-size:11.5px;color:var(--sc9-muted,#4F587A);line-height:1.6}
.sc9-tdc-meta b{color:var(--sc9-ink,#1B2138)}
.sc9-tdc-nums{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.sc9-tdc-nums>div{background:var(--sc9-panel2,#F1F3F9);border-radius:9px;padding:8px 10px}
.sc9-tdc-nums label{display:block;font-size:10.5px;color:var(--sc9-dim,#6B7496);margin-bottom:3px}
.sc9-tdc-nums strong{font-size:17px}
.sc9-tdc-nums input{width:100%;box-sizing:border-box;font-size:15px;font-weight:650;padding:3px 6px}
.sc9-tdc-desc{font-size:12px;line-height:1.55;background:#FFF8EA;border:1px solid #F0DDB0;border-radius:9px;padding:9px 11px}
.sc9-tdc-ev summary{cursor:pointer;font-size:11.5px;color:var(--sc9-accent,#4F63D2);font-weight:600}
.sc9-tdc-ev ul{margin:8px 0 0;padding:0;list-style:none;font-size:11.5px;color:var(--sc9-muted,#4F587A)}
.sc9-tdc-ev li{padding:3px 0;border-bottom:1px dashed var(--sc9-border-soft,#E5E9F3)}
.sc9-tdc-act{display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}
.sc9-tdc-row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.sc9-tdc-field label{display:block;font-size:11px;color:var(--sc9-muted,#4F587A);margin-bottom:4px;font-weight:600}
.sc9-tdc-field .sc9-tdc-in{width:100%;box-sizing:border-box}
.sc9-tdc-map{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
.sc9-tdc-msg{padding:11px 14px;border-radius:10px;font-size:12.5px;margin:10px 0}
.sc9-tdc-msg.err{background:#FDECEA;color:#8E241B;border:1px solid #F2C5C0}
.sc9-tdc-msg.ok{background:#E8F6F1;color:#06695A;border:1px solid #BFE5DA}
.sc9-tdc-msg.info{background:#EEF1FD;color:#34419A;border:1px solid #CDD5F6}
.sc9-tdc-empty{text-align:center;padding:50px 20px;color:var(--sc9-dim,#6B7496)}
.sc9-tdc-nota{background:var(--sc9-panel,#fff);border:1px solid var(--sc9-border-soft,#E5E9F3);border-radius:14px;padding:16px 18px;margin-bottom:14px}
.sc9-tdc-nota-h{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:10px}
.sc9-tdc-nota-h h3{margin:0;font-size:15px}
.sc9-tdc-pill{display:inline-block;padding:3px 10px;border-radius:99px;font-size:11.5px;font-weight:650;background:#EEF1FD;color:#34419A}
.sc9-tdc-pill.bad{background:#FDECEA;color:#8E241B}.sc9-tdc-pill.ok{background:#E8F6F1;color:#06695A}.sc9-tdc-pill.warn{background:#FFF3DC;color:#8A5A0B}
.sc9-tdc-table td.l,.sc9-tdc-table th.l{text-align:left}
.sc9-tdc-warn{font-size:11.5px;color:#8A5A0B;background:#FFF8EA;border:1px solid #F0DDB0;border-radius:8px;padding:6px 9px;margin-top:6px}
.sc9-tdc-buscar{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}
.sc9-tdc-buscar .sc9-tdc-in{font-size:16px;padding:10px 12px}
.sc9-tdc-fotos{display:flex;gap:8px;flex-wrap:wrap}
.sc9-tdc-foto{position:relative;width:84px;height:84px}
.sc9-tdc-foto img{width:100%;height:100%;object-fit:cover;border-radius:10px;border:1px solid var(--sc9-border,#D3DAEA)}
.sc9-tdc-foto button{position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:50%;border:0;background:#B3261E;color:#fff;cursor:pointer;line-height:1}
.sc9-tdc-foto-add{display:flex;align-items:center;justify-content:center;text-align:center;width:120px;height:84px;border:2px dashed var(--sc9-border,#D3DAEA);border-radius:10px;color:var(--sc9-accent,#4F63D2);font-size:12px;font-weight:600;cursor:pointer;padding:6px}
.sc9-tdc-ev-box{background:#EEF1FD;border:1px solid #CDD5F6;border-radius:10px;padding:10px 12px;font-size:12px;color:#34419A;margin:8px 0;line-height:1.55}
.sc9-tdc-modal{position:fixed;inset:0;z-index:80;background:rgba(20,25,50,.45);display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto}
.sc9-tdc-modal>div{background:#fff;border-radius:14px;padding:22px;width:min(640px,100%)}
`;
  const style=root.document.createElement('style');style.id='sc9-tdc-style';style.textContent=CSS;root.document.head.appendChild(style);

  /* ------------------------------ API ------------------------------ */
  async function api(url,body){
    const opt={credentials:'same-origin',headers:{}};
    if(body!==undefined){
      opt.method='POST';opt.headers['Content-Type']='application/json';opt.headers['X-Sc9-App']='1';
      const data=JSON.stringify(body);
      if(data.length>60000&&typeof root.CompressionStream==='function'){
        const gz=new Blob([data]).stream().pipeThrough(new root.CompressionStream('gzip'));
        opt.body=await new Response(gz).blob();opt.headers['Content-Encoding']='gzip';
      }else opt.body=data;
    }
    const r=await fetch(url,opt);let j=null;try{j=await r.json();}catch(e){/* sem corpo */}
    if(!r.ok){const e=new Error((j&&j.error)||('Erro '+r.status));e.status=r.status;throw e;}
    return j;
  }

  /* ------------------------------ peças de UI ------------------------------ */
  const Bar=({label,value,max,color,right})=>h('div',{className:'sc9-tdc-bar'},h('span',null,label),h('div',null,h('i',{style:{width:(max?Math.max(value/max*100,value?2:0):0)+'%','--c':color}})),h('b',null,right==null?fmtN(value):right));
  const Kpi=({t,v,sub,tone})=>h('div',{className:'sc9-tdc-kpi '+(tone||'')},h('span',null,t),h('strong',null,v),h('em',null,sub));


  /* ------------------------------ fotos do pacote ------------------------------ */
  const URL_FOTO=id=>'/api/entradas-tdc/fotos?id='+id;
  function reduzirFoto(file,maxLado=1400,maxBytes=650*1024){
    return new Promise((resolve,reject)=>{
      if(!/^image\//.test(file.type||'')){reject(new Error('Escolha um arquivo de imagem.'));return;}
      const url=URL.createObjectURL(file),img=new Image();
      img.onload=()=>{
        URL.revokeObjectURL(url);
        const k=Math.min(1,maxLado/Math.max(img.width,img.height)),c=root.document.createElement('canvas');
        c.width=Math.max(1,Math.round(img.width*k));c.height=Math.max(1,Math.round(img.height*k));
        c.getContext('2d').drawImage(img,0,0,c.width,c.height);
        let q=0.82,out=c.toDataURL('image/jpeg',q);
        while(out.length*0.75>maxBytes&&q>0.4){q-=0.1;out=c.toDataURL('image/jpeg',q);}
        out.length*0.75>maxBytes?reject(new Error('A foto ficou grande demais mesmo reduzida. Tire outra com menos zoom.')):resolve(out);
      };
      img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Não consegui abrir essa imagem.'));};
      img.src=url;
    });
  }
  function FotoCampo({ids,onChange,disabled}){
    const [busy,setBusy]=useState(false),[err,setErr]=useState('');
    const add=async files=>{
      setErr('');setBusy(true);
      try{
        let atual=ids.slice();
        for(const f of Array.from(files)){
          if(atual.length>=4){setErr('No máximo 4 fotos por ficha.');break;}
          const r=await api('/api/entradas-tdc/fotos',{dataUrl:await reduzirFoto(f)});
          atual=[...atual,r.id];onChange(atual);
        }
      }catch(e){setErr(e.message);}finally{setBusy(false);}
    };
    return h('div',{className:'sc9-tdc-field'},
      h('label',null,'Foto do pacote (prova do erro)'),
      h('div',{className:'sc9-tdc-fotos'},
        ids.map(id=>h('div',{className:'sc9-tdc-foto',key:id},h('a',{href:URL_FOTO(id),target:'_blank',rel:'noopener'},h('img',{src:URL_FOTO(id),alt:'Foto do pacote'})),!disabled&&h('button',{type:'button',title:'Remover foto','aria-label':'Remover foto',onClick:()=>onChange(ids.filter(x=>x!==id))},'×'))),
        ids.length<4&&!disabled&&h('label',{className:'sc9-tdc-foto-add'},busy?'Enviando…':'+ Tirar / escolher foto',h('input',{type:'file',accept:'image/*',capture:'environment',multiple:true,disabled:busy,style:{display:'none'},onChange:e=>{add(e.target.files);e.target.value='';}}))),
      err&&h('div',{className:'sc9-tdc-msg err'},err));
  }

  /* ------------------------------ fichas ------------------------------ */
  function Ficha({a,onSave,onRemove}){
    const rev=a.revisao||{};
    const [tipo,setTipo]=useState(a.tipo);
    const [qtd,setQtd]=useState(rev.fisicoQtd!==undefined&&rev.fisicoQtd!==''?rev.fisicoQtd:(a.qtdFisica==null?'':a.qtdFisica));
    const [lote,setLote]=useState(rev.fisicoLote||a.loteFisico||'');
    const [obs,setObs]=useState(rev.obs||'');const [fotos,setFotos]=useState(rev.fotos||[]);
    const [busy,setBusy]=useState(false);const [err,setErr]=useState('');
    const T=M.TIPOS[a.tipo]||{rotulo:a.tipo,cor:'#4F63D2'};
    const salvar=async status=>{
      setBusy(true);setErr('');
      try{await onSave(a,{status,tipo,obs,fotos,fisicoQtd:qtd===''?'':Number(qtd),fisicoLote:lote});}
      catch(e){setErr(e.message);}finally{setBusy(false);}
    };
    const est=a.status==='confirmado'?'confirmado':a.status==='descartado'?'descartado':'';
    return h('div',{className:'sc9-tdc-ficha '+est,style:{'--c':T.cor}},
      h('div',{className:'sc9-tdc-fh'},
        h('div',null,h('span',{className:'sc9-tdc-tag'},T.rotulo),' ',a.confianca==='suspeita'&&h('span',{className:'sc9-tdc-tag s',title:'O Protheus sugere, mas não prova. Confirme no físico.'},'Suspeita'),a.manual&&h('span',{className:'sc9-tdc-tag s'},'Lançada à mão')),
        h('span',{className:'sc9-tdc-meta'},a.status==='confirmado'?'✓ Confirmada':a.status==='descartado'?'Descartada':'Nova')),
      h('div',{className:'sc9-tdc-meta'},a.nota?h('span',null,'NF ',h('b',null,a.nota),a.serie?'/'+a.serie:''):h('b',null,'Sem nota no SD1'),' · ',forn(a.fornecedor)||'fornecedor não informado',h('br'),'Produto ',h('b',null,a.produto),' · lote nota ',h('b',null,a.lote||'—'),h('br'),'Entrada no 59: ',h('b',null,fmtD(a.dtEntrada)),a.usuarioTDC&&h('span',null,' · lançada por ',h('b',null,a.usuarioTDC))),
      h('div',{className:'sc9-tdc-nums'},
        h('div',null,h('label',null,'Na nota (SD1)'),h('strong',null,fmtN(a.qtdNota))),
        h('div',null,h('label',null,'Físico (contado)'),h('input',{className:'sc9-tdc-in',type:'number',value:qtd,placeholder:'—',onChange:e=>setQtd(e.target.value)})),
        h('div',null,h('label',null,'Lote físico'),h('input',{className:'sc9-tdc-in',value:lote,placeholder:a.lote||'—',onChange:e=>setLote(e.target.value)}))),
      a.descricao&&h('div',{className:'sc9-tdc-desc'},a.descricao),
      a.corrigidoPor&&a.corrigidoPor.length>0&&h('div',{className:'sc9-tdc-meta'},'Corrigido no estoque por: ',h('b',null,a.corrigidoPor.join(', '))),
      a.movimentos&&a.movimentos.length>0&&h('details',{className:'sc9-tdc-ev'},h('summary',null,'Ver o que o Protheus registrou ('+a.movimentos.length+')'),
        h('ul',null,a.movimentos.map((m,i)=>h('li',{key:i},fmtD(m.dia),' · ',m.cf,' · doc ',m.doc,' · ',m.dir==='saida'?'saída ':'entrada ',h('b',null,fmtN(m.qt)),' pç · arm ',m.armazem,' · lote ',m.lote,m.usuario&&' · '+m.usuario)))),
      h('div',{className:'sc9-tdc-row2'},
        h('div',{className:'sc9-tdc-field'},h('label',null,'Tipo de erro'),h('select',{className:'sc9-tdc-in',value:tipo,onChange:e=>setTipo(e.target.value)},M.TIPOS_MANUAL.map(t=>h('option',{key:t,value:t},M.TIPOS[t].rotulo)))),
        h('div',{className:'sc9-tdc-field'},h('label',null,rev.por?'Revisado por '+rev.por:'Revisão'),h('div',{className:'sc9-tdc-meta'},rev.em?fmtDH(rev.em):'ainda não revisada'))),
      h(FotoCampo,{ids:fotos,onChange:setFotos}),
      h('textarea',{className:'sc9-tdc-ta',placeholder:'Justificativa do estoque (ex.: conferi 10 caixas no físico, nota dizia 8)',value:obs,onChange:e=>setObs(e.target.value)}),
      err&&h('div',{className:'sc9-tdc-msg err'},err),
      h('div',{className:'sc9-tdc-act'},
        a.status!=='confirmado'&&h('button',{className:'sc9-tdc-btn ok',disabled:busy,onClick:()=>salvar('confirmado')},'✓ Confirmar erro'),
        a.status==='confirmado'&&h('button',{className:'sc9-tdc-btn pri',disabled:busy,onClick:()=>salvar('confirmado')},'Salvar alterações'),
        a.status!=='descartado'&&!a.manual&&h('button',{className:'sc9-tdc-btn bad',disabled:busy,onClick:()=>salvar('descartado')},'Descartar (não é erro)'),
        a.status!=='pendente'&&!a.manual&&h('button',{className:'sc9-tdc-btn',disabled:busy,onClick:()=>salvar('pendente')},'Reabrir'),
        a.manual&&h('button',{className:'sc9-tdc-btn bad',disabled:busy,onClick:async()=>{setBusy(true);try{await onRemove(a);}catch(e){setErr(e.message);setBusy(false);}}},'Remover')));
  }

  function resumoProtheus(it){
    if(!it)return '';
    const sub=it.subiu>0?`Subiu ${fmtN(it.subiu)} de ${fmtN(it.qtNota)} pç pro 01`:'Nada subiu pro 01 ainda (nos dados carregados)';
    const ev=(it.eventos||[]).slice(0,4).map(m=>`${fmtD(m.dia)} ${m.cf} doc ${m.doc} ${m.dir==='saida'?'saída':'entrada'} ${fmtN(m.qt)} pç (arm ${m.armazem}, lote ${m.lote})`).join('; ');
    return sub+'.'+(ev?' Movimentações: '+ev+'.':'');
  }
  function FichaManual({onClose,onSave,usuario,inicial,sd1All,analisarNota}){
    const [f,setF]=useState({tipo:'qtd_maior',nota:'',serie:'',fornecedor:'',produto:'',lote:'',loteFisico:'',qtdNota:'',qtdFisica:'',dtEntrada:'',usuarioTDC:'',obs:'',...(inicial||{})});
    const [fotos,setFotos]=useState([]);const [itensNota,setItensNota]=useState([]);const [series,setSeries]=useState([]);const [achou,setAchou]=useState(inicial&&inicial.nota?'sim':'');
    const [err,setErr]=useState('');const [busy,setBusy]=useState(false);
    const set=k=>e=>setF(x=>({...x,[k]:e.target.value}));
    const foraDaNota=f.tipo==='item_fora_nota';
    const buscarNota=useCallback((nota,serie)=>{
      const b=M.buscarNota(sd1All||[],nota,serie);
      if(!M.normNota(nota)){setAchou('');setItensNota([]);setSeries([]);return;}
      if(!b.itens.length){setAchou('nao');setItensNota([]);setSeries([]);return;}
      if(b.series.length>1&&!serie){setAchou('serie');setSeries(b.series);setItensNota([]);return;}
      const base=b.itens[0];setAchou('sim');setSeries([]);setItensNota(b.itens);
      setF(x=>({...x,serie:base.serie||'',fornecedor:forn(base.fornecedor),dtEntrada:base.dtDigit||'',usuarioTDC:base.usuario||x.usuarioTDC}));
    },[sd1All]);
    // ao digitar o número da nota, puxa do SD1 tudo o que é da nota (com um pequeno atraso para não buscar a cada tecla)
    useEffect(()=>{const t=setTimeout(()=>buscarNota(f.nota,f.serie&&achou==='serie'?f.serie:''),450);return()=>clearTimeout(t);},[f.nota]);// eslint-disable-line
    const escolherSerie=sr=>{setF(x=>({...x,serie:sr}));buscarNota(f.nota,sr);};
    const escolherItem=ix=>{
      const l=itensNota[Number(ix)];if(!l)return;
      setF(x=>({...x,produto:l.produto,lote:l.lote,qtdNota:l.qt}));
    };
    const itemSel=itensNota.findIndex(l=>l.produto===f.produto&&l.lote===f.lote);
    const resNota=useMemo(()=>achou==='sim'&&analisarNota?analisarNota(f.nota,f.serie):null,[achou,f.nota,f.serie]);// eslint-disable-line
    const itemRes=useMemo(()=>resNota&&f.produto?resNota.itens.find(i=>M.normNota(i.nota)===M.normNota(f.nota)&&i.produto===f.produto&&i.lote===f.lote):null,[resNota,f.nota,f.produto,f.lote]);
    const protheus=foraDaNota?'':resumoProtheus(itemRes);
    const jaApontado=resNota&&f.produto&&!foraDaNota?resNota.findings.find(x=>x.produto===f.produto&&x.lote===f.lote&&x.tipo===f.tipo&&x.confianca==='forte'):null;
    const campo=(k,rot,tipo,extra)=>h('div',{className:'sc9-tdc-field',key:k},h('label',null,rot),h('input',{className:'sc9-tdc-in',type:tipo||'text',value:f[k]==null?'':f[k],onChange:set(k),...(extra||{})}));
    const salvar=async()=>{
      if(!f.produto.trim()){setErr('Informe o produto (escolha na lista de itens da nota ou digite).');return;}
      setBusy(true);setErr('');
      try{await onSave('MANUAL|'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),{...f,fotos,protheus,status:'confirmado',fisicoQtd:f.qtdFisica,fisicoLote:f.loteFisico,qtdNota:foraDaNota?0:(Number(f.qtdNota)||0),qtdFisica:f.qtdFisica===''?'':Number(f.qtdFisica)});onClose();}
      catch(e){setErr(e.message);setBusy(false);}
    };
    return h('div',{className:'sc9-tdc-modal',onClick:e=>{if(e.target===e.currentTarget)onClose();}},h('div',null,
      h('h2',{style:{margin:'0 0 4px',fontSize:16}},'Reportar um erro de entrada'),
      h('p',{className:'sc9-tdc-sub'},'Digite o número da nota: o painel preenche o que é da nota (fornecedor, data, itens). Escolha o item com problema, diga o que encontrou no físico e anexe a foto do pacote. Fica confirmado por '+(usuario||'você')+'.'),
      h('div',{className:'sc9-tdc-row2',style:{marginBottom:10}},
        h('div',{className:'sc9-tdc-field'},h('label',null,'Número da nota'),h('input',{className:'sc9-tdc-in',value:f.nota,inputMode:'numeric',placeholder:'ex.: 000123',autoFocus:!(inicial&&inicial.nota),onChange:e=>{set('nota')(e);setAchou('');}})),
        h('div',{className:'sc9-tdc-field'},h('label',null,'Tipo de erro'),h('select',{className:'sc9-tdc-in',value:f.tipo,onChange:e=>{const v=e.target.value;setF(x=>({...x,tipo:v,...(v==='item_fora_nota'?{qtdNota:0}:{})}));}},M.TIPOS_MANUAL.map(t=>h('option',{key:t,value:t},M.TIPOS[t].rotulo))))),
      achou==='nao'&&h('div',{className:'sc9-tdc-msg info'},'Essa nota não está no SD1 enviado. Você ainda pode preencher à mão abaixo.'),
      achou==='serie'&&h('div',{className:'sc9-tdc-msg info'},'Essa nota existe em mais de uma série. Qual é a sua? ',series.map(sr=>h('button',{key:sr,type:'button',className:'sc9-tdc-chip',style:{marginLeft:6},onClick:()=>escolherSerie(sr)},'Série '+(sr||'(em branco)')))),
      achou==='sim'&&h('div',{className:'sc9-tdc-msg ok'},'NF '+f.nota+(f.serie?'/'+f.serie:'')+' · '+(f.fornecedor||'fornecedor não informado')+' · entrada em '+fmtD(f.dtEntrada)+' · '+itensNota.length+' item(ns) na nota.'),
      achou==='sim'&&!foraDaNota&&h('div',{className:'sc9-tdc-field',style:{marginBottom:10}},h('label',null,'Qual item da nota está errado?'),
        h('select',{className:'sc9-tdc-in',value:itemSel>=0?itemSel:'',onChange:e=>escolherItem(e.target.value)},h('option',{value:''},'— escolha o item —'),itensNota.map((l,ix)=>h('option',{key:ix,value:ix},l.produto+' · lote '+(l.lote||'—')+' · '+fmtN(l.qt)+' pç na nota')))),
      foraDaNota&&h('div',{className:'sc9-tdc-msg info'},'Item que chegou e não estava na nota: digite o produto e o lote que apareceram no pacote.'),
      protheus&&h('div',{className:'sc9-tdc-ev-box'},h('b',null,'O que o Protheus mostra: '),protheus),
      jaApontado&&h('div',{className:'sc9-tdc-msg info'},'O Protheus já apontou este erro neste item: ',jaApontado.descricao,' Para não contar em dobro, confirme a ficha dele no Fichário e anexe a foto lá. Se for outro problema, siga com este relato.'),
      h('div',{className:'sc9-tdc-row2'},
        campo('produto','Produto *'),campo('lote',foraDaNota?'Lote do pacote':'Lote da nota'),
        !foraDaNota&&campo('qtdNota','Qtd. na nota','number',{readOnly:itemSel>=0}),campo('qtdFisica','Qtd. física (contada)','number'),
        f.tipo==='lote_trocado'&&campo('loteFisico','Lote que veio no físico'),
        campo('usuarioTDC','Quem lançou no TDC')),
      h('div',{style:{marginTop:10}},h(FotoCampo,{ids:fotos,onChange:setFotos})),
      h('div',{className:'sc9-tdc-field',style:{marginTop:10}},h('label',null,'Justificativa (o que estava errado)'),h('textarea',{className:'sc9-tdc-ta',placeholder:'ex.: nota dizia 8 peças, contei 10 no pacote',value:f.obs,onChange:set('obs')})),
      err&&h('div',{className:'sc9-tdc-msg err'},err),
      h('div',{className:'sc9-tdc-act',style:{marginTop:12}},h('button',{className:'sc9-tdc-btn pri',disabled:busy,onClick:salvar},'Salvar relato'),h('button',{className:'sc9-tdc-btn',onClick:onClose},'Cancelar'))));
  }

  /* ------------------------------ envio do SD1 ------------------------------ */
  function EnviarSD1({onEnviado}){
    const [arq,setArq]=useState(null);const [folhas,setFolhas]=useState([]);const [folha,setFolha]=useState('');
    const [aoa,setAoa]=useState(null);const [det,setDet]=useState(null);const [mapa,setMapa]=useState({});
    const [substituir,setSubstituir]=useState(false);const [msg,setMsg]=useState(null);const [busy,setBusy]=useState(false);
    const [wb,setWb]=useState(null);const [lendo,setLendo]=useState(false);
    const pausa=()=>new Promise(r=>setTimeout(r,30));
    const ler=async file=>{
      setMsg(null);setAoa(null);setDet(null);setArq(file||null);if(!file)return;
      if(!root.XLSX){setMsg({t:'err',m:'Biblioteca de planilhas (SheetJS) não carregou. Recarregue a página.'});return;}
      setLendo(true);await pausa();
      try{
        // dense = bem menos memória em planilhas grandes (o SD1 do Protheus pode ter 30 mil linhas x 250 colunas)
        const w=root.XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true,dense:true});
        setWb(w);setFolhas(w.SheetNames);escolher(w,w.SheetNames[0]);
      }catch(e){setMsg({t:'err',m:'Não consegui abrir o arquivo: '+e.message});}finally{setLendo(false);}
    };
    /* só as primeiras linhas servem pra achar o cabeçalho; as linhas todas são lidas depois, só nas colunas escolhidas */
    const escolher=(w,nome)=>{
      setFolha(nome);const ws=w.Sheets[nome];
      const U=root.XLSX.utils;let ate=24;
      try{const ref=U.decode_range(ws['!ref']);ate=Math.min(24,ref.e.r);}catch(e){/* planilha vazia */}
      const a=U.sheet_to_json(ws,{header:1,raw:true,defval:'',range:{s:{r:0,c:0},e:{r:ate,c:(()=>{try{return U.decode_range(ws['!ref']).e.c;}catch(e){return 0;}})()}}});
      const d=M.detectarColunasSD1(a);setAoa(a);setDet(d);setMapa(d.mapa);
    };
    const lerColunas=(ws,cols)=>{
      const U=root.XLSX.utils,ref=U.decode_range(ws['!ref']),out=[];
      for(let r0=ref.s.r;r0<=ref.e.r;r0+=2000){
        const bloco=U.sheet_to_json(ws,{header:1,raw:true,defval:'',range:{s:{r:r0,c:ref.s.c},e:{r:Math.min(r0+1999,ref.e.r),c:ref.e.c}}});
        for(const row of bloco)out.push(cols.map(c=>row[c]));
      }
      return out;
    };
    const linhas=useMemo(()=>{
      if(!aoa||!det||!wb)return [];
      const campos=Object.keys(mapa),cols=campos.map(c=>mapa[c]);
      let cheio;try{cheio=lerColunas(wb.Sheets[folha],cols);}catch(e){return [];}
      const mapaN={};campos.forEach((c,i)=>{mapaN[c]=i;});
      return M.lerSD1(cheio,mapaN,det.linhaCab);
    },[aoa,det,mapa,wb,folha]);
    const faltando=M.OBRIGATORIOS.filter(c=>mapa[c]===undefined);
    const semData=linhas.filter(l=>!l.dtDigit).length;
    const enviar=async()=>{
      setBusy(true);setMsg(null);
      try{
        const comp=M.compactarSD1(linhas.filter(l=>l.dtDigit));
        const r=await api('/api/entradas-tdc/sd1',{...comp,arquivo:arq&&arq.name,substituir});
        setMsg({t:'ok',m:`SD1 atualizado: ${r.notasNovas} nota(s) nova(s) e ${r.notasAtualizadas} já existente(s) atualizada(s). Total guardado: ${fmtN(r.total)} linhas.`});
        onEnviado&&onEnviado();
      }catch(e){setMsg({t:'err',m:e.message});}finally{setBusy(false);}
    };
    const cab=det?det.cabecalhos:[];
    return h('div',null,
      h('input',{type:'file',accept:'.xlsx,.xls,.csv',onChange:e=>ler(e.target.files[0])}),
      lendo&&h('div',{className:'sc9-tdc-msg info'},'Lendo a planilha… arquivos grandes (30 mil linhas) podem levar um minuto. Não feche esta tela.'),
      h('p',{className:'sc9-tdc-sub',style:{marginTop:8}},'Dica: se o arquivo ficar pesado, exporte do Protheus só estas colunas: Documento, Item NF, Série, Produto, Lote, Quantidade, DT Digitação, Armazém (e Usuário/Hora, se houver).'),
      msg&&h('div',{className:'sc9-tdc-msg '+msg.t},msg.m),
      aoa&&det&&h('div',{style:{marginTop:12}},
        folhas.length>1&&h('div',{className:'sc9-tdc-field',style:{maxWidth:280,marginBottom:10}},h('label',null,'Aba da planilha'),h('select',{className:'sc9-tdc-in',value:folha,onChange:e=>escolher(wb,e.target.value)},folhas.map(f=>h('option',{key:f},f)))),
        h('p',{className:'sc9-tdc-sub'},'Reconheci as colunas abaixo automaticamente (cabeçalho na linha '+(det.linhaCab+1)+'). Corrija se algo estiver errado. Campos com * são obrigatórios.'),
        h('div',{className:'sc9-tdc-map'},Object.keys(M.ROTULO_CAMPO).map(c=>h('div',{className:'sc9-tdc-field',key:c},h('label',null,M.ROTULO_CAMPO[c]+(M.OBRIGATORIOS.includes(c)?' *':'')),
          h('select',{className:'sc9-tdc-in',value:mapa[c]===undefined?'':mapa[c],onChange:e=>{const n={...mapa};if(e.target.value==='')delete n[c];else n[c]=Number(e.target.value);setMapa(n);}},
            h('option',{value:''},'— não tem —'),cab.map((x,i)=>h('option',{key:i,value:i},(x||'(coluna '+(i+1)+')')))))) ),
        faltando.length>0&&h('div',{className:'sc9-tdc-msg err'},'Falta indicar: '+faltando.map(c=>M.ROTULO_CAMPO[c]).join(', ')+'.'),
        !mapa.usuario&&h('div',{className:'sc9-tdc-msg info'},'Sem a coluna de usuário não dá pra mostrar o ranking por pessoa do TDC (o restante funciona).'),
        !mapa.hora&&h('div',{className:'sc9-tdc-msg info'},'Sem a coluna de hora, os tempos são medidos em dias.'),
        h('div',{className:'sc9-tdc-msg ok'},`${linhas.length} linhas de itens lidas${semData?` (${semData} sem data de entrada serão ignoradas)`:''}. Exemplo: `+(linhas[0]?`NF ${linhas[0].nota} · produto ${linhas[0].produto} · lote ${linhas[0].lote||'—'} · ${linhas[0].qt} pç · ${fmtD(linhas[0].dtDigit)}`:'—')),
        h('label',{style:{display:'block',margin:'8px 0',fontSize:12.5}},h('input',{type:'checkbox',checked:substituir,onChange:e=>setSubstituir(e.target.checked)}),' Substituir tudo que já foi enviado (por padrão acrescento as notas novas e atualizo as que vierem de novo; o resto fica)'),
        h('button',{className:'sc9-tdc-btn pri',disabled:busy||faltando.length>0||!linhas.length,onClick:enviar},busy?'Enviando…':'Enviar SD1 para o painel')));
  }

  /* ------------------------------ súmula (Excel) ------------------------------ */
  function baixarSumula(res,achados,somenteConfirmados,periodo){
    const baseUrl=root.location&&root.location.origin||'';
    if(!root.XLSX)throw new Error('SheetJS não carregou');
    const s=M.linhasSumula(res,achados,{somenteConfirmados,periodo,baseUrl});
    const wb=root.XLSX.utils.book_new();
    const add=(nome,aoa,larg)=>{const ws=root.XLSX.utils.aoa_to_sheet(aoa);ws['!cols']=larg.map(w=>({wch:w}));root.XLSX.utils.book_append_sheet(wb,ws,nome);};
    add('Súmula',s.resumo,[42,20,12,22]);
    add('Por usuário',s.porUsuario,[30,10,20,22,10,20,18]);
    add('Detalhe',s.detalhe,[13,26,10,12,7,26,14,14,14,12,12,11,13,18,22,60,40,16,12]);
    add('Tempo',s.tempo,[12,28,14,14,12,12,16,22,18,16,22]);
    root.XLSX.writeFile(wb,'Sumula_Entradas_TDC_'+new Date().toISOString().slice(0,10)+'.xlsx');
  }


  /* ------------------------------ conferência por nota ------------------------------ */
  const SITUACAO=(i)=>{
    if(i.erroForte)return {t:'Divergência: '+i.tipos.map(t=>M.TIPOS[t]?M.TIPOS[t].curto:t).join(', '),c:'bad'};
    if(i.erro)return {t:'Suspeita — conferir no físico',c:'warn'};
    if(i.depoisSD3&&!i.subiu)return {t:'Entrou depois da última movimentação carregada — atualize o SD3',c:'warn'};
    if(i.semCobertura&&!i.subiu)return {t:'Antes do período da movimentação (SD3) — sem como medir',c:''};
    if(i.aguardandoSubir)return {t:'Parado no 59 há '+i.diasSemSubir+' dias',c:'warn'};
    if(i.subiu>=i.qtNota)return {t:'Subiu tudo'+(i.diasAteConcluir!=null?' em '+i.diasAteConcluir+' d':''),c:'ok'};
    if(i.subiu>0)return {t:'Subiu parte ('+fmtN(i.subiu)+' de '+fmtN(i.qtNota)+')',c:'warn'};
    return {t:'Ainda não subiu',c:''};
  };
  function NotaCard({reg,res,fObj,achados,onRemover,onFichas,onManual,onVincular}){
    const itens=res?res.itens.filter(i=>M.combinaNota(i,[reg])):[];
    const nome='NF '+reg.nota+(reg.serie?'/'+reg.serie:'');
    if(!itens.length)return h('div',{className:'sc9-tdc-nota'},h('div',{className:'sc9-tdc-nota-h'},h('h3',null,nome),h('button',{className:'sc9-tdc-btn bad',onClick:()=>onRemover(reg)},'Tirar da conferência')),
      h('div',{className:'sc9-tdc-msg info'},'Esta nota não está no SD1 que está no painel. Envie o SD1 mais recente na aba Dados.'));
    const base=itens[0];
    const erros=itens.filter(i=>i.erroForte).length,susp=itens.filter(i=>!i.erroForte&&i.erro).length;
    const fichas=achados.filter(a=>a.nota&&M.combinaNota(a,[reg]));
    const cands=(res.candidatos||[]).filter(c=>{const d=M.diasEntre(base.dtEntrada,c.dtEntrada);return d!==null&&d>=0&&d<=7&&!Object.keys(fObj).some(k=>k.startsWith('MANUAL|VINC|'+c.id+'|'));});
    return h('div',{className:'sc9-tdc-nota'},
      h('div',{className:'sc9-tdc-nota-h'},
        h('div',null,h('h3',null,nome,' · ',forn(base.fornecedor)||'fornecedor não informado'),h('div',{className:'sc9-tdc-meta'},base.cfop&&h('span',null,h('b',null,M.infoCFOP(base.cfop).rotulo),' (CFOP '+base.cfop+(base.tipo?' · TES '+base.tipo:'')+') · '),'Entrada no 59: ',h('b',null,fmtD(base.dtEntrada)),base.hora&&' às '+base.hora,base.usuarioTDC&&h('span',null,' · lançada por ',h('b',null,base.usuarioTDC)),' · ',itens.length,' item(ns) na nota')),
        h('div',{className:'sc9-tdc-act'},
          erros?h('span',{className:'sc9-tdc-pill bad'},erros+' item(ns) com divergência'):susp?h('span',{className:'sc9-tdc-pill warn'},susp+' suspeita(s)'):h('span',{className:'sc9-tdc-pill ok'},'Sem divergência no Protheus'),
          h('button',{className:'sc9-tdc-btn',onClick:()=>onFichas(reg)},'Fichas ('+fichas.length+')'),
          h('button',{className:'sc9-tdc-btn bad',onClick:()=>onRemover(reg)},'Tirar'))),
      h('div',{style:{overflowX:'auto'}},h('table',{className:'sc9-tdc-table'},
        h('thead',null,h('tr',null,[['Produto','l'],['Lote da nota','l'],['Qtd. nota',''],['Subiu pro 01',''],['Situação','l'],['','']].map(([c,k],ix)=>h('th',{key:ix,className:k},c)))),
        h('tbody',null,itens.map((i,ix)=>{const sit=SITUACAO(i);return h(R.Fragment,{key:ix},
          h('tr',null,h('td',{className:'l'},h('b',null,i.produto)),h('td',{className:'l'},i.lote||'—'),h('td',null,fmtN(i.qtNota)),h('td',null,fmtN(i.subiu)),h('td',{className:'l'},h('span',{className:'sc9-tdc-pill '+sit.c},sit.t)),
            h('td',null,h('button',{className:'sc9-tdc-btn',title:'Registrar um erro que o Protheus não mostrou',onClick:()=>onManual({nota:i.nota,serie:i.serie,fornecedor:i.fornecedor,produto:i.produto,lote:i.lote,qtdNota:i.qt==null?i.qtNota:i.qtNota,dtEntrada:i.dtEntrada,usuarioTDC:i.usuarioTDC})},'+ erro'))),
          (i.eventos.length>0||i.outrasNotas.length>0)&&h('tr',null,h('td',{colSpan:6,className:'l',style:{textAlign:'left'}},
            i.outrasNotas.length>0&&h('div',{className:'sc9-tdc-warn'},'⚠ O mesmo produto/lote também está em outra nota: '+i.outrasNotas.map(o=>'NF '+o.nota+(o.serie?'/'+o.serie:'')+' ('+fmtD(o.dtDigit)+', '+fmtN(o.qt)+' pç)').join('; ')+'. O Protheus não diz de qual nota é cada movimentação: as de baixo foram atribuídas a esta nota por serem posteriores à entrada dela e anteriores à da próxima. Confira.'),
            i.eventos.length>0&&h('details',{className:'sc9-tdc-ev'},h('summary',null,'Movimentações no Protheus ('+i.eventos.length+')'),h('ul',null,i.eventos.map((m,k)=>h('li',{key:k},fmtD(m.dia),' · ',m.cf,' · doc ',m.doc,' · ',m.dir==='saida'?'saída ':'entrada ',h('b',null,fmtN(m.qt)),' pç · arm ',m.armazem,' · lote ',m.lote,m.usuario&&' · '+m.usuario)))))));})))),
      cands.length>0&&h('details',{className:'sc9-tdc-ev',style:{marginTop:10}},h('summary',null,'Entradas manuais no 59 sem nota, até 7 dias depois ('+cands.length+') — algum desses veio junto com esta nota?'),
        h('ul',null,cands.map(c=>h('li',{key:c.id,style:{display:'flex',gap:10,alignItems:'center',justifyContent:'space-between'}},h('span',null,fmtD(c.dtEntrada),' · produto ',h('b',null,c.produto),' · lote ',c.lote,' · ',h('b',null,fmtN(c.qtdFisica)),' pç',c.corrigidoPor&&c.corrigidoPor.length?' · por '+c.corrigidoPor.join(', '):''),
          h('button',{className:'sc9-tdc-btn',onClick:()=>onVincular(c,base,reg)},'Era desta nota'))))));
  }
  function Notas({fresco,sd1All,sd1Raw,res,notasReg,fObj,achados,onAdd,onRemover,onFichas,onManual,onVincular,onIrDados}){
    const [num,setNum]=useState(''),[serie,setSerie]=useState(''),[busca,setBusca]=useState(null),[busy,setBusy]=useState(false),[err,setErr]=useState('');
    const buscar=()=>{
      setErr('');const b=M.buscarNota(sd1All,num,serie);
      if(!M.normNota(num)){setErr('Digite o número da nota.');return;}
      setBusca({...b,nota:num.trim(),serieEscolhida:serie.trim()});
    };
    const escolherSerie=sr=>{setSerie(sr);const b=M.buscarNota(sd1All,num,sr);setBusca({...b,nota:num.trim(),serieEscolhida:sr});};
    const adicionar=async()=>{setBusy(true);setErr('');try{await onAdd(num.trim(),(busca&&busca.serieEscolhida)||(busca&&busca.series.length===1?busca.series[0]:''));setNum('');setSerie('');setBusca(null);}catch(e){setErr(e.message);}finally{setBusy(false);}};
    const regs=Object.values(notasReg).sort((a,b)=>String(b.em).localeCompare(String(a.em)));
    const itens=busca?busca.itens:[];
    const ambigua=busca&&busca.series.length>1&&!busca.serieEscolhida;
    return h('div',null,
      fresco&&fresco.aviso&&h('div',{className:'sc9-tdc-msg info'},fresco.aviso),
      h('div',{className:'sc9-tdc-card',style:{marginBottom:16}},
        h('h2',null,'Qual nota você vai conferir?'),
        h('p',{className:'sc9-tdc-sub'},'Digite o número da nota de entrada. O painel puxa do SD1 só os itens dessa nota (nunca por produto ou lote soltos, para não misturar com outra nota) e confere o que subiu pro 01.'),
        !sd1All.length?h('div',{className:'sc9-tdc-msg info'},'Ainda não há SD1 no painel. ',h('button',{className:'sc9-tdc-btn pri',onClick:onIrDados},'Enviar o SD1')):
        h('div',{className:'sc9-tdc-buscar'},
          h('div',{className:'sc9-tdc-field'},h('label',null,'Número da nota'),h('input',{className:'sc9-tdc-in',value:num,inputMode:'numeric',placeholder:'ex.: 000123',onChange:e=>{setNum(e.target.value);setBusca(null);},onKeyDown:e=>{if(e.key==='Enter')buscar();},autoFocus:true})),
          h('div',{className:'sc9-tdc-field',style:{width:110}},h('label',null,'Série (opcional)'),h('input',{className:'sc9-tdc-in',value:serie,onChange:e=>{setSerie(e.target.value);setBusca(null);},onKeyDown:e=>{if(e.key==='Enter')buscar();}})),
          h('button',{className:'sc9-tdc-btn pri',style:{padding:'11px 18px'},onClick:buscar},'Buscar no SD1')),
        err&&h('div',{className:'sc9-tdc-msg err'},err),
        busca&&!itens.length&&h('div',{className:'sc9-tdc-msg err'},'A nota '+busca.nota+' não está no SD1 enviado. Confira o número'+(sd1Raw?' ou envie um SD1 mais recente (o atual vai até a entrada de '+fmtD(sd1All.reduce((m,l)=>l.dtDigit>m?l.dtDigit:m,''))+')':'')+'.'),
        ambigua&&h('div',{className:'sc9-tdc-msg info'},'Existe a nota '+busca.nota+' em mais de uma série. Qual é a sua? ',busca.series.map(sr=>h('button',{key:sr,className:'sc9-tdc-chip',style:{marginLeft:6},onClick:()=>escolherSerie(sr)},'Série '+(sr||'(em branco)')))),
        busca&&itens.length>0&&!ambigua&&h('div',{style:{marginTop:12}},
          h('p',{className:'sc9-tdc-sub',style:{margin:'0 0 6px'}},'Achei ',h('b',null,itens.length+' item(ns)'),' na NF ',h('b',null,busca.nota),' · ',forn(itens[0].fornecedor)||'fornecedor não informado',' · entrada em ',fmtD(itens[0].dtDigit),':'),
          h('table',{className:'sc9-tdc-table'},h('thead',null,h('tr',null,[['Produto','l'],['Lote','l'],['Qtd. na nota','']].map(([c,k])=>h('th',{key:c,className:k},c)))),h('tbody',null,itens.map((l,i)=>h('tr',{key:i},h('td',{className:'l'},h('b',null,l.produto)),h('td',{className:'l'},l.lote||'—'),h('td',null,fmtN(l.qt)))))),
          h('div',{className:'sc9-tdc-act',style:{marginTop:12}},h('button',{className:'sc9-tdc-btn ok',disabled:busy,onClick:adicionar},busy?'Adicionando…':'✓ Conferir esta nota')))),
      regs.length?h('div',null,h('h2',{style:{fontSize:14,margin:'4px 0 10px'}},'Notas em conferência ('+regs.length+')'),regs.map(r=>h(NotaCard,{key:r.nota+'|'+r.serie,reg:r,res,fObj,achados,onRemover,onFichas,onManual,onVincular}))):
        h('div',{className:'sc9-tdc-card sc9-tdc-empty'},'Nenhuma nota em conferência ainda. Digite o número de uma nota acima.'));
  }


  /* ------------------------------ exportar relatório ------------------------------ */
  async function fotoParaDataUrl(id){
    const r=await fetch(URL_FOTO(id),{credentials:'same-origin'});if(!r.ok)throw new Error('foto');
    const b=await r.blob();
    return await new Promise((ok,no)=>{const fr=new FileReader();fr.onload=()=>ok(fr.result);fr.onerror=no;fr.readAsDataURL(b);});
  }
  function baixarArquivo(nome,conteudo,tipo){
    const url=URL.createObjectURL(new Blob([conteudo],{type:tipo}));const a=root.document.createElement('a');a.href=url;a.download=nome;root.document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000);
  }
  function Exportar({res,achados,sessao,escopoRotulo,soConf,onExcel,onFechar}){
    const Rp=root.SC9EntradasTDCRelatorio;
    const conf=achados.filter(a=>a.status==='confirmado'||a.manual);
    const datas=conf.map(a=>a.dtEntrada).filter(Boolean).sort();
    const [de,setDe]=useState(datas[0]||''),[ate,setAte]=useState(datas[datas.length-1]||'');
    const [busy,setBusy]=useState(''),[err,setErr]=useState('');
    const dentro=d=>(!de||(d&&d>=de))&&(!ate||(d&&d<=ate));
    const doPeriodo=conf.filter(a=>dentro(a.dtEntrada||''));
    const nFotos=doPeriodo.reduce((s,a)=>s+((a.fotos||[]).length),0);
    const montar=async()=>{
      const dados=Rp.montarRelatorio(res||{itens:[]},achados,{de,ate,escopo:escopoRotulo});
      const ids=[...new Set(dados.erros.flatMap(e=>e.fotos||[]))],fotos={};let feitas=0;
      for(const id of ids){setBusy('Preparando fotos ('+(++feitas)+'/'+ids.length+')…');try{fotos[id]=await fotoParaDataUrl(id);}catch(e){/* foto indisponível: o cartão mostra "sem foto" */}}
      return Rp.gerarHTML(dados,{fotos,geradoEm:new Date(),geradoPor:sessao&&(sessao.nome||sessao.usuario)||'',cobertura:{sd1Ate:res&&res.cobertura.sd1Ate,sd3Ate:res&&res.cobertura.sd3Ate}});
    };
    const nomeArq=()=>'Relatorio_Entradas_TDC_'+(de||'inicio')+'_a_'+(ate||'hoje')+'.html';
    const abrir=async()=>{
      setErr('');const w=root.open('','_blank');// abre já, no clique, para o navegador não bloquear
      try{setBusy('Montando relatório…');const html=await montar();
        if(w){w.document.open();w.document.write(html);w.document.close();}else baixarArquivo(nomeArq(),html,'text/html;charset=utf-8');}
      catch(e){setErr(e.message);if(w)w.close();}finally{setBusy('');}
    };
    const baixar=async()=>{setErr('');try{setBusy('Montando relatório…');baixarArquivo(nomeArq(),await montar(),'text/html;charset=utf-8');}catch(e){setErr(e.message);}finally{setBusy('');}};
    return h('div',{className:'sc9-tdc-modal',onClick:e=>{if(e.target===e.currentTarget&&!busy)onFechar();}},h('div',null,
      h('h2',{style:{margin:'0 0 4px',fontSize:16}},'Exportar'),
      h('p',{className:'sc9-tdc-sub'},'O relatório traz só os erros confirmados pelo estoque no período (pela data da entrada da nota), com gráficos, a foto de cada pacote ao lado, o que o Protheus mostra e a justificativa. A data e a hora da geração ficam no cabeçalho.'),
      h('div',{className:'sc9-tdc-row2',style:{marginBottom:10}},
        h('div',{className:'sc9-tdc-field'},h('label',null,'De (data da entrada)'),h('input',{className:'sc9-tdc-in',type:'date',value:de,onChange:e=>setDe(e.target.value)})),
        h('div',{className:'sc9-tdc-field'},h('label',null,'Até'),h('input',{className:'sc9-tdc-in',type:'date',value:ate,onChange:e=>setAte(e.target.value)}))),
      h('div',{className:'sc9-tdc-msg '+(doPeriodo.length?'ok':'info')},doPeriodo.length?`${doPeriodo.length} erro(s) confirmado(s) no período · ${nFotos} foto(s).`:'Nenhum erro confirmado neste período ainda. Confirme fichas no Fichário ou reporte um erro.'),
      err&&h('div',{className:'sc9-tdc-msg err'},err),busy&&h('div',{className:'sc9-tdc-msg info'},busy),
      h('div',{className:'sc9-tdc-act',style:{marginTop:12}},
        h('button',{className:'sc9-tdc-btn pri',disabled:Boolean(busy),onClick:abrir},'Abrir relatório (imprimir / PDF)'),
        h('button',{className:'sc9-tdc-btn',disabled:Boolean(busy),onClick:baixar},'Baixar .html'),
        h('button',{className:'sc9-tdc-btn',disabled:Boolean(busy),onClick:()=>onExcel(de,ate)},'Baixar Excel (dados)'),
        h('button',{className:'sc9-tdc-btn',onClick:onFechar,disabled:Boolean(busy)},'Fechar'))));
  }

  /* ------------------------------ painel principal ------------------------------ */
  function Painel({onFechar,sessao}){
    const [aba,setAba]=useState('notas');
    const [sd3Raw,setSd3Raw]=useState(null),[sd1Raw,setSd1Raw]=useState(null),[fichas,setFichas]=useState({fichas:{}});
    const [load,setLoad]=useState({sd3:'carregando',sd1:'carregando'});
    const [erro,setErro]=useState('');
    const [de,setDe]=useState(''),[ate,setAte]=useState('');
    const [fStatus,setFStatus]=useState('pendente'),[fTipo,setFTipo]=useState(''),[busca,setBusca]=useState('');
    const [exportando,setExportando]=useState(false);const [manual,setManual]=useState(null);const [soConf,setSoConf]=useState(true);const [notasReg,setNotasReg]=useState({});const [grupoEnt,setGrupoEnt]=useState('');const [escopo,setEscopo]=useState('notas');

    const carregar=useCallback(async()=>{
      setErro('');
      api('/api/movimentacao-analise').then(d=>{setSd3Raw(d);setLoad(l=>({...l,sd3:'ok'}));}).catch(e=>setLoad(l=>({...l,sd3:e.status===404?'vazio':'erro:'+e.message})));
      api('/api/entradas-tdc/sd1').then(d=>{setSd1Raw(d);setLoad(l=>({...l,sd1:'ok'}));}).catch(e=>setLoad(l=>({...l,sd1:e.status===404?'vazio':'erro:'+e.message})));
      api('/api/entradas-tdc/fichas').then(d=>setFichas(d&&d.fichas?d:{fichas:{}})).catch(e=>setErro('Fichário: '+e.message));
      api('/api/entradas-tdc/notas').then(d=>setNotasReg((d&&d.notas)||{})).catch(e=>setErro('Notas: '+e.message));
    },[]);
    useEffect(()=>{carregar();},[carregar]);
    useEffect(()=>{const k=e=>{if(e.key==='Escape'&&!manual)onFechar();};root.addEventListener('keydown',k);return()=>root.removeEventListener('keydown',k);},[manual,onFechar]);

    const sd3=useMemo(()=>sd3Raw?M.expandirSD3(sd3Raw):[],[sd3Raw]);
    const sd1All=useMemo(()=>sd1Raw?M.expandirSD1(sd1Raw):[],[sd1Raw]);
    const sd1=useMemo(()=>sd1All.filter(l=>(!de||l.dtDigit>=de)&&(!ate||l.dtDigit<=ate)&&(!grupoEnt||M.infoCFOP(l.cfop).grupo===grupoEnt)),[sd1All,de,ate,grupoEnt]);
    const gruposPresentes=useMemo(()=>{const m={};for(const l of sd1All){const g=M.infoCFOP(l.cfop).grupo;m[g]=(m[g]||0)+1;}return Object.keys(m).map(g=>[g,m[g]]);},[sd1All]);
    const fObj=fichas.fichas||{};
    const ignorar=useMemo(()=>new Set(Object.keys(fObj).filter(k=>fObj[k].status==='descartado')),[fObj]);
    const regsLista=useMemo(()=>Object.values(notasReg),[notasReg]);
    const res=useMemo(()=>sd1.length?M.analisar(sd1,sd3,{ignorar,notas:escopo==='notas'?regsLista:undefined}):null,[sd1,sd3,ignorar,escopo,regsLista]);
    const resAll=useMemo(()=>sd1All.length?M.analisar(sd1All,sd3,{ignorar,notas:regsLista}):null,[sd1All,sd3,ignorar,regsLista]);
    const achados=useMemo(()=>{
      const auto=res?M.aplicarRevisoes(res.findings,fObj):[];
      const man=Object.keys(fObj).filter(k=>k.startsWith('MANUAL|')).map(k=>M.fichaManualParaFinding(k,fObj[k]));
      return [...man,...auto];
    },[res,fObj]);
    const achadosAll=useMemo(()=>resAll?M.aplicarRevisoes(resAll.findings,fObj):[],[resAll,fObj]);
    const sd3Faixa=useMemo(()=>{let a='',b='';for(const m of sd3){if(!m.dia)continue;if(!a||m.dia<a)a=m.dia;if(!b||m.dia>b)b=m.dia;}return [a,b];},[sd3]);

    const salvarFicha=async(id,ficha)=>{const r=await api('/api/entradas-tdc/fichas',{id,ficha});setFichas(f=>({...f,fichas:{...f.fichas,[id]:r.ficha}}));};
    const analisarNota=(nota,serie)=>sd1All.length?M.analisar(sd1All,sd3,{ignorar,notas:[{nota,serie}]}):null;
    const addNota=async(nota,serie)=>{const r=await api('/api/entradas-tdc/notas',{nota,serie});setNotasReg(r.notas||{});};
    const removerNota=async reg=>{const r=await api('/api/entradas-tdc/notas',{nota:reg.nota,serie:reg.serie,remover:true});setNotasReg(r.notas||{});};
    const abrirFichasNota=reg=>{setBusca(reg.nota);setFStatus('todas');setFTipo('');setAba('ficharios');};
    const vincular=async(c,base,reg)=>{await salvarFicha('MANUAL|VINC|'+c.id+'|'+reg.nota+'|'+(reg.serie||''),{status:'confirmado',tipo:'item_fora_nota',obs:'Entrada manual de '+fmtN(c.qtdFisica)+' pç vinculada pelo estoque à NF '+reg.nota+(c.movimentos&&c.movimentos[0]?' (doc '+c.movimentos[0].doc+')':''),nota:base.nota,serie:base.serie,fornecedor:base.fornecedor,produto:c.produto,lote:c.lote,loteFisico:'',qtdNota:0,qtdFisica:c.qtdFisica,fisicoQtd:c.qtdFisica,fisicoLote:'',dtEntrada:c.dtEntrada,usuarioTDC:base.usuarioTDC});};
    const removerFicha=async a=>{await api('/api/entradas-tdc/fichas',{id:a.id,remover:true,ficha:{status:'pendente'}});setFichas(f=>{const n={...f.fichas};delete n[a.id];return {...f,fichas:n};});};

    const cont=useMemo(()=>({pendente:achados.filter(a=>a.status==='pendente').length,confirmado:achados.filter(a=>a.status==='confirmado').length,descartado:achados.filter(a=>a.status==='descartado').length,todas:achados.length}),[achados]);
    const lista=useMemo(()=>{
      const q=M.norm(busca);
      return achados.filter(a=>(fStatus==='todas'||a.status===fStatus)&&(!fTipo||a.tipo===fTipo)&&(!q||M.norm([a.nota,a.produto,a.lote,a.loteFisico,a.fornecedor,a.usuarioTDC].join(' ')).includes(q)));
    },[achados,fStatus,fTipo,busca]);

    /* ---- números do dashboard ---- */
    const r=res&&res.resumo;
    const ativos=achados.filter(a=>a.status!=='descartado'&&!a.manual);
    const atraso=useMemo(()=>{
      if(!res||res.resumo.diasMediaLimpos==null)return null;
      const base=res.resumo.diasMediaLimpos;
      return res.itens.filter(i=>i.erroForte&&i.diasAteConcluir!=null).reduce((s,i)=>s+Math.max(0,i.diasAteConcluir-base),0);
    },[res]);
    const maxTipo=r?Math.max(1,...M.TIPOS_MANUAL.map(t=>r.porTipo[t].achados)):1;
    const maxUser=r?Math.max(1,...r.porUsuario.map(u=>u.notasErro)):1;
    const maxDia=r?Math.max(1,...r.porDia.map(d=>d.notas)):1;
    const semUsuario=r&&r.porUsuario.length===1&&r.porUsuario[0].usuario==='(sem usuário)';
    const VAZIO={resumo:{notas:0,notasErro:0,itens:0,itensErro:0,pecasNota:0,pecasDivergentes:0,porTipo:Object.fromEntries(M.TIPOS_MANUAL.map(t=>[t,{achados:0,pecas:0}])),porUsuario:[],diasMediaLimpos:null,diasMediaComErro:null},itens:[],cobertura:{sd1De:'',sd1Ate:''}};
    const fazerSumula=(d1,a1)=>{try{
      const dd=d1!==undefined?d1:de,aa=a1!==undefined?a1:ate;
      const lista=achados.filter(x=>(!dd||(x.dtEntrada&&x.dtEntrada>=dd))&&(!aa||(x.dtEntrada&&x.dtEntrada<=aa)));
      baixarSumula(res||VAZIO,lista,soConf,(dd||aa)?'Entradas de '+fmtD(dd||(res&&res.cobertura.sd1De))+' a '+fmtD(aa||(res&&res.cobertura.sd1Ate)):'');}catch(e){setErro(e.message);}};

    const sd1Ate=useMemo(()=>sd1All.reduce((m,l)=>l.dtDigit>m?l.dtDigit:m,''),[sd1All]);
    const fresco=useMemo(()=>{
      const av=[];
      if(sd1Raw)av.push('SD1 com entradas até '+fmtD(sd1Ate)+' (enviado em '+fmtDH(sd1Raw.savedAt)+')');else av.push('SD1 ainda não enviado');
      if(load.sd3==='ok')av.push('SD3 (movimentação) até '+fmtD(sd3Faixa[1])+' (enviado em '+fmtDH(sd3Raw.savedAt)+')');else if(load.sd3!=='carregando')av.push('SD3 ainda não enviado pelo administrador');
      let alerta='';
      if(sd1Ate&&sd3Faixa[1]&&M.diasEntre(sd3Faixa[1],sd1Ate)>1)alerta=' ⚠ A movimentação está atrasada em relação ao SD1: o que subiu depois de '+fmtD(sd3Faixa[1])+' ainda não aparece. Peça ao administrador para atualizar o SD3 (campo "Movimentação interna" na tela inicial).';
      return {aviso:av.join(' · ')+'.'+alerta};
    },[sd1Raw,sd1Ate,load.sd3,sd3Raw,sd3Faixa]);
    const semNotas=escopo==='notas'&&!regsLista.length;
    const semDados=!sd1.length||semNotas||!res;
    const Aba=(id,txt)=>h('button',{className:'sc9-tdc-tab',role:'tab','aria-selected':aba===id,onClick:()=>setAba(id)},txt);

    return h('div',{className:'sc9-tdc-overlay',role:'dialog','aria-label':'Entradas do TDC no armazém 59'},
      h('div',{className:'sc9-tdc-top'},
        h('h1',null,'Entradas do TDC no 59',h('small',null,'Nota de entrada (SD1) × movimentação 59 → 01 (SD3): o que subiu diferente da nota')),
        h('div',{className:'sc9-tdc-tabs',role:'tablist'},Aba('notas','Notas'+(regsLista.length?' ('+regsLista.length+')':'')),Aba('painel','Dashboard'),Aba('ficharios','Fichário'+(cont.pendente?' ('+cont.pendente+')':'')),Aba('dados','Dados')),
        h('button',{className:'sc9-tdc-btn pri',onClick:()=>setExportando(true),title:'Relatório com fotos e gráficos, ou Excel com os dados'},'⬇ Exportar relatório'),
        h('button',{className:'sc9-tdc-btn',onClick:onFechar,'aria-label':'Fechar'},'✕ Fechar')),
      h('div',{className:'sc9-tdc-body'},
        erro&&h('div',{className:'sc9-tdc-msg err'},erro),
        exportando&&h(Exportar,{res,achados,sessao,escopoRotulo:escopo==='notas'?'notas informadas':'todas as notas do SD1',soConf,onExcel:(d,a)=>fazerSumula(d,a),onFechar:()=>setExportando(false)}),
        manual&&h(FichaManual,{sd1All,analisarNota,onClose:()=>setManual(null),onSave:async(id,f)=>{await salvarFicha(id,f);if(f.nota&&!regsLista.some(r=>M.normNota(r.nota)===M.normNota(f.nota)&&(!r.serie||r.serie===f.serie)))await addNota(f.nota,f.serie).catch(()=>{});},inicial:manual===true?null:manual,usuario:sessao&&(sessao.nome||sessao.usuario)}),
        aba==='notas'&&h(Notas,{fresco,sd1All,sd1Raw,res:resAll,notasReg,fObj,achados:achadosAll,onAdd:addNota,onRemover:removerNota,onFichas:abrirFichasNota,onManual:setManual,onVincular:vincular,onIrDados:()=>setAba('dados')}),
        aba==='painel'&&h('div',null,
          h('div',{className:'sc9-tdc-toolbar'},
            h('span',{className:'sc9-tdc-meta'},'Entradas de'),h('input',{type:'date',value:de,onChange:e=>setDe(e.target.value)}),h('span',{className:'sc9-tdc-meta'},'até'),h('input',{type:'date',value:ate,onChange:e=>setAte(e.target.value)}),
            (de||ate)&&h('button',{className:'sc9-tdc-btn',onClick:()=>{setDe('');setAte('');}},'Limpar período'),
            gruposPresentes.length>1&&h('select',{value:grupoEnt,onChange:e=>setGrupoEnt(e.target.value),title:'Tipo de entrada (CFOP)'},h('option',{value:''},'Todos os tipos de entrada'),gruposPresentes.map(([g,n])=>h('option',{key:g,value:g},M.GRUPOS[g]+' ('+fmtN(n)+' linhas)'))),
            h('select',{value:escopo,onChange:e=>setEscopo(e.target.value),title:'O que entra nos números'},h('option',{value:'notas'},'Só as notas que informei'+(regsLista.length?' ('+regsLista.length+')':'')),h('option',{value:'todas'},'Todas as notas do SD1')),
            h('span',{style:{flex:1}}),
            h('label',{className:'sc9-tdc-meta'},h('input',{type:'checkbox',checked:soConf,onChange:e=>setSoConf(e.target.checked)}),' Súmula só com erros confirmados')),
          semDados?h('div',{className:'sc9-tdc-card sc9-tdc-empty'},
            load.sd1==='carregando'?'Carregando…':semNotas&&sd1All.length?h('div',null,h('p',{style:{fontSize:15,fontWeight:650,color:'var(--sc9-ink,#1B2138)'}},'Nenhuma nota em conferência'),h('p',null,'Digite o número de uma nota na aba Notas, ou escolha “Todas as notas do SD1” acima.'),h('button',{className:'sc9-tdc-btn pri',onClick:()=>setAba('notas')},'Informar uma nota')):load.sd1==='vazio'||!sd1All.length?h('div',null,h('p',{style:{fontSize:15,fontWeight:650,color:'var(--sc9-ink,#1B2138)'}},'Ainda não há SD1 no painel'),h('p',null,'Envie a planilha de entradas (SD1) do armazém 59 na aba Dados e o dashboard se monta sozinho.'),h('button',{className:'sc9-tdc-btn pri',onClick:()=>setAba('dados')},'Enviar o SD1')):'Nenhuma entrada no período escolhido.'):
          h('div',null,
            load.sd3!=='ok'&&h('div',{className:'sc9-tdc-msg info'},'A movimentação (SD3) ainda não está no painel — sem ela só dá pra medir o que foi lançado à mão no fichário. O admin envia na tela de Alteração.'),
            h('div',{className:'sc9-tdc-kpis'},
              h(Kpi,{t:'Notas analisadas',v:fmtN(r.notas),sub:fmtN(r.itens)+' itens · '+fmtN(r.pecasNota)+' peças'}),
              h(Kpi,{t:'Notas com divergência',v:fmtN(r.notasErro),sub:r.notas?pct(r.notasErro/r.notas)+' das notas':'',tone:r.notasErro?'bad':'good'}),
              h(Kpi,{t:'Peças divergentes',v:fmtN(r.pecasDivergentes),sub:fmtN(r.itensErro)+' itens afetados',tone:r.pecasDivergentes?'bad':'good'}),
              h(Kpi,{t:'Dias até subir — sem erro',v:r.diasMediaLimpos==null?'—':fmtN(r.diasMediaLimpos),sub:'média da entrada à conclusão',tone:'good'}),
              h(Kpi,{t:'Dias até subir — com erro',v:r.diasMediaComErro==null?'—':fmtN(r.diasMediaComErro),sub:atraso!=null&&r.diasMediaComErro!=null?'≈ '+fmtN(atraso)+' item-dias perdidos':'sem itens concluídos com erro',tone:'warn'}),
              h(Kpi,{t:'Parados sem subir',v:fmtN(r.aguardando),sub:'entraram há mais de 2 dias e nada subiu',tone:r.aguardando?'warn':'good'})),
            h('div',{className:'sc9-tdc-kpis'},
              h(Kpi,{t:'A revisar no fichário',v:fmtN(cont.pendente),sub:'detectados pelo Protheus, aguardando o estoque'}),
              h(Kpi,{t:'Confirmados pelo estoque',v:fmtN(cont.confirmado),sub:'entram na súmula',tone:'good'}),
              h(Kpi,{t:'Descartados',v:fmtN(cont.descartado),sub:'o estoque disse que não era erro'}),
              h(Kpi,{t:'Suspeitas',v:fmtN(r.suspeitas),sub:'indícios que precisam de conferência física'})),
            h('div',{className:'sc9-tdc-grid2'},
              h('div',{className:'sc9-tdc-card'},h('h2',null,'Que tipo de erro acontece'),h('p',{className:'sc9-tdc-sub'},'Ocorrências detectadas e peças envolvidas.'),
                M.TIPOS_MANUAL.map(t=>h(Bar,{key:t,label:M.TIPOS[t].rotulo,value:r.porTipo[t].achados,max:maxTipo,color:M.TIPOS[t].cor,right:r.porTipo[t].achados+' · '+fmtN(r.porTipo[t].pecas)+' pç'}))),
              h('div',{className:'sc9-tdc-card'},h('h2',null,'Quanto tempo o erro custa'),h('p',{className:'sc9-tdc-sub'},'Da entrada da nota no 59 até a última peça subir pro 01.'),
                h(Bar,{label:'Entradas sem erro',value:r.diasMediaLimpos||0,max:Math.max(r.diasMediaLimpos||0,r.diasMediaComErro||0,1),color:'#0A8571',right:r.diasMediaLimpos==null?'—':fmtN(r.diasMediaLimpos)+' d'}),
                h(Bar,{label:'Entradas com erro',value:r.diasMediaComErro||0,max:Math.max(r.diasMediaLimpos||0,r.diasMediaComErro||0,1),color:'#C2453B',right:r.diasMediaComErro==null?'—':fmtN(r.diasMediaComErro)+' d'}),
                h('p',{className:'sc9-tdc-sub',style:{marginTop:12}},'Dias contados pela data da entrada e a data das movimentações no SD3'+(sd1.some(l=>l.hora)?'':' (o SD1 enviado não tem hora, então a medição é em dias inteiros)')+'.'))),
            h('div',{className:'sc9-tdc-grid2'},
              h('div',{className:'sc9-tdc-card'},h('h2',null,'Por quem lançou no TDC'),h('p',{className:'sc9-tdc-sub'},semUsuario?'O SD1 enviado não traz usuário. Inclua a coluna de usuário para ver o ranking por pessoa.':'Notas com divergência por usuário. Mostra o processo, não é medida de desempenho individual isolada.'),
                h('table',{className:'sc9-tdc-table'},h('thead',null,h('tr',null,['Usuário','Notas','Com erro','%','Peças div.'].map(c=>h('th',{key:c},c)))),
                  h('tbody',null,r.porUsuario.slice(0,12).map(u=>h('tr',{key:u.usuario},h('td',null,u.usuario),h('td',null,u.notas),h('td',null,u.notasErro),h('td',null,pct(u.pctNotas)),h('td',null,fmtN(u.pecasDiv))))))),
              h('div',{className:'sc9-tdc-card'},h('h2',null,'Dia a dia'),h('p',{className:'sc9-tdc-sub'},'Notas que entraram no dia (barra clara) e quantas tiveram divergência (barra vermelha).'),
                h('div',{className:'sc9-tdc-days'},r.porDia.map(d=>h('div',{className:'sc9-tdc-day',key:d.dia,title:fmtD(d.dia)+': '+d.notas+' notas, '+d.notasErro+' com divergência'},
                  h('div',{className:'sc9-tdc-wrap'},h('i',{className:'t',style:{height:Math.max(d.notas/maxDia*100,4)+'%',width:'100%'}}),h('i',{className:'e',style:{height:d.notasErro/maxDia*100+'%',width:'100%'}})),
                  h('span',null,d.dia.slice(8)+'/'+d.dia.slice(5,7))))))),
            h('p',{className:'sc9-tdc-sub'},'Cobertura: SD1 de '+fmtD(res.cobertura.sd1De)+' a '+fmtD(res.cobertura.sd1Ate)+' ('+fmtN(res.cobertura.linhasSD1)+' linhas) · SD3 de '+fmtD(sd3Faixa[0])+' a '+fmtD(sd3Faixa[1])+'. O Protheus só prova o que foi corrigido no sistema; erro ainda não corrigido aparece como “parado sem subir” ou na ficha manual.')
          )),
        aba==='ficharios'&&h('div',null,
          h('div',{className:'sc9-tdc-toolbar'},
            h('div',{className:'sc9-tdc-chips'},[['pendente','Novas'],['confirmado','Confirmadas'],['descartado','Descartadas'],['todas','Todas']].map(([k,t])=>h('button',{key:k,className:'sc9-tdc-chip','aria-pressed':fStatus===k,onClick:()=>setFStatus(k)},t+' ('+cont[k]+')'))),
            h('select',{value:fTipo,onChange:e=>setFTipo(e.target.value)},h('option',{value:''},'Todos os tipos'),M.TIPOS_MANUAL.map(t=>h('option',{key:t,value:t},M.TIPOS[t].rotulo))),
            h('input',{type:'search',placeholder:'Buscar nota, produto, lote…',value:busca,onChange:e=>setBusca(e.target.value)}),
            h('span',{style:{flex:1}}),
            h('button',{className:'sc9-tdc-btn pri',onClick:()=>setManual(true)},'+ Nova ficha manual')),
          h('p',{className:'sc9-tdc-sub'},'Cada ficha é uma entrada que o Protheus indica ter subido diferente da nota. Confira no físico, preencha o que de fato veio e confirme ou descarte. Só o confirmado vai para a súmula.'),
          lista.length?h('div',{className:'sc9-tdc-cards'},lista.map(a=>h(Ficha,{key:a.id+'|'+a.status+'|'+((a.revisao&&a.revisao.em)||''),a,onSave:(x,f)=>salvarFicha(x.id,x.manual?{...x.revisao,...f,nota:x.nota,serie:x.serie,fornecedor:x.fornecedor,produto:x.produto,lote:x.lote,loteFisico:f.fisicoLote,qtdNota:x.qtdNota,qtdFisica:f.fisicoQtd,dtEntrada:x.dtEntrada,usuarioTDC:x.usuarioTDC}:f),onRemove:removerFicha}))):
            h('div',{className:'sc9-tdc-card sc9-tdc-empty'},semDados&&!achados.length?'Envie o SD1 na aba Dados para o Protheus começar a apontar divergências.':'Nenhuma ficha neste filtro.')),
        aba==='dados'&&h('div',{className:'sc9-tdc-card',style:{marginBottom:16}},h('h2',null,'Rotina do dia'),
          h('ol',{className:'sc9-tdc-sub',style:{paddingLeft:18,margin:0}},
            h('li',null,h('b',null,'SD1'),' (notas de entrada): suba aqui, no quadro 1 abaixo. Pode subir a planilha inteira todo dia — notas novas entram, as que já existem são atualizadas e as antigas continuam guardadas.'),
            h('li',null,h('b',null,'SD3'),' (movimentação 59 → 01): é a mesma que o painel já usa. O administrador sobe na ',h('b',null,'tela inicial, campo “Movimentação interna”'),'. Suba também todo dia: é ela que mostra o que já subiu pro 01.'),
            h('li',null,h('b',null,'Notas'),': na aba Notas, digite o número da nota que vai conferir. A análise é refeita na hora com o SD1 e o SD3 que estiverem salvos.'))),
        aba==='dados'&&h('div',{className:'sc9-tdc-grid2'},
          h('div',{className:'sc9-tdc-card'},h('h2',null,'1 · SD1 — nota de entrada'),
            h('p',{className:'sc9-tdc-sub'},sd1Raw?`Guardado: ${fmtN(sd1Raw.total)} linhas · enviado por ${sd1Raw.por||'—'} em ${fmtDH(sd1Raw.savedAt)}${sd1Raw.arquivo?' · '+sd1Raw.arquivo:''}.`:'Nenhum SD1 enviado ainda. Exporte do Protheus a tabela SD1 (itens da nota de entrada) do armazém 59 com: documento, produto, lote, quantidade, data de digitação e, se possível, usuário e hora.'),
            h(EnviarSD1,{onEnviado:carregar})),
          h('div',{className:'sc9-tdc-card'},h('h2',null,'2 · SD3 — movimentação'),
            h('p',{className:'sc9-tdc-sub'},load.sd3==='ok'?`Já está no painel: ${fmtN(sd3Raw.total)} movimentações com lote, de ${fmtD(sd3Faixa[0])} a ${fmtD(sd3Faixa[1])}, enviada por ${sd3Raw.por||'—'} em ${fmtDH(sd3Raw.savedAt)}.`:load.sd3==='carregando'?'Carregando…':load.sd3==='vazio'?'Nenhuma movimentação salva ainda. Peça ao admin para subir a planilha de movimentação na tela de Alteração; ela é a mesma que o painel já usa.':'Não consegui carregar: '+load.sd3.replace('erro:','')),
            h('p',{className:'sc9-tdc-sub'},'Para o cruzamento funcionar, a movimentação precisa cobrir o mesmo período do SD1 (e algumas semanas depois, pois a subida pro 01 e as correções acontecem depois da entrada).'),
            h('h2',{style:{marginTop:14}},'Como o Protheus aponta o erro'),
            h('ul',{className:'sc9-tdc-sub',style:{paddingLeft:18}},
              h('li',null,'Entrada ou saída manual no 59 depois da nota → quantidade diferente.'),
              h('li',null,'Entrada manual de produto/lote que não existe em nenhuma nota → item fora da nota.'),
              h('li',null,'Troca entre lotes (transferência no 59, saída X + entrada Y, ou subir pro 01 com outro lote) → lote trocado/misturado.'),
              h('li',null,'Nota que ficou parada enquanto outro lote do mesmo produto subiu → suspeita, a confirmar no físico.'))))));
  }

  /* ------------------------------ lançador ------------------------------ */
  function App(){
    const [sessao,setSessao]=useState(null);const [aberto,setAberto]=useState(false);
    useEffect(()=>{
      let vivo=true,t;
      const checar=async()=>{
        try{const s=await fetch('/api/session',{credentials:'same-origin'}).then(r=>r.json());
          if(!vivo)return;
          const ok=Boolean(s&&s.authed&&(s.role==='admin'||(s.perfis||[]).includes('alteracoes')));
          setSessao(ok?s:null);
        }catch(e){/* offline: tenta de novo */}
        if(vivo)t=setTimeout(checar,20000);
      };
      checar();return()=>{vivo=false;clearTimeout(t);};
    },[]);
    if(!sessao)return null;
    return h(R.Fragment,null,
      !aberto&&h('button',{className:'sc9-tdc-fab',onClick:()=>setAberto(true),title:'Erros de entrada do TDC no armazém 59'},'Entradas TDC (59)'),
      aberto&&h(Painel,{sessao,onFechar:()=>setAberto(false)}));
  }
  function montar(){
    if(root.document.getElementById('sc9-tdc-root'))return;
    const el=root.document.createElement('div');el.id='sc9-tdc-root';root.document.body.appendChild(el);
    root.ReactDOM.createRoot(el).render(h(App));
  }
  root.SC9EntradasTDCUI={montar};
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',montar);else montar();
})(typeof window==='object'?window:globalThis);
