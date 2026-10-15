"""Partial input preparation. Publish only after successful font assembly."""
from __future__ import annotations
import tempfile
from pathlib import Path
from math_scan_plan import scan_math_plan
from tex_render import render_expression, FormulaRenderError


def convert_report(source, report, mapping):
    cursor=0
    parts=[]
    for match in report['matches']:
        if match['latex'] not in mapping:
            continue
        parts.extend((source[cursor:match['from']],chr(int(mapping[match['latex']],16))))
        cursor=match['to']
    parts.append(source[cursor:])
    return ''.join(parts)


def stage_unknown(report, registry, stage, renderer=render_expression):
    """Only typed, expression-specific TeX failures become local holds."""
    known={e['latex'] for e in registry['entries']}
    staged={}
    failures={}
    for match in report['matches']:
        latex=match['latex']
        if latex in known or latex in staged or latex in failures:
            continue
        svg=stage/(str(len(staged))+'.svg')
        try:
            metrics=renderer(latex,svg)
        except FormulaRenderError as exc:
            failures[latex]=str(exc)
            continue
        staged[latex]={'svg':svg,'metrics':metrics}
    issues=list(report['issues'])
    for match in report['matches']:
        if match['latex'] in failures:
            issues.append({'code':'render-failed','from':match['from'],'to':match['to'],
                           'latex':match['latex'],'message':failures[match['latex']]})
    accepted={**report,'matches':[m for m in report['matches'] if m['latex'] not in failures],
              'issues':sorted(issues,key=lambda x:x['from']),
              'complete':not issues}
    return accepted,staged


def prepare_partial(pid, source):
    if not isinstance(source,str) or not source.strip() or len(source)>100000:
        raise ValueError('テキストが空、または長すぎます。')
    report=scan_math_plan(source)
    if report['fatal']:
        raise ValueError('\n'.join(x['message'] for x in report['issues']))
    from registry import load_registry, refresh, index, FONT_FILE
    from project_fonts import _load, prepare
    original=load_registry() if pid=='legacy' else _load(pid)[1]
    with tempfile.TemporaryDirectory(prefix='aim-partial-') as td:
        accepted,staged=stage_unknown(report,original,Path(td))
        if not accepted['matches']:
            # No font or registry writes when every candidate is held.
            return {'project_id':pid,'font':original['font'],
                    'revision':len(original['entries']),'formula_instances':0,
                    'candidate_instances':len(report['matches']),
                    'unique_formulas':0,'new_count':0,'entries':[],
                    'converted':source,'issues':accepted['issues'],'accepted_matches':[]}
        if pid=='legacy':
            updated,additions=refresh(original,[m['latex'] for m in accepted['matches']],
                                      staged_formulas=staged)
            mapping=index(updated)
            unique=list(dict.fromkeys(m['latex'] for m in accepted['matches']))
            result={'project_id':pid,'font':updated['font'],'revision':len(updated['entries']),
                    'formula_instances':len(accepted['matches']),'unique_formulas':len(unique),
                    'new_count':len(additions),'font_path':str(FONT_FILE),
                    'entries':[{'latex':f,'codepoint':mapping[f],
                                'char':chr(int(mapping[f],16))} for f in unique],
                    'converted':convert_report(source,accepted,mapping)}
        else:
            result=prepare(pid,source,scan_report=accepted,staged_formulas=staged)
        result.update(candidate_instances=len(report['matches']),issues=accepted['issues'],
                      accepted_matches=accepted['matches'])
        return result
