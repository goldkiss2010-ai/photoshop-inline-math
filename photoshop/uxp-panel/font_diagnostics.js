/* Read-only comparison of Photoshop text descriptors around PUA math glyphs.
 * Never serializes the actual text of the selected layer.
 */
'use strict';

const PUA_START = 0xE000;
const PUA_END = 0xF8FF;
const MAX_CHANGES = 80;

function safeClone(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(safeClone);
  const obj = {};
  for (const k of Object.keys(value).sort()) {
    if (k === 'textKey' || k === 'contents') continue;
    obj[k] = safeClone(value[k]);
  }
  return obj;
}

function rangeAt(ranges, pos, kind) {
  if (!Array.isArray(ranges)) throw new Error(kind + 'の範囲が見つかりません。');
  const found = ranges.find(item => item && item.from <= pos && pos < item.to);
  if (!found || !found[kind]) throw new Error(kind + 'が位置 ' + pos + ' に見つかりません。');
  return found[kind];
}

function captureMathStyle(descriptor) {
  if (!descriptor || typeof descriptor.textKey !== 'string')
    throw new Error('テキストレイヤーを選択してください。');
  const text = descriptor.textKey;
  const positions = [];
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    if (cp >= PUA_START && cp <= PUA_END)
      positions.push({ position: i, codepoint: 'U+' + cp.toString(16).toUpperCase() });
  }
  if (!positions.length) throw new Error('このレイヤーには数式用のPUA文字がありません。');
  return {
    length: text.length,
    glyphs: positions.map(({ position, codepoint }) => ({
      position, codepoint,
      style: safeClone(rangeAt(descriptor.textStyleRange, position, 'textStyle')),
      paragraph: safeClone(rangeAt(descriptor.paragraphStyleRange, position, 'paragraphStyle')),
      preceding: position > 0 ?
        safeClone(rangeAt(descriptor.textStyleRange, position - 1, 'textStyle')) : null,
      following: position + 1 < text.length ?
        safeClone(rangeAt(descriptor.textStyleRange, position + 1, 'textStyle')) : null,
    })),
    textShape: safeClone(descriptor.textShape || null),
    paragraphShape: safeClone(descriptor.paragraphStyleRange?.map(({ from, to }) => ({ from, to })) || null),
  };
}

function flattenDiff(before, after, prefix, out) {
  if (out.length >= MAX_CHANGES) return;
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const objectLike = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (objectLike(before) && objectLike(after)) {
    const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const name of names)
      flattenDiff(before[name], after[name], prefix ? prefix + '.' + name : name, out);
    return;
  }
  const fmt = value => value === undefined ? '（属性なし）' : JSON.stringify(value);
  out.push(prefix + ': ' + fmt(before) + ' → ' + fmt(after));
}

function compareMathStyle(before, after) {
  if (!before || !after || !Array.isArray(before.glyphs) || !Array.isArray(after.glyphs))
    throw new Error('比較データが不正です。');
  if (before.length !== after.length || before.glyphs.length !== after.glyphs.length)
    throw new Error('本文の長さまたは数式の個数が変わりました。もう一度記録してください。');
  const changes = [];
  for (let i = 0; i < before.glyphs.length; i++) {
    const a = before.glyphs[i], b = after.glyphs[i];
    if (a.position !== b.position || a.codepoint !== b.codepoint)
      throw new Error('数式文字が変更されました。もう一度記録してください。');
    const label = a.codepoint + ' (位置' + a.position + ')';
    flattenDiff(a.style, b.style, label + '.数式文字属性', changes);
    flattenDiff(a.paragraph, b.paragraph, label + '.段落属性', changes);
    flattenDiff(a.preceding, b.preceding, label + '.直前文字属性', changes);
    flattenDiff(a.following, b.following, label + '.直後文字属性', changes);
  }
  flattenDiff(before.textShape, after.textShape, '文字枠', changes);
  flattenDiff(before.paragraphShape, after.paragraphShape, '段落範囲', changes);
  if (!changes.length)
    return '文字スタイルの差分は見つかりませんでした。Photoshop内部のフォントキャッシュや組版再評価の可能性があります。';
  const truncated = changes.length >= MAX_CHANGES;
  return changes.join('\n') + (truncated ? '\n（差分は最大80件まで表示）' : '');
}

module.exports = { captureMathStyle, compareMathStyle };
