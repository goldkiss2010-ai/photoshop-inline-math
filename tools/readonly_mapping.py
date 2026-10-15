"""Read-only inspection and strict PUA-to-LaTeX restoration for Photoshop.

This module does not import the build pipeline or write to the filesystem.
Neither a PUA codepoint nor a font family name alone identifies a formula:
all PUA text runs must report the registry's exact PostScript name.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from app_paths import ROOT, DATA_ROOT
DEFAULT_REGISTRY = DATA_ROOT / 'assets' / 'registry.json'
DEFAULT_LEDGER = DATA_ROOT / 'local-build' / 'latex-pua-identity.json'
PUA_START, PUA_END = 0xE000, 0xF8FF


def validate_registry(doc: dict) -> dict[str, str]:
    """Validate in memory; return U+codepoint -> LaTeX with no mutations."""
    if not isinstance(doc, dict) or doc.get('schema') != 1:
        raise ValueError('Unsupported registry schema')
    font = doc.get('font')
    if not isinstance(font, dict) or any(
        not isinstance(font.get(k), str) or not font[k].strip()
        for k in ('family', 'postscript_name')
    ):
        raise ValueError('Registry font identity is missing')
    entries = doc.get('entries')
    if not isinstance(entries, list):
        raise ValueError('Registry entries are missing')
    reverse, formulas = {}, set()
    for i, item in enumerate(entries):
        if not isinstance(item, dict) or item.get('mode') != 'inline':
            raise ValueError('Unsupported registry entry')
        cp, latex = item.get('codepoint'), item.get('latex')
        if not isinstance(cp, str) or not isinstance(latex, str) or not latex.strip():
            raise ValueError('Invalid PUA/LaTeX entry')
        try:
            number = int(cp, 16)
        except ValueError as exc:
            raise ValueError('Invalid PUA codepoint: ' + cp) from exc
        if number != PUA_START + i or number > PUA_END:
            raise ValueError('Registry PUA codes must be ordered and append-only')
        if latex in formulas:
            raise ValueError('Duplicate LaTeX formula in registry')
        formulas.add(latex)
        reverse[chr(number)] = latex
    try:
        next_cp = int(doc['next_codepoint'], 16)
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError('Invalid next_codepoint') from exc
    if next_cp != PUA_START + len(entries) or next_cp > PUA_END + 1:
        raise ValueError('Registry next_codepoint differs from entries')
    return reverse


def audit_registry(registry_path: Path, ledger_path: Path | None = None) -> dict:
    """Read registry and optional independent identity ledger, never repair them."""
    registry_path = Path(registry_path)
    raw = registry_path.read_bytes()
    doc = json.loads(raw.decode('utf-8'))
    validate_registry(doc)
    result = {
        'registry_path': str(registry_path.resolve()),
        'registry_sha256': hashlib.sha256(raw).hexdigest(),
        'family': doc['font']['family'],
        'postscript_name': doc['font']['postscript_name'],
        'engine': doc['font'].get('engine'),
        'entry_count': len(doc['entries']),
        'next_codepoint': doc['next_codepoint'],
        'ledger_status': 'not_checked',
        'os_or_photoshop_font_verified': False,
    }
    if ledger_path is not None:
        ledger_path = Path(ledger_path)
        result['ledger_path'] = str(ledger_path.resolve())
        if not ledger_path.is_file():
            result['ledger_status'] = 'missing'
        else:
            ledger = json.loads(ledger_path.read_text(encoding='utf-8'))
            previous = ledger.get('entries') if isinstance(ledger, dict) else None
            if not isinstance(ledger, dict) or ledger.get('schema') != 1 or not isinstance(previous, list):
                result['ledger_status'] = 'invalid'
            else:
                current = [[e['codepoint'], e['latex']] for e in doc['entries']]
                if len(current) < len(previous):
                    result['ledger_status'] = 'registry_shorter_than_ledger'
                elif current[:len(previous)] != previous:
                    result['ledger_status'] = 'identity_mismatch'
                else:
                    result['ledger_status'] = 'match'
                result['ledger_entries'] = len(previous)
    return result


def restore_pua_text(source: str, registry: dict, text_style_ranges: list[dict]) -> dict:
    """Restore all known BMP PUA chars only if their individual fonts match.

    Style offsets use Photoshop UTF-16 indices; non-BMP text is rejected until
    the full text-range adapter supports it. The original descriptor is untouched.
    """
    if not isinstance(source, str) or any(ord(c) > 0xFFFF or 0xD800 <= ord(c) <= 0xDFFF for c in source):
        raise ValueError('Source requires BMP-only text')
    reverse = validate_registry(registry)
    expected_ps = registry['font']['postscript_name']
    if not isinstance(text_style_ranges, list) or not text_style_ranges:
        raise ValueError('Missing Photoshop textStyleRange')
    end = 0
    for item in text_style_ranges:
        if (not isinstance(item, dict) or type(item.get('from')) is not int or
            type(item.get('to')) is not int or item['from'] != end or
            item['to'] <= end or not isinstance(item.get('textStyle'), dict)):
            raise ValueError('Invalid or discontinuous Photoshop textStyleRange')
        end = item['to']
    if end not in (len(source), len(source) + 1):
        raise ValueError('Photoshop textStyleRange length mismatch')
    out, segments = [], []
    cursor, math_count, range_i = 0, 0, 0
    for i, char in enumerate(source):
        while i >= text_style_ranges[range_i]['to']:
            range_i += 1
        cp = ord(char)
        is_pua = PUA_START <= cp <= PUA_END
        if is_pua:
            if char not in reverse:
                raise ValueError(f'Unregistered PUA: U+{cp:04X}')
            style = text_style_ranges[range_i]['textStyle']
            if style.get('fontPostScriptName') != expected_ps or style.get('fontAvailable') is False:
                raise ValueError(f'PUA font identity mismatch at offset {i}: U+{cp:04X}')
            value = '$' + reverse[char] + '$'
            kind = 'math'
            math_count += 1
        else:
            value, kind = char, 'body'
        start = cursor
        cursor += len(value)
        out.append(value)
        if kind == 'body' and segments and segments[-1]['kind'] == 'body':
            segments[-1]['sourceTo'] = i + 1
            segments[-1]['to'] = cursor
        else:
            segments.append({'kind': kind, 'sourceFrom': i, 'sourceTo': i + 1,
                             'from': start, 'to': cursor, 'styleAnchor': i})
    if not math_count:
        raise ValueError('No PUA formula found')
    return {'text': ''.join(out), 'segments': segments, 'mathCount': math_count}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Read-only Paper Math registry inspection')
    parser.add_argument('--registry', type=Path, default=DEFAULT_REGISTRY)
    parser.add_argument('--ledger', type=Path, default=DEFAULT_LEDGER)
    args = parser.parse_args(argv)
    try:
        report = audit_registry(args.registry, args.ledger)
    except (OSError, ValueError, KeyError, UnicodeError) as exc:
        parser.exit(2, 'ERROR: ' + str(exc) + '\n')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report['ledger_status'] in ('match', 'missing') else 2


if __name__ == '__main__':
    raise SystemExit(main())

