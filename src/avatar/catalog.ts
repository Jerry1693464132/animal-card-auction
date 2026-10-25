/**
 * 动物形象目录（纯外观，不影响牌局）。
 * 立绘参考：docs/art/avatars/（产品已提供 JPG）。
 */

export const DEFAULT_AVATAR_ID = "panda";

export type AvatarUnlock = "default" | "ad";

export interface AvatarDef {
  id: string;
  name: string;
  /** 占位色 / UI 描边参考（立绘见 docs/art/avatars） */
  color: string;
  unlock: AvatarUnlock;
}

export const AVATAR_CATALOG: readonly AvatarDef[] = [
  { id: "panda", name: "熊猫", color: "#E8EEF5", unlock: "default" },
];

const byId = new Map(AVATAR_CATALOG.map((a) => [a.id, a]));

export function getAvatarDef(id: string): AvatarDef | undefined {
  return byId.get(id);
}

export function isKnownAvatarId(id: string): boolean {
  return byId.has(id);
}

export function defaultUnlockedIds(): string[] {
  return AVATAR_CATALOG.filter((a) => a.unlock === "default").map((a) => a.id);
}
