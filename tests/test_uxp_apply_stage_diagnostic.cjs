'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const panel=fs.readFileSync(path.join(__dirname,'../photoshop/uxp-panel/panel.js'),'utf8');
const from=panel.indexOf('async function applyPrepared(){');
const to=panel.indexOf('async function convert(){',from);
const apply=panel.slice(from,to);

test('all conversion write paths have a named failure phase',()=>{
  assert.match(apply,/stage='長文と書式範囲の投影'/);
  assert.match(apply,/stage=inPlace\?'同一レイヤーへの書き込み・読み戻し検証'/);
  assert.match(apply,/:'複製レイヤーへの書き込み・読み戻し検証'/);
  assert.match(apply,/await applyInPlace\(/);
  assert.match(apply,/await core\.executeAsModal\(/);
});

test('the panel only claims a completed write after modal verification',()=>{
  const verification=apply.indexOf('verifyAppliedMathFonts(');
  const completion=apply.indexOf("el('summary').textContent=n+");
  assert.ok(verification>=0);
  assert.ok(completion>verification);
  assert.match(apply,/throw Error\('PUAに置換できませんでした。停止段階: '\+stage/);
});

test('a conversion in progress and any failure remain visible at panel top',()=>{
  assert.match(apply,/tell\('PUAへの置換中：'/);
  assert.match(panel,/if\(prepared\)el\('font-row'\)\.classList\.remove\('hidden'\)/);
  assert.match(panel,/catch\(e\)\{tell\(e\.message,true\);\}/);
});
