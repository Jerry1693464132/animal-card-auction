# coding=utf-8
"""Generate animal voice lines with Qwen-Audio-3.0-TTS-Plus.

Reads DASHSCOPE_API_KEY from the process env or a gitignored .env file.
Never prints the key.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_dotenv(ROOT / ".env")

import dashscope
from dashscope.audio.tts_v2 import AudioFormat, SpeechSynthesizer

dashscope.base_websocket_api_url = os.environ.get(
    "DASHSCOPE_TTS_WS",
    "wss://ws-nybiusfq4uh9s92e.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference",
)
dashscope.api_key = os.environ.get("DASHSCOPE_API_KEY", "").strip()
if not dashscope.api_key:
    print("DASHSCOPE_API_KEY missing", file=sys.stderr)
    sys.exit(1)

MODEL = "qwen-audio-3.0-tts-plus"
OUT = Path(__file__).resolve().parents[1] / "client" / "cocos-cli-smoke-test" / "assets" / "sfx"
OUT.mkdir(parents=True, exist_ok=True)

# Distinct animal deliveries on the two plus system voices + instruction/pitch.
ANIMALS = {
    "panda": {
        "voice": "longanlufeng",
        # 熊猫使用系统男声干声；风格指令容易让模型加入空间感/混响。
        "instruction": "",
        "speech_rate": 1.16,
        "pitch_rate": 1.05,
    },
    "fox": {
        "voice": "longanlufeng",
        "instruction": "用狡猾轻快、得意的狐狸口吻说，语速略快，带着一点坏笑。",
        "speech_rate": 1.12,
        "pitch_rate": 1.08,
    },
    "owl": {
        "voice": "longanlufeng",
        "instruction": "用沉稳博学的猫头鹰口吻说，吐字干脆利落，不要拖腔，语速正常偏快。",
        "speech_rate": 1.18,
        "pitch_rate": 0.92,
    },
    "rabbit": {
        "voice": "longanlingxin",
        "instruction": "用软萌可爱、轻轻上扬的小兔子口吻说，语速略快。",
        "speech_rate": 1.14,
        "pitch_rate": 1.22,
    },
}

LINES = {
    "raise": "加价",
    "allin": "All in",
    "nodouble": "不加倍",
    "double": "加倍",
    "superdouble": "超级加倍",
}

POINT_LINES = {
    "3": "3",
    "4": "4",
    "5": "5",
    "6": "6",
    "7": "7",
    "8": "8",
    "9": "9",
    "10": "10",
    "j": "J",
    "q": "Q",
    "k": "K",
    "14": "14",
    "15": "15",
    "16": "16",
    "17": "17",
    "18": "18",
    "19": "19",
    "a": "A",
    "2": "2",
    "small-joker": "小王",
    "big-joker": "大王",
}

PLAY_LINES = {
    "play-bomb": "炸弹",
    "play-rocket": "王炸",
    "play-straight": "顺子",
    "play-consecutive-pairs": "连对",
    "play-airplane": "飞机",
    "play-triple-single": "三带一",
    "play-triple-pair": "三带一对",
    "play-four-two": "四带二",
    "play-pass": "不要",
    **{f"play-single-{key}": text for key, text in POINT_LINES.items()},
    **{f"play-pair-{key}": f"对{text}" for key, text in POINT_LINES.items()},
}

QUICK_CHAT_LINES = {
    "chat-just-this": "就这啊",
    "chat-easy-win": "这把随便赢咯",
    "chat-be-friends": "哥们，交个朋友呗",
    "chat-cant-afford-wrong": "错不起，我对了",
    "chat-kidding-bro": "搞笑呢兄弟",
}

LINES.update(PLAY_LINES)
LINES.update(QUICK_CHAT_LINES)


def synth(animal: str, kind: str) -> bytes:
    cfg = ANIMALS[animal]
    text = LINES[kind]
    kwargs = dict(
        model=MODEL,
        voice=cfg["voice"],
        format=AudioFormat.MP3_22050HZ_MONO_256KBPS,
        volume=70,
        speech_rate=cfg["speech_rate"],
        pitch_rate=cfg["pitch_rate"],
    )
    if cfg["instruction"]:
        kwargs["instruction"] = cfg["instruction"]
    try:
        audio = SpeechSynthesizer(**kwargs).call(text)
    except Exception as err:
        print(f"{animal}/{kind} with instruction failed: {err}; retry plain")
        kwargs.pop("instruction", None)
        audio = SpeechSynthesizer(**kwargs).call(text)
    if not audio:
        raise RuntimeError(f"empty audio for {animal}/{kind}")
    return audio


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("animals", nargs="*", choices=ANIMALS)
    parser.add_argument("--kinds", nargs="*")
    parser.add_argument("--play", action="store_true", help="generate all play/pass calls")
    parser.add_argument("--quick-chat", action="store_true", help="generate all quick-chat calls")
    args = parser.parse_args()
    wanted_animals = args.animals or list(ANIMALS)
    if args.play or args.quick_chat:
        wanted_kinds = []
        if args.play:
            wanted_kinds.extend(PLAY_LINES)
        if args.quick_chat:
            wanted_kinds.extend(QUICK_CHAT_LINES)
    else:
        wanted_kinds = args.kinds or list(LINES)
    wanted_kinds = [kind for kind in wanted_kinds if kind in LINES]
    if not wanted_kinds:
        print("No valid voice kinds selected", file=sys.stderr)
        sys.exit(2)
    for animal in wanted_animals:
        for kind in wanted_kinds:
            dest = OUT / f"voice-{animal}-{kind}.mp3"
            print(f"generating {dest.name} ...")
            data = synth(animal, kind)
            dest.write_bytes(data)
            print(f"  wrote {len(data)} bytes")


if __name__ == "__main__":
    main()
