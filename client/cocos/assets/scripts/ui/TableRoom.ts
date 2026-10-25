import {
  _decorator,
  BlockInputEvents,
  Button,
  Camera,
  Color,
  Component,
  director,
  EventTouch,
  Graphics,
  Label,
  Mask,
  Node,
  ScrollView,
  Sprite,
  SpriteFrame,
  UITransform,
  Vec2,
  Vec3,
  game,
} from "cc";
import { EDITOR, PREVIEW } from "cc/env";
import { session } from "../app/Session";
import { bootNet } from "../app/connect";
import { isTablePhase } from "../app/matchFlow";
import { clearUiSpriteCache, loadUiSpriteFrame } from "../app/uiSkin";
import { preloadAllAvatars, applyRemotePortrait, ensureAvatarPortrait } from "../app/avatarPortrait";
import {
  playCardCallSfx,
  playCardSelectSfx,
  playButtonSfx,
  playDoubleCallSfx,
  playQuickChatSfx,
  preloadDoubleVoices,
  preloadQuickChatVoices,
  unlockCardSfx,
} from "../app/cardSfx";
import type { PlayVoiceKind } from "../app/cardSfx";
import { SEAT_ANIMAL_IDS, SeatAnimalId, seatAnimalId, seatAnimalNameById, spectatorAnimalId, tableAnimalId, tableAnimalName } from "../app/seatAnimals";
import { SettleRoom } from "./SettleRoom";
import { installVolumeControl } from "./volumeControl";
import {
  CardView,
  ClientMessage,
  MatchItemView,
  MatchPublicView,
  PendingView,
  QUICK_CHAT_LINES,
  QuickChatId,
} from "../net/Protocol";
import { net } from "../net/WsClient";
import {
  CARD_BOMB,
  CARD_GOLD,
  HAND_CARD,
  HAND_MAX_WIDTH,
  HAND_STACK_Y,
  HAND_TYPE_CN,
  ITEM_ART,
  ITEM_CELL,
  ITEM_CELL_STEP,
  ITEM_DOCK,
  ITEM_LIST_TOP_PAD,
  ITEM_VIEW,
  PEEK_CARD,
  PEEK_MAX_WIDTH,
  PEEK_STACK_Y,
  SELECT_DIM,
  SELECT_LIFT,
  TABLE_CARD,
  fanStartX,
  layoutRankedHand,
  makeFaceCard,
  makePassBubble,
  makeTurnClock,
  overlapStep,
  preloadCardArt,
  rarityInk,
  sortHand,
} from "./cards";

const { ccclass } = _decorator;

const WHITE = new Color(240, 240, 240, 255);
const MUTED = new Color(170, 170, 170, 255);
const GOLD = CARD_GOLD;
const CREAM = new Color(245, 236, 214, 255);
const INK = new Color(48, 28, 10, 255);
const TURN = new Color(120, 220, 140, 255);
const WOOD = new Color(58, 38, 24, 255);
/** 本人名牌：中等蓝，不要藏青 */
const SELF_PLATE_FILL = new Color(48, 92, 158, 210);
const SELF_PLATE_STROKE = new Color(118, 176, 232, 245);
const SELF_PLATE_INK = new Color(64, 126, 204, 255);
const PLATE_FILL = new Color(72, 44, 24, 200);
const PLATE_STROKE = new Color(212, 164, 72, 240);
const WIN = new Color(96, 220, 140, 255);
const LOSE = new Color(255, 118, 118, 255);
const CLOCK_URGENT = new Color(255, 96, 96, 255);
/** 出牌 / 过牌：金黄底，深色字 */
const ACTION_BTN_FILL = new Color(236, 178, 42, 255);
const ACTION_BTN_FILL_OFF = new Color(118, 92, 40, 255);
const ACTION_BTN_STROKE = new Color(120, 72, 16, 255);

/** 兔子打出的牌、偷看/神之眼展示的手牌相对立绘整体右移 */
const RABBIT_CARD_NUDGE_X = 20;

/** 对齐 table-bg 四只动物：熊猫下、猫头鹰右、狐狸上、兔子左。出牌沿此逆时针。play 为该角色出牌落点（朝向桌心）。 */
const TABLE_CHAIRS: { id: SeatAnimalId; x: number; y: number; playX: number; playY: number }[] = [
  { id: "panda", x: -610, y: -240, playX: -360, playY: -200 },
  { id: "fox", x: -190, y: 295, playX: 90, playY: 235 },
  { id: "owl", x: 690, y: 140, playX: 390, playY: 70 },
  { id: "rabbit", x: -610, y: 140, playX: -340 + RABBIT_CARD_NUDGE_X, playY: 70 },
];
const NAMEPLATE_W = 176;
const NAMEPLATE_H = 100;
/** 点背景上的动物立绘（比名牌大，避开桌心出牌区） */
const ANIMAL_HITS: Record<SeatAnimalId, { dx: number; dy: number; w: number; h: number }> = {
  panda: { dx: 40, dy: -40, w: 280, h: 300 },
  fox: { dx: 90, dy: 24, w: 300, h: 250 },
  owl: { dx: -24, dy: -20, w: 260, h: 300 },
  rabbit: { dx: 8, dy: 16, w: 270, h: 300 },
};
const PLAYER_PROFILE = { w: 440, h: 520, portrait: 200 };
const HAND_DOCK = { x: 320, y: -390 };
/** 手牌点击区高度：上沿低于打出的牌和出牌按钮 */
const HAND_HOST_H = 230;
/** 绿毡近沿、手牌正上方横排：出牌左、过牌右 */
const ACTION_BTNS = { playX: 180, passX: 440, y: -75, w: 240, h: 72 };
/** table-bg 右上角画好的托管钮（1920×1080 图坐标）；只负责进入托管 */
const AUTO_PLAY_HIT = { mx: 1830, my: 90, w: 120, h: 150 };
/** table-bg 左下角画好的对话图标（原图 1024×576，按 1920×1080 坐标换算）。 */
const QUICK_CHAT_HIT = { mx: 78, my: 998, w: 108, h: 92 };
const QUICK_CHAT_PANEL = { x: -650, y: -220, w: 560, h: 400 };
const QUICK_CHAT_SPEAKER_MS = 2000;
const QUICK_CHAT_COOLDOWN_MS = 5000;
const QUICK_CHAT_SPEAKER_OFFSET: Record<SeatAnimalId, { x: number; y: number }> = {
  panda: { x: 154, y: 70 },
  fox: { x: 184, y: -6 },
  owl: { x: -142, y: 68 },
  rabbit: { x: 142, y: 68 },
};
/** 托管中：屏幕正中取消按钮 */
const CANCEL_AUTO_PLAY = { x: 0, y: 0, w: 360, h: 96 };
/** 出牌超时后的挂机确认 */
const AFK_HOST_PANEL = { w: 780, h: 320, btnW: 240, btnH: 80 };
/** 狐狸立绘右缘（透视手牌贴在这右侧） */
const FOX_ART_RIGHT = 168;
const FOX_ART_MID_Y = 312;
const PEEK_GAP = 10;
const CLOCK_SIZE = 76;
const CLOCK_ABOVE = NAMEPLATE_H / 2 + 10 + CLOCK_SIZE / 2;
const PHASE_BAR = { w: 1080, h: 54 };
const CARD_COUNTER = { x: -724, y: 398, w: 432, h: 168, cols: 8 };
/** 强易抽到牌后的提示时长 */
const DRAW_HINT_MS = 6000;
/** 非法出牌提示 */
const PLAY_REJECT_MS = 2000;
const SKILL_HIT_MS = 4000;
/** 出完后亮牌，顶部阶段栏显示「××获胜」+ 倒计时 6 秒再进结算 */
/** 与服务端 WIN_BANNER_MS 对齐；结算页 10s 倒计时从这段结束算起 */
const WIN_BANNER_MS = 6000;
const PLAY_REJECT_TIP = "选择的牌不符合规则";
/** 点道具栏弹出的说明：与拍卖描述框同款 16:9 底板 */
const ITEM_INFO = { w: 800, h: 450, radius: 18, inset: 6, stroke: 6 };
const ITEM_NAME_CN: Record<string, string> = {
  legendary_play_something_else: "玩点别的",
  legendary_swap_hands: "换一下",
  legendary_god_eye: "神之眼",
  legendary_extra_round: "加赛",
  legendary_wild_king: "癞子大王",
  legendary_bomb_king: "炸弹大王",
  legendary_bomb_defuser: "拆弹专家",
  legendary_force_trade: "强易",
  legendary_collect_jokers: "双王",
  legendary_discard_nine: "丢弃",
  legendary_super_upgrade: "超级升级",
  epic_star: "星星",
  epic_triple_plus_one: "三带两个一",
  epic_memory: "记忆力",
  epic_bomb: "炸弹",
  epic_control: "操控",
  epic_copy: "复制",
  epic_max_bomb: "最大炸弹",
  epic_self_follow: "自娱自乐",
  epic_four_plus_three: "四带三",
  epic_big_trade: "大交易",
  epic_big_upgrade: "大升级",
  rare_bounce: "打回",
  rare_steal_one: "万一是好牌呢",
  rare_instant_win: "直接胜利",
  rare_head_start: "抢跑",
  rare_anti_overload: "防过载",
  rare_peek: "偷看",
  rare_upgrade: "升级",
  rare_smoke: "烟雾弹",
  rare_brain_overload: "大脑过载",
  rare_small_insight: "小洞察",
};
const TARGET_SKILL_IDS = new Set(["rare_steal_one", "legendary_force_trade", "epic_big_trade"]);
const CHOICE_SKILL_IDS = new Set([...TARGET_SKILL_IDS, "epic_control"]);
/** 猜拳亮出手势：相对名牌朝桌心偏移 */
const RPS_BADGE_OFFSET: Record<SeatAnimalId, { x: number; y: number }> = {
  panda: { x: 132, y: 8 },
  fox: { x: 210, y: 4 },
  owl: { x: -132, y: 8 },
  rabbit: { x: 132, y: 8 },
};

type PickMode =
  | { kind: "none" }
  | { kind: "target"; itemId: string }
  | { kind: "control" };

@ccclass("TableRoom")
export class TableRoom extends Component {
  private statusLabel: Label | null = null;
  private turnLabel: Label | null = null;
  private tableLabel: Label | null = null;
  private eventLabel: Label | null = null;
  private pendingLabel: Label | null = null;
  private hintLabel: Label | null = null;
  private phaseBar: Node | null = null;
  private phaseLabel: Label | null = null;
  private counterHost: Node | null = null;
  private btnPlay: Button | null = null;
  private btnPass: Button | null = null;
  private btnCancelAutoPlay: Button | null = null;
  private afkHostRoot: Node | null = null;
  private handHost: Node | null = null;
  private oppHost: Node | null = null;
  private playHost: Node | null = null;
  private itemHost: Node | null = null;
  private itemContent: Node | null = null;
  private itemScroll: ScrollView | null = null;
  private lastItemDockKey = "";
  private lastHandSig = "";
  private lastPlaySig = "";
  private lastOppSig = "";
  private refreshQueued = false;
  private refreshing = false;
  private itemInfoRoot: Node | null = null;
  private itemInfoArt: Sprite | null = null;
  private itemInfoArtFill: Graphics | null = null;
  private itemInfoBgSprite: Sprite | null = null;
  private lastItemInfoBgKey = "";
  private itemInfoName: Label | null = null;
  private itemInfoStatus: Label | null = null;
  private itemInfoDesc: Label | null = null;
  private itemInfoUse: Button | null = null;
  private itemInfoSkip: Button | null = null;
  private itemInfoTimer: Label | null = null;
  private itemInfoTargetHost: Node | null = null;
  private itemInfoShown: MatchItemView | null = null;
  private itemInfoOfferMode = false;
  private pendingRemainLabel: Label | null = null;
  private pendingRemainHost: Node | null = null;
  private lastTargetChoiceKey = "";
  private awaitingItemUse = false;
  private lastForceTradeKey = "";
  private drawHintHost: Node | null = null;
  private drawHintLabel: Label | null = null;
  private drawHintUntil = 0;
  private drawHintKey = "";
  private drawHintText = "";
  private pendingHost: Node | null = null;
  private rpsHost: Node | null = null;
  private platesHost: Node | null = null;
  private animalHitsHost: Node | null = null;
  private playerProfileRoot: Node | null = null;
  private playerProfilePortrait: Node | null = null;
  private playerProfileName: Label | null = null;
  private playerProfileSeat: Label | null = null;
  private panelSettle: Node | null = null;
  private settleLabel: Label | null = null;
  private settleTitle: Label | null = null;
  private settleMine: Label | null = null;
  private settleList: Label | null = null;
  private clockHost: Node | null = null;
  private clockLabel: Label | null = null;

  private selected = new Set<string>();
  /** 滑动选牌：向前扫过时处理，沿轨迹回划时逐张恢复原状态。 */
  private swipeActive = false;
  private swipeMode: "select" | "deselect" | null = null;
  private swipeTrail: string[] = [];
  private swipeOriginal = new Map<string, boolean>();
  private swipeLastId = "";
  private handSwipeBound = false;
  private readonly swipeFrom = new Vec2();
  private readonly touchUi = new Vec2();
  private readonly swipeSample = new Vec2();
  private readonly touchWorld = new Vec3();
  private readonly touchLocal = new Vec3();
  private lastPasses = new Set<string>();
  private pickMode: PickMode = { kind: "none" };
  private playRejectUntil = 0;
  private skillHitUntil = 0;
  private skillHitText = "";
  private unbindMsg: (() => void) | null = null;
  private unbindStatus: (() => void) | null = null;
  private leaving = false;
  private finishCelebKey = "";
  private finishCelebUntil = 0;
  private winBanner: Node | null = null;
  private quickChatPanel: Node | null = null;
  private quickChatSpeakerHost: Node | null = null;
  private quickChatSentAt = 0;
  private quickChatUntil = new Map<string, number>();

  onLoad() {
    if (EDITOR && !PREVIEW) return;
    session.ensureIdentity();
    unlockCardSfx();
    preloadDoubleVoices();
    preloadQuickChatVoices();
    preloadAllAvatars([...SEAT_ANIMAL_IDS]);
    void preloadCardArt().then(() => {
      if (this.node?.isValid) this.refresh();
    });
    this.ensureUi();
    this.hookWebglRestore();
    this.unbindMsg = net.onMessage((msg) => {
      if (msg.type === "welcome") {
        session.rememberIdentity(msg.playerId, msg.displayName);
        session.lastError = "";
      } else if (msg.type === "room") {
        session.room = msg.room;
      } else if (msg.type === "match") {
        session.setMatchView(msg.view);
        this.pruneSelection();
        if (!this.node.getComponent(SettleRoom) && isTablePhase(msg.view)) this.queueRefresh();
      } else if (msg.type === "events") {
        for (const ev of msg.events) this.noteEvent(ev);
        const hit = skillToastLine(msg.events, session.playerId, (id) => this.animalNameForPlayer(id) || "有人");
        if (hit) {
          this.skillHitText = hit;
          this.skillHitUntil = Date.now() + (hit.includes("抽取") ? DRAW_HINT_MS : SKILL_HIT_MS);
        }
        const line = formatMatchEvent(msg.events[msg.events.length - 1]);
        if (line) session.lastEventText = line;
        this.queueRefresh();
      } else if (msg.type === "quick_chat") {
        this.onQuickChatReceived(msg.playerId, msg.phraseId);
      } else if (msg.type === "error") {
        if (isIllegalPlaySelection(msg.message)) {
          this.rejectIllegalPlay();
        } else {
          session.lastError = playErrorCn(msg.message);
          this.awaitingItemUse = false;
          this.queueRefresh();
        }
      } else if (msg.type === "score") {
        session.applyScore(msg.score);
        session.dailyRestoreDay = msg.dailyRestoreDay ?? null;
        this.queueRefresh();
      } else if (msg.type === "avatar") {
        session.applyAvatar(msg.avatar.equipped, msg.avatar.unlocked);
      } else if (msg.type === "settlement") {
        session.lastSettlement = msg.deltas;
        this.queueRefresh();
      }
    });
    this.unbindStatus = net.onStatus(() => this.refreshStatus());
    void bootNet();
    this.refresh();
  }

  update() {
    if (EDITOR && !PREVIEW) return;
    if (this.node.getComponent(SettleRoom)) return;
    if (!isTablePhase(session.matchView)) return;
    if (this.refreshQueued) {
      this.refreshQueued = false;
      this.refresh();
    }
    this.refreshPhaseBar(session.matchView?.public);
    this.refreshClockFace();
    this.refreshItemInfoTimer();
    this.refreshPendingRemain();
    this.refreshAfkHostOverlay();
    this.refreshDrawHint();
    this.refreshQuickChatSpeakers();
    this.refreshHint();
    if (this.finishCelebUntil && Date.now() >= this.finishCelebUntil) {
      this.endFinishCelebration();
    }
  }

  onDestroy() {
    this.unbindMsg?.();
    this.unbindStatus?.();
    this.unschedule(this.endFinishCelebration);
    this.unscheduleAllCallbacks();
    if (this.node?.isValid) this.hideWinBanner();
    if (this.handSwipeBound && this.handHost?.isValid) {
      this.handHost.off(Node.EventType.TOUCH_START, this.onHandTouchStart, this);
      this.handHost.off(Node.EventType.TOUCH_MOVE, this.onHandTouchMove, this);
      this.handHost.off(Node.EventType.TOUCH_END, this.onHandTouchEnd, this);
      this.handHost.off(Node.EventType.TOUCH_CANCEL, this.onHandTouchEnd, this);
    }
    this.handSwipeBound = false;
    this.handHost = null;
  }

  private ensureUi() {
    this.ensureShell();
    installVolumeControl(this.node);
    this.ensureQuickChatUi();
    this.node.getChildByName("Title")?.destroy();
    this.node.getChildByName("Status")?.destroy();
    this.node.getChildByName("TurnLine")?.destroy();
    this.node.getChildByName("EventLine")?.destroy();
    this.statusLabel = null;
    this.turnLabel = null;
    this.eventLabel = null;
    this.tableLabel = this.findLabel("TableLine");
    this.pendingLabel = this.findLabel("PendingLine");
    if (this.pendingLabel) this.pendingLabel.node.active = false;
    this.hintLabel = this.findLabel("Hint");
    this.phaseBar = this.node.getChildByName("PhaseBar");
    this.phaseLabel = this.phaseBar?.getChildByName("text")?.getComponent(Label) ?? null;
    this.counterHost = this.node.getChildByName("CardCounter");
    this.node.getChildByName("SelfMeta")?.destroy();
    this.handHost = this.node.getChildByName("HandHost");
    this.oppHost = this.node.getChildByName("OppHost");
    this.playHost = this.node.getChildByName("PlayHost");
    this.itemHost = this.node.getChildByName("ItemHost");
    this.pendingHost = this.node.getChildByName("PendingHost");
    this.rpsHost = this.node.getChildByName("RpsHost");
    this.platesHost = this.node.getChildByName("PlatesHost");
    this.animalHitsHost = this.node.getChildByName("AnimalHits");
    this.playerProfileRoot = this.node.getChildByName("PanelPlayerProfile");
    this.panelSettle = this.node.getChildByName("PanelSettle");
    this.clockHost = this.node.getChildByName("ClockHost");
    this.btnPlay = this.node.getChildByName("BtnPlay")?.getComponent(Button) ?? null;
    this.btnPass = this.node.getChildByName("BtnPass")?.getComponent(Button) ?? null;
    this.btnCancelAutoPlay =
      this.node.getChildByName("BtnCancelAutoPlay")?.getComponent(Button) ?? null;
    this.afkHostRoot = this.node.getChildByName("AfkHostPanel");
    if (this.panelSettle) {
      this.settleLabel = this.panelSettle.getChildByName("SettleText")?.getComponent(Label) ?? null;
      this.ensureSettleChrome();
    }
    if (!this.clockHost) this.clockHost = this.host("ClockHost");
    this.ensureClock();
    this.ensurePhaseBar();
    this.ensureCardCounter();
    if (!this.platesHost) this.platesHost = this.host("PlatesHost");
    if (!this.animalHitsHost) this.animalHitsHost = this.host("AnimalHits");
    this.ensurePlayerProfilePanel();
    if (this.handHost) {
      if (!this.playHost) this.playHost = this.host("PlayHost");
      this.applyTableLayout();
      this.layoutActionButtons();
      this.wireButtons();
      this.bindHandSwipe();
      return;
    }
    this.buildUi();
    this.wireButtons();
    this.bindHandSwipe();
  }

  private applyTableLayout() {
    this.handHost?.setPosition(HAND_DOCK.x, HAND_DOCK.y, 0);
    this.handHost?.getComponent(UITransform)?.setContentSize(HAND_MAX_WIDTH + 80, HAND_HOST_H);
    this.itemHost?.setPosition(ITEM_DOCK.x, ITEM_DOCK.y, 0);
    if (!this.itemScroll) this.ensureItemDock();
    this.pendingHost?.setPosition(0, 10, 0);
    this.node.getChildByName("PendingRemain")?.setPosition(0, 92, 0);
    this.rpsHost?.setPosition(0, 0, 0);
    this.playHost?.setPosition(0, 0, 0);
    this.oppHost?.setPosition(0, 0, 0);
    this.platesHost?.setPosition(0, 0, 0);
    if (this.turnLabel) this.turnLabel.node.active = false;
    if (this.tableLabel) this.tableLabel.node.active = false;
    const handLine = this.node.getChildByName("HandLine");
    if (handLine) handLine.active = false;
    if (this.pendingLabel) this.pendingLabel.node.active = false;
    this.phaseBar?.setPosition(0, this.phaseBarY(), 0);
    this.counterHost?.setPosition(CARD_COUNTER.x, CARD_COUNTER.y, 0);
    if (this.hintLabel) this.hintLabel.node.setPosition(HAND_DOCK.x, ACTION_BTNS.y + 78, 0);
  }

  private raiseTableHud() {
    const last = this.node.children.length - 1;
    for (const name of [
      "AnimalHits",
      "PlayHost",
      "OppHost",
      "PlatesHost",
      "RpsHost",
      "ItemHost",
      "BtnPlay",
      "BtnPass",
      "Hint",
      "HandHost",
      "ClockHost",
      "PhaseBar",
      "CardCounter",
      "PendingHost",
      "PendingRemain",
      "DrawHint",
      "AutoPlayHit",
      "QuickChatHit",
      "QuickChatSpeakers",
      "QuickChatPanel",
      "VolumeControl",
      "BtnCancelAutoPlay",
      "WinBanner",
      "PanelSettle",
      "PanelItemInfo",
      "AfkHostPanel",
      "PanelPlayerProfile",
    ]) {
      this.node.getChildByName(name)?.setSiblingIndex(last);
    }
  }

  private layoutActionButtons() {
    const pub = session.matchView?.public;
    const me = session.playerId;
    const hosted = this.selfAutoPlaying(pub);
    const canAct = !hosted && canPlayOrPass(pub, me);
    const showPass = !hosted && shouldShowPassButton(pub, me);
    const n = this.selected.size;
    const place = (btn: Button | null, x: number, y: number, label: string) => {
      if (!btn) return;
      btn.node.setPosition(x, y, 0);
      const uit = btn.node.getComponent(UITransform);
      if (uit) uit.setContentSize(ACTION_BTNS.w, ACTION_BTNS.h);
      const lab = this.buttonLabel(btn);
      if (lab) {
        lab.fontSize = 36;
        lab.lineHeight = 42;
        lab.string = label;
      }
    };
    place(this.btnPass, ACTION_BTNS.passX, ACTION_BTNS.y, this.passButtonLabel());
    if (this.btnPass) this.btnPass.node.active = showPass;
    place(this.btnPlay, this.playButtonX(showPass), ACTION_BTNS.y, "出牌");
    this.setInteractable(this.btnPlay, !!canAct && n > 0);
    this.setInteractable(this.btnPass, showPass);
    this.layoutCancelAutoPlay(pub);
    this.raiseTableHud();
  }

  private playButtonX(showPass: boolean): number {
    if (showPass) return ACTION_BTNS.playX;
    return Math.round((ACTION_BTNS.playX + ACTION_BTNS.passX) / 2);
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
    clearUiSpriteCache("table-bg");
    void loadUiSpriteFrame("table-bg").then((sf) => {
      if (!sf || !sp.isValid) return;
      this.applyFitSprite(img, sf, w, h);
      sp.spriteFrame = sf;
      g.clear();
    });
  }

  private tableBgToLocal(mx: number, my: number): { x: number; y: number } {
    return { x: mx - 960, y: 540 - my };
  }

  private ensureAutoPlayHit() {
    if (this.node.getChildByName("AutoPlayHit")) return;
    const { x, y } = this.tableBgToLocal(AUTO_PLAY_HIT.mx, AUTO_PLAY_HIT.my);
    const n = new Node("AutoPlayHit");
    n.layer = this.node.layer;
    this.node.addChild(n);
    n.setPosition(x, y, 0);
    n.addComponent(UITransform).setContentSize(AUTO_PLAY_HIT.w, AUTO_PLAY_HIT.h);
    const g = n.addComponent(Graphics);
    g.fillColor = new Color(0, 0, 0, 0);
    g.rect(-AUTO_PLAY_HIT.w / 2, -AUTO_PLAY_HIT.h / 2, AUTO_PLAY_HIT.w, AUTO_PLAY_HIT.h);
    g.fill();
    n.addComponent(Button).transition = Button.Transition.NONE;
    n.on(
      Button.EventType.CLICK,
      () => {
        playButtonSfx();
        this.onToggleAutoPlay();
      },
      this,
    );
  }

  private ensureQuickChatUi() {
    const existingHit = this.node.getChildByName("QuickChatHit");
    const existingPanel = this.node.getChildByName("QuickChatPanel");
    const existingSpeakers = this.node.getChildByName("QuickChatSpeakers");
    if (existingHit && existingPanel && existingSpeakers) {
      this.quickChatPanel = existingPanel;
      this.quickChatSpeakerHost = existingSpeakers;
      return;
    }
    existingHit?.destroy();
    existingPanel?.destroy();
    existingSpeakers?.destroy();

    const { x, y } = this.tableBgToLocal(QUICK_CHAT_HIT.mx, QUICK_CHAT_HIT.my);
    const hit = new Node("QuickChatHit");
    hit.layer = this.node.layer;
    this.node.addChild(hit);
    hit.setPosition(x, y, 0);
    hit.addComponent(UITransform).setContentSize(QUICK_CHAT_HIT.w, QUICK_CHAT_HIT.h);
    const hitFill = hit.addComponent(Graphics);
    hitFill.fillColor = new Color(0, 0, 0, 0);
    hitFill.rect(
      -QUICK_CHAT_HIT.w / 2,
      -QUICK_CHAT_HIT.h / 2,
      QUICK_CHAT_HIT.w,
      QUICK_CHAT_HIT.h,
    );
    hitFill.fill();
    hit.addComponent(Button).transition = Button.Transition.NONE;
    hit.on(
      Button.EventType.CLICK,
      () => {
        playButtonSfx();
        if (this.quickChatPanel) this.quickChatPanel.active = !this.quickChatPanel.active;
      },
      this,
    );

    const panel = new Node("QuickChatPanel");
    panel.layer = this.node.layer;
    panel.active = false;
    this.node.addChild(panel);
    panel.setPosition(QUICK_CHAT_PANEL.x, QUICK_CHAT_PANEL.y, 0);
    panel.addComponent(UITransform).setContentSize(QUICK_CHAT_PANEL.w, QUICK_CHAT_PANEL.h);
    panel.addComponent(BlockInputEvents);
    const bg = panel.addComponent(Graphics);
    bg.fillColor = new Color(38, 24, 14, 248);
    bg.roundRect(
      -QUICK_CHAT_PANEL.w / 2,
      -QUICK_CHAT_PANEL.h / 2,
      QUICK_CHAT_PANEL.w,
      QUICK_CHAT_PANEL.h,
      22,
    );
    bg.fill();
    bg.strokeColor = GOLD;
    bg.lineWidth = 4;
    bg.roundRect(
      -QUICK_CHAT_PANEL.w / 2,
      -QUICK_CHAT_PANEL.h / 2,
      QUICK_CHAT_PANEL.w,
      QUICK_CHAT_PANEL.h,
      22,
    );
    bg.stroke();
    this.makeLabel(panel, "title", "快捷对话", 0, 158, 30, GOLD, 500, 42);
    QUICK_CHAT_LINES.forEach((line, index) => {
      const button = this.makeButton(
        panel,
        `QuickChat-${line.id}`,
        line.text,
        0,
        102 - index * 64,
        480,
        54,
      );
      this.bindTap(button, () => this.sendQuickChat(line.id));
    });
    this.quickChatPanel = panel;

    this.quickChatSpeakerHost = this.host("QuickChatSpeakers");
  }

  private sendQuickChat(phraseId: QuickChatId) {
    this.quickChatPanel && (this.quickChatPanel.active = false);
    const now = Date.now();
    if (now - this.quickChatSentAt < QUICK_CHAT_COOLDOWN_MS) return;
    this.quickChatSentAt = now;
    this.sendIntent({ type: "quick_chat", phraseId });
  }

  private onQuickChatReceived(playerId: string, phraseId: QuickChatId) {
    const animal = tableAnimalId(playerId, session.matchView?.public?.seatOrder);
    if (!animal) return;
    playQuickChatSfx(animal, phraseId);
    this.quickChatUntil.set(playerId, Date.now() + QUICK_CHAT_SPEAKER_MS);
    this.paintQuickChatSpeakers();
  }

  private refreshQuickChatSpeakers() {
    const now = Date.now();
    let changed = false;
    for (const [playerId, until] of this.quickChatUntil) {
      if (until > now) continue;
      this.quickChatUntil.delete(playerId);
      changed = true;
    }
    if (changed) this.paintQuickChatSpeakers();
  }

  private paintQuickChatSpeakers() {
    if (!this.quickChatSpeakerHost?.isValid) return;
    for (const child of [...this.quickChatSpeakerHost.children]) child.destroy();
    const seatOrder = session.matchView?.public?.seatOrder;
    for (const playerId of this.quickChatUntil.keys()) {
      const animal = tableAnimalId(playerId, seatOrder);
      const chair = TABLE_CHAIRS.find((entry) => entry.id === animal);
      if (!animal || !chair) continue;
      const offset = QUICK_CHAT_SPEAKER_OFFSET[animal];
      const badge = new Node(`speaker-${playerId}`);
      badge.layer = this.quickChatSpeakerHost.layer;
      this.quickChatSpeakerHost.addChild(badge);
      badge.setPosition(chair.x + offset.x, chair.y + offset.y, 0);
      badge.addComponent(UITransform).setContentSize(66, 66);
      this.drawQuickChatSpeaker(badge.addComponent(Graphics));
    }
  }

  private drawQuickChatSpeaker(g: Graphics) {
    g.fillColor = new Color(39, 24, 12, 235);
    g.circle(0, 0, 31);
    g.fill();
    g.strokeColor = GOLD;
    g.lineWidth = 3;
    g.circle(0, 0, 31);
    g.stroke();
    g.fillColor = CREAM;
    g.rect(-18, -7, 9, 14);
    g.fill();
    g.moveTo(-9, -8);
    g.lineTo(3, -17);
    g.lineTo(3, 17);
    g.lineTo(-9, 8);
    g.close();
    g.fill();
    g.strokeColor = CREAM;
    g.lineWidth = 3;
    g.arc(3, 0, 12, -0.8, 0.8, false);
    g.stroke();
    g.arc(3, 0, 20, -0.72, 0.72, false);
    g.stroke();
  }

  private selfAutoPlaying(pub: MatchPublicView | undefined): boolean {
    return !!(session.playerId && pub?.autoPlay?.[session.playerId]);
  }

  private refreshAutoPlayHit(pub: MatchPublicView | undefined, finished: boolean) {
    const n = this.node.getChildByName("AutoPlayHit");
    if (n) n.active = !finished && pub?.phase === "playing" && !this.selfAutoPlaying(pub);
    this.layoutCancelAutoPlay(pub, finished);
  }

  private layoutCancelAutoPlay(pub: MatchPublicView | undefined, finished = false) {
    const btn = this.btnCancelAutoPlay;
    if (!btn) return;
    const show = !finished && pub?.phase === "playing" && this.selfAutoPlaying(pub);
    btn.node.active = show;
    btn.node.setPosition(CANCEL_AUTO_PLAY.x, CANCEL_AUTO_PLAY.y, 0);
    const uit = btn.node.getComponent(UITransform);
    if (uit) uit.setContentSize(CANCEL_AUTO_PLAY.w, CANCEL_AUTO_PLAY.h);
    const bgUt = btn.node.getChildByName("bg")?.getComponent(UITransform);
    if (bgUt) bgUt.setContentSize(CANCEL_AUTO_PLAY.w, CANCEL_AUTO_PLAY.h);
    const capUt = btn.node.getChildByName("cap")?.getComponent(UITransform);
    if (capUt) capUt.setContentSize(CANCEL_AUTO_PLAY.w, CANCEL_AUTO_PLAY.h);
    const lab = this.buttonLabel(btn);
    if (lab) {
      lab.fontSize = 40;
      lab.lineHeight = 48;
      lab.string = "取消托管";
    }
    this.setInteractable(btn, show);
  }

  private onToggleAutoPlay() {
    const pub = session.matchView?.public;
    if (!pub || pub.phase !== "playing") return;
    if (this.selfAutoPlaying(pub)) return;
    this.sendIntent({ type: "set_auto_play", enabled: true });
  }

  private onCancelAutoPlay() {
    const pub = session.matchView?.public;
    if (!pub || pub.phase !== "playing" || !this.selfAutoPlaying(pub)) return;
    this.sendIntent({ type: "set_auto_play", enabled: false });
  }

  private isAfkHostPrompt(pub: MatchPublicView | undefined): boolean {
    const pending = pub?.pending;
    return pending?.kind === "afk_host" && pending.playerId === session.playerId;
  }

  private ensureAfkHostOverlay() {
    if (this.afkHostRoot?.isValid) return;
    const existing = this.node.getChildByName("AfkHostPanel");
    if (existing) {
      this.afkHostRoot = existing;
      return;
    }
    const root = new Node("AfkHostPanel");
    root.layer = this.node.layer;
    this.node.addChild(root);
    root.setPosition(0, 0, 0);
    root.addComponent(UITransform).setContentSize(AFK_HOST_PANEL.w, AFK_HOST_PANEL.h);
    const g = root.addComponent(Graphics);
    const hw = AFK_HOST_PANEL.w / 2;
    const hh = AFK_HOST_PANEL.h / 2;
    g.fillColor = new Color(42, 26, 14, 236);
    g.roundRect(-hw, -hh, AFK_HOST_PANEL.w, AFK_HOST_PANEL.h, 22);
    g.fill();
    g.strokeColor = GOLD;
    g.lineWidth = 4;
    g.roundRect(-hw, -hh, AFK_HOST_PANEL.w, AFK_HOST_PANEL.h, 22);
    g.stroke();
    const msg = this.makeLabel(
      root,
      "msg",
      "系统发现你有挂机行为，将进行托管",
      0,
      70,
      32,
      CREAM,
      AFK_HOST_PANEL.w - 80,
      96,
    );
    msg.enableWrapText = true;
    msg.overflow = Label.Overflow.SHRINK;
    this.makeLabel(root, "remain", "", 0, 8, 28, GOLD, 400, 40);
    const hostBtn = this.makeButton(
      root,
      "BtnAfkHost",
      "进行托管",
      -150,
      -90,
      AFK_HOST_PANEL.btnW,
      AFK_HOST_PANEL.btnH,
    );
    const cancelBtn = this.makeButton(
      root,
      "BtnAfkCancel",
      "取消",
      150,
      -90,
      AFK_HOST_PANEL.btnW,
      AFK_HOST_PANEL.btnH,
    );
    this.bindTap(hostBtn, () => this.sendIntent({ type: "resolve_afk_host", host: true }));
    this.bindTap(cancelBtn, () => this.sendIntent({ type: "resolve_afk_host", host: false }));
    root.active = false;
    this.afkHostRoot = root;
  }

  private refreshAfkHostOverlay() {
    this.ensureAfkHostOverlay();
    const root = this.afkHostRoot;
    if (!root?.isValid) return;
    const pub = session.matchView?.public;
    const pending = pub?.pending;
    const show =
      !session.lastSettlement &&
      pub?.phase === "playing" &&
      pending?.kind === "afk_host" &&
      pending.playerId === session.playerId;
    root.active = show;
    if (!show) return;
    const remain = root.getChildByName("remain")?.getComponent(Label);
    const until = pending?.expiresAt ?? 0;
    const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    if (remain) remain.string = `${left}秒`;
  }

  private buildUi() {
    const root = this.node;
    this.tableLabel = this.makeLabel(root, "TableLine", "", 0, 150, 26, GOLD, 1200, 90);
    this.tableLabel.node.active = false;
    this.pendingLabel = null;
    this.eventLabel = null;
    this.hintLabel = this.makeLabel(root, "Hint", "", HAND_DOCK.x, ACTION_BTNS.y + 78, 24, GOLD, 980, 52);
    this.hintLabel.overflow = Label.Overflow.SHRINK;
    this.hintLabel.enableWrapText = true;

    this.oppHost = this.host("OppHost");
    this.playHost = this.host("PlayHost");
    this.itemHost = this.host("ItemHost");
    this.pendingHost = this.host("PendingHost");
    this.pendingHost.setPosition(0, 10, 0);
    this.rpsHost = this.host("RpsHost");
    this.platesHost = this.host("PlatesHost");
    this.animalHitsHost = this.host("AnimalHits");
    this.ensurePlayerProfilePanel();
    this.handHost = this.host("HandHost");
    this.handHost.setPosition(HAND_DOCK.x, HAND_DOCK.y, 0);
    this.handHost.getComponent(UITransform)?.setContentSize(HAND_MAX_WIDTH + 80, HAND_HOST_H);

    this.btnPlay = this.makeButton(root, "BtnPlay", "出牌", ACTION_BTNS.playX, ACTION_BTNS.y, ACTION_BTNS.w, ACTION_BTNS.h);
    this.btnPass = this.makeButton(root, "BtnPass", "过牌", ACTION_BTNS.passX, ACTION_BTNS.y, ACTION_BTNS.w, ACTION_BTNS.h);
    this.btnCancelAutoPlay = this.makeButton(
      root,
      "BtnCancelAutoPlay",
      "取消托管",
      CANCEL_AUTO_PLAY.x,
      CANCEL_AUTO_PLAY.y,
      CANCEL_AUTO_PLAY.w,
      CANCEL_AUTO_PLAY.h,
    );
    this.setInteractable(this.btnPlay, false);
    this.setInteractable(this.btnPass, false);
    this.setInteractable(this.btnCancelAutoPlay, true);
    if (this.btnPass) this.btnPass.node.active = false;
    if (this.btnCancelAutoPlay) this.btnCancelAutoPlay.node.active = false;
    this.layoutActionButtons();

    if (!this.clockHost) this.clockHost = this.host("ClockHost");
    this.ensureClock();
    this.ensurePhaseBar();
    this.ensureCardCounter();

    this.panelSettle = new Node("PanelSettle");
    this.panelSettle.layer = root.layer;
    this.panelSettle.active = false;
    root.addChild(this.panelSettle);
    this.panelSettle.addComponent(UITransform).setContentSize(1920, 1080);
    this.ensureSettleChrome();
    this.makeButton(this.panelSettle, "BtnSettleBack", "返回大厅", 0, -380, 260);
  }

  private wireButtons() {
    this.node.getChildByName("BtnTableBack")?.destroy();
    this.bindTap(this.btnPlay, () => this.onPlay());
    this.bindTap(this.btnPass, () => this.onPass());
    this.bindTap(this.btnCancelAutoPlay, () => this.onCancelAutoPlay());
    this.bindTap(
      this.panelSettle?.getChildByName("BtnSettleBack")?.getComponent(Button) ?? null,
      () => this.onBack(),
    );
  }

  private queueRefresh() {
    this.refreshQueued = true;
  }

  private hookWebglRestore() {
    const canvas = game.canvas as (HTMLCanvasElement & { __pcWebglHooked?: boolean }) | null;
    if (!canvas || canvas.__pcWebglHooked) return;
    canvas.__pcWebglHooked = true;
    canvas.addEventListener("webglcontextlost", (ev) => {
      ev.preventDefault();
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.lastHandSig = "";
      this.lastPlaySig = "";
      this.lastOppSig = "";
      this.lastItemDockKey = "";
      if (this.node?.isValid) this.queueRefresh();
    });
  }

  private refresh() {
    if (this.refreshing) return;
    if (this.node.getComponent(SettleRoom)) return;
    this.refreshing = true;
    try {
      this.refreshTable();
    } catch (err) {
      console.error("[TableRoom] refresh failed", err);
    } finally {
      this.refreshing = false;
    }
  }

  private refreshTable() {
    this.refreshStatus();

    const view = session.matchView;
    const pub = view?.public;
    const finished = !!session.lastSettlement || pub?.phase === "finished";
    const celebrating = this.syncFinishCelebration(pub, finished);
    if (this.panelSettle) this.panelSettle.active = false;
    if (finished) {
      this.closeItemInfo(false);
      this.closePlayerProfile();
    } else {
      this.syncItemOfferPopup();
      this.refreshItemInfo();
    }
    if (this.clockHost) this.clockHost.active = !finished && pub?.phase === "playing";
    this.ensureAutoPlayHit();
    this.ensureQuickChatUi();
    this.refreshNameplates(pub);
    this.refreshAnimalHits(pub);
    this.refreshAutoPlayHit(pub, finished);
    const quickChatHit = this.node.getChildByName("QuickChatHit");
    const quickChatAvailable =
      !finished && (pub?.phase === "dealing" || pub?.phase === "playing");
    if (quickChatHit) quickChatHit.active = quickChatAvailable;
    if (!quickChatAvailable && this.quickChatPanel) this.quickChatPanel.active = false;
    if (finished) {
      this.refreshCardCounter(pub);
      this.refreshPlayZones(pub);
      this.refreshOpponents();
      this.refreshHand();
      this.refreshItems();
      if (this.btnPlay) this.btnPlay.node.active = false;
      if (this.btnPass) this.btnPass.node.active = false;
      if (this.btnCancelAutoPlay) this.btnCancelAutoPlay.node.active = false;
      if (this.afkHostRoot) this.afkHostRoot.active = false;
      if (this.pendingHost) this.pendingHost.active = false;
      if (this.hintLabel) this.hintLabel.string = "";
      this.hideWinBanner();
      if (celebrating) this.refreshPhaseBar(pub);
      else this.openSettle();
      return;
    }

    this.pruneSelection();
    this.syncForceTradeReturn();
    this.applyTableLayout();
    this.refreshPhaseBar(pub);
    this.refreshCardCounter(pub);
    this.refreshPlayZones(pub);
    this.refreshOpponents();
    this.refreshHand();
    this.refreshItems();
    this.refreshPendingActions();
    this.refreshPendingRemain();
    this.refreshAfkHostOverlay();
    this.refreshDrawHint();
    this.refreshRpsBadges(pub);
    this.refreshActions(pub);
    this.refreshHint();
    this.layoutActionButtons();
    this.refreshClockFace();
  }

  private noteEvent(ev: unknown) {
    if (!ev || typeof ev !== "object") return;
    const e = ev as Record<string, unknown>;
    const t = String(e.type ?? "");
    const pid = String(e.playerId ?? "");
    if (t === "passed" && pid) this.lastPasses.add(pid);
    if (t === "played" && pid) this.lastPasses.delete(pid);
    if (t === "new_lead" || t === "dealt" || t === "match_finished") this.lastPasses.clear();
    if ((t === "played" || t === "passed") && pid) {
      const animal = tableAnimalId(pid, session.matchView?.public?.seatOrder);
      const kind =
        t === "passed"
          ? "pass"
          : cardPlayVoiceKind(String(e.handType ?? ""), Number(e.mainRank));
      if (animal && kind) playCardCallSfx(animal, kind);
    }
    if (t === "score_double_chosen" && pid) {
      const animal = tableAnimalId(pid, session.matchView?.public?.seatOrder);
      const choice = String(e.choice ?? "");
      if (animal && (choice === "none" || choice === "double" || choice === "super")) {
        playDoubleCallSfx(animal, choice);
      }
    }
  }

  private refreshStatus() {
    if (!this.statusLabel) return;
    const err = session.lastError ? ` · ${session.lastError}` : "";
    this.statusLabel.string = `${net.statusText} · ${session.displayName} · 积分 ${session.score}${err}`;
  }

  private phaseBarY(): number {
    const { h } = this.canvasSize();
    return Math.round(h / 2 - 28 - PHASE_BAR.h / 2);
  }

  private ensurePhaseBar() {
    const uitReady = this.phaseBar?.getComponent(UITransform);
    if (
      this.phaseBar?.isValid &&
      this.phaseLabel?.isValid &&
      uitReady &&
      uitReady.contentSize.width === PHASE_BAR.w &&
      uitReady.contentSize.height === PHASE_BAR.h
    ) {
      this.phaseBar.setPosition(0, this.phaseBarY(), 0);
      return;
    }
    if (!this.phaseBar?.isValid) {
      this.phaseBar = this.node.getChildByName("PhaseBar");
    }
    if (!this.phaseBar) this.phaseBar = this.host("PhaseBar");
    this.phaseBar.setPosition(0, this.phaseBarY(), 0);
    const { w, h } = PHASE_BAR;
    let uit = this.phaseBar.getComponent(UITransform);
    if (!uit) uit = this.phaseBar.addComponent(UITransform);
    uit.setContentSize(w, h);
    let bg = this.phaseBar.getComponent(Graphics);
    if (!bg) bg = this.phaseBar.addComponent(Graphics);
    bg.clear();
    const hw = w / 2;
    const hh = h / 2;
    bg.fillColor = new Color(20, 14, 8, 220);
    bg.roundRect(-hw, -hh, w, h, 18);
    bg.fill();
    bg.strokeColor = new Color(212, 164, 72, 230);
    bg.lineWidth = 2;
    bg.roundRect(-hw, -hh, w, h, 18);
    bg.stroke();
    this.phaseLabel = this.phaseBar.getChildByName("text")?.getComponent(Label) ?? null;
    if (!this.phaseLabel) {
      this.phaseLabel = this.makeLabel(this.phaseBar, "text", "", 0, 0, 30, CREAM, w - 40, h - 10);
      this.phaseLabel.overflow = Label.Overflow.SHRINK;
      this.phaseLabel.enableWrapText = false;
      this.phaseLabel.isBold = true;
      this.phaseLabel.lineHeight = 34;
    }
  }

  private refreshPhaseBar(pub: MatchPublicView | undefined) {
    this.ensurePhaseBar();
    if (!this.phaseBar || !this.phaseLabel) return;
    if (this.finishCelebUntil && Date.now() < this.finishCelebUntil) {
      this.phaseBar.active = true;
      this.phaseBar.setPosition(0, this.phaseBarY(), 0);
      this.phaseBar.setSiblingIndex(this.node.children.length - 1);
      const names = this.winnerNames(pub);
      const line = names.length ? `${names.join("、")}获胜` : "获胜";
      const left = Math.max(0, Math.ceil((this.finishCelebUntil - Date.now()) / 1000));
      this.phaseLabel.string = `${line} ${left}秒`;
      this.phaseLabel.color = left <= 3 ? CLOCK_URGENT : GOLD;
      return;
    }
    const finished = !!session.lastSettlement || pub?.phase === "finished";
    if (finished || !pub || pub.phase !== "playing") {
      this.phaseBar.active = false;
      return;
    }
    this.phaseBar.active = true;
    this.phaseBar.setPosition(0, this.phaseBarY(), 0);
    const line = this.phaseBarText(pub);
    const left = this.phaseBarSeconds(pub);
    const clock = left == null ? line : `${line} ${left}秒`;
    const mult = pub.scoreMultiplier && pub.scoreMultiplier > 1 ? `  倍率×${pub.scoreMultiplier}` : "";
    this.phaseLabel.string = `${clock}${mult}`;
    this.phaseLabel.color = left != null && left <= 5 ? CLOCK_URGENT : CREAM;
  }

  private ensureCardCounter() {
    if (this.counterHost?.isValid) {
      this.counterHost.setPosition(CARD_COUNTER.x, CARD_COUNTER.y, 0);
      return;
    }
    this.counterHost = this.node.getChildByName("CardCounter");
    if (!this.counterHost) this.counterHost = this.host("CardCounter");
    this.counterHost.setPosition(CARD_COUNTER.x, CARD_COUNTER.y, 0);
    const { w, h } = CARD_COUNTER;
    let uit = this.counterHost.getComponent(UITransform);
    if (!uit) uit = this.counterHost.addComponent(UITransform);
    uit.setContentSize(w, h);
    let bg = this.counterHost.getComponent(Graphics);
    if (!bg) bg = this.counterHost.addComponent(Graphics);
    bg.clear();
    const hw = w / 2;
    const hh = h / 2;
    bg.fillColor = new Color(20, 14, 8, 220);
    bg.roundRect(-hw, -hh, w, h, 14);
    bg.fill();
    bg.strokeColor = new Color(212, 164, 72, 200);
    bg.lineWidth = 2;
    bg.roundRect(-hw, -hh, w, h, 14);
    bg.stroke();
    let title = this.counterHost.getChildByName("title")?.getComponent(Label) ?? null;
    if (!title) {
      title = this.makeLabel(this.counterHost, "title", "记牌器", 0, h / 2 - 18, 20, GOLD, w - 16, 24);
      title.isBold = true;
    }
    if (!this.counterHost.getChildByName("cells")) {
      const cells = new Node("cells");
      cells.layer = this.counterHost.layer;
      this.counterHost.addChild(cells);
      cells.setPosition(0, -8, 0);
      cells.addComponent(UITransform).setContentSize(w - 12, h - 36);
    }
    this.counterHost.active = false;
  }

  private refreshCardCounter(pub: MatchPublicView | undefined) {
    this.ensureCardCounter();
    if (!this.counterHost) return;
    const finished = !!session.lastSettlement || pub?.phase === "finished";
    const rows = pub?.cardCounter;
    if (finished || !pub || pub.phase !== "playing" || !rows?.length) {
      this.counterHost.active = false;
      return;
    }
    this.counterHost.active = true;
    this.counterHost.setPosition(CARD_COUNTER.x, CARD_COUNTER.y, 0);
    const cells = this.counterHost.getChildByName("cells");
    if (!cells) return;
    const { w, h, cols } = CARD_COUNTER;
    const innerW = w - 12;
    const innerH = h - 36;
    const rowsN = Math.max(1, Math.ceil(rows.length / cols));
    const cellW = innerW / cols;
    const cellH = innerH / rowsN;
    const startX = -innerW / 2 + cellW / 2;
    const startY = innerH / 2 - cellH / 2;
    if (cells.children.length !== rows.length) {
      cells.removeAllChildren();
      rows.forEach((row, i) => {
        const col = i % cols;
        const r = Math.floor(i / cols);
        const lab = this.makeLabel(
          cells,
          `c-${row.id}`,
          "",
          startX + col * cellW,
          startY - r * cellH,
          18,
          CREAM,
          cellW - 2,
          cellH - 2,
        );
        lab.overflow = Label.Overflow.SHRINK;
        lab.enableWrapText = true;
        lab.lineHeight = 20;
      });
    }
    rows.forEach((row, i) => {
      const lab = cells.children[i]?.getComponent(Label);
      if (!lab) return;
      lab.string = `${row.label}\n${row.count}`;
      lab.color = row.count > 0 ? CREAM : MUTED;
      if (row.id === "star") lab.color = row.count > 0 ? GOLD : MUTED;
      if (row.id === "bomb") lab.color = row.count > 0 ? CARD_BOMB : MUTED;
    });
  }

  private phaseBarSeconds(pub: MatchPublicView): number | null {
    const until = clockUntilMs(pub);
    if (until == null) return null;
    return Math.max(0, Math.ceil((until - Date.now()) / 1000));
  }

  private actorWord(playerId: string | null | undefined): string {
    if (!playerId) return "有人";
    if (playerId === session.playerId) return "你";
    return this.animalNameForPlayer(playerId) || session.playerName(playerId) || "有人";
  }

  private doubleMark(playerId: string | undefined, pub: MatchPublicView | undefined): string {
    if (!playerId) return "";
    const n = pub?.scoreDoubles?.[playerId] ?? 1;
    if (n === 4) return " 超×4";
    if (n === 2) return " 加倍";
    return "";
  }

  private skillName(itemId: string | undefined): string {
    if (!itemId) return "技能";
    const mine = session.matchView?.items.find((i) => i.id === itemId);
    if (mine?.name) return mine.name;
    return ITEM_NAME_CN[itemId] ?? "技能";
  }

  private usingSkillLine(playerId: string | null | undefined, itemId: string | undefined): string {
    return `${this.actorWord(playerId)}正在使用技能${this.skillName(itemId)}`;
  }

  private thinkingSkillLine(playerId: string | null | undefined, itemId: string | undefined): string {
    return `${this.actorWord(playerId)}正在思考是否使用技能${this.skillName(itemId)}`;
  }

  private phaseBarText(pub: MatchPublicView): string {
    const pending = pub.pending;
    if (
      this.pickMode.kind === "target" &&
      pending?.kind === "offer_item" &&
      pending.itemId === this.pickMode.itemId
    ) {
      return this.usingSkillLine(session.playerId, this.pickMode.itemId);
    }
    if (
      this.pickMode.kind === "control" &&
      pending?.kind === "offer_item" &&
      pending.itemId === "epic_control"
    ) {
      return this.usingSkillLine(session.playerId, "epic_control");
    }
    if (pending?.kind === "offer_item") {
      return this.thinkingSkillLine(pending.playerId, pending.itemId);
    }
    if (pending?.kind === "force_trade") {
      return this.usingSkillLine(pending.playerId, "legendary_force_trade");
    }
    if (pending?.kind === "swap_hands") {
      return this.thinkingSkillLine(pending.playerId, "legendary_swap_hands");
    }
    if (pending?.kind === "extra_round") {
      return this.thinkingSkillLine(pending.playerId, "legendary_extra_round");
    }
    if (pending?.kind === "rps") {
      return this.usingSkillLine(pending.challengerId, "legendary_play_something_else");
    }
    if (pending?.kind === "score_double") {
      return "请选择加倍、不加倍或超级加倍";
    }
    if (pending?.kind === "after_play" || pending?.kind === "on_lead") {
      return this.thinkingSkillLine(pending.playerId, pending.itemId);
    }

    const bounceLine = this.bouncePhaseLine(pub);
    if (bounceLine) return bounceLine;

    const who = this.actorWord(pub.turnPlayerId);
    const restriction = pub.leadRestriction;
    if (
      restriction?.playerId === session.playerId &&
      pub.turnPlayerId === session.playerId &&
      pub.freeLead
    ) {
      const caster = this.animalNameForPlayer(restriction.controllerId) || "有人";
      const type = controlTypeCn(restriction.allowed);
      return `${caster}对你使用了操控，请打出${type}牌型或移交领出回合`;
    }
    if (isMyOverloadedTurn(pub, session.playerId)) {
      return "大脑过载中，思考时间仅 4 秒";
    }
    if (pub.freeLead || restriction?.playerId === pub.turnPlayerId) {
      return `${who}正在思考领出`;
    }
    return `${who}正在思考跟牌`;
  }

  private bouncePhaseLine(pub: MatchPublicView | undefined): string | null {
    if (!pub?.bounceForbidType || !pub.turnPlayerId) return null;
    const mine = this.bouncedVictimHint(pub);
    if (mine) return mine;
    const who = this.actorWord(pub.turnPlayerId);
    return `${who}被打回，须改出其他牌型`;
  }

  private bouncedVictimHint(pub: MatchPublicView | undefined): string | null {
    if (!pub?.bounceForbidType || pub.turnPlayerId !== session.playerId) return null;
    const caster = this.animalNameForPlayer(pub.lastBouncerId) || "有人";
    const type = HAND_TYPE_CN[String(pub.bounceForbidType)] ?? "该牌型";
    return `${caster}对你使用了打回，请打出不同于${type}的牌型`;
  }

  private targetPickPrompt(itemId: string): string {
    if (itemId === "legendary_force_trade") return "选择抽谁的一张牌";
    if (itemId === "rare_steal_one") return "选择偷谁的一张牌";
    if (itemId === "epic_big_trade") return "选择和谁交换最大的三张牌";
    return "选择一名动物";
  }

  private targetPickButton(itemId: string, playerId: string): string {
    const who = this.animalNameForPlayer(playerId) || "对方";
    if (itemId === "legendary_force_trade") return `抽${who}`;
    if (itemId === "rare_steal_one") return `偷${who}`;
    if (itemId === "epic_big_trade") return `与${who}换`;
    return who;
  }

  private refreshPlayZones(pub: MatchPublicView | undefined) {
    if (!this.playHost) return;
    const ids = pub?.seatOrder ?? session.room?.playerIds ?? [];
    const table = pub?.table ?? null;
    const leader = table?.playerId ?? "";
    const sig = [
      ids.join(","),
      leader,
      (table?.cards ?? []).map((c) => c.id).join(","),
      table?.type ?? "",
      String(table?.cardCount ?? 0),
      [...this.lastPasses].join(","),
    ].join("|");
    if (sig === this.lastPlaySig) return;
    this.lastPlaySig = sig;
    this.playHost.removeAllChildren();
    const n = ids.length || 1;

    ids.forEach((id, seat) => {
      const chair = TABLE_CHAIRS.find((c) => c.id === seatAnimalId(seat, n));
      const pos = chair ? { x: chair.playX, y: chair.playY } : { x: 0, y: 0 };
      if (table && leader === id && (table.cards?.length || table.cardCount)) {
        const cards = table.cards ?? [];
        if (cards.length) {
          this.drawFan(this.playHost!, cards, pos.x, pos.y, TABLE_CARD.w, TABLE_CARD.h, 280);
        } else {
          this.makeLabel(
            this.playHost!,
            `table-${id}`,
            `${HAND_TYPE_CN[table.type] ?? table.type} ×${table.cardCount}`,
            pos.x,
            pos.y,
            22,
            GOLD,
            280,
            40,
          );
        }
        return;
      }
      if (this.lastPasses.has(id)) {
        makePassBubble(this.playHost!, `pass-${id}`, pos.x, pos.y);
      }
    });
  }

  private drawFan(
    parent: Node,
    cards: Array<{ id: string; kind: string; rank?: number; suit?: string }>,
    ox: number,
    oy: number,
    w: number,
    h: number,
    maxWidth: number,
    selectedIds?: Set<string>,
    clickable = false,
  ) {
    const step = overlapStep(cards.length, w, maxWidth);
    const start = fanStartX(cards.length, step);
    cards.forEach((card, i) => {
      const selected = !!selectedIds?.has(card.id);
      const y = oy + (selected ? SELECT_LIFT : 0);
      const node = makeFaceCard(parent, `card-${card.id}`, card, ox + start + i * step, y, w, h, selected);
      if (clickable) {
        const btn = node.addComponent(Button);
        btn.transition = Button.Transition.NONE;
        this.bindTap(btn, () => this.toggleCard(card.id), true, false);
      }
    });
  }

  private refreshHint() {
    if (!this.hintLabel) return;
    const pub = session.matchView?.public;
    if (pub?.phase === "finished" || session.lastSettlement) {
      this.hintLabel.string = "";
      return;
    }
    const pending = pub?.pending;
    const rejecting = Date.now() < this.playRejectUntil;
    this.hintLabel.color = GOLD;
    if (this.pickMode.kind === "target") {
      this.hintLabel.string = "";
    } else if (this.pickMode.kind === "control") {
      const who = this.animalNameForPlayer(this.pendingLeaderId());
      this.hintLabel.string = who ? `强制${who}下次领出：单张或对子` : "强制下次领出：单张或对子";
    } else if (pending?.kind === "rps") {
      this.hintLabel.string = this.rpsHint(pending);
    } else if (pending?.kind === "force_trade" && pending.playerId === session.playerId) {
      const who = this.animalNameForPlayer(pending.targetId);
      this.hintLabel.string = who ? `点选一张手牌，还给${who}` : "点选一张手牌交还";
    } else if (rejecting) {
      this.hintLabel.string = PLAY_REJECT_TIP;
      this.hintLabel.color = CLOCK_URGENT;
    } else if (isMyControlledLead(session.matchView?.public, session.playerId)) {
      const pub = session.matchView?.public;
      const caster = this.animalNameForPlayer(pub?.leadRestriction?.controllerId) || "有人";
      const type = controlTypeCn(pub?.leadRestriction?.allowed);
      this.hintLabel.string = `${caster}对你使用了操控，请打出${type}牌型或移交领出回合`;
    } else {
      const bounceLine = this.bouncedVictimHint(session.matchView?.public);
      if (bounceLine) {
        this.hintLabel.string = bounceLine;
      } else if (this.skillHitText && Date.now() < this.skillHitUntil) {
        this.hintLabel.string = this.skillHitText;
      } else if (isMyOverloadedTurn(session.matchView?.public, session.playerId)) {
        this.hintLabel.string = "大脑过载中，思考时间仅 4 秒";
      } else {
        this.hintLabel.string = "";
      }
    }
  }

  private refreshNameplates(pub: MatchPublicView | undefined) {
    if (!this.platesHost) this.platesHost = this.host("PlatesHost");
    const ids = pub?.seatOrder ?? session.room?.playerIds ?? [];
    const n = ids.length;
    const occupied = new Map<SeatAnimalId, string>();
    ids.forEach((id, seat) => occupied.set(seatAnimalId(seat, n || 4), id));
    const spec = spectatorAnimalId(n || 4);
    const seen = new Set<string>();

    for (const chair of TABLE_CHAIRS) {
      const playerId = occupied.get(chair.id);
      const spectator = !playerId && spec === chair.id;
      if (!playerId && !spectator) continue;
      const slotId = playerId ?? `spectator-${chair.id}`;
      seen.add(slotId);
      const slot = this.ensureNameplate(slotId);
      slot.setPosition(chair.x, chair.y, 0);
      const nameLab = slot.getChildByName("name")?.getComponent(Label);
      const handLab = slot.getChildByName("hand")?.getComponent(Label);
      const scoreLab = slot.getChildByName("score")?.getComponent(Label);
      const me = playerId === session.playerId;
      this.paintNameplate(slot, me && !spectator);
      if (spectator) {
        if (nameLab) {
          nameLab.string = seatAnimalNameById(chair.id);
          this.setLabelInk(nameLab, MUTED, false);
          nameLab.node.setPosition(0, 14, 0);
        }
        if (handLab) {
          handLab.string = "观众";
          this.setLabelInk(handLab, MUTED, false);
          handLab.node.setPosition(0, -14, 0);
        }
        if (scoreLab) {
          scoreLab.string = "";
          scoreLab.node.active = false;
        }
        const bombLab = slot.getChildByName("bombs");
        if (bombLab) bombLab.active = false;
        continue;
      }
      const you = me ? "（你）" : "";
      if (nameLab) {
        nameLab.string = `${seatAnimalNameById(chair.id)}${you}`;
        this.setLabelInk(nameLab, me ? SELF_PLATE_INK : CREAM, me);
        nameLab.node.setPosition(0, 28, 0);
      }
      const rawCount = pub?.handCounts?.[playerId!];
      const hidden = rawCount === null;
      const count =
        hidden ? null : (rawCount ?? (me ? session.matchView?.hand.length ?? 0 : 0));
      if (handLab) {
        const auto = !!(playerId && pub?.autoPlay?.[playerId]);
        const base = hidden ? "手牌 ??" : `手牌 ${count}`;
        handLab.string = auto ? `${base} · 托管` : base;
        this.setLabelInk(handLab, me ? SELF_PLATE_INK : CREAM, me);
        handLab.node.setPosition(0, 2, 0);
      }
      const score = pub?.scores?.[playerId!] ?? (me ? session.score : null);
      const bombs = !me && playerId ? pub?.bombInsight?.[playerId] : undefined;
      const bombLab = this.ensureBombLabel(slot);
      if (bombLab) {
        const showBombs = typeof bombs === "number";
        bombLab.node.active = showBombs;
        if (showBombs) {
          bombLab.string = `炸弹 ${bombs}`;
          bombLab.color = GOLD;
          bombLab.node.setPosition(0, -14, 0);
        }
      }
      if (handLab) handLab.node.setPosition(0, typeof bombs === "number" ? 8 : 2, 0);
      if (scoreLab) {
        scoreLab.node.active = true;
        scoreLab.node.setPosition(0, typeof bombs === "number" ? -36 : -26, 0);
        scoreLab.string = `${score === null ? "积分 —" : `积分 ${score}`}${this.doubleMark(playerId, pub)}`;
        scoreLab.color = GOLD;
      }
      this.bindTap(slot.getComponent(Button), () => this.onSeatTap(playerId!), true, false);
    }

    for (const child of [...this.platesHost.children]) {
      const id = child.name.startsWith("plate-") ? child.name.slice(6) : "";
      if (id && !seen.has(id)) child.destroy();
    }
    this.platesHost.setSiblingIndex(this.node.children.length - 1);
  }

  private ensureNameplate(id: string): Node {
    const name = `plate-${id}`;
    let slot = this.platesHost!.getChildByName(name);
    if (slot) return slot;
    slot = this.makeWoodBoard(this.platesHost!, name, 0, 0, NAMEPLATE_W, NAMEPLATE_H);
    this.makeLabel(slot, "name", "", 0, 28, 22, CREAM, NAMEPLATE_W - 12, 26);
    this.makeLabel(slot, "hand", "", 0, 2, 20, CREAM, NAMEPLATE_W - 12, 24);
    this.makeLabel(slot, "bombs", "", 0, -14, 18, GOLD, NAMEPLATE_W - 12, 22);
    this.makeLabel(slot, "score", "", 0, -26, 20, GOLD, NAMEPLATE_W - 12, 24);
    slot.getChildByName("bombs")!.active = false;
    slot.addComponent(Button).transition = Button.Transition.NONE;
    return slot;
  }

  private ensureBombLabel(slot: Node): Label | null {
    const existing = slot.getChildByName("bombs")?.getComponent(Label) ?? null;
    if (existing) return existing;
    const lab = this.makeLabel(slot, "bombs", "", 0, -14, 18, GOLD, NAMEPLATE_W - 12, 22);
    lab.node.active = false;
    return lab;
  }

  private refreshAnimalHits(pub: MatchPublicView | undefined) {
    if (!this.animalHitsHost) this.animalHitsHost = this.host("AnimalHits");
    const ids = pub?.seatOrder ?? session.room?.playerIds ?? [];
    const n = ids.length;
    const occupied = new Map<SeatAnimalId, string>();
    ids.forEach((id, seat) => occupied.set(seatAnimalId(seat, n || 4), id));
    const seen = new Set<string>();
    for (const chair of TABLE_CHAIRS) {
      const playerId = occupied.get(chair.id);
      if (!playerId) continue;
      seen.add(playerId);
      const hit = this.ensureAnimalHit(playerId);
      const box = ANIMAL_HITS[chair.id];
      hit.setPosition(chair.x + box.dx, chair.y + box.dy, 0);
      hit.getComponent(UITransform)?.setContentSize(box.w, box.h);
      this.bindTap(hit.getComponent(Button), () => this.onSeatTap(playerId), true, false);
    }
    for (const child of [...this.animalHitsHost.children]) {
      const id = child.name.startsWith("animal-") ? child.name.slice(7) : "";
      if (id && !seen.has(id)) child.destroy();
    }
    if (this.playerProfileRoot?.active) {
      this.playerProfileRoot.setSiblingIndex(this.node.children.length - 1);
    }
  }

  private ensureAnimalHit(playerId: string): Node {
    const name = `animal-${playerId}`;
    let hit = this.animalHitsHost!.getChildByName(name);
    if (hit) return hit;
    hit = new Node(name);
    hit.layer = this.animalHitsHost!.layer;
    this.animalHitsHost!.addChild(hit);
    hit.addComponent(UITransform).setContentSize(240, 280);
    const btn = hit.addComponent(Button);
    btn.transition = Button.Transition.NONE;
    return hit;
  }

  private ensurePlayerProfilePanel() {
    if (this.playerProfileRoot?.isValid) {
      this.playerProfilePortrait = this.playerProfileRoot.getChildByName("panel")?.getChildByName("portrait") ?? null;
      this.playerProfileName =
        this.playerProfileRoot.getChildByName("panel")?.getChildByName("name")?.getComponent(Label) ?? null;
      this.playerProfileSeat =
        this.playerProfileRoot.getChildByName("panel")?.getChildByName("seat")?.getComponent(Label) ?? null;
      return;
    }
    const { w, h } = this.canvasSize();
    const overlay = new Node("PanelPlayerProfile");
    overlay.layer = this.node.layer;
    this.node.addChild(overlay);
    overlay.addComponent(UITransform).setContentSize(w, h);
    overlay.addComponent(BlockInputEvents);
    overlay.active = false;
    this.playerProfileRoot = overlay;

    const dimmer = new Node("dimmer");
    dimmer.layer = overlay.layer;
    overlay.addChild(dimmer);
    dimmer.addComponent(UITransform).setContentSize(w, h);
    const dim = dimmer.addComponent(Graphics);
    dim.fillColor = new Color(8, 4, 2, 170);
    dim.rect(-w / 2, -h / 2, w, h);
    dim.fill();
    const dimBtn = dimmer.addComponent(Button);
    dimBtn.transition = Button.Transition.NONE;
    this.bindTap(dimBtn, () => this.closePlayerProfile(), true, false);

    const pw = PLAYER_PROFILE.w;
    const ph = PLAYER_PROFILE.h;
    const panel = this.makeWoodBoard(overlay, "panel", 0, 20, pw, ph);
    panel.addComponent(BlockInputEvents);

    const portraitSize = PLAYER_PROFILE.portrait;
    const portrait = ensureAvatarPortrait(panel, "portrait", portraitSize);
    portrait.setPosition(0, 70, 0);
    this.playerProfilePortrait = portrait;

    const nameLab = this.makeLabel(panel, "name", "", 0, -90, 36, CREAM, pw - 40, 52);
    nameLab.isBold = true;
    nameLab.overflow = Label.Overflow.SHRINK;
    this.playerProfileName = nameLab;

    const seatLab = this.makeLabel(panel, "seat", "", 0, -140, 24, GOLD, pw - 40, 36);
    this.playerProfileSeat = seatLab;

    const close = new Node("BtnClose");
    close.layer = panel.layer;
    panel.addChild(close);
    close.setPosition(pw / 2 - 36, ph / 2 - 36, 0);
    close.addComponent(UITransform).setContentSize(56, 56);
    const cg = close.addComponent(Graphics);
    cg.fillColor = new Color(92, 28, 22, 255);
    cg.circle(0, 0, 24);
    cg.fill();
    cg.strokeColor = GOLD;
    cg.lineWidth = 2;
    cg.circle(0, 0, 24);
    cg.stroke();
    const closeLab = this.makeLabel(close, "x", "×", 0, 2, 36, CREAM, 56, 56);
    closeLab.isBold = true;
    const closeBtn = close.addComponent(Button);
    closeBtn.transition = Button.Transition.NONE;
    this.bindTap(closeBtn, () => this.closePlayerProfile(), true);
  }

  private openPlayerProfile(playerId: string) {
    this.ensurePlayerProfilePanel();
    const overlay = this.playerProfileRoot;
    if (!overlay?.isValid) return;
    const name = session.playerName(playerId) || playerId;
    const you = playerId === session.playerId ? "（你）" : "";
    const animal = this.animalNameForPlayer(playerId);
    if (this.playerProfileName) this.playerProfileName.string = `${name}${you}`;
    if (this.playerProfileSeat) this.playerProfileSeat.string = animal ? `扮演 ${animal}` : "";
    if (this.playerProfilePortrait) {
      void applyRemotePortrait(this.playerProfilePortrait, session.playerPortraitUrl(playerId), PLAYER_PROFILE.portrait);
    }
    overlay.active = true;
    overlay.setSiblingIndex(this.node.children.length - 1);
  }

  private closePlayerProfile() {
    if (this.playerProfileRoot?.isValid) this.playerProfileRoot.active = false;
  }

  private setLabelInk(lab: Label, color: Color, selfSeat: boolean) {
    lab.color = color;
    lab.enableOutline = selfSeat;
    lab.outlineColor = new Color(18, 32, 56, 220);
    lab.outlineWidth = selfSeat ? 2 : 0;
  }

  private paintNameplate(slot: Node, selfSeat: boolean) {
    const g = slot.getComponent(Graphics);
    const ut = slot.getComponent(UITransform);
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

  private makeWoodBoard(parent: Node, name: string, x: number, y: number, w: number, h: number): Node {
    const n = new Node(name);
    n.layer = parent.layer;
    parent.addChild(n);
    n.setPosition(x, y, 0);
    n.addComponent(UITransform).setContentSize(w, h);
    n.addComponent(Graphics);
    this.paintNameplate(n, false);
    return n;
  }

  private refreshActions(pub: MatchPublicView | undefined) {
    const me = session.playerId;
    const hosted = this.selfAutoPlaying(pub);
    const canAct = !hosted && canPlayOrPass(pub, me);
    const showPass = !hosted && shouldShowPassButton(pub, me);
    const n = this.selected.size;
    if (this.btnPlay) this.btnPlay.node.active = !!canAct;
    if (this.btnPass) this.btnPass.node.active = showPass;
    this.setInteractable(this.btnPlay, !!canAct && n > 0);
    this.setInteractable(this.btnPass, showPass);
    const playLab = this.buttonLabel(this.btnPlay);
    if (playLab) playLab.string = "出牌";
    const passLab = this.buttonLabel(this.btnPass);
    if (passLab) passLab.string = this.passButtonLabel();
    if (this.btnPlay) this.btnPlay.node.setPosition(this.playButtonX(showPass), ACTION_BTNS.y, 0);
  }

  private passButtonLabel(): string {
    return isMyControlledLead(session.matchView?.public, session.playerId) ? "移交" : "过牌";
  }

  private refreshHand() {
    if (!this.handHost) return;
    const hand = session.matchView?.hand ?? [];
    if (!hand.length) {
      this.lastHandSig = "";
      if (this.handHost.children.length) this.handHost.removeAllChildren();
      return;
    }
    const { w, h } = HAND_CARD;
    const slots = layoutRankedHand(
      hand,
      w,
      h,
      HAND_MAX_WIDTH,
      HAND_STACK_Y,
      this.selected,
      SELECT_LIFT,
    );
    const sig = slots
      .map((s) => `${s.card.id}:${s.x}:${s.hitY}:${s.hitH}:${this.selected.has(s.card.id) ? 1 : 0}`)
      .join("|");
    if (sig === this.lastHandSig && this.handHost.children.length === slots.length) return;
    this.lastHandSig = sig;
    this.handHost.removeAllChildren();
    for (const slot of slots) {
      const node = makeFaceCard(
        this.handHost,
        `card-${slot.card.id}`,
        slot.card,
        slot.x,
        slot.hitY,
        w,
        h,
        this.selected.has(slot.card.id),
        slot.hitH,
        slot.visualOffsetY,
      );
      node.on(Node.EventType.TOUCH_START, this.onHandTouchStart, this);
      node.on(Node.EventType.TOUCH_MOVE, this.onHandTouchMove, this);
      node.on(Node.EventType.TOUCH_END, this.onHandTouchEnd, this);
      node.on(Node.EventType.TOUCH_CANCEL, this.onHandTouchEnd, this);
    }
  }

  private bindHandSwipe() {
    if (!this.handHost || this.handSwipeBound) return;
    this.handSwipeBound = true;
    const n = this.handHost;
    n.on(Node.EventType.TOUCH_START, this.onHandTouchStart, this);
    n.on(Node.EventType.TOUCH_MOVE, this.onHandTouchMove, this);
    n.on(Node.EventType.TOUCH_END, this.onHandTouchEnd, this);
    n.on(Node.EventType.TOUCH_CANCEL, this.onHandTouchEnd, this);
  }

  private onHandTouchStart(e: EventTouch) {
    e.propagationStopped = true;
    unlockCardSfx();
    this.swipeActive = true;
    this.swipeMode = null;
    this.swipeTrail.length = 0;
    this.swipeOriginal.clear();
    this.swipeLastId = "";
    this.playRejectUntil = 0;
    e.getLocation(this.touchUi);
    this.swipeFrom.set(this.touchUi);
    const id = this.cardIdAtUi(this.touchUi);
    if (id) this.applySwipeCard(id);
    else this.paintSwipeStroke(this.touchUi, null);
  }

  private onHandTouchMove(e: EventTouch) {
    if (!this.swipeActive) return;
    e.getLocation(this.touchUi);
    this.paintSwipeStroke(this.touchUi, this.swipeFrom);
    this.swipeFrom.set(this.touchUi);
  }

  private onHandTouchEnd() {
    this.swipeActive = false;
    this.swipeMode = null;
    this.swipeTrail.length = 0;
    this.swipeOriginal.clear();
    this.swipeLastId = "";
  }

  private cardIdAtUi(ui: Vec2): string | null {
    const host = this.handHost;
    if (!host) return null;
    const kids = host.children;
    for (let i = kids.length - 1; i >= 0; i -= 1) {
      const n = kids[i]!;
      if (!n.name.startsWith("card-")) continue;
      const ut = n.getComponent(UITransform);
      if (ut && this.cardContainsUi(ut, ui)) return n.name.slice(5);
    }
    return null;
  }

  private paintSwipeStroke(to: Vec2, from: Vec2 | null) {
    const hit = (ui: Vec2) => {
      const id = this.cardIdAtUi(ui);
      if (id) this.applySwipeCard(id);
    };
    hit(to);
    if (!from) return;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / 8));
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      this.swipeSample.set(from.x + dx * t, from.y + dy * t);
      hit(this.swipeSample);
    }
  }

  private applySwipeCard(id: string) {
    if (this.isForceTradeReturn()) {
      this.pickForceTradeCard(id);
      return;
    }
    if (id === this.swipeLastId) return;
    this.swipeLastId = id;
    if (!this.swipeMode) {
      this.swipeMode = this.selected.has(id) ? "deselect" : "select";
    }

    const priorIndex = this.swipeTrail.lastIndexOf(id);
    if (priorIndex >= 0) {
      let changed = false;
      while (this.swipeTrail.length - 1 > priorIndex) {
        const restoredId = this.swipeTrail.pop()!;
        const original = this.swipeOriginal.get(restoredId) ?? false;
        const before = this.selected.has(restoredId);
        if (original) this.selected.add(restoredId);
        else this.selected.delete(restoredId);
        if (before !== original) {
          changed = true;
          playCardSelectSfx(original);
          this.paintHandCardSelected(restoredId, original);
        }
      }
      if (changed) this.refreshActions(session.matchView?.public);
      return;
    }

    if (!this.swipeOriginal.has(id)) this.swipeOriginal.set(id, this.selected.has(id));
    this.swipeTrail.push(id);
    const before = this.selected.has(id);
    if (this.swipeMode === "select") this.selected.add(id);
    else this.selected.delete(id);
    const after = this.selected.has(id);
    if (before !== after) playCardSelectSfx(after);
    this.paintHandCardSelected(id, after);
    this.refreshActions(session.matchView?.public);
  }

  private paintHandCardSelected(id: string, on: boolean) {
    const n = this.handHost?.getChildByName(`card-${id}`);
    if (!n) return;
    const tint = on ? SELECT_DIM : Color.WHITE;
    for (const sp of n.getComponentsInChildren(Sprite)) {
      sp.color = tint;
    }
  }

  private cardContainsUi(ut: UITransform, screen: Vec2): boolean {
    this.touchWorld.set(screen.x, screen.y, 0);
    ut.convertToNodeSpaceAR(this.touchWorld, this.touchLocal);
    const w = ut.contentSize.width;
    const h = ut.contentSize.height;
    const left = -w * ut.anchorX;
    const bottom = -h * ut.anchorY;
    return (
      this.touchLocal.x >= left &&
      this.touchLocal.x <= left + w &&
      this.touchLocal.y >= bottom &&
      this.touchLocal.y <= bottom + h
    );
  }

  private refreshOpponents() {
    if (!this.oppHost) return;
    const pub = session.matchView?.public;
    const ids = pub?.seatOrder ?? session.room?.playerIds ?? [];
    const me = session.playerId;
    const n = ids.length;
    const peeks = session.matchView?.visibleHands ?? {};
    const sig = ids
      .map((id) => `${id}:${(peeks[id] ?? []).map((c) => c.id).join(",")}`)
      .join("|");
    if (sig === this.lastOppSig) return;
    this.lastOppSig = sig;
    this.oppHost.removeAllChildren();
    const { w, h } = PEEK_CARD;
    ids.forEach((id, seat) => {
      if (id === me) return;
      const peek = session.matchView?.visibleHands?.[id];
      if (!peek?.length) return;
      const animal = seatAnimalId(seat, n);
      const chair = TABLE_CHAIRS.find((c) => c.id === animal);
      if (!chair) return;
      const slots = layoutRankedHand(peek, w, h, PEEK_MAX_WIDTH, PEEK_STACK_Y);
      if (!slots.length) return;
      const origin = this.peekOrigin(chair, slots, w, h);
      for (const slot of slots) {
        makeFaceCard(
          this.oppHost!,
          `peek-${id}-${slot.card.id}`,
          slot.card,
          origin.x + slot.x,
          origin.y + slot.hitY,
          w,
          h,
          false,
          slot.hitH,
          slot.visualOffsetY,
        );
      }
    });
  }

  /** 熊猫/兔子/猫头鹰：名牌正下方。狐狸：立绘右侧紧挨。 */
  private peekOrigin(
    chair: (typeof TABLE_CHAIRS)[number],
    slots: { x: number; hitY: number; visualOffsetY: number }[],
    w: number,
    h: number,
  ): { x: number; y: number } {
    let top = -Infinity;
    let bot = Infinity;
    let left = Infinity;
    for (const s of slots) {
      const cy = s.hitY + s.visualOffsetY;
      top = Math.max(top, cy + h / 2);
      bot = Math.min(bot, cy - h / 2);
      left = Math.min(left, s.x - w / 2);
    }
    if (chair.id === "fox") {
      return {
        x: FOX_ART_RIGHT + PEEK_GAP - left,
        y: FOX_ART_MID_Y - (top + bot) / 2,
      };
    }
    const plateBottom = chair.y - NAMEPLATE_H / 2;
    const x = chair.id === "rabbit" ? chair.x + RABBIT_CARD_NUDGE_X : chair.x;
    return { x, y: plateBottom - PEEK_GAP - top };
  }

  private ensureItemDock() {
    if (!this.itemHost) this.itemHost = this.host("ItemHost");
    this.itemHost.setPosition(ITEM_DOCK.x, ITEM_DOCK.y, 0);
    let rootUt = this.itemHost.getComponent(UITransform);
    if (!rootUt) rootUt = this.itemHost.addComponent(UITransform);
    rootUt.setContentSize(ITEM_VIEW.w, ITEM_VIEW.h);

    for (const child of [...this.itemHost.children]) {
      if (child.name !== "view") child.destroy();
    }

    let view = this.itemHost.getChildByName("view");
    if (!view) {
      view = new Node("view");
      view.layer = this.itemHost.layer;
      this.itemHost.addChild(view);
      view.addComponent(UITransform).setContentSize(ITEM_VIEW.w, ITEM_VIEW.h);
      view.setPosition(0, 0, 0);
      const mask = view.addComponent(Mask);
      mask.type = Mask.Type.GRAPHICS_RECT;
    } else {
      view.getComponent(UITransform)?.setContentSize(ITEM_VIEW.w, ITEM_VIEW.h);
    }

    let content = view.getChildByName("content");
    if (!content) {
      content = new Node("content");
      content.layer = view.layer;
      view.addChild(content);
      const cut = content.addComponent(UITransform);
      cut.setAnchorPoint(0.5, 1);
      cut.setContentSize(ITEM_VIEW.w, ITEM_VIEW.h);
      content.setPosition(0, ITEM_VIEW.h / 2, 0);
    }

    let sv = this.itemHost.getComponent(ScrollView);
    if (!sv) sv = this.itemHost.addComponent(ScrollView);
    sv.horizontal = false;
    sv.vertical = true;
    sv.inertia = true;
    sv.brake = 0.75;
    sv.elastic = true;
    sv.cancelInnerEvents = true;
    sv.content = content;
    this.itemScroll = sv;
    this.itemContent = content;
  }

  private refreshItems() {
    if (!this.itemContent) this.ensureItemDock();
    if (!this.itemContent) return;
    const items = skillBarItems(session.matchView?.items ?? []);
    const pub = session.matchView?.public;
    const key = items
      .map((item) => {
        const ready = itemLooksReady(item, pub, session.playerId);
        return `${item.id}:${item.remainingUses}:${ready ? 1 : 0}`;
      })
      .join("|");
    if (key === this.lastItemDockKey && this.itemContent.children.length === items.length) return;
    this.lastItemDockKey = key;

    const keepY = this.itemContent.position.y;
    this.itemContent.removeAllChildren();
    const cellH = ITEM_CELL.h;
    const step = ITEM_CELL_STEP;
    const topPad = ITEM_LIST_TOP_PAD;
    const contentH = Math.max(ITEM_VIEW.h, topPad + cellH + Math.max(0, items.length - 1) * step);
    const cut = this.itemContent.getComponent(UITransform);
    if (cut) cut.setContentSize(ITEM_VIEW.w, contentH);

    items.forEach((item, i) => {
      const ready = itemLooksReady(item, pub, session.playerId);
      const y = -topPad - cellH / 2 - i * step;
      this.makeItemCell(this.itemContent!, item, 0, y, ready);
    });

    if (this.itemScroll) {
      this.itemScroll.vertical = contentH > ITEM_VIEW.h + 1;
      const maxY = ITEM_VIEW.h / 2;
      const minY = ITEM_VIEW.h / 2 - (contentH - ITEM_VIEW.h);
      const y = Math.min(maxY, Math.max(minY, keepY));
      this.itemContent.setPosition(0, y, 0);
    }
  }

  private makeItemCell(parent: Node, item: MatchItemView, x: number, y: number, ready: boolean): void {
    const w = ITEM_CELL.w;
    const h = ITEM_CELL.h;
    const n = new Node(`item-${item.id}`);
    n.layer = parent.layer;
    parent.addChild(n);
    n.setPosition(x, y, 0);
    n.addComponent(UITransform).setContentSize(w, h);

    const ink = rarityInk(item.rarity);
    const g = n.addComponent(Graphics);
    const hw = w / 2;
    const hh = h / 2;
    const lw = ready ? 6 : 5;
    const artX = 0;
    const artY = hh - lw - ITEM_ART / 2;
    const nameH = 28;
    const nameY0 = artY - ITEM_ART / 2 - 7 - nameH / 2;
    const nameY = nameY0 + 10;
    const textGap = 3;
    const innerTop = artY + ITEM_ART / 2 + 3;
    const innerBottom = nameY0 - nameH / 2 - textGap + 17;
    const innerLeft = -hw + lw;
    const innerRight = hw - lw;
    const pathX = innerLeft - lw / 2;
    const pathY = innerBottom - lw / 2;
    const pathW = innerRight + lw / 2 - pathX;
    const pathH = innerTop + lw / 2 - pathY;
    g.fillColor = ready ? new Color(36, 24, 16, 230) : new Color(28, 22, 16, 160);
    g.roundRect(pathX, pathY, pathW, pathH, 8);
    g.fill();
    g.strokeColor = ready ? ink : new Color(ink.r, ink.g, ink.b, 90);
    g.lineWidth = lw;
    g.roundRect(pathX, pathY, pathW, pathH, 8);
    g.stroke();

    const art = new Node("art");
    art.layer = n.layer;
    n.addChild(art);
    art.setPosition(artX, artY, 0);
    art.addComponent(UITransform).setContentSize(ITEM_ART, ITEM_ART);
    const fill = art.addComponent(Graphics);
    const ah = ITEM_ART / 2;
    fill.fillColor = new Color(24, 16, 10, 220);
    fill.roundRect(-ah, -ah, ITEM_ART, ITEM_ART, 8);
    fill.fill();
    const img = new Node("sprite");
    img.layer = art.layer;
    art.addChild(img);
    img.addComponent(UITransform).setContentSize(ITEM_ART, ITEM_ART);
    const sp = img.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.type = Sprite.Type.SIMPLE;
    const token = item.id;
    void loadUiSpriteFrame(`item-${item.id}`).then((sf) => {
      if (!sp.isValid || token !== item.id) return;
      if (sf) {
        sp.spriteFrame = sf;
        fill.clear();
      }
    });

    if (isPassiveSkill(item)) {
      const badgeH = 18;
      const badge = new Node("passive");
      badge.layer = art.layer;
      art.addChild(badge);
      badge.setPosition(0, -ah + badgeH / 2, 0);
      badge.addComponent(UITransform).setContentSize(ITEM_ART, badgeH);
      const bar = badge.addComponent(Graphics);
      bar.fillColor = new Color(12, 8, 4, 210);
      bar.rect(-ah, -badgeH / 2, ITEM_ART, badgeH);
      bar.fill();
      const mark = this.makeLabel(badge, "cap", "被动", 0, 0, 14, GOLD, ITEM_ART, badgeH);
      mark.isBold = true;
      mark.enableOutline = true;
      mark.outlineColor = new Color(18, 12, 6, 230);
      mark.outlineWidth = 2;
    }

    const uses = item.remainingUses > 1 ? `×${item.remainingUses}` : "";
    const name = this.makeLabel(n, "name", `${item.name}${uses}`, 0, nameY, 16, ready ? CREAM : MUTED, w - 8, nameH);
    name.overflow = Label.Overflow.SHRINK;

    const btn = n.addComponent(Button);
    btn.transition = Button.Transition.NONE;
    this.bindTap(btn, () => {
      const pending = session.matchView?.public?.pending;
      const offer =
        pending?.kind === "offer_item" &&
        pending.itemId === item.id &&
        pending.playerId === session.playerId;
      this.showItemInfo(item, !!offer);
    }, true);
  }

  private refreshPendingActions() {
    if (!this.pendingHost) return;
    this.pendingHost.removeAllChildren();
    if (this.selfAutoPlaying(session.matchView?.public)) {
      this.pendingHost.active = false;
      return;
    }
    this.pendingHost.active = true;
    const pending = session.matchView?.public?.pending;
    if (pending?.kind === "afk_host") {
      this.pendingHost.active = false;
      return;
    }
    const me = session.playerId;
    const buttons: Array<{ name: string; text: string; fn: () => void }> = [];

    if (this.pickMode.kind === "control" && !(this.itemInfoRoot?.active && this.itemInfoOfferMode)) {
      const who = this.animalNameForPlayer(this.pendingLeaderId());
      const whoBit = who ? who : "";
      buttons.push({
        name: "ctrl-single",
        text: whoBit ? `强制${whoBit}单张` : "强制单张",
        fn: () => {
          this.sendIntent({
            type: "use_item",
            itemId: "epic_control",
            payload: { forcedType: "single" },
          });
          this.pickMode = { kind: "none" };
        },
      });
      buttons.push({
        name: "ctrl-pair",
        text: whoBit ? `强制${whoBit}对子` : "强制对子",
        fn: () => {
          this.sendIntent({
            type: "use_item",
            itemId: "epic_control",
            payload: { forcedType: "pair" },
          });
          this.pickMode = { kind: "none" };
        },
      });
      buttons.push({
        name: "ctrl-cancel",
        text: "取消",
        fn: () => {
          this.pickMode = { kind: "none" };
          this.refresh();
        },
      });
    } else if (pending?.kind === "force_trade" && pending.playerId === me) {
      this.pendingHost.setPosition(ACTION_BTNS.playX, ACTION_BTNS.y, 0);
      const selectedId = this.selected.size === 1 ? [...this.selected][0] : undefined;
      buttons.push({
        name: "force-return",
        text: selectedId ? "交还这张" : "请先选一张牌",
        fn: () => {
          const id = this.selected.size === 1 ? [...this.selected][0] : undefined;
          if (!id) return;
          this.sendIntent({
            type: "use_item",
            itemId: "legendary_force_trade",
            payload: { cardId: id },
          });
        },
      });
    } else if (pending?.kind === "swap_hands" && pending.playerId === me) {
      buttons.push({
        name: "swap-skip",
        text: "不换",
        fn: () => this.sendIntent({ type: "resolve_swap", targetId: null }),
      });
      for (const id of this.tablePlayerIds()) {
        if (id === me) continue;
        const who = this.animalNameForPlayer(id);
        if (!who) continue;
        buttons.push({
          name: `swap-${id}`,
          text: `与${who}换`,
          fn: () => this.sendIntent({ type: "resolve_swap", targetId: id }),
        });
      }
    } else if (this.isRpsPicker(pending, me)) {
      for (const choice of ["rock", "paper", "scissors"] as const) {
        buttons.push({
          name: `ans-${choice}`,
          text: rpsCn(choice),
          fn: () => this.sendIntent({ type: "resolve_rps", choice }),
        });
      }
    } else if (pending?.kind === "score_double" && !pending.choices?.[me]) {
      buttons.push({
        name: "dbl-none",
        text: "不加倍",
        fn: () => this.sendIntent({ type: "resolve_double", choice: "none" }),
      });
      buttons.push({
        name: "dbl-double",
        text: "加倍",
        fn: () => this.sendIntent({ type: "resolve_double", choice: "double" }),
      });
      buttons.push({
        name: "dbl-super",
        text: "超级加倍",
        fn: () => this.sendIntent({ type: "resolve_double", choice: "super" }),
      });
    }

    if (!buttons.length) {
      if (this.pendingHost) this.pendingHost.setPosition(0, 10, 0);
      return;
    }
    if (!(pending?.kind === "force_trade" && pending.playerId === me)) {
      this.pendingHost.setPosition(0, pending?.kind === "score_double" ? -10 : 10, 0);
    }
    const step = Math.min(240, 1600 / buttons.length);
    const start = -((buttons.length - 1) * step) / 2;
    buttons.forEach((b, i) => {
      const btn = this.makeButton(this.pendingHost!, b.name, b.text, start + i * step, 0, 220, 88);
      this.bindTap(btn, b.fn);
    });
  }

  private syncFinishCelebration(pub: MatchPublicView | undefined, finished: boolean): boolean {
    if (!finished) {
      if (this.finishCelebKey) {
        this.finishCelebKey = "";
        this.finishCelebUntil = 0;
        this.unschedule(this.endFinishCelebration);
        this.hideWinBanner();
      }
      return false;
    }
    const key =
      (pub?.ranking ?? []).map((r) => `${r.playerId}:${r.rank}`).join(",") ||
      session.lastSettlement?.map((d) => `${d.playerId}:${d.rank}`).join(",") ||
      "finished";
    if (this.finishCelebKey !== key) {
      this.finishCelebKey = key;
      this.finishCelebUntil = Date.now() + WIN_BANNER_MS;
      this.unschedule(this.endFinishCelebration);
      this.scheduleOnce(this.endFinishCelebration, WIN_BANNER_MS / 1000);
    }
    return Date.now() < this.finishCelebUntil;
  }

  private endFinishCelebration = () => {
    if (!this.finishCelebUntil) return;
    this.finishCelebUntil = 0;
    this.hideWinBanner();
    if (this.node?.isValid) this.refresh();
  };

  private hideWinBanner() {
    if (!this.node?.isValid) {
      this.winBanner = null;
      return;
    }
    const leftover = this.winBanner ?? this.node.getChildByName("WinBanner");
    if (leftover?.isValid) leftover.active = false;
    this.winBanner = leftover;
  }

  private openSettle() {
    if (this.node.getComponent(SettleRoom)) return;
    this.hideWinBanner();
    if (this.phaseBar) this.phaseBar.active = false;
    this.node.addComponent(SettleRoom);
  }

  private winnerNames(pub: MatchPublicView | undefined): string[] {
    const ids = pub?.seatOrder ?? session.room?.playerIds ?? [];
    const n = ids.length;
    const ranking =
      pub?.ranking?.length
        ? pub.ranking
        : (session.lastSettlement ?? []).map((d) => ({ playerId: d.playerId, rank: d.rank }));
    const winnerIds = ranking
      .filter((r) => r.rank === 1 || (n >= 4 && r.rank === 2))
      .map((r) => r.playerId);
    return winnerIds.map((id) => {
      const seat = ids.indexOf(id);
      return seat >= 0 ? seatAnimalNameById(seatAnimalId(seat, n)) : session.playerName(id);
    });
  }

  private refreshSettle() {
    this.ensureSettleChrome();
    const deltas = session.lastSettlement;
    const ranking = session.matchView?.public?.ranking ?? [];
    const me = session.playerId;
    const mine = deltas?.find((d) => d.playerId === me);
    const myRank = mine?.rank ?? ranking.find((r) => r.playerId === me)?.rank;

    if (this.settleTitle) this.settleTitle.string = "本局结束";

    if (this.settleMine) {
      if (mine) {
        const sign = mine.delta > 0 ? "+" : "";
        this.settleMine.string = `你  第${mine.rank}名   ${sign}${mine.delta}\n积分  ${mine.scoreAfter}`;
        this.settleMine.color = mine.delta > 0 ? WIN : LOSE;
      } else if (myRank) {
        this.settleMine.string = `你  第${myRank}名`;
        this.settleMine.color = GOLD;
      } else {
        this.settleMine.string = "等待结算…";
        this.settleMine.color = WHITE;
      }
    }

    const others: string[] = [];
    if (deltas?.length) {
      for (const d of deltas) {
        if (d.playerId === me) continue;
        const sign = d.delta > 0 ? "+" : "";
        others.push(
          `第${d.rank}名  ${session.playerName(d.playerId)}  ${sign}${d.delta}  →  ${d.scoreAfter}`,
        );
      }
    } else {
      for (const r of ranking) {
        if (r.playerId === me) continue;
        others.push(`第${r.rank}名  ${session.playerName(r.playerId)}`);
      }
    }
    const listText = others.length ? others.join("\n") : "";
    if (this.settleList) this.settleList.string = listText;
    if (this.settleLabel && this.settleLabel !== this.settleList) {
      this.settleLabel.node.active = false;
    }
  }

  private ensureClock() {
    if (!this.clockHost) this.clockHost = this.host("ClockHost");
    if (this.clockLabel) return;
    const made = makeTurnClock(this.clockHost, "TurnClock", 0, 0);
    this.clockLabel = made.label;
    this.clockHost.active = false;
  }

  private ensureSettleChrome() {
    const panel = this.panelSettle;
    if (!panel) return;

    let dim = panel.getChildByName("SettleDim");
    if (!dim) {
      dim = new Node("SettleDim");
      dim.layer = panel.layer;
      panel.insertChild(dim, 0);
      dim.addComponent(UITransform).setContentSize(1920, 1080);
      const g = dim.addComponent(Graphics);
      g.fillColor = new Color(8, 12, 18, 210);
      g.rect(-960, -540, 1920, 1080);
      g.fill();
    }

    let card = panel.getChildByName("SettleCard");
    if (!card) {
      card = new Node("SettleCard");
      card.layer = panel.layer;
      panel.addChild(card);
      card.setPosition(0, 40, 0);
      card.addComponent(UITransform).setContentSize(760, 520);
      const g = card.addComponent(Graphics);
      g.fillColor = new Color(28, 36, 46, 245);
      g.roundRect(-380, -260, 760, 520, 24);
      g.fill();
      g.strokeColor = GOLD;
      g.lineWidth = 3;
      g.roundRect(-380, -260, 760, 520, 24);
      g.stroke();
    }

    if (!this.settleTitle) {
      this.settleTitle = this.makeLabel(panel, "SettleTitle", "本局结束", 0, 230, 44, GOLD, 640, 56);
    }
    if (!this.settleMine) {
      this.settleMine = this.makeLabel(panel, "SettleMine", "", 0, 80, 40, WHITE, 680, 120);
      this.settleMine.overflow = Label.Overflow.RESIZE_HEIGHT;
      this.settleMine.enableWrapText = true;
    }
    if (!this.settleList) {
      this.settleList = this.makeLabel(panel, "SettleList", "", 0, -80, 26, MUTED, 680, 180);
      this.settleList.overflow = Label.Overflow.RESIZE_HEIGHT;
      this.settleList.enableWrapText = true;
    }
  }

  private refreshClockFace() {
    if (!this.clockHost || !this.clockLabel) return;
    const pub = session.matchView?.public;
    const finished = !!session.lastSettlement || pub?.phase === "finished";
    if (finished || pub?.phase !== "playing") {
      this.clockHost.active = false;
      return;
    }
    const until = clockUntilMs(pub);
    const owner = clockOwnerId(pub);
    if (until == null) {
      this.clockHost.active = false;
      return;
    }
    const sec = Math.max(0, (until - Date.now()) / 1000);
    const shown = Math.ceil(sec);
    this.clockLabel.string = String(shown);
    this.clockLabel.color = shown <= 5 ? CLOCK_URGENT : GOLD;
    const bg = this.clockHost.getChildByName("TurnClock")?.getChildByName("bg")?.getComponent(Graphics);
    if (bg) {
      const size = 76;
      const r = size / 2 - 2;
      bg.clear();
      bg.fillColor = new Color(20, 28, 36, 235);
      bg.circle(0, 0, r);
      bg.fill();
      bg.strokeColor = shown <= 5 ? CLOCK_URGENT : GOLD;
      bg.lineWidth = 4;
      bg.circle(0, 0, r);
      bg.stroke();
    }

    const ids = pub?.seatOrder ?? session.room?.playerIds ?? [];
    const n = ids.length || 1;
    const seat = owner ? ids.indexOf(owner) : -1;
    const chair = seat >= 0 ? TABLE_CHAIRS.find((c) => c.id === seatAnimalId(seat, n)) : null;
    const pos = chair ? { x: chair.x, y: chair.y + CLOCK_ABOVE } : { x: 0, y: 80 };
    this.clockHost.setPosition(pos.x, pos.y, 0);
    this.clockHost.active = true;
  }

  private toggleCard(id: string) {
    this.playRejectUntil = 0;
    const on = !this.selected.has(id);
    if (on) this.selected.add(id);
    else this.selected.delete(id);
    playCardSelectSfx(on);
    this.refresh();
  }

  private pruneSelection() {
    const ids = new Set((session.matchView?.hand ?? []).map((c) => c.id));
    for (const id of [...this.selected]) {
      if (!ids.has(id)) this.selected.delete(id);
    }
  }

  private onPlay() {
    const cardIds = [...this.selected];
    const pub = session.matchView?.public;
    if (pub?.phase !== "playing") {
      session.lastError = "还没开始打牌";
      this.refresh();
      return;
    }
    if (pub.pending) {
      session.lastError = "先处理技能窗口，或等倒计时结束";
      this.refresh();
      return;
    }
    if (pub.turnPlayerId !== session.playerId) {
      session.lastError = pub.turnPlayerId
        ? `还没轮到你，当前是${this.actorWord(pub.turnPlayerId)}`
        : "还没轮到你";
      this.refresh();
      return;
    }
    if (!cardIds.length) {
      session.lastError = "先选手牌（点选或滑动，选中后会变暗）";
      this.refresh();
      return;
    }
    this.sendIntent({ type: "play", cardIds });
  }

  private rejectIllegalPlay() {
    this.selected.clear();
    this.playRejectUntil = Date.now() + PLAY_REJECT_MS;
    session.lastError = "";
    this.awaitingItemUse = false;
    this.refresh();
  }

  private onPass() {
    const pub = session.matchView?.public;
    if (pub?.phase !== "playing") {
      session.lastError = "还没开始打牌";
      this.refresh();
      return;
    }
    if (pub.pending) {
      session.lastError = "先处理技能窗口，或等倒计时结束";
      this.refresh();
      return;
    }
    if (pub.turnPlayerId !== session.playerId) {
      session.lastError = "还没轮到你，不能过牌";
      this.refresh();
      return;
    }
    if (isMyControlledLead(pub, session.playerId)) {
      this.sendIntent({ type: "yield_lead" });
      return;
    }
    if (pub.freeLead) {
      session.lastError = "领出时不能过牌，必须出牌";
      this.refresh();
      return;
    }
    this.sendIntent({ type: "pass" });
  }

  private syncItemOfferPopup() {
    if (this.selfAutoPlaying(session.matchView?.public)) {
      this.awaitingItemUse = false;
      this.closeItemInfo(false);
      return;
    }
    const pending = session.matchView?.public?.pending;
    this.syncSkillChoiceState();
    if (pending?.kind === "offer_item" && pending.playerId === session.playerId && pending.itemId) {
      if (this.awaitingItemUse && this.itemInfoShown?.id === pending.itemId) return;
      const item =
        session.matchView?.items.find((i) => i.id === pending.itemId) ??
        ({
          id: pending.itemId,
          name: pending.itemId,
          remainingUses: 1,
          rarity: "rare",
          description: "",
        } as MatchItemView);
      this.itemInfoOfferMode = true;
      if (!this.itemInfoRoot?.active || this.itemInfoShown?.id !== item.id) {
        this.showItemInfo(item, true);
      }
      return;
    }
    this.awaitingItemUse = false;
    if (this.itemInfoOfferMode || pending?.kind === "force_trade") {
      this.closeItemInfo(false);
    }
  }

  /** 当前询问换成下一个技能时，清掉上一个技能的选目标/选牌型状态，避免两套界面叠在一起 */
  private syncSkillChoiceState() {
    const pending = session.matchView?.public?.pending;
    const me = session.playerId;
    const offerId =
      pending?.kind === "offer_item" && pending.playerId === me ? pending.itemId ?? null : null;

    if (this.pickMode.kind === "target" && this.pickMode.itemId !== offerId) {
      this.pickMode = { kind: "none" };
      this.clearItemTargetChoices();
    }
    if (this.pickMode.kind === "control" && offerId !== "epic_control") {
      this.pickMode = { kind: "none" };
      this.clearItemTargetChoices();
    }
    if (this.awaitingItemUse && this.itemInfoShown?.id !== offerId) {
      this.awaitingItemUse = false;
    }
  }

  private clearItemTargetChoices() {
    this.itemInfoTargetHost?.removeAllChildren();
    this.lastTargetChoiceKey = "";
  }

  private showItemInfo(item: MatchItemView, offer = false) {
    if (this.itemInfoShown?.id !== item.id) {
      this.clearItemTargetChoices();
      if (this.pickMode.kind === "target" && this.pickMode.itemId !== item.id) {
        this.pickMode = { kind: "none" };
      }
      if (this.pickMode.kind === "control" && item.id !== "epic_control") {
        this.pickMode = { kind: "none" };
      }
    }
    this.ensureItemInfo();
    this.itemInfoOfferMode = offer;
    this.itemInfoShown = item;
    if (this.itemInfoRoot) {
      this.itemInfoRoot.active = true;
      this.itemInfoRoot.setSiblingIndex(this.node.children.length - 1);
    }
    this.refreshItemInfo();
  }

  private closeItemInfo(declineOffer = true) {
    const shouldDecline =
      declineOffer &&
      this.itemInfoOfferMode &&
      !this.awaitingItemUse &&
      session.matchView?.public?.pending?.kind === "offer_item" &&
      session.matchView.public.pending.playerId === session.playerId;
    this.itemInfoOfferMode = false;
    this.itemInfoShown = null;
    this.clearItemTargetChoices();
    if (this.pickMode.kind === "target" || this.pickMode.kind === "control") {
      this.pickMode = { kind: "none" };
    }
    if (this.itemInfoRoot) this.itemInfoRoot.active = false;
    if (shouldDecline) this.sendIntent({ type: "decline_item_offer" });
  }

  private ensureItemInfo() {
    const existing = this.itemInfoRoot?.getChildByName("panel")?.getComponent(UITransform);
    if (
      this.itemInfoRoot?.isValid &&
      existing &&
      existing.contentSize.width === ITEM_INFO.w &&
      existing.contentSize.height === ITEM_INFO.h
    ) {
      const panel = this.itemInfoRoot.getChildByName("panel");
      this.ensureItemInfoTimer(panel);
      this.layoutItemInfoText();
      return;
    }
    this.itemInfoRoot?.destroy();
    this.itemInfoRoot = null;
    this.itemInfoArt = null;
    this.itemInfoArtFill = null;
    this.itemInfoBgSprite = null;
    this.lastItemInfoBgKey = "";
    this.itemInfoName = null;
    this.itemInfoStatus = null;
    this.itemInfoDesc = null;
    this.itemInfoUse = null;
    this.itemInfoSkip = null;
    this.itemInfoTimer = null;
    this.itemInfoTargetHost = null;

    const { w, h } = this.canvasSize();
    const overlay = new Node("PanelItemInfo");
    overlay.layer = this.node.layer;
    this.node.addChild(overlay);
    overlay.addComponent(UITransform).setContentSize(w, h);
    overlay.addComponent(BlockInputEvents);
    overlay.active = false;
    this.itemInfoRoot = overlay;

    const dimmer = new Node("dimmer");
    dimmer.layer = overlay.layer;
    overlay.addChild(dimmer);
    dimmer.addComponent(UITransform).setContentSize(w, h);
    const dim = dimmer.addComponent(Graphics);
    dim.fillColor = new Color(8, 4, 2, 170);
    dim.rect(-w / 2, -h / 2, w, h);
    dim.fill();
    const dimBtn = dimmer.addComponent(Button);
    dimBtn.transition = Button.Transition.NONE;
    this.bindTap(dimBtn, () => this.closeItemInfo(), true, false);

    const pw = ITEM_INFO.w;
    const ph = ITEM_INFO.h;
    const panel = new Node("panel");
    panel.layer = overlay.layer;
    overlay.addChild(panel);
    panel.addComponent(UITransform).setContentSize(pw, ph);
    panel.addComponent(BlockInputEvents);
    panel.addComponent(Graphics);
    this.paintItemInfoFrame("");
    this.buildItemInfoBg(panel);

    const close = new Node("BtnClose");
    close.layer = panel.layer;
    panel.addChild(close);
    close.setPosition(pw / 2 - 36, ph / 2 - 36, 0);
    close.addComponent(UITransform).setContentSize(56, 56);
    const cg = close.addComponent(Graphics);
    cg.fillColor = new Color(92, 28, 22, 255);
    cg.circle(0, 0, 24);
    cg.fill();
    cg.strokeColor = GOLD;
    cg.lineWidth = 2;
    cg.circle(0, 0, 24);
    cg.stroke();
    const closeLab = this.makeLabel(close, "x", "×", 0, 2, 36, CREAM, 56, 56);
    closeLab.isBold = true;
    const closeBtn = close.addComponent(Button);
    closeBtn.transition = Button.Transition.NONE;
    this.bindTap(closeBtn, () => this.closeItemInfo(), true);

    const artSize = 340;
    const art = new Node("art");
    art.layer = panel.layer;
    panel.addChild(art);
    art.setPosition(-200, 8, 0);
    art.addComponent(UITransform).setContentSize(artSize, artSize);
    const fill = art.addComponent(Graphics);
    fill.fillColor = new Color(24, 16, 10, 220);
    fill.roundRect(-artSize / 2, -artSize / 2, artSize, artSize, 16);
    fill.fill();
    this.itemInfoArtFill = fill;
    const img = new Node("sprite");
    img.layer = art.layer;
    art.addChild(img);
    img.addComponent(UITransform).setContentSize(artSize, artSize);
    const sp = img.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.type = Sprite.Type.SIMPLE;
    this.itemInfoArt = sp;

    this.itemInfoName = this.makeLabel(panel, "name", "", 175, 148, 32, GOLD, 310, 44);
    this.itemInfoName.isBold = true;
    this.itemInfoName.horizontalAlign = Label.HorizontalAlign.LEFT;
    this.itemInfoName.enableOutline = true;
    this.itemInfoName.outlineColor = INK;
    this.itemInfoName.outlineWidth = 2;
    this.itemInfoStatus = this.makeLabel(panel, "status", "", 175, 108, 22, MUTED, 310, 32);
    this.itemInfoStatus.horizontalAlign = Label.HorizontalAlign.LEFT;
    this.itemInfoStatus.enableOutline = true;
    this.itemInfoStatus.outlineColor = INK;
    this.itemInfoStatus.outlineWidth = 2;
    this.itemInfoDesc = this.makeLabel(panel, "desc", "", 175, 8, 24, CREAM, 310, 168);
    this.itemInfoDesc.overflow = Label.Overflow.SHRINK;
    this.itemInfoDesc.enableWrapText = true;
    this.itemInfoDesc.horizontalAlign = Label.HorizontalAlign.LEFT;
    this.itemInfoDesc.verticalAlign = Label.VerticalAlign.TOP;
    this.itemInfoDesc.lineHeight = 34;
    this.itemInfoDesc.enableOutline = true;
    this.itemInfoDesc.outlineColor = INK;
    this.itemInfoDesc.outlineWidth = 2;
    this.ensureItemInfoTimer(panel);
    this.layoutItemInfoText();

    this.itemInfoUse = this.makeButton(panel, "BtnUse", "使用", 90, -175, 180, 64);
    this.bindTap(this.itemInfoUse, () => {
      const shown = this.itemInfoShown;
      if (!shown) return;
      this.activateItem(shown);
    }, true);
    this.itemInfoSkip = this.makeButton(panel, "BtnSkip", "不使用", 300, -175, 180, 64);
    this.bindTap(this.itemInfoSkip, () => this.closeItemInfo(true), true);

    const targets = new Node("TargetChoices");
    targets.layer = panel.layer;
    panel.addChild(targets);
    targets.setPosition(200, -175, 0);
    this.itemInfoTargetHost = targets;
  }

  private refreshItemInfo() {
    if (!this.itemInfoRoot?.active || !this.itemInfoShown) return;
    const live = session.matchView?.items.find((i) => i.id === this.itemInfoShown!.id);
    if (!live) {
      this.closeItemInfo(false);
      return;
    }
    this.itemInfoShown = live;
    const ink = rarityInk(live.rarity);
    if (this.itemInfoName) {
      this.itemInfoName.string = live.name;
      this.itemInfoName.color = ink;
    }
    const pub = session.matchView?.public;
    const offer =
      this.itemInfoOfferMode &&
      pub?.pending?.kind === "offer_item" &&
      pub.pending.playerId === session.playerId &&
      pub.pending.itemId === live.id;
    const status = activeItemUseStatus(live);
    if (this.itemInfoStatus) {
      const text = offer && !status.used ? "" : status.text;
      this.itemInfoStatus.string = text;
      this.itemInfoStatus.color = status.used ? MUTED : GOLD;
      this.itemInfoStatus.node.active = !!text;
    }
    if (this.itemInfoDesc) {
      this.itemInfoDesc.string = live.description?.trim() || "暂无技能说明";
    }
    this.paintItemInfoFrame(live.rarity);
    this.paintItemInfoBg(live.rarity);
    const token = live.id;
    if (this.itemInfoArt) {
      const sp = this.itemInfoArt;
      void loadUiSpriteFrame(`item-${live.id}`).then((sf) => {
        if (!sp.isValid || token !== this.itemInfoShown?.id) return;
        sp.spriteFrame = sf ?? null;
        if (sf && this.itemInfoArtFill) this.itemInfoArtFill.clear();
      });
    }
    this.refreshItemTargetChoices(live, !!offer);
    this.refreshItemInfoTimer();
  }

  private ensureItemInfoTimer(panel: Node | null) {
    if (this.itemInfoTimer?.isValid) return;
    if (!panel) return;
    const existing = panel.getChildByName("timer")?.getComponent(Label);
    if (existing) {
      this.itemInfoTimer = existing;
      return;
    }
    this.itemInfoTimer = this.makeLabel(panel, "timer", "", 175, -118, 24, GOLD, 310, 36);
    this.itemInfoTimer.isBold = true;
    this.itemInfoTimer.horizontalAlign = Label.HorizontalAlign.LEFT;
    this.itemInfoTimer.enableOutline = true;
    this.itemInfoTimer.outlineColor = INK;
    this.itemInfoTimer.outlineWidth = 2;
  }

  private layoutItemInfoText() {
    const place = (lab: Label | null, x: number, y: number, w: number, h: number) => {
      if (!lab?.isValid) return;
      lab.node.setPosition(x, y, 0);
      lab.node.getComponent(UITransform)?.setContentSize(w, h);
    };
    place(this.itemInfoName, 175, 148, 310, 44);
    place(this.itemInfoStatus, 175, 108, 310, 32);
    place(this.itemInfoDesc, 175, 8, 310, 168);
    place(this.itemInfoTimer, 175, -118, 310, 36);
  }

  private itemInfoBgKey(rarity: string): string {
    if (rarity === "legendary") return "auction-desc-legendary";
    if (rarity === "epic") return "auction-desc-epic";
    if (rarity === "rare") return "auction-desc-rare";
    return "";
  }

  private paintItemInfoFrame(rarity: string) {
    const panel = this.itemInfoRoot?.getChildByName("panel");
    const g = panel?.getComponent(Graphics);
    if (!panel || !g) return;
    const w = ITEM_INFO.w;
    const h = ITEM_INFO.h;
    const hw = w / 2;
    const hh = h / 2;
    const lw = ITEM_INFO.stroke;
    const inset = lw / 2;
    const ink = rarity ? rarityInk(rarity) : new Color(228, 184, 88, 255);
    g.clear();
    g.fillColor = new Color(72, 44, 24, 200);
    g.roundRect(-hw, -hh, w, h, ITEM_INFO.radius);
    g.fill();
    g.strokeColor = new Color(ink.r, ink.g, ink.b, 255);
    g.lineWidth = lw;
    g.roundRect(-hw + inset, -hh + inset, w - lw, h - lw, ITEM_INFO.radius);
    g.stroke();
  }

  private buildItemInfoBg(parent: Node) {
    const w = ITEM_INFO.w - ITEM_INFO.inset * 2;
    const h = ITEM_INFO.h - ITEM_INFO.inset * 2;
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
    stencil.roundRect(-w / 2, -h / 2, w, h, Math.max(8, ITEM_INFO.radius - 4));
    stencil.fill();

    const img = new Node("img");
    img.layer = maskN.layer;
    maskN.addChild(img);
    img.addComponent(UITransform).setContentSize(w, h);
    const sp = img.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.type = Sprite.Type.SIMPLE;
    sp.spriteFrame = null;
    this.itemInfoBgSprite = sp;
  }

  private paintItemInfoBg(rarity: string) {
    const key = this.itemInfoBgKey(rarity);
    if (key === this.lastItemInfoBgKey) return;
    this.lastItemInfoBgKey = key;
    if (!this.itemInfoBgSprite) return;
    this.itemInfoBgSprite.spriteFrame = null;
    if (!key) return;
    const token = key;
    clearUiSpriteCache(key);
    void loadUiSpriteFrame(key).then((sf) => {
      if (!this.itemInfoBgSprite?.isValid || this.lastItemInfoBgKey !== token) return;
      this.itemInfoBgSprite.spriteFrame = sf;
    });
  }

  private skillRemainLeft(until: number | undefined): number | null {
    if (until == null || !Number.isFinite(until)) return null;
    return Math.max(0, Math.ceil((until - Date.now()) / 1000));
  }

  private applySkillRemainLabel(lab: Label | null, until: number | undefined, show: boolean) {
    if (!lab) return;
    lab.node.active = show;
    if (!show) {
      lab.string = "";
      return;
    }
    const left = this.skillRemainLeft(until) ?? 0;
    lab.string = `思考剩余 ${left}秒`;
    lab.color = left <= 3 ? CLOCK_URGENT : GOLD;
  }

  private refreshItemInfoTimer() {
    const pending = session.matchView?.public?.pending;
    const timed =
      !!this.itemInfoRoot?.active &&
      this.itemInfoOfferMode &&
      !!pending?.expiresAt &&
      pending.playerId === session.playerId &&
      (pending.kind === "offer_item" || pending.kind === "force_trade");
    this.applySkillRemainLabel(this.itemInfoTimer, pending?.expiresAt, timed);
  }

  private ensurePendingRemain() {
    if (this.pendingRemainHost?.isValid && this.pendingRemainLabel?.isValid) return;
    let host = this.node.getChildByName("PendingRemain");
    if (!host) {
      host = new Node("PendingRemain");
      host.layer = this.node.layer;
      this.node.addChild(host);
      host.setPosition(0, 92, 0);
      host.addComponent(UITransform).setContentSize(320, 56);
      const g = host.addComponent(Graphics);
      g.fillColor = new Color(42, 26, 14, 240);
      g.roundRect(-160, -28, 320, 56, 14);
      g.fill();
      g.strokeColor = GOLD;
      g.lineWidth = 2;
      g.roundRect(-160, -28, 320, 56, 14);
      g.stroke();
    }
    this.pendingRemainHost = host;
    this.pendingRemainLabel =
      host.getChildByName("text")?.getComponent(Label) ??
      this.makeLabel(host, "text", "", 0, 0, 26, GOLD, 300, 40);
    this.pendingRemainLabel.isBold = true;
    host.active = false;
  }

  private refreshPendingRemain() {
    this.ensurePendingRemain();
    const pending = session.matchView?.public?.pending;
    const me = session.playerId;
    const popupCovers = !!this.itemInfoRoot?.active && this.itemInfoOfferMode;
    const show =
      !popupCovers &&
      !!pending?.expiresAt &&
      ((pending.kind === "rps" &&
        pending.phase !== "reveal" &&
        (pending.challengerId === me || pending.targetId === me)) ||
        (pending.kind === "force_trade" && pending.playerId === me) ||
        (pending.kind === "swap_hands" && pending.playerId === me) ||
        (pending.kind === "afk_host" && pending.playerId !== me));
    if (this.pendingRemainHost) this.pendingRemainHost.active = show;
    this.applySkillRemainLabel(this.pendingRemainLabel, pending?.expiresAt, show);
  }

  private isForceTradeReturn(): boolean {
    const pending = session.matchView?.public?.pending;
    return pending?.kind === "force_trade" && pending.playerId === session.playerId;
  }

  private syncForceTradeReturn() {
    const pending = session.matchView?.public?.pending;
    const key =
      pending?.kind === "force_trade" && pending.playerId === session.playerId
        ? String(pending.expiresAt ?? "")
        : "";
    if (key && key !== this.lastForceTradeKey) this.selected.clear();
    this.lastForceTradeKey = key;
  }

  private pickForceTradeCard(id: string) {
    const prev = [...this.selected];
    if (prev.length === 1 && prev[0] === id) return;
    this.selected.clear();
    this.selected.add(id);
    playCardSelectSfx(true);
    for (const p of prev) this.paintHandCardSelected(p, p === id);
    this.paintHandCardSelected(id, true);
    this.refreshPendingActions();
    this.refreshHint();
  }

  private ensureDrawHint() {
    if (this.drawHintHost?.isValid && this.drawHintLabel?.isValid) return;
    let host = this.node.getChildByName("DrawHint");
    if (!host) {
      host = new Node("DrawHint");
      host.layer = this.node.layer;
      this.node.addChild(host);
      host.setPosition(0, 168, 0);
      host.addComponent(UITransform).setContentSize(560, 64);
      const g = host.addComponent(Graphics);
      g.fillColor = new Color(42, 26, 14, 240);
      g.roundRect(-280, -32, 560, 64, 14);
      g.fill();
      g.strokeColor = GOLD;
      g.lineWidth = 2;
      g.roundRect(-280, -32, 560, 64, 14);
      g.stroke();
    }
    this.drawHintHost = host;
    this.drawHintLabel =
      host.getChildByName("text")?.getComponent(Label) ??
      this.makeLabel(host, "text", "", 0, 0, 28, GOLD, 520, 48);
    this.drawHintLabel.isBold = true;
    host.active = false;
  }

  private refreshDrawHint() {
    this.ensureDrawHint();
    const pending = session.matchView?.public?.pending;
    if (
      pending?.kind === "force_trade" &&
      pending.playerId === session.playerId &&
      pending.drawnHint
    ) {
      const key = `${pending.expiresAt}|${pending.drawnHint}`;
      if (key !== this.drawHintKey) {
        this.drawHintKey = key;
        this.drawHintText = `你抽到的是${pending.drawnHint}`;
        this.drawHintUntil = Date.now() + DRAW_HINT_MS;
      }
    }
    const show = !!this.drawHintText && Date.now() < this.drawHintUntil;
    if (this.drawHintHost) this.drawHintHost.active = show;
    if (this.drawHintLabel) this.drawHintLabel.string = show ? this.drawHintText : "";
  }

  private refreshItemTargetChoices(item: MatchItemView, offer: boolean) {
    const pickingTarget =
      offer &&
      this.pickMode.kind === "target" &&
      this.pickMode.itemId === item.id;
    const pickingControl = offer && this.pickMode.kind === "control" && item.id === "epic_control";
    const picking = pickingTarget || pickingControl;
    const targets = pickingTarget ? this.eligibleSkillTargets(item.id) : [];
    if (picking && this.itemInfoStatus) {
      this.itemInfoStatus.node.active = true;
      this.itemInfoStatus.string = this.awaitingItemUse
        ? "使用中…"
        : pickingControl
          ? this.controlPickPrompt()
          : targets.length
            ? this.targetPickPrompt(item.id)
            : "没有可选择的角色";
      this.itemInfoStatus.color = GOLD;
    }
    if (this.itemInfoUse) {
      this.itemInfoUse.node.active = offer && !picking;
      this.setInteractable(this.itemInfoUse, offer && !picking);
    }
    if (this.itemInfoSkip) {
      this.itemInfoSkip.node.active = offer && !picking;
    }

    const key = pickingTarget
      ? `target|${item.id}|${targets.join(",")}|skip`
      : pickingControl
        ? `control|${item.id}`
        : `idle|${item.id}|${offer ? 1 : 0}`;
    if (this.itemInfoTargetHost && key !== this.lastTargetChoiceKey) {
      this.lastTargetChoiceKey = key;
      this.itemInfoTargetHost.removeAllChildren();
      if (pickingTarget || pickingControl) {
        const choices = pickingControl
          ? [
              {
                name: "ctrl-single",
                text: this.controlPickButton("single"),
                fn: () => this.chooseControlType("single"),
              },
              {
                name: "ctrl-pair",
                text: this.controlPickButton("pair"),
                fn: () => this.chooseControlType("pair"),
              },
              {
                name: "target-skip",
                text: "不使用",
                fn: () => this.closeItemInfo(true),
              },
            ]
          : [
              ...targets.map((id) => ({
                name: `target-${id}`,
                text: this.targetPickButton(item.id, id),
                fn: () => this.chooseSkillTarget(item.id, id),
              })),
              {
                name: "target-skip",
                text: "不使用",
                fn: () => this.closeItemInfo(true),
              },
            ];
        const n = choices.length;
        const w = n >= 4 ? 122 : n >= 3 ? 150 : 180;
        const step = w + 12;
        const start = -((n - 1) * step) / 2;
        choices.forEach((c, i) => {
          const btn = this.makeButton(
            this.itemInfoTargetHost!,
            c.name,
            c.text,
            start + i * step,
            0,
            w,
            64,
          );
          this.bindTap(btn, c.fn, true);
        });
      }
    }
    if (this.itemInfoTargetHost) {
      for (const child of this.itemInfoTargetHost.children) {
        this.setInteractable(child.getComponent(Button), picking && !this.awaitingItemUse);
      }
    }
    if (!picking) {
      const panel = this.itemInfoUse?.node.parent ?? this.itemInfoSkip?.node.parent;
      if (panel && this.itemInfoUse) this.itemInfoUse.node.setSiblingIndex(panel.children.length - 1);
      if (panel && this.itemInfoSkip) this.itemInfoSkip.node.setSiblingIndex(panel.children.length - 1);
    }
  }

  private tablePlayerIds(): string[] {
    return session.matchView?.public?.seatOrder ?? session.room?.playerIds ?? [];
  }

  private animalNameForPlayer(playerId: string | null | undefined): string {
    if (!playerId) return "";
    return tableAnimalName(playerId, this.tablePlayerIds()) ?? "";
  }

  private pendingLeaderId(): string | null {
    const pending = session.matchView?.public?.pending;
    return (
      pending?.context?.leaderId ??
      pending?.leaderId ??
      session.matchView?.public?.table?.playerId ??
      session.matchView?.public?.turnPlayerId ??
      null
    );
  }

  private rpsMyChoice(pending: PendingView | null | undefined): string | null {
    if (!pending || pending.kind !== "rps") return null;
    const me = session.playerId;
    if (pending.challengerId === me) return pending.challengerChoice ?? null;
    if (pending.targetId === me) return pending.targetChoice ?? null;
    return null;
  }

  private isRpsPicker(pending: PendingView | null | undefined, me: string): boolean {
    if (!pending || pending.kind !== "rps") return false;
    if (pending.phase === "reveal") return false;
    if (pending.challengerId !== me && pending.targetId !== me) return false;
    return !this.rpsMyChoice(pending);
  }

  private rpsHint(pending: PendingView): string {
    if (pending.phase === "reveal") return "猜拳亮出";
    const me = session.playerId;
    const inDuel = pending.challengerId === me || pending.targetId === me;
    if (!inDuel) return "双方猜拳中";
    if (this.rpsMyChoice(pending)) return "已出拳，等待对方";
    if (pending.targetId === me) {
      const caster = this.animalNameForPlayer(pending.challengerId) || "有人";
      return `${caster}对你使用了玩点别的，请出拳`;
    }
    return "同时猜拳，对方看不到你的手势";
  }

  private refreshRpsBadges(pub: MatchPublicView | undefined) {
    if (!this.rpsHost) this.rpsHost = this.host("RpsHost");
    this.rpsHost.removeAllChildren();
    const pending = pub?.pending;
    if (!pending || pending.kind !== "rps" || pending.phase !== "reveal") return;
    const ids = pub?.seatOrder ?? session.room?.playerIds ?? [];
    const n = ids.length || 1;
    const show = [
      { id: pending.challengerId, choice: pending.challengerChoice },
      { id: pending.targetId, choice: pending.targetChoice },
    ];
    for (const row of show) {
      if (!row.id || !row.choice) continue;
      const seat = ids.indexOf(row.id);
      if (seat < 0) continue;
      const chair = TABLE_CHAIRS.find((c) => c.id === seatAnimalId(seat, n));
      if (!chair) continue;
      const off = RPS_BADGE_OFFSET[chair.id];
      this.makeRpsBadge(
        this.rpsHost,
        `rps-${row.id}`,
        rpsCn(row.choice),
        chair.x + off.x,
        chair.y + off.y,
      );
    }
  }

  private makeRpsBadge(parent: Node, name: string, text: string, x: number, y: number) {
    const w = 120;
    const h = 120;
    const n = new Node(name);
    n.layer = parent.layer;
    parent.addChild(n);
    n.setPosition(x, y, 0);
    n.addComponent(UITransform).setContentSize(w, h);
    const g = n.addComponent(Graphics);
    const hw = w / 2;
    const hh = h / 2;
    g.fillColor = new Color(36, 22, 12, 235);
    g.roundRect(-hw, -hh, w, h, 18);
    g.fill();
    g.strokeColor = GOLD;
    g.lineWidth = 4;
    g.roundRect(-hw, -hh, w, h, 18);
    g.stroke();
    const lab = this.makeLabel(n, "cap", text, 0, 0, 40, GOLD, w - 12, h - 12);
    lab.isBold = true;
  }

  private eligibleSkillTargets(itemId: string): string[] {
    const me = session.playerId;
    const pub = session.matchView?.public;
    const finished = new Set((pub?.ranking ?? []).map((r) => r.playerId));
    const counts = pub?.handCounts ?? {};
    const myHand = session.matchView?.hand?.length ?? 0;
    return this.tablePlayerIds().filter((id) => {
      if (!id || id === me || finished.has(id)) return false;
      const n = counts[id];
      if (itemId === "rare_steal_one") return n == null || n > 8;
      if (itemId === "legendary_force_trade") return n == null || n > 10;
      if (itemId === "epic_big_trade") return myHand >= 3 && (n == null || n >= 3);
      return true;
    });
  }

  private chooseSkillTarget(itemId: string, targetPlayerId: string) {
    if (this.awaitingItemUse) return;
    this.awaitingItemUse = true;
    this.sendIntent({
      type: "use_item",
      itemId,
      payload: { targetPlayerId },
    });
    if (session.lastError) this.awaitingItemUse = false;
    this.refreshItemInfo();
  }

  private controlPickPrompt(): string {
    const who = this.animalNameForPlayer(this.pendingLeaderId());
    return who ? `强制${who}下次领出：单张或对子` : "强制下次领出：单张或对子";
  }

  private controlPickButton(kind: "single" | "pair"): string {
    const who = this.animalNameForPlayer(this.pendingLeaderId());
    if (kind === "single") return who ? `强制${who}单张` : "强制单张";
    return who ? `强制${who}对子` : "强制对子";
  }

  private chooseControlType(forcedType: "single" | "pair") {
    if (this.awaitingItemUse) return;
    this.awaitingItemUse = true;
    this.sendIntent({
      type: "use_item",
      itemId: "epic_control",
      payload: { forcedType },
    });
    if (session.lastError) this.awaitingItemUse = false;
    this.pickMode = { kind: "none" };
    this.refreshItemInfo();
  }

  private activateItem(item: MatchItemView) {
    if (CHOICE_SKILL_IDS.has(item.id)) {
      const pending = session.matchView?.public?.pending;
      if (
        item.id === "legendary_force_trade" &&
        pending?.kind === "force_trade" &&
        pending.playerId === session.playerId
      ) {
        this.refresh();
        return;
      }
      this.pickMode =
        item.id === "epic_control" ? { kind: "control" } : { kind: "target", itemId: item.id };
      this.sendIntent({
        type: "use_item",
        itemId: item.id,
        payload: { confirmUse: true },
      });
      this.refresh();
      return;
    }
    this.awaitingItemUse = true;
    this.sendIntent({ type: "use_item", itemId: item.id, payload: {} });
    if (session.lastError) this.awaitingItemUse = false;
    this.closeItemInfo(false);
  }

  private onSeatTap(playerId: string) {
    const pending = session.matchView?.public?.pending;
    if (
      pending?.kind === "swap_hands" &&
      pending.playerId === session.playerId &&
      playerId !== session.playerId
    ) {
      this.sendIntent({ type: "resolve_swap", targetId: playerId });
      return;
    }
    this.openPlayerProfile(playerId);
  }

  private onBack() {
    if (this.leaving) return;
    this.leaving = true;
    net.send({ type: "leave_room" });
    session.clearMatch();
    director.loadScene("DouDizhuLobby");
  }

  private sendIntent(msg: ClientMessage) {
    session.lastError = "";
    if (!net.send(msg)) {
      session.lastError = "未连接，请先 npm run dev";
      this.refresh();
    }
  }

  private host(name: string): Node {
    const n = new Node(name);
    n.layer = this.node.layer;
    this.node.addChild(n);
    n.addComponent(UITransform).setContentSize(1, 1);
    return n;
  }

  private bindTap(btn: Button | null, fn: () => void, keepSize = false, sfx = true) {
    if (!btn) return;
    const n = btn.node;
    const uit = n.getComponent(UITransform) ?? n.addComponent(UITransform);
    if (!keepSize) {
      uit.setContentSize(Math.max(uit.contentSize.width, 88), Math.max(uit.contentSize.height, 56));
    }
    n.off(Node.EventType.TOUCH_END);
    n.on(
      Node.EventType.TOUCH_END,
      () => {
        if (sfx) playButtonSfx();
        fn();
      },
      this,
    );
  }

  private setInteractable(btn: Button | null, on: boolean) {
    if (!btn) return;
    btn.interactable = true;
    const action =
      btn.node.name === "BtnPlay" ||
      btn.node.name === "BtnPass" ||
      btn.node.name === "BtnCancelAutoPlay";
    const lab = this.buttonLabel(btn);
    if (lab) lab.color = action ? (on ? INK : MUTED) : GOLD;
    const bg = btn.node.getChildByName("bg")?.getComponent(Graphics);
    if (bg) {
      const uit = btn.node.getComponent(UITransform);
      const w = uit?.contentSize.width ?? 280;
      const h = uit?.contentSize.height ?? 80;
      bg.clear();
      const hw = w / 2;
      const hh = h / 2;
      bg.fillColor = action
        ? on
          ? ACTION_BTN_FILL
          : ACTION_BTN_FILL_OFF
        : on
          ? new Color(24, 88, 46, 255)
          : new Color(50, 58, 64, 255);
      bg.roundRect(-hw, -hh, w, h, 12);
      bg.fill();
      bg.strokeColor = on ? (action ? ACTION_BTN_STROKE : GOLD) : MUTED;
      bg.lineWidth = 3;
      bg.roundRect(-hw, -hh, w, h, 12);
      bg.stroke();
    }
  }

  private buttonLabel(btn: Button | null): Label | null {
    if (!btn) return null;
    return (
      btn.node.getChildByName("cap")?.getComponent(Label) ??
      btn.getComponent(Label) ??
      btn.node.getComponent(Label) ??
      null
    );
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
    lab.lineHeight = Math.round(size * 1.35);
    lab.horizontalAlign = Label.HorizontalAlign.CENTER;
    lab.verticalAlign = Label.VerticalAlign.CENTER;
    lab.color = color;
    return lab;
  }

  private makeButton(
    parent: Node,
    name: string,
    text: string,
    x: number,
    y: number,
    w: number,
    h = 80,
  ): Button {
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
    const hw = w / 2;
    const hh = h / 2;
    g.fillColor = new Color(24, 88, 46, 255);
    g.roundRect(-hw, -hh, w, h, 12);
    g.fill();
    g.strokeColor = GOLD;
    g.lineWidth = 3;
    g.roundRect(-hw, -hh, w, h, 12);
    g.stroke();

    const cap = new Node("cap");
    cap.layer = n.layer;
    n.addChild(cap);
    cap.addComponent(UITransform).setContentSize(w, h);
    const lab = cap.addComponent(Label);
    lab.string = text;
    lab.useSystemFont = true;
    lab.fontSize = h >= 80 ? 40 : 28;
    lab.lineHeight = h >= 80 ? 48 : 34;
    lab.horizontalAlign = Label.HorizontalAlign.CENTER;
    lab.verticalAlign = Label.VerticalAlign.CENTER;
    lab.color = GOLD;
    lab.overflow = Label.Overflow.SHRINK;

    const btn = n.addComponent(Button);
    btn.transition = Button.Transition.NONE;
    return btn;
  }

  private findLabel(name: string): Label | null {
    for (const child of this.node.children) {
      if (child.name === name && child.activeInHierarchy) {
        return child.getComponent(Label);
      }
    }
    for (const child of this.node.children) {
      if (child.name === name) return child.getComponent(Label);
    }
    return null;
  }
}

function isMyControlledLead(pub: MatchPublicView | undefined, me: string): boolean {
  return (
    !!pub &&
    pub.phase === "playing" &&
    pub.freeLead === true &&
    pub.turnPlayerId === me &&
    pub.leadRestriction?.playerId === me
  );
}

function isMyOverloadedTurn(pub: MatchPublicView | undefined, me: string): boolean {
  return (
    !!pub &&
    pub.phase === "playing" &&
    pub.turnPlayerId === me &&
    !pub.pending &&
    (pub.overloadTurnsLeft ?? 0) > 0
  );
}

const SKILL_HIT_TOAST_IDS = new Set([
  "epic_big_trade",
  "legendary_force_trade",
  "rare_brain_overload",
  "legendary_extra_round",
  "legendary_bomb_defuser",
  "legendary_swap_hands",
  "rare_bounce",
]);

function skillToastLine(
  events: unknown[],
  me: string,
  casterName: (id: string) => string,
): string | null {
  let line: string | null = null;
  for (const raw of events) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const t = String(e.type ?? "");
    if (t === "item_used") {
      const itemId = String(e.itemId ?? "");
      const caster = String(e.playerId ?? "");
      if (!caster) continue;
      if (itemId === "rare_steal_one") {
        const card = String(e.drawnHint ?? "一张牌");
        const targetId = String(e.targetPlayerId ?? "");
        if (caster === me && targetId) {
          line = `你从${casterName(targetId)}抽取了${card}`;
        } else if (targetId === me && caster !== me) {
          line = `${casterName(caster)}对你使用了技能万一是好牌呢，抽取了你的${card}`;
        }
        continue;
      }
      if (caster === me) continue;
      if (itemId === "epic_control" || itemId === "legendary_play_something_else") continue;
      const skill = ITEM_NAME_CN[itemId] ?? "技能";
      if (itemId === "rare_brain_overload" || itemId === "legendary_extra_round") {
        line = `${casterName(caster)}对你使用了${skill}`;
        continue;
      }
      if (String(e.targetPlayerId ?? "") === me && SKILL_HIT_TOAST_IDS.has(itemId)) {
        line = `${casterName(caster)}对你使用了${skill}`;
      }
      continue;
    }
    if (t === "bomb_defused" && String(e.bomberId ?? "") === me) {
      line = `${casterName(String(e.defuserId ?? ""))}对你使用了拆弹专家`;
    }
    if (t === "hands_swapped" && String(e.targetId ?? "") === me) {
      line = `${casterName(String(e.playerId ?? ""))}对你使用了换一下`;
    }
    if (t === "extra_round" && String(e.byPlayerId ?? "") !== me) {
      line = `${casterName(String(e.byPlayerId ?? ""))}对你使用了加赛`;
    }
  }
  return line;
}

function canPlayOrPass(pub: MatchPublicView | undefined, me: string): boolean {
  return !!pub && pub.phase === "playing" && pub.turnPlayerId === me && !pub.pending;
}

/** 跟牌可过牌；领出不显示过牌。被操控领出时显示「移交」。 */
function shouldShowPassButton(pub: MatchPublicView | undefined, me: string): boolean {
  if (!canPlayOrPass(pub, me)) return false;
  if (isMyControlledLead(pub, me)) return true;
  return pub?.freeLead === false;
}

function controlTypeCn(allowed: string | undefined): string {
  return allowed === "pair" ? "对子" : "单张";
}

function playErrorCn(message: string): string {
  const map: Record<string, string> = {
    "Not playing": "还没开始打牌",
    "Interaction pending": "先处理技能窗口，或等倒计时结束",
    "Unknown or finished player": "你已出完或未入局",
    "Not your turn": "还没轮到你",
    "Cards not in hand": "这些牌不在你手里",
    "Invalid hand": "不是合法牌型（先手牌只能单独出）",
    "Cannot beat table": "压不过桌面的牌",
    "Cannot pass on free lead": "领出时不能过牌，必须出牌",
    "Not under control": "当前不是被操控的领出",
    "Controller unavailable": "无法移交领出",
    "Bounce forbids this hand type": "打回禁止这个牌型",
    "Max bomb can only be beaten by rocket": "最大炸弹只能用王炸压",
  };
  if (message.startsWith("Lead restricted")) return "领出被限制为指定牌型";
  return map[message] ?? message;
}

function isIllegalPlaySelection(message: string): boolean {
  return (
    message === "Invalid hand" ||
    message === "Cannot beat table" ||
    message === "Bounce forbids this hand type" ||
    message === "Max bomb can only be beaten by rocket" ||
    message === "Cards not in hand" ||
    message.startsWith("Lead restricted")
  );
}

function rpsCn(choice: string): string {
  if (choice === "rock") return "石头";
  if (choice === "paper") return "布";
  return "剪刀";
}

function isPassiveSkill(item: MatchItemView): boolean {
  return item.trigger === "game_start";
}

/** 局内技能栏：主动在上、被动在下；同组保持获得顺序。 */
function skillBarItems(items: MatchItemView[]): MatchItemView[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const pa = isPassiveSkill(a.item) ? 1 : 0;
      const pb = isPassiveSkill(b.item) ? 1 : 0;
      return pa - pb || a.index - b.index;
    })
    .map((entry) => entry.item);
}

function activeItemUseStatus(item: MatchItemView): { text: string; used: boolean } {
  if (item.trigger === "game_start") return { text: "", used: false };
  const max = Math.max(1, item.maxUses ?? item.remainingUses ?? 1);
  const left = Math.max(0, item.remainingUses);
  const used = Math.max(0, max - left);
  if (used <= 0) return { text: "未使用", used: false };
  if (max > 1) return { text: `已使用 ${used} 次`, used: true };
  return { text: "已使用", used: true };
}

function itemLooksReady(
  item: MatchItemView,
  pub: MatchPublicView | undefined,
  me: string,
): boolean {
  if (!pub || pub.phase !== "playing" || item.remainingUses <= 0) return false;
  const pending = pub.pending ?? null;
  return (
    pending?.kind === "offer_item" &&
    pending.itemId === item.id &&
    pending.playerId === me
  );
}

function clockUntilMs(pub: MatchPublicView | undefined): number | null {
  if (!pub) return null;
  if (pub.pending?.expiresAt) return pub.pending.expiresAt;
  return pub.turnExpiresAt ?? null;
}

function clockOwnerId(pub: MatchPublicView | undefined): string | null {
  const pending = pub?.pending;
  if (pending) {
    if (pending.kind === "swap_hands") return pending.playerId ?? null;
    if (pending.kind === "offer_item") return pending.playerId ?? null;
    if (pending.kind === "rps") return null;
    if (pending.kind === "score_double") return null;
    if (pending.kind === "force_trade") return pending.playerId ?? null;
    if (pending.kind === "afk_host") return pending.playerId ?? null;
    return null;
  }
  return pub?.turnPlayerId ?? null;
}

const PLAY_RANK_KEYS: Record<number, string> = {
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "j",
  12: "q",
  13: "k",
  14: "14",
  15: "15",
  16: "16",
  17: "17",
  18: "18",
  19: "19",
  20: "a",
  21: "2",
  22: "small-joker",
  23: "big-joker",
};

function cardPlayVoiceKind(handType: string, mainRank: number): PlayVoiceKind | null {
  if (handType === "bomb") return "bomb";
  if (handType === "rocket") return "rocket";
  if (handType === "straight") return "straight";
  if (handType === "consecutive_pairs") return "consecutive-pairs";
  if (
    handType === "airplane" ||
    handType === "airplane_with_singles" ||
    handType === "airplane_with_pairs"
  ) {
    return "airplane";
  }
  if (handType === "triple_with_single") return "triple-single";
  if (handType === "triple_with_pair") return "triple-pair";
  if (handType === "four_with_two_singles" || handType === "four_with_two_pairs") {
    return "four-two";
  }
  const rank = PLAY_RANK_KEYS[mainRank];
  if (!rank) return null;
  if (handType === "single") return `single-${rank}`;
  if (handType === "pair") return `pair-${rank}`;
  return null;
}

function formatMatchEvent(ev: unknown): string {
  if (!ev || typeof ev !== "object") return "";
  const e = ev as Record<string, unknown>;
  const t = String(e.type ?? "");
  const who = session.playerName(String(e.playerId ?? e.byPlayerId ?? e.actorId ?? ""));
  if (t === "played") {
    const type = HAND_TYPE_CN[String(e.handType ?? "")] ?? String(e.handType ?? "");
    return `${who} 出了 ${type}`;
  }
  if (t === "passed") return `${who} 过牌`;
  if (t === "play_bounced") {
    const bouncer = session.playerName(String(e.bouncerId ?? ""));
    const actor = session.playerName(String(e.actorId ?? ""));
    return `${bouncer} 打回了 ${actor} 的出牌`;
  }
  if (t === "control_applied") {
    const caster = session.playerName(String(e.controllerId ?? ""));
    const target = session.playerName(String(e.targetId ?? ""));
    const type = controlTypeCn(String(e.allowed ?? ""));
    return `${caster} 对 ${target} 使用了操控（须出${type}）`;
  }
  if (t === "control_yielded") {
    const caster = session.playerName(String(e.controllerId ?? ""));
    return `${who} 移交领出给 ${caster}`;
  }
  if (t === "afk_host") return `${who} 出牌超时，确认是否托管`;
  if (t === "turn_timeout") {
    if (e.action === "lead") return `${who} 超时自动出牌`;
    if (e.action === "yield") return `${who} 超时移交领出`;
    return `${who} 超时自动过牌`;
  }
  if (t === "turn" || t === "new_lead") return "";
  if (t === "player_finished") return `${who} 出完，第 ${e.rank} 名`;
  if (t === "item_used") {
    const skill = ITEM_NAME_CN[String(e.itemId ?? "")] ?? "技能";
    const target = e.targetPlayerId ? session.playerName(String(e.targetPlayerId)) : "";
    const card = e.drawnHint ? String(e.drawnHint) : "";
    if (String(e.itemId ?? "") === "rare_steal_one" && target && card) {
      return `${who} 从 ${target} 抽取了${card}`;
    }
    if (target) return `${who} 对 ${target} 使用了技能${skill}`;
    return `${who} 使用了技能${skill}`;
  }
  if (t === "bomb_defused") {
    const defuser = session.playerName(String(e.defuserId ?? ""));
    const bomber = session.playerName(String(e.bomberId ?? ""));
    return `${defuser} 拆掉了 ${bomber} 的炸弹`;
  }
  if (t === "hands_swapped") {
    const target = session.playerName(String(e.targetId ?? ""));
    return `${who} 与 ${target} 换了普通手牌`;
  }
  if (t === "extra_round") return `${who} 使用了加赛，全体各获得 10 张`;
  if (t === "dealt") return "发牌完成";
  if (t === "match_finished") return "对局结束";
  return t ? `事件：${t}` : "";
}
