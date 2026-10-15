'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const dir=path.join(__dirname,'../photoshop/uxp-panel');
const panel=fs.readFileSync(path.join(dir,'panel.js'),'utf8');
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
test('manifest v5 permits clipboard copy and user-selected JSON saving',()=>{
  assert.equal(manifest.manifestVersion,5);
  assert.equal(manifest.requiredPermissions.clipboard,'readAndWrite');
  assert.equal(manifest.requiredPermissions.localFileSystem,'request');
  assert.notEqual(manifest.requiredPermissions.localFileSystem,'fullAccess');
});
test('diagnostic exports use explicit click handlers and existing JSON report',()=>{
  for(const id of ['diagnose-style','copy-style-report','save-style-report'])
    assert.ok(html.includes('id="'+id+'"'),id+' is missing');
  assert.match(panel,/navigator\.clipboard/);
  assert.match(panel,/getFileForSaving\('inline-math-style-diagnostic\.json'/);
  assert.match(panel,/await file\.write\(diagnosticExport\)/);
  assert.match(panel,/if\(busy\|\|!diagnosticExport\)return;/);
  assert.match(panel,/displayDiagnostic\(null\); \/\/ A failed recheck/);
});
