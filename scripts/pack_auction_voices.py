/**
 * 动物语音已改为 Cocos AudioClip 分包加载。
 * 本脚本只统计 assets/sfx 下的 voice-*.mp3，不再生成 Base64 TypeScript。
 */
import pathlib

sfx = pathlib.Path(r"c:\Users\ABC\Desktop\cursor\client\cocos-cli-smoke-test\assets\sfx")
voices = sorted(sfx.glob("voice-*.mp3"))
if not voices:
    raise SystemExit(f"no voice-*.mp3 under {sfx}")
total = 0
for path in voices:
    size = path.stat().st_size
    total += size
    print(f"{path.stem} {size}")
print(f"count {len(voices)} totalBytes {total}")
