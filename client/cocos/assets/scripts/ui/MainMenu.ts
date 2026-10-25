import {
  _decorator,
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
  Vec2,
  view,
} from "cc";
import { EDITOR, PREVIEW } from "cc/env";
import { session } from "../app/Session";
import { applyRemotePortrait, ensureAvatarPortrait } from "../app/avatarPortrait";
import { bootNet } from "../app/connect";
import { playButtonSfx, unlockCardSfx } from "../app/cardSfx";
import { startMedievalBgm } from "../app/medievalBgm";
import { clearUiSpriteCache, loadUiSpriteFrame } from "../app/uiSkin";
import { net } from "../net/WsClient";
import { preloadCardArt } from "./cards";

const { ccclass, property } = _decorator;

const CREAM = new Color(245, 236, 214, 255);
const GOLD = new Color(255, 214, 110, 255);
const MUTED = new Color(210, 200, 180, 255);
const WOOD = new Color(58, 38, 24, 255);

@ccclass("MainMenu")
export class MainMenu extends Component {
  @property(Label)
  titleLabel: Label | null = null;

  @property(Label)
  statusLabel: Label | null = null;

  private profileName: Label | null = null;
  private profileSub: Label | null = null;
  private profileScore: Label | null = null;
  private onlineDot: Graphics | null = null;
  private unbindMsg: (() => void) | null = null;
  private unbindStatus: (() => void) | null = null;

  onLoad() {
    if (EDITOR && !PREVIEW) return;
    session.prepareIdentity();
    this.bindLabels();
    this.clearLegacyNodes();
    this.ensureShell();
    this.ensureProfileChip();
    this.stylePrimaryButton();
    void preloadCardArt();
    unlockCardSfx();
    startMedievalBgm();

    this.unbindMsg = net.onMessage((msg) => {
      if (msg.type === "welcome") {
        session.rememberIdentity(msg.playerId, msg.displayName);
        session.lastError = "";
        if (session.displayName && session.displayName !== msg.displayName) {
          net.syncDisplayName(session.playerId, session.displayName, session.avatarUrl);
        }
      } else if (msg.type === "score") {
        session.applyScore(msg.score);
      } else if (msg.type === "avatar") {
        session.applyAvatar(msg.avatar.equipped, msg.avatar.unlocked);
      } else if (msg.type === "error") {
        session.lastError = msg.message;
      }
      this.refreshStatus();
    });
    this.unbindStatus = net.onStatus(() => this.refreshStatus());

    void bootNet().then(() => this.refreshStatus());
    this.refreshStatus();
    this.refreshProfileChip();
  }

  onDestroy() {
    this.unbindMsg?.();
    this.unbindStatus?.();
  }

  private canvasSize(): { w: number; h: number } {
    const ut = this.node.getComponent(UITransform);
    if (ut && ut.contentSize.width > 0) {
      return { w: ut.contentSize.width, h: ut.contentSize.height };
    }
    const vs = view.getVisibleSize();
    return { w: vs.width || 1920, h: vs.height || 1080 };
  }

  private clearLegacyNodes() {
    for (const name of [
      "NickInput",
      "NickHint",
      "AvatarRow",
      "AvatarBoard",
      "AvatarScroll",
      "AvatarSectionTitle",
      "AvatarFeltMask",
      "AvatarHint",
      "TitlePlaque",
      "Tagline",
      "ProfileChip",
      "CornerNav",
      "NoticeOverlay",
      "RankOverlay",
      "ShellBg",
      "BtnDouDizhuMain",
    ]) {
      const n = this.node.getChildByName(name);
      if (!n) continue;
      n.removeFromParent();
      n.destroy();
    }
  }

  private bindLabels() {
    if (!this.titleLabel) {
      this.titleLabel = this.node.getChildByName("Title")?.getComponent(Label) ?? null;
    }
    if (!this.statusLabel) {
      this.statusLabel = this.node.getChildByName("Status")?.getComponent(Label) ?? null;
    }
    if (this.titleLabel) {
      this.titleLabel.enabled = false;
      this.titleLabel.string = "";
    }
    if (this.statusLabel) {
      const { h } = this.canvasSize();
      this.statusLabel.node.setPosition(0, -h / 2 + 36, 0);
      this.statusLabel.fontSize = 20;
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
    if (cam) cam.clearColor = new Color(8, 48, 40, 255);

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
    clearUiSpriteCache("main-bg");
    void loadUiSpriteFrame("main-bg").then((sf) => {
      if (!sf || !sp.isValid) return;
      this.applyCoverSprite(img, sf, w, h);
      sp.spriteFrame = sf;
      g.clear();
    });
  }

  private applyCoverSprite(
    img: Node,
    sf: SpriteFrame,
    canvasW: number,
    canvasH: number,
  ): void {
    const rw = Math.max(1, sf.rect.width);
    const rh = Math.max(1, sf.rect.height);
    // 16:9 图对 16:9 画布时用 1.0 铺满，避免 1.04 把顶部牌匾裁掉
    const cover = Math.max(canvasW / rw, canvasH / rh);
    const aspectDiff = Math.abs(rw / rh - canvasW / canvasH);
    const scale = aspectDiff < 0.02 ? cover : cover * 1.02;
    img.getComponent(UITransform)!.setContentSize(rw * scale, rh * scale);
    img.setPosition(0, 0, 0);
  }

  private ensureProfileChip() {
    const { w, h } = this.canvasSize();
    const bw = 336;
    const bh = 96;
    const root = new Node("ProfileChip");
    root.layer = this.node.layer;
    this.node.addChild(root);
    root.setPosition(-w / 2 + 182, h / 2 - 72, 0);
    root.addComponent(UITransform).setContentSize(bw, bh);

    const g = root.addComponent(Graphics);
    g.fillColor = new Color(32, 20, 12, 210);
    g.roundRect(-bw / 2, -bh / 2, bw, bh, 18);
    g.fill();
    g.strokeColor = new Color(228, 184, 88, 240);
    g.lineWidth = 3;
    g.roundRect(-bw / 2, -bh / 2, bw, bh, 18);
    g.stroke();

    ensureAvatarPortrait(root, "portrait", 74);
    root.getChildByName("portrait")?.setPosition(-117, 0, 0);

    const dot = new Node("onlineDot");
    dot.layer = root.layer;
    root.addChild(dot);
    dot.setPosition(-91, -24, 0);
    dot.addComponent(UITransform).setContentSize(14, 14);
    this.onlineDot = dot.addComponent(Graphics);

    const name = new Node("name");
    name.layer = root.layer;
    root.addChild(name);
    name.setPosition(14, 16, 0);
    name.addComponent(UITransform).setContentSize(168, 30);
    const nameLab = name.addComponent(Label);
    nameLab.useSystemFont = true;
    nameLab.fontSize = 26;
    nameLab.horizontalAlign = Label.HorizontalAlign.LEFT;
    nameLab.verticalAlign = Label.VerticalAlign.CENTER;
    nameLab.overflow = Label.Overflow.SHRINK;
    nameLab.color = CREAM;
    nameLab.string = this.profileDisplayName();
    this.profileName = nameLab;

    const coin = new Node("coin");
    coin.layer = root.layer;
    root.addChild(coin);
    coin.setPosition(-56, -18, 0);
    coin.addComponent(UITransform).setContentSize(32, 32);
    this.paintStarCoin(coin.addComponent(Graphics), 13);
    const star = new Node("glyph");
    star.layer = coin.layer;
    coin.addChild(star);
    star.addComponent(UITransform).setContentSize(28, 28);
    const starLab = star.addComponent(Label);
    starLab.string = "★";
    starLab.useSystemFont = true;
    starLab.fontSize = 16;
    starLab.lineHeight = 18;
    starLab.horizontalAlign = Label.HorizontalAlign.CENTER;
    starLab.verticalAlign = Label.VerticalAlign.CENTER;
    starLab.color = new Color(255, 252, 240, 255);

    const score = new Node("score");
    score.layer = root.layer;
    root.addChild(score);
    score.setPosition(8, -18, 0);
    score.addComponent(UITransform).setContentSize(88, 28);
    const scoreLab = score.addComponent(Label);
    scoreLab.useSystemFont = true;
    scoreLab.fontSize = 24;
    scoreLab.horizontalAlign = Label.HorizontalAlign.LEFT;
    scoreLab.verticalAlign = Label.VerticalAlign.CENTER;
    scoreLab.color = GOLD;
    scoreLab.string = this.formatScore();
    this.profileScore = scoreLab;

    const sub = new Node("sub");
    sub.layer = root.layer;
    root.addChild(sub);
    sub.setPosition(92, -18, 0);
    sub.addComponent(UITransform).setContentSize(72, 20);
    const subLab = sub.addComponent(Label);
    subLab.useSystemFont = true;
    subLab.fontSize = 13;
    subLab.horizontalAlign = Label.HorizontalAlign.LEFT;
    subLab.verticalAlign = Label.VerticalAlign.CENTER;
    subLab.color = MUTED;
    subLab.string = "电脑预览";
    this.profileSub = subLab;

    this.refreshOnlineDot();
  }

  /** 效果图：金币圆 + 白五角星 */
  private paintStarCoin(g: Graphics, r: number) {
    g.clear();
    g.fillColor = new Color(196, 118, 28, 255);
    g.circle(0, 0, r + 2);
    g.fill();
    g.fillColor = new Color(255, 204, 56, 255);
    g.circle(0, 0, r);
    g.fill();
    g.fillColor = new Color(255, 232, 120, 220);
    g.circle(-r * 0.22, r * 0.22, r * 0.42);
    g.fill();
    g.strokeColor = new Color(168, 96, 20, 255);
    g.lineWidth = 2;
    g.circle(0, 0, r);
    g.stroke();
  }

  private stylePrimaryButton() {
    const old = this.node.getChildByName("BtnDouDizhu");
    if (old) old.active = false;
    this.node.getChildByName("BtnDouDizhuMain")?.destroy();

    const { h } = this.canvasSize();
    const bw = 520;
    const bh = 108;
    const btn = new Node("BtnDouDizhuMain");
    btn.layer = this.node.layer;
    this.node.addChild(btn);
    btn.setSiblingIndex(this.node.children.length - 1);
    btn.setPosition(0, -h / 2 + 138, 0);
    btn.addComponent(UITransform).setContentSize(bw, bh);

    const skin = new Node("skin");
    skin.layer = btn.layer;
    btn.addChild(skin);
    skin.addComponent(UITransform).setContentSize(bw, bh);
    this.paintStartPlaque(skin.addComponent(Graphics), bw, bh);
    this.addStartCaption(btn, bw, bh);

    const button = btn.addComponent(Button);
    button.transition = Button.Transition.SCALE;
    button.zoomScale = 1.04;
    button.target = btn;
    btn.on(Button.EventType.CLICK, this.onClickDouDizhu, this);
  }

  /** 暗金木框，高光也落在琥珀金里，不再用带白边的贴图 */
  private paintStartPlaque(g: Graphics, bw: number, bh: number) {
    const r = 20;
    g.clear();
    g.fillColor = new Color(18, 8, 4, 110);
    g.roundRect(-bw / 2 + 5, -bh / 2 - 7, bw, bh, r);
    g.fill();
    g.fillColor = new Color(48, 28, 12, 255);
    g.roundRect(-bw / 2, -bh / 2, bw, bh, r);
    g.fill();
    g.fillColor = new Color(128, 78, 22, 255);
    g.roundRect(-bw / 2 + 5, -bh / 2 + 5, bw - 10, bh - 10, r - 3);
    g.fill();
    g.fillColor = new Color(186, 122, 34, 255);
    g.roundRect(-bw / 2 + 11, -bh / 2 + 11, bw - 22, bh - 22, r - 7);
    g.fill();
    g.fillColor = new Color(210, 148, 48, 220);
    g.roundRect(-bw / 2 + 18, 4, bw - 36, bh / 2 - 18, r - 10);
    g.fill();
    g.strokeColor = new Color(96, 56, 16, 255);
    g.lineWidth = 3;
    g.roundRect(-bw / 2 + 11, -bh / 2 + 11, bw - 22, bh - 22, r - 7);
    g.stroke();
    g.strokeColor = new Color(158, 102, 32, 255);
    g.lineWidth = 2;
    g.roundRect(-bw / 2 + 5, -bh / 2 + 5, bw - 10, bh - 10, r - 3);
    g.stroke();
    this.paintPaw(g, -bw / 2 + 86, -2, 1.05);
    this.paintPaw(g, bw / 2 - 86, -2, 1.05);
  }

  /** 与顶栏同款：雅黑金字 + 墨绿描边 */
  private addStartCaption(parent: Node, bw: number, bh: number) {
    const family = "Microsoft YaHei";
    const make = (name: string, y: number, fill: Color, outline: Color, width: number) => {
      const n = new Node(name);
      n.layer = parent.layer;
      parent.addChild(n);
      n.setPosition(0, y, 0);
      n.addComponent(UITransform).setContentSize(bw - 180, bh - 28);
      const lab = n.addComponent(Label);
      lab.string = "开始游戏";
      lab.useSystemFont = true;
      lab.fontFamily = family;
      lab.fontSize = 44;
      lab.lineHeight = 52;
      lab.spacingX = 8;
      lab.isBold = true;
      lab.horizontalAlign = Label.HorizontalAlign.CENTER;
      lab.verticalAlign = Label.VerticalAlign.CENTER;
      lab.overflow = Label.Overflow.SHRINK;
      lab.color = fill;
      lab.enableOutline = true;
      lab.outlineColor = outline;
      lab.outlineWidth = width;
      return lab;
    };
    make("captionBack", -3, new Color(28, 48, 32, 255), new Color(20, 36, 24, 255), 5);
    const front = make("caption", 1, new Color(255, 214, 96, 255), new Color(16, 78, 56, 255), 4);
    front.enableShadow = true;
    front.shadowColor = new Color(24, 12, 6, 180);
    front.shadowOffset = new Vec2(0, -2);
    front.shadowBlur = 1;
  }

  private paintPaw(g: Graphics, x: number, y: number, s: number) {
    g.fillColor = new Color(120, 68, 18, 160);
    g.circle(x, y - 4 * s, 11 * s);
    g.fill();
    g.circle(x - 10 * s, y + 10 * s, 5 * s);
    g.fill();
    g.circle(x - 3 * s, y + 14 * s, 5 * s);
    g.fill();
    g.circle(x + 4 * s, y + 14 * s, 5 * s);
    g.fill();
    g.circle(x + 11 * s, y + 10 * s, 5 * s);
    g.fill();
  }

  private refreshProfileChip() {
    const profilePortrait = this.node
      .getChildByName("ProfileChip")
      ?.getChildByName("portrait");
    if (profilePortrait) {
      void applyRemotePortrait(profilePortrait, session.avatarUrl, 74);
    }
    this.refreshOnlineDot();
  }

  private profileDisplayName(): string {
    const name = session.displayName?.trim() || "";
    return name || "玩家";
  }

  private formatScore(): string {
    const n = Math.round(session.score);
    return n.toLocaleString("en-US");
  }

  private layoutProfileText() {
    if (this.profileSub) {
      this.profileSub.string = "电脑预览";
      this.profileSub.node.active = true;
    }
  }

  private refreshOnlineDot() {
    const g = this.onlineDot;
    if (!g) return;
    g.clear();
    const online = net.connected && net.welcomed;
    g.fillColor = online
      ? new Color(86, 210, 110, 255)
      : new Color(150, 90, 70, 255);
    g.circle(0, 0, 7);
    g.fill();
    g.strokeColor = new Color(40, 24, 12, 220);
    g.lineWidth = 2;
    g.circle(0, 0, 7);
    g.stroke();
  }

  refreshStatus() {
    if (this.profileName) {
      this.profileName.string = this.profileDisplayName();
    }
    this.layoutProfileText();
    if (this.profileScore) {
      this.profileScore.string = this.formatScore();
    }
    this.refreshOnlineDot();
    if (this.statusLabel) {
      const err = session.lastError.trim();
      const ok = net.connected && net.welcomed && !err;
      this.statusLabel.node.active = !ok;
      if (!ok) {
        this.statusLabel.string = err || net.statusText;
      }
    }
  }

  onClickDouDizhu() {
    playButtonSfx();
    startMedievalBgm();
    director.loadScene("DouDizhuLobby");
  }
}
