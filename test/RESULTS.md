# 测试结果

执行日期：2026-08-23

## 类型检查

命令：

```text
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

结果：通过，退出码 0。

## 行为测试

命令：

```text
npm test
npm run test:setup:windows
```

结果：通过，14 个 Node 测试、1 个 POSIX Shell 配置链路测试与 1 个 Windows PowerShell 配置链路测试通过，0 个失败。

测试覆盖：
- `file-tree`（4）：隐藏文件、目录优先排序、目录读取（已去上限）、扁平化
- `file-viewer`（6）：文件大小、文本/图像识别、无扩展名探测、轻量着色、自动折行（长行切分/恰好等宽/空行/制表符/边界）
- `config`（4）：默认快捷键完整性、合并覆盖、当前值一致性，以及临时修改 `config.json` 后模块默认值同步更新
- `setup-opencode.sh`（1）：POSIX 配置路径输出、消费者导出 `OPENCODE_TUI_CONFIG`、跨工作目录解析、配置和插件保持不变，以及空配置、无效配置与缺失入口拒绝
- `setup-opencode.ps1`（1）：Windows 进程环境变量、字符串/元组插件配置、跨工作目录解析、用户主配置保留、配置和插件保持不变，以及失败时环境不污染

说明：当前环境没有全局 `bun` 命令，因此使用项目本地 TypeScript 和 Node 24 的原生 TypeScript 擦除模式完成验证。查看器已从 `api.ui.dialog` 改为 `api.route` 路由方案（`fs-viewer`，主视口代码区 + 路由内分栏复用 `FileTree` 以确保侧边栏可见，`esc/q` 返回来源路由），并新增按视口宽度自动折行的 `wrapLine` 纯函数；2026/8/22 23:34 修复：全局层改为不带 `mode` 的显式 `bindings`、行号去 `│` 竖线、内容区去白边；2026/8/23 1:09 修复：默认键由 `ctrl+shift+b/ctrl+shift+enter` 改为 `ctrl+b/ctrl+o` 以规避 `shift+return` 换行吞键（tui.json 仍可覆盖），路由改为左右分栏以解决全屏遮挡侧边栏的问题；2026/8/23 1:19 追加：`ctrl+o` 同时承担打开与关闭（viewer 内亦响应），`esc/q` 保留为备选返回；2026/8/23 1:19 重构：按模块拆分为 `src/file-tree`、`src/file-viewer`、`src/config` 三模块 + `config.json`，移除 `MAX_LINES/MAX_DIR_ENTRIES/MAX_TREE_NODES` 限制以支持大文件与大目录完整加载；2026/8/23 2:11 追加：全部快捷键下沉至 `config.json`/`src/config` 单一来源（`FileViewer` 移除硬编码 `viewerKeymap`），删除原始文件 `fs-plugin-utils.ts`/`fs-viewer.tsx`，保留 `fs-plugin.tsx` 为组合入口，测试按模块一一对应（`file-tree`/`file-viewer`/`config`）；导入已改为无后缀的常规写法（`from "../src/file-tree/tree-utils"`），`tsconfig.json` 已移除 `allowImportingTsExtensions` 并同步为 `["fs-plugin.tsx","config.json","src/**/*","test/**/*"]`，为使 `node --experimental-strip-types` 直跑无后缀导入，新增 `test/ts-extensionless-loader.mjs` 做扩展名补齐；2026/8/23 19:07 修复：`src/config/index.ts` 改为直接导入根目录 `config.json`，删除重复的快捷键对象，新增临时目录行为测试证明只修改 JSON 即可更新模块默认值。
