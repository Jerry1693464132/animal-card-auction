import {
  BlockInputEvents,
  Button,
  Color,
  EventTouch,
  Graphics,
  Label,
  Node,
  Sprite,
  UITransform,
  Vec2,
  Vec3,
  Widget,
} from "cc";
import {
  getBgmVolume,
  getSfxVolume,
  setBgmVolume,
  setSfxVolume,
} from "../app/audioSettings";
import { playButtonSfx } from "../app/cardSfx";
import { clearUiSpriteCache, loadUiSpriteFrame } from "../app/uiSkin";

const GOLD = new Color(255, 214, 110, 255);
const CREAM = new Color(245, 236, 214, 255);
const INK = new Color(48, 28, 10, 255);
const PANEL_W = 440;
const PANEL_H = 286;
const TRACK_W = 260;

type VolumeGetter = () => number;
type VolumeSetter = (value: number) => void;

function addLabel(
  parent: Node,
  name: string,
  text: string,
  x: number,
  y: number,
  size: number,
  width: number,
): Label {
  const node = new Node(name);
  node.layer = parent.layer;
  parent.addChild(node);
  node.setPosition(x, y);
  node.addComponent(UITransform).setContentSize(width, 46);
  const label = node.addComponent(Label);
  label.string = text;
  label.useSystemFont = true;
  label.fontSize = size;
  label.lineHeight = Math.round(size * 1.3);
  label.horizontalAlign = Label.HorizontalAlign.CENTER;
  label.verticalAlign = Label.VerticalAlign.CENTER;
  label.color = CREAM;
  return label;
}

function drawSpeaker(graphics: Graphics): void {
  graphics.clear();
  graphics.fillColor = GOLD;
  graphics.rect(-24, -8, 11, 16);
  graphics.fill();
  graphics.moveTo(-13, -8);
  graphics.lineTo(0, -20);
  graphics.lineTo(0, 20);
  graphics.lineTo(-13, 8);
  graphics.close();
  graphics.fill();
  graphics.strokeColor = GOLD;
  graphics.lineWidth = 4;
  graphics.arc(2, 0, 13, -0.85, 0.85, false);
  graphics.stroke();
  graphics.arc(2, 0, 22, -0.78, 0.78, false);
  graphics.stroke();
}

function makeSlider(
  panel: Node,
  name: string,
  y: number,
  caption: string,
  getValue: VolumeGetter,
  setValue: VolumeSetter,
): void {
  addLabel(panel, `${name}Caption`, caption, -126, y + 40, 25, 170);
  const percent = addLabel(panel, `${name}Percent`, "", 148, y + 40, 23, 90);
  percent.color = GOLD;

  const track = new Node(name);
  track.layer = panel.layer;
  panel.addChild(track);
  track.setPosition(52, y);
  const trackTransform = track.addComponent(UITransform);
  trackTransform.setContentSize(TRACK_W, 54);

  const rail = track.addComponent(Graphics);
  rail.fillColor = new Color(24, 18, 12, 255);
  rail.roundRect(-TRACK_W / 2, -7, TRACK_W, 14, 7);
  rail.fill();
  rail.strokeColor = new Color(154, 112, 54, 255);
  rail.lineWidth = 2;
  rail.roundRect(-TRACK_W / 2, -7, TRACK_W, 14, 7);
  rail.stroke();

  const fill = new Node("fill");
  fill.layer = track.layer;
  track.addChild(fill);
  fill.addComponent(UITransform).setContentSize(TRACK_W, 18);
  const fillGraphics = fill.addComponent(Graphics);

  const knob = new Node("knob");
  knob.layer = track.layer;
  track.addChild(knob);
  knob.addComponent(UITransform).setContentSize(42, 42);
  const knobGraphics = knob.addComponent(Graphics);
  knobGraphics.fillColor = GOLD;
  knobGraphics.circle(0, 0, 17);
  knobGraphics.fill();
  knobGraphics.strokeColor = INK;
  knobGraphics.lineWidth = 3;
  knobGraphics.circle(0, 0, 17);
  knobGraphics.stroke();

  const redraw = () => {
    const value = Math.max(0, Math.min(1, getValue()));
    fillGraphics.clear();
    fillGraphics.fillColor = new Color(54, 156, 76, 255);
    fillGraphics.roundRect(-TRACK_W / 2, -6, TRACK_W * value, 12, 6);
    fillGraphics.fill();
    knob.setPosition(-TRACK_W / 2 + TRACK_W * value, 0);
    percent.string = `${Math.round(value * 100)}%`;
  };

  const ui = new Vec2();
  const world = new Vec3();
  const local = new Vec3();
  const update = (event: EventTouch) => {
    event.propagationStopped = true;
    event.getLocation(ui);
    world.set(ui.x, ui.y, 0);
    trackTransform.convertToNodeSpaceAR(world, local);
    setValue((local.x + TRACK_W / 2) / TRACK_W);
    redraw();
  };
  track.on(Node.EventType.TOUCH_START, update);
  track.on(Node.EventType.TOUCH_MOVE, update);
  track.on(Node.EventType.TOUCH_END, update);
  redraw();
}

/** 安装右上角音量按钮；背景音乐与其余音效分别调节。 */
export function installVolumeControl(parent: Node): Node {
  const existing = parent.getChildByName("VolumeControl");
  if (existing) return existing;

  const root = new Node("VolumeControl");
  root.layer = parent.layer;
  parent.addChild(root);
  root.addComponent(UITransform).setContentSize(94, 70);
  const widget = root.addComponent(Widget);
  widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
  widget.isAlignRight = true;
  widget.right = 150;
  widget.isAlignTop = true;
  widget.top = 38;
  const parentSize = parent.getComponent(UITransform)?.contentSize;
  if (parentSize) {
    root.setPosition(parentSize.width / 2 - widget.right - 47, parentSize.height / 2 - widget.top - 35);
  }
  widget.updateAlignment();

  const buttonBg = root.addComponent(Graphics);
  buttonBg.fillColor = new Color(44, 28, 16, 230);
  buttonBg.roundRect(-45, -32, 90, 64, 16);
  buttonBg.fill();
  buttonBg.strokeColor = GOLD;
  buttonBg.lineWidth = 3;
  buttonBg.roundRect(-45, -32, 90, 64, 16);
  buttonBg.stroke();
  const icon = new Node("Speaker");
  icon.layer = root.layer;
  root.addChild(icon);
  icon.addComponent(UITransform).setContentSize(60, 52);
  const fallback = icon.addComponent(Graphics);
  drawSpeaker(fallback);
  const image = new Node("Image");
  image.layer = root.layer;
  icon.addChild(image);
  image.addComponent(UITransform).setContentSize(72, 55);
  const sprite = image.addComponent(Sprite);
  sprite.sizeMode = Sprite.SizeMode.CUSTOM;
  sprite.type = Sprite.Type.SIMPLE;
  clearUiSpriteCache("volume-icon");
  void loadUiSpriteFrame("volume-icon").then((frame) => {
    if (!frame || !sprite.isValid) return;
    sprite.spriteFrame = frame;
    fallback.enabled = false;
  });
  const button = root.addComponent(Button);
  button.transition = Button.Transition.SCALE;
  button.zoomScale = 0.94;
  button.duration = 0.08;

  const panel = new Node("VolumePanel");
  panel.layer = root.layer;
  root.addChild(panel);
  panel.setPosition(-175, -188);
  panel.addComponent(UITransform).setContentSize(PANEL_W, PANEL_H);
  panel.addComponent(BlockInputEvents);
  const panelBg = panel.addComponent(Graphics);
  panelBg.fillColor = new Color(42, 26, 14, 246);
  panelBg.roundRect(-PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H, 22);
  panelBg.fill();
  panelBg.strokeColor = GOLD;
  panelBg.lineWidth = 4;
  panelBg.roundRect(-PANEL_W / 2, -PANEL_H / 2, PANEL_W, PANEL_H, 22);
  panelBg.stroke();

  addLabel(panel, "Title", "音量设置", 0, 104, 30, 300).color = GOLD;
  makeSlider(panel, "BgmSlider", 32, "背景音乐", getBgmVolume, setBgmVolume);
  makeSlider(panel, "SfxSlider", -72, "其他音效", getSfxVolume, setSfxVolume);
  panel.active = false;

  root.on(Button.EventType.CLICK, () => {
    playButtonSfx();
    panel.active = !panel.active;
    if (panel.active) panel.setSiblingIndex(root.children.length - 1);
  });
  return root;
}

