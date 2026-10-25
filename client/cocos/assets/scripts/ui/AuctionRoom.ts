import {
  _decorator,
  Button,
  Camera,
  Color,
  Component,
  Graphics,
  Label,
  Mask,
  Node,
  Sprite,
  SpriteFrame,
  UIOpacity,
  UITransform,
  Vec3,
  Widget,
  Tween,
  tween,
} from "cc";
import { EDITOR, PREVIEW } from "cc/env";
import { SeatAnimalId, seatAnimalId, seatAnimalName, seatAnimalNameById, spectatorAnimalId, tableAnimalId } from "../app/seatAnimals";
import { bootNet } from "../app/connect";
import { isTablePhase, RESUME_AUCTION_EVENT, shouldEnterTable } from "../app/matchFlow";
import { session } from "../app/Session";
import { playButtonSfx, playAuctionCallSfx, preloadAuctionVoices } from "../app/cardSfx";
import { clearUiSpriteCache, loadUiSpriteFrame } from "../app/uiSkin";
import { AuctionPublicView, RaiseAmount } from "../net/Protocol";
import { net } from "../net/WsClient";
import { TableRoom } from "./TableRoom";
import { preloadCardArt, rarityInk } from "./cards";
import { installVolumeControl } from "./volumeControl";

const { ccclass } = _decorator;

const GOLD = new Color(255, 214, 110, 255);
const CREAM = new Color(245, 236, 214, 255);
const MUTED = new Color(196, 176, 148, 255);
const WOOD = new Color(58, 38, 24, 255);
const INK = new Color(48, 28, 10, 255);
const GREEN_BTN = new Color(36, 118, 58, 255);
const ORANGE_BTN = new Color(196, 96, 36, 255);
const PADDLE = new Color(46, 168, 78, 255);
const URGENT = new Color(255, 120, 80, 255);
/** 本人名牌：中等蓝，不要藏青 */
const SELF_PLATE_FILL = new Color(48, 92, 158, 210);
const SELF_PLATE_STROKE = new Color(118, 176, 232, 245);
const SELF_PLATE_INK = new Color(64, 126, 204, 255);
const PLATE_FILL = new Color(72, 44, 24, 200);
const PLATE_STROKE = new Color(212, 164, 72, 240);

const RAISE_AMOUNTS: RaiseAmount[] = [1, 5, 10, 20, 30];
const ITEM_CARD_SCALE = 1.12;
const ITEM_CARD_W = Math.round(196 * ITEM_CARD_SCALE);
const ITEM_CARD_H = Math.round(236 * ITEM_CARD_SCALE);
const ITEM_CARD_Y = 178 + Math.round((ITEM_CARD_H - 236) / 2);
const ITEM_ART = Math.round(168 * ITEM_CARD_SCALE);
const ITEM_ART_Y = Math.round(22 * ITEM_CARD_SCALE);
const ITEM_BAR_Y = Math.round(-88 * ITEM_CARD_SCALE);
/** 包住图 + 底部文案的外框，传说橙 / 史诗紫 / 精良蓝 */
const ITEM_CARD_FRAME_W = 7;
const ITEM_CARD_STROKE = new Color(212, 164, 72, 240);
const ITEM_BAR_W = Math.round(180 * ITEM_CARD_SCALE);
const ITEM_BAR_H = Math.round(36 * ITEM_CARD_SCALE);
const ITEM_BAR_FONT = Math.round(18 * ITEM_CARD_SCALE);
const ITEM_BAR_RADIUS = Math.round(10 * ITEM_CARD_SCALE);
/** 技能描述底板：16:9，按文案量缩小，贴在道具卡下方 */
const DESC_BOARD_W = 480;
const DESC_BOARD_H = 270;
const DESC_BOARD_Y = -93;
const DESC_BOARD_RADIUS = 14;
const DESC_BG_INSET = 5;

const PHASE_BAR: Record<string, string> = {
  waiting_open: "等待加价",
  bidding: "竞价中",
  settled_lot: "本轮拍卖已结束",
  finished: "拍卖结束",
};

function hexColor(hex: string, fallback: Color): Color {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return new Color((n >> 16) & 255, (n >> 8) & 255, n & 255, 255);
}

function formatEvent(ev: unknown): string {
  if (!ev || typeof ev !== "object") return "";
  const e = ev as Record<string, unknown>;
  const t = String(e.type ?? "");
  if (t === "bid") {
    const who = session.playerName(String(e.playerId ?? ""));
    return `${who} 叫到 ${e.price}`;
  }
  if (t === "opened") return `第 ${(Number(e.lotIndex) || 0) + 1} 件开拍`;
  if (t === "lot_sold") {
    const who = session.playerName(String(e.winnerId ?? ""));
    return `${who} 以 ${e.price} 拍得`;
  }
  if (t === "lot_passed") return "流拍，进入下一件";
  if (t === "auction_finished") return "全部拍完";
  if (t === "dealt") return "发牌完成";
  return t ? `事件：${t}` : "";
}

/** 椅位画在背景上；这里只放名牌/号牌，对齐效果图四角椅。 */
const WORLD_CHAIRS: { id: SeatAnimalId; x: number; y: number }[] = [
  { id: "panda", x: -430, y: -8 },
  { id: "fox", x: 430, y: -8 },
  { id: "owl", x: 430, y: -228 },
  { id: "rabbit", x: -430, y: -228 },
];

/** 名牌 48 高、圆心半径 28，号牌水平居中贴在名框正上方（留约 10px 缝） */
const NAMEPLATE_H = 48;
const PADDLE_R = 28;
const PADDLE_ABOVE_Y = NAMEPLATE_H / 2 + 10 + PADDLE_R;

@ccclass("AuctionRoom")
export class AuctionRoom extends Component {
  private statusLabel: Label | null = null;
  private countdownLab: Label | null = null;
  private countdownCap: Label | null = null;
  private countdownUnit: Label | null = null;
  private priceCap: Label | null = null;
  private itemNameLabel: Label | null = null;
  private itemDescLabel: Label | null = null;
  private descBgSprite: Sprite | null = null;
  private lastDescBgKey = "";
  private pedestalLab: Label | null = null;
  private priceLabel: Label | null = null;
  private leaderLabel: Label | null = null;
  private toastLabel: Label | null = null;
  private toastOp: UIOpacity | null = null;
  private itemCard: Node | null = null;
  private itemArtSprite: Sprite | null = null;
  private itemArtFill: Graphics | null = null;
  private lastArtId = "";
  private descBoard: Node | null = null;
  private priceBoard: Node | null = null;
  private panelBid: Node | null = null;
  private panelDone: Node | null = null;
  private seatsHost: Node | null = null;
  private raiseButtons: Array<{ amount: RaiseAmount; btn: Button; sub: Label | null }> = [];
  private btnAllin: Button | null = null;
  private allinSub: Label | null = null;

  private unbindMsg: (() => void) | null = null;
  private unbindStatus: (() => void) | null = null;
  private settleDeadline = 0;
  private localCooldownUntil = 0;
  private leavingToTable = false;
  private lastPrice = -1;
  private lastLot = -1;
  private lastLeader = "";
  private lastTimerKey = "";
  private lastTickSec = -1;

  onLoad() {
    if (EDITOR && !PREVIEW) return;
    session.prepareIdentity();
    this.ensureUi();
    void preloadCardArt();
    preloadAuctionVoices();
    this.unbindMsg = net.onMessage((msg) => {
      if (msg.type === "welcome") {
        session.rememberIdentity(msg.playerId, msg.displayName);
        session.lastError = "";
      } else if (msg.type === "room") {
        session.room = msg.room;
      } else if (msg.type === "match") {
        session.setMatchView(msg.view);
        if (msg.view.auction) {
          this.settleDeadline = Date.now() + msg.view.auction.settleInMs;
          if (msg.view.auction.leadingPlayerId !== session.playerId && session.lastError.includes("领先")) {
            session.lastError = "";
          }
        }
        if (this.goToTableIfNeeded()) return;
        this.refresh();
      } else if (msg.type === "events") {
        for (const ev of msg.events) this.playBidVoice(ev);
        const line = formatEvent(msg.events[msg.events.length - 1]);
        if (line) session.lastEventText = line;
        this.flashToast();
        this.refresh();
      } else if (msg.type === "error") {
        session.lastError = auctionErrorCn(msg.message);
        this.flashToast();
        this.refresh();
      } else if (msg.type === "score") {
        session.applyScore(msg.score);
        session.dailyRestoreDay = msg.dailyRestoreDay ?? null;
      } else if (msg.type === "avatar") {
        session.applyAvatar(msg.avatar.equipped, msg.avatar.unlocked);
      } else if (msg.type === "settlement") {
        session.lastSettlement = msg.deltas;
        if (this.goToTableIfNeeded()) return;
        session.lastEventText = "本局已结算";
        this.refresh();
      }
    });
    this.unbindStatus = net.onStatus(() => this.refresh());
    this.node.on(RESUME_AUCTION_EVENT, this.resumeFromSettle, this);
    void bootNet();

    const auction = session.matchView?.auction;
    if (auction) this.settleDeadline = Date.now() + auction.settleInMs;
    if (this.goToTableIfNeeded()) return;
    this.refresh();
  }

  update() {
    if (EDITOR && !PREVIEW) return;
    if (!this.panelBid?.active) return;
    const auction = session.matchView?.auction;
    if (!auction) return;
    const leftMs = Math.max(0, this.settleDeadline - Date.now());
    this.paintTimer(auction, leftMs);
  }

  private goToTableIfNeeded(): boolean {
    if (this.leavingToTable) return true;
    if (!isTablePhase(session.matchView) && !shouldEnterTable(session.matchView, session.room)) {
      return false;
    }
    this.openTable();
    return true;
  }

  private openTable() {
    this.leavingToTable = true;
    this.hideAuctionChrome();
    if (!this.node.getComponent(TableRoom)) {
      this.node.addComponent(TableRoom);
    }
  }

  /** 结算后全员继续：拆掉牌桌/结算叠层，原地回到拍卖，不要再 loadScene("Auction")。 */
  private resumeFromSettle = () => {
    if (!this.node?.isValid) return;
    this.leavingToTable = false;
    this.lastPrice = -1;
    this.lastLot = -1;
    this.lastLeader = "";
    this.lastTimerKey = "";
    this.lastTickSec = -1;
    const table = this.node.getComponent(TableRoom);
    if (table) table.enabled = false;
    const settle = this.node.getComponent("SettleRoom") as Component | null;
    if (settle) settle.enabled = false;
    this.scheduleOnce(() => this.stripMatchOverlays(), 0);
  };

  private stripMatchOverlays() {
    if (!this.node?.isValid) return;
    this.node.getComponent("SettleRoom")?.destroy();
    this.node.getComponent(TableRoom)?.destroy();
    for (const child of [...this.node.children]) {
      if (!child?.isValid || child.name === "UICamera") continue;
      child.removeFromParent();
      child.destroy();
    }
    this.scheduleOnce(() => this.rebuildAuctionHud(), 0);
  }

  private rebuildAuctionHud() {
    if (!this.node?.isValid) return;
    this.ensureUi();
    if (this.goToTableIfNeeded()) return;
    this.refresh();
  }

  private hideAuctionChrome() {
    for (const name of ["HudRoot", "PanelBid", "PanelDone", "Title", "Status", "EventLine", "BtnBack"]) {
      const n = this.node.getChildByName(name);
      if (n) n.active = false;
    }
  }

  onDestroy() {
    this.unbindMsg?.();
    this.unbindStatus?.();
    if (this.node?.isValid) {
      this.node.off(RESUME_AUCTION_EVENT, this.resumeFromSettle, this);
    }
    this.unscheduleAllCallbacks();
  }

  private canvasSize(): { w: number; h: number } {
    const ut = this.node.getComponent(UITransform);
    if (ut && ut.contentSize.width > 0) {
      return { w: ut.contentSize.width, h: ut.contentSize.height };
    }
    return { w: 1920, h: 1080 };
  }

  private applyFitSprite(img: Node, sf: SpriteFrame, canvasW: number, canvasH: number) {
    const rw = Math.max(1, sf.rect.width);
    const rh = Math.max(1, sf.rect.height);
    const same = Math.abs(rw / rh - canvasW / canvasH) < 0.02;
    const scale = same ? Math.max(canvasW / rw, canvasH / rh) : Math.min(canvasW / rw, canvasH / rh);
    img.getComponent(UITransform)!.setContentSize(rw * scale, rh * scale);
    img.setPosition(0, 0, 0);
  }

  private ensureShell() {
    const { w, h } = this.canvasSize();
    const cam = this.node.getChildByName("UICamera")?.getComponent(Camera);
    if (cam) cam.clearColor = new Color(12, 28, 22, 255);

    this.node.getChildByName("ShellBg")?.destroy();
    const bg = new Node("ShellBg");
    bg.layer = this.node.layer;
    this.node.insertChild(bg, 0);
    bg.setPosition(0, 0, 0);
    bg.addComponent(UITransform).setContentSize(w, h);

    const g = bg.addComponent(Graphics);
    g.fillColor = WOOD;
    g.rect(-w / 2, -h / 2, w, h);
    g.fill();

    const img = new Node("img");
    img.layer = bg.layer;
    bg.addChild(img);
    img.addComponent(UITransform).setContentSize(w, h);
    const sp = img.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.type = Sprite.Type.SIMPLE;
    clearUiSpriteCache("auction-bg");
    void loadUiSpriteFrame("auction-bg").then((sf) => {
      if (!sf || !sp.isValid) return;
      this.applyFitSprite(img, sf, w, h);
      sp.spriteFrame = sf;
      g.clear();
    });
  }

  private ensureUi() {
    this.node.getChildByName("HudRoot")?.destroy();
    this.raiseButtons = [];
    this.btnAllin = null;
    this.allinSub = null;
    this.lastArtId = "";
    this.lastDescBgKey = "";
    this.itemArtSprite = null;
    this.itemArtFill = null;
    this.descBgSprite = null;
    this.ensureShell();
    this.hideLegacySceneHud();
    this.buildHud();
    this.wireButtons();
  }

  private hideLegacySceneHud() {
    for (const name of ["Title", "Status", "PanelBid", "PanelDone", "EventLine", "BtnBack"]) {
      const n = this.node.getChildByName(name);
      if (n) n.active = false;
    }
  }

  private pin(node: Node, opts: { left?: number; right?: number; top?: number; bottom?: number; hCenter?: boolean }) {
    const w = node.getComponent(Widget) ?? node.addComponent(Widget);
    w.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
    if (opts.left != null) {
      w.isAlignLeft = true;
      w.left = opts.left;
    }
    if (opts.right != null) {
      w.isAlignRight = true;
      w.right = opts.right;
    }
    if (opts.top != null) {
      w.isAlignTop = true;
      w.top = opts.top;
    }
    if (opts.bottom != null) {
      w.isAlignBottom = true;
      w.bottom = opts.bottom;
    }
    if (opts.hCenter) {
      w.isAlignHorizontalCenter = true;
      w.horizontalCenter = 0;
    }
  }

  private buildHud() {
    const root = new Node("HudRoot");
    root.layer = this.node.layer;
    this.node.addChild(root);
    root.addComponent(UITransform).setContentSize(1920, 1080);
    this.panelBid = root;

    this.seatsHost = new Node("SeatsHost");
    this.seatsHost.layer = root.layer;
    root.addChild(this.seatsHost);
    this.seatsHost.addComponent(UITransform).setContentSize(1920, 1080);

    this.buildCenterBoards(root);
    this.buildBidBar(root);

    const toast = this.makeLabel(root, "Toast", "", 0, -300, 24, GOLD, 880, 40);
    this.toastLabel = toast;
    this.toastOp = toast.node.addComponent(UIOpacity);
    this.toastOp.opacity = 0;
    this.pin(toast.node, { hCenter: true, bottom: 220 });

    this.statusLabel = this.makeLabel(root, "NetStatus", "", 0, 0, 22, MUTED, 640, 32);
    this.pin(this.statusLabel.node, { hCenter: true, bottom: 220 });

    this.panelDone = new Node("PanelDone");
    this.panelDone.layer = this.node.layer;
    this.panelDone.active = false;
    this.node.addChild(this.panelDone);
    this.panelDone.addComponent(UITransform).setContentSize(1920, 1080);
    this.makeWoodBoard(this.panelDone, "doneBoard", 0, 40, 640, 220);
    this.makeLabel(this.panelDone, "DoneText", "拍卖结束\n正在进入牌桌…", 0, 40, 32, CREAM, 560, 160);
    installVolumeControl(root);
  }

  private buildCenterBoards(parent: Node) {
    const left = this.makePlaqueHost(parent, "CountBoard", -284, 177, 300, 248);
    this.countdownCap = this.hudLabel(left, "cap", "流拍倒计时", 0, 78, 22, CREAM, 240, 30);
    this.countdownLab = this.hudLabel(left, "timer", "—", 0, 8, 52, GOLD, 260, 80);
    this.countdownUnit = this.hudLabel(left, "unit", "", 0, 0, 22, CREAM, 40, 28);
    this.countdownUnit.node.active = false;

    this.itemCard = this.makeWoodBoard(parent, "ItemCard", 0, ITEM_CARD_Y, ITEM_CARD_W, ITEM_CARD_H);
    this.buildItemArt(this.itemCard);
    const bar = this.makeWoodBoard(this.itemCard, "pedestal", 0, ITEM_BAR_Y, ITEM_BAR_W, ITEM_BAR_H);
    const bg = bar.getComponent(Graphics)!;
    bg.clear();
    bg.fillColor = new Color(32, 18, 10, 236);
    bg.roundRect(-ITEM_BAR_W / 2, -ITEM_BAR_H / 2, ITEM_BAR_W, ITEM_BAR_H, ITEM_BAR_RADIUS);
    bg.fill();
    this.pedestalLab = this.makeLabel(
      bar,
      "phase",
      "竞价中",
      0,
      0,
      ITEM_BAR_FONT,
      GOLD,
      ITEM_BAR_W - 12,
      Math.round(28 * ITEM_CARD_SCALE),
    );

    this.descBoard = this.makeWoodBoard(parent, "ItemDesc", 0, DESC_BOARD_Y, DESC_BOARD_W, DESC_BOARD_H);
    this.buildDescBg(this.descBoard);
    this.itemNameLabel = this.makeLabel(this.descBoard, "name", "揭示中…", 0, 90, 34, GOLD, 440, 46);
    this.itemNameLabel.enableOutline = true;
    this.itemNameLabel.outlineColor = INK;
    this.itemNameLabel.outlineWidth = 2;
    this.itemDescLabel = this.makeLabel(this.descBoard, "desc", "等待揭示当前道具", 0, -18, 26, CREAM, 440, 168);
    this.itemDescLabel.enableOutline = true;
    this.itemDescLabel.outlineColor = INK;
    this.itemDescLabel.outlineWidth = 2;
    this.itemDescLabel.overflow = Label.Overflow.SHRINK;
    this.itemDescLabel.enableWrapText = true;
    this.itemDescLabel.verticalAlign = Label.VerticalAlign.TOP;

    this.priceBoard = this.makePlaqueHost(parent, "PriceBoard", 298, 177, 300, 248);
    this.priceCap = this.hudLabel(this.priceBoard, "cap", "当前价", 0, 78, 22, CREAM, 240, 30);
    this.priceLabel = this.hudLabel(this.priceBoard, "price", "—", 0, 17, 52, GOLD, 240, 76);
    this.leaderLabel = this.hudLabel(this.priceBoard, "leader", "尚未出价", 0, -56, 20, CREAM, 260, 48);
    this.leaderLabel.enableWrapText = true;
  }

  private buildBidBar(parent: Node) {
    const bar = new Node("BidBar");
    bar.layer = parent.layer;
    parent.addChild(bar);
    bar.addComponent(UITransform).setContentSize(1600, 190);
    bar.setPosition(0, -424, 0);

    const xs = [-454, -262, -70, 124, 316];
    RAISE_AMOUNTS.forEach((amount, i) => {
      const { btn, sub } = this.makeBidButton(
        bar,
        `BtnRaise${amount}`,
        `+${amount}`,
        xs[i] ?? 0,
        0,
        176,
        168,
        false,
      );
      this.raiseButtons.push({ amount, btn, sub });
    });
    const allin = this.makeBidButton(bar, "BtnAllin", "ALL-IN", 550, 0, 256, 180, true);
    this.btnAllin = allin.btn;
    this.allinSub = allin.sub;
  }

  private wireButtons() {
    for (const { amount, btn } of this.raiseButtons) {
      this.bindTap(btn, () => this.onRaise(amount));
    }
    this.bindTap(this.btnAllin, () => this.onAllin());
    this.panelBid?.getChildByName("BtnBack")?.destroy();
  }

  private bindTap(btn: Button | null, fn: () => void) {
    if (!btn) return;
    const n = btn.node;
    let last = 0;
    const run = () => {
      const t = Date.now();
      if (t - last < 220) return;
      last = t;
      playButtonSfx();
      this.pop(n, 1.1);
      fn();
    };
    n.off(Button.EventType.CLICK);
    n.on(Button.EventType.CLICK, run, this);
  }

  /** 短回弹后回到 1，不加长按锁。 */
  private pop(node: Node | null, squash = 1.12) {
    if (!node?.isValid) return;
    Tween.stopAllByTarget(node);
    node.setScale(1, 1, 1);
    tween(node)
      .to(0.06, { scale: new Vec3(squash, 0.9, 1) }, { easing: "quadOut" })
      .to(0.16, { scale: Vec3.ONE }, { easing: "backOut" })
      .start();
  }

  private flashToast() {
    if (!this.toastOp || !this.toastLabel) return;
    this.toastOp.opacity = 255;
    this.unschedule(this.hideToast);
    this.scheduleOnce(this.hideToast, 2.4);
  }

  private hideToast = () => {
    if (!this.toastOp) return;
    tween(this.toastOp).to(0.35, { opacity: 0 }, { easing: "quadOut" }).start();
  };

  private refresh() {
    if (this.leavingToTable || this.node.getComponent(TableRoom)) return;

    const online = net.connected && net.welcomed;
    if (this.statusLabel) {
      this.statusLabel.node.active = !online;
      this.statusLabel.string = online ? "" : net.statusText || "未连接";
    }

    const view = session.matchView;
    const auction = view?.auction ?? null;
    const phase = view?.public?.phase ?? "";
    const inAuction = !!auction && (phase === "auction" || auction.phase !== "finished");

    if (this.panelBid) this.panelBid.active = inAuction;
    if (this.panelDone) this.panelDone.active = !inAuction;

    if (this.toastLabel) {
      const err = session.lastError.trim();
      this.toastLabel.string = err || session.lastEventText;
      this.toastLabel.color = err ? URGENT : GOLD;
      if (err && this.toastOp) this.toastOp.opacity = 255;
    }

    if (!view || !inAuction) return;

    const a = auction!;
    const item = a.currentItem;
    if (this.itemNameLabel) {
      this.itemNameLabel.string = item?.name ?? "揭示中…";
      this.itemNameLabel.color = item ? hexColor(item.color, GOLD) : MUTED;
    }
    if (this.itemDescLabel) {
      this.itemDescLabel.string = item?.description ?? "等待揭示当前道具";
    }
    this.paintDescBoardBg(item?.rarity ?? "");
    if (this.pedestalLab) {
      this.pedestalLab.string = `第 ${a.currentLotIndex + 1}/${a.totalLots} 件 · ${PHASE_BAR[a.phase] ?? a.phase}`;
    }
    this.paintItemCardFrame(item ? rarityInk(item.rarity) : ITEM_CARD_STROKE);
    this.paintItemArt(item?.id ?? "", item ? hexColor(item.color, GOLD) : MUTED);

    const priceChanged = this.lastPrice >= 0 && this.lastPrice !== a.currentPrice;
    const lotChanged = this.lastLot >= 0 && this.lastLot !== a.currentLotIndex;
    const leaderChanged = this.lastLeader !== (a.leadingPlayerId ?? "");
    this.lastPrice = a.currentPrice;
    this.lastLot = a.currentLotIndex;
    this.lastLeader = a.leadingPlayerId ?? "";

    this.paintPriceBoard(a);
    this.paintTimer(a, Math.max(0, this.settleDeadline - Date.now()));
    this.refreshSeats(a);
    this.refreshButtons(a);

    if (lotChanged) {
      this.pop(this.itemCard, 1.08);
      this.pop(this.descBoard, 1.06);
    }
    if (priceChanged) this.pop(this.priceBoard, 1.06);
    if (leaderChanged && a.leadingPlayerId) {
      const paddle = this.seatsHost?.getChildByName(`seat-${a.leadingPlayerId}`)?.getChildByName("paddle");
      this.pop(paddle ?? null, 1.18);
    }
  }

  private paintPriceBoard(a: AuctionPublicView) {
    const settled = a.phase === "settled_lot";
    const leader = a.leadingPlayerId ? this.seatTitle(a.leadingPlayerId) : "";
    if (this.priceCap) this.priceCap.string = settled ? "最终成交价" : "当前价";
    if (this.priceLabel) this.priceLabel.string = String(a.currentPrice);
    if (this.leaderLabel) {
      if (settled && leader) this.leaderLabel.string = `拍卖赢家：${leader}`;
      else if (a.leadingPlayerId === session.playerId) this.leaderLabel.string = "你已领先\n等别人加价";
      else if (leader) this.leaderLabel.string = `领先 ${leader}`;
      else this.leaderLabel.string = "尚未出价";
    }
  }

  private paintTimer(a: AuctionPublicView, leftMs: number) {
    if (!this.countdownLab) return;
    const live = a.phase === "bidding" || a.phase === "waiting_open";
    const verb = !live ? "本轮倒计时" : a.leadingPlayerId ? "成交倒计时" : "流拍倒计时";
    if (this.countdownCap) this.countdownCap.string = verb;
    let num: string;
    if (!live) num = a.phase === "settled_lot" ? "0" : "—";
    else if (leftMs >= 3000) num = String(Math.ceil(leftMs / 1000));
    else num = (leftMs / 1000).toFixed(1);
    if (this.countdownUnit) this.countdownUnit.node.active = false;
    const urgent = live && leftMs < 1500;
    this.countdownLab.color = urgent ? URGENT : GOLD;
    const key = `${verb}:${num}`;
    if (key === this.lastTimerKey) return;
    this.lastTimerKey = key;
    this.countdownLab.string = num === "—" ? "—" : `${num} 秒`;
    const tick = live ? Math.ceil(leftMs / 1000) : -1;
    if (live && leftMs < 4000 && tick !== this.lastTickSec) {
      this.lastTickSec = tick;
      this.pop(this.countdownLab.node, urgent ? 1.18 : 1.1);
    }
  }

  private seatTitle(playerId: string): string {
    const ids = session.room?.playerIds ?? [];
    const seat = ids.indexOf(playerId);
    if (seat >= 0 && ids.length > 0) {
      const you = playerId === session.playerId ? "（你）" : "";
      return `${seatAnimalName(seat, ids.length)}${you}`;
    }
    const nick = session.playerName(playerId).trim();
    if (playerId === session.playerId) return nick || "你";
    if (nick && nick !== playerId) return nick;
    return `玩家${playerId.slice(-4)}`;
  }

  private ensureSeatSlot(id: string): Node {
    let slot = this.seatsHost!.getChildByName(`seat-${id}`);
    if (slot) return slot;
    slot = new Node(`seat-${id}`);
    slot.layer = this.seatsHost!.layer;
    this.seatsHost!.addChild(slot);
    slot.addComponent(UITransform).setContentSize(180, 80);
    const plate = this.makeWoodBoard(slot, "nameplate", 0, 0, 168, NAMEPLATE_H);
    this.makeLabel(plate, "name", "", 0, 8, 20, CREAM, 156, 22);
    this.makeLabel(plate, "coin", "", 0, -12, 20, GOLD, 156, 22);
    const paddle = new Node("paddle");
    paddle.layer = slot.layer;
    slot.addChild(paddle);
    paddle.addComponent(UITransform).setContentSize(64, 64);
    paddle.addComponent(Graphics);
    this.makeLabel(paddle, "bid", "", 0, 0, 22, CREAM, 58, 32);
    return slot;
  }

  private refreshSeats(a: AuctionPublicView) {
    if (!this.seatsHost) return;
    const ids = session.room?.playerIds ?? Object.keys(a.balances);
    const me = session.playerId;
    const n = ids.length > 0 ? ids.length : 4;
    const occupied = new Map<SeatAnimalId, string>();
    if (ids.length === 0) {
      for (const chair of WORLD_CHAIRS) occupied.set(chair.id, `preview-${chair.id}`);
    } else {
      ids.forEach((id, seat) => occupied.set(seatAnimalId(seat, n), id));
    }
    const spec = spectatorAnimalId(n);
    const seen = new Set<string>();

    for (const chair of WORLD_CHAIRS) {
      const playerId = occupied.get(chair.id);
      const spectator = !playerId && spec === chair.id;
      if (!playerId && !spectator) continue;
      const id = playerId ?? `spectator-${chair.id}`;
      seen.add(id);
      const slot = this.ensureSeatSlot(id);
      slot.setPosition(chair.x, chair.y, 0);
      slot.getChildByName("sitter")?.destroy();
      const plate = slot.getChildByName("nameplate");
      const paddle = slot.getChildByName("paddle");
      plate?.setPosition(0, 0, 0);
      paddle?.setPosition(0, PADDLE_ABOVE_Y, 0);
      const nameLab = plate?.getChildByName("name")?.getComponent(Label);
      const coinLab = plate?.getChildByName("coin")?.getComponent(Label);
      const mine = playerId === me;
      if (plate) this.paintSeatPlate(plate, mine && !spectator);
      if (spectator) {
        if (nameLab) {
          nameLab.string = seatAnimalNameById(chair.id);
          this.setSeatInk(nameLab, MUTED, false);
        }
        if (coinLab) {
          coinLab.string = "观众";
          this.setSeatInk(coinLab, MUTED, false);
        }
        if (paddle) paddle.active = false;
        continue;
      }
      const leading = a.leadingPlayerId === playerId;
      const you = mine ? "（你）" : "";
      if (nameLab) {
        nameLab.string = `${seatAnimalNameById(chair.id)}${you}`;
        this.setSeatInk(nameLab, mine ? SELF_PLATE_INK : CREAM, mine);
      }
      if (coinLab) {
        coinLab.string = `★ ${a.balances[playerId!] ?? 0}`;
        coinLab.color = GOLD;
      }
      if (paddle) {
        paddle.active = leading;
        this.paintPaddle(paddle, a.currentPrice);
      }
    }

    for (const child of [...this.seatsHost.children]) {
      const id = child.name.startsWith("seat-") ? child.name.slice(5) : "";
      if (id && !seen.has(id)) child.destroy();
    }
  }

  private paintPaddle(paddle: Node, price: number) {
    const g = paddle.getComponent(Graphics);
    if (g) {
      g.clear();
      g.fillColor = PADDLE;
      g.circle(0, 0, PADDLE_R);
      g.fill();
      g.strokeColor = GOLD;
      g.lineWidth = 3;
      g.circle(0, 0, PADDLE_R);
      g.stroke();
    }
    const bidLab = paddle.getChildByName("bid")?.getComponent(Label);
    if (bidLab) {
      bidLab.string = String(price);
      bidLab.enableOutline = true;
      bidLab.outlineColor = INK;
      bidLab.outlineWidth = 2;
    }
  }

  private setSeatInk(lab: Label, color: Color, selfSeat: boolean) {
    lab.color = color;
    lab.enableOutline = selfSeat;
    lab.outlineColor = new Color(18, 32, 56, 220);
    lab.outlineWidth = selfSeat ? 2 : 0;
  }

  private paintSeatPlate(plate: Node, selfSeat: boolean) {
    const g = plate.getComponent(Graphics);
    const ut = plate.getComponent(UITransform);
    if (!g || !ut) return;
    const w = ut.contentSize.width;
    const h = ut.contentSize.height;
    const hw = w / 2;
    const hh = h / 2;
    g.clear();
    g.fillColor = selfSeat ? SELF_PLATE_FILL : PLATE_FILL;
    g.roundRect(-hw, -hh, w, h, 16);
    g.fill();
    g.strokeColor = selfSeat ? SELF_PLATE_STROKE : PLATE_STROKE;
    g.lineWidth = 3;
    g.roundRect(-hw, -hh, w, h, 16);
    g.stroke();
  }

  private refreshButtons(a: AuctionPublicView) {
    const me = session.playerId;
    const mine = a.balances[me] ?? 0;
    const leading = a.leadingPlayerId === me;
    const cooling = Date.now() < this.localCooldownUntil;
    const live = a.phase === "bidding" || a.phase === "waiting_open";
    const canBid = live && !leading && !cooling;

    for (const { amount, btn } of this.raiseButtons) {
      const next = a.currentPrice + Number(amount);
      const on = canBid && mine >= next;
      this.setBidLook(btn, on, false);
    }
    this.setBidLook(this.btnAllin, canBid && mine > a.currentPrice, true);
    if (this.allinSub) this.allinSub.string = `${mine}`;
  }

  private onRaise(raise: RaiseAmount) {
    const a = session.matchView?.auction;
    if (!a) {
      session.lastError = "拍卖未开始";
      this.flashToast();
      this.refresh();
      return;
    }
    if (a.phase !== "bidding" && a.phase !== "waiting_open") {
      session.lastError = "本件已结束，等下一件";
      this.flashToast();
      this.refresh();
      return;
    }
    if (a.leadingPlayerId === session.playerId) {
      session.lastError = "你已领先，等别人加价";
      this.flashToast();
      this.refresh();
      return;
    }
    if (Date.now() < this.localCooldownUntil) {
      session.lastError = "加价冷却 0.5 秒";
      this.flashToast();
      this.refresh();
      return;
    }
    this.localCooldownUntil = Date.now() + 500;
    if (!this.sendIntent({ type: "auction_raise", raise })) return;
    this.applyLocalRaise(a, raise);
    this.refresh();
  }

  private applyLocalRaise(a: AuctionPublicView, raise: RaiseAmount) {
    const next = raise === "allin" ? a.balances[session.playerId] ?? 0 : a.currentPrice + Number(raise);
    if (!Number.isFinite(next) || next <= a.currentPrice) return;
    a.currentPrice = next;
    a.leadingPlayerId = session.playerId;
    this.settleDeadline = Date.now() + 4000;
    session.lastError = "";
    session.lastEventText = `${session.displayName} 叫到 ${next}`;
    this.flashToast();
  }

  private onAllin() {
    this.onRaise("allin");
  }

  private playBidVoice(ev: unknown) {
    if (!ev || typeof ev !== "object") return;
    const e = ev as { type?: string; playerId?: string; raise?: unknown };
    if (e.type !== "bid" || !e.playerId) return;
    const ids = session.room?.playerIds ?? [];
    const animal = tableAnimalId(e.playerId, ids);
    if (!animal) return;
    playAuctionCallSfx(animal, e.raise === "allin" ? "allin" : "raise");
  }

  private sendIntent(msg: Parameters<typeof net.send>[0]): boolean {
    session.lastError = "";
    if (!net.send(msg)) {
      session.lastError = "未连接，请先 npm run dev";
      this.flashToast();
      this.refresh();
      return false;
    }
    return true;
  }

  private buildItemArt(parent: Node) {
    const size = ITEM_ART;
    const n = new Node("ItemArt");
    n.layer = parent.layer;
    parent.addChild(n);
    n.setPosition(0, ITEM_ART_Y, 0);
    n.addComponent(UITransform).setContentSize(size, size);

    const fill = new Node("fill");
    fill.layer = n.layer;
    n.addChild(fill);
    fill.addComponent(UITransform).setContentSize(size, size);
    this.itemArtFill = fill.addComponent(Graphics);

    const img = new Node("sprite");
    img.layer = n.layer;
    n.addChild(img);
    img.addComponent(UITransform).setContentSize(size, size);
    const sp = img.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.type = Sprite.Type.SIMPLE;
    sp.spriteFrame = null;
    this.itemArtSprite = sp;
    this.paintArtPlaceholder(MUTED);
  }

  private paintArtPlaceholder(ink: Color) {
    const g = this.itemArtFill;
    if (!g) return;
    const s = ITEM_ART;
    const hw = s / 2;
    g.clear();
    g.fillColor = new Color(28, 18, 12, 230);
    const corner = Math.round(14 * ITEM_CARD_SCALE);
    g.roundRect(-hw, -hw, s, s, corner);
    g.fill();
    g.strokeColor = new Color(ink.r, ink.g, ink.b, 240);
    g.lineWidth = Math.max(4, Math.round(4 * ITEM_CARD_SCALE));
    g.roundRect(-hw, -hw, s, s, corner);
    g.stroke();
    const inner = Math.round(52 * ITEM_CARD_SCALE);
    g.fillColor = new Color(ink.r, ink.g, ink.b, 70);
    g.roundRect(-inner, -inner, inner * 2, inner * 2, Math.round(10 * ITEM_CARD_SCALE));
    g.fill();
  }

  private paintItemArt(itemId: string, ink: Color) {
    if (itemId === this.lastArtId) {
      if (!this.itemArtSprite?.spriteFrame) this.paintArtPlaceholder(ink);
      return;
    }
    this.lastArtId = itemId;
    if (this.itemArtSprite) this.itemArtSprite.spriteFrame = null;
    if (this.itemArtFill) this.itemArtFill.node.active = true;
    this.paintArtPlaceholder(ink);
    if (!itemId) return;
    const token = itemId;
    void loadUiSpriteFrame(`item-${itemId}`).then((sf) => {
      if (!this.itemArtSprite?.isValid || this.lastArtId !== token) return;
      this.itemArtSprite.spriteFrame = sf;
      if (this.itemArtFill) this.itemArtFill.node.active = !sf;
    });
  }

  private paintItemCardFrame(ink: Color) {
    const n = this.itemCard;
    const g = n?.getComponent(Graphics);
    if (!n || !g) return;
    const w = ITEM_CARD_W;
    const h = ITEM_CARD_H;
    const hw = w / 2;
    const hh = h / 2;
    const lw = ITEM_CARD_FRAME_W;
    const inset = lw / 2;
    g.clear();
    g.fillColor = new Color(72, 44, 24, 200);
    g.roundRect(-hw, -hh, w, h, 16);
    g.fill();
    g.strokeColor = new Color(ink.r, ink.g, ink.b, 255);
    g.lineWidth = lw;
    g.roundRect(-hw + inset, -hh + inset, w - lw, h - lw, 16);
    g.stroke();
  }

  private descBgKey(rarity: string): string {
    if (rarity === "legendary") return "auction-desc-legendary";
    if (rarity === "epic") return "auction-desc-epic";
    if (rarity === "rare") return "auction-desc-rare";
    return "";
  }

  private buildDescBg(parent: Node) {
    const w = DESC_BOARD_W - DESC_BG_INSET * 2;
    const h = DESC_BOARD_H - DESC_BG_INSET * 2;
    const maskN = new Node("DescBgMask");
    maskN.layer = parent.layer;
    parent.insertChild(maskN, 0);
    maskN.setPosition(0, 0, 0);
    maskN.addComponent(UITransform).setContentSize(w, h);
    const mask = maskN.addComponent(Mask);
    mask.type = Mask.Type.GRAPHICS_STENCIL;
    const stencil = maskN.getComponent(Graphics) ?? maskN.addComponent(Graphics);
    stencil.clear();
    stencil.fillColor = Color.WHITE;
    stencil.roundRect(-w / 2, -h / 2, w, h, Math.max(8, DESC_BOARD_RADIUS - 4));
    stencil.fill();

    const img = new Node("img");
    img.layer = maskN.layer;
    maskN.addChild(img);
    img.addComponent(UITransform).setContentSize(w, h);
    const sp = img.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.type = Sprite.Type.SIMPLE;
    sp.spriteFrame = null;
    this.descBgSprite = sp;
  }

  private paintDescBoardBg(rarity: string) {
    const key = this.descBgKey(rarity);
    if (key === this.lastDescBgKey) return;
    this.lastDescBgKey = key;
    if (!this.descBgSprite) return;
    this.descBgSprite.spriteFrame = null;
    if (!key) return;
    const token = key;
    clearUiSpriteCache(key);
    void loadUiSpriteFrame(key).then((sf) => {
      if (!this.descBgSprite?.isValid || this.lastDescBgKey !== token) return;
      this.descBgSprite.spriteFrame = sf;
    });
  }

  private makePlaqueHost(parent: Node, name: string, x: number, y: number, w: number, h: number): Node {
    const n = new Node(name);
    n.layer = parent.layer;
    parent.addChild(n);
    n.setPosition(x, y, 0);
    n.addComponent(UITransform).setContentSize(w, h);
    return n;
  }

  private hudLabel(
    parent: Node,
    name: string,
    text: string,
    x: number,
    y: number,
    size: number,
    color: Color,
    w: number,
    h: number,
  ): Label {
    const lab = this.makeLabel(parent, name, text, x, y, size, color, w, h);
    lab.enableOutline = true;
    lab.outlineColor = INK;
    lab.outlineWidth = 2;
    lab.overflow = Label.Overflow.SHRINK;
    return lab;
  }

  private makeWoodBoard(parent: Node, name: string, x: number, y: number, w: number, h: number): Node {
    const n = new Node(name);
    n.layer = parent.layer;
    parent.addChild(n);
    n.setPosition(x, y, 0);
    n.addComponent(UITransform).setContentSize(w, h);
    const g = n.addComponent(Graphics);
    const hw = w / 2;
    const hh = h / 2;
    g.fillColor = new Color(72, 44, 24, 200);
    g.roundRect(-hw, -hh, w, h, 16);
    g.fill();
    g.strokeColor = new Color(212, 164, 72, 240);
    g.lineWidth = 3;
    g.roundRect(-hw, -hh, w, h, 16);
    g.stroke();
    return n;
  }

  private makeBidButton(
    parent: Node,
    name: string,
    text: string,
    x: number,
    y: number,
    w: number,
    h: number,
    allin: boolean,
  ): { btn: Button; sub: Label | null } {
    const n = new Node(name);
    n.layer = parent.layer;
    parent.addChild(n);
    n.setPosition(x, y, 0);
    n.addComponent(UITransform).setContentSize(w, h);
    const hit = n.addComponent(Graphics);
    hit.fillColor = new Color(255, 255, 255, 1);
    hit.roundRect(-w / 2, -h / 2, w, h, 18);
    hit.fill();
    const btn = n.addComponent(Button);
    btn.transition = Button.Transition.NONE;
    btn.enableAutoGrayEffect = false;
    const lab = this.makeLabel(n, "lab", text, 0, 12, allin ? 24 : 30, CREAM, w - 12, 36);
    lab.node.active = false;
    const sub = this.makeLabel(n, "sub", "", 0, allin ? -46 : -26, 26, GOLD, w - 28, 32);
    sub.enableOutline = true;
    sub.outlineColor = INK;
    sub.outlineWidth = 2;
    sub.node.active = allin;
    return { btn, sub: allin ? sub : null };
  }

  private makeWoodButton(
    parent: Node,
    name: string,
    text: string,
    x: number,
    y: number,
    w: number,
    h: number,
    allin: boolean,
  ): Button {
    const n = new Node(name);
    n.layer = parent.layer;
    parent.addChild(n);
    n.setPosition(x, y, 0);
    n.addComponent(UITransform).setContentSize(w, h);
    this.paintChip(n, w, h, true, allin);
    const lab = this.makeLabel(n, "lab", text, 0, 0, 22, GOLD, w - 8, h - 8);
    lab.enableOutline = true;
    lab.outlineColor = INK;
    lab.outlineWidth = 2;
    const btn = n.addComponent(Button);
    btn.transition = Button.Transition.NONE;
    return btn;
  }

  private paintChip(n: Node, w: number, h: number, on: boolean, allin: boolean) {
    const g = n.getComponent(Graphics) ?? n.addComponent(Graphics);
    g.clear();
    const hw = w / 2;
    const hh = h / 2;
    const fill = !on ? new Color(70, 78, 72, 255) : allin ? ORANGE_BTN : GREEN_BTN;
    g.fillColor = fill;
    g.roundRect(-hw, -hh, w, h, 14);
    g.fill();
    g.strokeColor = on ? GOLD : MUTED;
    g.lineWidth = 3;
    g.roundRect(-hw, -hh, w, h, 14);
    g.stroke();
  }

  private setBidLook(btn: Button | null, on: boolean, _allin: boolean) {
    if (!btn) return;
    btn.interactable = on;
    btn.enableAutoGrayEffect = false;
  }

  private makeLabel(
    parent: Node,
    name: string,
    text: string,
    x: number,
    y: number,
    size: number,
    color: Color,
    w: number,
    h: number,
  ): Label {
    const n = new Node(name);
    n.layer = parent.layer;
    parent.addChild(n);
    n.setPosition(x, y, 0);
    n.addComponent(UITransform).setContentSize(w, h);
    const lab = n.addComponent(Label);
    lab.string = text;
    lab.useSystemFont = true;
    lab.fontSize = Math.max(20, size);
    lab.lineHeight = Math.round(Math.max(20, size) * 1.3);
    lab.horizontalAlign = Label.HorizontalAlign.CENTER;
    lab.verticalAlign = Label.VerticalAlign.CENTER;
    lab.color = color;
    return lab;
  }
}

function auctionErrorCn(message: string): string {
  const map: Record<string, string> = {
    "Not in auction": "还没开始拍卖",
    "Not in bidding phase": "本件未在竞价",
    "Unknown player": "你不在这场拍卖里",
    "Leading bidder cannot raise own bid": "你已领先，等别人加价",
    "Raise cooldown active": "加价冷却中，稍等 0.5 秒",
    "All-in must exceed current price": "All-in 必须高于当前价",
    "Insufficient balance": "拍卖币不够",
    "Invalid raise": "加价档无效",
    "Auction finished": "拍卖已结束",
    "Opening bid removed; raise from floor 10": "没有首叫，请直接加价",
  };
  return map[message] ?? message;
}
