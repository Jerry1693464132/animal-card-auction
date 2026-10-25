/** 模式积分配置 */
export interface ModeScoreConfig {
  modeId: string;
}

export const MODE_SCORE: Record<string, ModeScoreConfig> = {
  dou_dizhu: {
    modeId: "dou_dizhu",
  },
};

/**
 * 积分赛名次底分 500。无炸弹、未加倍时即最终加减分。
 * 三人：第 1 +500，其余各 -188。
 * 四人：第 1、第 2 各 +500，其余各 -375。
 * 开局加倍 ×2 / 超级加倍 ×4 只乘在该玩家身上；四张及以上炸弹或王炸整桌再 ×2。
 */
export const RANKED_BASE_SCORE = 500;

/** 新账号初始段位分 */
export const INITIAL_SCORE = 4000;

export function rankedPlaceDelta(playerCount: number, rank: number): number {
  if (playerCount === 3) return rank === 1 ? RANKED_BASE_SCORE : -188;
  if (playerCount === 4) return rank <= 2 ? RANKED_BASE_SCORE : -375;
  throw new Error(`Ranked settlement only supports 3 or 4 players, got ${playerCount}`);
}

/** 负分每日恢复目标分：Steam 买断制，负分玩家次日（UTC）自动回 0 */
export const DAILY_RESTORE_SCORE = 0;

