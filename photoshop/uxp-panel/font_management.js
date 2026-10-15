/* Host-independent font summary and binary export validation. */
'use strict';
const {BACKEND_ID}=require('./backend_contract');
function fontSummary(health){
  if(!health||!health.font||typeof health.project_id!=='string'||
     !Number.isInteger(health.registered)||health.registered<0)
    throw Error('フォント管理情報が不正です。');
  return (health.display_name||health.font.family)+' / 登録 '+health.registered+'式';
}
async function readFontArchive(response,expected){
  if(!response||!response.ok){
    let detail='HTTP '+(response&&response.status);
    try{const payload=await response.json();detail=payload.error||detail;}catch(_){}
    throw Error('フォントの書き出しに失敗しました: '+detail);
  }
  const headers=response.headers;
  if(!headers||typeof headers.get!=='function'||
     headers.get('X-Paper-Math-Backend')!==BACKEND_ID||
     headers.get('X-Paper-Math-Project')!==expected.project_id||
     headers.get('X-Paper-Math-Font')!==expected.font.postscript_name||
     headers.get('X-Paper-Math-Revision')!==String(expected.registered)||
     headers.get('Content-Type')!=='application/zip')
    throw Error('書き出したフォントの選択または生成版が一致しません。一覧を更新してください。');
  if(typeof response.arrayBuffer!=='function')
    throw Error('このUXP環境ではZIPのバイナリ応答を読み込めません。');
  const data=await response.arrayBuffer();
  if(!(data instanceof ArrayBuffer))throw Error('ZIPの応答がバイナリではありません。');
  const bytes=new Uint8Array(data),length=headers.get('Content-Length');
  if(bytes.length<22||bytes[0]!==0x50||bytes[1]!==0x4b||bytes[2]!==3||bytes[3]!==4||
     !length||Number(length)!==bytes.length)
    throw Error('ZIPの内容が欠けている、または形式が不正です。');
  return {data,filename:'paper-math-'+expected.project_id+'-r'+expected.registered+'.zip'};
}
module.exports={fontSummary,readFontArchive};
