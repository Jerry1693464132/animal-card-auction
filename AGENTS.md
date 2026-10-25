# AGENTS.md — Animal Card Auction（动物牌场拍卖行）

给后续 AI / 协作者的入口说明。

## 新会话怎么接

直接说：**「按 AGENTS.md 继续」**。不必重讲产品规则。

| 要找什么 | 去哪 |
|----------|------|
| 短口径（AI 始终带） | `.cursor/rules/party-cards-overview.mdc` |
| 上下文怎么路由 | `.cursor/rules/context-routing.mdc` |
| 完整设计文档 | [docs/游戏设计文档.md](docs/游戏设计文档.md) |
| 斗地主 / 积分 / 协议 / Cocos | `.cursor/rules/` 下对应 `.mdc` |

改玩法：先改 overview（+ GDD），再改引擎与客户端。聊天口头改口径不算数。

## 这是什么

**动物牌场拍卖行**（工程名 Animal Card Auction，历史代号 Party Cards）：派对卡通棋牌，目标平台 **Steam（Windows 桌面）**。流程：主界面 → 斗地主 → 选 3/4 人开房或匹配（分队列、满员开局）→ 拍卖 → 打牌 → 结算。主界面不选动物形象；局内椅位动物固定（三人熊猫/狐狸/猫头鹰，四人再加兔子），入座即扮演。三人场兔子椅标「观众」。

> 平台已从微信小游戏切到 Steam：微信登录 / 云托管 / 开放数据域 / 激励广告已移除。
> 登录改用游客（本机 playerId）→ 上架前接 Steamworks；好友榜改为本地排行榜；负分每日恢复至 0。

## 当前能跑什么

```bash
npm test          # 单元测试
npm run typecheck
npm run free-port # 释放 8787（可选；npm run dev 会先执行）
npm run dev       # http://127.0.0.1:8787 调试台 + ws
```

若仍报 `EADDRINUSE`：`npm run free-port` 后再 `npm run start`，或 `set PORT=8788 && npm run start`。

断线重连：对局中断开后用**同一 playerId** 再 `hello`，服务端会补发 `room` / `match` / `score`。

## 代码地图

| 区域 | 路径 |
|------|------|
| 牌型/牌堆 | `src/dou-dizhu/{analyzer,comparator,deck,types,rank}.ts` |
| 拍卖 | `src/dou-dizhu/auction/` |
| 对局+道具 | `src/dou-dizhu/match/` |
| 积分+房间 | `src/score/`（含每日恢复至 0） |
| 形象 | `src/avatar/`（解锁目录仅熊猫；椅位动物 `seatRoles.ts`）；立绘参考 `docs/art/avatars/` |
| 网络 | `src/server/`（hello 游客登录，无微信） |
| 调试 UI | `client/debug/` |
| Cocos 客户端 | `client/cocos/` |

## 改代码时

1. 规则变更：引擎 + Vitest  
2. 协议变更：`protocol.ts` + `hub` + `client/debug/app.js`（+ Cocos `Protocol.ts`）  
3. 不要把权威逻辑放到客户端  

## Cocos + Cursor MCP

- 正式客户端工程：`client/cocos`（Creator 3.8.8 · 项目名 `animal-card-auction-client`）
- 场景：`assets/scenes/Main.scene`（主界面）→ `DouDizhuLobby.scene`（同屏选 3/4 人 + 匹配/开房/加入）→ `Auction.scene`（拍卖）→ `Table.scene`（打牌 / 结算）
- 脚本：`assets/scripts/{app,net,ui,platform}/`（`bootNet()` 直连 `ws://127.0.0.1:8787`，只发意图；本机 playerId 登录；`serverConfig.ts` 支持注入 `__PARTY_CARDS_SERVER_URL__` 连海外 VPS）
- 选场大厅对齐 `docs/mockups/mockup-lobby-16x9.png`：绿毡上同屏两步；资料条是头像昵称 + 积分
- Cursor MCP：`.cursor/mcp.json` → `funplay_cocos` @ `http://127.0.0.1:8765/`；Creator 须保持打开
- 本地联调：先 `npm run dev`，再在 Creator 预览 Main
- Windows 桌面构建：构建面板选 Windows 平台（任务已配置：启动场景 Main，含 4 场景；产物 `build/windows`）
  - **前置依赖：本机必须装 Visual Studio 2022（Community 即可），且必须勾选「使用 C++ 的桌面开发」工作负载**（含 MSVC 编译器 + Windows SDK + MSBuild）。只装 VS 不装 C++ 负载时，cmake 报 `could not find any instance of Visual Studio` / `No CMAKE_CXX_COMPILER`
  - **VS 版本必须 ≤ 2022（v17）**：Cocos 3.8.8 内置 cmake 3.24.3 只识别到 VS 2022；装了 VS 2026（v18）仍会报找不到 VS。两者可共存，构建走 2022
  - **`websocket` 引擎模块必须开启**（`settings/v2/packages/engine.json` → `modules.configs.defaultConfig.cache.websocket._value = true`，并在 `includeModules` 里含 `"websocket"`）。它映射到 cmake `USE_SOCKET`；关闭时原生 `new WebSocket()` 抛异常并崩溃（退出码 `0xC0000005`），日志表现为 `Uncaught Exception` 指向 `WsClient.ts`。改后需重新构建以重生成 `build/windows/proj/cfg.cmake`
  - 引擎 / 脚本 / 资源已构建成功并缓存（`%LocalAppData%\Temp\CocosCreator\3.8.8\builder\engine\`），装好 C++ 负载后重新构建只跑 cmake+编译，快很多
 - **禁止 `cc.EditBox`**：Windows 原生 EditBox 会在场景加载后 ~8s 触发 `0xC0000005` 崩溃（与 WebSocket 无关）。房间码输入框已改为纯 JS（`Label` + `input.on(KEY_DOWN)`）；场景资产里的遗留 EditBox 也已用 `scripts/strip-scene-editbox.mjs` 删净（运行时 `stripNativeEditBoxes()` 仅作兜底）。详见 `.cursor/rules/cocos-client.mdc`
 - **纯 JS 改动不用重编译 C++**：`Release/windows.exe` 日期可能比脚本旧，exe 读的是旁边 `Resources/assets/main/index.js`，构建后跑 `compile-win.bat` 刷新即可；只有改引擎模块/原生代码才需重跑 cmake
 - **构建产物场景是紧凑格式**：`build/windows/**/assets/main/import/2a/<scene-uuid>.json` 无 `__type__` 字段，类名只在 `typeDefs[i][0]`；用 `scripts/decode-built-scene.mjs` / `verify-no-editbox.mjs` 检查，别用 grep
 - **触发 Cocos 构建**：`node scripts/mcp-call.mjs call execute_javascript --args-file=temp/xxx.json`（直连 `127.0.0.1:8765`，绕过 Cursor MCP）；复用最后一个 windows 任务的 options 走 `builder/add-task`
 - **验证崩溃修复**：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-run.ps1`（临时把启动场景指到目标场景跑 35s，比对崩溃事件数，自动还原）
 - **改脚本后要跑两次**：Cocos 构建产出 `build/windows/assets/...`，而 exe 实际读 `build/windows/proj/Release/Resources/...`；构建后必须再 `compile-win.bat` 刷新副本，否则跑的是旧代码
  - 曾因 `build/windows/proj/CMakeCache.txt` 残留 NMake 生成器导致 cmake 跳过 VS 探测；如遇同样问题，删该缓存目录或换新 `buildPath`（如 `project://build-win`）
  - **构建面板的 Windows 任务只跑到 cmake 生成 `windows.sln`，不出 exe**；exe 需再跑一次编译（首次全量约 15–30 分钟）：
    ```
    "%ProgramData%\cocos\editors\Creator\3.8.8\resources\tools\cmake\bin\cmake.exe" --build "<proj>" --config Release
    ```
    产物：`build/windows/proj/Release/windows.exe`（旁边带 `v8.dll`/`SDL2.dll`/`OpenAL32.dll` 等运行时依赖，须同目录运行）
  - 联调命令：先 `npm run dev` 起服务，再运行 `build/windows/proj/Release/windows.exe`；连上后 `netstat` 可见 `127.0.0.1:8787` 与 exe 的 ESTABLISHED
  - 辅助脚本（本仓库自建，可复用）：`client/cocos/scripts/{compile-win,rebuild-win,run-game,check-build,check-conn}.bat`

## 尚未做

- 上架 Steam：Steamworks 开发者账号（$100）→ App ID → Steamworks 登录 / 排行榜 / 头像昵称替换游客 + 本地榜
- 海外 VPS 部署 Node 服务（当前直连本机 8787）
- 效果图其余入口仅商城（表情/外观）；不做任务 / 活动 / 设置 / 背包；拍卖 / 牌桌美术待做
- 买断制定价 / Steam 商店页

## Cursor Rules

- 始终：`party-cards-overview.mdc`、`context-routing.mdc`
- 斗地主：`dou-dizhu-engine.mdc`
- 联机：`server-protocol.mdc`
- 积分：`score-system.mdc`
- Cocos：`cocos-client.mdc`
