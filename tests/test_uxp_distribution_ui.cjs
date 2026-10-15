/* Drive the real panel actions; mock only the backend and Photoshop host. */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const base=path.join(__dirname,'../photoshop/uxp-panel');
const script=fs.readFileSync(path.join(base,'panel.js'),'utf8');
const html=fs.readFileSync(path.join(base,'index.html'),'utf8');
const {scanMathPlan}=require(path.join(base,'math_scan_plan'));
const {buildPartialParts}=require(path.join(base,'partial_math_plan'));
const pid='pm-aaaaaaaaaaaaaaaa',otherPid='pm-bbbbbbbbbbbbbbbb';
class Element{
  constructor(classes=''){this.className=classes;this.textContent='';this.value='';this.checked=false;
    this.disabled=false;this.nodes=[];this.listeners={};
    this.classList={
      contains:name=>this.className.split(/\s+/).includes(name),
      add:name=>{if(!this.classList.contains(name))this.className=(this.className+' '+name).trim();},
      remove:name=>{this.className=this.className.split(/\s+/).filter(x=>x!==name).join(' ');},
      toggle:(name,force)=>{const show=force===undefined?!this.classList.contains(name):force;
        this.classList[show?'add':'remove'](name);return show;}
    };}
  get firstChild(){return this.nodes[0]||null;}
  get nextSibling(){if(!this.parent)return null;return this.parent.nodes[this.parent.nodes.indexOf(this)+1]||null;}
  appendChild(child){child.parent=this;this.nodes.push(child);}
  removeChild(child){this.nodes.splice(this.nodes.indexOf(child),1);child.parent=null;}
  addEventListener(name,listener){this.listeners[name]=listener;}
  setAttribute(name,value){this[name]=value;}
}
function descriptor(text,paragraphBreaks=[]){
  const bounds=[0,...paragraphBreaks,text.length+1];
  return {_obj:'textLayer',textKey:text,
    textStyleRange:[{_obj:'textStyleRange',from:0,to:text.length+1,textStyle:{
      _obj:'textStyle',fontPostScriptName:'Body',fontName:'Body',fontStyleName:'Regular',
      size:{_unit:'pointsUnit',_value:18}}}],
    paragraphStyleRange:bounds.slice(1).map((to,i)=>({_obj:'paragraphStyleRange',from:bounds[i],to,
      paragraphStyle:{_obj:'paragraphStyle',align:'left'}}))};
}
async function setup(text,{fontState='missing',failedLatex=['\\bad'],paragraphBreaks=[]}={}){
  const elements=new Map();
  for(const tag of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)){
    const classes=(/\bclass="([^"]+)"/.exec(tag[0])||[])[1]||'';
    elements.set(tag[1],new Element(classes));
  }
  for(const button of html.matchAll(/<button id="([^"]+)"[^>]*>([^<]*)<\/button>/g))
    elements.get(button[1]).textContent=button[2];
  const el=id=>{assert.ok(elements.has(id),'Unknown UI element '+id);return elements.get(id);};
  el('font-project').value='legacy';
  const font={family:'Paper Math aaaa',postscript_name:'PaperMathaaaa-Regular'};
  const health={ok:true,backend:'python-latex-fonttools-v1',project_id:pid,
    display_name:'Test font',registered:1,font_exists:true,font};
  const entries=[{latex:'x',char:'\uE000',codepoint:'E000'}],requests=[],writes=[],commits=[];
  let current=descriptor(text,paragraphBreaks),undo=null;
  const layer={id:23,name:'Body',textItem:{characterStyle:{size:18}}};
  const doc={id:12,activeLayers:[layer]};
  const app={documents:[doc],activeDocument:doc,fonts:{getByName:()=>({postScriptName:health.font.postscript_name})}};
  const action={batchPlay:async commands=>commands.map(command=>{
    if(command._obj==='get')return {textKey:structuredClone(current)};
    assert.equal(command._obj,'set');
    writes.push(structuredClone(command.to));current=structuredClone(command.to);return {};
  })};
  const core={executeAsModal:async fn=>fn({hostControl:{
    suspendHistory:async()=>{undo=structuredClone(current);return 1;},
    resumeHistory:async(token,commit)=>{assert.equal(token,1);commits.push(commit);if(!commit)current=undo;}
  }})};
  const json=result=>({ok:true,json:async()=>structuredClone(result)});
  const request=async(url,options={})=>{
    const endpoint=url.replace('http://127.0.0.1:8765','');
    requests.push({endpoint,options});
    if(endpoint==='/api/health')return json(health);
    if(endpoint==='/api/projects')return json({ok:true,backend:health.backend,active:health.project_id,
      projects:[{project_id:pid,name:'Test font',registered:entries.length,font},
        {project_id:otherPid,name:'Other',registered:0,font:{family:'Other',postscript_name:'Other-Regular'}}]});
    if(endpoint==='/api/projects/select'){
      health.project_id=JSON.parse(options.body).project_id;health.display_name='Other';
      health.font={family:'Other',postscript_name:'Other-Regular'};health.registered=0;
      return json({ok:true,backend:health.backend});
    }
    if(endpoint==='/api/font/status')return json({ok:true,project_id:health.project_id,state:fontState,reason:'Test status'});
    if(endpoint==='/api/restore/map')return json({ok:true,backend:health.backend,project_id:health.project_id,
      font:health.font,entries,revision:entries.length});
    if(endpoint==='/api/prepare'){
      const payload=JSON.parse(options.body);assert.equal(payload.partial,true);
      const scan=scanMathPlan(payload.text);let added=0;
      for(const match of scan.matches){
        if(failedLatex.includes(match.latex)||entries.some(x=>x.latex===match.latex))continue;
        const n=0xE000+entries.length;
        entries.push({latex:match.latex,char:String.fromCharCode(n),codepoint:n.toString(16).toUpperCase()});added++;
      }
      health.registered=entries.length;
      const plan=buildPartialParts(payload.text,scan,entries);
      return json({ok:true,backend:health.backend,project_id:health.project_id,font:health.font,
        entries,new_count:added,converted:plan.text,formula_instances:plan.mathCount,candidate_instances:scan.matches.length,
        accepted_matches:scan.matches.filter(m=>entries.some(e=>e.latex===m.latex)),
        issues:scan.matches.filter(m=>failedLatex.includes(m.latex)).map(m=>({...m,code:'render-failed',
          message:'テスト用TeX生成エラー: '+m.latex}))});
    }
    throw Error('Unexpected request '+endpoint);
  };
  vm.runInContext(script,vm.createContext({fetch:request,
    document:{getElementById:el,createElement:()=>new Element()},
    require:id=>id==='uxp'?{entrypoints:{setup(){}}}:id==='photoshop'?{app,action,core}:require(path.join(base,id)),
    console,ArrayBuffer,Uint8Array}));
  await new Promise(setImmediate);
  return {el,health,requests,writes,commits,entries,
    get current(){return structuredClone(current);},
    setSource:value=>{current=descriptor(value);},
    click:async id=>{assert.equal(el(id).disabled,false,id+' must be available');await el(id).listeners.click();},
    visible:id=>!el(id).classList.contains('hidden')};
}
for(const [name,eol] of [['LF','\n'],['CRLF','\r\n'],['CR','\r']]){
  test(name+': pending partial conversion shows the original line, reason and raw math outside diagnostics',async()=>{
    const text=['前 $x$','`code $ignored$`','後 $\\bad$'].join(eol);
    const env=await setup(text);await env.click('convert');
    assert.equal(env.writes.length,0);assert.equal(env.current.textKey,text);
    assert.equal(env.visible('conversion-holds'),true,env.el('message').textContent);
    assert.match(env.el('hold-count').textContent,/数式保留 1箇所/);
    assert.match(env.el('hold-list').textContent,/3行目 \/ 文字位置/);
    assert.ok(env.el('hold-list').textContent.includes('文字位置 '+(text.indexOf('$\\bad$')+1)));
    assert.match(env.el('hold-list').textContent,/テスト用TeX生成エラー/);
    assert.ok(env.el('hold-list').textContent.includes('$\\bad$'));
    assert.ok(!env.el('hold-list').textContent.includes('ignored'));
    assert.equal(env.visible('diagnostic-tools-body'),false);
    assert.equal(env.visible('font-row'),true);
    assert.equal(env.el('font-project').disabled,true);
  });
}
test('partial apply keeps the held source, and a clean retry clears stale holds',async()=>{
  const text='前 $x$\n`$ignored$`\n後 $\\bad$';
  const env=await setup(text,{fontState:'current'});await env.click('convert');
  assert.equal(env.current.textKey,'前 \uE000\n`$ignored$`\n後 $\\bad$',env.el('message').textContent);
  assert.deepEqual(env.commits,[true]);assert.equal(env.visible('conversion-holds'),true);
  assert.match(env.el('summary').textContent,/1箇所の数式を変換/);
  assert.equal(env.visible('font-row'),false);
  env.setSource('新 $x$');await env.click('convert');
  assert.equal(env.current.textKey,'新 \uE000');
  assert.equal(env.visible('conversion-holds'),false);assert.equal(env.el('hold-list').textContent,'');
  assert.ok(!env.el('math-scan-list').textContent.includes('bad'));
  assert.deepEqual(env.commits,[true,true]);
});
test('all formulas held never write Photoshop or create a pending apply',async()=>{
  const env=await setup('式 $\\bad$');await env.click('convert');
  assert.equal(env.writes.length,0);assert.equal(env.visible('conversion-holds'),true);
  assert.match(env.el('summary').textContent,/変換 0箇所/);
  assert.equal(env.visible('font-row'),false);assert.equal(env.el('font-cancel').disabled,true);
  assert.equal(env.el('restore').disabled,false);
});
test('a formula across paragraph ranges exposes its reason while an independent formula is applied',async()=>{
  const text='前 $x$\r\n後 $a\r\n+b$';
  const boundary=text.indexOf('+b$');
  const env=await setup(text,{fontState:'current',paragraphBreaks:[boundary]});await env.click('convert');
  assert.equal(env.current.textKey,'前 \uE000\r\n後 $a\r\n+b$',env.el('message').textContent);
  assert.deepEqual(env.commits,[true]);assert.match(env.el('hold-count').textContent,/数式保留 1箇所/);
  assert.match(env.el('hold-list').textContent,/2行目/);
  assert.match(env.el('hold-list').textContent,/段落をまたぐインライン数式/);
});
test('no valid math still exposes unclosed delimiters and code reasons without preparation',async()=>{
  const env=await setup('前 $broken\n\n```python\nprint("$ignored$")');await env.click('convert');
  assert.equal(env.writes.length,0);assert.equal(env.visible('conversion-holds'),true);
  assert.match(env.el('hold-list').textContent,/閉じ記号がありません/);
  assert.match(env.el('hold-list').textContent,/コードブロックが未閉鎖/);
  assert.ok(env.requests.every(x=>x.endpoint!=='/api/prepare'));
  assert.match(env.el('message').textContent,/変換対象の数式がありません/);
});
test('cancel only releases the pending UI, keeping generated entries and the original layer',async()=>{
  const env=await setup('式 $z$');await env.click('convert');
  assert.equal(env.entries.length,2);const requests=env.requests.length;
  assert.equal(env.el('restore').disabled,true);
  await env.click('font-cancel');
  assert.equal(env.current.textKey,'式 $z$');assert.equal(env.writes.length,0);
  assert.equal(env.entries.length,2);assert.equal(env.requests.length,requests);
  assert.equal(env.visible('font-row'),false);assert.equal(env.el('summary').textContent,'');
  assert.equal(env.el('font-project').disabled,false);assert.equal(env.el('restore').disabled,false);
  assert.equal(env.el('font-cancel').disabled,true);
  assert.match(env.el('message').textContent,/生成済みのフォントと対応表は保持/);
});
test('restoration clears previous conversion holds while preserving code and unconverted LaTeX',async()=>{
  const text='前 $x$\n`$ignored$`\n後 $\\bad$';
  const env=await setup(text,{fontState:'current'});await env.click('convert');await env.click('restore');
  assert.equal(env.current.textKey,text);assert.deepEqual(env.commits,[true,true]);
  assert.equal(env.visible('conversion-holds'),false);assert.equal(env.el('hold-list').textContent,'');
  assert.match(env.el('summary').textContent,/1箇所の数式をLaTeXへ戻しました/);
});
test('a changed pending target reports the stopped stage and can release the wait without writing it',async()=>{
  const env=await setup('式 $z$');await env.click('convert');env.setSource('変更した本文');
  await env.click('font-verify');assert.equal(env.writes.length,0);
  assert.match(env.el('font-status-detail').textContent,/対象レイヤーの再取得/);
  assert.match(env.el('font-status-detail').textContent,/本文が変更/);
  assert.equal(env.visible('font-row'),true);await env.click('font-cancel');
  assert.equal(env.current.textKey,'変更した本文');assert.equal(env.el('font-status-detail').textContent,'');
  assert.equal(env.el('font-project').disabled,false);assert.equal(env.writes.length,0);
});
test('a readable diagnostic opens its report section without a Photoshop write',async()=>{
  const env=await setup('本文');await env.click('diagnose-style');
  assert.equal(env.visible('diagnostic-tools-body'),true);assert.equal(env.visible('experimental-tools-body'),false);
  assert.equal(env.el('diagnostic-tools-toggle')['aria-expanded'],'true');
  assert.equal(JSON.parse(env.el('style-report').textContent).puaCount,0);
  assert.equal(env.visible('style-report-actions'),true);assert.equal(env.writes.length,0);
});
test('fatal scan reasons are visible before any prepare or Photoshop edit',async()=>{
  const env=await setup('😀 $x$');await env.click('convert');
  assert.equal(env.visible('conversion-holds'),true);assert.match(env.el('hold-list').textContent,/BMP外文字/);
  assert.equal(env.el('summary').textContent,'');assert.equal(env.writes.length,0);
  assert.ok(env.requests.every(x=>x.endpoint!=='/api/prepare'));
});
test('optional sections open and close without altering a pending conversion or its selection locks',async()=>{
  const env=await setup('式 $z$');await env.click('convert');const requests=env.requests.length;
  for(const id of ['conversion-options','font-management-details','usage-help',
                   'diagnostic-tools','math-scan-details','experimental-tools']){
    if(['math-scan-details','experimental-tools'].includes(id))
      await env.click('diagnostic-tools-toggle');
    assert.equal(env.visible(id+'-body'),false);await env.click(id+'-toggle');
    assert.equal(env.visible(id+'-body'),true);
    assert.equal(env.el(id+'-toggle')['aria-expanded'],'true');
    await env.click(id+'-toggle');assert.equal(env.visible(id+'-body'),false);
    assert.equal(env.el(id+'-toggle')['aria-expanded'],'false');
    if(['math-scan-details','experimental-tools'].includes(id))
      await env.click('diagnostic-tools-toggle');
  }
  assert.equal(env.visible('font-row'),true);assert.equal(env.el('font-project').disabled,true);
  assert.equal(env.el('restore').disabled,true);assert.equal(env.requests.length,requests);
  assert.equal(env.writes.length,0);
});
test('switching the font clears results that belong to the previous selection',async()=>{
  const env=await setup('$\\bad$');await env.click('convert');
  env.el('font-project').value=otherPid;await env.el('font-project').listeners.change();
  assert.equal(env.visible('conversion-holds'),false);assert.equal(env.el('hold-list').textContent,'');
  assert.equal(env.el('summary').textContent,'');assert.equal(env.el('math-scan-list').textContent,'');
  assert.equal(env.writes.length,0);
});
