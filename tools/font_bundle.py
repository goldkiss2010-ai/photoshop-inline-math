"""Read-only ZIP snapshot of a generated font and its LaTeX/PUA registry."""
from __future__ import annotations
import hashlib
import json
import re
from io import BytesIO
from zipfile import ZipFile,ZIP_DEFLATED
from readonly_mapping import validate_registry
from font_provenance import notice_files,portable_sources,ofl_only


def _json(value):
    return (json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode('utf-8')


def make_font_bundle(registry, font_data, *, project_id, display_name, project=None):
    """Return a complete archive in memory; never generate or install a font."""
    validate_registry(registry)
    if not registry['entries'] or not isinstance(font_data,bytes) or not font_data:
        raise ValueError('書き出す生成済みの数式フォントがありません。先に数式を変換してください。')
    if project_id!='legacy' and not re.fullmatch(r'pm-[0-9a-f]{16}',project_id or ''):
        raise ValueError('書き出し対象のフォントIDが不正です。')
    font={k:registry['font'][k] for k in ('family','postscript_name','engine','ascent','descent')
          if k in registry['font']}
    ps=font['postscript_name']
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,126}',ps):
        raise ValueError('書き出し対象の内部フォント名が不正です。')
    if not isinstance(display_name,str) or not display_name.strip():
        raise ValueError('表示名がありません。')
    from fontTools.ttLib import TTFont
    with TTFont(BytesIO(font_data)) as otf:
        if otf['name'].getDebugName(6)!=ps or otf['name'].getDebugName(1)!=font['family']:
            raise ValueError('OTFの内部名と対応表が一致しません。')
        actual={n for n in (otf.getBestCmap() or {}) if 0xE000<=n<=0xF8FF}
        expected={int(e['codepoint'],16) for e in registry['entries']}
        if actual!=expected:
            raise ValueError('OTFのPUA文字集合と対応表が一致しません。')
    # SVG cache paths and other local annotations are not portable registry data.
    keys=('codepoint','latex','mode','texWidthPt','texHeightPt','texDepthPt','svgSha256')
    reg={'schema':1,'font':font,'next_codepoint':registry['next_codepoint'],
         'entries':[{k:e[k] for k in keys if k in e} for e in registry['entries']]}
    for original,entry in zip(registry['entries'],reg['entries']):
        sources=portable_sources(original.get('fontSources'))
        if sources is not None:entry['fontSources']=sources
    files={ps+'.otf':font_data,'registry.json':_json(reg)}
    notices,source_info=notice_files(reg['entries'])
    files.update(notices)
    if project_id!='legacy':
        if (not isinstance(project,dict) or project.get('project_id')!=project_id or
            project.get('managed_by')!='paper-math' or project.get('font')!=registry['font'] or
            project.get('name')!=display_name or font!=registry['font']):
            raise ValueError('書き出し対象の管理情報が一致しません。')
        if project.get('schema') not in (1,2):
            raise ValueError('書き出し対象の管理情報が一致しません。')
        meta={'schema':project['schema'],'managed_by':'paper-math','project_id':project_id,
              'name':display_name,'font':font}
        if meta['schema']==2:
            from project_fonts import _family, _name
            creation_name=project.get('creation_name')
            if (_name(creation_name)!=creation_name or _family(project_id,creation_name)!=font['family'] or
                ps!='PaperMath'+project_id[3:]+'-Regular'):
                raise ValueError('書き出し対象の作成時フォント名が一致しません。')
            meta['creation_name']=creation_name
        files['project.json']=_json(meta)
        identity={'font':font,'pairs':[(e['codepoint'],e['latex']) for e in reg['entries']]}
        source_key=hashlib.sha256(json.dumps(identity,sort_keys=True,ensure_ascii=False).encode('utf-8')).hexdigest()
        files['stamp.json']=_json({'source_key':source_key,'sha256':hashlib.sha256(font_data).hexdigest()})
    files['README.txt']=(
        'Paper Math — フォントと対応表\n\n'
        '表示名: '+display_name+'\nWindows / Photoshopのフォント名: '+font['family']+
        '\n内部名: '+ps+'\n登録式: '+str(len(reg['entries']))+'\n\n'
        'OTFとregistry.jsonは同じ版の一組です。別フォントの対応表と混ぜないでください。\n'
        '別のWindows環境で表示する場合は、OTFを手動でインストールします。\n'
        'LaTeXへの復元には対応する登録簿も必要です。ZIPの自動読み込み機能は未実装です。\n'
        'このZIPにPSDやコード実行環境は含まれません。登録LaTeXは含まれます。\n'
        '字形出所・変更内容・ライセンス参照はFONT_NOTICES.txtを確認してください。\n'
        '出所未記録や複数ライセンスが混ざるフォントは、配布条件を別途確認します。\n'
    ).encode('utf-8')
    manifest={'schema':1,'format':'paper-math-font-bundle','project_id':project_id,
              'display_name':display_name,'font':font,'revision':len(reg['entries']),
              'files':{name:hashlib.sha256(data).hexdigest() for name,data in files.items()},
              'font_license_notices':'ofl-source-notices' if ofl_only(source_info) else 'source-review-required',
              'source_coverage':source_info['coverage']}
    files['bundle.json']=_json(manifest)
    archive=BytesIO()
    with ZipFile(archive,'w',compression=ZIP_DEFLATED) as zipfile:
        for name,data in files.items():
            zipfile.writestr(name,data)
    return {'data':archive.getvalue(),'filename':f'paper-math-{project_id}-r{len(reg["entries"])}.zip',
            'project_id':project_id,'postscript_name':ps,'revision':len(reg['entries'])}
