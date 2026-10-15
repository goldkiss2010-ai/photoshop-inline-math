/* Read-only diagnostics for Photoshop textKey write/readback discrepancies.
 * Never modifies PSD text, glyph mappings or font registrations.
 */
'use strict';
function counts(text){
  let cr=0,lf=0,pua=0;
  for(let i=0;i<text.length;i++){
    const cp=text.charCodeAt(i);
    if(cp===13)cr++;
    if(cp===10)lf++;
    if(cp>=0xE000&&cp<=0xF8FF)pua++;
  }
  return {cr,lf,pua};
}
function unicodeAt(text,i){
  if(i>=text.length)return '(末尾)';
  return 'U+'+text.charCodeAt(i).toString(16).toUpperCase().padStart(4,'0');
}
function describeTextMismatch(expected,actual){
  if(typeof expected!=='string'||typeof actual!=='string')
    throw Error('文字列の照合に必要な情報がありません。');
  let i=0;
  const min=Math.min(expected.length,actual.length);
  while(i<min&&expected[i]===actual[i])i++;
  const want=counts(expected),got=counts(actual);
  const parts=[
    '要求文字数='+expected.length+'、読み戻し文字数='+actual.length,
    '初めて異なる位置='+i+'（要求 '+unicodeAt(expected,i)+'、実際 '+unicodeAt(actual,i)+'）',
    'PUA文字数=要求'+want.pua+'／実際'+got.pua,
    '改行数(CR/LF)=要求'+want.cr+'/'+want.lf+
      '／実際'+got.cr+'/'+got.lf
  ];
  if(expected.length>32767||actual.length>32767)
    parts.push('注意: 32,767文字を超えるテキストレイヤーではPhotoshopの既知の長文不具合の可能性があります。');
  // Photoshop's Use Smart Quotes preference can silently turn an ASCII
  // straight quote into typographic punctuation during textKey assignment.
  // Never accept that mutation as a successful lossless conversion.
  if(i<min&&
     ((expected.charCodeAt(i)===0x22&&
       (actual.charCodeAt(i)===0x201C||actual.charCodeAt(i)===0x201D))||
      (expected.charCodeAt(i)===0x27&&
       (actual.charCodeAt(i)===0x2018||actual.charCodeAt(i)===0x2019))))
    parts.push('Photoshopの「スマート引用符を使用」による自動変換の可能性があります。'+
      '編集 → 環境設定 → テキスト で「スマート引用符を使用」をオフにして再実行してください。'+
      'Paper Mathは本文の文字を無断で変更せず、失敗時は元のレイヤーへ巻き戻します。');
  if(actual.replace(/\r\n?/g,'\n')===expected.replace(/\r\n?/g,'\n'))
    parts.push('改行表現だけが異なります。');
  return parts.join('\n');
}
module.exports={describeTextMismatch};
