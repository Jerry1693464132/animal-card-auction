"""Download verified CC0 medieval music for the Cocos client.

Source: RandomMind's medieval series on OpenGameArt.
Each page is checked for both the author and CC0 before its MP3 is downloaded.
"""
from __future__ import annotations

import hashlib
import html
import json
import re
import subprocess
from pathlib import Path

import imageio_ffmpeg
import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "client" / "cocos-cli-smoke-test" / "assets" / "resources" / "music"

SLUGS = [
    "medieval-the-old-tower-inn",
    "medieval-kings-feast",
    "medieval-minstrel-dance",
    "medieval-market-day",
    "medieval-harvest-season",
    "medieval-rejoicing",
    "medieval-exploration",
    "medieval-battle",
    "medieval-victory-theme",
    "medieval-defeat-theme",
    "medieval-the-bards-tale",
]


def page_audio(slug: str) -> tuple[str, str, str]:
    page_url = f"https://opengameart.org/content/{slug}"
    response = requests.get(page_url, timeout=30)
    response.raise_for_status()
    body = response.text
    if "RandomMind" not in body or "CC0" not in body:
        raise RuntimeError(f"license/author verification failed: {page_url}")
    title_match = re.search(r"<title[^>]*>(.*?)\s*\|\s*OpenGameArt", body, re.I | re.S)
    title = html.unescape(re.sub(r"<[^>]+>", "", title_match.group(1))).strip() if title_match else slug
    links = re.findall(r'href="([^"]+\.mp3(?:\?[^"]*)?)"', body, re.I)
    if not links:
        raise RuntimeError(f"no MP3 attachment: {page_url}")
    # Prefer an explicitly looped MP3 when the author supplied one.
    audio_url = next((link for link in links if "loop" in link.lower()), links[0])
    return title, page_url, html.unescape(audio_url)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    manifest: list[dict[str, object]] = []
    for index, slug in enumerate(SLUGS, 1):
        title, page_url, audio_url = page_audio(slug)
        response = requests.get(audio_url, timeout=90)
        response.raise_for_status()
        data = response.content
        if len(data) < 10_000:
            raise RuntimeError(f"audio download too small: {audio_url}")
        filename = f"{index:02d}-{slug.removeprefix('medieval-')}.mp3"
        destination = OUT / filename
        source_file = destination.with_name(f"{destination.stem}-source.mp3")
        source_file.write_bytes(data)
        subprocess.run(
            [
                ffmpeg,
                "-y",
                "-loglevel",
                "error",
                "-i",
                str(source_file),
                "-map_metadata",
                "-1",
                "-codec:a",
                "libmp3lame",
                "-b:a",
                "80k",
                str(destination),
            ],
            check=True,
        )
        source_file.unlink()
        packed = destination.read_bytes()
        entry = {
            "file": filename,
            "title": title,
            "author": "RandomMind",
            "license": "CC0 1.0",
            "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
            "sourcePage": page_url,
            "downloadUrl": audio_url,
            "sourceBytes": len(data),
            "sourceSha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(packed),
            "sha256": hashlib.sha256(packed).hexdigest(),
        }
        manifest.append(entry)
        print(f"{filename}: {len(data)} -> {len(packed)} bytes")

    (OUT / "music-sources.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (OUT / "LICENSE-CC0.txt").write_text(
        "All music files in this directory are by RandomMind and released under CC0 1.0.\n"
        "License: https://creativecommons.org/publicdomain/zero/1.0/\n"
        "Per-track source pages and file hashes are recorded in music-sources.json.\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
