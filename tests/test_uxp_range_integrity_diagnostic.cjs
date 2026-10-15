'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {auditRangeTopology,auditTextDescriptors}=
  require('../photoshop/uxp-panel/range_integrity_diagnostic');
function r(from,to,key='textStyle'){return {from,to,[key]:{fontPostScriptName:'Body-Regular'}};}

test('normal Photoshop terminal +1 and exact N ranges are valid',()=>{
  const a=auditRangeTopology([r(0,3),r(3,11)],'textStyle',10);
  assert.equal(a.status,'ok');
  assert.equal(a.tail,1);
  assert.equal(a.issueCount,0);
  const b=auditRangeTopology([r(0,10)],'textStyle',10);
  assert.equal(b.status,'ok');
  assert.equal(b.tail,0);
});
test('detects zero-width formatting runs produced after edits',()=>{
  const a=auditRangeTopology([r(0,4),r(4,4),r(4,9)],'textStyle',9);
  assert.equal(a.issueCounts.empty,1);
  assert.equal(a.issues[0].rangeIndex,1);
  assert.equal(a.issueCounts.gap,0);
});
test('reports gaps and overlaps without attempting to repair them',()=>{
  const a=auditRangeTopology([r(0,4),r(6,8),r(7,10)],'textStyle',10);
  assert.equal(a.status,'invalid');
  assert.equal(a.issueCounts.gap,1);
  assert.equal(a.issueCounts.overlap,1);
  assert.deepEqual(a.issues.map(x=>x.delta),[2,-1]);
});
test('detects out-of-range terminal, missing style and corrupt runs',()=>{
  const a=auditRangeTopology([r(0,8),{from:8,to:11}], 'textStyle',8);
  assert.equal(a.issueCounts.tail,1);
  assert.equal(a.issueCounts.missingStyle,1);
  const b=auditRangeTopology([r(0,8),{from:'x',to:9}], 'textStyle',8);
  assert.equal(b.issueCounts.invalid,1);
});
test('diagnostic includes no actual Japanese source text or formulas',()=>{
  const text='機密情報 $x_i^2$\r姓名\r後';
  const d={textKey:text,textStyleRange:[r(0,text.length+1)],
    paragraphStyleRange:[r(0,text.length+1,'paragraphStyle')]};
  const report=auditTextDescriptors(d);
  assert.equal(report.status,'ok');
  const json=JSON.stringify(report);
  assert.equal(json.includes('機密'),false);
  assert.equal(json.includes('姓名'),false);
  assert.equal(json.includes('$x_i'),false);
});
test('both character and paragraph ranges are checked independently',()=>{
  const d={textKey:'ABC\rDEF',
    textStyleRange:[r(0,7)],
    paragraphStyleRange:[
      r(0,4,'paragraphStyle'),r(5,7,'paragraphStyle')
    ]};
  const report=auditTextDescriptors(d);
  assert.equal(report.status,'invalid');
  assert.equal(report.textStyleRange.status,'ok');
  assert.equal(report.paragraphStyleRange.issueCounts.gap,1);
});


test('diagnostic distinguishes exact duplicates and tolerated inherited-parent differences',()=>{
  const first={from:0,to:26,_obj:'textStyleRange',
    textStyle:{fontPostScriptName:'BIZUDPGothic-Bold',size:16,
      baseParentStyle:{fontPostScriptName:'Parent-A'}}};
  const inheritedOnly={...first,textStyle:{...first.textStyle,
    baseParentStyle:{fontPostScriptName:'Parent-B'}}};
  const exact={...first,textStyle:{...first.textStyle}};
  const d=auditRangeTopology([first,inheritedOnly,exact],'textStyle',26);
  assert.equal(d.issueCounts.overlap,2);
  assert.equal(d.issues[0].sameAllProperties,false);
  assert.equal(d.issues[0].safeToDeduplicate,false);
  assert.equal(d.issues[0].baseParentOnlyDifference,true);
  assert.equal(d.issues[0].acceptedByNormalization,true);
  assert.equal(d.issues[1].sameAllProperties,false);
  assert.equal(d.issues[1].acceptedByNormalization,true);
});

test('diagnostic records direct-style conflict but accepts last-declared-wins interpretation',()=>{
  const a=r(0,10);
  const b={...a,textStyle:{fontPostScriptName:'NotSame',baseParentStyle:{}}};
  const d=auditRangeTopology([a,b],'textStyle',10);
  assert.equal(d.issues[0].acceptedByNormalization,true);
  assert.equal(d.normalization.status,'accepted');
  assert.equal(d.normalization.policy,'last-declared-wins');
});

test('audit keeps raw overlap signal separate from normalized usable style coverage',()=>{
 const a=r(0,5),b={from:3,to:10,textStyle:{fontPostScriptName:'Other-Regular'}};
 const d=auditRangeTopology([a,b],'textStyle',10);
 assert.equal(d.status,'invalid');
 assert.equal(d.issueCounts.overlap,1);
 assert.equal(d.normalization.status,'accepted');
 assert.equal(d.normalization.outputRangeCount,2);
 const missing=auditRangeTopology([r(0,5),r(6,10)],'textStyle',10);
 assert.equal(missing.normalization.status,'blocked');
});
