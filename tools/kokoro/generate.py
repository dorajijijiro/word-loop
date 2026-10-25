"""Task 019: Kokoro で試聴用の英語音声を事前生成する（開発時だけ使う。アプリには含めない）。

使い方は tools/kokoro/README.md を参照。
- 入力: src/data/audioPreview/items.json（kokoroInput / sentence.kokoroInput）
- 出力: public/audio/kokoro-preview/*.mp3 と manifest.json
- モデルは Hugging Face の公式リポジトリ hexgrad/Kokoro-82M から取得する（キャッシュは Git の外）。
- 英語の G2P は misaki の辞書だけを使い、espeak-ng による推測（fallback）は使わない。
  辞書にない語があれば推測で読ませず、エラーにして止める。
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
ITEMS_PATH = ROOT / 'src' / 'data' / 'audioPreview' / 'items.json'
OUTPUT_DIR = ROOT / 'public' / 'audio' / 'kokoro-preview'
MANIFEST_NAME = 'manifest.json'

REPO_ID = 'hexgrad/Kokoro-82M'
MODEL_FILE = 'kokoro-v1_0.pth'
VOICE_ID = 'af_heart'  # 米国英語（lang_code 'a'）の女性の声。全項目で同じ声を使う。
LANG_CODE = 'a'  # 'a' = American English
SPEED = 1.0  # 通常の自然な速度
SAMPLE_RATE = 24000
MP3_COMPRESSION_LEVEL = 0.5  # libsndfile の MP3 圧縮度（0 が高音質・大きい、1 が低音質・小さい）


def load_items() -> list[dict]:
    with ITEMS_PATH.open(encoding='utf-8') as file:
        return json.load(file)['items']


def list_jobs(items: list[dict]) -> list[dict]:
    """生成するファイルの一覧。単語・句は必須、例文は sentence がある項目だけ。"""
    jobs = []
    for item in items:
        jobs.append({'itemId': item['id'], 'kind': 'word', 'path': f"{item['id']}.mp3", 'text': item['english'], 'input': item['kokoroInput']})
        sentence = item.get('sentence')
        if sentence is not None:
            jobs.append({'itemId': item['id'], 'kind': 'sentence', 'path': f"{item['id']}.sentence.mp3", 'text': sentence['english'], 'input': sentence['kokoroInput']})
    return jobs


def make_g2p():
    from misaki import en

    # fallback=None: 辞書にない語を espeak-ng で推測しない。unk='' は Kokoro の既定と同じ。
    return en.G2P(trf=False, british=False, fallback=None, unk='')


def phonemize(g2p, text: str) -> str:
    phonemes, tokens = g2p(text)
    missing = [token.text for token in tokens if any(c.isalpha() for c in token.text) and not token.phonemes]
    if missing:
        raise SystemExit(f'辞書にない語があります（推測では読ませません）: {text!r} -> {missing}')
    return phonemes


def print_phonemes(jobs: list[dict]) -> None:
    g2p = make_g2p()
    for job in jobs:
        print(f"{job['itemId']:<30} {job['kind']:<8} {job['input']!r:<55} {phonemize(g2p, job['input'])}")


def resolve_revision(revision: str) -> str:
    from huggingface_hub import HfApi

    return HfApi().model_info(REPO_ID, revision=revision).sha


def generate(jobs: list[dict], revision: str) -> None:
    import importlib.metadata

    import soundfile
    import torch
    from huggingface_hub import hf_hub_download
    from kokoro import KModel, KPipeline

    sha = resolve_revision(revision)
    config_path = hf_hub_download(REPO_ID, 'config.json', revision=sha)
    model_path = hf_hub_download(REPO_ID, MODEL_FILE, revision=sha)
    voice_path = hf_hub_download(REPO_ID, f'voices/{VOICE_ID}.pt', revision=sha)

    model = KModel(repo_id=REPO_ID, config=config_path, model=model_path).eval()
    pipeline = KPipeline(lang_code=LANG_CODE, repo_id=REPO_ID, model=model)
    g2p = make_g2p()
    pipeline.g2p = g2p  # espeak-ng の fallback を外した G2P に差し替える
    voice = pipeline.load_voice(voice_path)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    files: dict[str, dict] = {}
    for job in jobs:
        expected_phonemes = phonemize(g2p, job['input'])
        results = list(pipeline(job['input'], voice=voice, speed=SPEED))
        if not results or any(result.audio is None for result in results):
            raise SystemExit(f"音声を生成できませんでした: {job['input']!r}")
        phonemes = ' '.join(result.phonemes for result in results)
        if phonemes != expected_phonemes:
            raise SystemExit(f"発音記号が想定と違います: {job['input']!r} {phonemes!r} != {expected_phonemes!r}")
        audio = torch.cat([result.audio for result in results]).numpy()
        target = OUTPUT_DIR / job['path']
        soundfile.write(target, audio, SAMPLE_RATE, format='MP3', subtype='MPEG_LAYER_III', compression_level=MP3_COMPRESSION_LEVEL)
        data = target.read_bytes()
        files.setdefault(job['itemId'], {})[job['kind']] = {
            'path': job['path'],
            'text': job['text'],
            'input': job['input'],
            'phonemes': phonemes,
            'bytes': len(data),
            'durationMs': round(len(audio) / SAMPLE_RATE * 1000),
            'sha256': hashlib.sha256(data).hexdigest(),
        }
        print(f"{job['path']:<45} {len(data):>7} bytes  {phonemes}")

    manifest = {
        'description': 'Task 019: Kokoro 試聴用音声の一覧（tools/kokoro/generate.py が生成。手で編集しない）',
        'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
        'engine': {
            'kokoro': importlib.metadata.version('kokoro'),
            'misaki': importlib.metadata.version('misaki'),
            'torch': importlib.metadata.version('torch'),
            'espeakFallback': False,
        },
        'model': {'repoId': REPO_ID, 'revision': sha, 'file': MODEL_FILE, 'license': 'Apache-2.0'},
        'voice': {'id': VOICE_ID, 'language': 'en-US'},
        'speed': SPEED,
        'sampleRate': SAMPLE_RATE,
        'mimeType': 'audio/mpeg',
        'credit': 'Audio generated with Kokoro-82M by hexgrad (Apache License 2.0).',
        'files': files,
    }
    (OUTPUT_DIR / MANIFEST_NAME).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    total = sum(entry['bytes'] for item in files.values() for entry in item.values())
    print(f'{sum(len(item) for item in files.values())} files, {total} bytes -> {OUTPUT_DIR}')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--phonemes-only', action='store_true', help='モデルを使わず、G2P の発音記号だけを表示する')
    parser.add_argument('--revision', default='main', help='hexgrad/Kokoro-82M のリビジョン（再現するときは manifest.json の model.revision を指定）')
    args = parser.parse_args()

    jobs = list_jobs(load_items())
    if args.phonemes_only:
        print_phonemes(jobs)
    else:
        generate(jobs, args.revision)


if __name__ == '__main__':
    sys.exit(main())
