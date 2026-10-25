/**
 * 与服务端 src/avatar/seatRoles.ts 对齐：桌位固定动物，入座即扮演。
 * 出牌沿牌桌逆时针：下熊猫 → 右猫头鹰 → 上狐狸 → 左兔子。
 * 拍卖厅动物画在背景椅子上。牌桌头像：resources/avatars/{id}.jpg|.png
 */

export const TABLE_SEAT_ANIMALS = ["panda", "owl", "fox", "rabbit"] as const;

export type SeatAnimalId = (typeof TABLE_SEAT_ANIMALS)[number];

const SEAT_ANIMAL_NAMES: Record<SeatAnimalId, string> = {
  panda: "熊猫",
  fox: "狐狸",
  owl: "猫头鹰",
  rabbit: "兔子",
};

function roster(playerCount: number): readonly SeatAnimalId[] {
  return playerCount >= 4 ? TABLE_SEAT_ANIMALS : TABLE_SEAT_ANIMALS.slice(0, 3);
}

export function seatAnimalId(seatIndex: number, playerCount: number): SeatAnimalId {
  const list = roster(playerCount);
  const n = list.length;
  const i = ((seatIndex % n) + n) % n;
  return list[i] ?? "panda";
}

export function seatAnimalName(seatIndex: number, playerCount: number): string {
  return SEAT_ANIMAL_NAMES[seatAnimalId(seatIndex, playerCount)];
}

/** 局内技能选目标：用椅位动物名，不用微信昵称。 */
export function tableAnimalName(
  playerId: string,
  seatOrder: readonly string[] | undefined | null,
): string | null {
  const id = tableAnimalId(playerId, seatOrder);
  return id ? SEAT_ANIMAL_NAMES[id] : null;
}

export function tableAnimalId(
  playerId: string,
  seatOrder: readonly string[] | undefined | null,
): SeatAnimalId | null {
  if (!playerId || !seatOrder?.length) return null;
  const seat = seatOrder.indexOf(playerId);
  if (seat < 0) return null;
  return seatAnimalId(seat, seatOrder.length);
}

export const SEAT_ANIMAL_IDS: readonly string[] = TABLE_SEAT_ANIMALS;

export function seatAnimalNameById(id: string): string {
  return SEAT_ANIMAL_NAMES[id as SeatAnimalId] ?? id;
}

/** 三人场第四椅兔子在场但不入座，仅展示「观众」。 */
export function spectatorAnimalId(playerCount: number): SeatAnimalId | null {
  return playerCount === 3 ? "rabbit" : null;
}
