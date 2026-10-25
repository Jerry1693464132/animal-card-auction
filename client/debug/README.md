# Animal Card Auction — 调试联机

## 启动

```bash
npm run dev:server
```

浏览器打开：http://127.0.0.1:8787  

玩家 ID / 昵称会写入浏览器 localStorage；积分在服务端 `data/accounts.json`。两个窗口必须用**不同** playerId。

## 建议流程

1. 窗口 A：连接 → 勾选积分赛 → 创建房间（记下房间号）
2. 窗口 B：连接（换一个玩家 ID）→ 输入房间号 → 加入
3. 房主点「开始对局」
4. 拍卖：加价；开拍 12 秒无人出价流拍，有人出价后 4 秒无人加价成交
5. 点击手牌选中 → 出牌 / 过牌（思考 15 秒，超时跟牌自动过、领出自动出最小牌）

## 协议

WebSocket 与页面同端口。消息为 JSON，见 `src/server/protocol.ts`。
