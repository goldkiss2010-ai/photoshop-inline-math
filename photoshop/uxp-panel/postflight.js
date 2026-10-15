/* Verify Photoshop persisted the requested text and math-run font.
 * This is a read-only check; the caller rolls back the duplicated layer
 * before leaving the modal transaction if Photoshop silently substitutes.
 */
'use strict';
const {normalizeTextStyleRuns}=require('./safe_range_normalization');
const {describeTextMismatch}=require('./text_readback_diagnostic');

function verifyAppliedMathFonts(converted, actual, expectedPostScriptName) {
  if (!converted || !actual || typeof expectedPostScriptName !== 'string')
    throw Error('数式の検証情報が不正です。');
  if (actual.textKey !== converted.text)
    throw Error('Photoshopが変換後の文字列を保持していません。元レイヤーを残します。\n'+
      describeTextMismatch(converted.text,actual.textKey));
  if (!Array.isArray(actual.textStyleRange) || !actual.textStyleRange.length)
    throw Error('Photoshopの変換後の文字スタイルを取得できません。元レイヤーを残します。');
  // The readback may contain duplicate or overlapping runs even when its
  // rendered text is correct. Interpret the spans before inspecting PUA fonts.
  const ranges=normalizeTextStyleRuns(actual.textStyleRange,actual.textKey.length);
  const math=converted.segments.filter(x=>x.kind==='math');
  if (!math.length || math.length!==converted.mathCount)
    throw Error('数式の置換範囲が不正です。元レイヤーを残します。');
  for (const seg of math) {
    if (seg.to-seg.from!==1)
      throw Error('数式が一文字に変換されていません。元レイヤーを残します。');
    const cp=actual.textKey.charCodeAt(seg.from);
    if (cp<0xE000||cp>0xF8FF)
      throw Error('変換後の数式がPUA文字ではありません。元レイヤーを残します。');
    const owner=ranges.find(x=>x.from<=seg.from&&seg.from<x.to);
    if (!owner || !owner.textStyle)
      throw Error('変換後の数式の書式範囲が不正です。元レイヤーを残します。');
    const style=owner.textStyle;
    if (style.fontPostScriptName!==expectedPostScriptName ||
        style.fontAvailable===false) {
      const assigned=style.fontPostScriptName || '(不明)';
      throw Error('Photoshopが数式 U+'+cp.toString(16).toUpperCase().padStart(4,'0')+
        ' に '+assigned+' を割り当てました。必要なフォントは '+
        expectedPostScriptName+' です。元レイヤーは保持します。'+
        ' Photoshopのフォント一覧またはキャッシュを調べてください。');
    }
  }
  return {verifiedMathCount:math.length};
}

module.exports={verifyAppliedMathFonts};
