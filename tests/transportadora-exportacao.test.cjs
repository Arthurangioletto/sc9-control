const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');
const bundle=fs.readFileSync(path.join(__dirname,'..','bundle.js'),'utf8');
function trecho(inicio,fim){const i=bundle.indexOf(inicio);assert(i>=0,'não achei '+inicio);const j=bundle.indexOf(fim,i);assert(j>i,'não achei '+fim);return bundle.slice(i,j);}
test('o bundle resolve a transportadora do pedido e a coloca na exportação de pedidos',()=>{
  assert(bundle.includes('transpNome:p.sc5PorPedido&&an(p.sc5PorPedido.get(sc9Ped.pedido))'));
  assert(bundle.includes('Cliente:$l(r.nome,"N/D"),Transportadora:$l(r.transpNome,"Não informada"),Separador'));
});
test('exportação de pedidos traz o nome da transportadora (Brasil, São Paulo, Retira…)',()=>{
  const codigo=['var Ws=','function Xs('], kcSrc=['function kc(','function yt('], lSrc=['function $l(','function kc('];
  const src=trecho(...codigo).replace(/function Xs\($/,'')+trecho(...lSrc)+trecho(...kcSrc);
  const ctx={uo:d=>d?'01/10/2026':'',Or:{}};
  vm.runInNewContext(src+';this.kc=kc;this.an=an;this.Ws=Ws;this.$l=$l;',ctx);
  // mesma regra aplicada ao carregar os pedidos
  const sc5=new Map([['100','10023'],['101','2'],['102','4'],['103','99999']]);
  const nome=(ped,raw)=>sc5.get(ped)&&ctx.an(sc5.get(ped))||(t=>t===null?null:ctx.Ws[String(t).replace(/\.0$/,'').trim()]||String(t).trim())(ctx.$l(raw,null));
  const pedidos=[['100',null],['101',null],['102',null],['103',null],['104',null],['105','Brasil']].map(([pedido,raw])=>({pedido,armazem:'Cambuci',nome:'Cliente X',itens:1,qt:5,status:'Atrasado',dt:new Date(),transpNome:nome(pedido,raw)}));
  const linhas=ctx.kc(pedidos);
  assert.deepEqual(linhas.map(l=>l.Transportadora),['São Paulo','Brasil','Retira 01','Código 99999','Não informada','Brasil']);
  assert.deepEqual(Object.keys(linhas[0]).slice(0,5),['Pedido','Armazém','Cliente','Transportadora','Separador']);
});
