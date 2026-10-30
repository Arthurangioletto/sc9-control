/* Entradas do TDC no armazém 59 (SD1) x movimentação (SD3): acha o que subiu diferente da nota.
 * Módulo independente (não depende do bundle): modelo puro + tela "fichário" aberta por um botão no painel.
 * O modelo é testável em Node (module.exports); a tela só monta se existir React/DOM. */
(function(root){
  'use strict';
  /* ============================ utilidades ============================ */
  const norm=v=>String(v==null?'':v).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const normProd=v=>{let s=String(v==null?'':v).trim().toUpperCase();if(/^\d+$/.test(s))s=s.replace(/^0+(?=\d)/,'');return s;};
  const normLote=v=>String(v==null?'':v).trim().toUpperCase();
  const normArm=v=>{const s=String(v==null?'':v).trim();return /^\d+$/.test(s)?String(Number(s)):s.toUpperCase();};
  const num=v=>{if(typeof v==='number')return Number.isFinite(v)?v:0;let s=String(v==null?'':v).trim();if(!s)return 0;if(/,/.test(s))s=s.replace(/\./g,'').replace(',','.');const n=Number(s);return Number.isFinite(n)?n:0;};
  const p2=n=>String(n).padStart(2,'0');
  function paraISO(v){
    if(v==null||v==='')return '';
    if(v instanceof Date){if(!Number.isFinite(v.getTime()))return '';const d=new Date(v.getTime()+12*3600000);return d.getUTCFullYear()+'-'+p2(d.getUTCMonth()+1)+'-'+p2(d.getUTCDate());}
    if(typeof v==='number'){if(v>20000&&v<80000){const d=new Date(Date.UTC(1899,11,30)+Math.round(v)*86400000);return d.getUTCFullYear()+'-'+p2(d.getUTCMonth()+1)+'-'+p2(d.getUTCDate());}if(v>=19000101&&v<=29991231)v=String(v);else return '';}
    const s=String(v).trim();let m;
    if((m=s.match(/^(\d{4})-(\d{2})-(\d{2})/)))return m[1]+'-'+m[2]+'-'+m[3];
    if((m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)))return m[3]+'-'+p2(m[2])+'-'+p2(m[1]);
    if((m=s.match(/^(\d{4})(\d{2})(\d{2})$/)))return m[1]+'-'+m[2]+'-'+m[3];
    return '';
  }
  const paraHora=v=>{if(v==null||v==='')return '';if(v instanceof Date)return p2(v.getUTCHours())+':'+p2(v.getUTCMinutes());if(typeof v==='number'&&v>0&&v<1){const mins=Math.round(v*1440);return p2(Math.floor(mins/60)%24)+':'+p2(mins%60);}const m=String(v).trim().match(/^(\d{1,2}):(\d{2})/);return m?p2(m[1])+':'+m[2]:'';};
  const normNota=v=>{const s=String(v==null?'':v).trim();return /^\d+$/.test(s)?s.replace(/^0+(?=\d)/,''):s.toUpperCase();};
  const combinaNota=(l,regs)=>regs.some(r=>normNota(r.nota)===normNota(l.nota)&&(!r.serie||String(r.serie).trim()===String(l.serie||'').trim()));
  /* acha no SD1 os itens de UMA nota (pelo número digitado). Se houver várias séries com o mesmo número e a série não foi dita, devolve as séries para a pessoa escolher. */
  function buscarNota(sd1,nota,serie){
    const alvo=normNota(nota);if(!alvo)return {itens:[],series:[]};
    let itens=sd1.filter(l=>normNota(l.nota)===alvo);
    const series=[...new Set(itens.map(l=>String(l.serie||'').trim()))];
    if(serie&&String(serie).trim())itens=itens.filter(l=>String(l.serie||'').trim()===String(serie).trim());
    return {itens,series};
  }
  const diasEntre=(a,b)=>{if(!a||!b)return null;const pa=a.split('-').map(Number),pb=b.split('-').map(Number);return Math.round((Date.UTC(pb[0],pb[1]-1,pb[2])-Date.UTC(pa[0],pa[1]-1,pa[2]))/86400000);};
  const hojeISO=()=>{const d=new Date();return d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());};

  /* ============================ leitura do SD1 ============================ */
  const CAMPOS={
    nota:['documento','nota','nf','numnf','numerodanota','notafiscal','docentrada','d1doc','numerodocumento','ndocumento','numdoc','nfentrada'],
    serie:['serie','d1serie','serienf'],
    fornecedor:['nomefornecedor','fornecedor','razaosocial','nomefornece','d1fornece','nomedofornecedor','forncliente','fornecliente','codfornecedor'],
    produto:['produto','codigo','codigoproduto','cod','d1cod','codproduto','codigodoproduto'],
    lote:['lote','lotectl','d1lotectl','lotedoproduto','lotefornecedor'],
    qt:['quantidade','qtd','qtde','quant','d1quant','qt','quantnf'],
    armazem:['armazem','local','d1local','almoxarifado','arm','armazemdestino'],
    dtDigit:['dtdigit','datadigitacao','dtdigitacao','d1dtdigit','dataentrada','dtentrada','digitacao','datadadigitacao','dtdigitacao','dtlancamento'],
    emissao:['emissao','dtemissao','dataemissao','d1emissao','dtemissaonf'],
    usuario:['usuario','usr','usuarioinclusao','d1userlgi','usuariodigitacao','digitadopor','incluidopor','user','login','nomeusuario','usuarioinclusaoentrada','operador'],
    hora:['hora','horadigitacao','d1hora','horaentrada','horainclusao'],
    tipoEntrada:['tipoentrada','tipodeentrada','d1tes','tes'],
    cfop:['codfiscal','cfop','d1cf','codigofiscal'],
    validade:['dtvalid','datavalidade','validade','d1dtvalid','dtvalidade','dtvalidlote','validlote'],
  };
  const OBRIGATORIOS=['nota','produto','lote','qt','dtDigit'];
  const ROTULO_CAMPO={nota:'Nota (documento)',serie:'Série',fornecedor:'Fornecedor',produto:'Produto',lote:'Lote',qt:'Quantidade',armazem:'Armazém',dtDigit:'Data da entrada (digitação)',emissao:'Emissão',usuario:'Usuário que lançou',hora:'Hora da entrada',validade:'Validade',tipoEntrada:'Tipo de entrada (TES)',cfop:'CFOP (Cód. Fiscal)'};
  function pontuar(h,campo){const n=norm(h);if(!n)return 0;let best=0;for(const sin of CAMPOS[campo]){if(n===sin)best=Math.max(best,3);else if(sin.length>=4&&(n.startsWith(sin)||n.endsWith(sin)))best=Math.max(best,2);else if(sin.length>=5&&n.includes(sin))best=Math.max(best,1);}return best;}
  /* aoa = matriz de linhas (primeira linha com dados pode não ser o cabeçalho). Devolve {linhaCab, mapa, faltando, cabecalhos} */
  function detectarColunasSD1(aoa){
    let melhor={score:-1,linha:0,mapa:{}};
    for(let r=0;r<Math.min(aoa.length,25);r++){
      const row=aoa[r]||[],usados=new Set(),mapa={};let score=0;
      const cand=[];row.forEach((h,c)=>{for(const campo of Object.keys(CAMPOS)){const s=pontuar(h,campo);if(s)cand.push({campo,c,s});}});
      cand.sort((a,b)=>b.s-a.s);
      for(const x of cand){if(mapa[x.campo]!==undefined||usados.has(x.c))continue;mapa[x.campo]=x.c;usados.add(x.c);score+=x.s+(OBRIGATORIOS.includes(x.campo)?2:0);}
      if(score>melhor.score)melhor={score,linha:r,mapa};
    }
    const cab=(aoa[melhor.linha]||[]).map(x=>String(x==null?'':x));
    return {linhaCab:melhor.linha,mapa:melhor.mapa,faltando:OBRIGATORIOS.filter(c=>melhor.mapa[c]===undefined),cabecalhos:cab};
  }
  function lerSD1(aoa,mapa,linhaCab){
    const out=[],g=(row,c)=>c===undefined?undefined:row[c];
    for(let r=linhaCab+1;r<aoa.length;r++){
      const row=aoa[r]||[];const produto=normProd(g(row,mapa.produto)),lote=normLote(g(row,mapa.lote)),nota=String(g(row,mapa.nota)==null?'':g(row,mapa.nota)).trim();
      if(!produto||!nota)continue;
      const qt=num(g(row,mapa.qt));if(!qt)continue;
      out.push({nota,serie:String(g(row,mapa.serie)==null?'':g(row,mapa.serie)).trim(),fornecedor:String(g(row,mapa.fornecedor)==null?'':g(row,mapa.fornecedor)).trim(),
        produto,lote,qt,armazem:mapa.armazem===undefined?'':normArm(g(row,mapa.armazem)),dtDigit:paraISO(g(row,mapa.dtDigit)),emissao:paraISO(g(row,mapa.emissao)),
        hora:paraHora(g(row,mapa.hora)),usuario:String(g(row,mapa.usuario)==null?'':g(row,mapa.usuario)).trim().toLowerCase(),validade:paraISO(g(row,mapa.validade)),
        tipo:String(g(row,mapa.tipoEntrada)==null?'':g(row,mapa.tipoEntrada)).trim().replace(/\.0+$/,''),cfop:String(g(row,mapa.cfop)==null?'':g(row,mapa.cfop)).trim().replace(/\.0+$/,'')});
    }
    /* a mesma nota costuma ter o mesmo produto/lote em mais de um item: soma, para cada nota+produto+lote ser uma linha só */
    const agr=new Map();
    for(const l of out){const k=[l.nota,l.serie,l.produto,l.lote,l.dtDigit,l.armazem].join('|');const x=agr.get(k);if(x)x.qt+=l.qt;else agr.set(k,{...l});}
    return [...agr.values()];
  }
  /* cópia compacta pro servidor (só o necessário; usuários em tabela) */
  function compactarSD1(linhas){const us=[],um=new Map();const ix=v=>{if(!um.has(v)){um.set(v,us.length);us.push(v);}return um.get(v);};
    return {usuarios:us,rows:linhas.map(l=>[l.nota,l.serie,l.fornecedor,l.produto,l.lote,l.qt,l.armazem,l.dtDigit,l.hora,ix(l.usuario),l.emissao,l.validade,l.tipo||'',l.cfop||''])};}
  function expandirSD1(obj){const us=(obj&&obj.usuarios)||[];return ((obj&&obj.rows)||[]).map(r=>({nota:String(r[0]),serie:r[1]||'',fornecedor:r[2]||'',produto:r[3],lote:r[4],qt:Number(r[5])||0,armazem:r[6]||'',dtDigit:r[7]||'',hora:r[8]||'',usuario:us[r[9]]||'',emissao:r[10]||'',validade:r[11]||'',tipo:r[12]||'',cfop:r[13]||''}));}
  /* movimentação compacta do servidor (/api/movimentacao-analise) -> registros com dia ISO */
  function expandirSD3(obj){
    const us=(obj&&obj.usuarios)||[],cs=(obj&&obj.cfs)||[];
    return ((obj&&obj.rows)||[]).map(r=>({tp:Number(r[0]),produto:normProd(r[1]),qt:Number(r[2])||0,armazem:normArm(r[3]),doc:String(r[4]||'').trim(),lote:normLote(r[5]),usuario:us[r[6]]||'',dia:r[7]||'',cf:String(cs[r[8]]||'').trim().toUpperCase(),estornado:!!r[9]}));
  }

  /* CFOP (Código Fiscal de Operações) é padrão nacional: os 3 últimos dígitos dizem a operação; o 1º diz de onde veio (1 = mesmo estado, 2 = outro estado, 3 = exterior). O TES (Tipo de Entrada) é cadastro da empresa, mas carrega um CFOP. */
  const CFOP={'201':['Devolução de venda (produção própria)','devolucao'],'202':['Devolução de venda (mercadoria adquirida)','devolucao'],'203':['Devolução de venda (ZFM)','devolucao'],'204':['Devolução de venda (ZFM)','devolucao'],
    '918':['Devolução de consignação','consig'],'919':['Devolução simbólica de consignação','consig'],'913':['Retorno de demonstração / mostruário','consig'],'914':['Retorno de mercadoria p/ exposição ou feira','consig'],'916':['Retorno de conserto ou reparo','consig'],'917':['Entrada em consignação','consig'],
    '910':['Bonificação, doação ou brinde','bonif'],'152':['Transferência entre estabelecimentos','transf'],'151':['Transferência de produção','transf'],'949':['Outra entrada','outras'],'556':['Compra para uso e consumo','compra'],'102':['Compra para comercialização','compra'],'101':['Compra para industrialização','compra'],'403':['Compra p/ comercialização (ST)','compra']};
  const GRUPOS={devolucao:'Devolução de venda',consig:'Consignação / demonstração',bonif:'Bonificação / doação',transf:'Transferência',compra:'Compra',outras:'Outras entradas'};
  function infoCFOP(c){const s=String(c||'').trim();if(!/^\d{4}$/.test(s))return {rotulo:s?('CFOP '+s):'Sem CFOP',grupo:'outras'};const origem={'1':'','2':' (interestadual)','3':' (exterior)'}[s[0]]||'';const x=CFOP[s.slice(1)];return x?{rotulo:x[0]+origem,grupo:x[1]}:{rotulo:'CFOP '+s,grupo:'outras'};}
  /* ============================ motor de análise ============================ */
  const TRANSF=new Set(['RE4','DE4','RE3','DE3']);
  const TIPOS={
    qtd_maior:{rotulo:'Veio MAIS do que a nota',curto:'Qtd. a mais',cor:'#B3261E'},
    qtd_menor:{rotulo:'Veio MENOS do que a nota',curto:'Qtd. a menos',cor:'#C2630A'},
    item_fora_nota:{rotulo:'Item que NÃO estava na nota',curto:'Fora da nota',cor:'#7A3FB0'},
    lote_trocado:{rotulo:'Lote trocado / misturado',curto:'Lote errado',cor:'#0B6FA4'},
  };
  const TIPOS_MANUAL=Object.keys(TIPOS);
  const idFinding=(l,tipo)=>[l.nota,l.serie||'',l.produto,l.lote,tipo].join('|');
  /* sd1: linhas normalizadas; sd3: registros {tp,produto,qt,armazem,doc,lote,usuario,dia,cf,estornado} */
  function analisar(sd1,sd3,opt={}){
    const ARM=normArm(opt.armazemTDC||'59'),JANELA=opt.janelaDias==null?30:opt.janelaDias,SEM_SUBIR=opt.diasSemSubir==null?2:opt.diasSemSubir,HOJE=opt.hoje||hojeISO();
    const linhas=sd1.filter(l=>!l.armazem||l.armazem===ARM).map((l,i)=>({...l,_i:i}));
    const keyPL=(p,l)=>p+'|'+l;
    /* SD3 no armazém TDC e transferências */
    const mov=sd3.filter(m=>!m.estornado&&m.dia).map((m,i)=>({...m,_m:i,dir:m.tp>=500?'saida':'entrada'}));
    const noTDC=mov.filter(m=>m.armazem===ARM);
    const porDocProd=new Map();for(const m of mov){if(!TRANSF.has(m.cf)||!m.doc)continue;const k=m.doc+'|'+m.produto;if(!porDocProd.has(k))porDocProd.set(k,[]);porDocProd.get(k).push(m);}
    const info=m=>({dia:m.dia,doc:m.doc,cf:m.cf,tp:m.tp,qt:m.qt,armazem:m.armazem,lote:m.lote,usuario:m.usuario,dir:m.dir});
    /* classifica cada movimento do TDC */
    const manuais=[],subidas=[],trocasInternas=[],subidasLoteDiferente=[],entradasTransf=[];
    for(const m of noTDC){
      if(!TRANSF.has(m.cf)){manuais.push(m);continue;}
      if(m.dir==='saida'&&m.cf==='RE4'){
        const grp=(porDocProd.get(m.doc+'|'+m.produto)||[]).filter(x=>x.cf==='DE4'&&x.dir==='entrada');
        const destino=grp.find(x=>x.lote===m.lote)||grp[0]||null;
        if(destino&&destino.armazem===ARM&&destino.lote!==m.lote)trocasInternas.push({de:m,para:destino});
        else if(destino&&destino.lote!==m.lote)subidasLoteDiferente.push({de:m,para:destino});
        else subidas.push({de:m,para:destino});
      }else if(m.dir==='entrada')entradasTransf.push(m);
    }
    /* agrupa SD1 por produto|lote, em ordem de data: cada movimento pertence à última entrada que veio antes dele */
    const grupos=new Map();for(const l of linhas){const k=keyPL(l.produto,l.lote);if(!grupos.has(k))grupos.set(k,[]);grupos.get(k).push(l);}
    for(const arr of grupos.values())arr.sort((a,b)=>(a.dtDigit||'').localeCompare(b.dtDigit||'')||a._i-b._i);
    const dataMin=linhas.reduce((m,l)=>l.dtDigit&&(!m||l.dtDigit<m)?l.dtDigit:m,'');
    const sd3De=mov.reduce((m,x)=>!m||x.dia<m?x.dia:m,''),sd3Ate=mov.reduce((m,x)=>!m||x.dia>m?x.dia:m,'');
    const dono=(prod,lote,dia)=>{const arr=grupos.get(keyPL(prod,lote));if(!arr)return null;let ach=null;for(const l of arr){if(!l.dtDigit||l.dtDigit<=dia)ach=l;}if(!ach)return null;const d=diasEntre(ach.dtDigit,dia);return d!==null&&d>=0&&d<=JANELA?ach:null;};
    const ev=new Map();const evDe=l=>{if(!ev.has(l._i))ev.set(l._i,{manIn:[],manOut:[],subidas:[],trocas:[],outrosLotes:[]});return ev.get(l._i);};
    const usado=new Set();
    /* 1) trocas de lote explícitas (transferência interna no 59, ou subida pro destino com outro lote) */
    const findings=[];
    const add=f=>{f.id=f.id||idFinding(f,f.tipo);findings.push(f);};
    const pareDoc=(de,para,kind)=>{
      const origem=dono(de.produto,de.lote,de.dia);const dest=dono(para.produto,para.lote,para.dia);
      const l=origem||dest;if(!l)return false;
      usado.add(de._m);usado.add(para._m);
      add({tipo:'lote_trocado',confianca:'forte',nota:l.nota,serie:l.serie,fornecedor:l.fornecedor,produto:l.produto,lote:origem?de.lote:para.lote,loteFisico:origem?para.lote:de.lote,
        qtdNota:l.qt,qtdFisica:null,diferenca:de.qt,dtEntrada:l.dtDigit,usuarioTDC:l.usuario,corrigidoPor:[de.usuario].filter(Boolean),movimentos:[info(de),info(para)],
        descricao:kind==='interna'?`Nota veio com o lote ${origem?de.lote:para.lote}, mas o estoque trocou ${de.qt} pç para o lote ${origem?para.lote:de.lote} dentro do ${ARM} (doc ${de.doc}).`:`Nota veio com o lote ${de.lote}, mas ao subir pro ${para.armazem} o estoque usou o lote ${para.lote} (${de.qt} pç, doc ${de.doc}).`});
      return true;
    };
    for(const t of trocasInternas)pareDoc(t.de,t.para,'interna');
    for(const t of subidasLoteDiferente)pareDoc(t.de,t.para,'subida');
    /* 2) trocas por ajuste manual: saída do lote X e entrada do lote Y do mesmo produto, perto no tempo */
    const manProd=new Map();for(const m of manuais){if(usado.has(m._m))continue;if(!manProd.has(m.produto))manProd.set(m.produto,[]);manProd.get(m.produto).push(m);}
    for(const [prod,arr] of manProd){
      const outs=arr.filter(m=>m.dir==='saida'),ins=arr.filter(m=>m.dir==='entrada');
      for(const o of outs){
        const lo=dono(prod,o.lote,o.dia);if(!lo)continue;
        const y=ins.find(i=>!usado.has(i._m)&&i.lote!==o.lote&&Math.abs(diasEntre(o.dia,i.dia))<=1&&(o.doc===i.doc||o.usuario===i.usuario));
        if(!y)continue;usado.add(o._m);usado.add(y._m);
        const q=Math.min(o.qt,y.qt),parcial=q<lo.qt;
        add({tipo:'lote_trocado',confianca:'forte',nota:lo.nota,serie:lo.serie,fornecedor:lo.fornecedor,produto:prod,lote:o.lote,loteFisico:y.lote,qtdNota:lo.qt,qtdFisica:null,diferenca:q,dtEntrada:lo.dtDigit,usuarioTDC:lo.usuario,
          corrigidoPor:[...new Set([o.usuario,y.usuario].filter(Boolean))],movimentos:[info(o),info(y)],
          descricao:parcial?`Lote misturado: dos ${lo.qt} pç da nota (lote ${o.lote}), ${q} pç eram do lote ${y.lote}. O estoque tirou do ${o.lote} e lançou no ${y.lote}.`:`Lote trocado: nota veio com ${o.lote}, físico era ${y.lote} (${q} pç). O estoque ajustou manualmente.`});
      }
    }
    /* 3) ajustes manuais restantes: quantidade a mais/menos, ou item fora da nota */
    for(const m of manuais){
      if(usado.has(m._m))continue;
      const l=dono(m.produto,m.lote,m.dia);
      if(l){evDe(l)[m.dir==='entrada'?'manIn':'manOut'].push(m);usado.add(m._m);continue;}
      if(m.dir==='entrada'&&dataMin&&m.dia>=dataMin&&!grupos.has(keyPL(m.produto,m.lote))){
        usado.add(m._m);
        add({id:['SEM-NOTA',m.doc,m.produto,m.lote,'item_fora_nota'].join('|'),tipo:'item_fora_nota',confianca:'forte',nota:'',serie:'',fornecedor:'',produto:m.produto,lote:m.lote,loteFisico:'',qtdNota:0,qtdFisica:m.qt,diferenca:m.qt,dtEntrada:m.dia,usuarioTDC:'',
          corrigidoPor:[m.usuario].filter(Boolean),movimentos:[info(m)],descricao:`Entrou ${m.qt} pç do lote ${m.lote} no ${ARM} por ajuste manual (doc ${m.doc}) e não existe nenhuma nota desse produto/lote no SD1 do período.`});
      }
    }
    for(const [i,e] of ev){
      const l=linhas[i];const mi=e.manIn.reduce((s,m)=>s+m.qt,0),mo=e.manOut.reduce((s,m)=>s+m.qt,0);
      if(mi>0)add({tipo:'qtd_maior',confianca:'forte',nota:l.nota,serie:l.serie,fornecedor:l.fornecedor,produto:l.produto,lote:l.lote,loteFisico:'',qtdNota:l.qt,qtdFisica:l.qt+mi-mo,diferenca:mi-mo>0?mi-mo:mi,dtEntrada:l.dtDigit,usuarioTDC:l.usuario,
        corrigidoPor:[...new Set(e.manIn.map(m=>m.usuario).filter(Boolean))],movimentos:e.manIn.map(info),descricao:`Nota diz ${l.qt}, mas o estoque precisou dar entrada manual de ${mi} pç no ${ARM} (doc ${e.manIn.map(m=>m.doc).join(', ')}). Físico real: ${l.qt+mi-mo}.`});
      if(mo>0)add({tipo:'qtd_menor',confianca:'forte',nota:l.nota,serie:l.serie,fornecedor:l.fornecedor,produto:l.produto,lote:l.lote,loteFisico:'',qtdNota:l.qt,qtdFisica:l.qt+mi-mo,diferenca:mo-mi>0?mo-mi:mo,dtEntrada:l.dtDigit,usuarioTDC:l.usuario,
        corrigidoPor:[...new Set(e.manOut.map(m=>m.usuario).filter(Boolean))],movimentos:e.manOut.map(info),descricao:`Nota diz ${l.qt}, mas o estoque precisou baixar ${mo} pç no ${ARM} por ajuste manual (doc ${e.manOut.map(m=>m.doc).join(', ')}). Físico real: ${l.qt+mi-mo}.`});
    }
    /* subidas normais por entrada (lote igual) e tempos */
    const subPorLinha=new Map();
    for(const s of subidas){const l=dono(s.de.produto,s.de.lote,s.de.dia);if(!l)continue;if(!subPorLinha.has(l._i))subPorLinha.set(l._i,[]);subPorLinha.get(l._i).push(s.de);}
    /* 4) suspeita: nota do lote X ficou parada e o mesmo produto subiu em outro lote sem nota */
    const chaveL=l=>l.nota+'|'+l.serie+'|'+l.produto+'|'+l.lote;
    const chavesF=new Set(findings.map(f=>f.nota+'|'+f.serie+'|'+f.produto+'|'+f.lote));
    const subSemNota=subidas.filter(s=>!dono(s.de.produto,s.de.lote,s.de.dia)&&!grupos.has(keyPL(s.de.produto,s.de.lote)));
    for(const l of linhas){
      const subiu=(subPorLinha.get(l._i)||[]).reduce((s,m)=>s+m.qt,0),temFinding=chavesF.has(chaveL(l));
      if(temFinding||subiu>=l.qt)continue;
      const outros=subSemNota.filter(s=>s.de.produto===l.produto&&s.de.dia>=l.dtDigit&&diasEntre(l.dtDigit,s.de.dia)<=JANELA);
      if(outros.length){const q=outros.reduce((s,x)=>s+x.de.qt,0);
        add({tipo:'lote_trocado',confianca:'suspeita',nota:l.nota,serie:l.serie,fornecedor:l.fornecedor,produto:l.produto,lote:l.lote,loteFisico:[...new Set(outros.map(x=>x.de.lote))].join(', '),qtdNota:l.qt,qtdFisica:null,diferenca:q,dtEntrada:l.dtDigit,usuarioTDC:l.usuario,
          corrigidoPor:[...new Set(outros.map(x=>x.de.usuario).filter(Boolean))],movimentos:outros.map(x=>info(x.de)),descricao:`Nota é do lote ${l.lote} (${l.qt} pç) e ficou ${subiu?'só em parte':'sem'} subir, mas o mesmo produto subiu pro ${outros[0].para?outros[0].para.armazem:'01'} em outro lote (${[...new Set(outros.map(x=>x.de.lote))].join(', ')}, ${q} pç) que não consta no SD1. Confirme no físico.`});}
    }
    /* resumo por item de nota (tempo até subir) e por nota */
    const IGN=opt.ignorar||new Set(),ativos=findings.filter(f=>!IGN.has(f.id)),porChave=new Map();
    for(const f of ativos){const k=f.nota+'|'+f.serie+'|'+f.produto+'|'+f.lote;if(!porChave.has(k))porChave.set(k,[]);porChave.get(k).push(f);}
    const itens=linhas.map(l=>{
      const subs=(subPorLinha.get(l._i)||[]).slice().sort((a,b)=>a.dia.localeCompare(b.dia));
      const subiu=subs.reduce((s,m)=>s+m.qt,0),ult=subs.length?subs[subs.length-1].dia:'',pri=subs.length?subs[0].dia:'';
      const fa=porChave.get(chaveL(l))||[],fs=fa.filter(f=>f.confianca==='forte');
      const semCobertura=!sd3De||l.dtDigit<sd3De;
      const depoisSD3=Boolean(sd3Ate)&&l.dtDigit>sd3Ate;
      const diasCobertos=sd3Ate?diasEntre(l.dtDigit,sd3Ate):null;
      const aguardando=!subs.length&&!fa.length&&!semCobertura&&diasCobertos!==null&&diasCobertos>SEM_SUBIR;
      const diasSemSubir=aguardando?diasEntre(l.dtDigit,HOJE):null;
      const dtCorr=fa.flatMap(f=>f.movimentos.map(m=>m.dia)).sort().pop()||'';
      const ve=ev.get(l._i)||{manIn:[],manOut:[]},vistoE=new Set();
      const eventos=[...subs.map(info),...ve.manIn.map(info),...ve.manOut.map(info),...fa.flatMap(f=>f.movimentos)].filter(m=>{const k=[m.dia,m.doc,m.cf,m.dir,m.qt,m.lote,m.armazem].join('|');if(vistoE.has(k))return false;vistoE.add(k);return true;}).sort((a,b)=>a.dia.localeCompare(b.dia));
      const outrasNotas=(grupos.get(keyPL(l.produto,l.lote))||[]).filter(x=>x._i!==l._i&&(x.nota!==l.nota||x.serie!==l.serie)).map(x=>({nota:x.nota,serie:x.serie,dtDigit:x.dtDigit,qt:x.qt}));
      return {nota:l.nota,serie:l.serie,fornecedor:l.fornecedor,tipo:l.tipo||'',cfop:l.cfop||'',produto:l.produto,lote:l.lote,qtNota:l.qt,dtEntrada:l.dtDigit,hora:l.hora,usuarioTDC:l.usuario,subiu,eventos,outrasNotas,
        diasAteSubir:pri?diasEntre(l.dtDigit,pri):null,diasAteConcluir:ult&&subiu>=l.qt?diasEntre(l.dtDigit,ult):null,erroForte:fs.length>0,erro:fa.length>0,tipos:[...new Set(fa.map(f=>f.tipo))],
        semCobertura,depoisSD3,diasAteCorrigir:dtCorr?diasEntre(l.dtDigit,dtCorr):null,aguardandoSubir:aguardando&&diasSemSubir!==null&&diasSemSubir>SEM_SUBIR,diasSemSubir};
    });
    /* "item fora da nota" não tem nota (por definição): vira candidato para a pessoa vincular à nota certa */
    const candidatos=findings.filter(f=>!f.nota);
    let fin=findings,itn=itens,atv=ativos;
    if(Array.isArray(opt.notas)){
      const regs=opt.notas;
      fin=findings.filter(f=>f.nota&&combinaNota(f,regs));itn=itens.filter(i=>combinaNota(i,regs));atv=ativos.filter(f=>f.nota&&combinaNota(f,regs));
    }
    return {findings:fin.sort((a,b)=>(b.dtEntrada||'').localeCompare(a.dtEntrada||'')||String(a.nota).localeCompare(String(b.nota))),itens:itn,candidatos,resumo:resumir(itn,atv,linhas),
      cobertura:{sd1De:dataMin,sd1Ate:linhas.reduce((m,l)=>l.dtDigit>m?l.dtDigit:m,''),linhasSD1:linhas.length,movimentosSD3:noTDC.length,sd3De,sd3Ate}};
  }
  const media=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
  function resumir(itens,findings,linhas){
    const notas=new Map();for(const it of itens){const k=it.nota+'|'+it.serie;if(!notas.has(k))notas.set(k,{nota:it.nota,serie:it.serie,fornecedor:it.fornecedor,usuarioTDC:it.usuarioTDC,dtEntrada:it.dtEntrada,itens:0,itensErro:0,pecas:0,dias:[],erro:false});const n=notas.get(k);n.itens++;n.pecas+=it.qtNota;if(it.erroForte){n.itensErro++;n.erro=true;}if(it.diasAteConcluir!==null)n.dias.push(it.diasAteConcluir);}
    const lista=[...notas.values()];const forte=findings.filter(f=>f.confianca==='forte');
    const porUsuario=new Map(),porTipo={},porDia=new Map();
    for(const t of TIPOS_MANUAL)porTipo[t]={achados:0,pecas:0};
    for(const f of forte){porTipo[f.tipo].achados++;porTipo[f.tipo].pecas+=Math.abs(f.diferenca||0);}
    for(const n of lista){const u=n.usuarioTDC||'(sem usuário)';if(!porUsuario.has(u))porUsuario.set(u,{usuario:u,notas:0,notasErro:0,itens:0,itensErro:0,pecasDiv:0});const x=porUsuario.get(u);x.notas++;x.itens+=n.itens;x.itensErro+=n.itensErro;if(n.erro)x.notasErro++;
      const d=n.dtEntrada||'';if(!porDia.has(d))porDia.set(d,{dia:d,notas:0,notasErro:0});const y=porDia.get(d);y.notas++;if(n.erro)y.notasErro++;}
    for(const f of forte){const u=f.usuarioTDC||'(sem usuário)';if(porUsuario.has(u))porUsuario.get(u).pecasDiv+=Math.abs(f.diferenca||0);}
    const limpos=itens.filter(i=>!i.erroForte&&i.diasAteConcluir!==null).map(i=>i.diasAteConcluir),comErro=itens.filter(i=>i.erroForte&&i.diasAteConcluir!==null).map(i=>i.diasAteConcluir);
    return {notas:lista.length,notasErro:lista.filter(n=>n.erro).length,itens:itens.length,itensErro:itens.filter(i=>i.erroForte).length,pecasNota:itens.reduce((s,i)=>s+i.qtNota,0),
      pecasDivergentes:forte.reduce((s,f)=>s+Math.abs(f.diferenca||0),0),suspeitas:findings.length-forte.length,achadosForte:forte.length,porTipo,
      porUsuario:[...porUsuario.values()].map(x=>({...x,pctNotas:x.notas?x.notasErro/x.notas:0})).sort((a,b)=>b.notasErro-a.notasErro||b.pctNotas-a.pctNotas),
      porDia:[...porDia.values()].sort((a,b)=>a.dia.localeCompare(b.dia)),
      diasMediaLimpos:media(limpos),diasMediaComErro:media(comErro),aguardando:itens.filter(i=>i.aguardandoSubir).length};
  }
  /* aplica as revisões do estoque (confirmado/descartado) por cima dos achados automáticos */
  function aplicarRevisoes(findings,revisoes){
    return findings.map(f=>{
      const r=(revisoes||{})[f.id];if(!r)return {...f,revisao:null,status:'pendente'};
      const o={...f,revisao:r,status:r.status||'pendente'};
      if(r.tipo&&TIPOS[r.tipo])o.tipo=r.tipo;
      if(r.fisicoLote)o.loteFisico=normLote(r.fisicoLote);
      if(r.fisicoQtd!==''&&r.fisicoQtd!=null&&Number.isFinite(Number(r.fisicoQtd))){o.qtdFisica=Number(r.fisicoQtd);o.diferenca=Math.abs(o.qtdFisica-(f.qtdNota||0));}
      return o;});
  }
  function fichaManualParaFinding(id,r){
    return {id,manual:true,tipo:r.tipo,confianca:'forte',nota:r.nota||'',serie:r.serie||'',fornecedor:r.fornecedor||'',produto:normProd(r.produto),lote:normLote(r.lote),loteFisico:normLote(r.loteFisico),qtdNota:num(r.qtdNota),qtdFisica:r.qtdFisica===''||r.qtdFisica==null?null:num(r.qtdFisica),
      diferenca:Math.abs(num(r.qtdFisica)-num(r.qtdNota))||0,dtEntrada:r.dtEntrada||'',usuarioTDC:r.usuarioTDC||'',corrigidoPor:[r.por].filter(Boolean),movimentos:[],descricao:r.obs||'Lançado manualmente pelo estoque.',revisao:r,status:r.status||'confirmado'};
  }

  /* ============================ linhas do Excel da súmula ============================ */
  const fmtD=iso=>iso?iso.split('-').reverse().join('/'):'';
  const pct=x=>Math.round(x*1000)/10;
  function linhasSumula(res,achados,{somenteConfirmados=true,periodo=''}={}){
    const lista=achados.filter(a=>a.status!=='descartado'&&(!somenteConfirmados||a.status==='confirmado'||a.manual));
    const r=res.resumo,cob=res.cobertura;
    const resumo=[['SÚMULA — ENTRADAS DO TDC NO ARMAZÉM 59 (SD1 x SD3)'],[periodo||('Entradas de '+fmtD(cob.sd1De)+' a '+fmtD(cob.sd1Ate))],
      [somenteConfirmados?'Somente divergências CONFIRMADAS pelo estoque (e fichas lançadas à mão).':'Inclui divergências ainda pendentes de confirmação.'],[],
      ['Notas analisadas',r.notas],['Notas com divergência',r.notasErro],['% de notas com divergência',r.notas?pct(r.notasErro/r.notas)+'%':''],['Itens de nota',r.itens],['Itens com divergência',r.itensErro],
      ['Peças da nota',r.pecasNota],['Peças divergentes',r.pecasDivergentes],['Dias médios até subir (sem erro)',r.diasMediaLimpos==null?'':Math.round(r.diasMediaLimpos*10)/10],['Dias médios até subir (com erro)',r.diasMediaComErro==null?'':Math.round(r.diasMediaComErro*10)/10],[],
      ['Tipo de erro','Ocorrências (auto)','Peças','Confirmadas/lançadas'],...TIPOS_MANUAL.map(t=>[TIPOS[t].rotulo,r.porTipo[t].achados,r.porTipo[t].pecas,achados.filter(a=>a.tipo===t&&(a.status==='confirmado'||a.manual)).length])];
    const porUsuario=[['Usuário (quem lançou no TDC)','Notas','Notas com divergência','% notas com divergência','Itens','Itens com divergência','Peças divergentes'],...r.porUsuario.map(u=>[u.usuario,u.notas,u.notasErro,pct(u.pctNotas)+'%',u.itens,u.itensErro,u.pecasDiv])];
    const det=[['Status','Tipo','Confiança','Nota','Série','Fornecedor','Produto','Lote da nota','Lote físico','Qtd. na nota','Qtd. física','Diferença','Data da entrada','Quem lançou (TDC)','Quem corrigiu (estoque)','O que o Protheus mostra','Observação do estoque','Confirmado por','Em'],
      ...lista.map(a=>[a.status==='confirmado'?'Confirmado':a.manual?'Lançado à mão':'Pendente',TIPOS[a.tipo]?TIPOS[a.tipo].rotulo:a.tipo,a.confianca==='forte'?'Forte':'Suspeita',a.nota,a.serie,a.fornecedor,a.produto,a.lote,(a.revisao&&a.revisao.fisicoLote)||a.loteFisico||'',a.qtdNota,(a.revisao&&a.revisao.fisicoQtd!==undefined&&a.revisao.fisicoQtd!==''?a.revisao.fisicoQtd:a.qtdFisica)??'',a.diferenca,fmtD(a.dtEntrada),a.usuarioTDC,(a.corrigidoPor||[]).join(', '),a.descricao,(a.revisao&&a.revisao.obs)||'',(a.revisao&&a.revisao.por)||'',a.revisao&&a.revisao.em?String(a.revisao.em).slice(0,10).split('-').reverse().join('/'):''])];
    const tempo=[['Nota','Fornecedor','Produto','Lote','Qtd. na nota','Entrada','Usuário TDC','Dias até começar a subir','Dias até concluir','Teve divergência?','Aguardando subir (> limite)'],...res.itens.map(i=>[i.nota,i.fornecedor,i.produto,i.lote,i.qtNota,fmtD(i.dtEntrada),i.usuarioTDC,i.diasAteSubir??'',i.diasAteConcluir??'',i.erroForte?'Sim':'Não',i.aguardandoSubir?'Sim ('+i.diasSemSubir+' dias)':''])];
    return {resumo,porUsuario,detalhe:det,tempo};
  }

  const api={infoCFOP,GRUPOS,normNota,combinaNota,buscarNota,norm,normProd,normLote,normArm,paraISO,paraHora,diasEntre,detectarColunasSD1,lerSD1,compactarSD1,expandirSD1,expandirSD3,analisar,resumir,aplicarRevisoes,fichaManualParaFinding,linhasSumula,TIPOS,TIPOS_MANUAL,ROTULO_CAMPO,OBRIGATORIOS,idFinding};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.SC9EntradasTDC=api;
  if(root.document&&root.React&&typeof root.SC9EntradasTDCMount==='undefined'&&typeof require==='undefined'){/* a tela é carregada por entradas-tdc-ui.js */}
})(typeof window==='object'?window:globalThis);
