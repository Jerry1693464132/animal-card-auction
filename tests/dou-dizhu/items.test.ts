import { describe, expect, it } from "vitest";
import {
  ALL_LANDLORD_ITEMS,
  EPIC_ITEMS,
  LEGENDARY_ITEMS,
  RARE_ITEMS,
  ItemRarity,
  LANDLORD_ITEM_POOL,
  RARITY_WEIGHTS,
  getItem,
  rollLandlordItem,
  rollUniqueItems,
  sortItemsActiveFirst,
  formatDrawnCardHint,
  CardKind,
  Rank,
} from "../../src/index.js";

describe("landlord item pool", () => {
  it("has all defined items", () => {
    expect(LEGENDARY_ITEMS).toHaveLength(11);
    expect(EPIC_ITEMS).toHaveLength(11);
    expect(RARE_ITEMS).toHaveLength(10);
    expect(ALL_LANDLORD_ITEMS).toHaveLength(32);
  });

  it("rarity weights sum to 100", () => {
    const sum =
      RARITY_WEIGHTS[ItemRarity.Legendary] +
      RARITY_WEIGHTS[ItemRarity.Epic] +
      RARITY_WEIGHTS[ItemRarity.Rare];
    expect(sum).toBe(100);
  });

  it("pool distributes weight evenly within rarity", () => {
    const legendaryPool = LANDLORD_ITEM_POOL.filter(
      (i) => i.rarity === ItemRarity.Legendary,
    );
    expect(legendaryPool.every((i) => i.poolWeight === 20 / 11)).toBe(true);
  });

  it("rollLandlordItem returns valid item", () => {
    const item = rollLandlordItem(() => 0);
    expect(ALL_LANDLORD_ITEMS.some((i) => i.id === item.id)).toBe(true);
  });

  it("rollUniqueItems never repeats within a draw", () => {
    const items = rollUniqueItems(12);
    expect(items).toHaveLength(12);
    expect(new Set(items.map((i) => i.id)).size).toBe(12);
  });

  it("legendary color is orange", () => {
    expect(LEGENDARY_ITEMS[0].color).toBe("#F57C00");
  });

  it("epic color is purple", () => {
    expect(EPIC_ITEMS[0].color).toBe("#8E24AA");
  });

  it("rare color is blue", () => {
    expect(RARE_ITEMS[0].color).toBe("#1E88E5");
  });

  it("skill bar lists active cards before passives", () => {
    const ids = sortItemsActiveFirst([
      getItem("epic_star")!,
      getItem("rare_peek")!,
      getItem("legendary_god_eye")!,
      getItem("legendary_force_trade")!,
    ]).map((item) => item.id);
    expect(ids).toEqual([
      "rare_peek",
      "legendary_force_trade",
      "epic_star",
      "legendary_god_eye",
    ]);
  });

  it("describes stolen cards for 强易", () => {
    expect(formatDrawnCardHint(CardKind.Normal, Rank.Seven)).toBe("点数7");
    expect(formatDrawnCardHint(CardKind.Normal, Rank.King)).toBe("点数K");
    expect(formatDrawnCardHint(CardKind.Star)).toBe("星牌");
    expect(formatDrawnCardHint(CardKind.BombCard)).toBe("炸弹牌");
  });
});
