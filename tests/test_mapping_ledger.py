"""PUA identity survives rebuilds and refuses accidental registry truncation."""
import json
import tempfile
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import registry


class TestMappingLedger(unittest.TestCase):
    def test_legacy_ratex_engine_is_ignored_without_touching_mapping(self):
        # A real user's registry can be produced by an old RaTeX backend,
        # yet LaTeX/PUA identities must survive the backend switch.
        sample={
            'schema':1,
            'next_codepoint':'E002',
            'font':{'family':'Inline Math Lab',
                    'postscript_name':'InlineMathLab-Regular',
                    'engine':'ratex'},
            'entries':[
                {'codepoint':'E000','latex':r'\\frac{a}{b}','mode':'inline'},
                {'codepoint':'E001','latex':'x_i^2','mode':'inline'}
            ]
        }
        with tempfile.TemporaryDirectory() as d, patch.object(registry,'LEDGER',Path(d)/'identity.json'):
            source=Path(d)/'registry.json'
            source.write_text(json.dumps(sample,ensure_ascii=False),encoding='utf-8')
            old=source.read_bytes()
            loaded=registry.load_registry(source)
            self.assertEqual(loaded['font']['engine'],'pdflatex')
            self.assertEqual(registry.identity_pairs(loaded),registry.identity_pairs(sample))
            self.assertEqual(source.read_bytes(),old, 'reading must not mutate saved registry')


    def test_existing_identity_is_permanent_but_append_is_allowed(self):
        sample={'entries':[
            {'codepoint':'E000','latex':r'\frac{a}{b}','mode':'inline'},
            {'codepoint':'E001','latex':'x_i','mode':'inline'}
        ]}
        with tempfile.TemporaryDirectory() as d, patch.object(registry,'LEDGER',Path(d)/'identity.json'):
            registry.check_identity_ledger(sample)
            registry.LEDGER.write_text(json.dumps({
                'schema':1,'entries':registry.identity_pairs(sample)
            }))
            registry.check_identity_ledger(sample)
            expanded=json.loads(json.dumps(sample))
            expanded['entries'].append({'codepoint':'E002','latex':'y','mode':'inline'})
            registry.check_identity_ledger(expanded)
            truncated={'entries':sample['entries'][:1]}
            with self.assertRaisesRegex(ValueError,'LaTeX/PUA'):
                registry.check_identity_ledger(truncated)
            changed=json.loads(json.dumps(sample))
            changed['entries'][1]['latex']='different'
            with self.assertRaisesRegex(ValueError,'LaTeX/PUA'):
                registry.check_identity_ledger(changed)


if __name__=='__main__':
    unittest.main()

