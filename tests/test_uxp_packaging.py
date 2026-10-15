"""CCX preparation and source validation; synthetic test ZIPs are not Adobe installers."""
import hashlib
import io
import json
import shutil
import sys
import tempfile
import unittest
import warnings
from pathlib import Path
from zipfile import ZipFile
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
import prepare_uxp_package as package
import build_distribution as dist

class PackagingTests(unittest.TestCase):
    def test_preparation_keeps_source_code_permissions_and_development_identity(self):
        panel=ROOT/'photoshop/uxp-panel'
        before={p.name:p.read_bytes() for p in panel.iterdir() if p.is_file()}
        with tempfile.TemporaryDirectory() as td:
            result=package.prepare(Path(td),ROOT)
            folder=Path(result['manifest']).parent
            manifest=json.loads((folder/'manifest.json').read_bytes())
            original=json.loads(before['manifest.json'])
            self.assertEqual(manifest['id'],'com.goldkiss2010.papermath')
            self.assertNotEqual(original['id'],manifest['id'])
            self.assertEqual(manifest['requiredPermissions'],original['requiredPermissions'])
            for n,b in before.items():
                if n!='manifest.json':self.assertEqual((folder/n).read_bytes(),b)
            self.assertTrue((folder/'LICENSE').is_file())
            self.assertIn(b'editable',(folder/'SOURCE_NOTICE.txt').read_bytes())
            self.assertFalse(any(p.suffix in ('.otf','.py','.psd','.ccx') for p in folder.iterdir()))
            self.assertEqual(package.prepare(Path(td),ROOT),result)
        self.assertEqual(before,{p.name:p.read_bytes() for p in panel.iterdir() if p.is_file()})

    def test_plugin_and_panel_icons_have_all_declared_png_dimensions(self):
        import struct
        files=package.package_files();manifest=json.loads(files['manifest.json'])
        self.assertEqual(manifest['icons'][0]['species'],['pluginList'])
        groups=[manifest['icons']]+[e['icons'] for e in manifest['entrypoints'] if e['type']=='panel']
        for icons in groups:
            for icon in icons:
                for scale in icon['scale']:
                    path=Path(icon['path'])
                    name=path.as_posix() if scale==1 else path.with_stem(path.stem+'@'+str(scale)+'x').as_posix()
                    self.assertEqual(struct.unpack('>II',files[name][16:24]),(icon['width']*scale,icon['height']*scale))
        png=files['icons/plugin.png']
        self.assertEqual(package.canonical_text(png,'icons/plugin.png'),png)

    def test_missing_high_density_icon_is_rejected_before_packaging(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);shutil.copytree(ROOT/'photoshop/uxp-panel',root/'photoshop/uxp-panel')
            for n in package.LICENSE_FILES:shutil.copyfile(ROOT/n,root/n)
            (root/'photoshop/uxp-panel/icons/plugin@2x.png').unlink()
            with self.assertRaisesRegex(ValueError,'invalid plugin icon'):
                package.prepare(root/'output',root)

    def test_missing_required_module_is_caught_before_udt_packaging(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);shutil.copytree(ROOT/'photoshop/uxp-panel',root/'photoshop/uxp-panel')
            for n in package.LICENSE_FILES:shutil.copyfile(ROOT/n,root/n)
            (root/'photoshop/uxp-panel/backend_contract.js').unlink()
            with self.assertRaisesRegex(ValueError,'Missing plugin module'):
                package.prepare(root/'output',root)
            self.assertFalse((root/'output').exists())

    def archive(self,path,files):
        # Fixture for validating archive contents only. Never offered as an installer.
        with ZipFile(path,'w') as z:
            for n,b in files.items():z.writestr(n,b)

    def test_source_matched_ccx_can_be_bundled_without_claiming_installation(self):
        files=package.package_files()
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);ccx=root/'fixture.ccx';self.archive(ccx,files)
            result=package.verify_ccx(ccx)
            self.assertTrue(result['source_match']);self.assertFalse(result['installation_verified'])
            output=root/'app.zip';dist.build_distribution(output,ccx=ccx)
            with ZipFile(output) as z:
                meta=json.loads(z.read('PaperMath/distribution-files.json'))
                self.assertTrue(meta['ccx_included'])
                self.assertEqual(z.read('PaperMath/plugin/PaperMath.ccx'),ccx.read_bytes())
                guide=z.read('PaperMath/FIRST_START.html').decode()
                self.assertIn('Install_Photoshop_Plugin.cmd',guide)
                self.assertNotIn('CCX）はまだ含まれていません',guide)
                self.assertNotIn('id="development-panel"',guide)
                for n,digest in meta['files'].items():self.assertEqual(hashlib.sha256(z.read('PaperMath/'+n)).hexdigest(),digest)

    def test_git_windows_line_endings_are_allowed_without_masking_code_changes(self):
        files=package.package_files()
        windows={n:(b if n.endswith('.png') else b.replace(b'\r\n',b'\n').replace(b'\n',b'\r\n')) for n,b in files.items()}
        self.assertEqual(package.package_identity(files),package.package_identity(windows))
        with tempfile.TemporaryDirectory() as td:
            ccx=Path(td)/'windows.ccx';self.archive(ccx,windows)
            self.assertTrue(package.verify_ccx(ccx)['source_match'])

    def test_changed_identity_code_and_missing_license_are_rejected(self):
        files=package.package_files()
        cases=[]
        changed=dict(files);manifest=json.loads(changed['manifest.json']);manifest['id']='other.plugin'
        changed['manifest.json']=json.dumps(manifest).encode();cases.append(changed)
        changed=dict(files);changed['panel.js']+=b'\n// changed';cases.append(changed)
        changed=dict(files);del changed['LICENSE'];cases.append(changed)
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            for i,contents in enumerate(cases):
                with self.subTest(case=i):
                    ccx=root/(str(i)+'.ccx');self.archive(ccx,contents)
                    with self.assertRaises(ValueError):package.verify_ccx(ccx)
                    output=root/'app.zip';output.write_bytes(b'previous valid distribution')
                    with self.assertRaises(ValueError):dist.build_distribution(output,ccx=ccx)
                    self.assertEqual(output.read_bytes(),b'previous valid distribution')

    def test_duplicate_entries_are_not_silently_accepted(self):
        with tempfile.TemporaryDirectory() as td:
            ccx=Path(td)/'duplicate.ccx';files=package.package_files();self.archive(ccx,files)
            with warnings.catch_warnings():
                warnings.simplefilter('ignore',UserWarning)
                with ZipFile(ccx,'a') as z:z.writestr('manifest.json',files['manifest.json'])
            with self.assertRaisesRegex(ValueError,'duplicate'):package.verify_ccx(ccx)

if __name__=='__main__':unittest.main()
