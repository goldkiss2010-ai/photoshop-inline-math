/*
 * Project Photoshop textStyleRange / paragraphStyleRange through $...$ -> PUA.
 * Offsets are UTF-16 indices, matching Photoshop batchPlay text ranges.
 * This module is pure: errors occur before a document is modified.
 */
'use strict';
const {normalizeExactDuplicateRuns}=require('./safe_range_normalization');
const {scanMath}=require('./math_syntax');

const FONT_PS_NAME = 'InlineMathLab-Regular';
const FONT_FAMILY = 'Inline Math Lab';
function fail(message) { throw new Error(message); }

function inlineParts(source, entries) {
  const matches=scanMath(source);
  const table=new Map(entries.map(e=>[e.latex,e.char]));
  if(!matches.length)fail('数式がありません（$...$, $$...$$, \\(...\\), \\[...\\]）。');
  let text='',cursor=0;
  const segments=[];
  function append(value,kind,start,end,anchor,mode,notation){
    if(!value)return;
    const from=text.length;
    text+=value;
    const item={kind,sourceFrom:start,sourceTo:end,from,to:text.length,
      styleAnchor:anchor===undefined?start:anchor};
    if(kind==='math'){item.mode=mode;item.notation=notation;}
    segments.push(item);
  }
  for(const match of matches){
    append(source.slice(cursor,match.from),'body',cursor,match.from,cursor);
    if(!table.has(match.latex))
      fail('登録簿にない数式: '+match.latex);
    const pua=table.get(match.latex);
    if(typeof pua!=='string'||pua.length!==1)
      fail('数式PUAの登録内容が不正です。');
    append(pua,'math',match.from,match.to,match.styleAnchor,
      match.mode,match.notation);
    cursor=match.to;
  }
  append(source.slice(cursor),'body',cursor,source.length,cursor);
  return {text,segments,mathCount:matches.length};
}

function checkRanges(ranges, property, sourceLength) {
  if (!Array.isArray(ranges) || ranges.length === 0)
    fail(property + 'が取得できません。');
  let end = 0;
  for (const r of ranges) {
    if (!r || !Number.isInteger(r.from) || !Number.isInteger(r.to) ||
        r.from !== end || r.to <= r.from || !r[property]) {
      fail(property + 'の文字範囲が不連続、または不正です。');
    }
    end = r.to;
  }
  const tail = end - sourceLength;
  if (tail !== 0 && tail !== 1) fail(property + 'の終端位置が想定と異なります。');
  return tail;
}

function rangeAt(ranges, offset) {
  const found = ranges.find(r => r.from <= offset && offset < r.to);
  if (!found) fail('元の文字位置に対応する書式がありません: ' + offset);
  return found;
}

function withStyle(item, property, from, to, isMath, domSize, font) {
  const style = { ...item[property], _obj: property };
  if (isMath && property === 'textStyle') {
    const size = style.size || style.impliedFontSize ||
      (style.baseParentStyle && (style.baseParentStyle.size ||
        style.baseParentStyle.impliedFontSize)) || domSize;
    if (!size) fail('数式位置の文字サイズを取得できません。');
    if (!style.size) style.size = size;
    style.fontPostScriptName = font.postscript_name;
    style.fontName = font.family;
    style.fontStyleName = 'Regular';
    // A reused body text style may carry an unavailable-font flag.
    // Explicitly mark the selected installed font as available; the
    // postflight readback is still the authority on whether Photoshop
    // actually kept this assignment.
    style.fontAvailable = true;
    style.syntheticItalic = false;
    style.syntheticBold = false;
  }
  return { ...item, _obj: property + 'Range', from, to, [property]: style };
}

function projectRanges(ranges, property, converted, sourceLength, domSize, font) {
  const tail = checkRanges(ranges, property, sourceLength);
  const projected = [];
  const append = (item, from, to, isMath) => {
    if (from >= to) fail('変換後の文字範囲が不正です。');
    projected.push(withStyle(item, property, from, to, isMath, domSize, font));
  };
  for (const seg of converted.segments) {
    if (seg.kind === 'math') {
      const owner = rangeAt(ranges, seg.styleAnchor);
      // Math is atomic. Use the style of the first non-whitespace TeX character.
      // A formula may contain multiple *character* styles; its result cannot.
      // A display expression deliberately collapses internal line breaks
      // into one glyph. The remaining surrounding paragraph boundaries are
      // retained as body characters. Inline math remains paragraph-local.
      if (property === 'paragraphStyle' && owner.to < seg.sourceTo &&
          seg.mode !== 'display') {
        fail('数式が複数の段落スタイルをまたいでいます。段落ごとに数式を分けてください。');
      }
      append(owner, seg.from, seg.to, true);
    } else {
      let original = seg.sourceFrom;
      while (original < seg.sourceTo) {
        const owner = rangeAt(ranges, original);
        const next = Math.min(owner.to, seg.sourceTo);
        append(owner, seg.from + (original - seg.sourceFrom),
               seg.from + (next - seg.sourceFrom), false);
        original = next;
      }
    }
  }
  if (tail === 1) {
    const terminal = rangeAt(ranges, sourceLength);
    append(terminal, converted.text.length, converted.text.length + 1, false);
  }
  let end = 0;
  for (const item of projected) {
    if (item.from !== end || item.to <= item.from) fail('変換後のスタイル範囲が連続していません。');
    end = item.to;
  }
  if (end !== converted.text.length + tail)
    fail('変換後のスタイル範囲が本文と一致しません。');
  return projected;
}

function buildDescriptor(original, converted, domSize, font = {postscript_name:FONT_PS_NAME,family:FONT_FAMILY}) {
  if(!font||typeof font.postscript_name!=='string'||!font.postscript_name||
     typeof font.family!=='string'||!font.family)
    fail('変換先の数式フォントが不正です。');
  const source = original.textKey;
  if (typeof source !== 'string' || typeof converted.text !== 'string' ||
      !Array.isArray(converted.segments)) fail('テキスト情報の形式が正しくありません。');
  const sourceTextRuns=normalizeExactDuplicateRuns(original.textStyleRange,'textStyle',source.length);
  const sourceParagraphRuns=normalizeExactDuplicateRuns(original.paragraphStyleRange,'paragraphStyle',source.length);
  const textStyleRange = projectRanges(sourceTextRuns,
    'textStyle', converted, source.length, domSize, font);
  const paragraphStyleRange = projectRanges(sourceParagraphRuns,
    'paragraphStyle', converted, source.length, domSize, font);
  return { ...original, _obj: 'textLayer', textKey: converted.text,
           textStyleRange, paragraphStyleRange };
}

module.exports = { FONT_PS_NAME, FONT_FAMILY, inlineParts, buildDescriptor };
