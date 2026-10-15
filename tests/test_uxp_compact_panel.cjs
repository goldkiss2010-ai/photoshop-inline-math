'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const base=path.join(__dirname,'../photoshop/uxp-panel');
const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
const css=fs.readFileSync(path.join(base,'styles.css'),'utf8');
const panel=fs.readFileSync(path.join(base,'panel.js'),'utf8');

function locate(id){
  const at=html.indexOf('id="'+id+'"');
  assert.notEqual(at,-1,'missing control '+id);
  assert.equal(html.indexOf('id="'+id+'"',at+1),-1,'duplicate id '+id);
  return at;
}
test('essential actions precede optional disclosures and diagnostics',()=>{
  const select=locate('font-project');
  const convert=locate('convert'),restore=locate('restore');
  const pending=locate('font-row'),verify=locate('font-verify');
  const message=locate('message'),summary=locate('summary');
  const usage=locate('usage-help');
  const diagnostic=locate('diagnostic-tools');
  const holds=locate('conversion-holds');
  assert.ok(select<convert);
  assert.ok(convert<restore && restore<pending && pending<verify);
  assert.ok(verify<message && message<usage && summary<usage);
  assert.ok(summary<holds && holds<locate('conversion-options'));
  assert.ok(locate('advanced-options')<diagnostic);
  assert.ok(locate('math-scan-details')>diagnostic);
  assert.ok(usage<diagnostic);
  assert.ok(locate('font-project-create')>locate('font-management-details'));
  assert.ok(locate('probe-restore-write')>locate('experimental-tools'));
});
test('the scrollable panel and expanded-error visibility remain available',()=>{
  assert.match(css,/main\s*\{[^}]*overflow-y:auto/);
  assert.match(css,/#message\s*\{[^}]*overflow-y:auto/);
  assert.match(css,/#font-status-detail\s*\{[^}]*overflow-y:auto/);
  assert.match(css,/#math-scan-list\s*\{[^}]*overflow-y:auto/);
  assert.match(html,/id="usage-help-body" class="hidden"/);
  assert.match(html,/id="diagnostic-tools-body" class="hidden"/);
  assert.match(html,/id="font-row" class="hidden"/);
  assert.match(html,/id="experimental-tools-body" class="hidden"/);
});
test('existing UXP actions still bind to original IDs',()=>{
  for(const id of ['check','convert','restore','font-manual','font-verify','font-cancel',
                   'font-project-refresh','font-project-create',
                   'scan','diagnose-style','export-pua-html']){
    locate(id);
    assert.ok(panel.includes("el('"+id+"')"),'missing action '+id);
  }
  assert.match(panel,/el\('font-row'\)\.classList\.remove\('hidden'\)/);
  assert.match(panel,/el\('summary'\)\.textContent/);
});
