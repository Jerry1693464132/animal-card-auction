import {
  ItemDefinition,
  ItemRarity,
  ItemTrigger,
} from "../types.js";

/** 传说道具（橙色，权重 20） */
export const LEGENDARY_ITEMS: ItemDefinition[] = [
  {
    id: "legendary_play_something_else",
    name: "玩点别的",
    rarity: ItemRarity.Legendary,
    weight: 0,
    color: "#F57C00",
    description:
      "当有玩家进入领出回合时，你可以思考是否使用：双方同时猜拳（互看不见），亮出后你赢则拿到领出权；平局重来。超时由系统随机出拳。可发动 2 次。",
    trigger: ItemTrigger.OnLead,
    maxUses: 2,
  },
  {
    id: "legendary_swap_hands",
    name: "换一下",
    rarity: ItemRarity.Legendary,
    weight: 0,
    color: "#F57C00",
    description:
      "被动技能卡。游戏开始时，你有十秒钟思考是否与一名角色更换所有普通手牌（不含炸弹卡和星星卡）。",
    trigger: ItemTrigger.GameStart,
    maxUses: 1,
  },
  {
    id: "legendary_god_eye",
    name: "神之眼",
    rarity: ItemRarity.Legendary,
    weight: 0,
    color: "#F57C00",
    description: "被动技能卡。你可以看到其他玩家的手牌。",
    trigger: ItemTrigger.GameStart,
    maxUses: 1,
  },
  {
    id: "legendary_extra_round",
    name: "加赛",
    rarity: ItemRarity.Legendary,
    weight: 0,
    color: "#F57C00",
    description:
      "当全场每次有玩家手牌数小于 10，你可以选择是否使用：全体玩家各获得 10 张手牌（从第二新牌库随机抽取）。整局只能使用一次。",
    trigger: ItemTrigger.OnFirstBelowTen,
    maxUses: 1,
  },
  {
    id: "legendary_wild_king",
    name: "癞子大王",
    rarity: ItemRarity.Legendary,
    weight: 0,
    color: "#F57C00",
    description: "被动技能卡。游戏开始时获得两张星牌（癞子牌）。",
    trigger: ItemTrigger.GameStart,
    maxUses: 1,
  },
  {
    id: "legendary_bomb_king",
    name: "炸弹大王",
    rarity: ItemRarity.Legendary,
    weight: 0,
    color: "#F57C00",
    description:
      "被动技能卡。游戏开始时获得两张「炸弹」牌。炸弹牌只能单出，单张即为最小炸弹（比四张 3 还小）。",
    trigger: ItemTrigger.GameStart,
    maxUses: 1,
  },
  {
    id: "legendary_bomb_defuser",
    name: "拆弹专家",
    rarity: ItemRarity.Legendary,
    weight: 0,
    color: "#F57C00",
    description:
      "当有玩家使用炸弹牌型跟牌时你可以使用：该炸弹进入弃牌堆，随后由你领出。",
    trigger: ItemTrigger.OnOpponentBomb,
    maxUses: 1,
  },
  {
    id: "legendary_force_trade",
    name: "强易",
    rarity: ItemRarity.Legendary,
    weight: 0,
    color: "#F57C00",
    description:
      "出牌时可以使用，选择抽取一名手牌数大于 10 的玩家一张牌，然后选择一张牌给回该玩家。本局可使用两次。",
    trigger: ItemTrigger.OnPlay,
    maxUses: 2,
  },
  {
    id: "legendary_collect_jokers",
    name: "双王",
    rarity: ItemRarity.Legendary,
    weight: 0,
    color: "#F57C00",
    description:
      "被动技能卡，游戏开始时，你将把场上的大小王都加入你的手牌中。",
    trigger: ItemTrigger.GameStart,
    maxUses: 1,
  },
  {
    id: "legendary_discard_nine",
    name: "丢弃",
    rarity: ItemRarity.Legendary,
    weight: 0,
    color: "#F57C00",
    description:
      "手牌数大于等于 11 时，出牌时可以使用：随机丢弃 9 张手牌。",
    trigger: ItemTrigger.OnPlay,
    maxUses: 1,
  },
  {
    id: "legendary_super_upgrade",
    name: "超级升级",
    rarity: ItemRarity.Legendary,
    weight: 0,
    color: "#F57C00",
    description:
      "出牌时可以使用：将你手中点数为 3、4 和 5 的牌全部改为 K。",
    trigger: ItemTrigger.OnPlay,
    maxUses: 1,
  },
];

/** 史诗道具（紫色，权重 40） */
export const EPIC_ITEMS: ItemDefinition[] = [
  {
    id: "epic_star",
    name: "星星",
    rarity: ItemRarity.Epic,
    weight: 0,
    color: "#8E24AA",
    description: "被动技能卡。游戏开始时获得一张星牌（癞子牌）。",
    trigger: ItemTrigger.GameStart,
    maxUses: 1,
  },
  {
    id: "epic_triple_plus_one",
    name: "三带两个一",
    rarity: ItemRarity.Epic,
    weight: 0,
    color: "#8E24AA",
    description: "被动技能卡。使用三带一牌型时可以额外多带一张单牌。",
    trigger: ItemTrigger.GameStart,
    maxUses: 1,
  },
  {
    id: "epic_memory",
    name: "记忆力",
    rarity: ItemRarity.Epic,
    weight: 0,
    color: "#8E24AA",
    description: "被动技能卡。开局获得记牌器。",
    trigger: ItemTrigger.GameStart,
    maxUses: 1,
  },
  {
    id: "epic_bomb",
    name: "炸弹",
    rarity: ItemRarity.Epic,
    weight: 0,
    color: "#8E24AA",
    description:
      "被动技能卡。游戏开始时获得一张「炸弹」牌。炸弹牌只能单出，单张即为最小炸弹（比四张 3 还小）。",
    trigger: ItemTrigger.GameStart,
    maxUses: 1,
  },
  {
    id: "epic_control",
    name: "操控",
    rarity: ItemRarity.Epic,
    weight: 0,
    color: "#8E24AA",
    description:
      "一名手牌数大于 5 的玩家进入领出回合时，你可以思考是否使用：声明该玩家必须出单牌或对子中你选择的一种；对方可打出该牌型，或点「移交」把领出权交给你。可使用 2 次。",
    trigger: ItemTrigger.OnLead,
    maxUses: 2,
  },
  {
    id: "epic_copy",
    name: "复制",
    rarity: ItemRarity.Epic,
    weight: 0,
    color: "#8E24AA",
    description:
      "被动技能卡，游戏开始时你随机复制场上的一张被动技能卡（不包括「双王」）。复制来的技能会正常生效，与自己已有的同名卡分别计算。",
    trigger: ItemTrigger.GameStart,
    maxUses: 1,
  },
  {
    id: "epic_max_bomb",
    name: "最大炸弹",
    rarity: ItemRarity.Epic,
    weight: 0,
    color: "#8E24AA",
    description: "被动技能卡。游戏中你的炸弹牌型对手无法跟牌（王炸除外）。",
    trigger: ItemTrigger.GameStart,
    maxUses: 1,
  },
  {
    id: "epic_self_follow",
    name: "自娱自乐",
    rarity: ItemRarity.Epic,
    weight: 0,
    color: "#8E24AA",
    description:
      "出牌时可以使用。当你出牌后，可以再对自己跟牌一次。",
    trigger: ItemTrigger.OnOwnTurn,
    maxUses: 1,
  },
  {
    id: "epic_four_plus_three",
    name: "四带三",
    rarity: ItemRarity.Epic,
    weight: 0,
    color: "#8E24AA",
    description: "被动技能卡。使用四带二牌型时可以多带一张单牌。",
    trigger: ItemTrigger.GameStart,
    maxUses: 1,
  },
  {
    id: "epic_big_trade",
    name: "大交易",
    rarity: ItemRarity.Epic,
    weight: 0,
    color: "#8E24AA",
    description:
      "出牌时可以使用，将自己点数最大的三张牌与所选玩家点数最大的三张牌交换。",
    trigger: ItemTrigger.OnPlay,
    maxUses: 1,
  },
  {
    id: "epic_big_upgrade",
    name: "大升级",
    rarity: ItemRarity.Epic,
    weight: 0,
    color: "#8E24AA",
    description:
      "出牌时可以使用：将你手中点数为 3 和 4 的牌全部改为 Q。",
    trigger: ItemTrigger.OnPlay,
    maxUses: 1,
  },
];

/** 精良道具（蓝色，权重 40；内部品质仍为 rare） */
export const RARE_ITEMS: ItemDefinition[] = [
  {
    id: "rare_bounce",
    name: "打回",
    rarity: ItemRarity.Rare,
    weight: 0,
    color: "#1E88E5",
    description:
      "对手领出并出牌后，你可以思考是否打回本次出牌。对手必须改出其他牌型；若没有则你获得出牌权。",
    trigger: ItemTrigger.OnLead,
    maxUses: 1,
  },
  {
    id: "rare_steal_one",
    name: "万一是好牌呢",
    rarity: ItemRarity.Rare,
    weight: 0,
    color: "#1E88E5",
    description:
      "出牌阶段可以对一名手牌数大于 8 的玩家使用：随机抽取该玩家 1 张牌。可使用 4 次。",
    trigger: ItemTrigger.OnPlay,
    maxUses: 4,
  },
  {
    id: "rare_instant_win",
    name: "直接胜利",
    rarity: ItemRarity.Rare,
    weight: 0,
    color: "#1E88E5",
    description: "手牌数小于等于 1 时可以选择使用，直接胜利。",
    trigger: ItemTrigger.OnPlay,
    maxUses: 1,
  },
  {
    id: "rare_head_start",
    name: "抢跑",
    rarity: ItemRarity.Rare,
    weight: 0,
    color: "#1E88E5",
    description:
      "被动技能卡。游戏开始时你第一个出牌，场上的先手牌不论在谁手里都进入弃牌堆。",
    trigger: ItemTrigger.GameStart,
    maxUses: 1,
  },
  {
    id: "rare_anti_overload",
    name: "防过载",
    rarity: ItemRarity.Rare,
    weight: 0,
    color: "#1E88E5",
    description: "被动技能卡。你所有阶段的思考时间加 3 秒（包括技能思考时间）。",
    trigger: ItemTrigger.GameStart,
    maxUses: 1,
  },
  {
    id: "rare_peek",
    name: "偷看",
    rarity: ItemRarity.Rare,
    weight: 0,
    color: "#1E88E5",
    description:
      "你的回合可以使用：观看全场手牌大于 12 的玩家的手牌 25 秒。",
    trigger: ItemTrigger.OnOwnTurn,
    maxUses: 1,
  },
  {
    id: "rare_upgrade",
    name: "升级",
    rarity: ItemRarity.Rare,
    weight: 0,
    color: "#1E88E5",
    description:
      "出牌时可以使用：将你手中点数为 3 的牌按张数依次改为 K、Q、J、10。",
    trigger: ItemTrigger.OnPlay,
    maxUses: 1,
  },
  {
    id: "rare_smoke",
    name: "烟雾弹",
    rarity: ItemRarity.Rare,
    weight: 0,
    color: "#1E88E5",
    description:
      "被动技能卡。其他玩家不能知道你的手牌数，也不能通过技能查看你的牌。",
    trigger: ItemTrigger.GameStart,
    maxUses: 1,
  },
  {
    id: "rare_brain_overload",
    name: "大脑过载",
    rarity: ItemRarity.Rare,
    weight: 0,
    color: "#1E88E5",
    description:
      "出牌阶段可以使用。除你以外，其他玩家接下来 5 个出牌回合思考时间都为 4 秒；超时自动过牌或打出最小牌。",
    trigger: ItemTrigger.OnPlay,
    maxUses: 1,
  },
  {
    id: "rare_small_insight",
    name: "小洞察",
    rarity: ItemRarity.Rare,
    weight: 0,
    color: "#1E88E5",
    description:
      "被动技能卡，你可以知道全场其他各个玩家的炸弹个数（包括王炸和炸弹牌）。",
    trigger: ItemTrigger.GameStart,
    maxUses: 1,
  },
];

export const ALL_LANDLORD_ITEMS: ItemDefinition[] = [
  ...LEGENDARY_ITEMS,
  ...EPIC_ITEMS,
  ...RARE_ITEMS,
];

export const ITEM_BY_ID = new Map(
  ALL_LANDLORD_ITEMS.map((item) => [item.id, item]),
);

export function getItem(id: string): ItemDefinition | undefined {
  return ITEM_BY_ID.get(id);
}

/** 开局自动生效的被动技能；其余为局内弹出的主动技能。 */
export function isPassiveSkill(trigger: ItemTrigger | string | undefined): boolean {
  return trigger === ItemTrigger.GameStart;
}

/** 技能栏展示：主动在上、被动在下；同组保持原获得顺序。 */
export function sortItemsActiveFirst<T extends { trigger?: ItemTrigger | string }>(
  items: readonly T[],
): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const pa = isPassiveSkill(a.item.trigger) ? 1 : 0;
      const pb = isPassiveSkill(b.item.trigger) ? 1 : 0;
      return pa - pb || a.index - b.index;
    })
    .map((entry) => entry.item);
}
