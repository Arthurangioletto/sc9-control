const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const project = path.resolve(__dirname,'../../..');
const bundle = fs.readFileSync(path.join(project,'bundle.js'),'utf8');
function between(start, end) {
  const i = bundle.indexOf(start), j = bundle.indexOf(end,i+start.length);
  if (i<0 || j<0) throw Error('Não encontrei a função SC9 solicitada.');
  return bundle.slice(i,j);
}
function realClassification() {
  return vm.runInNewContext(between('function Wc(','function Tr(')+';as',
    {ze:date=>date.toISOString().slice(0,10)});
}
function realFilter(orders,{warehouse='__ALL__',status='',day='',itemKeys=null}={}) {
  const filter = vm.runInNewContext(between('function Tr(','function Xc(')+';Tr');
  return orders.filter(order=>(warehouse==='__ALL__'||order.armazem===warehouse) &&
    filter(order,{status,day,item:itemKeys?'produto':'',itemKeys},null));
}
function tableSource() {
  const start = bundle.indexOf('function Ol(');
  const end = bundle.indexOf('function ',start+12);
  return bundle.slice(start,end);
}
module.exports={project,bundle,between,realClassification,realFilter,tableSource};
