'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const panel=fs.readFileSync(path.join(__dirname,'../photoshop/uxp-panel/panel.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../photoshop/uxp-panel/index.html'),'utf8');

test('same-layer conversion is standard; duplicate mode is opt-in',()=>{
  assert.match(html,/<input id="duplicate-mode" type="checkbox">/);
  assert.doesNotMatch(html,/id="duplicate-mode"[^>]*checked/);
  assert.match(html,/標準では同じレイヤー/);
  assert.match(panel,/const inPlace=!el\('duplicate-mode'\)\.checked/);
});
test('forward conversion retains both transactional and duplicate paths',()=>{
  const fn=panel.slice(panel.indexOf('async function applyPrepared()'),panel.indexOf('async function convert()'));
  assert.match(fn,/const inPlace=!prepared\.duplicate/);
  assert.match(fn,/if\(inPlace\)/);
  assert.match(fn,/applyInPlace\(/);
  assert.match(fn,/historyName:'Paper Math: convert in place'/);
  assert.match(fn,/duplicate=await snap\.layer\.duplicate\(\)/);
  assert.match(fn,/verifyAppliedMathFonts/);
});
test('restoration retains both transactional and duplicate paths',()=>{
  const fn=panel.slice(panel.indexOf('async function restore()'),panel.indexOf('async function openManual()'));
  assert.match(fn,/const inPlace=!el\('duplicate-mode'\)\.checked/);
  assert.match(fn,/if\(inPlace\)/);
  assert.match(fn,/historyName:'Paper Math: restore in place'/);
  assert.match(fn,/verifyRestoredLayer/);
  assert.match(fn,/duplicate=await snap\.layer\.duplicate\(\)/);
});
test('font-update pending conversion pins duplicate choice',()=>{
  assert.match(panel,/duplicate:!!el\('duplicate-mode'\)\.checked/);
  assert.match(panel,/el\('duplicate-mode'\)\.disabled=busy\|\|!!prepared/);
});
test('PUA preview export is wired and appears in panel',()=>{
  assert.match(html,/id="export-pua-html"/);
  assert.match(panel,/el\('export-pua-html'\)\.addEventListener/);
  assert.match(panel,/\/api\/font\/preview-html/);
  assert.match(panel,/getFileForSaving\('paper-math-pua-preview\.html'/);
  assert.match(panel,/shell\.openPath/);
});
