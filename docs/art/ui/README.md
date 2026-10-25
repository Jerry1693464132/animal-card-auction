# 主界面 UI 切图

| 文件 | 用途 |
|------|------|
| `main-bg.png` | 主界面全屏背景 |
| `icon-notice.png` | 右上角公告：厚金环 + 棕色圆底 3D 徽章 + 喇叭 |
| `icon-rank.png` | 右上角排行榜：厚金环 + 棕色圆底 3D 徽章 + 奖杯 |
| `lobby-bg.png` | 选场大厅背景 1920×1080：中间桌面场次/方式画在图上，四角与底栏已清空。效果图 `docs/mockups/mockup-lobby-16x9.png` **只作构图参考**，禁止整张带 HUD 效果图当背景 |
| `auction-bg.png` | 拍卖厅背景 1920×1080：椅上动物 + 静态 HUD 铬。做法与效果图相同：先生成 **上下黑边、中间 16:9 画面** 的 4:3/3:2 图，再裁掉黑边缩放到 1920×1080。禁止等比铺满裁切、禁止左右拉墙 |
| `auction-bg-letterbox-4x3-hud.png` | 带上下黑边的生成原图（工具实际多为 1536×1024）；中间是 16:9 拍卖厅 |
| `auction-bg-seated.png` | 仅椅上动物、无 HUD 的 16:9 留档（用户确认过的构图） |
| `auction-bg-raw.png` | 早期无 HUD 的 GenerateImage 原图 1536×1024，只作 cover 源 |
| `table-bg.png` | 牌桌背景 1920×1080：椅上动物 + 空道具框，无桌上扑克、无道具图标、无出牌/过按钮。效果图参考 `docs/mockups/mockup-table-items-16x9.png` |
| `cards/` | 3:4 立绘：每点 2×2 四花色出图再裁切；大小王/先手/星/炸单张同比例。详见 `cards/README.md` |

工程内副本：`client/cocos/assets/resources/ui/`  
加载：`resources.load('ui/main-bg.png/spriteFrame')`（见 `uiSkin.ts`）。无图时 MainMenu 用 Graphics 暖色拍卖厅兜底。
