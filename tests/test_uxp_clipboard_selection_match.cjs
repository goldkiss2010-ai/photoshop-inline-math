'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {matchCopiedText}=require('../photoshop/uxp-panel/clipboard_selection_match');

test('identifies unique complete inline formula and preserves UTF-16 indices',()=>{
  const text='本文 $x_i^2$ と $\\alpha+\\beta$ を比較。';
  const result=matchCopiedText(text,'$x_i^2$');
  assert.deepEqual(result,{
    status:'unique',clipboardLength:7,occurrenceCount:1,
    occurrences:[{from:3,to:10,wholeInlineFormula:true}]
  });
});

test('reports repeated copied expressions as ambiguous without choosing one',()=>{
  const text='前 $x_i^2$、後 $x_i^2$';
  const result=matchCopiedText(text,'$x_i^2$');
  assert.equal(result.status,'ambiguous');
  assert.equal(result.occurrenceCount,2);
  assert.equal(result.occurrences.every(x=>x.wholeInlineFormula),true);
  assert.notEqual(result.occurrences[0].from,result.occurrences[1].from);
});

test('recognizes partial selection and absent clipboard text',()=>{
  const text='値 $x_i^2$';
  const partial=matchCopiedText(text,'x_i');
  assert.equal(partial.status,'unique');
  assert.equal(partial.occurrences[0].wholeInlineFormula,false);
  assert.equal(matchCopiedText(text,'unrelated').status,'not-in-layer');
  assert.throws(()=>matchCopiedText(text,''),/クリップボード/);
});

test('read-only result never includes source/clipboard content',()=>{
  const source='非公開資料 $x_i^2$';
  const result=matchCopiedText(source,'$x_i^2$');
  assert.equal(JSON.stringify(result).includes('非公開'),false);
  assert.equal(JSON.stringify(result).includes('x_i'),false);
});
