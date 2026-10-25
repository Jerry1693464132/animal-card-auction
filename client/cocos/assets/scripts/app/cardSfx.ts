/**
 * 选牌：合成纸声。按钮：Kenney UI Audio click1（CC0，https://kenney.nl/assets/ui-audio）。
 * 动物语音从 sfx Asset Bundle 加载，避免 Base64 打进主包脚本。
 */
import { assetManager, AudioClip, AudioSource, director, Node } from "cc";
import { KENNEY_CLICK1_WAV_B64 } from "./kenneyUiClickWav";
import { getSfxVolume } from "./audioSettings";
import type { SeatAnimalId } from "./seatAnimals";

type MiniAudio = {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

let ctx: AudioContext | null = null;
let chain = 0;
let chainAt = 0;
let btnAt = 0;
let clickBuf: AudioBuffer | null = null;
let clickLoading: Promise<AudioBuffer | null> | null = null;
const voiceClips = new Map<string, AudioClip>();
const voiceLoading = new Map<string, Promise<AudioClip | null>>();
let sfxBundleLoading: Promise<import("cc").AssetManager.Bundle | null> | null = null;
let voiceNode: Node | null = null;
let voiceSource: AudioSource | null = null;
let voiceNextAt = 0;

function audioCtx(): AudioContext | null {
  if (ctx) return ctx;
  const g = globalThis as MiniAudio;
  try {
    const Ctor = g.AudioContext ?? g.webkitAudioContext;
    if (Ctor) ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** 第一次触摸时解锁（浏览器 / 桌面都需要用户手势） */
export function unlockCardSfx(): void {
  const ac = audioCtx();
  if (ac && ac.state === "suspended") void ac.resume();
  void ensureClickBuffer();
  void ensureSfxBundle();
}

export const unlockSfx = unlockCardSfx;

export function preloadAuctionVoices(): void {
  unlockCardSfx();
  for (const animal of ["panda", "fox", "owl", "rabbit"] as const) {
    void ensureVoiceBuffer(`${animal}-raise`);
    void ensureVoiceBuffer(`${animal}-allin`);
  }
}

export function preloadDoubleVoices(): void {
  unlockCardSfx();
  for (const animal of ["panda", "fox", "owl", "rabbit"] as const) {
    void ensureVoiceBuffer(`${animal}-nodouble`);
    void ensureVoiceBuffer(`${animal}-double`);
    void ensureVoiceBuffer(`${animal}-superdouble`);
  }
}

export const QUICK_CHAT_VOICE_KINDS = [
  "just-this",
  "easy-win",
  "be-friends",
  "cant-afford-wrong",
  "kidding-bro",
] as const;
export type QuickChatVoiceKind = (typeof QUICK_CHAT_VOICE_KINDS)[number];

export function preloadQuickChatVoices(): void {
  unlockCardSfx();
  for (const animal of ["panda", "fox", "owl", "rabbit"] as const) {
    for (const kind of QUICK_CHAT_VOICE_KINDS) void ensureVoiceBuffer(`${animal}-chat-${kind}`);
  }
}

function ensureSfxBundle(): Promise<import("cc").AssetManager.Bundle | null> {
  const hit = assetManager.getBundle("sfx");
  if (hit) return Promise.resolve(hit);
  if (sfxBundleLoading) return sfxBundleLoading;
  sfxBundleLoading = new Promise((resolve) => {
    assetManager.loadBundle("sfx", (error, bundle) => {
      sfxBundleLoading = null;
      resolve(error || !bundle ? null : bundle);
    });
  });
  return sfxBundleLoading;
}

function ensureVoiceSource(): AudioSource | null {
  if (voiceSource?.isValid) return voiceSource;
  const scene = director.getScene();
  if (!scene) return null;
  voiceNode = new Node("AnimalVoiceSfx");
  scene.addChild(voiceNode);
  director.addPersistRootNode(voiceNode);
  voiceSource = voiceNode.addComponent(AudioSource);
  return voiceSource;
}

function ensureVoiceBuffer(key: string): Promise<AudioClip | null> {
  const hit = voiceClips.get(key);
  if (hit) return Promise.resolve(hit);
  const pending = voiceLoading.get(key);
  if (pending) return pending;
  const job = ensureSfxBundle().then(
    (bundle) =>
      new Promise<AudioClip | null>((resolve) => {
        if (!bundle) {
          voiceLoading.delete(key);
          resolve(null);
          return;
        }
        bundle.load(`voice-${key}`, AudioClip, (error, clip) => {
          voiceLoading.delete(key);
          if (error || !clip) {
            resolve(null);
            return;
          }
          voiceClips.set(key, clip);
          resolve(clip);
        });
      }),
  );
  voiceLoading.set(key, job);
  return job;
}

export type PlayVoiceKind =
  | "bomb"
  | "rocket"
  | "straight"
  | "consecutive-pairs"
  | "airplane"
  | "triple-single"
  | "triple-pair"
  | "four-two"
  | "pass"
  | `single-${string}`
  | `pair-${string}`;

type AnimalVoiceKind =
  | "raise"
  | "allin"
  | "nodouble"
  | "double"
  | "superdouble"
  | `play-${PlayVoiceKind}`
  | `chat-${QuickChatVoiceKind}`;

function playAnimalCallSfx(animal: SeatAnimalId, kind: AnimalVoiceKind): void {
  const volume = getSfxVolume();
  if (volume <= 0) return;
  const key = `${animal}-${kind}`;
  void ensureVoiceBuffer(key).then((clip) => {
    const source = ensureVoiceSource();
    if (!clip || !source) return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const startAt = Math.max(now, voiceNextAt);
    voiceNextAt = startAt + clip.getDuration() * 1000 + 80;
    const play = () => {
      if (source.isValid) source.playOneShot(clip, 0.95 * getSfxVolume());
    };
    const delay = Math.max(0, startAt - now);
    if (delay <= 1) play();
    else setTimeout(play, delay);
  });
}

/** 椅位动物喊「加价」或「All in」 */
export function playAuctionCallSfx(animal: SeatAnimalId, kind: "raise" | "allin"): void {
  playAnimalCallSfx(animal, kind);
}

/** 椅位动物喊开局加倍选择 */
export function playDoubleCallSfx(
  animal: SeatAnimalId,
  choice: "none" | "double" | "super",
): void {
  const kind = choice === "none" ? "nodouble" : choice === "super" ? "superdouble" : "double";
  playAnimalCallSfx(animal, kind);
}

/** 椅位动物喊出牌牌型、点数或「不要」 */
export function playCardCallSfx(animal: SeatAnimalId, kind: PlayVoiceKind): void {
  playAnimalCallSfx(animal, `play-${kind}`);
}

/** 播放牌桌快捷对话。 */
export function playQuickChatSfx(animal: SeatAnimalId, kind: QuickChatVoiceKind): void {
  playAnimalCallSfx(animal, `chat-${kind}`);
}

/**
 * base64 → ArrayBuffer。
 */
function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const table =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, "");
  let padding = 0;
  if (clean.endsWith("==")) padding = 2;
  else if (clean.endsWith("=")) padding = 1;
  const byteLen = (clean.length / 4) * 3 - padding;
  const bytes = new Uint8Array(byteLen);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = table.indexOf(clean[i]);
    const c1 = table.indexOf(clean[i + 1]);
    const c2 = table.indexOf(clean[i + 2]);
    const c3 = table.indexOf(clean[i + 3]);
    const n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (p < byteLen) bytes[p++] = (n >> 16) & 0xff;
    if (p < byteLen) bytes[p++] = (n >> 8) & 0xff;
    if (p < byteLen) bytes[p++] = n & 0xff;
  }
  return bytes.buffer;
}

function decodeWav(ac: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    let done = false;
    const ok = (buf: AudioBuffer) => {
      if (done) return;
      done = true;
      resolve(buf);
    };
    const bad = (err?: unknown) => {
      if (done) return;
      done = true;
      reject(err);
    };
    try {
      const ret = ac.decodeAudioData(data.slice(0), ok, bad) as Promise<AudioBuffer> | void;
      if (ret && typeof ret.then === "function") ret.then(ok, bad);
    } catch (err) {
      bad(err);
    }
  });
}

function ensureClickBuffer(): Promise<AudioBuffer | null> {
  if (clickBuf) return Promise.resolve(clickBuf);
  const ac = audioCtx();
  if (!ac) return Promise.resolve(null);
  if (!clickLoading) {
    clickLoading = decodeWav(ac, b64ToArrayBuffer(KENNEY_CLICK1_WAV_B64))
      .then((buf) => {
        clickBuf = buf;
        return buf;
      })
      .catch(() => {
        clickLoading = null;
        return null;
      });
  }
  return clickLoading;
}

/** Kenney click1：短促真实按键，不再用合成蜂鸣 */
export function playButtonSfx(): void {
  const volume = getSfxVolume();
  if (volume <= 0) return;
  const ac = audioCtx();
  if (!ac) return;
  if (ac.state === "suspended") void ac.resume();

  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (now - btnAt < 42) return;
  btnAt = now;

  void ensureClickBuffer().then((buf) => {
    if (!buf || !ac) return;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const gain = ac.createGain();
    gain.gain.value = 0.72 * volume;
    src.connect(gain);
    gain.connect(ac.destination);
    src.start(0);
  });
}

function noiseBuffer(ac: AudioContext, seconds: number): AudioBuffer {
  const n = Math.max(1, Math.floor(ac.sampleRate * seconds));
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i += 1) {
    const env = (1 - i / n) ** 2.6;
    data[i] = (Math.random() * 2 - 1) * env;
  }
  return buf;
}

/**
 * @param selected true = 选中抬起，false = 放下取消
 */
export function playCardSelectSfx(selected: boolean): void {
  const volume = getSfxVolume();
  if (volume <= 0) return;
  const ac = audioCtx();
  if (!ac) return;
  if (ac.state === "suspended") void ac.resume();

  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  if (now - chainAt > 260) chain = 0;
  chainAt = now;
  const step = Math.min(chain, 5);
  chain += 1;

  const t0 = ac.currentTime;
  const paper = ac.createGain();
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = selected ? 1450 + step * 90 : 980 - step * 40;
  filter.Q.value = 0.75;
  const noise = ac.createBufferSource();
  noise.buffer = noiseBuffer(ac, 0.045);
  noise.connect(filter);
  filter.connect(paper);
  paper.connect(ac.destination);
  paper.gain.setValueAtTime((selected ? 0.28 : 0.2) * volume, t0);
  paper.gain.exponentialRampToValueAtTime(0.001, t0 + 0.045);
  noise.start(t0);
  noise.stop(t0 + 0.05);

  const tick = ac.createOscillator();
  tick.type = "triangle";
  tick.frequency.setValueAtTime(selected ? 620 + step * 35 : 360 - step * 18, t0);
  const tickGain = ac.createGain();
  tick.connect(tickGain);
  tickGain.connect(ac.destination);
  tickGain.gain.setValueAtTime((selected ? 0.07 : 0.05) * volume, t0);
  tickGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.03);
  tick.start(t0);
  tick.stop(t0 + 0.035);
}
