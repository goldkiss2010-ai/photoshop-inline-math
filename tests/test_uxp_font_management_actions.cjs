/* Exercise the actual panel handlers with an isolated DOM/storage backend. */
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const base=path.join(__dirname,'../photoshop/uxp-panel');
const source=fs.readFileSync(path.join(base,'panel.js'),'utf8');
const pid='pm-aaaaaaaaaaaaaaaa';
class Element{
  constructor(){this.value='';this.checked=false;this.disabled=false;this.nodes=[];this.listeners={};
    this.classList={add(){},remove(){},toggle(){}};}
  get firstChild(){return this.nodes[0]||null;}
  get nextSibling(){if(!this.parent)return null;return this.parent.nodes[this.parent.nodes.indexOf(this)+1]||null;}
  appendChild(child){child.parent=this;this.nodes.push(child);}
  removeChild(child){this.nodes.splice(this.nodes.indexOf(child),1);child.parent=null;}
  addEventListener(name,listener){this.listeners[name]=listener;}
  setAttribute(name,value){this[name]=value;}
}
async function setup({cancel=false,switchDuringDialog=false}={}){
  const elements=new Map();
  function el(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);}
  el('font-project').value='legacy';
  const health={ok:true,backend:'python-latex-fonttools-v1',project_id:pid,
    display_name:'First',registered:1,font_exists:true,font:{family:'Paper Math aaaa',postscript_name:'PaperMathaaaa-Regular'}};
  const writes=[],requests=[];let dialogs=0,photoshopWrites=0;
  const data=new Uint8Array([80,75,3,4,...new Array(18).fill(0)]).buffer;
  const binary=Symbol('binary');
  const storage={formats:{binary},localFileSystem:{getFileForSaving:async(name,options)=>{
    dialogs++;
    assert.deepEqual(Array.from(options.types),['zip']);
    if(cancel)return null;
    if(switchDuringDialog)health.project_id='pm-bbbbbbbbbbbbbbbb';
    return {name,write:async(value,config)=>{writes.push({value,config});return value.byteLength;}};
  }}};
  const request=async(url,options={})=>{
    const endpoint=url.replace('http://127.0.0.1:8765','');requests.push({endpoint,options});
    const json=value=>({ok:true,json:async()=>structuredClone(value)});
    if(endpoint==='/api/health')return json(health);
    if(endpoint==='/api/projects')return json({ok:true,backend:health.backend,active:health.project_id,
      projects:[{project_id:health.project_id,name:health.display_name,registered:health.registered}]});
    if(endpoint==='/api/projects/rename'){
      const payload=JSON.parse(options.body);assert.equal(payload.project_id,pid);
      health.display_name=payload.name;
      return json({ok:true,backend:health.backend,project:{project_id:pid,name:payload.name}});
    }
    if(endpoint==='/api/font/export-zip'){
      const h={'X-Paper-Math-Backend':health.backend,'X-Paper-Math-Project':health.project_id,
        'X-Paper-Math-Font':health.font.postscript_name,'X-Paper-Math-Revision':'1',
        'Content-Type':'application/zip','Content-Length':String(data.byteLength)};
      return {ok:true,headers:{get:key=>h[key]},arrayBuffer:async()=>data};
    }
    throw Error('unexpected request '+endpoint);
  };
  const context=vm.createContext({fetch:request,document:{getElementById:el,createElement:()=>new Element()},
    require:id=>id==='uxp'?{entrypoints:{setup(){}},storage}:id==='photoshop'?
      {app:{fonts:{getByName:()=>({postScriptName:health.font.postscript_name})}},
        action:{batchPlay(){photoshopWrites++;throw Error('must not edit Photoshop');}},core:{}}:
      require(path.join(base,id)),ArrayBuffer,Uint8Array});
  vm.runInContext(source,context);
  await new Promise(setImmediate); // Complete the startup reads.
  return {el,health,writes,requests,data,binary,get dialogs(){return dialogs;},get photoshopWrites(){return photoshopWrites;}};
}
test('rename handler updates the visible label and leaves font identity untouched',async()=>{
  const env=await setup();const identity=structuredClone(env.health.font);
  env.el('font-project-rename-name').value='数式 新名';
  await env.el('font-project-rename').listeners.click();
  assert.equal(env.health.display_name,'数式 新名');
  assert.deepEqual(env.health.font,identity);
  assert.match(env.el('font-project-info').textContent,/数式 新名.*1式/);
  assert.equal(env.el('font-project').value,pid);
  assert.equal(env.photoshopWrites,0);
  assert.ok(env.requests.every(x=>!x.endpoint.includes('/prepare')));
});
test('export handler writes the exact ArrayBuffer with binary format',async()=>{
  const env=await setup();await env.el('font-project-export').listeners.click();
  assert.equal(env.dialogs,1);assert.equal(env.writes.length,1);
  assert.equal(env.writes[0].value,env.data);
  assert.equal(env.writes[0].config.format,env.binary);
  assert.match(env.el('message').textContent,/ZIPに保存/);
  assert.equal(env.photoshopWrites,0);
});
test('cancelled save leaves no write and re-enables the export action',async()=>{
  const env=await setup({cancel:true});await env.el('font-project-export').listeners.click();
  assert.equal(env.writes.length,0);
  assert.match(env.el('message').textContent,/キャンセル/);
  assert.equal(env.el('font-project-export').disabled,false);
});
test('selection change while save dialog is open prevents the file write',async()=>{
  const env=await setup({switchDuringDialog:true});await env.el('font-project-export').listeners.click();
  assert.equal(env.dialogs,1);assert.equal(env.writes.length,0);
  assert.match(env.el('message').textContent,/変わりました/);
  assert.equal(env.photoshopWrites,0);
});
