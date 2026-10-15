/* Prevent known Paper Math project glyphs from being reverse-mapped with
 * the old legacy registry simply because legacy allows font-edited PUA.
 */
'use strict';
const {normalizeTextStyleRuns}=require('./safe_range_normalization');
const {scanMathPlan}=require('./math_scan_plan');
function preventForeignProjectReverse(source,ranges,projects,selectedPostScriptName){
  if(typeof source!=='string'||!Array.isArray(projects)||
     !selectedPostScriptName)throw Error('フォント識別の情報がありません。');
  const otherFonts=new Set(projects.filter(x=>x&&x.font&&
    typeof x.font.postscript_name==='string'&&
    x.font.postscript_name!==selectedPostScriptName)
    .map(x=>x.font.postscript_name));
  if(!otherFonts.size)return;
  const runList=normalizeTextStyleRuns(ranges,source.length);
  const protectedSpans=scanMathPlan(source).protected;
  let protectedIndex=0;
  for(let i=0;i<source.length;i++){
    while(protectedIndex<protectedSpans.length&&protectedSpans[protectedIndex].to<=i)protectedIndex++;
    const code=protectedSpans[protectedIndex];
    if(code&&code.from<=i&&i<code.to)continue;
    const cp=source.charCodeAt(i);
    if(cp<0xE000||cp>0xF8FF)continue;
    const owner=runList.find(x=>x.from<=i&&i<x.to);
    if(owner&&owner.textStyle&&otherFonts.has(owner.textStyle.fontPostScriptName))
      throw Error('異なるPaper MathフォントのPUAを検出しました（文字位置 '+i+
        '）。該当フォントに切り替えてからLaTeXへ戻してください。');
  }
}
module.exports={preventForeignProjectReverse};
