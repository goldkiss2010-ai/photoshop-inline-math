/* Mixed Quarto/Markdown/LaTeX math delimiter scanner.
 * Does not parse general TeX macro syntax. UTF-16 offsets are Photoshop's
 * range offsets; non-BMP characters are rejected before range projection.
 * Same formula body across inline/display delimiters shares a registry key.
 */
'use strict';
const ENV=/^\\begin\{(math|displaymath|equation\*?|align\*?|gather\*?|multline\*?)\}/;
function fail(message){throw Error(message);}
function escaped(text,pos){
  let n=0;
  while(pos-n-1>=0&&text[pos-n-1]==='\\')n++;
  return n%2===1;
}
// QMD fenced source code is not typeset mathematical content. Skip entire
// triple-backtick/tilde fences (including their delimiters), preserving offsets.
function fencedSpans(source){
  const spans=[];
  const lines=source.split(/(\r\n|\r|\n)/);
  let offset=0,begin=-1,character=null,count=0;
  for(let k=0;k<lines.length;k+=2){
    const line=lines[k],eol=lines[k+1]||'';
    const trimmed=line.replace(/^ {0,3}/,'');
    const prefix=line.length-trimmed.length;
    if(begin<0){
      if(prefix<=3){
        const opening=/^(\x60{3,}|~{3,})/.exec(trimmed);
        if(opening){
          begin=offset;character=opening[1][0];count=opening[1].length;
        }
      }
    }else if(prefix<=3){
      const closer=trimmed.trimEnd();
      if(closer.length>=count&&[...closer].every(ch=>ch===character)){
        spans.push({from:begin,to:offset+line.length+eol.length});
        begin=-1;character=null;count=0;
      }
    }
    offset+=line.length+eol.length;
  }
  if(begin>=0)spans.push({from:begin,to:source.length});
  return spans;
}
function scanMath(source){
  if(typeof source!=='string')fail('テキストレイヤーの本文が取得できません。');
  if(/[\uD800-\uDFFF]/.test(source))
    fail('絵文字などのサロゲートペア（BMP外Unicode文字）は現行の文字範囲処理では未対応です。');
  const out=[];
  const fences=fencedSpans(source);
  let fenceIndex=0,i=0;
  while(i<source.length){
    if(fenceIndex<fences.length&&i>=fences[fenceIndex].from){
      i=fences[fenceIndex].to;fenceIndex++;continue;
    }
    const start=i;
    let opening=null,closing=null,kind=null,notation=null,env=null;
    if(source[i]==='$'&&!escaped(source,i)){
      if(source.startsWith('$$',i)){
        opening='$$';closing='$$';kind='display';notation='dollars-display';
      }else{
        opening='$';closing='$';kind='inline';notation='dollars-inline';
      }
    }else if(source[i]==='\\'&&!escaped(source,i)){
      if(source.startsWith('\\(',i)){
        opening='\\(';closing='\\)';kind='inline';notation='paren';
      }else if(source.startsWith('\\[',i)){
        opening='\\[';closing='\\]';kind='display';notation='bracket';
      }else{
        const m=ENV.exec(source.slice(i));
        if(m){
          env=m[1];opening=m[0];closing='\\end{'+env+'}';
          kind=env==='math'?'inline':'display';notation='environment';
        }
      }
    }
    if(!opening){i++;continue;}
    const bodyFrom=start+opening.length;
    let end=-1;
    for(let j=bodyFrom;j<source.length;j++){
      if(closing[0]==='$'){
        if(source[j]==='$'&&!escaped(source,j)){
          if(closing==='$$'&&source.startsWith('$$',j)){end=j;break;}
          if(closing==='$'){
            if(source.startsWith('$$',j))
              fail('インライン数式内に$$があります。');
            end=j;break;
          }
        }
      }else if(source.startsWith(closing,j)&&!escaped(source,j)){
        end=j;break;
      }
    }
    if(end<0)fail('数式の閉じ記号がありません: '+opening);
    const rawInner=source.slice(bodyFrom,end);
    for(let k=0;k<rawInner.length;k++)
      if(rawInner[k]==='%'&&!escaped(rawInner,k))
        fail('数式内のTeX行コメント%は未対応です。コメントを削除してから変換してください。');
    let latex=rawInner.trim().replace(/\r\n|\r|\n/g,' ');
    if(!latex)fail('空の数式です: '+opening);
    if(env){
      if(env.startsWith('align'))
        latex='\\begin{aligned}'+latex+'\\end{aligned}';
      else if(env.startsWith('gather')||env.startsWith('multline'))
        latex='\\begin{gathered}'+latex+'\\end{gathered}';
    }
    const bodyFirst=rawInner.search(/\S/);
    const styleAnchor=bodyFirst<0?bodyFrom:bodyFrom+bodyFirst;
    const to=end+closing.length;
    out.push({from:start,to,latex,mode:kind,notation,env,
      styleAnchor,raw:source.slice(start,to)});
    i=to;
  }
  return out;
}
module.exports={scanMath,fencedSpans};
