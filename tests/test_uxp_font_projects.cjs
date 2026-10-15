'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {buildDescriptor,inlineParts}=require('../photoshop/uxp-panel/text_ranges');
const {restorePUAParts}=require('../photoshop/uxp-panel/restore_ranges');
const panel=fs.readFileSync(path.join(__dirname,'../photoshop/uxp-panel/panel.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../photoshop/uxp-panel/index.html'),'utf8');
const src='日本語 $x_i$ テスト';
const base={fontPostScriptName:'Body-Regular',fontAvailable:true,
  size:{_unit:'pointsUnit',_value:16}};
const original={textKey:src,
 textStyleRange:[{from:0,to:src.length+1,textStyle:base}],
 paragraphStyleRange:[{from:0,to:src.length+1,paragraphStyle:{align:'left'}}]};
const first={family:'Paper Math abc',postscript_name:'PaperMathabc-Regular'};
const second={family:'Paper Math xyz',postscript_name:'PaperMathxyz-Regular'};

test('math glyph uses selected family and PostScript without changing original descriptor',()=>{
 const raw=JSON.stringify(original);
 const converted=inlineParts(src,[{latex:'x_i',char:'\uE000'}]);
 const out=buildDescriptor(original,converted,null,first);
 const math=out.textKey.indexOf('\uE000');
 const style=out.textStyleRange.find(r=>r.from<=math&&math<r.to).textStyle;
 assert.equal(style.fontPostScriptName,first.postscript_name);
 assert.equal(style.fontName,first.family);
 assert.equal(JSON.stringify(original),raw);
 const other=buildDescriptor(original,converted,null,second);
 const otherStyle=other.textStyleRange.find(r=>r.from<=math&&math<r.to).textStyle;
 assert.equal(otherStyle.fontPostScriptName,second.postscript_name);
 assert.notEqual(otherStyle.fontPostScriptName,style.fontPostScriptName);
});

test('selected project font is required for safe reverse mapping',()=>{
 const src='文 \uE000 式';
 const style=[{from:0,to:src.length,textStyle:{fontPostScriptName:first.postscript_name}}];
 const mappings=[{latex:'x_i',codepoint:'E000',char:'\uE000'}];
 assert.equal(restorePUAParts(src,mappings,style,first.postscript_name).mathCount,1);
 assert.throws(()=>restorePUAParts(src,mappings,style,second.postscript_name),/フォントが一致/);
});

test('UXP exposes managed font selection and creation',()=>{
 assert.match(html,/id="font-project"/);
 assert.match(html,/id="font-project-new-name"/);
 assert.match(html,/id="font-project-create"/);
 assert.match(panel,/\/api\/projects\/create/);
 assert.match(panel,/\/api\/projects\/select/);
 assert.match(panel,/\/api\/projects'/);
});

test('preflight and postflight use project-selected font identity',()=>{
 assert.match(panel,/result\.project_id!==fontSelection\.project_id/);
 assert.match(panel,/prepared\.projectId/);
 assert.match(panel,/prepared\.font\.postscript_name/);
 assert.match(panel,/buildDescriptor\(snap\.descriptor,converted,domSize,result\.font\)/);
 assert.match(panel,/allowFontMismatch:response\.project_id==='legacy'/);
 assert.match(panel,/response\.font\.postscript_name/);
});
