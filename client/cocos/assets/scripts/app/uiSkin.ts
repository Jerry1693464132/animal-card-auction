/**
 * 主界面 UI 贴图加载（有图用图，无图则调用方 Graphics 兜底）。
 */
import { SpriteFrame, resources } from "cc";

const cache = new Map<string, SpriteFrame | null>();

function pathsFor(name: string): string[] {
  // 微信包体压缩后部分 UI 改为 jpg，保留原 png 路径兼容。
  return [
    `ui/${name}.png/spriteFrame`,
    `ui/${name}.jpg/spriteFrame`,
    `ui/${name}/spriteFrame`,
    `ui/${name}`,
  ];
}

export function loadUiSpriteFrame(name: string): Promise<SpriteFrame | null> {
  if (cache.has(name)) return Promise.resolve(cache.get(name) ?? null);
  return new Promise((resolve) => {
    const paths = pathsFor(name);
    let i = 0;
    const tryNext = () => {
      if (i >= paths.length) {
        cache.set(name, null);
        resolve(null);
        return;
      }
      const path = paths[i++];
      resources.load(path, SpriteFrame, (err, sf) => {
        if (!err && sf) {
          cache.set(name, sf);
          resolve(sf);
        } else tryNext();
      });
    };
    tryNext();
  });
}

/** 已请求过则返回缓存（含加载失败的 null）；尚未请求返回 undefined。 */
export function peekUiSpriteFrame(name: string): SpriteFrame | null | undefined {
  if (!cache.has(name)) return undefined;
  return cache.get(name);
}

/** 资源替换后清缓存，避免一直用到旧的 null / 旧贴图 */
export function clearUiSpriteCache(name?: string): void {
  if (name) cache.delete(name);
  else cache.clear();
}
