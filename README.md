# 以撒的竞合：冲 · 慎

*The Bidding of Isaac: Rush & Restraint*

一款围绕 20 人共同市场、秘密报价、资源管理和连续构筑展开的短局多人博弈游戏。当前原型采用 1 名真人玩家与 19 名人机玩家，全部游戏逻辑在玩家浏览器中执行。

> 本项目是非官方同人创作，与 *The Binding of Isaac* 的作者、发行商及相关权利方无隶属或认可关系。项目不会直接使用原作受版权保护的美术、音频或代码资源。

## 当前进度

- 已建立网页工程与首个房间操作界面；
- 已参数化玩家数、层级资金、房间数和扰乱倍率；
- 已实现行动合法性、等价出价和奖励资格的规则核心；
- 已加入确定性随机数基础设施和规则单元测试；
- 基准线与积分公式仍等待从既有版本取得或由原设计者确认。

完整机制参见 [以撒的竞合_基础机制开发大纲.md](./以撒的竞合_基础机制开发大纲.md)。

## 本地开发

需要 Node.js 22.13 或更高版本。

```powershell
Set-Location -LiteralPath 'D:\The Bidding of Isaac\web'
npm install
npm run dev
```

默认访问地址为 <http://localhost:3000>。

## 验证

```powershell
Set-Location -LiteralPath 'D:\The Bidding of Isaac\web'
npm test
npm run build
```

## Docker

在仓库根目录执行：

```powershell
docker compose up --build
```

随后访问 <http://localhost:3000>。容器只负责分发和渲染网页资源；对局、AI 和存档不会上传到业务后端。

停止容器：

```powershell
docker compose down
```

## 目录

```text
web/
├─ main.tsx             浏览器应用入口
├─ app/                 全局视觉样式
├─ components/game/     游戏交互界面
├─ components/ui/       通用界面组件
└─ lib/game/            与界面无关的游戏规则核心和测试
```

## Git 工作方式

`main` 分支保持可运行。功能开发建议使用短期分支，并在合并前运行测试和生产构建。版本发布使用 `v0.x.y` 格式的 Git 标签。
