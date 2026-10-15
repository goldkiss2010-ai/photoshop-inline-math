"""Read-only partial scan prototype. Mirrors math_scan_plan.js; not in the API."""
from __future__ import annotations
import re

_ENV=re.compile(r'\\begin\{(math|displaymath|equation\*?|align\*?|gather\*?|multline\*?)\}')
_MESSAGE={
    'unclosed-math':'この範囲内に数式の閉じ記号がありません。',
    'ambiguous-inline':'インライン数式内の$$を確定できません。',
    'empty-math':'空の数式は保留します。',
    'tex-comment':'数式内の行コメントは保留します。',
    'unclosed-code':'コードブロックが未閉鎖のため、ここから末尾は原文を保持します。',
    'unclosed-inline-code':'閉じバックティックがないため、この行の残りを保持します。',
    'unsupported-unicode':'BMP外文字は現在の書式投影で未対応です。',
}
def _escaped(text,pos):
    n=0
    while pos-n-1>=0 and text[pos-n-1]=='\\':
        n+=1
    return n%2==1

def _lines(text):
    parts=re.split(r'(\r\n|\r|\n)',text)
    result=[]; start=0
    for i in range(0,len(parts),2):
        content=parts[i]; eol=parts[i+1] if i+1<len(parts) else ''
        result.append(dict(from_=start,to=start+len(content),end=start+len(content)+len(eol),
                           text=content,eol=eol,line=i//2+1))
        start+=len(content)+len(eol)
    return result

def _opening(text,pos):
    if _escaped(text,pos):
        return None
    for op,close,mode,notation in (
        ('$$','$$','display','dollars-display'),
        ('$','$','inline','dollars-inline'),
        (r'\(',r'\)','inline','paren'),
        (r'\[',r'\]','display','bracket'),
    ):
        if text.startswith(op,pos):
            return dict(opening=op,closing=close,mode=mode,notation=notation,env=None)
    match=_ENV.match(text,pos)
    if not match:
        return None
    env=match.group(1)
    return dict(opening=match.group(0),closing=r'\end{'+env+'}',
                mode='inline' if env=='math' else 'display',notation='environment',env=env)

def scan_math_plan(source):
    if not isinstance(source,str):
        raise TypeError('数式入力テキストがありません。')
    lines=_lines(source); matches=[]; issues=[]; protected=[]
    def issue(code,start,end):
        line=next((x for x in lines if x['from_']<=start<x['end']),lines[-1])
        issues.append(dict(code=code,message=_MESSAGE[code],**{'from':start,'to':end},
                           line=line['line'],column=start-line['from_']+1))
    if any(ord(c)>0xffff or 0xd800<=ord(c)<=0xdfff for c in source):
        length=len(source.encode('utf-16-le',errors='surrogatepass'))//2
        issues.append(dict(code='unsupported-unicode',message=_MESSAGE['unsupported-unicode'],
                           **{'from':0,'to':length},line=1,column=1))
        return dict(sourceLength=length,matches=matches,issues=issues,protected=protected,
                    fatal=True,complete=False)
    fence=None
    for line in lines:
        opening=re.match(r'^ {0,3}(\x60{3,}|~{3,})',line['text'])
        if fence is None:
            if opening:
                token=opening.group(1)
                fence=dict(start=line['from_'],marker=token[0],count=len(token))
        else:
            closer=re.sub(r'^ {0,3}','',line['text']).rstrip(' \t')
            if len(closer)>=fence['count'] and all(c==fence['marker'] for c in closer):
                protected.append(dict(**{'from':fence['start'],'to':line['end']},
                                      kind='fenced-code',closed=True))
                fence=None
    if fence is not None:
        protected.append(dict(**{'from':fence['start'],'to':len(source)},
                              kind='fenced-code',closed=False))
        issue('unclosed-code',fence['start'],len(source))
    for line in lines:
        if any(p['kind']=='fenced-code' and p['from']<=line['from_']<p['to'] for p in protected):
            continue
        i=line['from_']
        while i<line['to']:
            if source[i]!=chr(96) or _escaped(source,i):
                i+=1;continue
            body=i
            while body<line['to'] and source[body]==chr(96):
                body+=1
            count=body-i;end=-1;j=body
            while j<line['to']:
                if source[j]!=chr(96):
                    j+=1;continue
                k=j
                while k<line['to'] and source[k]==chr(96):
                    k+=1
                if k-j==count:
                    end=k;break
                j=k
            if end<0:
                protected.append(dict(**{'from':i,'to':line['to']},kind='inline-code',closed=False))
                issue('unclosed-inline-code',i,line['to'])
                break
            protected.append(dict(**{'from':i,'to':end},kind='inline-code',closed=True))
            i=end
    protected.sort(key=lambda p:p['from'])
    allowed=[];cursor=0
    for p in protected:
        if cursor<p['from']:
            allowed.append((cursor,p['from']))
        cursor=p['to']
    if cursor<len(source):
        allowed.append((cursor,len(source)))
    boundaries=[]
    for line in lines:
        if not line['text'].strip() and line['eol']:
            boundaries.append(line['from_'])
        first=re.search(r'\S',line['text'])
        if first:
            at=line['from_']+first.start()
            opening=_opening(source,at)
            if opening and opening['mode']=='display':
                boundaries.append(at)
    boundaries.sort()
    boundary_set=set(boundaries)
    for start_region,end_region in allowed:
        i=start_region
        while i<end_region:
            opening=_opening(source,i)
            if opening is None:
                i+=1;continue
            start=i;body_from=i+len(opening['opening'])
            end=-1;cut=end_region;problem='unclosed-math'
            for j in range(body_from,end_region):
                closes=(j+len(opening['closing'])<=end_region and
                        source.startswith(opening['closing'],j) and not _escaped(source,j))
                if closes:
                    if opening['closing']=='$' and source.startswith('$$',j):
                        problem='ambiguous-inline'
                        cut=next((p for p in boundaries if j<=p<end_region),end_region)
                        break
                    end=j;break
                if j in boundary_set and j!=start:
                    cut=j;break
            if end<0:
                issue(problem,start,max(start+len(opening['opening']),cut))
                i=max(body_from,cut)
                continue
            to=end+len(opening['closing']);body=source[body_from:end]
            latex=re.sub(r'\r\n|\r|\n',' ',body.strip())
            if not latex:
                issue('empty-math',start,to);i=to;continue
            if any(c=='%' and not _escaped(body,k) for k,c in enumerate(body)):
                issue('tex-comment',start,to);i=to;continue
            env=opening['env']
            if env:
                if env.startswith('align'):
                    latex=r'\begin{aligned}'+latex+r'\end{aligned}'
                elif env.startswith(('gather','multline')):
                    latex=r'\begin{gathered}'+latex+r'\end{gathered}'
            first=re.search(r'\S',body)
            matches.append(dict(**{'from':start,'to':to},latex=latex,mode=opening['mode'],
                                notation=opening['notation'],env=env,
                                styleAnchor=body_from+first.start(),raw=source[start:to]))
            i=to
    issues.sort(key=lambda x:(x['from'],x['code']))
    return dict(sourceLength=len(source),matches=matches,issues=issues,protected=protected,
                fatal=False,complete=not issues)
