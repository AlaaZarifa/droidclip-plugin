#!/usr/bin/env python3
"""Build an installable plugin with the existing Android Studio SDK and JBR."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import zipfile

root = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--studio', type=Path, default=Path('/Applications/Android Studio.app/Contents'))
parser.add_argument('--bridge', type=Path, default=root.parent)
args = parser.parse_args()
studio = args.studio.resolve()
bridge = args.bridge.resolve()
info = json.loads((studio / 'Resources/product-info.json').read_text())
if not info['buildNumber'].startswith('261.'):
    raise SystemExit('This build targets Android Studio platform 261. Adjust the compatibility range before using another SDK.')
java = studio / 'jbr/Contents/Home/bin'
# Compile the bridge first. No Android app project or its Gradle files are read.
subprocess.run(['npm', 'run', 'build'], cwd=bridge, check=True)
build = root / 'build'
classes = build / 'classes'
if classes.exists():
    shutil.rmtree(classes)
classes.mkdir(parents=True)
resources = root / 'src/main/resources'
shutil.copytree(resources, classes, dirs_exist_ok=True)
bundled = classes / 'bridge'
bundled.mkdir()
for name in ['index', 'adb', 'clipboard', 'config', 'watcher', 'errors']:
    shutil.copy2(bridge / 'dist' / f'{name}.js', bundled / f'{name}.js')
(bundled / 'package.json').write_text('{"private":true,"type":"module"}\n')
shutil.copy2(bridge / 'LICENSE', bundled / 'LICENSE')
sources = sorted(str(p) for p in (root / 'src/main/java').rglob('*.java'))
subprocess.run([str(java / 'javac'), '--release', '21', '-encoding', 'UTF-8',
                '-classpath', str(studio / 'lib/*'), '-d', str(classes), *sources], check=True)
jar = build / 'droidclip-plugin.jar'
subprocess.run([str(java / 'jar'), '--create', '--file', str(jar), '-C', str(classes), '.'], check=True)
dist = build / 'distributions'
dist.mkdir(exist_ok=True)
archive = dist / 'droidclip-plugin-0.1.1.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as output:
    output.write(jar, 'droidclip-plugin/lib/droidclip-plugin.jar')
    output.write(root / 'LICENSE', 'droidclip-plugin/LICENSE-plugin.txt')
    output.write(bridge / 'LICENSE', 'droidclip-plugin/LICENSE-droid-clip.txt')
print(f'Built {archive}')
print(f'Target: {info["name"]} {info["buildNumber"]}; Java 21; default Off')
