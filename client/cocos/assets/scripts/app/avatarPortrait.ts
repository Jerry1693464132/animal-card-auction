/**
 * 加载 docs/art 同步到 resources/avatars 的立绘。
 * 路径：assets/resources/avatars/{id}.jpg
 */
import {
  Color,
  Graphics,
  Mask,
  Node,
  Sprite,
  SpriteFrame,
  UIOpacity,
  UITransform,
  assetManager,
  resources,
  ImageAsset,
} from "cc";

const cache = new Map<string, SpriteFrame | null>();
const waiters = new Map<string, Array<(sf: SpriteFrame | null) => void>>();

function candidatePaths(id: string): string[] {
  return [
    `avatars/${id}.jpg/spriteFrame`,
    `avatars/${id}.png/spriteFrame`,
    `avatars/${id}/spriteFrame`,
    `avatars/${id}`,
  ];
}

export function loadAvatarSpriteFrame(id: string): Promise<SpriteFrame | null> {
  if (cache.has(id)) return Promise.resolve(cache.get(id) ?? null);

  return new Promise((resolve) => {
    let list = waiters.get(id);
    if (list) {
      list.push(resolve);
      return;
    }
    list = [resolve];
    waiters.set(id, list);

    const paths = candidatePaths(id);
    let i = 0;
    const finish = (sf: SpriteFrame | null) => {
      cache.set(id, sf);
      waiters.delete(id);
      for (const w of list!) w(sf);
    };
    const tryNext = () => {
      if (i >= paths.length) {
        finish(null);
        return;
      }
      const path = paths[i++];
      resources.load(path, SpriteFrame, (err, sf) => {
        if (!err && sf) finish(sf);
        else tryNext();
      });
    };
    tryNext();
  });
}

export function preloadAllAvatars(ids: string[]): void {
  cache.clear();
  waiters.clear();
  for (const id of ids) void loadAvatarSpriteFrame(id);
}

export function ensureAvatarPortrait(
  parent: Node,
  name: string,
  size: number,
): Node {
  let root = parent.getChildByName(name);
  if (!root) {
    root = new Node(name);
    root.layer = parent.layer;
    parent.addChild(root);
    root.addComponent(UITransform).setContentSize(size, size);

    const maskNode = new Node("mask");
    maskNode.layer = root.layer;
    root.addChild(maskNode);
    maskNode.addComponent(UITransform).setContentSize(size - 6, size - 6);
    const mask = maskNode.addComponent(Mask);
    mask.type = Mask.Type.GRAPHICS_ELLIPSE;

    const sil = new Node("sil");
    sil.layer = maskNode.layer;
    maskNode.addChild(sil);
    sil.addComponent(UITransform).setContentSize(size - 6, size - 6);
    sil.addComponent(Graphics);
    sil.addComponent(UIOpacity);

    const img = new Node("img");
    img.layer = maskNode.layer;
    maskNode.addChild(img);
    img.addComponent(UITransform).setContentSize(size - 6, size - 6);
    const sp = img.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;

    const ring = new Node("ring");
    ring.layer = root.layer;
    root.addChild(ring);
    ring.addComponent(UITransform).setContentSize(size, size);
    ring.addComponent(Graphics);

    const veil = new Node("veil");
    veil.layer = root.layer;
    root.addChild(veil);
    veil.addComponent(UITransform).setContentSize(size - 6, size - 6);
    veil.addComponent(Graphics);
    veil.addComponent(UIOpacity);
  } else {
    root.getComponent(UITransform)?.setContentSize(size, size);
  }
  return root;
}

export function paintAvatarRing(
  root: Node,
  opts: { equipped?: boolean; unlocked?: boolean; size?: number },
): void {
  const size = opts.size ?? root.getComponent(UITransform)?.contentSize.width ?? 88;
  const r = size / 2 - 1;
  const ring = root.getChildByName("ring")?.getComponent(Graphics);
  if (ring) {
    ring.clear();
    const equipped = !!opts.equipped;
    const unlocked = opts.unlocked !== false;
    ring.strokeColor = equipped
      ? new Color(255, 208, 96, 255)
      : unlocked
        ? new Color(212, 180, 96, 200)
        : new Color(90, 90, 90, 220);
    ring.lineWidth = equipped ? 10 : 4;
    ring.circle(0, 0, r);
    ring.stroke();
    if (equipped) {
      ring.strokeColor = new Color(255, 240, 170, 220);
      ring.lineWidth = 3;
      ring.circle(0, 0, r - 5);
      ring.stroke();
    }
  }
  const veil = root.getChildByName("veil");
  const vg = veil?.getComponent(Graphics);
  const vo = veil?.getComponent(UIOpacity);
  if (vg && vo) {
    vg.clear();
    if (opts.unlocked === false) {
      vo.opacity = 255;
      vg.fillColor = new Color(0, 0, 0, 130);
      vg.circle(0, 0, Math.max(8, r - 3));
      vg.fill();
    } else {
      vo.opacity = 0;
    }
  }
}

export async function applyAvatarPortrait(
  root: Node,
  avatarId: string,
  opts?: { equipped?: boolean; unlocked?: boolean; size?: number },
): Promise<void> {
  const size = opts?.size ?? 88;
  root.getComponent(UITransform)?.setContentSize(size, size);
  const mask = root.getChildByName("mask");
  mask?.getComponent(UITransform)?.setContentSize(size - 6, size - 6);
  const img = mask?.getChildByName("img");
  img?.getComponent(UITransform)?.setContentSize(size - 6, size - 6);
  const sp = img?.getComponent(Sprite);
  const sf = await loadAvatarSpriteFrame(avatarId);
  hidePortraitSilhouette(root);
  if (sp) {
    if (sf) {
      sp.spriteFrame = sf;
      sp.color = new Color(255, 255, 255, 255);
    }
  }
  paintAvatarRing(root, {
    equipped: opts?.equipped,
    unlocked: opts?.unlocked,
    size,
  });
}

const remoteCache = new Map<string, SpriteFrame | null>();

export function loadRemoteSpriteFrame(url: string): Promise<SpriteFrame | null> {
  if (!url) return Promise.resolve(null);
  if (remoteCache.has(url)) return Promise.resolve(remoteCache.get(url) ?? null);
  return new Promise((resolve) => {
    const finish = (sf: SpriteFrame | null) => {
      remoteCache.set(url, sf);
      resolve(sf);
    };
    const tryLoad = (target: string, ext: string) => {
      assetManager.loadRemote<ImageAsset>(target, { ext }, (err, imageAsset) => {
        if (err || !imageAsset) {
          finish(null);
          return;
        }
        const sf = SpriteFrame.createWithImage(imageAsset);
        finish(sf);
      });
    };
    tryLoad(url, ".jpg");
  });
}

function hidePortraitSilhouette(root: Node): void {
  const sil = root.getChildByName("mask")?.getChildByName("sil");
  const g = sil?.getComponent(Graphics);
  const op = sil?.getComponent(UIOpacity);
  if (g) g.clear();
  if (op) op.opacity = 0;
}

/** 远程资料位空态：头+肩剪影，绝不回填局内动物 */
function paintRemoteSilhouette(root: Node, size: number): void {
  const mask = root.getChildByName("mask");
  let sil = mask?.getChildByName("sil");
  if (!sil && mask) {
    sil = new Node("sil");
    sil.layer = mask.layer;
    mask.insertChild(sil, 0);
    sil.addComponent(UITransform).setContentSize(size - 6, size - 6);
    sil.addComponent(Graphics);
    sil.addComponent(UIOpacity);
  }
  const inner = Math.max(8, (size - 6) / 2);
  sil?.getComponent(UITransform)?.setContentSize(size - 6, size - 6);
  const g = sil?.getComponent(Graphics);
  const op = sil?.getComponent(UIOpacity);
  if (op) op.opacity = 255;
  if (!g) return;
  g.clear();
  g.fillColor = new Color(72, 52, 36, 255);
  g.circle(0, 0, inner);
  g.fill();
  g.fillColor = new Color(236, 216, 176, 255);
  g.circle(0, inner * 0.22, inner * 0.34);
  g.fill();
  g.ellipse(0, -inner * 0.52, inner * 0.7, inner * 0.46);
  g.fill();
}

/** 左上角资料条：远程头像（Steam 正式版为 Steam 头像）；无 URL 时用剪影占位（不跟局内动物） */
export async function applyRemotePortrait(
  root: Node,
  avatarUrl: string,
  size = 74,
): Promise<void> {
  root.getComponent(UITransform)?.setContentSize(size, size);
  const mask = root.getChildByName("mask");
  mask?.getComponent(UITransform)?.setContentSize(size - 6, size - 6);
  const img = mask?.getChildByName("img");
  img?.getComponent(UITransform)?.setContentSize(size - 6, size - 6);
  const sp = img?.getComponent(Sprite);
  let photo: SpriteFrame | null = null;
  if (avatarUrl) photo = await loadRemoteSpriteFrame(avatarUrl);
  if (sp) {
    if (photo) {
      sp.spriteFrame = photo;
      sp.color = new Color(255, 255, 255, 255);
      hidePortraitSilhouette(root);
    } else {
      sp.spriteFrame = null;
      paintRemoteSilhouette(root, size);
    }
  } else {
    paintRemoteSilhouette(root, size);
  }
  paintAvatarRing(root, { equipped: true, unlocked: true, size });
}
