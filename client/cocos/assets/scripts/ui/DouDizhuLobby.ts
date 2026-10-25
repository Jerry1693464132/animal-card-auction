import {
  _decorator,
  BlockInputEvents,
  Button,
  Camera,
  Color,
  Component,
  director,
  EventKeyboard,
  Graphics,
  input,
  Input,
  KeyCode,
  Label,
  Node,
  Sprite,
  SpriteFrame,
  UITransform,
} from "cc";
import { EDITOR, PREVIEW } from "cc/env";
import { session } from "../app/Session";
import { playButtonSfx } from "../app/cardSfx";
import { applyRemotePortrait, ensureAvatarPortrait } from "../app/avatarPortrait";
import { bootNet } from "../app/connect";
import { loadLocalRank } from "../app/friendRank";
import { shouldEnterAuction, shouldEnterTable } from "../app/matchFlow";
import { clearUiSpriteCache, loadUiSpriteFrame } from "../app/uiSkin";
import { MaxPlayers } from "../net/Protocol";
import { net } from "../net/WsClient";
import { preloadCardArt } from "./cards";
import { needsScoreRestore, requestScoreRestore } from "../app/scoreRestore";

const { ccclass, property } = _decorator;

const CREAM = new Color(245, 236, 214, 255);
const GOLD = new Color(255, 214, 110, 255);
const MUTED = new Color(210, 200, 180, 255);
const WOOD = new Color(58, 38, 24, 255);
const INK = new Color(48, 28, 10, 255);

type Mode = "table" | "matching" | "room";

/** Room codes are 6 chars from the server alphabet (no I/O/0/1). */
const ROOM_CODE_MAX = 6;
const ROOM_CODE_PLACEHOLDER = "输入房间码";

/** Map a physical key to the character it types for a room code. */
function roomCodeCharFromKey(key: number): string | null {
  if (key >= KeyCode.KEY_A && key <= KeyCode.KEY_Z) {
    return String.fromCharCode(key);
  }
  if (key >= KeyCode.DIGIT_0 && key <= KeyCode.DIGIT_9) {
    return String.fromCharCode(key);
  }
  if (key >= KeyCode.NUM_0 && key <= KeyCode.NUM_9) {
    return String.fromCharCode(key - KeyCode.NUM_0 + 48);
  }
  return null;
}

@ccclass("DouDizhuLobby")
export class DouDizhuLobby extends Component {
  @property(Label)
  statusLabel: Label | null = null;

  @property(Label)
  actionsTitle: Label | null = null;

  @property(Label)
  matchingLabel: Label | null = null;

  @property(Label)
  roomLabel: Label | null = null;

  @property(Node)
  panelSeats: Node | null = null;

  @property(Node)
  panelActions: Node | null = null;

  @property(Node)
  panelMatching: Node | null = null;

  @property(Node)
  panelRoom: Node | null = null;

  private maxPlayers: MaxPlayers = 3;
  private mode: Mode = "table";
  private unbindMsg: (() => void) | null = null;
  private unbindStatus: (() => void) | null = null;
  private leavingToAuction = false;
  private leavingToTable = false;
  private profileName: Label | null = null;
  private profileScore: Label | null = null;
  private onlineDot: Graphics | null = null;
  private matchingTextLab: Label | null = null;
  private roomTextLab: Label | null = null;
  private startMatchBtn: Node | null = null;
  private roomInputOwned = false;
  /** Pure-JS room-code field (native cc.EditBox crashes on Windows desktop). */
  private roomInput: {
    root: Node;
    label: Label;
    placeholder: Label;
    caret: Node;
  } | null = null;
  private roomCode = "";
  private roomFieldFocused = false;
  private roomCaretBlink = 0;

  onLoad() {
    if (EDITOR && !PREVIEW) return;
    session.prepareIdentity();
    this.bindRefs();
    this.hideLegacyPanels();
    this.ensureShell();
    this.ensureHeader();
    this.ensureTableBoard();
    this.ensureFooter();
    this.mountRoomCodeInput(this.node, 1308, 962, 300, 56);
    this.ensureMatchingLayer();
    this.ensureRoomLayer();
    void preloadCardArt();
    void bootNet();

    if (this.goToMatchScene()) return;

    this.unbindMsg = net.onMessage((msg) => {
      if (msg.type === "welcome") {
        session.rememberIdentity(msg.playerId, msg.displayName);
        session.lastError = "";
      } else if (msg.type === "room") {
        session.room = msg.room;
        session.matchmakingText = "";
        this.mode = "room";
      } else if (msg.type === "matchmaking") {
        if (msg.status === "queued") {
          session.matchmakingText = `匹配中 ${msg.queueSize}/${msg.maxPlayers}`;
          this.mode = "matching";
        } else {
          session.matchmakingText = "";
          if (this.mode === "matching") this.mode = "table";
        }
      } else if (msg.type === "match") {
        session.setMatchView(msg.view);
        session.matchmakingText = "";
        if (this.goToMatchScene()) return;
        this.mode = "room";
      } else if (msg.type === "error") {
        session.lastError = msg.message;
        if (msg.message.includes("积分不足")) {
          session.matchmakingText = "";
          if (this.mode === "matching") this.mode = "table";
          this.openScoreRestoreOverlay();
        }
      } else if (msg.type === "score") {
        session.applyScore(msg.score);
        session.dailyRestoreDay = msg.dailyRestoreDay ?? null;
        if (session.score >= 0) this.closeScoreRestoreOverlay();
      } else if (msg.type === "avatar") {
        session.applyAvatar(msg.avatar.equipped, msg.avatar.unlocked);
      }
      this.refresh();
    });
    this.unbindStatus = net.onStatus(() => this.refresh());
    input.on(Input.EventType.KEY_DOWN, this.onGlobalKeyDown, this);
    this.node.on(Node.EventType.TOUCH_START, this.onLobbyTouch, this);

    if (session.room) this.mode = "room";
    else if (session.matchmakingText) this.mode = "matching";
    this.refresh();
  }

  onDestroy() {
    this.restoreRoomCodeInput();
    input.off(Input.EventType.KEY_DOWN, this.onGlobalKeyDown, this);
    this.node.off(Node.EventType.TOUCH_START, this.onLobbyTouch, this);
    this.unbindMsg?.();
    this.unbindStatus?.();
  }

  private restoreRoomCodeInput() {
    this.node.getChildByName("JoinField")?.destroy();
    this.unschedule(this.blinkRoomCaret);
    this.roomInput = null;
    this.roomInputOwned = false;
    this.roomFieldFocused = false;
    this.roomCode = "";
  }

  private canvasSize(): { w: number; h: number } {
    const ut = this.node.getComponent(UITransform);
    if (ut && ut.contentSize.width > 0) {
      return { w: ut.contentSize.width, h: ut.contentSize.height };
    }
    return { w: 1920, h: 1080 };
  }

  private goToMatchScene(): boolean {
    if (this.leavingToTable || this.leavingToAuction) return true;
    if (
      shouldEnterTable(session.matchView, session.room) ||
      shouldEnterAuction(session.matchView, session.room)
    ) {
      this.leavingToAuction = true;
      director.loadScene("Auction");
      return true;
    }
    return false;
  }

  private bindRefs() {
    const root = this.node;
    this.statusLabel ??= root.getChildByName("Status")?.getComponent(Label) ?? null;
    this.panelSeats ??= root.getChildByName("PanelSeats");
    this.panelActions ??= root.getChildByName("PanelActions");
    this.panelJoin ??= root.getChildByName("PanelJoin");
    this.panelMatching ??= root.getChildByName("PanelMatching");
    this.panelRoom ??= root.getChildByName("PanelRoom");
    this.actionsTitle ??=
      this.panelActions?.getChildByName("ActionsTitle")?.getComponent(Label) ?? null;
    this.matchingLabel ??=
      this.panelMatching?.getChildByName("MatchingText")?.getComponent(Label) ?? null;
    this.roomLabel ??= this.panelRoom?.getChildByName("RoomText")?.getComponent(Label) ?? null;
  }

  /**
   * Remove every cc.EditBox component in this subtree.
   *
   * The native Win32 EditBox implementation is unsafe in Cocos 3.8.8: merely
   * having one present in a scene makes windows.exe die with an access
   * violation (0xC0000005) shortly after the scene loads. Verified by
   * bisection — swapping the component for any other component type is stable.
   * The room-code field is therefore implemented in pure JS instead.
   */
  private stripNativeEditBoxes(root: Node) {
    const comps = root.components;
    for (let i = comps.length - 1; i >= 0; i -= 1) {
      const c = comps[i] as { name?: string; constructor?: { name?: string } };
      const typeName = c.constructor?.name ?? c.name ?? "";
      if (typeName === "EditBox") {
        root.removeComponent(comps[i]);
      }
    }
    for (const child of root.children) this.stripNativeEditBoxes(child);
  }

  private hideLegacyPanels() {
    // Purge any authored native EditBox: it corrupts memory and crashes the
    // Windows build on scene load (see note on mountRoomCodeInput).
    this.stripNativeEditBoxes(this.node);

    for (const n of [
      this.panelSeats,
      this.panelActions,
      this.panelJoin,
      this.panelMatching,
      this.panelRoom,
      this.node.getChildByName("BtnBackHome"),
    ]) {
      if (n) n.active = false;
    }
    if (this.actionsTitle) this.actionsTitle.node.active = false;
    if (this.matchingLabel) this.matchingLabel.node.active = false;
    if (this.roomLabel) this.roomLabel.node.active = false;
    if (this.statusLabel) {
      const { h } = this.canvasSize();
      this.statusLabel.node.setPosition(0, -h / 2 + 78, 0);
      this.statusLabel.fontSize = 22;
      this.statusLabel.color = GOLD;
      this.statusLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
      this.statusLabel.enableOutline = true;
      this.statusLabel.outlineColor = new Color(40, 24, 8, 220);
      this.statusLabel.outlineWidth = 2;
    }
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
    clearUiSpriteCache("lobby-bg");
    void loadUiSpriteFrame("lobby-bg").then((sf) => {
      if (!sf || !sp.isValid) return;
      this.applyFitSprite(img, sf, w, h);
      sp.spriteFrame = sf;
    });
  }

  /** 16:9 背景保持比例铺画布；比例不一致时等比 fit，不压扁 */
  private applyFitSprite(img: Node, sf: SpriteFrame, canvasW: number, canvasH: number) {
    const rw = Math.max(1, sf.rect.width);
    const rh = Math.max(1, sf.rect.height);
    const same = Math.abs(rw / rh - canvasW / canvasH) < 0.02;
    const scale = same ? Math.max(canvasW / rw, canvasH / rh) : Math.min(canvasW / rw, canvasH / rh);
    img.getComponent(UITransform)!.setContentSize(rw * scale, rh * scale);
    img.setPosition(0, 0, 0);
  }

  private ensureHeader() {
    const { w, h } = this.canvasSize();
    this.node.getChildByName("LobbyHeader")?.destroy();
    const root = new Node("LobbyHeader");
    root.layer = this.node.layer;
    this.node.addChild(root);
    root.setPosition(0, 0, 0);
    root.addComponent(UITransform).setContentSize(w, h);

    this.makeBackButton(root, -w / 2 + 64, h / 2 - 64);
    this.makeProfileChip(root, -w / 2 + 268, h / 2 - 64);
    // 标题与右上五钮已画在 lobby-bg 上
  }

  private makeBackButton(parent: Node, x: number, y: number) {
    const n = new Node("back");
    n.layer = parent.layer;
    parent.addChild(n);
    n.setPosition(x, y, 0);
    n.addComponent(UITransform).setContentSize(88, 88);
    const g = n.addComponent(Graphics);
    g.fillColor = new Color(32, 20, 12, 210);
    g.circle(0, 0, 36);
    g.fill();
    g.strokeColor = new Color(228, 184, 88, 240);
    g.lineWidth = 3;
    g.circle(0, 0, 36);
    g.stroke();
    const labN = new Node("lab");
    labN.layer = n.layer;
    n.addChild(labN);
    labN.addComponent(UITransform).setContentSize(80, 36);
    const lab = labN.addComponent(Label);
    lab.string = "返回";
    lab.useSystemFont = true;
    lab.fontSize = 22;
    lab.isBold = true;
    lab.horizontalAlign = Label.HorizontalAlign.CENTER;
    lab.verticalAlign = Label.VerticalAlign.CENTER;
    lab.color = GOLD;
    const btn = n.addComponent(Button);
    btn.transition = Button.Transition.SCALE;
    btn.zoomScale = 1.08;
    n.on(
      Button.EventType.CLICK,
      () => {
        playButtonSfx();
        this.onBackHome();
      },
      this,
    );
  }

  private makeProfileChip(parent: Node, x: number, y: number) {
    const bw = 300;
    const bh = 88;
    const root = new Node("ProfileChip");
    root.layer = parent.layer;
    parent.addChild(root);
    root.setPosition(x, y, 0);
    root.addComponent(UITransform).setContentSize(bw, bh);

    const g = root.addComponent(Graphics);
    g.fillColor = new Color(32, 20, 12, 210);
    g.roundRect(-bw / 2, -bh / 2, bw, bh, 16);
    g.fill();
    g.strokeColor = new Color(228, 184, 88, 240);
    g.lineWidth = 3;
    g.roundRect(-bw / 2, -bh / 2, bw, bh, 16);
    g.stroke();

    ensureAvatarPortrait(root, "portrait", 68);
    root.getChildByName("portrait")?.setPosition(-104, 0, 0);

    const dot = new Node("onlineDot");
    dot.layer = root.layer;
    root.addChild(dot);
    dot.setPosition(-80, -22, 0);
    dot.addComponent(UITransform).setContentSize(12, 12);
    this.onlineDot = dot.addComponent(Graphics);

    const name = new Node("name");
    name.layer = root.layer;
    root.addChild(name);
    name.setPosition(22, 14, 0);
    name.addComponent(UITransform).setContentSize(160, 28);
    const nameLab = name.addComponent(Label);
    nameLab.useSystemFont = true;
    nameLab.fontSize = 24;
    nameLab.horizontalAlign = Label.HorizontalAlign.LEFT;
    nameLab.verticalAlign = Label.VerticalAlign.CENTER;
    nameLab.overflow = Label.Overflow.SHRINK;
    nameLab.color = CREAM;
    nameLab.string = this.profileDisplayName();
    this.profileName = nameLab;

    const star = new Node("star");
    star.layer = root.layer;
    root.addChild(star);
    star.setPosition(-28, -18, 0);
    star.addComponent(UITransform).setContentSize(28, 28);
    const starLab = star.addComponent(Label);
    starLab.string = "★";
    starLab.useSystemFont = true;
    starLab.fontSize = 18;
    starLab.horizontalAlign = Label.HorizontalAlign.CENTER;
    starLab.verticalAlign = Label.VerticalAlign.CENTER;
    starLab.color = GOLD;

    const score = new Node("score");
    score.layer = root.layer;
    root.addChild(score);
    score.setPosition(36, -18, 0);
    score.addComponent(UITransform).setContentSize(120, 26);
    const scoreLab = score.addComponent(Label);
    scoreLab.useSystemFont = true;
    scoreLab.fontSize = 22;
    scoreLab.horizontalAlign = Label.HorizontalAlign.LEFT;
    scoreLab.verticalAlign = Label.VerticalAlign.CENTER;
    scoreLab.color = GOLD;
    scoreLab.string = this.formatScore();
    this.profileScore = scoreLab;
  }

  private makeCornerNav(parent: Node) {
    const hits: Array<[string, number, number, () => void]> = [
      ["notice", 1307, 111, () => this.openNotice()],
      ["rank", 1434, 115, () => this.openRank()],
      ["checkin", 1567, 111, () => this.openSoon("签到")],
      ["hands", 1698, 113, () => this.openHands()],
      ["rules", 1832, 120, () => this.openRules()],
    ];
    for (const [name, mx, my, fn] of hits) {
      const n = this.makeInvisibleHit(parent, name, mx, my, 118, 150);
      n.on(Button.EventType.CLICK, fn, this);
    }
  }

  /** lobby-bg 为 1920×1080，热区按这张图换算，不跟画布拉伸走偏 */
  private bgToLocal(mx: number, my: number): { x: number; y: number } {
    return { x: mx - 960, y: 540 - my };
  }

  private ensureTableBoard() {
    this.restoreRoomCodeInput();
    this.node.getChildByName("TableBoard")?.destroy();
    const { w, h } = this.canvasSize();
    const board = new Node("TableBoard");
    board.layer = this.node.layer;
    this.node.addChild(board);
    board.setPosition(0, 0, 0);
    board.addComponent(UITransform).setContentSize(w, h);

    // 对准 lobby-bg 上画好的场次卡 / 方式按钮（1920×1080）
    this.makeHitSeat(board, "seat3", 3, 745, 623, 370, 185);
    this.makeHitSeat(board, "seat4", 4, 1165, 623, 350, 185);
    const seat3 = board.getChildByName("seat3");
    if (seat3) {
      for (const name of ["bakedCover", "check"] as const) {
        const child = seat3.getChildByName(name);
        if (child) child.setPosition(child.position.x + 7, child.position.y, 0);
      }
    }
    this.makeHitBtn(board, "match", 590, 844, 280, 112, this.onOpenMatch);
    this.makeHitBtn(board, "create", 940, 844, 320, 112, this.onOpenCreate);
    this.makeHitBtn(board, "join", 1300, 828, 340, 80, this.onSubmitJoin);
    this.makeCornerNav(board);
  }

  private makeInvisibleHit(parent: Node, name: string, mx: number, my: number, bw: number, bh: number) {
    const { x, y } = this.bgToLocal(mx, my);
    const n = new Node(name);
    n.layer = parent.layer;
    parent.addChild(n);
    n.setPosition(x, y, 0);
    n.addComponent(UITransform).setContentSize(bw, bh);
    const g = n.addComponent(Graphics);
    g.fillColor = new Color(0, 0, 0, 0);
    g.roundRect(-bw / 2, -bh / 2, bw, bh, 12);
    g.fill();
    const btn = n.addComponent(Button);
    btn.transition = Button.Transition.SCALE;
    btn.zoomScale = 1.03;
    n.on(Button.EventType.CLICK, () => playButtonSfx(), this);
    return n;
  }

  private makeHitSeat(parent: Node, name: string, seats: MaxPlayers, mx: number, my: number, bw: number, bh: number) {
    const n = this.makeInvisibleHit(parent, name, mx, my, bw, bh);
    n.on(Button.EventType.CLICK, () => this.onPickSeats(seats), this);

    const cover = new Node("bakedCover");
    cover.layer = n.layer;
    n.addChild(cover);
    cover.setPosition(bw / 2 - 28, bh / 2 - 28, 0);
    cover.addComponent(UITransform).setContentSize(44, 44);
    cover.addComponent(Graphics);
    cover.active = false;

    const mark = new Node("check");
    mark.layer = n.layer;
    n.addChild(mark);
    mark.setPosition(bw / 2 - 28, bh / 2 - 28, 0);
    mark.addComponent(UITransform).setContentSize(52, 52);
    mark.addComponent(Graphics);
    const ml = new Node("lab");
    ml.layer = mark.layer;
    mark.addChild(ml);
    ml.addComponent(UITransform).setContentSize(44, 44);
    const lab = ml.addComponent(Label);
    lab.string = "✓";
    lab.useSystemFont = true;
    lab.fontSize = 32;
    lab.isBold = true;
    lab.horizontalAlign = Label.HorizontalAlign.CENTER;
    lab.verticalAlign = Label.VerticalAlign.CENTER;
    lab.color = new Color(40, 24, 8, 255);
  }

  private paintSeatCard(n: Node, selected: boolean) {
    const mark = n.getChildByName("check");
    if (mark) {
      mark.active = selected;
      const mg = mark.getComponent(Graphics);
      if (mg) {
        mg.clear();
        mg.fillColor = new Color(212, 160, 48, 255);
        mg.circle(0, 0, 24);
        mg.fill();
      }
    }
    const cover = n.getChildByName("bakedCover");
    if (cover) {
      const hideBaked = n.name === "seat3";
      cover.active = hideBaked;
      const cg = cover.getComponent(Graphics);
      if (cg) {
        cg.clear();
        if (hideBaked) {
          cg.fillColor = new Color(210, 228, 196, 255);
          cg.circle(0, 0, 20);
          cg.fill();
        }
      }
    }
  }

  private makeHitBtn(
    parent: Node,
    name: string,
    mx: number,
    my: number,
    bw: number,
    bh: number,
    handler: () => void,
  ) {
    const n = this.makeInvisibleHit(parent, name, mx, my, bw, bh);
    n.on(Button.EventType.CLICK, handler, this);
  }

  private mountRoomCodeInput(parent: Node, mx: number, my: number, bw: number, bh: number) {
    this.node.getChildByName("JoinField")?.destroy();
    const { x, y } = this.bgToLocal(mx, my);
    const wrap = new Node("JoinField");
    wrap.layer = parent.layer;
    parent.addChild(wrap);
    wrap.setPosition(x, y, 0);
    wrap.addComponent(UITransform).setContentSize(bw, bh);

    const g = wrap.addComponent(Graphics);
    g.fillColor = new Color(0, 0, 0, 0);
    g.roundRect(-bw / 2, -bh / 2, bw, bh, 10);
    g.fill();

    const textN = new Node("TEXT_LABEL");
    textN.layer = wrap.layer;
    wrap.addChild(textN);
    textN.setPosition(0, 0, 0);
    textN.addComponent(UITransform).setContentSize(bw, bh);
    const textLab = textN.addComponent(Label);
    textLab.useSystemFont = true;
    textLab.fontSize = 26;
    textLab.horizontalAlign = Label.HorizontalAlign.CENTER;
    textLab.verticalAlign = Label.VerticalAlign.CENTER;
    textLab.color = CREAM;
    textLab.overflow = Label.Overflow.SHRINK;
    textLab.string = "";

    const phN = new Node("PLACEHOLDER_LABEL");
    phN.layer = wrap.layer;
    wrap.addChild(phN);
    phN.setPosition(0, 0, 0);
    phN.addComponent(UITransform).setContentSize(bw, bh);
    const phLab = phN.addComponent(Label);
    phLab.useSystemFont = true;
    phLab.fontSize = 22;
    phLab.horizontalAlign = Label.HorizontalAlign.CENTER;
    phLab.verticalAlign = Label.VerticalAlign.CENTER;
    phLab.color = new Color(200, 210, 200, 160);
    phLab.string = ROOM_CODE_PLACEHOLDER;

    // blinking caret drawn as a thin filled rect, re-positioned to follow the text
    const caret = new Node("CARET");
    caret.layer = wrap.layer;
    wrap.addChild(caret);
    caret.setPosition(0, 0, 0);
    caret.addComponent(UITransform).setContentSize(3, 30);
    const cg = caret.addComponent(Graphics);
    cg.fillColor = CREAM;
    cg.rect(-1.5, -15, 3, 30);
    cg.fill();
    caret.active = false;

    const btn = wrap.addComponent(Button);
    btn.transition = Button.Transition.NONE;
    wrap.on(Button.EventType.CLICK, () => this.setRoomFieldFocused(true), this);

    this.roomInput = { root: wrap, label: textLab, placeholder: phLab, caret };
    this.roomInputOwned = true;
    this.roomCode = "";
    this.applyRoomCodeDisplay();
  }

  /** Keyboard-driven text field — replaces the native cc.EditBox. */
  private onGlobalKeyDown(ev: EventKeyboard) {
    if (!this.roomFieldFocused) return;
    const key = ev.keyCode;
    if (key === KeyCode.ESCAPE) {
      this.setRoomFieldFocused(false);
      return;
    }
    if (key === KeyCode.ENTER || key === KeyCode.NUM_ENTER) {
      this.onSubmitJoin();
      return;
    }
    if (key === KeyCode.BACKSPACE) {
      this.roomCode = this.roomCode.slice(0, -1);
      this.applyRoomCodeDisplay();
      return;
    }
    if (this.roomCode.length >= ROOM_CODE_MAX) return;
    const ch = roomCodeCharFromKey(key);
    if (ch) {
      this.roomCode += ch;
      this.applyRoomCodeDisplay();
    }
  }

  private setRoomFieldFocused(focused: boolean) {
    if (this.roomFieldFocused === focused) return;
    this.roomFieldFocused = focused;
    this.unschedule(this.blinkRoomCaret);
    if (focused) {
      this.schedule(this.blinkRoomCaret, 0.5);
    } else if (this.roomInput?.caret.isValid) {
      this.roomInput.caret.active = false;
    }
    this.applyRoomCodeDisplay();
  }

  private blinkRoomCaret = () => {
    const caret = this.roomInput?.caret;
    if (!caret?.isValid) return;
    caret.active = this.roomCode.length === 0 || !caret.active;
  };

  /** Tapping anywhere in the lobby drops keyboard focus; the field's own
   *  Button click handler re-focuses it when the field itself is tapped. */
  private onLobbyTouch() {
    if (this.roomFieldFocused) this.setRoomFieldFocused(false);
  }

  private applyRoomCodeDisplay() {
    const f = this.roomInput;
    if (!f) return;
    const text = this.roomCode;
    f.label.string = text;
    f.placeholder.node.active = text.length === 0;
    const caret = f.caret;
    if (!caret.isValid) return;
    caret.active = this.roomFieldFocused;
    if (!this.roomFieldFocused) return;
    const w = f.root.getComponent(UITransform)?.contentSize.width ?? 300;
    const fontSize = f.label.fontSize || 26;
    const textW = Math.min(text.length * fontSize * 0.62, w - 24);
    caret.setPosition(textW / 2 + 2, 0, 0);
  }

  /** Current room code typed by the player (upper-cased, trimmed). */
  private readRoomCode(): string {
    return this.roomCode.trim().toUpperCase();
  }

  private ensureFooter() {
    const { w, h } = this.canvasSize();
    this.node.getChildByName("LobbyFooter")?.destroy();
    const root = new Node("LobbyFooter");
    root.layer = this.node.layer;
    this.node.addChild(root);
    root.setPosition(0, -h / 2 + 42, 0);
    root.addComponent(UITransform).setContentSize(w, 64);

    const legal = new Node("legal");
    legal.layer = root.layer;
    root.addChild(legal);
    legal.setPosition(w / 2 - 220, 8, 0);
    legal.addComponent(UITransform).setContentSize(400, 36);
    const ll = legal.addComponent(Label);
    ll.string = "文明游戏，禁止赌博";
    ll.useSystemFont = true;
    ll.fontSize = 20;
    ll.horizontalAlign = Label.HorizontalAlign.RIGHT;
    ll.verticalAlign = Label.VerticalAlign.CENTER;
    ll.color = MUTED;
  }

  private ensureMatchingLayer() {
    this.node.getChildByName("MatchingLayer")?.destroy();
    const layer = this.makeDimLayer("MatchingLayer");
    const panel = layer.getChildByName("panel")!;
    this.addOverlayTitle(panel, "匹配中");
    const body = new Node("body");
    body.layer = panel.layer;
    panel.addChild(body);
    body.setPosition(0, 20, 0);
    body.addComponent(UITransform).setContentSize(560, 80);
    const lab = body.addComponent(Label);
    lab.useSystemFont = true;
    lab.fontSize = 36;
    lab.horizontalAlign = Label.HorizontalAlign.CENTER;
    lab.verticalAlign = Label.VerticalAlign.CENTER;
    lab.color = CREAM;
    this.matchingTextLab = lab;
    this.addOverlayButton(panel, "取消匹配", 0, -180, () => this.onCancelMatch());
    layer.active = false;
  }

  private ensureRoomLayer() {
    this.node.getChildByName("RoomLayer")?.destroy();
    const layer = this.makeDimLayer("RoomLayer");
    const panel = layer.getChildByName("panel")!;
    this.addOverlayTitle(panel, "房间");
    const body = new Node("body");
    body.layer = panel.layer;
    panel.addChild(body);
    body.setPosition(0, 40, 0);
    body.addComponent(UITransform).setContentSize(600, 220);
    const lab = body.addComponent(Label);
    lab.useSystemFont = true;
    lab.fontSize = 26;
    lab.lineHeight = 40;
    lab.overflow = Label.Overflow.RESIZE_HEIGHT;
    lab.horizontalAlign = Label.HorizontalAlign.CENTER;
    lab.verticalAlign = Label.VerticalAlign.TOP;
    lab.color = CREAM;
    this.roomTextLab = lab;

    this.startMatchBtn = this.addOverlayButton(panel, "开始对局", -130, -200, () => this.onStartMatch());
    this.addOverlayButton(panel, "离开房间", 130, -200, () => this.onLeaveRoom());
    layer.active = false;
  }

  private makeDimLayer(name: string, panelW = 720, panelH = 560): Node {
    const { w, h } = this.canvasSize();
    const overlay = new Node(name);
    overlay.layer = this.node.layer;
    this.node.addChild(overlay);
    overlay.addComponent(UITransform).setContentSize(w, h);
    overlay.addComponent(BlockInputEvents);

    const dimmer = new Node("dimmer");
    dimmer.layer = overlay.layer;
    overlay.addChild(dimmer);
    dimmer.addComponent(UITransform).setContentSize(w, h);
    const dim = dimmer.addComponent(Graphics);
    dim.fillColor = new Color(8, 4, 2, 160);
    dim.rect(-w / 2, -h / 2, w, h);
    dim.fill();

    const panel = new Node("panel");
    panel.layer = overlay.layer;
    overlay.addChild(panel);
    const pw = panelW;
    const ph = panelH;
    panel.addComponent(UITransform).setContentSize(pw, ph);
    const pg = panel.addComponent(Graphics);
    pg.fillColor = new Color(42, 26, 14, 245);
    pg.roundRect(-pw / 2, -ph / 2, pw, ph, 22);
    pg.fill();
    pg.strokeColor = new Color(228, 184, 88, 255);
    pg.lineWidth = 3;
    pg.roundRect(-pw / 2, -ph / 2, pw, ph, 22);
    pg.stroke();
    return overlay;
  }

  private addOverlayTitle(panel: Node, title: string, y = 220, fontSize = 36) {
    const n = new Node("title");
    n.layer = panel.layer;
    panel.addChild(n);
    n.setPosition(0, y, 0);
    n.addComponent(UITransform).setContentSize(1010, 56);
    const lab = n.addComponent(Label);
    lab.string = title;
    lab.useSystemFont = true;
    lab.fontSize = fontSize;
    lab.isBold = true;
    lab.horizontalAlign = Label.HorizontalAlign.CENTER;
    lab.verticalAlign = Label.VerticalAlign.CENTER;
    lab.color = GOLD;
    lab.enableOutline = true;
    lab.outlineColor = new Color(40, 22, 8, 255);
    lab.outlineWidth = 2;
  }

  private addOverlayButton(panel: Node, text: string, x: number, y: number, onClick: () => void, width = 220) {
    const n = new Node(`btn-${text}`);
    n.layer = panel.layer;
    panel.addChild(n);
    n.setPosition(x, y, 0);
    n.addComponent(UITransform).setContentSize(width, 56);
    const g = n.addComponent(Graphics);
    g.fillColor = new Color(128, 78, 22, 255);
    g.roundRect(-width / 2, -28, width, 56, 12);
    g.fill();
    const labN = new Node("lab");
    labN.layer = n.layer;
    n.addChild(labN);
    labN.addComponent(UITransform).setContentSize(width, 56);
    const lab = labN.addComponent(Label);
    lab.string = text;
    lab.useSystemFont = true;
    lab.fontSize = width > 280 ? 24 : 24;
    lab.horizontalAlign = Label.HorizontalAlign.CENTER;
    lab.verticalAlign = Label.VerticalAlign.CENTER;
    lab.color = CREAM;
    const btn = n.addComponent(Button);
    btn.transition = Button.Transition.SCALE;
    btn.zoomScale = 1.06;
    n.on(Button.EventType.CLICK, () => {
      playButtonSfx();
      onClick();
    });
    return n;
  }

  private ensureOverlay(name: string, title: string, body: string, large = false) {
    this.node.getChildByName(name)?.destroy();
    const overlay = this.makeDimOverlay(name, large ? 1120 : 720, large ? 880 : 560);
    const panel = overlay.getChildByName("panel")!;
    this.addOverlayTitle(panel, title, large ? 360 : 220, large ? 44 : 36);
    const n = new Node("body");
    n.layer = panel.layer;
    panel.addChild(n);
    n.setPosition(0, large ? 0 : -10, 0);
    n.addComponent(UITransform).setContentSize(large ? 1010 : 620, large ? 650 : 360);
    const lab = n.addComponent(Label);
    lab.string = body;
    lab.useSystemFont = true;
    lab.fontSize = large ? 34 : 24;
    lab.lineHeight = large ? 54 : 38;
    lab.overflow = large ? Label.Overflow.SHRINK : Label.Overflow.RESIZE_HEIGHT;
    lab.enableWrapText = true;
    lab.horizontalAlign = Label.HorizontalAlign.LEFT;
    lab.verticalAlign = Label.VerticalAlign.TOP;
    lab.color = CREAM;
    this.addOverlayButton(panel, "关闭", 0, large ? -380 : -220, () => overlay.destroy());
  }

  private makeDimOverlay(name: string, panelW = 720, panelH = 560): Node {
    const overlay = this.makeDimLayer(name, panelW, panelH);
    overlay.getComponent(BlockInputEvents);
    const dimmer = overlay.getChildByName("dimmer");
    if (dimmer) {
      const hit = dimmer.addComponent(Button);
      hit.transition = Button.Transition.NONE;
      dimmer.on(Button.EventType.CLICK, () => {
        if (name === "RankOverlay") this.closeRank();
        else overlay.destroy();
      });
    }
    return overlay;
  }

  private closeScoreRestoreOverlay() {
    this.node.getChildByName("ScoreRestoreOverlay")?.destroy();
  }

  private openScoreRestoreOverlay() {
    this.closeScoreRestoreOverlay();
    const overlay = this.makeDimOverlay("ScoreRestoreOverlay");
    const panel = overlay.getChildByName("panel")!;
    this.addOverlayTitle(panel, "积分不足");
    const n = new Node("body");
    n.layer = panel.layer;
    panel.addChild(n);
    n.setPosition(0, 40, 0);
    n.addComponent(UITransform).setContentSize(620, 220);
    const lab = n.addComponent(Label);
    lab.string =
      `当前积分 ${Math.round(session.score)}，不能匹配或开房。\n` +
      `每天可恢复一次至 0 分。${session.dailyRestoreDay ? `今日已恢复，${session.dailyRestoreDay} 后可再次恢复。` : "现在点击即可恢复。"}`;
    lab.useSystemFont = true;
    lab.fontSize = 26;
    lab.lineHeight = 40;
    lab.overflow = Label.Overflow.RESIZE_HEIGHT;
    lab.horizontalAlign = Label.HorizontalAlign.CENTER;
    lab.verticalAlign = Label.VerticalAlign.TOP;
    lab.color = CREAM;

    const action = this.addOverlayButton(
      panel,
      session.dailyRestoreDay ? "明日再恢复" : "立即恢复至 0",
      0,
      -160,
      () => {
        if (session.dailyRestoreDay) return;
        void this.onRestoreScore(action);
      },
      400,
    );
    this.addOverlayButton(panel, "关闭", 0, -230, () => this.closeScoreRestoreOverlay());
  }

  private async onRestoreScore(btn: Node) {
    if (btn.getComponent(Button)) btn.getComponent(Button)!.interactable = false;
    const result = await requestScoreRestore();
    if (!result.ok) {
      session.lastError = result.error || "恢复失败";
      if (btn.isValid && btn.getComponent(Button)) btn.getComponent(Button)!.interactable = true;
      this.refresh();
    }
  }

  private closeCornerOverlays(keep?: string) {
    this.closeRank();
    for (const name of ["NoticeOverlay", "SoonOverlay", "HandsOverlay", "RulesOverlay"]) {
      if (name !== keep) this.node.getChildByName(name)?.destroy();
    }
  }

  private openSoon(feature: string) {
    this.closeCornerOverlays("SoonOverlay");
    this.ensureOverlay(
      "SoonOverlay",
      feature,
      `${feature}即将开放。\n当前可先选三人场或四人场，再匹配、开房或加入房间。`,
      true,
    );
  }

  private openNotice() {
    this.closeCornerOverlays("NoticeOverlay");
    this.ensureOverlay(
      "NoticeOverlay",
      "公告",
      [
        "欢迎来到动物牌场，本游戏采用先开局拍卖道具再进行多人对战的玩法，本小程序游戏由本人独立开发，后期会进行更新和上架更多玩法，本人是一名热爱游戏的重度游戏玩家，如果有关于游戏的建议和需要改进地方的提议和bug的反馈可以对本人dy进行联系反应，dy号80842782249。谢谢宝宝们的游玩和支持。",
      ].join("\n"),
      true,
    );
  }

  private openHands() {
    this.closeCornerOverlays("HandsOverlay");
    this.ensureOverlay(
      "HandsOverlay",
      "牌型",
      [
        "三人场 81 张：19 点×4 + 王 + 先手 + 星牌 + 炸弹牌，每人 27 张。",
        "四人场 100 张：19 点×5 + 王 + 先手 + 星牌 + 炸弹牌，每人 25 张。",
        "先手牌最小，且只能单出；持有者先出。",
        "星牌是癞子，可当成任意点数来配牌（对子、顺子、炸弹等）。",
        "炸弹牌只能单出，单张即最小炸弹，比四张 3 还小；打出单张炸弹牌不触发整桌加倍。",
        "四带二不是炸弹；4 张及以上同点都是炸弹，张数多的更大，同张数比点数；王炸最大。",
        "出牌思考 15 秒；超时跟牌自动过，超时领出自动出最小合法牌。",
      ].join("\n"),
      true,
    );
  }

  private openRules() {
    this.closeCornerOverlays("RulesOverlay");
    this.ensureOverlay(
      "RulesOverlay",
      "规则",
      [
        "底分 500。三人场第 1 出完即胜 +500，其余各 -188。",
        "四人场第 2 个出完即结束：第 1、第 2 各 +500，其余并列各 -375。",
        "开局可选加倍 ×2 / 超级加倍 ×4，只乘自己；打出四张及以上炸弹或王炸，整桌再 ×2。",
        "3 人与 4 人分队列，满员开局。积分为负不能匹配或开房。",
        "开局拍卖：件数 = 人数×3，每种道具当局最多一次，币 300，底价 10。",
      ].join("\n"),
      true,
    );
  }

  private openRank() {
    this.closeCornerOverlays();
    const old = this.node.getChildByName("RankOverlay");
    if (old) old.destroy();

    const overlay = this.makeDimOverlay("RankOverlay", 1120, 880);
    const panel = overlay.getChildByName("panel")!;
    this.addOverlayButton(panel, "关闭", 0, -380, () => this.closeRank());

    // 本地排行榜（Steam 开发期）：展示本机历史最佳战绩
    const n = new Node("body");
    n.layer = panel.layer;
    panel.addChild(n);
    n.setPosition(0, 0, 0);
    n.addComponent(UITransform).setContentSize(1040, 680);
    const rows = loadLocalRank();
    const lines = rows.length
      ? rows.map((e, i) => `${i + 1}. ${e.name}  ${Math.round(e.score)}`).join("\n")
      : "还没有历史战绩。\n打完一局积分赛，这里会记录你的最佳段位。";
    const lab = n.addComponent(Label);
    lab.string = `${lines}\n\n我的积分  ${this.formatScore()}`;
    lab.useSystemFont = true;
    lab.fontSize = 26;
    lab.lineHeight = 42;
    lab.horizontalAlign = Label.HorizontalAlign.CENTER;
    lab.verticalAlign = Label.VerticalAlign.CENTER;
    lab.color = CREAM;
  }

  private closeRank() {
    const overlay = this.node.getChildByName("RankOverlay");
    if (overlay) overlay.destroy();
  }

  private refreshSeatCards() {
    const board = this.node.getChildByName("TableBoard");
    if (!board) return;
    const seat3 = board.getChildByName("seat3");
    const seat4 = board.getChildByName("seat4");
    if (seat3) this.paintSeatCard(seat3, this.maxPlayers === 3);
    if (seat4) this.paintSeatCard(seat4, this.maxPlayers === 4);
  }

  private refreshLayers() {
    const matching = this.node.getChildByName("MatchingLayer");
    const room = this.node.getChildByName("RoomLayer");
    if (matching) matching.active = this.mode === "matching";
    if (room) room.active = this.mode === "room";
    if (this.matchingTextLab) {
      this.matchingTextLab.string =
        session.matchmakingText || `匹配中 …/${this.maxPlayers}`;
    }
    if (this.roomTextLab && session.room) {
      const r = session.room;
      const names = r.playerIds.map((id) => r.playerNames[id] ?? id).join("、");
      const tip =
        r.phase !== "lobby"
          ? "对局进行中"
          : r.playerIds.length >= r.maxPlayers
            ? r.hostId === session.playerId
              ? "已满员，可以开始"
              : "已满员，等待房主开始"
            : "等待玩家加入…";
      this.roomTextLab.string = `房间 ${r.roomCode}\n${r.playerIds.length}/${r.maxPlayers} · ${r.maxPlayers} 人场\n${names}\n${tip}`;
    }
    if (this.startMatchBtn && session.room) {
      const r = session.room;
      const canStart =
        r.hostId === session.playerId &&
        r.phase === "lobby" &&
        r.playerIds.length >= r.maxPlayers;
      this.startMatchBtn.active = canStart;
    }
  }

  private refreshProfile() {
    if (this.profileName) this.profileName.string = this.profileDisplayName();
    if (this.profileScore) this.profileScore.string = this.formatScore();
    const portrait = this.node
      .getChildByName("LobbyHeader")
      ?.getChildByName("ProfileChip")
      ?.getChildByName("portrait");
    if (portrait) void applyRemotePortrait(portrait, session.avatarUrl, 68);
    const g = this.onlineDot;
    if (g) {
      g.clear();
      const online = net.connected && net.welcomed;
      g.fillColor = online ? new Color(86, 210, 110, 255) : new Color(150, 90, 70, 255);
      g.circle(0, 0, 6);
      g.fill();
    }
  }

  private profileDisplayName(): string {
    const name = session.displayName?.trim() || "";
    return name || "玩家";
  }

  private formatScore(): string {
    return Math.round(session.score).toLocaleString("en-US");
  }

  private refresh() {
    if (session.room) this.mode = "room";
    else if (session.matchmakingText) this.mode = "matching";
    else if (this.mode === "room") this.mode = "table";

    this.refreshSeatCards();
    this.refreshLayers();
    this.refreshProfile();
    if (this.statusLabel) {
      const err = session.lastError.trim();
      const ok = net.connected && net.welcomed && !err;
      this.statusLabel.node.active = !ok;
      if (!ok) this.statusLabel.string = err || net.statusText;
    }
  }

  onPickSeats(seats: MaxPlayers) {
    if (this.mode !== "table") return;
    this.maxPlayers = seats;
    this.refreshSeatCards();
  }

  onPickThree() {
    this.onPickSeats(3);
  }

  onPickFour() {
    this.onPickSeats(4);
  }

  onOpenCreate() {
    session.lastError = "";
    if (needsScoreRestore()) {
      this.openScoreRestoreOverlay();
      return;
    }
    if (!net.send({ type: "create_room", ranked: true, maxPlayers: this.maxPlayers })) {
      session.lastError = "未连接，请先 npm run dev";
      this.refresh();
    }
  }

  onOpenMatch() {
    session.lastError = "";
    if (needsScoreRestore()) {
      this.openScoreRestoreOverlay();
      return;
    }
    if (!net.send({ type: "matchmake", ranked: true, maxPlayers: this.maxPlayers })) {
      session.lastError = "未连接，请先 npm run dev";
      this.refresh();
      return;
    }
    session.matchmakingText = `匹配中 …/${this.maxPlayers}`;
    this.mode = "matching";
    this.refresh();
  }

  onOpenJoin() {
    this.onSubmitJoin();
  }

  onSubmitJoin() {
    const code = this.readRoomCode();
    if (!code) {
      session.lastError = "请输入房间码";
      this.refresh();
      return;
    }
    this.setRoomFieldFocused(false);
    session.lastError = "";
    if (!net.send({ type: "join_room", roomCode: code })) {
      session.lastError = "未连接，请先 npm run dev";
      this.refresh();
    }
  }

  onCancelMatch() {
    net.send({ type: "cancel_matchmake" });
    session.matchmakingText = "";
    this.mode = "table";
    this.refresh();
  }

  onStartMatch() {
    if (!net.send({ type: "start_match" })) {
      session.lastError = "未连接，请先 npm run dev";
      this.refresh();
    }
  }

  onLeaveRoom() {
    net.send({ type: "leave_room" });
    session.room = null;
    session.matchmakingText = "";
    this.mode = "table";
    this.refresh();
  }

  onBackFromActions() {
    this.mode = "table";
    this.refresh();
  }

  onBackFromJoin() {
    this.mode = "table";
    this.refresh();
  }

  onBackHome() {
    if (session.room && session.room.phase !== "in_match") {
      net.send({ type: "leave_room" });
      session.room = null;
    }
    net.send({ type: "cancel_matchmake" });
    session.matchmakingText = "";
    director.loadScene("Main");
  }
}
