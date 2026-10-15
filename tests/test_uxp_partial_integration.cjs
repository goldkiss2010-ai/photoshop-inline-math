'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {scanCandidates,groupedCandidates}=require('../photoshop/uxp-panel/selected_inline');
const {restorePUAParts}=require('../photoshop/uxp-panel/restore_ranges');
test('candidate listing continues after broken math and protects code dollars',()=>{
  const source='前 $broken\n\n```python\nlabel="$fake$"\n```\n後 $x$、$x$';
  assert.deepEqual(scanCandidates(source).map(x=>x.latex),['x','x']);
  assert.equal(groupedCandidates(source)[0].count,2);
});
test('inverse keeps registered and unknown PUA inside all code spans',()=>{
  const source='`\uE000\uE099`\r\n```python\r\n\uE000\uE099\r\n```\r\n本文 \uE000';
  const result=restorePUAParts(source,[{latex:'x',char:'\uE000',codepoint:'E000'}],
    [{from:0,to:source.length,textStyle:{fontPostScriptName:'Math'}}],'Math');
  assert.equal(result.mathCount,1);
  assert.equal(result.text,source.slice(0,-1)+'$x$');
});
test('inverse protects tail of an unclosed fence while restoring earlier math',()=>{
  const source='\uE000\n```python\n\uE099';
  const result=restorePUAParts(source,[{latex:'x',char:'\uE000'}],
    [{from:0,to:source.length,textStyle:{fontPostScriptName:'Math'}}],'Math');
  assert.equal(result.text,'$x$\n```python\n\uE099');
});

test('foreign-project guard ignores code PUA but blocks ordinary foreign math',()=>{
  const {preventForeignProjectReverse}=require('../photoshop/uxp-panel/font_identity_guard');
  const projects=[{font:{postscript_name:'Foreign'}}];
  const source='`\uE000` 本文';
  preventForeignProjectReverse(source,[{from:0,to:source.length,textStyle:{fontPostScriptName:'Foreign'}}],projects,'Selected');
  assert.throws(()=>preventForeignProjectReverse('本文 \uE000',
    [{from:0,to:4,textStyle:{fontPostScriptName:'Foreign'}}],projects,'Selected'),/異なる/);
});
