"""Application source and writable data locations; legacy checkouts keep their paths."""
from __future__ import annotations
import json
import os
import tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]

def data_root(environ=None, root=ROOT):
    value=(os.environ if environ is None else environ).get('PAPER_MATH_DATA_DIR')
    if not value:return root
    path=Path(value)
    if not path.is_absolute():raise ValueError('PAPER_MATH_DATA_DIR must be an absolute path')
    return path.resolve()

DATA_ROOT=data_root()

def initialize_data(root=ROOT, destination=DATA_ROOT):
    """Seed a fresh external store once; never replace an existing registry."""
    target=destination/'assets'/'registry.json'
    if destination==root or target.exists():return
    # A ledger or project directory with a missing registry is recovery work,
    # not a fresh installation. Do not silently replace its issued meanings.
    if (destination/'local-build').exists():
        raise ValueError('Existing Paper Math data has no registry; restore its backup before starting: '+str(destination))
    seed=(root/'assets'/'registry.json').read_bytes()
    doc=json.loads(seed)
    if doc.get('schema')!=1 or not isinstance(doc.get('entries'),list):
        raise ValueError('Invalid installation registry seed')
    target.parent.mkdir(parents=True,exist_ok=True)
    handle,name=tempfile.mkstemp(prefix='.seed-',dir=target.parent)
    try:
        with os.fdopen(handle,'wb') as out:out.write(seed)
        try:os.link(name,target) # exclusive publication, including concurrent first starts
        except FileExistsError:pass
    finally:Path(name).unlink(missing_ok=True)
