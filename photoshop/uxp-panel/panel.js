/* Adobe Inline Math: selected text-layer conversion via Python/pdfLaTeX/fontTools. */
'use strict';
const {entrypoints}=require('uxp');
const {app,action,core}=require('photoshop');
const {assertBackend}=require('./backend_contract');
const {groupedCandidates}=require('./selected_inline');
const {diagnosticSummary}=require('./math_scan_report');
const {FONT_PS_NAME,buildDescriptor}=require('./text_ranges');
const {scanMathPlan}=require('./math_scan_plan');
const {buildPartialParts}=require('./partial_math_plan');
function partialDetails(issues){
  return issues.map(x=>'文字位置 '+(x.from+1)+'：'+x.message).join('\n');
}
const {diagnose}=require('./style_diagnostic');
const {examineRestoreChoices,prepareRestoreHypothesis}=require('./experimental_restore');
const {runTemporaryRestoreTrial}=require('./temporary_restore_trial');
const {verifyAppliedMathFonts}=require('./postflight');
const {applyInPlace}=require('./in_place_transaction');
const {restorePUAParts,buildRestoredDescriptor}=require('./restore_ranges');
const {preventForeignProjectReverse}=require('./font_identity_guard');
const {verifyRestoredLayer}=require('./restore_postflight');
const {restoreFailureMessage,describeUxPFailure}=require('./restore_error');
const {fontSummary,readFontArchive}=require('./font_management');
const BASE='http://127.0.0.1:8765';
const el=id=>document.getElementById(id);
let busy=false,prepared=null,choices=[],choiceDoc=null,lastMapping=[],mappingOpen=false;
let diagnosticExport=null;
let activeFont={family:'Inline Math Lab',postscript_name:FONT_PS_NAME},activeProjectId='legacy';
let activeProjectName='',activeFontReady=false;
const disclosureLabels=new Map();
function setDisclosure(id,open){
  el(id+'-body').classList.toggle('hidden',!open);
  el(id+'-toggle').setAttribute('aria-expanded',String(open));
  el(id+'-toggle').textContent=(open?'▾ ':'▸ ')+disclosureLabels.get(id);
}
function setupDisclosures(){
  for(const id of ['conversion-options','font-management-details','usage-help',
                   'diagnostic-tools','math-scan-details','experimental-tools']){
    disclosureLabels.set(id,el(id+'-toggle').textContent);
    setDisclosure(id,false);
    el(id+'-toggle').addEventListener('click',()=>
      setDisclosure(id,el(id+'-body').classList.contains('hidden')));
  }
}
function tell(message,error=false){
  el('message').textContent=message;
  el('message').className=error?'error':'';
}
function clearConversionResult(){
  el('summary').textContent='';
  el('math-scan-list').textContent='';
  el('hold-count').textContent='';
  el('hold-list').textContent='';
  el('conversion-holds').classList.add('hidden');
}
function showHolds(source,issues,heldCount=null){
  el('conversion-holds').classList.toggle('hidden',!issues.length);
  el('hold-count').textContent=!issues.length?'':heldCount===null
    ?'確認事項 '+issues.length+'件'
    :'数式保留 '+heldCount+'箇所 / 確認事項 '+(issues.length-heldCount)+'件';
  el('hold-list').textContent=issues.map(issue=>{
    const line=source.slice(0,issue.from).split(/\r\n|\r|\n/).length;
    const excerpt=source.slice(issue.from,Math.min(issue.to,issue.from+96))
      .replace(/\r\n|\r|\n/g,' ↵ ')+(issue.to-issue.from>96?'…':'');
    const reason=issue.code==='unregistered-formula'
      ?'この式のフォントを準備できなかったため、原文を保持します。':issue.message;
    return line+'行目 / 文字位置 '+(issue.from+1)+'\n'+reason+
      (excerpt?'\n'+excerpt:'');
  }).join('\n\n');
}
function displayScan(snap,scan,heldCount=null){
  const audit=diagnosticSummary(snap.source,snap.docId,snap.layerId,scan.matches);
  el('math-scan-list').textContent=audit.label+'\n'+audit.excludedSummary+
    (audit.excludedDetails?'\n\n検出対象外の $$：\n'+audit.excludedDetails:'')+
    '\n\n検出した数式：\n'+audit.details+
    (scan.issues.length?'\n\n保留・診断：\n'+partialDetails(scan.issues):'');
  showHolds(snap.source,scan.issues,heldCount);
  return audit;
}
function state(){
  el('advanced').disabled=busy||!!prepared;
  el('candidate').disabled=busy||!!prepared;
  el('font-project').disabled=busy||!!prepared;
  el('font-project-refresh').disabled=busy||!!prepared;
  el('font-project-create').disabled=busy||!!prepared;
  el('font-project-new-name').disabled=busy||!!prepared;
  const selectionCurrent=el('font-project').value===activeProjectId;
  el('font-project-rename-name').disabled=busy||!!prepared||!selectionCurrent||activeProjectId==='legacy';
  el('font-project-rename').disabled=busy||!!prepared||!selectionCurrent||activeProjectId==='legacy';
  el('font-project-export').disabled=busy||!selectionCurrent||!activeFontReady;
  el('duplicate-mode').disabled=busy||!!prepared;
  for(const id of ['check','convert','restore','scan','font-manual','font-verify','font-cancel','mapping-toggle','export-pua-html','diagnose-style','probe-restore-conflict','probe-restore-write','copy-style-report','save-style-report'])
    el(id).disabled=busy||
      (['restore','probe-restore-write'].includes(id)&&!!prepared)||
      (id==='scan'&&!el('advanced').checked)||
      (['font-manual','font-verify','font-cancel'].includes(id)&&!prepared)||
      (id==='mapping-toggle'&&!lastMapping.length)||
      (['copy-style-report','save-style-report'].includes(id)&&!diagnosticExport);
}
function showMapping(){
  el('mapping-content').classList.toggle('hidden',!mappingOpen||!lastMapping.length);
  el('mapping-toggle').textContent=mappingOpen?'対応を閉じる':'直前の変換のLaTeX / 文字コードを表示';
}
function clearPrepared(){
  prepared=null;
  el('font-row').classList.add('hidden');
  el('font-status-detail').textContent='';
  state();
}
async function api(path,options={}){
  let response;
  try{response=await fetch(BASE+path,options);}
  catch(e){throw Error('Pythonサーバーに接続できません。start_inline_math.cmdを起動してください。 '+e.message);}
  const result=await response.json();
  if(!response.ok||!result.ok)throw Error(result.error||'HTTP '+response.status);
  return result;
}
function updateFontInfo(health){
  const name=health.display_name||health.font.family;
  const changed=activeProjectId!==health.project_id||activeProjectName!==name;
  el('font-project-info').textContent=fontSummary(health);
  el('font-internal-name').textContent='Windows / Photoshopのフォント名: '+health.font.family;
  activeFont=health.font;activeProjectId=health.project_id;activeProjectName=name;
  activeFontReady=!!health.font_exists&&health.registered>0;
  const menu=el('font-project');
  for(let option=menu.firstChild;option;option=option.nextSibling)
    if(option.value===health.project_id)option.textContent=name+
      (health.project_id==='legacy'?'（従来）':'')+' ('+health.registered+'式)';
  if(changed)el('font-project-rename-name').value=health.project_id==='legacy'?'':name;
  state();
}
async function backend(){
  const response=assertBackend(await api('/api/health'));
  updateFontInfo(response);
  return response;
}
async function refreshProjects(){
  const response=assertBackend(await api('/api/projects'));
  const menu=el('font-project');
  while(menu.firstChild)menu.removeChild(menu.firstChild);
  const names=[{id:'legacy',label:'Inline Math Lab（従来）'}];
  for(const project of response.projects){
    if(!project||typeof project.project_id!=='string')continue;
    names.push({id:project.project_id,
      label:project.name+' ('+project.registered+'式)'});
  }
  for(const item of names){
    const option=document.createElement('option');
    option.value=item.id;option.textContent=item.label;
    menu.appendChild(option);
  }
  menu.value=response.active;
  activeProjectId=response.active;
  const health=await backend();
  activeFont=health.font;
  state();
}
async function chooseProject(){
  if(busy||prepared)return;
  busy=true;state();
  try{
    const pid=el('font-project').value;
    assertBackend(await api('/api/projects/select',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({project_id:pid})
    }));
    prepared=null;choices=[];choiceDoc=null;
    clearConversionResult();
    lastMapping=[];mappingOpen=false;showMapping();
    await refreshProjects();await ping();
    tell('選択中の数式フォント: '+activeProjectName+
      '。LaTeXへ戻す際は、変換時と同じ数式フォントを選んでください。');
  }catch(e){tell(e.message,true);}
  finally{busy=false;state();}
}
async function createProject(){
  if(busy||prepared)return;
  busy=true;state();
  try{
    const name=el('font-project-new-name').value.trim();
    const created=assertBackend(await api('/api/projects/create',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name})
    }));
    assertBackend(await api('/api/projects/select',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({project_id:created.project.project_id})
    }));
    el('font-project-new-name').value='';
    prepared=null;choices=[];choiceDoc=null;
    clearConversionResult();
    lastMapping=[];mappingOpen=false;showMapping();
    await refreshProjects();await ping();
    tell('新規Paper Mathフォントを作成して選択しました: '+
      created.project.name+'。最初の数式変換でOTFを生成します。'+
      '必要に応じてWindowsへ手動インストールしてください。');
  }catch(e){tell(e.message,true);}
  finally{busy=false;state();}
}
async function renameProject(){
  if(busy||prepared||activeProjectId==='legacy')return;
  busy=true;state();
  try{
    const pid=el('font-project').value;
    const renamed=assertBackend(await api('/api/projects/rename',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({project_id:pid,name:el('font-project-rename-name').value.trim()})
    }));
    if(!renamed.project||renamed.project.project_id!==pid)
      throw Error('表示名変更の対象が一致しません。一覧を更新してください。');
    await refreshProjects();await ping();
    tell('表示名を変更しました: '+renamed.project.name);
  }catch(e){tell(e.message,true);}
  finally{busy=false;state();}
}
async function exportProject(){
  if(busy)return;
  busy=true;state();
  try{
    const expected=await backend();
    if(expected.project_id!==el('font-project').value)
      throw Error('選択フォントが変わっています。一覧を更新してください。');
    const response=await fetch(BASE+'/api/font/export-zip',{cache:'no-store'});
    const archive=await readFontArchive(response,expected);
    const storage=require('uxp').storage;
    const file=await storage.localFileSystem.getFileForSaving(archive.filename,{types:['zip']});
    if(!file){tell('フォントの書き出しをキャンセルしました。');return;}
    // A file dialog may stay open while another panel switches/updates the font.
    const latest=await backend();
    if(latest.project_id!==expected.project_id||latest.font.postscript_name!==expected.font.postscript_name||
       latest.registered!==expected.registered)
      throw Error('保存中にフォントの選択または生成版が変わりました。書き出しをやり直してください。');
    await file.write(archive.data,{format:storage.formats.binary});
    tell('フォントと対応表をZIPに保存しました: '+(file.nativePath||file.name));
  }catch(e){tell(describeUxPFailure(e),true);}
  finally{busy=false;state();}
}
async function ping(){
  try{
    const b=await backend();
    activeFont=b.font;activeProjectId=b.project_id;
    let photoshopFont=false;
    try {
      const found=app.fonts.getByName(b.font.postscript_name);
      photoshopFont=!!found&&found.postScriptName===b.font.postscript_name;
    } catch (_) {}
    el('server-status').textContent='接続済み / '+(b.registered===0
      ?'最初の変換でフォントを生成':photoshopFont
        ?'フォントはPhotoshop認識済み':'フォントはPhotoshop未認識');
    el('server-status').className=photoshopFont||b.registered===0?'ok':'';
  }catch(e){
    el('server-status').textContent=e.message;
    el('server-status').className='bad';
  }
}
function selectedLayer(){
  if(!app.documents.length)throw Error('開いているドキュメントがありません。');
  const doc=app.activeDocument;
  if(doc.activeLayers.length!==1||!doc.activeLayers[0].textItem)
    throw Error('変換するテキストレイヤーを1つ選択してください。');
  return {doc,layer:doc.activeLayers[0]};
}
async function snapshot(){
  const {doc,layer}=selectedLayer();
  const [res]=await action.batchPlay([{
    _obj:'get',_target:[{_property:'textKey'},{_ref:'textLayer',_id:layer.id}]
  }],{});
  if(!res||res._obj==='error'||!res.textKey||typeof res.textKey.textKey!=='string')
    throw Error('Photoshopテキストを取得できません。');
  return {docId:doc.id,layerId:layer.id,layer,source:res.textKey.textKey,
          descriptor:res.textKey};
}
async function loadCandidates(){
  if(busy)return;
  busy=true;state();
  try{
    clearPrepared();
    clearConversionResult();
    const snap=await snapshot();
    choices=groupedCandidates(snap.source);
    const scan=scanMathPlan(snap.source);
    displayScan(snap,scan);
    if(scan.fatal)throw Error(partialDetails(scan.issues));
    choiceDoc={docId:snap.docId,layerId:snap.layerId,source:snap.source};
    const menu=el('candidate');
    while(menu.firstChild)menu.removeChild(menu.firstChild);
    choices.forEach((item,i)=>{
      const option=document.createElement('option');
      option.value=String(i);
      option.textContent=(i+1)+' · '+String.fromCharCode(36)+item.latex+String.fromCharCode(36)+' （'+item.count+'箇所）';
      menu.appendChild(option);
    });
    if(!choices.length)throw Error('このレイヤーに変換対象の数式がありません。');
    const total=choices.reduce((sum,item)=>sum+item.count,0);
    tell(total+'箇所・'+choices.length+'種類の式があります。必要な式を指定してください。');
  }catch(e){
    choices=[];choiceDoc=null;
    tell(e.message,true);
  }finally{busy=false;state();}
}
async function fontStatus(){
  await backend();
  return api('/api/font/status');
}
function chosenFormula(snap,matches){
  if(!el('advanced').checked)return null;
  if(!choiceDoc||snap.docId!==choiceDoc.docId||
     snap.layerId!==choiceDoc.layerId||snap.source!==choiceDoc.source)
    throw Error('個別指定の候補が古くなっています。「候補を更新」を押してください。');
  const index=Number(el('candidate').value);
  if(!Number.isInteger(index)||index<0||index>=choices.length)
    throw Error('式を選択してください。');
  const chosen=choices[index];
  if(!matches.some(x=>x.from===chosen.from&&x.to===chosen.to&&x.raw===chosen.raw))
    throw Error('選択した数式が変更されています。');
  return chosen;
}
async function applyPrepared(){
  let stage='準備内容の確認';
  try{
  if(!prepared)throw Error('変換内容が準備されていません。');
  const active=await backend();
  if(active.project_id!==prepared.projectId||
     active.font.postscript_name!==prepared.font.postscript_name)
    throw Error('変換準備中に数式フォントの選択が変わりました。やり直してください。');
  stage='対象レイヤーの再取得・本文一致の確認';
  const snap=await snapshot();
  if(snap.docId!==prepared.docId||snap.layerId!==prepared.layerId||
     snap.source!==prepared.source)
    throw Error('生成中にレイヤーまたは本文が変更されました。変換をやり直してください。');
  stage='Windowsフォントの照合';
  const font=await fontStatus();
  if(font.project_id!==prepared.projectId||font.state!=='current')
    throw Error('Windowsフォントが生成版と一致しません。'+(font.reason||''));
  stage='Photoshopフォントの照合';
  let psFont;
  try{psFont=app.fonts.getByName(prepared.font.postscript_name);}
  catch(_){throw Error('Photoshopのフォント一覧に '+prepared.font.postscript_name+' がありません。フォントのインストール後にPhotoshopを再起動してください。');}
  if (!psFont || psFont.postScriptName!==prepared.font.postscript_name)
    throw Error('Photoshopが期待したPostScript名のフォントを返しません。変換を中断します。');
  stage='長文と書式範囲の投影';
  let domSize=null;
  try{domSize=snap.layer.textItem.characterStyle.size;}catch(_){}
  const descriptor=buildDescriptor(snap.descriptor,prepared.converted,domSize,prepared.font);
  delete descriptor.kerningRange;
  const inPlace=!prepared.duplicate;
  stage=inPlace?'同一レイヤーへの書き込み・読み戻し検証':'複製レイヤーへの書き込み・読み戻し検証';
  tell('PUAへの置換中：'+stage+'（'+prepared.converted.mathCount+'箇所、'+
       prepared.source.length+'文字）');
  if(inPlace){
    await applyInPlace({
      core,action,documentID:snap.docId,layerID:snap.layerId,
      before:snap.descriptor,after:descriptor,
      historyName:'Paper Math: convert in place',
      confirmTarget:async()=>{
        const selected=selectedLayer();
        if(selected.doc.id!==snap.docId||selected.layer.id!==snap.layerId)
          throw Error('別のテキストレイヤーが選択されました。変更していません。');
      },
      verify:actual=>verifyAppliedMathFonts(prepared.converted,actual,prepared.font.postscript_name)
    });
  }else{
    await core.executeAsModal(async()=>{
    let duplicate=null;
    try{
      duplicate=await snap.layer.duplicate();
      duplicate.name=snap.layer.name+' [Inline Math]';
      const [res]=await action.batchPlay([{
        _obj:'set',_target:[{_ref:'textLayer',_id:duplicate.id}],to:descriptor
      }],{});
      if(res&&res._obj==='error')throw Error(res.message||'テキスト変換に失敗しました。');
      // Photoshop sometimes silently substitutes fonts despite valid Windows
      // installation. Verify the persisted text run before hiding the source.
      const [check]=await action.batchPlay([{
        _obj:'get',_target:[{_property:'textKey'},{_ref:'textLayer',_id:duplicate.id}]
      }],{});
      if(!check||check._obj==='error'||!check.textKey)
        throw Error('変換後のレイヤー情報を読み出せません。元レイヤーを残します。');
      verifyAppliedMathFonts(prepared.converted,check.textKey,prepared.font.postscript_name);
      snap.layer.visible=false;
    }catch(e){
      if(duplicate)try{await duplicate.delete();}catch(_){}
      throw e;
    }
    },{commandName:'Inline Math: convert LaTeX'});
  }
  stage='置換成功後のUI更新';
  const n=prepared.converted.mathCount;
  const held=prepared.converted.issues||[];
  const heldCount=prepared.converted.heldFormulaCount||0;
  clearPrepared();
  choices=[];choiceDoc=null;
  el('summary').textContent=n+'箇所の数式を変換しました。数式保留 '+heldCount+'箇所 / 確認事項 '+(held.length-heldCount)+'件。';
  tell(inPlace?'変換完了。同一レイヤーを更新しました（ヒストリーでUndo可能）。':
    '変換完了。元レイヤーは非表示で残っています。');
  }catch(e){
    if(prepared)el('font-status-detail').textContent='停止段階: '+stage+'\n'+
      (e&&e.message?e.message:String(e));
    throw Error('PUAに置換できませんでした。停止段階: '+stage+'\n'+
      (e&&e.message?e.message:String(e)));
  }
}
async function convert(){
  if(busy)return;
  busy=true;state();
  try{
    if(prepared)clearPrepared(); // Re-running conversion safely replaces a pending preview.
    clearConversionResult();
    const fontSelection=await backend();
    const snap=await snapshot();
    const scan=scanMathPlan(snap.source);
    displayScan(snap,scan);
    if(scan.fatal)throw Error(partialDetails(scan.issues));
    const matches=scan.matches;
    if(!matches.length)throw Error('このレイヤーに変換対象の数式がありません。');
    const chosen=chosenFormula(snap,matches);
    // One complete source for the default flow; no per-formula selection step.
    // The server returns one stable PUA glyph per unique LaTeX expression.
    const requestText=chosen?chosen.raw:snap.source;
    const result=await api('/api/prepare',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({text:requestText,partial:true})
    });
    assertBackend(result);
    if(result.project_id!==fontSelection.project_id||
       result.font.postscript_name!==fontSelection.font.postscript_name)
      throw Error('数式フォントの選択が途中で変わりました。変換をやり直してください。');
    const requestScan=scanMathPlan(requestText);
    if(!Array.isArray(result.accepted_matches)||!Array.isArray(result.issues))
      throw Error('部分成功に未対応のサーバーです。Pythonサーバーを最新版で起動し直してください。');
    const serverPlan=buildPartialParts(requestText,requestScan,result.entries);
    const accepted=requestScan.matches.filter(m=>result.entries.some(e=>e.latex===m.latex));
    if(result.candidate_instances!==requestScan.matches.length||
       result.accepted_matches.length!==accepted.length||
       accepted.some((m,i)=>{const x=result.accepted_matches[i];
         return !x||x.from!==m.from||x.to!==m.to||x.latex!==m.latex||x.raw!==m.raw;}))
      throw Error('PythonとUXPの数式範囲が一致しません。');
    if(result.converted!==serverPlan.text||result.formula_instances!==serverPlan.mathCount)
      throw Error('PythonとUXPのLaTeX/PUA置換結果が一致しません。');
    const localReport=chosen?{...scan,matches:scan.matches.filter(x=>x.latex===chosen.latex)}:scan;
    const converted=buildPartialParts(snap.source,localReport,result.entries,
      {paragraphStyleRange:snap.descriptor.paragraphStyleRange});
    // Backend failures include precise TeX diagnostics; replace generic missing-map holds.
    const failures=new Map((result.issues||[]).filter(x=>x.code==='render-failed').map(x=>[x.latex,x.message]));
    converted.issues=converted.issues.map(x=>x.code==='unregistered-formula'&&failures.has(x.latex)
      ?{...x,code:'render-failed',message:failures.get(x.latex)}:x);
    displayScan(snap,{...scan,issues:converted.issues},converted.heldFormulaCount);
    if(!converted.mathCount){
      el('summary').textContent='変換 0箇所。数式保留 '+converted.heldFormulaCount+'箇所 / 確認事項 '+(converted.issues.length-converted.heldFormulaCount)+'件。原文を保持しました。';
      tell('変換できる数式がありません。保留箇所と理由を確認してください。');
      return;
    }
    // No Photoshop edits before the font is ready and the descriptor validates.
    let domSize=null;
    try{domSize=snap.layer.textItem.characterStyle.size;}catch(_){}
    buildDescriptor(snap.descriptor,converted,domSize,result.font);
    lastMapping=result.entries;
    mappingOpen=false;
    el('mapping-content').textContent=lastMapping.map(e=>e.latex+' → U+'+e.codepoint).join('\n');
    showMapping();
    prepared={docId:snap.docId,layerId:snap.layerId,source:snap.source,converted,
      font:result.font,projectId:result.project_id,
      duplicate:!!el('duplicate-mode').checked};
    el('summary').textContent=converted.mathCount+'箇所を変換予定。数式保留 '+converted.heldFormulaCount+'箇所 / 確認事項 '+(converted.issues.length-converted.heldFormulaCount)+'件。';
    const font=await fontStatus();
    if(font.state==='current'){
      await applyPrepared();
    }else{
      el('font-row').classList.remove('hidden');
      el('font-status-detail').textContent='照合結果: '+font.state+'。'+
        (font.reason||'生成したOTFとWindows登録が一致していません。')+ '\n'+
        '生成済みの数式はまだPhotoshopへ適用していません。';
      tell('フォント生成完了。Windowsへ更新した後、「照合して適用」を押してください。'+
           (font.reason?'\n'+font.reason:''));
    }
  }catch(e){
    if(prepared)el('font-row').classList.remove('hidden');
    tell(e.message,true);
  }
  finally{busy=false;state();}
}
/*
 * Reverse the selected Photoshop PUA text into editable $LaTeX$.
 * The mapping API does not create fonts. Preflight is pure and the only
 * document write uses a history transaction or an optional duplicate.
 */
async function restore(){
  if(busy||prepared)return;
  busy=true;state();
  const inPlace=!el('duplicate-mode').checked;
  let stage='Pythonサーバー接続確認';
  try{
    clearConversionResult();
    const fontSelection=await backend();
    stage='対象テキストレイヤーの取得';
    const snap=await snapshot();
    stage='登録PUA対応表の取得';
    const response=assertBackend(await api('/api/restore/map'));
    stage='登録簿とフォント識別の検証';
    if(!response.font||response.project_id!==fontSelection.project_id||
       response.font.postscript_name!==fontSelection.font.postscript_name||
       !Array.isArray(response.entries)||
       response.revision!==response.entries.length)
      throw Error('登録簿の数式フォント識別情報が一致しません。復元を中止します。');
    stage='異なるPaper Mathフォントの混在確認';
    const available=assertBackend(await api('/api/projects'));
    if(available.active!==response.project_id)
      throw Error('確認中に選択フォントが変更されました。');
    preventForeignProjectReverse(
      snap.source,snap.descriptor.textStyleRange,
      available.projects,response.font.postscript_name
    );
    stage='PUAからLaTeXへの逆引き';
    const restored=restorePUAParts(
      snap.source,response.entries,snap.descriptor.textStyleRange,
      response.font.postscript_name,{allowFontMismatch:response.project_id==='legacy'}
    );
    stage='復元後の文字書式・段落書式の構築';
    // Stop before Photoshop is modified when a text paragraph has no usable
    // body font or the range metadata is inconsistent.
    const descriptor=buildRestoredDescriptor(snap.descriptor,restored);
    delete descriptor.kerningRange;
    stage='Photoshopのモーダル処理開始';
    if(inPlace){
      stage='同一レイヤーへの書き込み・読み戻し検証';
      await applyInPlace({
        core,action,documentID:snap.docId,layerID:snap.layerId,
        before:snap.descriptor,after:descriptor,
        historyName:'Paper Math: restore in place',
        confirmTarget:async()=>{
          const selected=selectedLayer();
          if(selected.doc.id!==snap.docId||selected.layer.id!==snap.layerId)
            throw Error('別のテキストレイヤーが選択されました。変更していません。');
        },
        verify:actual=>verifyRestoredLayer(restored,descriptor,actual,response.font.postscript_name)
      });
    }else{
      await core.executeAsModal(async()=>{
      let duplicate=null;
      try{
        stage='元レイヤーと書式の再確認';
        const fresh=await snapshot();
        if(fresh.docId!==snap.docId||fresh.layerId!==snap.layerId||
           fresh.source!==snap.source||
           JSON.stringify(fresh.descriptor.textStyleRange)!==
             JSON.stringify(snap.descriptor.textStyleRange)||
           JSON.stringify(fresh.descriptor.paragraphStyleRange)!==
             JSON.stringify(snap.descriptor.paragraphStyleRange))
          throw Error('復元の準備中にレイヤーや書式が変わりました。もう一度実行してください。');
        stage='複製レイヤーの作成';
        duplicate=await snap.layer.duplicate();
        duplicate.name=snap.layer.name+' [LaTeX]';
        stage='複製レイヤーへの書き込み';
        const [setResult]=await action.batchPlay([{
          _obj:'set',_target:[{_ref:'textLayer',_id:duplicate.id}],to:descriptor
        }],{});
        if(setResult&&setResult._obj==='error')
          throw Error(setResult.message||'LaTeX復元の書き込みに失敗しました。');
        stage='複製レイヤーの読み戻し';
        const [readResult]=await action.batchPlay([{
          _obj:'get',_target:[{_property:'textKey'},{_ref:'textLayer',_id:duplicate.id}]
        }],{});
        if(!readResult||readResult._obj==='error'||!readResult.textKey)
          throw Error('復元したレイヤーを読み戻せませんでした。');
        stage='復元した文字列と書式の検証';
        verifyRestoredLayer(restored,descriptor,readResult.textKey,response.font.postscript_name);
        stage='元PUAレイヤーの非表示';
        snap.layer.visible=false;
      }catch(e){
        if(duplicate){
          try{
            await duplicate.delete();
          }catch(rollbackError){
            // Keep the original exception's stage; report cleanup separately.
            console.error('Paper Math: duplicate rollback also failed',
              describeUxPFailure(rollbackError));
          }
        }
        throw e;
      }
      },{commandName:'Paper Math: restore LaTeX'});
    }
    stage='完了';
    el('summary').textContent=restored.mathCount+'箇所の数式をLaTeXへ戻しました。';
    const recoveredWarning=restored.fontMismatchCount
      ?' ただし'+restored.fontMismatchCount+'個のPUAは数式フォント以外から復元しました。'
       +' 別プロジェクトの同一PUAコードとの混同に注意してください。'
      :'';
    tell((inPlace?'復元完了。同一レイヤーを書き換えました。':'復元完了。元のPUAレイヤーは非表示で残っています。')+
      '数式を編集してから再変換できます。'+recoveredWarning);
  }catch(e){
    console.error('Paper Math restoration failed at',stage,describeUxPFailure(e));
    tell(inPlace
      ?'LaTeXへの同一レイヤー復元を中断しました。\n停止箇所: '+stage+'\n原因: '+describeUxPFailure(e)
      :restoreFailureMessage(stage,e),true);
  }finally{
    busy=false;state();
  }
}
async function openManual(){
  if(busy||!prepared)return;
  busy=true;state();
  try{
    await backend();
    await api('/api/font/update/open',{method:'POST',
      headers:{'Content-Type':'application/json'},body:'{}'});
    tell('フォントの更新先を開きました。インストール後に「照合して適用」を押してください。');
  }catch(e){tell(e.message,true);}
  finally{busy=false;state();}
}
async function verifyAndApply(){
  if(busy||!prepared)return;
  busy=true;state();
  try{
    await applyPrepared();
  }catch(e){tell(e.message,true);}
  finally{busy=false;state();}
}
function displayDiagnostic(text){
  diagnosticExport=text;
  const output=el('style-report');
  output.textContent=text||'';
  output.classList.toggle('hidden',!text);
  el('style-report-actions').classList.toggle('hidden',!text);
  if(text)setDisclosure('diagnostic-tools',true);
  state();
}
el('diagnose-style').addEventListener('click',async()=>{
  if(busy)return;
  busy=true;state();
  try{
    displayDiagnostic(null); // A failed recheck must not leave stale export data.
    const snap=await snapshot();
    const report=diagnose(snap.descriptor);
    displayDiagnostic(JSON.stringify(report,null,2)+'\n');
    tell(report.puaCount+'個の数式PUAを検出。「コピー」または「JSON保存」で共有できます。PSDやフォントは変更しません。');
  }catch(e){displayDiagnostic(null);tell(e.message,true);}
  finally{busy=false;state();}
});

/* Development-only: temporarily prefer the earlier or later identical-bound
 * Photoshop textStyle runs in memory. Never writes a descriptor or layer. */
el('probe-restore-conflict').addEventListener('click',async()=>{
  if(busy)return;
  busy=true;state();
  try{
    displayDiagnostic(null);
    await backend();
    const snap=await snapshot();
    const response=assertBackend(await api('/api/restore/map'));
    if(!response.font||!response.font.postscript_name||
       !Array.isArray(response.entries)||
       response.revision!==response.entries.length)
      throw Error('PUA対応表と数式フォントの識別が一致しないため試験できません。');
    const report=examineRestoreChoices(
      snap.descriptor,response.entries,response.font.postscript_name
    );
    displayDiagnostic(JSON.stringify(report,null,2)+'\n');
    const outcomes=report.results.map(r=>
      (r.policy==='first'?'前を採用':'後を採用')+': '+
      (r.status==='preflight-ok'?'復元準備OK ('+r.mathCount+'式)':'停止')
    ).join(' / ');
    tell('書式重複の仮解決（読み取りのみ）: '+outcomes+
      '。復元準備OKはPhotoshopへの書き込み成功を意味しません。元レイヤー・PSDは変更していません。');
  }catch(e){
    displayDiagnostic(null);
    tell('書式競合の試験に失敗: '+e.message,true);
  }finally{busy=false;state();}
});


/*
 * Opt-in real Photoshop write trial: only disposable duplicates.
 * Uses strict readback verification. The original source is not hidden or
 * edited, and temporary layers are always scheduled for cleanup. This may
 * still add entries to Photoshop history; use a disposable PSD copy.
 */
el('probe-restore-write').addEventListener('click',async()=>{
  if(busy||prepared)return;
  busy=true;state();
  try{
    displayDiagnostic(null);
    await backend();
    const snap=await snapshot();
    const response=assertBackend(await api('/api/restore/map'));
    if(!response.font||!response.font.postscript_name||
       !Array.isArray(response.entries)||
       response.revision!==response.entries.length)
      throw Error('数式の対応表・フォント識別が一致しません。');
    const plans=['first','last'].map(policy=>
      prepareRestoreHypothesis(
        snap.descriptor,response.entries,response.font.postscript_name,policy
      )
    );
    const report=await runTemporaryRestoreTrial({
      sourceLayer:snap.layer,originalDescriptor:snap.descriptor,plans,
      action,core,verifyRestoredLayer,mathPostScriptName:response.font.postscript_name
    });
    displayDiagnostic(JSON.stringify(report,null,2)+'\n');
    const status=report.trialResults.map(x=>
      (x.policy==='first'?'前':'後')+': '+x.status
    ).join(' / ');
    const sourceWarning=report.sourceStillMatches===true
      ?'元レイヤーの本文・書式は試験前と一致しています。'
      :'元レイヤーの再照合が未完了または不一致です。PSDを保存せず、診断JSONを確認してください。';
    tell('試験用複製への実際の書き込み・読み戻し: '+status+
      (report.persistentExtraLayerPossible
       ?'。一時レイヤーの削除に失敗した可能性があります。JSONのIDを確認し、PSDを保存しないでください。'
       :'。試験用複製は削除処理済みです。')+' '+sourceWarning);
  }catch(e){
    displayDiagnostic(null);
    tell('試験用複製への復元テストを中断: '+describeUxPFailure(e),true);
  }finally{busy=false;state();}
});

/* Export the current generated font and registered PUA mapping as an
 * independent, offline glyph catalogue. No TeX rendering or registry writes.
 * Opening the saved file is a separate OS-consented action.
 */
el('export-pua-html').addEventListener('click',async()=>{
  if(busy)return;
  busy=true;state();
  try{
    await backend();
    let response;
    try{response=await fetch(BASE+'/api/font/preview-html',{cache:'no-store'});}
    catch(error){throw Error('PUA一覧サーバーに接続できません: '+error.message);}
    if(!response.ok){
      let detail='HTTP '+response.status;
      try{const payload=await response.json();detail=payload.error||detail;}catch(_){}
      throw Error('PUA一覧の生成に失敗: '+detail);
    }
    const html=await response.text();
    if(!html.startsWith('<!doctype html>')||
       !html.includes('Paper Math — PUA数式一覧'))
      throw Error('サーバーが想定したHTMLを返しませんでした。');
    const fs=require('uxp').storage.localFileSystem;
    const file=await fs.getFileForSaving('paper-math-pua-preview.html',{types:['html']});
    if(!file){tell('PUA一覧の保存をキャンセルしました。');return;}
    await file.write(html);
    const where=file.nativePath||file.name;
    const shell=require('uxp').shell;
    if(!file.nativePath||!shell||typeof shell.openPath!=='function'){
      tell('PUA一覧を保存しました: '+where+'。保存したHTMLをブラウザで開いてください。');
      return;
    }
    try{
      const result=await shell.openPath(
        file.nativePath,'Paper Mathで生成したPUA一覧のHTMLをブラウザで開きます。'
      );
      if(result)throw Error(String(result));
      tell('PUA一覧をHTMLに保存し、ブラウザで開きました: '+where);
    }catch(error){
      tell('PUA一覧はHTMLで保存済みです: '+where+
        '。自動的に開けませんでした。保存先から開いてください。詳細: '+describeUxPFailure(error));
    }
  }catch(error){tell(describeUxPFailure(error),true);}
  finally{busy=false;state();}
});

el('copy-style-report').addEventListener('click',async()=>{
  if(busy||!diagnosticExport)return;
  busy=true;state();
  try{
    const clipboard=navigator.clipboard;
    if(typeof clipboard.setContent==='function')
      await clipboard.setContent({'text/plain':diagnosticExport});
    else
      await clipboard.writeText(diagnosticExport);
    tell('診断結果をクリップボードにコピーしました。このチャットに貼り付けられます。');
  }catch(e){tell('コピーに失敗しました: '+e.message,true);}
  finally{busy=false;state();}
});
el('save-style-report').addEventListener('click',async()=>{
  if(busy||!diagnosticExport)return;
  busy=true;state();
  try{
    // Explicit save picker; no background write or arbitrary folder access.
    const fs=require('uxp').storage.localFileSystem;
    const file=await fs.getFileForSaving('inline-math-style-diagnostic.json',{types:['json']});
    if(!file){tell('保存をキャンセルしました。');return;}
    await file.write(diagnosticExport);
    tell('診断結果をJSONで保存しました: '+(file.nativePath||file.name));
  }catch(e){tell('JSON保存に失敗しました: '+e.message,true);}
  finally{busy=false;state();}
});
el('font-project-refresh').addEventListener('click',async()=>{
  if(busy)return;
  busy=true;state();
  try{await refreshProjects();tell('Paper Mathフォント一覧を更新しました。');}
  catch(e){tell(e.message,true);}
  finally{busy=false;state();}
});
el('font-project').addEventListener('change',chooseProject);
el('font-project-create').addEventListener('click',createProject);
el('font-project-rename').addEventListener('click',renameProject);
el('font-project-export').addEventListener('click',exportProject);
el('check').addEventListener('click',ping);
el('convert').addEventListener('click',convert);
el('restore').addEventListener('click',restore);
el('font-manual').addEventListener('click',openManual);
el('font-verify').addEventListener('click',verifyAndApply);
el('font-cancel').addEventListener('click',()=>{
  if(busy||!prepared)return;
  clearPrepared();clearConversionResult();
  tell('変換待ちを取り消しました。生成済みのフォントと対応表は保持しています。');
});
el('scan').addEventListener('click',loadCandidates);
el('advanced').addEventListener('change',()=>{
  el('advanced-options').classList.toggle('hidden',!el('advanced').checked);
  clearPrepared();
  clearConversionResult();
  if(el('advanced').checked)loadCandidates();
});
el('candidate').addEventListener('change',()=>{clearPrepared();clearConversionResult();});
el('mapping-toggle').addEventListener('click',()=>{
  mappingOpen=!mappingOpen;showMapping();
});
entrypoints.setup({panels:{inlineMathPanel:{show(){
  if(!busy)refreshProjects().then(ping).catch(e=>tell(e.message,true));
}}}});
setupDisclosures();state();showMapping();refreshProjects().then(ping).catch(e=>tell(e.message,true));
