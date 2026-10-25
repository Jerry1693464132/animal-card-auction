import { Button, Color, Graphics, Label, Mask, Node, Sprite, SpriteFrame, UITransform } from "cc";
import { loadUiSpriteFrame, peekUiSpriteFrame } from "../app/uiSkin";
import { CardView } from "../net/Protocol";

const RANK_NAME: Record<number, string> = {
  0: "先手",
  11: "J",
  12: "Q",
  13: "K",
  20: "A",
  21: "2",
  22: "小王",
  23: "大王",
};

const SUIT_MARK: Record<string, string> = {
  S: "♠",
  H: "♥",
  C: "♣",
  D: "♦",
};

export const CARD_RED = new Color(196, 18, 28, 255);
export const CARD_BLACK = new Color(22, 22, 26, 255);
export const CARD_GOLD = new Color(255, 208, 96, 255);
export const CARD_STAR = new Color(255, 224, 96, 255);
export const CARD_BOMB = new Color(255, 148, 64, 255);
export const CARD_JOKER = new Color(132, 72, 196, 255);

export const HAND_CARD = { w: 138, h: 185 };
export const TABLE_CARD = { w: 66, h: 88 };
/** 给左侧道具栏、右侧出牌按钮留边 */
export const HAND_MAX_WIDTH = 1280;
/** 连续点数列距 x = 牌宽 × 此系数（原 0.7，再 ×2/3，再 ×3/4） */
export const HAND_COLUMN_X = 0.7 * (2 / 3) * (3 / 4);
/** 同点竖叠只露出左上角标（点数+小花色），不要把中间大花色/倒置角标叠到下一张上 */
export const HAND_STACK_Y = 70;
/** 上张牌多伸出一段压住下张圆角，避免交接处漏桌布 */
export const HAND_STACK_TUCK = 22;
/** 神之眼 / 偷看：比桌上打出的牌再小 1/5，叠法与自己手牌相同 */
export const PEEK_CARD = {
  w: Math.round(TABLE_CARD.w * (4 / 5)),
  h: Math.round(TABLE_CARD.h * (4 / 5)),
};
export const PEEK_STACK_Y = Math.round(HAND_STACK_Y * (PEEK_CARD.h / HAND_CARD.h));
export const PEEK_MAX_WIDTH = 520;
/**
 * 自己手牌列顺序：大→小。只排手里有的点数。
 * 列距按序列间隔：连续点数为 x，隔一档（如 4 和 6）为 2x，隔两档为 3x。
 * 星/炸没有常规点数，放在大王左侧。
 */
export const HAND_COLUMN_RANKS: readonly number[] = [
  26, 25, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 0,
];
const RANK_SEQ_INDEX = new Map(HAND_COLUMN_RANKS.map((rank, i) => [rank, i]));
export const TABLE_FAN_WIDTH = 420;
export const SELECT_LIFT = 0;
/** 选中的牌变暗，不再抬起 */
export const SELECT_DIM = new Color(158, 158, 158, 255);
export const ITEM_CHIP = { w: 196, h: 46 };
/** 牌桌左侧道具栏（整体上移 10） */
export const ITEM_DOCK = { x: -852, y: -4 };
export const ITEM_VIEW = { w: 116, h: 430 };
export const ITEM_CELL = { w: 108, h: 138 };
/** 相邻道具框中心距，小于格子高度以收紧间距 */
export const ITEM_CELL_STEP = 120;
/** 列表顶部留白，避免首个道具框顶边被遮罩裁切 */
export const ITEM_LIST_TOP_PAD = 10;
export const ITEM_ART = 80;
const FACE_SUITS = ["S", "H", "C", "D"] as const;
const FACE_RANKS = [
  "A",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
] as const;

export const CARD_ART_KEYS = [
  "card-back",
  "card-joker-big",
  "card-joker-small",
  "card-first",
  "card-star",
  "card-bomb",
  ...FACE_SUITS.flatMap((suit) => FACE_RANKS.map((rank) => `card-${suit}-${rank}`)),
] as const;

let cardArtPreload: Promise<void> | null = null;

export function preloadCardArt(): Promise<void> {
  if (!cardArtPreload) {
    cardArtPreload = Promise.all(CARD_ART_KEYS.map((k) => loadUiSpriteFrame(k))).then(() => undefined);
  }
  return cardArtPreload;
}

export const HAND_TYPE_CN: Record<string, string> = {
  first_play: "先手",
  single: "单张",
  pair: "对子",
  triple: "三张",
  triple_with_single: "三带一",
  triple_with_pair: "三带对",
  straight: "顺子",
  consecutive_pairs: "连对",
  airplane: "飞机",
  airplane_with_singles: "飞机带单",
  airplane_with_pairs: "飞机带对",
  four_with_two_singles: "四带二",
  four_with_two_pairs: "四带两对",
  bomb: "炸弹",
  rocket: "火箭",
};

export type SeatKind = "self" | "left" | "right" | "top";

export function cardLabel(card: CardView | null | undefined): string {
  if (!card) return "?";
  if (card.kind === "first_play") return "先手";
  if (card.kind === "star") return "★星";
  if (card.kind === "bomb_card") return "炸";
  const name = RANK_NAME[card.rank ?? -1] ?? String(card.rank ?? "?");
  const suit = SUIT_MARK[card.suit ?? ""] ?? "";
  return `${suit}${name}`;
}

export function cardColor(card: CardView | null | undefined): Color {
  if (!card) return CARD_BLACK;
  if (card.kind === "first_play") return CARD_GOLD;
  if (card.kind === "star") return CARD_STAR;
  if (card.kind === "bomb_card") return CARD_BOMB;
  if (card.rank === 22 || card.rank === 23) return CARD_JOKER;
  if (card.suit === "H" || card.suit === "D") return CARD_RED;
  return CARD_BLACK;
}

export function rankText(card: CardView): string {
  if (card.kind === "first_play") return "先手";
  if (card.kind === "star") return "";
  if (card.kind === "bomb_card") return "";
  if (card.rank === 22 || card.rank === 23) return "Joker";
  return RANK_NAME[card.rank ?? -1] ?? String(card.rank ?? "?");
}

export function suitText(card: CardView): string {
  if (card.kind === "first_play") return "手";
  if (card.kind === "star") return "星";
  if (card.kind === "bomb_card") return "弹";
  if (card.rank === 22 || card.rank === 23) return "王";
  return SUIT_MARK[card.suit ?? ""] ?? "";
}

export function sortHand(hand: CardView[]): CardView[] {
  const suitOrder: Record<string, number> = { S: 0, H: 1, C: 2, D: 3 };
  return [...hand].sort((a, b) => {
    const ra = a.rank ?? (a.kind === "first_play" ? -1 : 99);
    const rb = b.rank ?? (b.kind === "first_play" ? -1 : 99);
    if (ra !== rb) return ra - rb;
    return (suitOrder[a.suit ?? ""] ?? 9) - (suitOrder[b.suit ?? ""] ?? 9);
  });
}

/** 星=25，炸=26，先手=0，其余用牌面点数。 */
export function cardColumnKey(card: CardView): number {
  if (card.kind === "bomb_card") return 26;
  if (card.kind === "star") return 25;
  if (card.kind === "first_play") return 0;
  return card.rank ?? -1;
}

export interface RankedHandSlot {
  card: CardView;
  x: number;
  hitY: number;
  hitH: number;
  visualOffsetY: number;
}

function suitOrderOf(card: CardView): number {
  const suitOrder: Record<string, number> = { S: 0, H: 1, C: 2, D: 3 };
  return suitOrder[card.suit ?? ""] ?? 9;
}

/** 按点数分列；只排手里有的点数。 */
export function handRankColumns(hand: CardView[]): CardView[][] {
  const buckets = new Map<number, CardView[]>();
  for (const card of hand) {
    const key = cardColumnKey(card);
    const list = buckets.get(key) ?? [];
    list.push(card);
    buckets.set(key, list);
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => suitOrderOf(a) - suitOrderOf(b) || a.id.localeCompare(b.id));
  }
  return HAND_COLUMN_RANKS.map((rank) => buckets.get(rank) ?? []).filter((col) => col.length > 0);
}

export function rankSequenceIndex(rank: number): number {
  return RANK_SEQ_INDEX.get(rank) ?? HAND_COLUMN_RANKS.length;
}

/** 两列在手牌序列上的间隔：4→5 为 1，4→6 为 2，4→7 为 3。 */
export function rankColumnGap(fromRank: number, toRank: number): number {
  return Math.max(1, Math.abs(rankSequenceIndex(toRank) - rankSequenceIndex(fromRank)));
}

export function rankColumnStep(columnCount: number, cardW: number, maxWidth: number): number {
  if (columnCount <= 1) return cardW;
  const raw = (maxWidth - cardW) / (columnCount - 1);
  return Math.min(cardW * HAND_COLUMN_X, Math.max(36, raw));
}

function columnRank(stack: CardView[]): number {
  return cardColumnKey(stack[0]!);
}

export function layoutRankedHand(
  hand: CardView[],
  cardW: number,
  cardH: number,
  maxWidth: number,
  stackY: number,
  selectedIds?: Set<string>,
  selectLift = 0,
): RankedHandSlot[] {
  const cols = handRankColumns(hand);
  if (!cols.length) return [];
  const gaps: number[] = [];
  for (let i = 1; i < cols.length; i += 1) {
    gaps.push(rankColumnGap(columnRank(cols[i - 1]!), columnRank(cols[i]!)));
  }
  const units = gaps.reduce((sum, gap) => sum + gap, 0);
  let step = cardW * HAND_COLUMN_X;
  if (units > 0 && units * step > maxWidth - cardW) {
    step = (maxWidth - cardW) / units;
  }
  const xs = [0];
  for (const gap of gaps) xs.push(xs[xs.length - 1]! + gap * step);
  const start = -(xs[xs.length - 1] ?? 0) / 2;
  const slots: RankedHandSlot[] = [];
  cols.forEach((stack, col) => {
    const x = start + xs[col]!;
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      const card = stack[i]!;
      const selected = !!selectedIds?.has(card.id);
      const visualY = i * stackY + (selected ? selectLift : 0);
      const front = i === 0;
      const tuck = Math.max(10, Math.round(HAND_STACK_TUCK * (cardH / HAND_CARD.h)));
      const hitH = front ? cardH : Math.min(stackY + tuck, cardH);
      const hitY = front ? visualY : visualY + (cardH - hitH) / 2;
      slots.push({
        card,
        x,
        hitY,
        hitH,
        visualOffsetY: visualY - hitY,
      });
    }
  });
  return slots;
}

/** offset：相对自己的逆时针座位数（自己为 0） */
export function relativeSeat(playerCount: number, offset: number): SeatKind {
  if (offset === 0) return "self";
  if (playerCount <= 2) return "top";
  if (playerCount === 3) return offset === 1 ? "right" : "left";
  if (offset === 1) return "right";
  if (offset === 2) return "top";
  return "left";
}

export function avatarPos(kind: SeatKind): { x: number; y: number } {
  switch (kind) {
    case "left":
      return { x: -820, y: 90 };
    case "right":
      return { x: 820, y: 90 };
    case "top":
      return { x: 0, y: 430 };
    default:
      return { x: 0, y: -250 };
  }
}

/** 该座位出牌区（牌叠中心），朝向桌心 */
export function playZonePos(kind: SeatKind): { x: number; y: number } {
  switch (kind) {
    case "left":
      return { x: -430, y: 90 };
    case "right":
      return { x: 430, y: 90 };
    case "top":
      return { x: 0, y: 250 };
    default:
      return { x: 0, y: -168 };
  }
}

export function clockPos(kind: SeatKind): { x: number; y: number } {
  switch (kind) {
    case "left":
      return { x: -820, y: 168 };
    case "right":
      return { x: 820, y: 168 };
    case "top":
      return { x: 140, y: 430 };
    default:
      return { x: 340, y: -305 };
  }
}

export function makeTurnClock(
  parent: Node,
  name: string,
  x: number,
  y: number,
): { node: Node; label: Label } {
  const size = 76;
  const n = new Node(name);
  n.layer = parent.layer;
  parent.addChild(n);
  n.setPosition(x, y, 0);
  n.addComponent(UITransform).setContentSize(size, size);

  const bg = new Node("bg");
  bg.layer = n.layer;
  n.addChild(bg);
  bg.addComponent(UITransform).setContentSize(size, size);
  const g = bg.addComponent(Graphics);
  const r = size / 2 - 2;
  g.fillColor = new Color(20, 28, 36, 235);
  g.circle(0, 0, r);
  g.fill();
  g.strokeColor = CARD_GOLD;
  g.lineWidth = 4;
  g.circle(0, 0, r);
  g.stroke();

  const lab = addLabel(n, "cap", "15", 0, 0, 32, CARD_GOLD, size, size);
  lab.overflow = 0;
  return { node: n, label: lab };
}

export function rarityInk(rarity: string): Color {
  if (rarity === "legendary") return new Color(245, 124, 0, 255);
  if (rarity === "epic") return new Color(171, 71, 188, 255);
  if (rarity === "rare") return new Color(30, 136, 229, 255);
  return CARD_GOLD;
}

export function makeItemChip(
  parent: Node,
  name: string,
  title: string,
  x: number,
  y: number,
  rarity: string,
  ready: boolean,
): Button {
  const w = ITEM_CHIP.w;
  const h = ITEM_CHIP.h;
  const n = new Node(name);
  n.layer = parent.layer;
  parent.addChild(n);
  n.setPosition(x, y, 0);
  n.addComponent(UITransform).setContentSize(w, h);

  const ink = rarityInk(rarity);
  const bg = new Node("bg");
  bg.layer = n.layer;
  n.addChild(bg);
  bg.addComponent(UITransform).setContentSize(w, h);
  const g = bg.addComponent(Graphics);
  const hw = w / 2;
  const hh = h / 2;
  g.fillColor = ready ? new Color(28, 24, 36, 240) : new Color(28, 32, 38, 180);
  g.roundRect(-hw, -hh, w, h, 10);
  g.fill();
  g.strokeColor = ready ? ink : new Color(ink.r, ink.g, ink.b, 110);
  g.lineWidth = ready ? 3 : 2;
  g.roundRect(-hw, -hh, w, h, 10);
  g.stroke();

  const cap = addLabel(n, "cap", title, 0, 0, 22, ready ? ink : new Color(170, 170, 170, 200), w - 12, h);
  cap.overflow = 2;

  const btn = n.addComponent(Button);
  btn.transition = Button.Transition.NONE;
  return btn;
}

export function overlapStep(count: number, cardW: number, maxWidth: number): number {
  if (count <= 1) return cardW;
  const raw = (maxWidth - cardW) / (count - 1);
  return Math.min(cardW - 10, Math.max(26, raw));
}

export function fanStartX(count: number, step: number): number {
  if (count <= 1) return 0;
  return -((count - 1) * step) / 2;
}

function addLabel(
  parent: Node,
  name: string,
  text: string,
  x: number,
  y: number,
  size: number,
  color: Color,
  w: number,
  h: number,
  align = 1,
  overflow = 2,
): Label {
  const n = new Node(name);
  n.layer = parent.layer;
  parent.addChild(n);
  n.setPosition(x, y, 0);
  n.addComponent(UITransform).setContentSize(w, h);
  const lab = n.addComponent(Label);
  lab.string = text;
  lab.useSystemFont = true;
  lab.isBold = true;
  lab.fontSize = size;
  lab.lineHeight = Math.round(size * 1.15);
  lab.horizontalAlign = align;
  lab.verticalAlign = 1;
  lab.color = color;
  lab.overflow = overflow;
  return lab;
}

function rankArtToken(rank: number): string | null {
  if ((rank >= 3 && rank <= 10) || (rank >= 14 && rank <= 19)) return String(rank);
  if (rank === 11) return "J";
  if (rank === 12) return "Q";
  if (rank === 13) return "K";
  if (rank === 20) return "A";
  if (rank === 21) return "2";
  return null;
}

function cardArtKey(card: CardView): string | null {
  if (card.kind === "first_play") return "card-first";
  if (card.kind === "star") return "card-star";
  if (card.kind === "bomb_card") return "card-bomb";
  if (card.rank === 23) return "card-joker-big";
  if (card.rank === 22) return "card-joker-small";
  const token = rankArtToken(card.rank ?? -1);
  const suit = card.suit;
  if (!token || (suit !== "S" && suit !== "H" && suit !== "C" && suit !== "D")) return null;
  return `card-${suit}-${token}`;
}

/** 牌外形（圆角 + 细黑边）由显示层画出，不改立绘贴图。 */
function cardCornerRadius(w: number, h: number): number {
  return Math.max(5, Math.round(Math.min(w, h) * 0.08));
}

function cardEdgeWidth(w: number, h: number): number {
  return Math.min(w, h) >= 48 ? 2 : 1.5;
}

function paintCardChrome(g: Graphics, w: number, h: number, _selected: boolean, fill: Color) {
  const hw = w / 2;
  const hh = h / 2;
  const radius = cardCornerRadius(w, h);
  g.fillColor = fill;
  g.roundRect(-hw, -hh, w, h, radius);
  g.fill();
  g.strokeColor = CARD_BLACK;
  g.lineWidth = cardEdgeWidth(w, h);
  g.roundRect(-hw, -hh, w, h, radius);
  g.stroke();
}

function maskRoundCard(node: Node, w: number, h: number) {
  if (!node.getComponent(UITransform)) node.addComponent(UITransform);
  node.getComponent(UITransform)!.setContentSize(w, h);
  const mask = node.getComponent(Mask) ?? node.addComponent(Mask);
  mask.type = Mask.Type.GRAPHICS_STENCIL;
  const g = node.getComponent(Graphics) ?? node.addComponent(Graphics);
  g.clear();
  g.fillColor = Color.WHITE;
  g.roundRect(-w / 2, -h / 2, w, h, cardCornerRadius(w, h));
  g.fill();
}

function strokeCardRim(parent: Node, w: number, h: number) {
  const rim = new Node("rim");
  rim.layer = parent.layer;
  parent.addChild(rim);
  rim.addComponent(UITransform).setContentSize(w, h);
  const g = rim.addComponent(Graphics);
  g.lineWidth = cardEdgeWidth(w, h);
  g.strokeColor = CARD_BLACK;
  g.roundRect(-w / 2, -h / 2, w, h, cardCornerRadius(w, h));
  g.stroke();
}

function drawSuitPip(g: Graphics, x: number, y: number, size: number, suit: string, color: Color, flip = false) {
  g.fillColor = color;
  const s = Math.max(6, size);
  const f = flip ? -1 : 1;
  if (suit === "D") {
    g.moveTo(x, y + s * 0.52);
    g.lineTo(x + s * 0.4, y);
    g.lineTo(x, y - s * 0.52);
    g.lineTo(x - s * 0.4, y);
    g.close();
    g.fill();
    return;
  }
  if (suit === "H") {
    const r = s * 0.24;
    g.circle(x - s * 0.2, y + f * s * 0.1, r);
    g.fill();
    g.circle(x + s * 0.2, y + f * s * 0.1, r);
    g.fill();
    g.moveTo(x - s * 0.46, y + f * s * 0.04);
    g.lineTo(x + s * 0.46, y + f * s * 0.04);
    g.lineTo(x, y - f * s * 0.52);
    g.close();
    g.fill();
    return;
  }
  if (suit === "C") {
    const r = s * 0.2;
    g.circle(x, y + f * s * 0.18, r);
    g.fill();
    g.circle(x - s * 0.22, y - f * s * 0.02, r);
    g.fill();
    g.circle(x + s * 0.22, y - f * s * 0.02, r);
    g.fill();
    g.moveTo(x - s * 0.08, y - f * s * 0.02);
    g.lineTo(x + s * 0.08, y - f * s * 0.02);
    g.lineTo(x + s * 0.05, y - f * s * 0.5);
    g.lineTo(x - s * 0.05, y - f * s * 0.5);
    g.close();
    g.fill();
    return;
  }
  const r = s * 0.22;
  g.circle(x - s * 0.18, y + f * s * 0.02, r);
  g.fill();
  g.circle(x + s * 0.18, y + f * s * 0.02, r);
  g.fill();
  g.moveTo(x - s * 0.4, y - f * s * 0.02);
  g.lineTo(x + s * 0.4, y - f * s * 0.02);
  g.lineTo(x, y + f * s * 0.52);
  g.close();
  g.fill();
  g.moveTo(x - s * 0.07, y);
  g.lineTo(x + s * 0.07, y);
  g.lineTo(x + s * 0.05, y - f * s * 0.48);
  g.lineTo(x - s * 0.05, y - f * s * 0.48);
  g.close();
  g.fill();
}

function drawStar(g: Graphics, x: number, y: number, r: number, color: Color) {
  g.fillColor = color;
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 5; i += 1) {
    const a = Math.PI / 2 + (i * 2 * Math.PI) / 5;
    pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
    const b = a + Math.PI / 5;
    pts.push({ x: x + Math.cos(b) * r * 0.38, y: y + Math.sin(b) * r * 0.38 });
  }
  g.moveTo(pts[0]!.x, pts[0]!.y);
  for (let i = 1; i < pts.length; i += 1) g.lineTo(pts[i]!.x, pts[i]!.y);
  g.close();
  g.fill();
}

function drawBomb(g: Graphics, x: number, y: number, s: number, color: Color) {
  g.fillColor = color;
  g.circle(x, y - s * 0.06, s * 0.36);
  g.fill();
  g.fillColor = new Color(36, 36, 40, 255);
  g.rect(x - s * 0.07, y + s * 0.22, s * 0.14, s * 0.16);
  g.fill();
  g.strokeColor = new Color(255, 152, 40, 255);
  g.lineWidth = Math.max(2, s * 0.07);
  g.moveTo(x + s * 0.02, y + s * 0.36);
  g.lineTo(x + s * 0.16, y + s * 0.52);
  g.stroke();
}

function indexFontSize(text: string, h: number): number {
  if (text.length >= 5) return Math.max(12, Math.floor(h * 0.12));
  return Math.max(18, Math.floor(h * 0.2));
}

function addCornerIndex(parent: Node, card: CardView, w: number, h: number, ink: Color) {
  const wrap = new Node("idxT");
  wrap.layer = parent.layer;
  parent.addChild(wrap);
  wrap.setPosition(0, 0, 0);
  const padX = Math.max(6, w * 0.08);
  const padY = Math.max(7, h * 0.07);
  const cx = -w * 0.5 + padX + Math.max(10, w * 0.12);
  const cy = h * 0.5 - padY - Math.max(8, h * 0.08);

  if (card.kind === "star") {
    const pip = new Node("star");
    pip.layer = wrap.layer;
    wrap.addChild(pip);
    pip.setPosition(cx, cy, 0);
    drawStar(pip.addComponent(Graphics), 0, 0, Math.max(8, h * 0.09), ink);
    return;
  }
  if (card.kind === "bomb_card") {
    const pip = new Node("bomb");
    pip.layer = wrap.layer;
    wrap.addChild(pip);
    pip.setPosition(cx, cy - 2, 0);
    drawBomb(pip.addComponent(Graphics), 0, 0, Math.max(12, h * 0.14), ink);
    return;
  }
  if (card.rank === 22 || card.rank === 23) {
    const fs = Math.max(11, Math.floor(h * 0.1));
    const word = "Joker";
    for (let i = 0; i < word.length; i += 1) {
      addLabel(wrap, `j${i}`, word[i]!, cx, cy - i * fs * 0.9, fs, ink, Math.max(16, w * 0.24), fs + 2, 1, 0);
    }
    return;
  }

  const rank = rankText(card);
  const fs = indexFontSize(rank, h);
  const two = rank.length >= 2;
  const boxW = two ? fs * 1.35 : fs * 0.8;
  const ix = -w * 0.5 + padX + boxW * 0.5;
  const iy = h * 0.5 - padY - fs * 0.45;
  addLabel(wrap, "r", rank, ix, iy, fs, ink, boxW, fs + 4, 1, 0);
  const suit = card.suit ?? "";
  if (suit === "S" || suit === "H" || suit === "C" || suit === "D") {
    const pipN = new Node("pip");
    pipN.layer = wrap.layer;
    wrap.addChild(pipN);
    const pipR = Math.max(8, h * 0.1);
    pipN.setPosition(ix, iy - fs * 0.52 - pipR * 0.15, 0);
    drawSuitPip(pipN.addComponent(Graphics), 0, 0, pipR * 2, suit, ink);
  }
}

function applyCardSprite(parent: Node, sf: SpriteFrame, w: number, h: number, ox = 0, oy = 0, tint?: Color) {
  const img = new Node("art");
  img.layer = parent.layer;
  parent.addChild(img);
  img.setPosition(ox, oy, 0);
  img.addComponent(UITransform).setContentSize(w, h);
  const sp = img.addComponent(Sprite);
  sp.sizeMode = Sprite.SizeMode.CUSTOM;
  sp.type = Sprite.Type.SIMPLE;
  sp.spriteFrame = sf;
  if (tint) sp.color = tint;
}

/** 立绘铺满后用圆角遮罩裁掉尖角，再画一圈细黑边。 */
function applyFaceArt(parent: Node, sf: SpriteFrame, w: number, h: number, tint?: Color) {
  const clip = new Node("clip");
  clip.layer = parent.layer;
  parent.addChild(clip);
  maskRoundCard(clip, w, h);
  applyCardSprite(clip, sf, w, h, 0, 0, tint);
  strokeCardRim(parent, w, h);
}

export function makeFaceCard(
  parent: Node,
  name: string,
  card: CardView,
  x: number,
  y: number,
  w: number,
  h: number,
  selected = false,
  hitH = h,
  visualOffsetY = 0,
): Node {
  const n = new Node(name);
  n.layer = parent.layer;
  parent.addChild(n);
  n.setPosition(x, y, 0);
  n.addComponent(UITransform).setContentSize(w, hitH);

  const bg = new Node("bg");
  bg.layer = n.layer;
  n.addChild(bg);
  bg.setPosition(0, visualOffsetY, 0);
  bg.addComponent(UITransform).setContentSize(w, h);

  const ink = cardColor(card);
  const artKey = cardArtKey(card);
  const sf = artKey ? peekUiSpriteFrame(artKey) : null;
  const peeking = hitH < h - 1;

  if (peeking) {
    const mask = n.addComponent(Mask);
    mask.type = Mask.Type.GRAPHICS_RECT;
  }

  if (sf) {
    applyFaceArt(bg, sf, w, h, selected ? SELECT_DIM : undefined);
    return n;
  }

  const g = bg.addComponent(Graphics);
  const fill = selected ? SELECT_DIM : new Color(255, 255, 255, 255);
  paintCardChrome(g, w, h, false, fill);
  // 贴图还在加载：只画圆角空牌，不要回退到旧的代码绘制牌面。
  if (artKey && sf === undefined) return n;
  const court = card.rank === 11 || card.rank === 12 || card.rank === 13;
  const joker = card.rank === 22 || card.rank === 23;
  if (court) {
    addLabel(bg, "mid", rankText(card), w * 0.06, 0, Math.max(36, Math.floor(h * 0.4)), ink, w * 0.5, Math.floor(h * 0.5));
  } else if (card.kind === "first_play") {
    const fs = Math.max(22, Math.floor(h * 0.28));
    addLabel(bg, "mid", "先手", 0, 0, fs, ink, w * 0.8, fs + 10);
  } else if (card.kind === "star") {
    drawStar(g, 0, -h * 0.02, Math.min(w, h) * 0.28, ink);
  } else if (card.kind === "bomb_card") {
    drawBomb(g, 0, -h * 0.04, Math.min(w, h) * 0.55, ink);
  } else {
    const suit = card.suit ?? "";
    if (suit === "S" || suit === "H" || suit === "C" || suit === "D") {
      drawSuitPip(g, 0, -h * 0.02, Math.min(w, h) * 0.4, suit, ink);
    }
  }
  addCornerIndex(bg, card, w, h, joker ? CARD_BLACK : ink);
  return n;
}

export function makePassBubble(parent: Node, name: string, x: number, y: number): Node {
  const w = 120;
  const h = 56;
  const n = new Node(name);
  n.layer = parent.layer;
  parent.addChild(n);
  n.setPosition(x, y, 0);
  n.addComponent(UITransform).setContentSize(w, h);
  const bg = new Node("bg");
  bg.layer = n.layer;
  n.addChild(bg);
  bg.addComponent(UITransform).setContentSize(w, h);
  const g = bg.addComponent(Graphics);
  g.fillColor = new Color(40, 48, 56, 230);
  g.roundRect(-w / 2, -h / 2, w, h, 10);
  g.fill();
  g.strokeColor = CARD_GOLD;
  g.lineWidth = 2;
  g.roundRect(-w / 2, -h / 2, w, h, 10);
  g.stroke();
  addLabel(n, "cap", "不出", 0, 0, 28, CARD_GOLD, w, h);
  return n;
}

export function makeCardBackStack(
  parent: Node,
  name: string,
  count: number,
  x: number,
  y: number,
): Node {
  const n = new Node(name);
  n.layer = parent.layer;
  parent.addChild(n);
  n.setPosition(x, y, 0);
  n.addComponent(UITransform).setContentSize(80, 90);
  const shown = Math.min(Math.max(count, 0), 6);
  const cw = 28;
  const ch = 40;
  const backSf = peekUiSpriteFrame("card-back");
  for (let i = 0; i < Math.max(shown, 1); i += 1) {
    const back = new Node(`back-${i}`);
    back.layer = n.layer;
    n.addChild(back);
    back.setPosition(i * 3 - 10, i * 2, 0);
    back.addComponent(UITransform).setContentSize(cw, ch);
    if (backSf) {
      applyFaceArt(back, backSf, cw, ch);
    } else {
      const g = back.addComponent(Graphics);
      paintCardChrome(g, cw, ch, false, new Color(22, 74, 48, 255));
    }
  }
  addLabel(n, "n", String(count), 18, -8, 22, new Color(255, 255, 255, 255), 48, 32);
  return n;
}
