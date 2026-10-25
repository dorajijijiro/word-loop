"""Task 020: 出題する全語彙の Kokoro 音声を事前生成する（開発時だけ使う。アプリには含めない）。

使い方は tools/kokoro/README.md を参照。
- 対象: 現在出題する語彙（src/data/words.ts の words。引退した語は含めない）。tools/kokoro/list-vocabulary.ts で取得する。
- 発音指定: src/data/vocabularyAudio/pronunciations.json（表示用の英語とは別に、Kokoro に渡す入力だけを指定する）
- 出力: public/audio/kokoro-vocabulary/{wordId}.mp3（要判断の語は比較用に {wordId}.{key}.mp3 も）と manifest.json
- モデル・声・設定は Task 019 と同じ（hexgrad/Kokoro-82M のリビジョンを固定、声 af_heart、速度 1.0、24kHz モノラル MP3）。
- 再開: モデル・声・設定・入力が一致し、ファイルのハッシュも一致する既存の音声は作り直さない。途中で止めても完了分は残る。
- 辞書にない語・生成に失敗した語は飛ばさず manifest.json の unresolved に残し、残りの生成は続ける。
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import generate as preview  # noqa: E402  Task 019 のスクリプト（モデル・声・G2P の設定を共有する）

ROOT = preview.ROOT
PRONUNCIATIONS_PATH = ROOT / 'src' / 'data' / 'vocabularyAudio' / 'pronunciations.json'
OUTPUT_DIR = ROOT / 'public' / 'audio' / 'kokoro-vocabulary'
MANIFEST_PATH = OUTPUT_DIR / 'manifest.json'
LIST_SCRIPT = ROOT / 'tools' / 'kokoro' / 'list-vocabulary.ts'

# Task 019 で利用条件を確認し、試聴したモデルのリビジョン（manifest.json の model.revision）
PINNED_REVISION = 'f3ff3571791e39611d31c381e3a41a3af07b4987'
# この件数ごとに manifest.json を書き出す（中断しても完了分を失わない）
SAVE_EVERY = 20

# 自動検査の基準（聴かなくても分かる異常だけを見る。発音の正しさは判定しない）
MIN_DURATION_MS = 300
MAX_DURATION_MS = 6000
MIN_PEAK = 0.1  # これより小さい最大振幅は音量が小さすぎる
CLIP_LEVEL = 0.999  # これ以上の振幅はクリッピングとみなす
MIN_RMS = 0.01  # これより小さい平均音量はほぼ無音
MAX_RMS = 0.3
SILENCE_LEVEL = 0.01
MAX_GAP_MS = 700  # 語・句の途中の無音がこれより長い
MIN_MS_PER_PHONEME = 45  # 発声部分の、発音記号1文字あたりの長さ（全語彙の中央値は約73ms）。極端に短い・長いものは途切れ・間延びの疑い
MAX_MS_PER_PHONEME = 160


def load_vocabulary() -> dict:
    result = subprocess.run(['node', str(LIST_SCRIPT)], cwd=ROOT, check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def load_pronunciations() -> dict[str, dict]:
    with PRONUNCIATIONS_PATH.open(encoding='utf-8') as file:
        return json.load(file)['items']


def list_jobs(vocabulary: dict, pronunciations: dict[str, dict]) -> list[dict]:
    words = {item['id']: item for item in vocabulary['items']}
    unknown = sorted(set(pronunciations) - set(words))
    if unknown:
        raise SystemExit(f'pronunciations.json に出題しない語があります: {unknown}')
    jobs = []
    for item in vocabulary['items']:
        spec = pronunciations.get(item['id'], {})
        jobs.append({'wordId': item['id'], 'key': None, 'path': f"{item['id']}.mp3", 'text': item['english'], 'input': spec.get('input', item['english']), 'override': 'input' in spec})
        for alternative in spec.get('alternatives', []):
            jobs.append({'wordId': item['id'], 'key': alternative['key'], 'path': f"{item['id']}.{alternative['key']}.mp3", 'text': item['english'], 'input': alternative['input'], 'override': True})
    return jobs


def settings(revision: str) -> dict:
    import importlib.metadata

    return {
        'revision': revision,
        'voice': preview.VOICE_ID,
        'speed': preview.SPEED,
        'sampleRate': preview.SAMPLE_RATE,
        'kokoro': importlib.metadata.version('kokoro'),
        'misaki': importlib.metadata.version('misaki'),
    }


def analyze(path: pathlib.Path, phonemes: str) -> tuple[dict, list[str]]:
    """MP3 を読み戻して、形式・長さ・無音・音量・クリッピングを調べる。"""
    import numpy
    import soundfile

    info = soundfile.info(path)
    audio, rate = soundfile.read(path, dtype='float32')
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    duration_ms = round(len(audio) / rate * 1000)
    frame = max(1, rate // 100)  # 10ms ごとの音量
    levels = numpy.array([numpy.abs(audio[i : i + frame]).max() for i in range(0, len(audio), frame)]) if len(audio) else numpy.array([0.0])
    voiced = numpy.flatnonzero(levels >= SILENCE_LEVEL)
    gap_ms = 0
    if len(voiced) > 1:
        gap_ms = int((numpy.diff(voiced).max() - 1) * 10)
    checks = {
        'format': f'{info.format}/{info.subtype}',
        'sampleRate': rate,
        'channels': info.channels,
        'peak': round(float(numpy.abs(audio).max()) if len(audio) else 0.0, 3),
        'rms': round(float(numpy.sqrt(numpy.mean(audio**2))) if len(audio) else 0.0, 4),
        'clipped': int(numpy.count_nonzero(numpy.abs(audio) >= CLIP_LEVEL)),
        'leadingSilenceMs': int(voiced[0] * 10) if len(voiced) else duration_ms,
        'trailingSilenceMs': int((len(levels) - 1 - voiced[-1]) * 10) if len(voiced) else duration_ms,
        'longestGapMs': gap_ms,
    }
    # 前後の無音を除いた発声部分の長さで、発音記号1文字あたりの長さを見る
    speech_ms = duration_ms - checks['leadingSilenceMs'] - checks['trailingSilenceMs']
    checks['speechMs'] = speech_ms
    letters = sum(1 for c in phonemes if c.isalpha())
    warnings = []
    if info.format != 'MP3' or rate != preview.SAMPLE_RATE or info.channels != 1:
        warnings.append(f"形式が想定と違う（{checks['format']}・{rate}Hz・{info.channels}ch）")
    if not MIN_DURATION_MS <= duration_ms <= MAX_DURATION_MS:
        warnings.append(f'長さが範囲外（{duration_ms}ms）')
    if letters and not MIN_MS_PER_PHONEME <= speech_ms / letters <= MAX_MS_PER_PHONEME:
        warnings.append(f'発音記号の長さに対して発声が極端に短い・長い（{round(speech_ms / letters)}ms/音）')
    if checks['peak'] < MIN_PEAK or checks['rms'] < MIN_RMS:
        warnings.append('音量が小さすぎる・無音の疑い')
    if checks['rms'] > MAX_RMS:
        warnings.append('音量が大きすぎる')
    if checks['clipped'] > 0:
        warnings.append(f"クリッピング（{checks['clipped']}サンプル）")
    if gap_ms > MAX_GAP_MS:
        warnings.append(f'途中に長い無音（{gap_ms}ms）')
    return {'durationMs': duration_ms, 'checks': checks}, warnings


def load_manifest() -> dict:
    if MANIFEST_PATH.exists():
        with MANIFEST_PATH.open(encoding='utf-8') as file:
            return json.load(file)
    return {'files': {}, 'unresolved': []}


def write_manifest(conf: dict, files: dict[str, dict], unresolved: list[dict], jobs: list[dict]) -> None:
    ordered = {}
    for job in jobs:
        entry = files.get(job['path'])
        if entry is not None:
            ordered[job['path']] = entry
    total = sum(entry['bytes'] for entry in ordered.values())
    header = {
        'description': 'Task 020: 全語彙の Kokoro 音声の一覧（tools/kokoro/generate_vocabulary.py が生成。手で編集しない）',
        'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
        'model': {'repoId': preview.REPO_ID, 'revision': conf['revision'], 'file': preview.MODEL_FILE, 'license': 'Apache-2.0'},
        'engine': {'kokoro': conf['kokoro'], 'misaki': conf['misaki'], 'espeakFallback': False},
        'voice': {'id': conf['voice'], 'language': 'en-US'},
        'speed': conf['speed'],
        'sampleRate': conf['sampleRate'],
        'mimeType': 'audio/mpeg',
        'credit': 'Audio generated with Kokoro-82M by hexgrad (Apache License 2.0).',
        'targetCount': len({job['wordId'] for job in jobs}),
        'fileCount': len(ordered),
        'totalBytes': total,
    }
    # 差分を読みやすくするため、音声1件を1行で書く
    lines = ['{']
    for key, value in header.items():
        lines.append(f'  {json.dumps(key)}: {json.dumps(value, ensure_ascii=False)},')
    lines.append(f'  "unresolved": {json.dumps(unresolved, ensure_ascii=False)},')
    lines.append('  "files": {')
    entries = [f'    {json.dumps(path)}: {json.dumps(entry, ensure_ascii=False, separators=(",", ":"))}' for path, entry in ordered.items()]
    lines.append(',\n'.join(entries))
    lines.append('  }')
    lines.append('}')
    tmp = MANIFEST_PATH.with_suffix('.json.tmp')
    tmp.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    tmp.replace(MANIFEST_PATH)


def reusable(entry: dict | None, job: dict, conf: dict) -> bool:
    if entry is None:
        return False
    same = all(entry.get(key) == conf[key] for key in ('revision', 'voice', 'speed')) and entry.get('input') == job['input'] and entry.get('engine') == f"kokoro {conf['kokoro']} / misaki {conf['misaki']}"
    target = OUTPUT_DIR / job['path']
    return same and target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == entry.get('sha256')


def run(revision: str, only: set[str], check_only: bool) -> None:
    vocabulary = load_vocabulary()
    jobs = list_jobs(vocabulary, load_pronunciations())
    retired = set(vocabulary['retiredWordIds'])
    if retired & {job['wordId'] for job in jobs}:
        raise SystemExit('引退した語が対象に含まれています')
    unknown_only = only - {job['wordId'] for job in jobs}
    if unknown_only:
        raise SystemExit(f'--only に出題しない語があります: {sorted(unknown_only)}')

    previous = load_manifest()
    files: dict[str, dict] = dict(previous.get('files', {}))
    g2p = preview.make_g2p()
    conf = settings(revision)
    if conf['kokoro'] != '0.9.4' or conf['misaki'] != '0.9.4':
        raise SystemExit(f"kokoro・misaki の版が Task 019 と違います: {conf['kokoro']} / {conf['misaki']}")

    if check_only:
        stale = [job['path'] for job in jobs if not reusable(files.get(job['path']), job, conf)]
        print(f'一致 {len(jobs) - len(stale)} / 未生成または設定・入力が変わった {len(stale)}')
        for path in stale:
            print(f'  {path}')
        return

    pipeline = voice = None
    unresolved: list[dict] = []
    done = reused = 0
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    try:
        for index, job in enumerate(jobs, 1):
            entry = files.get(job['path'])
            if job['wordId'] not in only and reusable(entry, job, conf):
                # 検査の基準を変えたときも反映されるよう、再利用する音声も検査し直す
                measured, warnings = analyze(OUTPUT_DIR / job['path'], entry['phonemes'])
                entry.update(measured, warnings=warnings)
                reused += 1
                continue
            try:
                expected = preview.phonemize(g2p, job['input'])
            except SystemExit as error:  # 辞書にない語
                unresolved.append({'wordId': job['wordId'], 'path': job['path'], 'reason': str(error)})
                files.pop(job['path'], None)
                continue
            if pipeline is None:
                pipeline, voice = load_pipeline(revision, g2p)
            try:
                results = list(pipeline(job['input'], voice=voice, speed=preview.SPEED))
                if not results or any(result.audio is None for result in results):
                    raise RuntimeError('音声が空')
                phonemes = ' '.join(result.phonemes for result in results)
                if phonemes != expected:
                    raise RuntimeError(f'発音記号が想定と違う: {phonemes!r} != {expected!r}')
                write_mp3(OUTPUT_DIR / job['path'], results)
            except Exception as error:  # noqa: BLE001  1件の失敗で全体を止めない
                unresolved.append({'wordId': job['wordId'], 'path': job['path'], 'reason': f'生成に失敗: {error}'})
                files.pop(job['path'], None)
                continue
            target = OUTPUT_DIR / job['path']
            data = target.read_bytes()
            measured, warnings = analyze(target, phonemes)
            files[job['path']] = {
                'wordId': job['wordId'],
                **({'key': job['key']} if job['key'] else {}),
                'text': job['text'],
                'input': job['input'],
                'override': job['override'],
                'phonemes': phonemes,
                'revision': conf['revision'],
                'voice': conf['voice'],
                'speed': conf['speed'],
                'engine': f"kokoro {conf['kokoro']} / misaki {conf['misaki']}",
                'bytes': len(data),
                'durationMs': measured['durationMs'],
                'sha256': hashlib.sha256(data).hexdigest(),
                'checks': measured['checks'],
                'warnings': warnings,
            }
            done += 1
            print(f"[{index}/{len(jobs)}] {job['path']:<45} {len(data):>6} bytes  {phonemes}{'  ⚠ ' + ' / '.join(warnings) if warnings else ''}", flush=True)
            if done % SAVE_EVERY == 0:
                write_manifest(conf, files, unresolved, jobs)
    finally:
        expected_paths = {job['path'] for job in jobs}
        for path in list(files):
            if path not in expected_paths:  # 語彙から外れた・指定を外した音声
                files.pop(path)
                (OUTPUT_DIR / path).unlink(missing_ok=True)
        write_manifest(conf, files, unresolved, jobs)
    total = sum(entry['bytes'] for entry in files.values())
    warned = [path for path, entry in files.items() if entry['warnings']]
    print(f'生成 {done} / 再利用 {reused} / 未解決 {len(unresolved)} / 警告 {len(warned)} / {len(files)} files, {total} bytes -> {OUTPUT_DIR}')
    for item in unresolved:
        print(f"  未解決: {item['path']}: {item['reason']}")
    for path in warned:
        print(f"  警告: {path}: {' / '.join(files[path]['warnings'])}")


def load_pipeline(revision: str, g2p):
    from huggingface_hub import hf_hub_download
    from kokoro import KModel, KPipeline

    config_path = hf_hub_download(preview.REPO_ID, 'config.json', revision=revision)
    model_path = hf_hub_download(preview.REPO_ID, preview.MODEL_FILE, revision=revision)
    voice_path = hf_hub_download(preview.REPO_ID, f'voices/{preview.VOICE_ID}.pt', revision=revision)
    model = KModel(repo_id=preview.REPO_ID, config=config_path, model=model_path).eval()
    pipeline = KPipeline(lang_code=preview.LANG_CODE, repo_id=preview.REPO_ID, model=model)
    pipeline.g2p = g2p  # espeak-ng の fallback を外した G2P に差し替える
    return pipeline, pipeline.load_voice(voice_path)


def write_mp3(target: pathlib.Path, results) -> None:
    import soundfile
    import torch

    audio = torch.cat([result.audio for result in results]).numpy()
    tmp = target.with_suffix('.tmp.mp3')
    soundfile.write(tmp, audio, preview.SAMPLE_RATE, format='MP3', subtype='MPEG_LAYER_III', compression_level=preview.MP3_COMPRESSION_LEVEL)
    tmp.replace(target)  # 書きかけのファイルを残さない


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--only', default='', help='作り直す wordId（カンマ区切り）。ほかの語は条件が一致すれば再利用する')
    parser.add_argument('--check', action='store_true', help='生成せず、既存の音声が今の設定・入力と一致するかだけ調べる（ファイルは変更しない）')
    parser.add_argument('--revision', default=PINNED_REVISION, help='hexgrad/Kokoro-82M のリビジョン（既定は Task 019 と同じ）')
    args = parser.parse_args()
    only = {word_id.strip() for word_id in args.only.split(',') if word_id.strip()}
    run(args.revision, only, args.check)


if __name__ == '__main__':
    sys.exit(main())
