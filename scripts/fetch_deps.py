"""Restore pinned local dependencies; verify every file before writing it."""
from pathlib import Path
import hashlib
import io
import json
import tarfile
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parent.parent

# vendor path -> (source name in dependencies.json, path inside that npm archive)
THREE_FILES = {'three/three.module.js': ('three', 'package/build/three.module.js')}
MODEL_FILES = {'models/hand.task': 'hand', 'models/person.tflite': 'person', 'models/face.tflite': 'face'}


def download(url):
    with urlopen(url, timeout=60) as response:
        return response.read()


def checked_write(relative, data, manifest):
    expected = manifest['sha256'][relative]
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError(f'Checksum mismatch: {relative}')
    target = ROOT / 'vendor' / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)


def main():
    manifest = json.loads((ROOT / 'dependencies.json').read_text())
    archives = {}

    def archive(name):
        if name not in archives:
            archives[name] = tarfile.open(fileobj=io.BytesIO(download(manifest['sources'][name])), mode='r:gz')
        return archives[name]

    for relative in manifest['sha256']:
        if relative in MODEL_FILES:
            data = download(manifest['sources'][MODEL_FILES[relative]])
        else:
            source, member = THREE_FILES.get(relative, ('runtime', 'package/' + relative))
            data = archive(source).extractfile(member).read()
        checked_write(relative, data, manifest)
    print(f'Verified {len(manifest["sha256"])} pinned files in vendor/.')


if __name__ == '__main__':
    main()
