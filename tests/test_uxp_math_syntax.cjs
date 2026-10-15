'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {scanMath}=require('../photoshop/uxp-panel/math_syntax');
const {inlineParts,buildDescriptor}=require('../photoshop/uxp-panel/text_ranges');
const {scanCandidates,groupedCandidates,selectedInlineGroupParts}=
  require('../photoshop/uxp-panel/selected_inline');
const {restorePUAParts,buildRestoredDescriptor}=
  require('../photoshop/uxp-panel/restore_ranges');
const mathFont='InlineMathLab-Regular';
const entry={latex:'x^2',char:'\uE004',codepoint:'E004'};
function run(from,to,key,font='Body-Regular'){
  return {from,to,[key]:key==='textStyle'?
    {fontPostScriptName:font,fontAvailable:true,size:{_unit:'pointsUnit',_value:14}}:
    {align:'left'}};
}
function desc(source,breaks=[]){
  const parts=[0,...breaks,source.length+1];
  const para=parts.slice(1).map((p,i)=>run(parts[i],p,'paragraphStyle'));
  return {textKey:source,textStyleRange:[run(0,source.length+1,'textStyle')],
          paragraphStyleRange:para};
}
test('four mixed formats parse and map to a single PUA identity',()=>{
  const source='前 $x^2$ と \\(x^2\\) と $$x^2$$ と \\[x^2\\] 後';
  const list=scanMath(source);
  assert.deepEqual(list.map(x=>x.latex),['x^2','x^2','x^2','x^2']);
  assert.deepEqual(list.map(x=>x.mode),['inline','inline','display','display']);
  assert.deepEqual(list.map(x=>x.notation),
    ['dollars-inline','paren','dollars-display','bracket']);
  assert.equal(inlineParts(source,[entry]).text,
     '前 \uE004 と \uE004 と \uE004 と \uE004 後');
  assert.equal(groupedCandidates(source).length,1);
  assert.equal(groupedCandidates(source)[0].count,4);
});
test('optional formula selector converts all notations for same latex',()=>{
  const source='前 $x^2$ / $$x^2$$ / \\(x^2\\) / $y$';
  const chosen=groupedCandidates(source)[0];
  const p=selectedInlineGroupParts(source,[entry],chosen);
  assert.equal(p.mathCount,3);
  assert.equal(p.text,'前 \uE004 / \uE004 / \uE004 / $y$');
  assert.deepEqual(p.segments.filter(s=>s.kind==='math').map(s=>s.mode),
    ['inline','display','inline']);
});
test('Quarto multiline display reduces internal CRs, preserves external paragraphs',()=>{
  const source='前\r$$\r x^2 \r$$\r後 $x^2$';
  const parsed=scanCandidates(source);
  assert.equal(parsed.length,2);
  assert.equal(parsed[0].latex,'x^2');
  const p=inlineParts(source,[entry]);
  assert.equal(p.text,'前\r\uE004\r後 \uE004');
  assert.equal((p.text.match(/\r/g)||[]).length,2);
  const begin=source.indexOf('$$'),end=source.indexOf('$$',begin+2)+2;
  const before=desc(source,[begin+4,end-2]);
  const projected=buildDescriptor(before,p);
  assert.equal(projected.textKey,p.text);
  assert.equal(projected.paragraphStyleRange.at(-1).to,p.text.length+1);
});
test('equation environment shares PUA; align has math-mode wrapper',()=>{
  const source='\\begin{equation} x^2 \\end{equation} と \\begin{align}a&=b\\\\c&=d\\end{align}';
  const parsed=scanMath(source);
  assert.equal(parsed.length,2);
  assert.equal(parsed[0].latex,'x^2');
  assert.match(parsed[1].latex,/^\\begin\{aligned\}/);
  assert.match(parsed[1].latex,/\\end\{aligned\}$/);
  assert.equal(parsed[1].latex.includes('\n'),false);
  const p=inlineParts(source,[entry,{latex:parsed[1].latex,char:'\uE005'}]);
  assert.equal(p.mathCount,2);
  assert.equal(p.text,'\uE004 と \uE005');
});
test('restoration canonicalizes source delimiter',()=>{
  const source='前 $$x^2$$ 後';
  const forward=inlineParts(source,[entry]);
  const descriptor=buildDescriptor(desc(source),forward);
  const restored=restorePUAParts(forward.text,[entry],descriptor.textStyleRange,mathFont);
  assert.equal(restored.text,'前 $x^2$ 後');
  assert.equal(restored.mathCount,1);
  const reverse=buildRestoredDescriptor(descriptor,restored);
  assert.equal(reverse.textKey,restored.text);
  assert.equal(reverse.textStyleRange.at(-1).to,reverse.textKey.length+1);
});
test('TeX comments inside math block are rejected before folding newlines',()=>{
  assert.throws(()=>scanMath('$$ x % comment\n y $$'),/行コメント/);
  assert.equal(scanMath('$20\\%$')[0].latex,'20\\%');
});
test('QMD fenced code, including Python and R, is ignored',()=>{
  const src='本文 $x$'+'\r'+'\x60\x60\x60{python}\rprint("$not_math$")\r\x60\x60\x60\r'+
    '$$E=mc^2$$\r~~~{r}\rtext <- "$fake$"\r~~~\r'+'終了 \\(y\\)';
  const got=scanMath(src);
  assert.deepEqual(got.map(x=>x.latex),['x','E=mc^2','y']);
  assert.deepEqual(got.map(x=>x.mode),['inline','display','inline']);
});
test('unclosed fenced source excludes its remaining pseudo equations',()=>{
  const got=scanMath('本文 $x$\r\x60\x60\x60{python}\rprint("$bad$")');
  assert.deepEqual(got.map(x=>x.latex),['x']);
});
test('unclosed math, unregistered formula, emoji block conversion',()=>{
  assert.throws(()=>scanMath('$$x'),/閉じ記号/);
  assert.throws(()=>inlineParts('\\[not-registered\\]',[entry]),/登録簿にない/);
  assert.throws(()=>scanMath('😀 $x^2$'),/BMP外Unicode/);
});

test('math and displaymath environments are equivalent to standard delimiters',()=>{
  const src='\\begin{math}x^2\\end{math} / \\begin{displaymath}x^2\\end{displaymath}';
  const found=scanMath(src);
  assert.equal(found.length,2);
  assert.deepEqual(found.map(x=>x.latex),['x^2','x^2']);
  assert.deepEqual(found.map(x=>x.mode),['inline','display']);
});
