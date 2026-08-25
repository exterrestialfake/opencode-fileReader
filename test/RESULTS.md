# 测试结果

执行日期：2026-08-24

## 类型检查

命令：

```text
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

结果：PASS（退出码 0，无类型错误）。

## 行为测试

命令：

```text
npm test
npm run test:setup:windows
sh test/setup-opencode.test.sh
pwsh -File test/setup-opencode.test.ps1
```

结果：PASS。全量 Node 测试 40 个全部通过、0 个失败（其中 2026/8/24 新增行为测试 18 个，覆盖 bug.md #5 场景）；POSIX Shell 配置链路测试与独立 Windows PowerShell 配置链路测试同样通过。

测试覆盖：
- `file-tree`（4）：隐藏文件、目录优先排序、目录读取（已去上限）、扁平化
- `file-viewer`（6）：文件大小、文本/图像识别、无扩展名探测、轻量着色、自动折行（长行切分/恰好等宽/空行/制表符/边界）
- `config`（4）：默认快捷键完整性、合并覆盖、当前值一致性，以及临时修改 `config.json` 后模块默认值同步更新
- `behavior`（18，2026/8/24 新增，对应 bug.md「行为测试过少」#4）：
  - 路由往返（3）：来源路由记录（session 提取 sessionID、缺失回落 home、自定义路由按名保留）、返回导航（会话带回 sessionID、其余回主页）、完整往返（session(s1) 进入 fs-viewer 后原样返回）
  - 快捷键冲突与优先级（6）：树导航层以 priority 10 注册且 tui.json 覆盖整体替换绑定序列、同键分层（j 键树光标 priority 10 优先于代码区滚动 priority 0，注销后滚动恢复）、无 mode 全局层在输入框获焦（input 模式）仍触发而带 mode 层被抑制、树导航命令行为（目录仅选中/文件触发打开/折叠跳父级/展开懒加载目录/enter 打开文本）、空树安全、默认键位约定（全局命令互不冲突；up/k 与 ctrl+o 同键为有意分层设计）
  - 插件重载与 dispose 清理（4）：watcher 自动刷新新增文件且 dispose 后停止、重载模拟（旧实例清理后新实例独立刷新、旧实例保持沉寂）、dispose 释放轮询定时器（REFRESH_POLL_MS）与待处理防抖定时器（REFRESH_DEBOUNCE_MS）、轮询保底在树被清空且根目录恢复时整棵重建并默认展开根目录
  - 双树一致性（1）：侧边栏与阅读页右侧两实例共享单一状态源（tree/expanded/selected），初始/展开/折叠/选中渲染始终一致，toggleExpanded 不修改原集合，applyRefresh 后两实例同步看到新文件且选中对象身份保留（阅读页状态不被重置）
  - 窄终端折行（4）：终端宽度 40/60/80 下 `viewerWrapWidth` 钳制为 32（估算下限 40 扣除行号 6 列与内边距 2 列）、视口宽度优先且最终下限 20 列、宽度 32 下长行切分与制表符展开、`totalVisualRows` 汇总多逻辑行可视行数（滚动上限非负）
- `setup-opencode.sh`（1，仅校验）：四包（`@opentui/core`、`@opentui/keymap`、`@opentui/solid`、`solid-js`）目录齐全时成功且仅向 stdout 输出解析后的配置绝对路径、跨工作目录一致、消费者 `export OPENCODE_TUI_CONFIG="$(sh setup-opencode.sh)"` 契约生效；零安装（`node_modules` 缺失）与逐包缺失（四包各缺一）均失败且错误必须点名缺失包并给出准确指引 `npm ci --omit=dev --ignore-scripts`、伪造 `npm` 从未被调用、`node_modules`/`tui.test.json`/`fs-plugin.tsx` 均未被改写、失败时 stdout 为空且错误写入 stderr；另覆盖空配置、无效 JSON、未注册 `fs-plugin.tsx` 与缺失入口拒绝
- `setup-opencode.ps1`（1，仅校验）：四包目录齐全时成功并在当前进程设置 `OPENCODE_TUI_CONFIG`（进程级临时变量，POSIX 为 `export`、PowerShell 为 `$env:OPENCODE_TUI_CONFIG`）、不污染 `OPENCODE_CONFIG`、支持字符串与 `[路径, 配置]` 元组两种 `plugin` 写法、跨工作目录一致、输出包含 `现在请手动执行：opencode`；零安装与逐包缺失均失败且错误必须点名缺失包并给出准确指引 `npm ci --omit=dev --ignore-scripts`、伪造 `npm.cmd` 从未被调用、`node_modules`/配置/入口均未被改写、失败时不污染已有 `OPENCODE_TUI_CONFIG`；另覆盖空配置、无效 JSON、未注册 `fs-plugin.tsx` 与缺失入口拒绝；持久注册由用户自行编辑全局 `tui.json` 的 `plugin` 数组完成

说明：当前环境没有全局 `bun` 命令，因此使用项目本地 TypeScript 和 Node 24 的原生 TypeScript 擦除模式完成验证。查看器已从 `api.ui.dialog` 改为 `api.route` 路由方案（`fs-viewer`，主视口代码区 + 路由内分栏复用 `FileTree` 以确保侧边栏可见，`esc/q` 返回来源路由），并新增按视口宽度自动折行的 `wrapLine` 纯函数；2026/8/22 23:34 修复：全局层改为不带 `mode` 的显式 `bindings`、行号去 `│` 竖线、内容区去白边；2026/8/23 1:09 修复：默认键由 `ctrl+shift+b/ctrl+shift+enter` 改为 `ctrl+b/ctrl+o` 以规避 `shift+return` 换行吞键（tui.json 仍可覆盖），路由改为左右分栏以解决全屏遮挡侧边栏的问题；2026/8/23 1:19 追加：`ctrl+o` 同时承担打开与关闭（viewer 内亦响应），`esc/q` 保留为备选返回；2026/8/23 1:19 重构：按模块拆分为 `src/file-tree`、`src/file-viewer`、`src/config` 三模块 + `config.json`，移除 `MAX_LINES/MAX_DIR_ENTRIES/MAX_TREE_NODES` 限制以支持大文件与大目录完整加载；2026/8/23 2:11 追加：全部快捷键下沉至 `config.json`/`src/config` 单一来源（`FileViewer` 移除硬编码 `viewerKeymap`），删除原始文件 `fs-plugin-utils.ts`/`fs-viewer.tsx`，保留 `fs-plugin.tsx` 为组合入口，测试按模块一一对应（`file-tree`/`file-viewer`/`config`）；导入已改为无后缀的常规写法（`from "../src/file-tree/tree-utils"`），`tsconfig.json` 已移除 `allowImportingTsExtensions` 并同步为 `["fs-plugin.tsx","config.json","src/**/*","test/**/*"]`，为使 `node --experimental-strip-types` 直跑无后缀导入，新增 `test/ts-extensionless-loader.mjs` 做扩展名补齐；2026/8/23 19:07 修复：`src/config/index.ts` 改为直接导入根目录 `config.json`，删除重复的快捷键对象，新增临时目录行为测试证明只修改 JSON 即可更新模块默认值；2026/8/23 20:36 修复：干净 clone 缺少 `node_modules` 时插件不加载，设置脚本当时按锁文件自动安装依赖并在失败时终止，该自动安装为中间修复（见 2026/8/24 显式安装修正），历史事实保留但不再作为当前行为。另从 GitHub 创建无依赖临时 clone，在其他工作目录执行 Windows 设置脚本，实装 132 个包后成功输出该 clone 的绝对配置路径；安装后的类型检查通过，第二次执行未重复安装；上述自动安装证据保留以说明零安装被否定。

## 依赖边界实验与 `--omit=dev` 变更（2026-08-24）

### 运行时依赖实验（OpenCode 1.18.21）

同一 OpenCode 1.18.21、同一插件入口，仅改变本地 `node_modules` 内容的一次性 TUI 实验：

| 实验 | 本地 node_modules | 插件模块加载标记 | TUI 激活标记 |
| --- | --- | --- | --- |
| A | 无（零安装） | 否 | 否 |
| B | 全部依赖 | 是 | 是 |
| C | 仅 solid-js | 否 | 否 |
| D | solid-js + @opentui/core/keymap/solid | 是 | 是 |

结论：零安装被实测否定（宿主不会自动补装 `node_modules`）；最小运行时依赖为 `@opentui/core`、`@opentui/keymap`、`@opentui/solid`、`solid-js` 四包。`@opencode-ai/plugin` 在源码中仅为类型导入（编译期擦除），与 `@opencode-ai/sdk`、`typescript`、`@types/node` 一同归入 `devDependencies`。实验只证明“实际安装了哪些包”决定加载结果，不能据此认为 package.json 的 dependencies/devDependencies 分区本身会改变宿主的运行时模块解析。

### 测试先行（红 → 绿）

#### 2026-08-24 --omit=dev 修正（保留）

1. 先改测试：`test/setup-opencode.test.sh` 与 `test/setup-opencode.test.ps1` 的 npm 调用断言改为 `ci --omit=dev --ignore-scripts`。
2. 红灯确认：
   - `sh test/setup-opencode.test.sh` → `FAIL: 依赖安装必须使用 npm ci --omit=dev --ignore-scripts`（退出码非 0）
   - `npm run test:setup:windows` → `依赖安装必须使用 npm ci --omit=dev --ignore-scripts`（Assert-True 抛出，退出码非 0）
3. 实现：`setup-opencode.sh` 与 `setup-opencode.ps1` 的 `npm ci` 追加 `--omit=dev`。
4. 绿灯确认：两个设置链路测试均 PASS。

#### 2026-08-24 显式安装（验证而非安装）

1. 先改测试：`test/setup-opencode.test.sh` 与 `test/setup-opencode.test.ps1` 改为验证而非安装契约——四包齐全时成功、零安装与逐包缺失均失败且必须点名缺失包并给出准确指引 `npm ci --omit=dev --ignore-scripts`、伪造 `npm`/`npm.cmd` 从未被调用、`node_modules`/配置/入口均未被改写、POSIX 仅 stdout 输出路径且失败时 stdout 为空、PowerShell 仅设置进程级 `OPENCODE_TUI_CONFIG` 且失败时不污染已有值。
2. 红灯确认（实现前）：
   - `pwsh -File test/setup-opencode.test.ps1` → `缺少 @opentui/core 时设置脚本不应调用 npm`（Assert-True 抛出，退出码非 0）
   - `sh test/setup-opencode.test.sh` → `FAIL: 零安装 时设置脚本不应调用 npm`（退出码非 0）
3. 实现：`setup-opencode.sh` 与 `setup-opencode.ps1` 移除所有 `npm ci` 调用，改为仅校验四个运行时包目录是否存在；缺失时以中文错误 `缺少运行时依赖：<包名>。请在插件目录手动执行：npm ci --omit=dev --ignore-scripts` 退出，用户需在插件目录手动执行该命令安装；`setup-opencode.sh` 仅校验后输出配置路径，`setup-opencode.ps1` 仅校验后设置进程级 `$env:OPENCODE_TUI_CONFIG`。
4. 绿灯确认：两个设置链路测试均 PASS；另包含对 PowerShell 测试夹具的一行修正，`Get-NodeModulesSnapshot` 中 `TrimStart` 改为字符数组形式 `TrimStart([char[]]@('\', '/'))` 以兼容 Windows PowerShell 5.1 与 PowerShell 7。

### 最终门禁（2026-08-24）

- `npm test`：PASS，14 个 Node 测试与 POSIX 设置脚本测试全部通过。
- `npm run test:setup:windows`：PASS。
- `npm run typecheck`：PASS。
- 临时目录执行 `npm ci --omit=dev --ignore-scripts`：PASS，四个直接运行时包齐全，根 `devDependencies` 中的 `@opencode-ai/plugin`、`@opencode-ai/sdk`、`@types/node` 未安装。
- `git diff --check`：PASS；首次检查发现的 `test/setup-opencode.test.sh` 一处尾随空格已修正。

### 行为测试补充（2026-8/24，bug.md #4）

1. 现状确认：既有测试仅覆盖纯函数（tree-utils/cursor-utils/viewer-utils/config），路由往返、快捷键优先级、dispose 清理、双树一致性、窄终端折行均无覆盖。
2. 最小可测性导出（不改行为，仅下沉纯逻辑；原因：`fs-plugin.tsx`/`FileViewer.tsx` 含 JSX 与 TUI 运行时导入，`node --experimental-strip-types` 无法加载 .tsx，纯决策逻辑必须落到 .ts 模块才可测）：
   - 新增 `src/plugin/route-utils.ts`：`resolveBaseRoute`/`returnToBase` 自 `fs-plugin.tsx` 的 `openFile`/`closeViewer` 原样提取；
   - `src/file-tree/tree-utils.ts` 新增 `toggleExpanded`（自入口 `toggleDir` 提取）；
   - `src/file-viewer/viewer-utils.ts` 新增 `viewerWrapWidth`/`totalVisualRows`（自 `FileViewer` 记忆体提取），`FileViewer.tsx` 改为调用；
   - `fs-plugin.tsx` 相应改为薄包装，路由记录/返回、展开切换行为逐字保留。
3. 新增 `test/behavior.test.ts`（18 测试）：真实实现 + 最小 mock（keymap 宿主按「模式过滤 + 优先级最高」分发并展开逗号分隔键序列；定时器桩透传计时仅记录句柄；导航依赖注入普通变量存储），不引入真实 TUI 运行时、不新增测试框架（沿用 node:test）。
4. 绿灯确认：`npx tsc --noEmit` PASS；Node 全量 40 测试 PASS；`sh test/setup-opencode.test.sh` 与 `npm run test:setup:windows` 均 PASS。bug.md「行为测试过少」一项可标记解决。

### 清单与锁文件

- `package.json`：`dependencies` 仅保留四个运行时包；`@opencode-ai/plugin@1.18.18`、`@opencode-ai/sdk@1.18.18`、`@types/node@24.13.3`、`typescript@5.6.3` 移入 `devDependencies`。
- `package-lock.json` 由 `npm install --ignore-scripts` 重新生成（npm 11.11.0）：差异仅为根清单分区调整与 dev 子树 `"dev": true` 标记及头部 name/version/license 同步，无任何版本或 resolved 变更。
- 真实命令验证：临时目录内执行 `npm ci --omit=dev --ignore-scripts` 退出码 0，只安装四个直接运行包及其传递闭包；`@opencode-ai/plugin`、`@opencode-ai/sdk`、`@types/node`、effect、zod 等 dev-only 包均不存在。（注：`typescript` 会经 `@opentui/core → bun-ffi-structs` 作为传递依赖出现，与根 devDependencies 无关。）

### 全局配置未变更

- 本次显式安装修正与文档更新未改写全局配置：未创建或修改 `C:\Users\Administrator\.config\opencode\tui.json` / `~/.config/opencode/tui.json`，未向全局 `plugins` 目录复制插件文件。
- 临时启用仍通过进程级 `OPENCODE_TUI_CONFIG`（POSIX 命令替换导出、PowerShell 进程环境），持久注册由用户自行编辑全局 `tui.json` 的 `plugin` 数组完成。
