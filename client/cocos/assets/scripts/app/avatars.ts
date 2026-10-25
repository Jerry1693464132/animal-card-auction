/**
 * 与服务端 src/avatar/catalog.ts 对齐（客户端只读展示，不裁决解锁）。
 * 立绘：docs/art/avatars/{id}.jpg
 */
export const DEFAULT_AVATAR_ID = "panda";

export interface AvatarDef {
  id: string;
  name: string;
  color: string;
  unlock: "default" | "ad";
}

/** 解锁目录仅熊猫。局内椅位动物见 seatAnimals.ts，不走本目录。 */
export const AVATAR_CATALOG: readonly AvatarDef[] = [
  { id: "panda", name: "熊猫", color: "#E8EEF5", unlock: "default" },
];

export function avatarName(id: string): string {
  return AVATAR_CATALOG.find((a) => a.id === id)?.name ?? id;
}

export function avatarColor(id: string): string {
  return AVATAR_CATALOG.find((a) => a.id === id)?.color ?? "#888888";
}
