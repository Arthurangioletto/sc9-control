const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {porSeparador,hojeSP,diaDe}=require('../separador-dia.js');
const it=(armazem,pedido,qt,separador,pickEnd)=>({armazem,pedido,qt,separador,pickEnd});
const itens=[
  it('CB','1',10,'Ana','2026-11-25T13:00:00Z'),   // 10:00 em Brasília
  it('CB','1',5,'Ana','2026-11-25T14:30:00Z'),
  it('CB','2',7,'Ana',new Date('2026-11-25T18:00:00Z')),
  it('CB','3',4,'Bia','2026-11-25T12:00:00Z'),
  it('BH','4',20,'Ana','2026-11-25T15:00:00Z'),
  it('CB','5',9,'Ana','2026-11-24T20:00:00Z'),   // outro dia (pedido liberado hoje, pick ontem)
  it('CB','6',3,'0','2026-11-25T16:00:00Z'),
  it('CB','7',2,'Ana',null),                       // sem pick terminado
  it('CB','8',6,'Ana','2026-11-26T02:30:00Z')     // 23:30 de 25/11 em Brasília
];
test('conta pelo dia em que o pick terminou, no horário de Brasília, e soma peças por separador',()=>{
  const r=porSeparador(itens,'2026-11-25','__ALL__');
  const ana=r.linhas.find(l=>l.nome==='Ana'),bia=r.linhas.find(l=>l.nome==='Bia');
  assert.equal(ana.pecas,10+5+7+20+6); assert.equal(ana.pedidos,4); assert.equal(ana.linhas,5);
  assert.equal(bia.pecas,4);
  assert.deepEqual(r.semNome,{pecas:3,linhas:1});
  assert.deepEqual(r.total,{pecas:55,linhas:7,pedidos:6});
  assert.equal(r.linhas[0].nome,'Ana','ordenado por peças');
});
test('filtra por armazém e não mistura dias',()=>{
  const cb=porSeparador(itens,'2026-11-25','CB');
  assert.equal(cb.linhas.find(l=>l.nome==='Ana').pecas,28);
  assert.equal(porSeparador(itens,'2026-11-24','').total.pecas,9);
  assert.equal(porSeparador(itens,'2026-11-20','').total.linhas,0);
  assert.equal(diaDe(new Date('2026-11-26T02:30:00Z')),'2026-11-25'); assert.equal(hojeSP(new Date('2026-11-26T02:30:00Z')),'2026-11-25');
});
test('não altera as linhas e está ligado ao bundle, ao index e ao servidor',()=>{
  const c=JSON.stringify(itens); porSeparador(itens,'2026-11-25','CB'); assert.equal(JSON.stringify(itens),c);
  const lê=(f)=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
  assert.match(lê('bundle.js'),/window\.SC9SeparadorDia\.Panel,\{items:p\.items,warehouse:f/);
  assert.match(lê('index.html'),/\/separador-dia\.js/); assert.match(lê('server.js'),/"separador-dia\.js"/);
});
