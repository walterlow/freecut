# FreeCut 中文项目文档（开发与维护）

本文档面向希望理解、开发、维护 FreeCut 的开发者，内容基于当前仓库源码结构整理。

## 1. 项目概览

FreeCut 是一个运行在浏览器中的多轨道视频编辑器，核心特点是：

- 无需安装客户端
- 不依赖服务端转码
- 主要在本地浏览器内完成导入、编辑、预览和导出

当前版本（`package.json`）：

- `2026.04.06`

官网与仓库：

- 官网: `http://freecut.net/`
- 仓库: `https://github.com/walterlow/freecut`

## 2. 核心能力

项目已经覆盖完整的浏览器端剪辑主流程，包含：

- 多轨道时间线编辑（视频、音频、文本、图片、形状）
- 裁剪、分割、拼接、波纹删除、速度拉伸、滚动/滑移编辑等工具
- GPU 特效、GPU 转场、混合模式、遮罩、关键帧动画
- 实时预览、波形图、示波器（waveform/vectorscope/histogram）
- 浏览器端导出（WebCodecs），支持多容器和多编码
- 媒体导入、代理/缓存、字幕转写（Whisper，Web Worker）
- 项目打包导入导出（zip）

## 3. 技术栈

主要技术如下：

- `React 19` + `TypeScript`
- `Vite`（开发与构建）
- `TanStack Router`（文件路由）
- `Zustand` + `zundo`（状态管理 + 撤销重做）
- `Tailwind CSS 4` + `shadcn/ui` + `Radix UI`
- `WebGPU`（特效、合成、示波器）
- `WebCodecs`（导出/编码）
- `File System Access API` + `OPFS` + `IndexedDB`（本地存储）
- `Vitest` + `Testing Library`（测试）

## 4. 运行环境要求

## Node 与包管理

- Node.js `18+`
- npm（使用 `package-lock.json`）

## 浏览器要求

推荐：

- Chrome / Edge `113+`

原因：

- 项目依赖 `WebGPU`、`WebCodecs`、`OPFS`、`File System Access API`

Brave 额外设置：

1. 打开 `brave://flags/#file-system-access-api`
2. 设置为 `Enabled`
3. 重启浏览器

## 5. 快速开始

```bash
git clone https://github.com/walterlow/freecut.git
cd freecut
npm install
npm run dev
```

默认地址：

- 开发环境: `http://localhost:5173`
- 本地性能预览: `http://localhost:4173`

## 6. 环境变量

`.env.example` 中当前公开变量：

- `VITE_SHOW_DEBUG_PANEL=true`：开发模式下显示调试面板入口

`.env.perf` 中用于性能模式的默认值：

- `VITE_SHOW_DEBUG_PANEL=false`

## 7. 常用命令（按场景）

## 开发

- `npm run dev`：本地开发（带调试面板）
- `npm run dev:quiet`：开发模式但尽量减少调试噪音
- `npm run dev:compare`：同时启动 dev 与 perf 预览便于对比

## 构建与预览

- `npm run build`：生产构建
- `npm run build:perf`：使用 `.env.perf` 构建
- `npm run preview`：预览构建产物
- `npm run preview:perf`：固定 `4173` 端口预览
- `npm run perf`：`build:perf + preview:perf`

## 测试

- `npm run test`：Vitest watch
- `npm run test:run`：一次性跑完测试
- `npm run test:coverage`：带覆盖率
- `npm run test:preview-sync`：预览同步专项测试
- `npm run test:preview-sync:stress`：预览同步压力测试

## 代码质量/架构约束

- `npm run lint`
- `npm run check:boundaries`
- `npm run check:deps-contracts`
- `npm run check:legacy-lib-imports`
- `npm run check:deps-wrapper-health`
- `npm run check:edge-budgets`
- `npm run verify`（一键完整校验）

## 其他

- `npm run routes`：重新生成 TanStack Router 路由树
- `npm run changelog:append`
- `npm run changelog:rollup`

## 8. 目录结构与职责

当前 `src` 主体目录：

- `app/`：应用壳层与组合根（providers、布局配置、跨功能工作流状态）
- `routes/`：TanStack Router 路由入口
- `features/`：按业务能力拆分的功能模块
- `core/`：应用无关的核心规则与计算（迁移、时间线规则、缓动等）
- `infrastructure/`：浏览器/存储/平台适配层
- `shared/`：跨模块复用的通用能力（UI 基元、工具、共享 store）
- `lib/`：GPU/媒体等通用底层库
- `components/`：通用 UI 组件（含 `components/ui`）
- `types/`：类型定义

## 9. 功能模块地图（features）

`src/features` 当前重点模块：

- `editor`：编辑器壳层，整合时间线、预览、属性面板等
- `timeline`：时间线交互与编辑规则核心
- `preview`：预览区、画布交互、对齐辅助、预览状态协同
- `composition-runtime`：合成运行时组件与渲染逻辑
- `export`：导出流水线（含 Worker）
- `media-library`：媒体导入、解析、缓存、转写等
- `keyframes`：关键帧编辑、图表/Dope Sheet、插值逻辑
- `effects`：特效能力与集成
- `projects`：项目列表、创建、更新、删除、迁移展示
- `project-bundle`：项目打包导入/导出
- `settings`：用户设置与快捷键
- `player`：播放引擎相关能力
- `workspace-gate`：工作区权限门禁与切换逻辑

## 10. 路由与页面流程

关键路由：

- `/`：Landing 页
- `/projects`：项目列表页（导入、创建入口）
- `/projects/new`：新建项目页
- `/projects/$projectId`：重定向到对应编辑器路由
- `/editor/$projectId`：编辑器页（进入前检查项目存在并返回迁移状态）

典型使用流程：

1. 用户进入 `/projects`
2. 创建项目或导入项目包
3. 跳转 `/editor/$projectId`
4. 加载时间线与媒体资源
5. 编辑 + 预览 + 导出

## 11. Workspace Gate（权限门禁）机制

项目对 `/projects*` 与 `/editor*` 路由启用工作区门禁：

- 首次需要用户通过 `showDirectoryPicker` 选择可读写目录
- 会保存目录句柄并在后续会话中复用
- 如果权限撤销，会进入 reconnect 流程
- 非存储敏感路由（如 `/`）不会被门禁阻塞

这样可以保证：

- 在进入项目/编辑器前，存储层已准备完成
- 路由 loader 读取数据时不会碰到“工作区未初始化”状态

## 12. 存储架构（infrastructure/storage）

当前统一通过 `workspace-fs` 面向用户选择的工作区目录进行读写，`storage/index.ts` 提供聚合导出：

- 项目：`projects`
- 媒体：`media`
- 缩略图：`thumbnails`
- 内容引用计数：`content`
- 项目媒体关联：`project-media`
- 波形：`waveforms`
- GIF 帧缓存：`gif-frames`
- 解码预览音频：`decoded-preview-audio`
- 转写：`transcripts`
- 孤儿数据清理：`orphan-sweep`
- 软删除/回收站：`trash`

补充：

- 旧版 `video-editor-db` IndexedDB 数据仍存在迁移兼容逻辑（用于一次性迁移展示）

## 13. 分层与依赖约束（重点）

项目通过 ESLint + 自定义脚本强化边界约束，核心思想：

- `core` 保持框架无关，不依赖 React、路由和业务 feature
- `infrastructure` 不反向依赖 feature/routing
- `shared` 不依赖 app/features/routes
- feature 之间禁止随意直连，跨 feature 调用必须走 `deps/*` 适配层

例如：

- `timeline` 访问 `media-library` 时，应走 `timeline/deps/*`
- `preview` 访问 `player/timeline/export/keyframes` 时，应走 `preview/deps/*`
- `editor` 访问其他功能模块时，应走 `editor/deps/*`

这套规则配合脚本（`check:boundaries`、`check:deps-contracts`、`check:edge-budgets`）使用，可避免耦合失控。

## 14. 启动与运行时关键链路

入口大致流程：

1. `src/main.tsx`
2. 初始化 debug 工具与全局错误处理
3. 渲染 `<App />`
4. `App` 中挂载 `WorkspaceGate`、`RouterProvider`、全局 Tooltip 与 Toaster
5. 进入具体 route loader/component

另外：

- 在 `vite:preloadError` 场景中，会提示用户“先保存再刷新”，尽量避免热部署后资源失效导致工作丢失

## 15. 构建与性能策略（Vite 配置重点）

`vite.config.ts` 中可以看到几个关键策略：

- 配置 `@ -> ./src` 别名
- dev server 固定 `5173` 且 `strictPort=true`
- 开启 `COEP/COOP` 响应头（支持相关浏览器能力）
- 根据模块职责手动分包（manualChunks），降低循环依赖导致的 TDZ 风险
- 对超大但可预期的媒体解码包提高 chunk 警告阈值
- 为 `lucide-react` 做 dev 预打包优化

## 16. 测试策略

测试配置（`vitest.config.ts`）：

- 环境：`jsdom`
- setup：`src/test/setup.ts`
- 用例匹配：`src/**/*.test.{ts,tsx}`
- 覆盖率：`v8`，输出 `text/json/html`

建议本地至少执行：

1. `npm run lint`
2. `npm run test:run`
3. `npm run build`
4. 提交前跑 `npm run verify`

## 17. 推荐开发工作流

1. `npm run dev` 开发
2. 功能完成后跑 `npm run test:run` 与 `npm run lint`
3. 如涉及模块依赖调整，再跑边界检查脚本
4. 使用 `npm run perf` 验证关键性能路径
5. 最终执行 `npm run verify`

## 18. 常见问题与排查建议

## 运行时报“浏览器不支持”

- 检查是否 Chromium 内核新版本
- Brave 需打开 File System Access API 开关

## 进入项目页/编辑器页被门禁拦截

- 重新授予目录权限
- 尝试在 Workspace 弹层中切换/重新添加目录

## 本地看起来卡，但不确定是 dev 噪音还是真实问题

- 用 `npm run dev:compare` 或 `npm run perf` 进行对照

## 某些文档与代码结构不一致

- 优先以当前 `src` 目录和配置文件为准
- README 中部分历史说明可能未同步更新

## 19. 贡献与许可

- 许可证：`MIT`
- 当前仓库 README 说明：项目开源但暂不接受 Pull Request，可通过 issue/discussion 反馈

---

如果你准备继续维护此项目，建议先从这些入口文件开始读：

- `src/main.tsx`
- `src/app.tsx`
- `src/routes/projects/index.tsx`
- `src/routes/editor/$projectId.tsx`
- `src/infrastructure/storage/index.ts`
- `src/features/editor/components/editor.tsx`

