'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {preventForeignProjectReverse}=
  require('../photoshop/uxp-panel/font_identity_guard');
const target='PaperMathaaaaaaaaaaaaaaaa-Regular';
const foreign='PaperMathbbbbbbbbbbbbbbbb-Regular';
const legacy='InlineMathLab-Regular';
const projects=[{project_id:'pm-aaaaaaaaaaaaaaaa',font:{postscript_name:target}},
  {project_id:'pm-bbbbbbbbbbbbbbbb',font:{postscript_name:foreign}}];
const r=(from,to,font)=>({from,to,textStyle:{fontPostScriptName:font}});

test('legacy cannot claim codepoints visibly assigned to a managed project font',()=>{
 const text='A\uE000B';
 const ranges=[r(0,3,legacy),r(1,2,target)];
 assert.throws(()=>preventForeignProjectReverse(text,ranges,projects,legacy),
               /異なるPaper Mathフォント/);
});

test('own managed font can reverse only its own assigned glyph',()=>{
 const text='A\uE000B';
 preventForeignProjectReverse(text,[r(0,3,target)],projects,target);
 assert.throws(()=>preventForeignProjectReverse(text,[r(0,3,foreign)],
          projects,target),/異なるPaper Mathフォント/);
});

test('normal non-PUA body letters are not rejected for foreign fonts',()=>{
 preventForeignProjectReverse('通常の本文', [r(0,5,foreign)],projects,target);
});

test('legacy user-edited body font remains permitted, as before',()=>{
 const text='A\uE000B';
 preventForeignProjectReverse(text,[r(0,3,'KozGoPr6N-Regular')],projects,legacy);
});

test('Photoshop overlapping textStyle ranges are normalized before identity guard',()=>{
 const text='A\uE000B';
 preventForeignProjectReverse(text,[r(0,3,foreign),r(0,3,target)],
                              projects,target);
 assert.throws(()=>preventForeignProjectReverse(text,
   [r(0,3,target),r(0,3,foreign)],projects,target),/異なる/);
});
