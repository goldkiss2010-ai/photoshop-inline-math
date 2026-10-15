/*
 * Development-only, read-only text-selection introspection.
 *
 * No text content, clipboard access, writes, or modal actions.
 * Photoshop may commit a text edit when focus moves to this panel,
 * so a missing range here is NOT proof that the host cannot expose one.
 */
'use strict';

const MAYBE_SELECTION=/(selection|selected|caret|cursor|insertion|textEdit|textTool|currentTool)/i;
const SAFE_NUMBER_FIELDS=/^(from|to|start|end|length|index|offset|position|count|begin)$/i;

function summarizeValue(value, depth=0) {
  if (typeof value==='number' && Number.isFinite(value)) return value;
  if (typeof value==='boolean' || value===null) return value;
  if (typeof value==='string') return '<string:'+value.length+' chars>';
  if (Array.isArray(value)) return {type:'array',length:value.length};
  if (!value || typeof value!=='object') return '<not serializable>';
  if (value._obj==='error')
    return {type:'photoshop-error',code:typeof value.result==='number'?value.result:null,
            message:typeof value.message==='string'?value.message.slice(0,160):null};
  if (typeof value._enum==='string' && typeof value._value==='string')
    return {_enum:value._enum,_value:value._value};
  if (depth>=2) return {type:'object',keys:Object.keys(value).slice(0,24)};
  const fields={};
  for(const [key,v] of Object.entries(value)) {
    if(SAFE_NUMBER_FIELDS.test(key) && typeof v==='number')fields[key]=v;
    else if(MAYBE_SELECTION.test(key))fields[key]=summarizeValue(v,depth+1);
  }
  return {type:'object',keys:Object.keys(value).slice(0,40),fields};
}

function summarizeResponse(response) {
  if(response===undefined)return {status:'no-response'};
  if(!response||typeof response!=='object')return {status:'unexpected',value:summarizeValue(response)};
  if(response._obj==='error')return {status:'unsupported-or-error',detail:summarizeValue(response)};
  return {status:'returned',keys:Object.keys(response).slice(0,100),
    candidates:Object.fromEntries(Object.entries(response)
      .filter(([key])=>MAYBE_SELECTION.test(key))
      .slice(0,24).map(([key,value])=>[key,summarizeValue(value)]))};
}

async function probeTextSelection(action, layerId) {
  if(!action || typeof action.batchPlay!=='function' || !Number.isInteger(layerId))
    throw Error('Action ManagerまたはテキストレイヤーIDが不正です。');
  const layer={_ref:'layer',_id:layerId};
  const application={_ref:'application'};
  const probes=[
    // "get all" is intended for development introspection only.
    ['layerProperties',{_obj:'get',_target:[layer]}],
    ['layerTextSelection',{_obj:'get',_target:[{_property:'textSelection'},layer]}],
    ['layerTextSelectionRange',{_obj:'get',_target:[{_property:'textSelectionRange'},layer]}],
    ['applicationCurrentTool',{_obj:'get',_target:[{_property:'currentTool'},application]}],
    ['applicationToolOptions',{_obj:'get',_target:[{_property:'currentToolOptions'},application]}],
  ];
  const results={};
  for(const [name,command] of probes){
    try {
      const raw=await action.batchPlay([command],{});
      results[name]=summarizeResponse(Array.isArray(raw)?raw[0]:raw);
    } catch(e) {
      results[name]={status:'threw',error:typeof e?.message==='string'
        ?e.message.slice(0,160):'No error message'};
    }
  }
  return {
    scope:'development-only/read-only',
    note:'パネルにフォーカスした時点で文字の選択が解除される可能性があります。',
    results
  };
}

module.exports={probeTextSelection,summarizeResponse};
