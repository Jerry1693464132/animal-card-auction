import { sys } from "cc";

// 沿用 party-cards 前缀，兼容升级前保存的本地音频设置。
const BGM_KEY = "party-cards:audio:bgm";
const SFX_KEY = "party-cards:audio:sfx";
const DEFAULT_BGM = 0.12;
const DEFAULT_SFX = 1;

type AudioListener = (bgm: number, sfx: number) => void;

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function read(key: string, fallback: number): number {
  try {
    const raw = sys.localStorage.getItem(key);
    if (raw == null) return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? clamp(value) : fallback;
  } catch {
    return fallback;
  }
}

let bgmVolume = read(BGM_KEY, DEFAULT_BGM);
let sfxVolume = read(SFX_KEY, DEFAULT_SFX);
const listeners = new Set<AudioListener>();

function notify(): void {
  for (const listener of listeners) listener(bgmVolume, sfxVolume);
}

export function getBgmVolume(): number {
  return bgmVolume;
}

export function getSfxVolume(): number {
  return sfxVolume;
}

export function setBgmVolume(value: number): void {
  bgmVolume = clamp(value);
  try {
    sys.localStorage.setItem(BGM_KEY, String(bgmVolume));
  } catch {
    // Storage can be unavailable in restricted previews.
  }
  notify();
}

export function setSfxVolume(value: number): void {
  sfxVolume = clamp(value);
  try {
    sys.localStorage.setItem(SFX_KEY, String(sfxVolume));
  } catch {
    // Storage can be unavailable in restricted previews.
  }
  notify();
}

export function onAudioVolumeChanged(listener: AudioListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

