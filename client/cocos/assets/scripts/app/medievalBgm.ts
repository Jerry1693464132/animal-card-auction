import { assetManager, AudioClip, AudioSource, director, Node } from "cc";
import { getBgmVolume, onAudioVolumeChanged } from "./audioSettings";

let bgmNode: Node | null = null;
let bgmSource: AudioSource | null = null;
let playlist: AudioClip[] = [];
let nextIndex = 0;
let loading = false;

onAudioVolumeChanged((bgm) => {
  if (bgmSource?.isValid) bgmSource.volume = bgm;
});

function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

function playNext(): void {
  const source = bgmSource;
  if (!source?.isValid || !playlist.length) return;
  if (nextIndex >= playlist.length) {
    playlist = shuffled(playlist);
    nextIndex = 0;
  }
  source.stop();
  source.clip = playlist[nextIndex++] ?? null;
  source.loop = false;
  source.volume = getBgmVolume();
  source.play();
}

/** 加载 CC0 中世纪曲库，并在场景切换时持续随机轮播。 */
export function startMedievalBgm(): void {
  if (bgmSource?.isValid) {
    if (!bgmSource.playing) bgmSource.play();
    return;
  }
  if (loading) return;
  loading = true;
  const start = (clips: AudioClip[]) => {
    loading = false;
    if (!clips.length || bgmSource?.isValid) return;
    const scene = director.getScene();
    if (!scene) return;

    playlist = shuffled(clips);
    nextIndex = 0;
    bgmNode = new Node("MedievalBgm");
    scene.addChild(bgmNode);
    director.addPersistRootNode(bgmNode);
    bgmSource = bgmNode.addComponent(AudioSource);
    bgmNode.on(AudioSource.EventType.ENDED, playNext);
    playNext();
  };

  const existing = assetManager.getBundle("music");
  const loadClips = (bundle: import("cc").AssetManager.Bundle) => {
    bundle.loadDir("", AudioClip, (error, clips) => {
      if (error || !clips.length) {
        loading = false;
        return;
      }
      start(clips);
    });
  };

  if (existing) {
    loadClips(existing);
    return;
  }
  assetManager.loadBundle("music", (error, bundle) => {
    if (error || !bundle) {
      loading = false;
      return;
    }
    loadClips(bundle);
  });
}
