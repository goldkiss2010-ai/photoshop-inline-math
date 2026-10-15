/*
 * Experimental, read-only partial math scanner. Not wired to panel.js.
 * BMP offsets are UTF-16 offsets, matching Photoshop and the Python mirror.
 * Code/blank-line boundaries never get crossed by delimiter searches.
 */
'use strict';
const ENV=/^\\begin\{(math|displaymath|equation\*?|align\*?|gather\*?|multline\*?)\}/;
const MESSAGE={
  'unclosed-math':'この範囲内に数式の閉じ記号がありません。',
  'ambiguous-inline':'インライン数式内の$$を確定できません。',
  'empty-math':'空の数式は保留します。',
  'tex-comment':'数式内の行コメントは保留します。',
  'unclosed-code':'コードブロックが未閉鎖のため、ここから末尾は原文を保持します。',
  'unclosed-inline-code':'閉じバックティックがないため、この行の残りを保持します。',
  'unsupported-unicode':'BMP外文字は現在の書式投影で未対応です。'
};
function escaped(s,p){
  let n=0;
  while(p-n-1>=0&&s[p-n-1]==='\\')n++;
  return n%2===1;
}
function sourceLines(s){
  const pieces=s.split(/(\r\n|\r|\n)/),out=[];
  let from=0;
  for(let i=0;i<pieces.length;i+=2){
    const text=pieces[i],eol=pieces[i+1]||'';
    out.push({from,to:from+text.length,end:from+text.length+eol.length,
      text,eol,line:i/2+1});
    from+=text.length+eol.length;
  }
  return out;
}
function openingAt(s,p){
  if(escaped(s,p))return null;
  if(s.startsWith('$$',p))return {opening:'$$',closing:'$$',mode:'display',notation:'dollars-display',env:null};
  if(s[p]==='$')return {opening:'$',closing:'$',mode:'inline',notation:'dollars-inline',env:null};
  if(s.startsWith('\\(',p))return {opening:'\\(',closing:'\\)',mode:'inline',notation:'paren',env:null};
  if(s.startsWith('\\[',p))return {opening:'\\[',closing:'\\]',mode:'display',notation:'bracket',env:null};
  if(s[p]!=='\\')return null;
  const m=ENV.exec(s.slice(p));
  if(!m)return null;
  return {opening:m[0],closing:'\\end{'+m[1]+'}',mode:m[1]==='math'?'inline':'display',
    notation:'environment',env:m[1]};
}
function scanMathPlan(source){
  if(typeof source!=='string')throw TypeError('数式入力テキストがありません。');
  const lines=sourceLines(source),matches=[],issues=[],protectedSpans=[];
  function issue(code,from,to){
    const line=lines.find(x=>x.from<=from&&from<x.end)||lines[lines.length-1];
    issues.push({code,message:MESSAGE[code],from,to,line:line.line,column:from-line.from+1});
  }
  if(/[\uD800-\uDFFF]/.test(source)){
    issue('unsupported-unicode',0,source.length);
    return {sourceLength:source.length,matches,issues,protected:protectedSpans,fatal:true,complete:false};
  }
  let fence=null;
  for(const line of lines){
    const m=/^ {0,3}(\x60{3,}|~{3,})/.exec(line.text);
    if(!fence){
      if(m)fence={from:line.from,marker:m[1][0],count:m[1].length};
    }else{
      const closer=line.text.replace(/^ {0,3}/,'').replace(/[ \t]+$/,'');
      if(closer.length>=fence.count&&[...closer].every(ch=>ch===fence.marker)){
        protectedSpans.push({from:fence.from,to:line.end,kind:'fenced-code',closed:true});
        fence=null;
      }
    }
  }
  if(fence){
    protectedSpans.push({from:fence.from,to:source.length,kind:'fenced-code',closed:false});
    issue('unclosed-code',fence.from,source.length);
  }
  // Inline code is explicitly marked and bounded by a physical line.
  for(const line of lines){
    if(protectedSpans.some(p=>p.kind==='fenced-code'&&p.from<=line.from&&line.from<p.to))continue;
    let i=line.from;
    while(i<line.to){
      if(source[i]!==String.fromCharCode(96)||escaped(source,i)){i++;continue;}
      let body=i;
      while(body<line.to&&source[body]===String.fromCharCode(96))body++;
      const count=body-i;
      let end=-1,j=body;
      while(j<line.to){
        if(source[j]!==String.fromCharCode(96)){j++;continue;}
        let k=j;
        while(k<line.to&&source[k]===String.fromCharCode(96))k++;
        if(k-j===count){end=k;break;}
        j=k;
      }
      if(end<0){
        protectedSpans.push({from:i,to:line.to,kind:'inline-code',closed:false});
        issue('unclosed-inline-code',i,line.to);
        break;
      }
      protectedSpans.push({from:i,to:end,kind:'inline-code',closed:true});
      i=end;
    }
  }
  protectedSpans.sort((a,b)=>a.from-b.from);
  const allowed=[];
  let cursor=0;
  for(const p of protectedSpans){
    if(cursor<p.from)allowed.push({from:cursor,to:p.from});
    cursor=p.to;
  }
  if(cursor<source.length)allowed.push({from:cursor,to:source.length});
  const boundaries=[];
  for(const line of lines){
    if(!line.text.trim()&&line.eol)boundaries.push(line.from);
    const prefix=line.text.search(/\S/);
    if(prefix>=0){
      const at=line.from+prefix,op=openingAt(source,at);
      if(op&&op.mode==='display')boundaries.push(at);
    }
  }
  boundaries.sort((a,b)=>a-b);
  const boundarySet=new Set(boundaries);
  for(const region of allowed){
    let i=region.from;
    while(i<region.to){
      const op=openingAt(source,i);
      if(!op){i++;continue;}
      const start=i,bodyFrom=i+op.opening.length;
      let end=-1,cut=region.to,problem='unclosed-math';
      for(let j=bodyFrom;j<region.to;j++){
        const closes=j+op.closing.length<=region.to&&source.startsWith(op.closing,j)&&!escaped(source,j);
        if(closes){
          if(op.closing==='$'&&source.startsWith('$$',j)){
            problem='ambiguous-inline';
            const boundary=boundaries.find(p=>p>=j&&p<region.to);
            cut=boundary===undefined?region.to:boundary;
            break;
          }
          end=j;break;
        }
        if(boundarySet.has(j)&&j!==start){cut=j;break;}
      }
      if(end<0){
        issue(problem,start,Math.max(start+op.opening.length,cut));
        i=Math.max(bodyFrom,cut);
        continue;
      }
      const to=end+op.closing.length,body=source.slice(bodyFrom,end);
      let latex=body.trim().replace(/\r\n|\r|\n/g,' ');
      if(!latex){issue('empty-math',start,to);i=to;continue;}
      let comment=false;
      for(let k=0;k<body.length;k++)if(body[k]==='%'&&!escaped(body,k)){comment=true;break;}
      if(comment){issue('tex-comment',start,to);i=to;continue;}
      if(op.env){
        if(op.env.startsWith('align'))latex='\\begin{aligned}'+latex+'\\end{aligned}';
        else if(op.env.startsWith('gather')||op.env.startsWith('multline'))
          latex='\\begin{gathered}'+latex+'\\end{gathered}';
      }
      matches.push({from:start,to,latex,mode:op.mode,notation:op.notation,env:op.env,
        styleAnchor:bodyFrom+body.search(/\S/),raw:source.slice(start,to)});
      i=to;
    }
  }
  issues.sort((a,b)=>a.from-b.from||a.code.localeCompare(b.code));
  return {sourceLength:source.length,matches,issues,protected:protectedSpans,
    fatal:false,complete:issues.length===0};
}
module.exports={scanMathPlan};
