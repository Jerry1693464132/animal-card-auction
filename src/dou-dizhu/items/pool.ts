import { ItemDefinition, ItemRarity } from "../types.js";
import {
  ALL_LANDLORD_ITEMS,
  EPIC_ITEMS,
  LEGENDARY_ITEMS,
  RARE_ITEMS,
} from "./definitions.js";

/** 品质权重：传说 20 / 史诗 40 / 精良 40 */
export const RARITY_WEIGHTS: Record<ItemRarity, number> = {
  [ItemRarity.Legendary]: 20,
  [ItemRarity.Epic]: 40,
  [ItemRarity.Rare]: 40,
};

export interface WeightedItem extends ItemDefinition {
  /** 在全局池中的相对权重（同品质内均分） */
  poolWeight: number;
}

function buildWeightedPool(items: ItemDefinition[], rarityWeight: number): WeightedItem[] {
  if (items.length === 0) return [];
  const each = rarityWeight / items.length;
  return items.map((item) => ({
    ...item,
    weight: rarityWeight,
    poolWeight: each,
  }));
}

/** 斗地主模式完整道具池 */
export const LANDLORD_ITEM_POOL: WeightedItem[] = [
  ...buildWeightedPool(LEGENDARY_ITEMS, RARITY_WEIGHTS[ItemRarity.Legendary]),
  ...buildWeightedPool(EPIC_ITEMS, RARITY_WEIGHTS[ItemRarity.Epic]),
  ...buildWeightedPool(RARE_ITEMS, RARITY_WEIGHTS[ItemRarity.Rare]),
];

export function rollLandlordItem(rng: () => number = Math.random): ItemDefinition {
  const total = LANDLORD_ITEM_POOL.reduce((sum, i) => sum + i.poolWeight, 0);
  let roll = rng() * total;
  for (const item of LANDLORD_ITEM_POOL) {
    roll -= item.poolWeight;
    if (roll <= 0) return item;
  }
  return LANDLORD_ITEM_POOL[LANDLORD_ITEM_POOL.length - 1];
}

/** 拍卖抽 N 个不重复道具（按品质权重、抽中即从本局池移除） */
export function rollUniqueItems(
  count: number,
  rng: () => number = Math.random,
): ItemDefinition[] {
  const pool = [...LANDLORD_ITEM_POOL];
  const result: ItemDefinition[] = [];
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    const total = pool.reduce((sum, item) => sum + item.poolWeight, 0);
    let roll = rng() * total;
    let picked = pool.length - 1;
    for (let j = 0; j < pool.length; j += 1) {
      roll -= pool[j]!.poolWeight;
      if (roll <= 0) {
        picked = j;
        break;
      }
    }
    result.push(pool.splice(picked, 1)[0]!);
  }
  return result;
}

export function itemsByRarity(rarity: ItemRarity): ItemDefinition[] {
  return ALL_LANDLORD_ITEMS.filter((i) => i.rarity === rarity);
}
