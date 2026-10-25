import { MatchPlayerView, RoomSnapshot } from "../net/Protocol";

/** 结算页全员继续：在当前 Auction 画布上恢复拍卖，避免同场景 loadScene 把节点图拆穿。 */
export const RESUME_AUCTION_EVENT = "pc-resume-auction";

export function isAuctionPhase(view: MatchPlayerView | null | undefined): boolean {
  if (!view) return false;
  const phase = view.public?.phase ?? "";
  if (phase === "auction") return true;
  return !!view.auction && phase !== "dealing" && phase !== "playing" && phase !== "finished";
}

export function isTablePhase(view: MatchPlayerView | null | undefined): boolean {
  const phase = view?.public?.phase ?? "";
  return phase === "dealing" || phase === "playing" || phase === "finished";
}

/** 对局仍在房间内进行时才切拍卖/牌桌；结算后房间回到 lobby，不再自动跳回牌桌。 */
export function shouldEnterAuction(
  view: MatchPlayerView | null | undefined,
  room: RoomSnapshot | null | undefined,
): boolean {
  return room?.phase === "in_match" && isAuctionPhase(view);
}

export function shouldEnterTable(
  view: MatchPlayerView | null | undefined,
  room: RoomSnapshot | null | undefined,
): boolean {
  return room?.phase === "in_match" && isTablePhase(view);
}
