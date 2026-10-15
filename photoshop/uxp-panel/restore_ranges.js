/*
 * Pure Photoshop text restoration: registered PUA -> $LaTeX$.
 * Mirrors the forward text_ranges.js segments, with no document/API writes.
 * Offsets are UTF-16, as in Photoshop batchPlay.
 */
'use strict';
const {normalizeExactDuplicateRuns}=require('./safe_range_normalization');

const {scanMathPlan}=require('./math_scan_plan');

const PUA_MIN = 0xE000, PUA_MAX = 0xF8FF;
function fail(message) { throw new Error(message); }
function isPUA(ch) {
  const code = ch.charCodeAt(0);
  return code >= PUA_MIN && code <= PUA_MAX;
}
function checkRanges(ranges, key, sourceLength) {
  if (!Array.isArray(ranges) || !ranges.length) fail(key + 'が取得できません。');
  let end = 0;
  for (const r of ranges) {
    if (!r || !Number.isInteger(r.from) || !Number.isInteger(r.to) ||
        r.from !== end || r.to <= end || !r[key] || typeof r[key] !== 'object') {
      fail(key + 'の文字範囲が不連続、または不正です。');
    }
    end = r.to;
  }
  const tail = end - sourceLength;
  if (tail !== 0 && tail !== 1) fail(key + 'の終端位置が想定と異なります。');
  return tail;
}
function rangeAt(ranges, offset) {
  const r = ranges.find(x => x.from <= offset && offset < x.to);
  if (!r) fail('元の文字位置に対応する書式がありません: ' + offset);
  return r;
}

function restorePUAParts(source, entries, textStyleRanges, expectedPostScriptName,
                         {allowFontMismatch=false} = {}) {
  if (typeof source !== 'string' || /[\uD800-\uDFFF]/.test(source)) {
    fail('サロゲートペアを含むテキストは未対応です。');
  }
  if (typeof expectedPostScriptName !== 'string' || !expectedPostScriptName.trim()) {
    fail('復元対象のPostScript名がありません。');
  }
  const normalizedTextRuns=normalizeExactDuplicateRuns(textStyleRanges,'textStyle',source.length);
  if (!Array.isArray(entries)) fail('PUA対応表がありません。');
  const mapping = new Map();
  const latexSeen = new Set();
  for (const e of entries) {
    if (!e || typeof e.char !== 'string' || e.char.length !== 1 ||
        !isPUA(e.char) || typeof e.latex !== 'string' || !e.latex.trim()) {
      fail('PUA対応表に不正な項目があります。');
    }
    if (e.codepoint !== undefined &&
        (!/^[0-9a-fA-F]{4}$/.test(e.codepoint) ||
         parseInt(e.codepoint, 16) !== e.char.charCodeAt(0))) {
      fail('PUA対応表の文字コードが一致しません。');
    }
    if (mapping.has(e.char) || latexSeen.has(e.latex)) {
      fail('PUA対応表に重複があります。');
    }
    mapping.set(e.char, e.latex);
    latexSeen.add(e.latex);
  }
  const protectedSpans=scanMathPlan(source).protected;
  let protectedIndex=0;
  const segments = [];
  let text = '', mathCount = 0, fontMismatchCount = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    while(protectedIndex<protectedSpans.length&&protectedSpans[protectedIndex].to<=i)protectedIndex++;
    const code=protectedSpans[protectedIndex];
    const isMath = isPUA(ch)&&!(code&&code.from<=i&&i<code.to);
    let value = ch;
    if (isMath) {
      const formula = mapping.get(ch);
      if (formula === undefined) {
        fail('未登録のPUA文字があります: U+' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
      }
      if (/[\r\n]/.test(formula)) {
        fail('登録LaTeXに改行が含まれるため自動復元できません。');
      }
      const style = rangeAt(normalizedTextRuns, i).textStyle;
      if (style.fontPostScriptName !== expectedPostScriptName || style.fontAvailable === false) {
        if(!allowFontMismatch)
          fail('数式PUAのフォントが一致しません: 文字位置 ' + i);
        // Deliberately initiated restoration of a registered PUA codepoint
        // can survive a font edit/paste. It may also match another project's
        // PUA; the UI must report this reduced identity assurance.
        fontMismatchCount++;
      }
      value = '$' + formula + '$';
      mathCount++;
    }
    const from = text.length;
    text += value;
    const previous = segments[segments.length - 1];
    if (!isMath && previous && previous.kind === 'body' && previous.sourceTo === i) {
      previous.sourceTo = i + 1;
      previous.to = text.length;
    } else {
      segments.push({kind: isMath ? 'math' : 'body', sourceFrom: i, sourceTo: i + 1,
                     from, to: text.length, styleAnchor: i});
    }
  }
  if (!mathCount) fail('復元対象の数式PUAがありません。');
  return {text, segments, mathCount, expectedPostScriptName,fontMismatchCount};
}

function adjacentBodyStyle(original, offset, expectedPostScriptName, fallbackTextStyle) {
  const source = original.textKey;
  let begin = offset, end = offset + 1;
  while (begin > 0 && !/[\r\n]/.test(source[begin - 1])) begin--;
  while (end < source.length && !/[\r\n]/.test(source[end])) end++;
  function compatible(pos) {
    const char = source[pos];
    if (!char || isPUA(char) || /\s/.test(char)) return null;
    const style = rangeAt(original.textStyleRange, pos).textStyle;
    if (!style.fontPostScriptName || style.fontPostScriptName === expectedPostScriptName ||
        style.fontAvailable === false) return null;
    return style;
  }
  for (let i = offset - 1; i >= begin; i--) {
    const style = compatible(i);
    if (style) return style;
  }
  for (let i = offset + 1; i < end; i++) {
    const style = compatible(i);
    if (style) return style;
  }
  if (fallbackTextStyle && typeof fallbackTextStyle.fontPostScriptName === 'string' &&
      fallbackTextStyle.fontPostScriptName &&
      fallbackTextStyle.fontPostScriptName !== expectedPostScriptName &&
      fallbackTextStyle.fontAvailable !== false) return fallbackTextStyle;
  // A display formula often occupies a paragraph by itself after
  // $...$ -> one PUA. Its old body font cannot be read from this paragraph.
  // Safely infer a replacement style from the nearest actual body character
  // in another paragraph. Never use a PUA, whitespace or unavailable font.
  // This is not an exact recovery of the original TeX font styling.
  const leftDistance = begin;
  const rightDistance = source.length - end;
  for (let distance = 0; distance < Math.max(leftDistance,rightDistance); distance++) {
    if (distance < leftDistance) {
      const style = compatible(begin - distance - 1);
      if (style) return style;
    }
    if (distance < rightDistance) {
      const style = compatible(end + distance);
      if (style) return style;
    }
  }
  fail('本文用フォントが文書内にありません。数式だけのレイヤーは復元用フォントの指定が必要です。');
}

function buildRestoredDescriptor(original, restored, {fallbackTextStyle = null} = {}) {
  if (!original || typeof original.textKey !== 'string' ||
      !restored || typeof restored.text !== 'string' ||
      !Array.isArray(restored.segments) || !restored.mathCount ||
      !restored.expectedPostScriptName) fail('復元用テキスト情報が不正です。');
  const source = original.textKey;
  // Project the editing-friendly canonical character style runs. Paragraph
  // structure remains strict. Neither the original descriptor nor the PSD
  // is changed during this preparation phase.
  const normalizedOriginal={
    ...original,
    textStyleRange:normalizeExactDuplicateRuns(original.textStyleRange,'textStyle',source.length),
    paragraphStyleRange:normalizeExactDuplicateRuns(original.paragraphStyleRange,'paragraphStyle',source.length)
  };
  const textTail = checkRanges(normalizedOriginal.textStyleRange, 'textStyle', source.length);
  const paraTail = checkRanges(normalizedOriginal.paragraphStyleRange, 'paragraphStyle', source.length);
  const project = (ranges, property, tail) => {
    const out = [];
    const append = (owner, from, to, styleOverride) => {
      if (from >= to) fail('復元後のスタイル範囲が不正です。');
      const style = styleOverride || owner[property];
      out.push({...owner, _obj: property + 'Range', from, to,
                [property]: {...style, _obj: property}});
    };
    for (const seg of restored.segments) {
      if (seg.kind === 'math') {
        const owner = rangeAt(ranges, seg.sourceFrom);
        const style = property === 'textStyle'
          ? adjacentBodyStyle(normalizedOriginal, seg.sourceFrom, restored.expectedPostScriptName,
                              fallbackTextStyle)
          : null;
        append(owner, seg.from, seg.to, style);
      } else if (seg.kind === 'body') {
        let offset = seg.sourceFrom;
        while (offset < seg.sourceTo) {
          const owner = rangeAt(ranges, offset);
          const next = Math.min(owner.to, seg.sourceTo);
          append(owner, seg.from + offset - seg.sourceFrom,
                       seg.from + next - seg.sourceFrom);
          offset = next;
        }
      } else fail('不明な復元セグメントです。');
    }
    if (tail === 1) append(rangeAt(ranges, source.length), restored.text.length, restored.text.length + 1);
    let end = 0;
    for (const r of out) {
      if (r.from !== end || r.to <= end) fail('復元後のスタイル範囲が不連続です。');
      end = r.to;
    }
    if (end !== restored.text.length + tail) fail('復元後のスタイル範囲が本文と一致しません。');
    return out;
  };
  const textStyleRange = project(normalizedOriginal.textStyleRange, 'textStyle', textTail);
  const paragraphStyleRange = project(normalizedOriginal.paragraphStyleRange, 'paragraphStyle', paraTail);
  return {...original, _obj: 'textLayer', textKey: restored.text,
          textStyleRange, paragraphStyleRange};
}

module.exports = {restorePUAParts, buildRestoredDescriptor};
