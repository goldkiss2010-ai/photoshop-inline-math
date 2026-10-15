'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fontSummary,readFontArchive}=require('../photoshop/uxp-panel/font_management');
const expected={project_id:'pm-aaaaaaaaaaaaaaaa',font:{family:'Internal',postscript_name:'Math-Regular'},
  display_name:'数式 図版',registered:2};
function response(changes={},data=new Uint8Array([80,75,3,4,...new Array(18).fill(0)]).buffer){
  const values={'X-Paper-Math-Backend':'python-latex-fonttools-v1',
    'X-Paper-Math-Project':expected.project_id,'X-Paper-Math-Font':'Math-Regular',
    'X-Paper-Math-Revision':'2','Content-Type':'application/zip','Content-Length':String(data.byteLength),...changes};
  return {ok:true,headers:{get:key=>values[key]||null},arrayBuffer:async()=>data};
}
test('summary uses display name and actual registered count',()=>{
  assert.equal(fontSummary(expected),'数式 図版 / 登録 2式');
  assert.equal(fontSummary({...expected,display_name:undefined}),'Internal / 登録 2式');
  assert.throws(()=>fontSummary({...expected,registered:NaN}),/不正/);
});
test('ZIP transport preserves binary bytes and stable suggested name',async()=>{
  const source=response();const result=await readFontArchive(source,expected);
  assert.deepEqual(new Uint8Array(result.data),new Uint8Array(await source.arrayBuffer()));
  assert.equal(result.filename,'paper-math-pm-aaaaaaaaaaaaaaaa-r2.zip');
});
test('changed project font revision or server is rejected before reading binary',async()=>{
  for(const [key,value] of [['X-Paper-Math-Project','legacy'],['X-Paper-Math-Font','Other'],
    ['X-Paper-Math-Revision','3'],['X-Paper-Math-Backend','other-server'],['Content-Type','text/html']]){
    const r=response({[key]:value});r.arrayBuffer=async()=>{throw Error('must not read');};
    await assert.rejects(readFontArchive(r,expected),/一致/);
  }
});
test('truncated length and non-ZIP bytes are rejected',async()=>{
  await assert.rejects(readFontArchive(response({'Content-Length':'100'}),expected),/欠けて/);
  await assert.rejects(readFontArchive(response({},new ArrayBuffer(22)),expected),/形式/);
});
test('server reason and unavailable binary API are explained',async()=>{
  await assert.rejects(readFontArchive({ok:false,status:409,json:async()=>({error:'stale font'})},expected),/stale font/);
  const r=response();delete r.arrayBuffer;
  await assert.rejects(readFontArchive(r,expected),/バイナリ応答/);
});
