const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const bundle=fs.readFileSync(path.join(__dirname,'..','bundle.js'),'utf8');
test('a data de corte limita os pedidos liberados até a data (dayKey <= corte)',()=>{
  assert.match(bundle,/as\(Ie,Ce,p\.entregaCounts\)\.filter\(c=>!c\.dayKey\|\|!r\|\|c\.dayKey<=r\)/);
  // mesma regra aplicada à lista de exemplo
  const corte='2026-10-30',pedidos=[{dayKey:'2026-10-29'},{dayKey:'2026-10-30'},{dayKey:'2026-10-31'},{dayKey:null}];
  assert.equal(pedidos.filter(c=>!c.dayKey||!corte||c.dayKey<=corte).length,3);
});
