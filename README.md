# 像素五子棋(pixel-gomoku)

像素复古风联机五子棋:15×15 棋盘,两人通过房间号联机对战,支持断线重连、悔棋、求和、聊天,以及可选的前端 AI 提示。

## ✨ 特性

- **房间制联机**:4 位房间号,创建 / 加入即可对战,WebSocket 实时同步
- **断线重连**:掉线 60 秒内凭玩家 ID 回到原房间,对局不中断
- **完整对局流程**:悔棋(需对方同意)、求和、认输、重开(双方交换黑白)
- **聊天系统**:自由聊天 + 快捷消息气泡;催棋 3 次自动判负
- **像素风渲染**:Canvas 手绘棋盘棋子,复古 UI,落子音效
- **AI 提示(房主开关)**:对局中一键获取推荐落点,纯前端计算,无需联网调接口

## 🧠 AI 说明

AI 模块位于 `public/ai/`,为浏览器端 ES Modules,对局中点击 **AI 提醒** 按钮时同步计算(约 1 秒,期间页面短暂冻结属正常)。

算法组成:

| 模块 | 作用 |
| --- | --- |
| `board.mjs` | 棋盘常量、候选点生成、胜负判断 |
| `evaluate.mjs` | 棋型识别(活四/冲四/跳四/活三/眠三…)+ 叶子威胁判定(冲四+活三等强制胜/负局面) |
| `search.mjs` | Negamax + Alpha-Beta 剪枝 + 迭代加深 |
| `index.mjs` | 入口,暴露 `window.GomokuAI.bestMove(board, color)` |

搜索层核心优化:

- **Zobrist 置换表**:双 32 位哈希合成精确整数键,缓存局面避免重复搜索
- **历史启发式**:被剪枝的走法加权,后续排序更准
- **威胁延伸搜索**:落子成四时强制延伸深度,只搜挡点,可算出连续冲四(VCF)杀棋
- **走法排序**:棋型单点分 + 跳子加成,配合 TT 走法优先,大幅提升剪枝效率

## 🚀 快速开始

```bash
npm install
node server.js
```

浏览器打开 <http://localhost:3000>(端口被占用时可 `PORT=3001 node server.js`)。

需要 Node.js 14+。仅依赖 [`ws`](https://www.npmjs.com/package/ws)。

## 🎮 玩法

1. **创建**:输入昵称,可选自定义 4 位房间号,勾选"允许 AI 提醒"后点击创建
2. **加入**:把房间号发给朋友,对方输入房间号加入,对局立即开始
3. **规则**:15×15 棋盘,黑先,连五即胜;无禁手、无长连规则
4. **功能按钮**:悔棋 / 求和 / 认输 / AI 提醒(房主开启后双方可见)

## ☁️ 部署到 Render

仓库根目录自带 [`render.yaml`](render.yaml),Render 控制台 **New + → Blueprint** 一键部署;也可手动创建 Web Service:

| 配置项 | 值 |
| --- | --- |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `node server.js` |
| 环境变量 | 无需设置(PORT 由 Render 自动注入) |

> ⚠️ Render 免费版闲置约 15 分钟后休眠,冷启动约需 1 分钟,且休眠期间内存中的对局房间会丢失。如需长期在线请使用付费计划。

## 📁 项目结构

```
pixel-gomoku/
├── server.js           # HTTP 静态服务 + WebSocket 对局逻辑(房间/落子/重连)
├── render.yaml         # Render 一键部署配置
└── public/
    ├── index.html      # 页面结构
    ├── style.css       # 像素复古风样式
    ├── client.js       # 前端逻辑(渲染、对局交互、聊天)
    └── ai/             # 前端 AI(ES Modules)
        ├── board.mjs   # 棋盘工具
        ├── evaluate.mjs # 局面评估与棋型识别
        ├── search.mjs  # 搜索算法
        └── index.mjs   # 全局入口 GomokuAI
```

## 🛠 技术栈

- 后端:Node.js + `ws`(原生 `http` + `fs` 做静态服务,零框架)
- 前端:原生 JavaScript + Canvas,无构建步骤
- 部署:Render(Blueprint)
