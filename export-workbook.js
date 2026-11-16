/* Shared Excel boundary: keep report data intact and normalize Excel/file names. */
(function(root){
  function sheetName(value,used,index){
    const base=String(value??'').replace(/[\x00-\x1f\x7f\[\]:*?\/\\]/g,' ').replace(/\s+/g,' ').trim().replace(/^'+|'+$/g,'').trim()||'Planilha '+index;
    let suffix='',name,attempt=1;
    do{name=base.slice(0,31-suffix.length).replace(/[\uD800-\uDBFF]$/,'').trim().replace(/^'+|'+$/g,'')+suffix;suffix=' ('+(++attempt)+')';}while(used.has(name.toLocaleLowerCase('pt-BR')));
    used.add(name.toLocaleLowerCase('pt-BR'));return name;
  }
  function fileName(value){
    let name=String(value??'').replace(/[\x00-\x1f\x7f<>:"\/\\|?*]/g,'_').trim().replace(/[. ]+$/g,'');
    if(!name)name='SC9_Exportacao';if(!/\.xlsx$/i.test(name))name+='.xlsx';return name;
  }
  function library(X){X=X||root.XLSX;if(!X?.utils?.book_new||typeof X.writeFile!=='function')throw Error('A biblioteca do Excel não carregou. Atualize a página e tente novamente.');return X;}
  function notify(error){if(!error.sc9ExportNotified&&typeof root.alert==='function'){root.alert('Não foi possível exportar o Excel. '+error.message);error.sc9ExportNotified=true;}throw error;}
  function buildWorkbook(sheets,X){
    X=library(X);if(!Array.isArray(sheets)||!sheets.length)throw Error('Não há abas para exportar.');
    const workbook=X.utils.book_new(),used=new Set();
    sheets.forEach((sheet,i)=>{if(!sheet||!Array.isArray(sheet.rows))throw Error('Os dados da aba '+(i+1)+' não estão disponíveis.');const ws=X.utils.json_to_sheet(sheet.rows);X.utils.book_append_sheet(workbook,ws,sheetName(sheet.name,used,i+1));});return workbook;
  }
  function downloadWorkbook(workbook,name,X){try{X=library(X);if(!workbook?.SheetNames?.length)throw Error('Não há abas para exportar.');return X.writeFile(workbook,fileName(name));}catch(error){return notify(error);}}
  function exportWorkbook(sheets,name,X){try{return downloadWorkbook(buildWorkbook(sheets,X),name,X);}catch(error){return notify(error);}}
  function buildTransferWorkbook(lines,X){
    X=library(X);
    const fields=['produto','origem','lote','produtoDestino','armDestino','loteDestino','qtde'];
    const headers=['PRODUTO','Origem','LOTE','Produto Destino','Arm Destino','Lote destino','Qtde','Importador'];
    const data=lines.map(line=>fields.map(field=>line[field]));
    const sheet=X.utils.aoa_to_sheet([headers,...data.map(row=>[...row,row.join(';')])]);
    data.forEach((row,index)=>{
      const i=index+2;
      sheet['H'+i]={t:'s',v:row.join(';'),f:['A','B','C','D','E','F','G'].map(col=>col+i).join('&";"&')};
    });
    sheet['!cols']=[16,9,16,16,12,16,9,48].map(wch=>({wch}));
    const book=X.utils.book_new();
    X.utils.book_append_sheet(book,sheet,'Transferência múltipla');
    return book;
  }
  const api={sheetName,fileName,buildWorkbook,buildTransferWorkbook,downloadWorkbook,exportWorkbook};root.SC9Exports=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='object'?window:globalThis);
