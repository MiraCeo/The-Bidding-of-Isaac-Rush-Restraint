# 以撒的竞合：冲 · 慎

*The Bidding of Isaac: Rush & Restraint*

一款围绕 **20 人共同市场、秘密报价、资源管理和连续道具构筑** 展开的短局博弈游戏。当前可游玩原型采用 **1 名真人玩家 + 19 名 AI**，全部对局与 AI 逻辑在玩家浏览器中执行，不需要业务后端。

> 本项目是非官方同人创作，与 *The Binding of Isaac* 的作者、发行商及相关权利方无隶属或认可关系。项目不会直接使用原作受版权保护的美术、音频或代码资源。

## 当前状态

> 更新日期：2026-10-10；最新统计与研究：[v26 20人格生态](./模拟报告_20人格生态研究_v26.md)。170项测试和构建通过；14条件×2种子共56,000局研究，另5,000局默认回归与v25关键指标完全一致。孤注一掷不纳入本轮，正式参数保持原样。

完整客户端已经接通：**角色选择 → 房间行动 → 提交并立即结算 → 积分排行／争夺榜 → 下一房间 → 最终排行 → 重新开始**。项目不再只是单房操作界面。

| 项目 | 当前口径 |
| --- | --- |
| 对局 | 20 人，三层各五房，共 15 房 |
| 基础资金 | 100 / 500 / 1000；换层重置资金，保留积分和道具 |
| 核心行动 | 正常竞拍、扰乱市场、静观其变；竞与合是正常竞拍的不同目标 |
| 共同市场 | A/B 共用基准线；双行动贡献两个有效市场样本 |
| 奖励 | 每组高价前 20% 与合作区最近的一半；扰乱占位轮空，重复资格不顺延 |
| 房间倍率 | 普通／商店 ×1，宝箱 ×1.5，隐藏／BOSS ×2 |
| 构筑 | 五个角色、26 件道具、屏障、条件式双行动与终局王冠结算 |
| AI | 均衡 9、合作 5、混乱 5；五行为概率决策、公开历史与动态报价 |
| 人格 | 已实现 21 种，正式随机池 20 种；每名 AI 2～4 种，孤注一掷仅实验启用 |
| 随机 | 可注入种子；行为权重扰动 ±10%，报价通常 ±5%、赌徒 ±15% |
| 数值 | 资金为非负整数；积分与基准线保存四位小数、通常显示两位 |

### 已具备

- 行动合法性、名义报价／实际扣款／市场等价／计分等价的独立处理。
- 房间生成、宝箱问号信息隔离、角色初始构筑、库存与事件化结算。
- AI 局势分析、道具估值、个人预测、机会预算与可停止的第二行动判断。
- 完整三层客户端状态机与规则、AI、角色、结算、模拟和客户端自动化测试文件。
- 通用模拟及专项运行器；v23～v25保留历史对照，最新v26完成20人格的14条件多种子研究和默认回归，均每局19 AI。
- Vite 开发／构建脚本，以及本地 Docker + Nginx 静态分发配置。
- 七项一致性工作全部完成：初始屏障、零权重过滤、心脏累乘、结算分解、尾巴自身排除，以及三件功能道具明确不叠加、福袋仅正常竞拍返款。
- 研究工具已分开原始／追溯／最终房分；支持固定人格档案消融、玩家／房间随机流、赌徒噪声隔离和角色预算实验。实验开关不在正式客户端启用。

### 尚未完成

本地存档、继续游戏、完整回放、离线下载包、云部署与正式发布流程、移动端适配。行动页的顶栏排行、设置、规则仍是禁用占位；结算后的两种榜单已实现。

规则对象包含人数、房间数和资金等配置，但客户端仍按固定的 19 AI 槽位、三层五房运行，不能只改配置就认为支持任意对局布局。设计与实现的边界差异见 [文档与实现差异](./文档与实现差异.md)，后续任务见 [TODO](./TODO.md)。

## 文档入口

完整分类、阅读顺序和 v1～v26 实验时间线见 **[文档索引](./文档索引.md)**。研究复测见 [20人格方案](./20人格生态研究方案.md)，扩池准入见 [道具检查清单](./道具扩充检查清单.md)。

旧版说明与 v1～v25 报告已集中在 **[历史文档](./历史文档/README.md)**；根目录保留现行规范和最新 v26 研究。

- [基础机制](./以撒的竞合_基础机制开发大纲.md)与[游戏端流程](./游戏端流程_v1.md)
- [角色系统](./角色系统_v1.md)、[道具池](./道具与道具池_v1.md)、[道具与结算](./首批道具与结算流程_v1.md)
- [AI 现行决策](./AI决策系统_现行说明.md)、[主义](./AI主义模块_v1.md)、[人格](./AI人格模块_v1.md)、[现行报价](./报价决策系统_v2.md)

AI 决策 v2/v3、报价 v1 和历次模拟报告均保留为历史记录，不替代现行说明。尤其是 v16 之前的最高价扰乱占位结论，不适用于修正后的规则。

## 本地开发

需要 Node.js 22.13 或更高版本。技术栈为 React 19、TypeScript、Vite、Tailwind CSS 与 Vitest。

```powershell
Set-Location -LiteralPath 'D:\The Bidding of Isaac\web'
npm install
npm run dev
```

默认访问 [http://localhost:3000](http://localhost:3000)。

## 验证与模拟

### 规则测试与生产构建

```powershell
Set-Location -LiteralPath 'D:\The Bidding of Isaac\web'
npm test
npm run build
```

生产构建先运行 TypeScript 类型检查，再输出静态资源至 `web/dist`。未设置对应局数环境变量时，报告型大批量模拟测试默认跳过；普通规则和客户端测试仍会运行。

### 通用 19 AI 混合模拟

```powershell
Set-Location -LiteralPath 'D:\The Bidding of Isaac\web'
$env:SIM_GAMES = '5000'
$env:SIM_SEED = '20260908'
$env:SIM_AI_COUNT = '19'
$env:SIM_DISTRIBUTION = '9,5,5'
$env:SIM_SITUATION = '1'
$env:SIM_ITEMS = '1'
$env:SIM_PERSONALITIES = '1'
$env:SIM_PERSONALITY_MIN = '2'
$env:SIM_PERSONALITY_MAX = '4'
$env:SIM_DOUBLE_ACTIONS = '1'
npm run simulate
```

这运行的是无真人的 19 AI 统计实验，不是 1 真人 + 19 AI 的客户端对局。`npm run simulate` 未设置 `SIM_GAMES` 时不会自动执行 5,000 局。以上环境变量仅作用于当前 PowerShell 会话。

### v23 三组人格池对照入口

```powershell
Set-Location -LiteralPath 'D:\The Bidding of Isaac\web'
$env:SIM_PERSONALITY_POOL_GAMES = '5000'
$env:SIM_PERSONALITY_POOL_SEED = '20260908'
npx vitest run lib/game/simulation.personality-pool-comparison.report.test.ts --reporter=verbose
```

运行器固定比较原 15 种、正式 20 种与完整 21 种人格池，各组 19 AI、9/5/5 主义人口。上述命令使用当前代码；以后修改规则后，不保证重现历史报告的数值。

## 本地 Docker

仓库已经包含多阶段 Dockerfile、Compose 端口映射与 Nginx 配置；尚未完成云端托管及正式发布流程。

在仓库根目录执行：

```powershell
docker compose up --build
```

随后访问 [http://localhost:3000](http://localhost:3000)。容器负责分发静态网页；对局、AI 和随机状态仍在浏览器中执行。当前客户端状态保存在内存中，刷新后不会自动恢复对局。

停止容器：

```powershell
docker compose down
```

## 代码导航

| 位置 | 职责 |
| --- | --- |
| `web/main.tsx`、`web/components/game/game-app.tsx` | 应用入口与页面分发 |
| `web/lib/game/client-session.ts` | 整局状态机、AI 初始化、秘密提交、房间推进与终局 |
| `web/lib/game/config.ts` | 公共规则参数 |
| `web/lib/game/rooms.ts`、`characters.ts` | 房间与角色生成 |
| `web/lib/game/turns.ts`、`room-engine.ts` | 行动合法性、报价换算与房间结算 |
| `web/lib/game/item-scoring.ts`、`room-economy.ts` | 积分、终局倍率与房间经济 |
| `web/lib/game/ai-decision.ts`、`ai-analysis.ts`、`ai-personality.ts`、`ai-quote.ts` | AI 决策、分析、人格与报价 |
| `web/lib/game/simulation.ts`、`*.test.ts` | 批量模拟与自动化测试 |
| `web/components/game/`、`web/app/globals.css` | 游戏界面与样式 |
| `历史文档/` | 过时说明与历次旧模拟报告，不属于现行规则 |

## Git 工作方式

`main` 分支保持可运行。功能开发使用短期分支，并在合并前运行测试和生产构建；发布标签采用 `v0.x.y`。仅文档整理不得顺带修改游戏规则或参数。
