/**
 * 独立结算页：三人/四人账本背景已含动物头像。
 * 每行：用户名 + 积分变化 + 变化后积分，胜利行「胜」在行尾。
 * 左下返回大厅，右下继续一起游玩（只显示已点人数 x/n）。
 */
import {
  _decorator,
  BlockInputEvents,
  Button,
  Camera,
  Color,
  Component,
  director,
  Graphics,
  Label,
  Node,
  Sprite,
  SpriteFrame,
  UITransform,
} from "cc";
import { EDITOR, PREVIEW } from "cc/env";
import { bootNet } from "../app/connect";
import { isAuctionPhase, RESUME_AUCTION_EVENT, shouldEnterAuction } from "../app/matchFlow";
import { session } from "../app/Session";
import { playButtonSfx } from "../app/cardSfx";
import { clearUiSpriteCache, loadUiSpriteFrame } from "../app/uiSkin";
import { SettlementDelta } from "../net/Protocol";
import { net } from "../net/WsClient";

const { ccclass } = _decorator;

const GOLD = new Color(255, 214, 110, 255);
const CREAM = new Color(245, 236, 214, 255);
const INK = new Color(48, 28, 10, 255);
const WIN = new Color(96, 220, 140, 255);
const LOSE = new Color(255, 138, 120, 255);
const WOOD = new Color(58, 38, 24, 255);

/** 三人行对齐 settle-bg-3 头像/行槽中心（上熊猫、中猫头鹰、下狐狸）。 */
const ROW_Y_3 = [202, -10, -242];
/** 四人行对齐 settle-bg-4 头像/行槽中心（熊猫、猫头鹰、狐狸、兔子）。 */
const ROW_Y_4 = [222, 56, -112, -271];
const NAME_X = -240;
const DELTA_X = 40;
const SCORE_X = 340;
const BADGE_X = 628;
const BACK_HIT = { x: -760, y: -438, w: 300, h: 100 };
const PLAY_HIT = { x: 549, y: -454, w: 640, h: 114 };
const COUNT_POS_3 = { x: 713, y: -455 };
const COUNT_POS_4 = { x: 721, y: -450 };

function isWinner(playerCount: number, rank: number | null): boolean {
  if (rank == null) return false;
  if (playerCount === 3) return rank === 1;
  return rank <= 2;
}

function continueSlots(playerCount: number): {
  play: { x: number; y: number; w: number; h: number };
  count: { x: number; y: number };
} {
  return { play: PLAY_HIT, count: playerCount >= 4 ? COUNT_POS_4 : COUNT_POS_3 };
}

@ccclass("SettleRoom")
export class SettleRoom extends Component {
  private root: Node | null = null;
  private listHost: Node | null = null;
  private countLabel: Label | null = null;
  private errorLabel: Label | null = null;
  private leaving = false;
  private unbindMsg: (() => void) | null = null;
  private unbindStatus: (() => void) | null = null;

  onLoad() {
    if (EDITOR && !PREVIEW) return;
    session.ensureIdentity();
    this.ensureUi();
    this.unbindMsg = net.onMessage((msg) => {
      if (msg.type === "welcome") {
        session.rememberIdentity(msg.playerId, msg.displayName);
      } else if (msg.type === "room") {
        session.room = msg.room;
        if (msg.room.phase === "in_match") {
          if (this.goToAuctionIfNeeded()) return;
          return;
        }
        this.refresh();
      } else if (msg.type === "match") {
        session.setMatchView(msg.view);
        if (this.goToAuctionIfNeeded()) return;
        this.refresh();
      } else if (msg.type === "settlement") {
        session.lastSettlement = msg.deltas;
        this.refresh();
      } else if (msg.type === "score") {
        session.applyScore(msg.score);
        session.dailyRestoreDay = msg.dailyRestoreDay ?? null;
        this.refresh();
      } else if (msg.type === "error") {
        session.lastError = msg.message === "积分不足" ? "积分不足" : msg.message;
        this.refresh();
      }
    });
    this.unbindStatus = net.onStatus(() => this.refresh());
    void bootNet();
    if (this.goToAuctionIfNeeded()) return;
    this.refresh();
  }

  update() {
    if (EDITOR && !PREVIEW) return;
    this.refreshContinueHud();
  }

  onDestroy() {
    this.unbindMsg?.();
    this.unbindStatus?.();
    this.unscheduleAllCallbacks();
  }

  private goToAuctionIfNeeded(): boolean {
    if (this.leaving) return true;
    if (
      !shouldEnterAuction(session.matchView, session.room) &&
      !isAuctionPhase(session.matchView)
    ) {
      return false;
    }
    this.leaving = true;
    this.scheduleOnce(() => {
      if (!this.node?.isValid) return;
      if (this.node.getComponent("AuctionRoom")) {
        this.node.emit(RESUME_AUCTION_EVENT);
        return;
      }
      director.loadScene("Auction");
    }, 0);
    return true;
  }

  private ensureUi() {
    const { w, h } = this.canvasSize();
    const cam = this.node.getChildByName("UICamera")?.getComponent(Camera);
    if (cam) cam.clearColor = new Color(18, 42, 28, 255);

    let root = this.node.getChildByName("SettleRoot");
    if (!root) {
      root = new Node("SettleRoot");
      root.layer = this.node.layer;
      this.node.addChild(root);
    }
    this.root = root;
    root.setPosition(0, 0, 0);
    let uit = root.getComponent(UITransform);
    if (!uit) uit = root.addComponent(UITransform);
    uit.setContentSize(w, h);
    if (!root.getComponent(BlockInputEvents)) root.addComponent(BlockInputEvents);
    this.raiseSettleRoot();

    this.ensureBg(w, h);
    if (!this.listHost) {
      this.listHost = new Node("SettleList");
      this.listHost.layer = root.layer;
      root.addChild(this.listHost);
      this.listHost.addComponent(UITransform).setContentSize(w, h);
    }
    const slots = continueSlots(this.playerCount());
    this.ensureHit(root, "BtnSettleBack", BACK_HIT, () => this.onBack());
    this.ensureHit(root, "BtnContinuePlay", slots.play, () => this.onContinue());
    this.ensureContinueHud(root, slots);
  }

  private ensureBg(w: number, h: number) {
    const root = this.root!;
    let bg = root.getChildByName("SettleBg");
    if (!bg) {
      bg = new Node("SettleBg");
      bg.layer = root.layer;
      root.insertChild(bg, 0);
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
    }
    const n = this.playerCount();
    const key = n >= 4 ? "settle-bg-4" : "settle-bg-3";
    const sp = bg.getChildByName("img")?.getComponent(Sprite);
    if (!sp) return;
    clearUiSpriteCache(key);
    void loadUiSpriteFrame(key).then((sf) => {
      if (!sf || !sp.isValid) return;
      this.applyFitSprite(sp.node, sf, w, h);
      sp.spriteFrame = sf;
    });
  }

  private ensureHit(
    parent: Node,
    name: string,
    box: { x: number; y: number; w: number; h: number },
    fn: () => void,
  ) {
    let n = parent.getChildByName(name);
    if (!n) {
      n = new Node(name);
      n.layer = parent.layer;
      parent.addChild(n);
      n.addComponent(UITransform);
      const btn = n.addComponent(Button);
      btn.transition = Button.Transition.NONE;
      n.on(
        Node.EventType.TOUCH_END,
        () => {
          playButtonSfx();
          fn();
        },
        this,
      );
    }
    n.setPosition(box.x, box.y, 0);
    n.getComponent(UITransform)!.setContentSize(box.w, box.h);
  }

  private ensureContinueHud(
    parent: Node,
    slots: ReturnType<typeof continueSlots>,
  ) {
    let hud = parent.getChildByName("ContinueHud");
    if (!hud) {
      hud = new Node("ContinueHud");
      hud.layer = parent.layer;
      parent.addChild(hud);
      hud.addComponent(UITransform).setContentSize(1, 1);
      this.countLabel = this.makeLabel(hud, "count", "0/3", slots.count.x, slots.count.y, 34, GOLD, 200, 52);
      this.countLabel.isBold = true;
      this.errorLabel = this.makeLabel(
        hud,
        "err",
        "",
        slots.play.x,
        slots.play.y + 72,
        26,
        LOSE,
        720,
        40,
      );
    } else {
      this.countLabel = hud.getChildByName("count")?.getComponent(Label) ?? this.countLabel;
      this.errorLabel = hud.getChildByName("err")?.getComponent(Label) ?? this.errorLabel;
      const leftover = hud.getChildByName("timer");
      if (leftover) leftover.active = false;
    }
    this.countLabel?.node.setPosition(slots.count.x, slots.count.y, 0);
    this.errorLabel?.node.setPosition(slots.play.x, slots.play.y + 72, 0);
  }

  private refresh() {
    if (this.leaving) return;
    this.ensureUi();
    const n = this.playerCount();
    this.ensureBg(this.canvasSize().w, this.canvasSize().h);
    this.listHost!.removeAllChildren();
    const ids = this.seatIds();
    const ys = n >= 4 ? ROW_Y_4 : ROW_Y_3;
    ids.forEach((id, seat) => {
      const y = ys[seat] ?? ys[ys.length - 1]!;
      this.paintRow(id, y, isWinner(n, this.rankOf(id)));
    });
    this.refreshContinueHud();
    this.raiseSettleRoot();
  }

  private raiseSettleRoot() {
    if (this.leaving || !this.root?.isValid || !this.root.parent?.isValid) return;
    const kids = this.node.children;
    if (!kids?.length) return;
    this.root.setSiblingIndex(kids.length - 1);
  }

  private refreshContinueHud() {
    const room = session.room;
    const n = room?.maxPlayers === 4 ? 4 : 3;
    const ready = room?.continueReady?.length ?? 0;
    if (this.countLabel) this.countLabel.string = `${ready}/${n}`;
    if (this.errorLabel) this.errorLabel.string = session.lastError ?? "";
  }

  private paintRow(playerId: string, y: number, winner: boolean) {
    const host = this.listHost!;
    const row = new Node(`row-${playerId}`);
    row.layer = host.layer;
    host.addChild(row);
    row.setPosition(0, y, 0);
    row.addComponent(UITransform).setContentSize(1100, 120);

    if (winner) {
      const hi = new Node("win-hi");
      hi.layer = row.layer;
      row.addChild(hi);
      hi.setPosition(80, 0, 0);
      hi.addComponent(UITransform).setContentSize(1180, 118);
      const g = hi.addComponent(Graphics);
      g.fillColor = new Color(255, 196, 72, 36);
      g.roundRect(-590, -59, 1180, 118, 16);
      g.fill();
    }

    const nameLab = this.makeLabel(
      row,
      "name",
      this.playerTitle(playerId),
      NAME_X,
      0,
      32,
      CREAM,
      280,
      52,
    );
    nameLab.isBold = true;
    nameLab.horizontalAlign = Label.HorizontalAlign.LEFT;
    nameLab.overflow = Label.Overflow.SHRINK;
    nameLab.enableWrapText = false;

    const delta = this.deltaOf(playerId);
    const score = this.scoreOf(playerId);
    const deltaLab = this.makeLabel(
      row,
      "delta",
      this.deltaText(delta),
      DELTA_X,
      0,
      42,
      (delta ?? 0) >= 0 ? WIN : LOSE,
      240,
      56,
    );
    deltaLab.isBold = true;
    deltaLab.horizontalAlign = Label.HorizontalAlign.RIGHT;
    const scoreLab = this.makeLabel(
      row,
      "score",
      score == null ? "" : `积分  ${score}`,
      SCORE_X,
      0,
      36,
      CREAM,
      320,
      52,
    );
    scoreLab.isBold = true;
    scoreLab.horizontalAlign = Label.HorizontalAlign.LEFT;
    if (winner) this.paintWinBadge(row, BADGE_X);
  }

  private paintWinBadge(parent: Node, x: number) {
    const n = new Node("win-badge");
    n.layer = parent.layer;
    parent.addChild(n);
    n.setPosition(x, 0, 0);
    n.addComponent(UITransform).setContentSize(88, 88);
    const g = n.addComponent(Graphics);
    g.fillColor = new Color(196, 48, 36, 255);
    g.circle(0, 0, 40);
    g.fill();
    g.strokeColor = GOLD;
    g.lineWidth = 5;
    g.circle(0, 0, 40);
    g.stroke();
    const lab = this.makeLabel(n, "cap", "胜", 0, 0, 40, GOLD, 72, 52);
    lab.isBold = true;
    lab.enableOutline = true;
    lab.outlineColor = INK;
    lab.outlineWidth = 2;
  }

  private playerTitle(playerId: string): string {
    const name = session.playerName(playerId).trim();
    if (!name || name === playerId) return "玩家";
    return name.slice(0, 12);
  }

  private seatIds(): string[] {
    const pub = session.matchView?.public;
    const ids = pub?.seatOrder ?? session.room?.playerIds ?? [];
    return ids.filter(Boolean);
  }

  private playerCount(): number {
    const n = this.seatIds().length || session.room?.maxPlayers || 3;
    return n >= 4 ? 4 : 3;
  }

  private rankOf(playerId: string): number | null {
    const d = this.deltaRow(playerId);
    if (d) return d.rank;
    const hit = session.matchView?.public?.ranking?.find((r) => r.playerId === playerId);
    return hit?.rank ?? null;
  }

  private deltaOf(playerId: string): number | null {
    const d = this.deltaRow(playerId);
    return d ? d.delta : null;
  }

  private scoreOf(playerId: string): number | null {
    const d = this.deltaRow(playerId);
    if (d) return d.scoreAfter;
    const live = session.matchView?.public?.scores?.[playerId];
    if (typeof live === "number") return live;
    return playerId === session.playerId ? session.score : null;
  }

  private deltaRow(playerId: string): SettlementDelta | undefined {
    return session.lastSettlement?.find((d) => d.playerId === playerId);
  }

  private deltaText(delta: number | null): string {
    if (delta == null) return "";
    return delta > 0 ? `+${delta}` : `${delta}`;
  }

  private onBack() {
    if (this.leaving) return;
    this.leaving = true;
    net.send({ type: "leave_room" });
    session.clearMatch();
    const table = this.node.getComponent("TableRoom");
    if (table) table.enabled = false;
    this.scheduleOnce(() => {
      director.loadScene("DouDizhuLobby");
    }, 0);
  }

  private onContinue() {
    if (this.leaving) return;
    session.lastError = "";
    if (!net.send({ type: "continue_play" })) {
      session.lastError = "未连接";
      this.refreshContinueHud();
    }
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
    lab.fontSize = size;
    lab.lineHeight = Math.round(size * 1.3);
    lab.horizontalAlign = Label.HorizontalAlign.CENTER;
    lab.verticalAlign = Label.VerticalAlign.CENTER;
    lab.color = color;
    lab.enableOutline = true;
    lab.outlineColor = INK;
    lab.outlineWidth = 2;
    return lab;
  }
}
