# opencode-fileReader — Opencode 文件浏览插件

在 Opencode TUI 右侧边栏查看项目文件，并在主视口以 IDE 式左右分栏阅读代码（支持目录折叠、隐藏文件可见、轻量着色、超长行自动折行）。

![文件树](assets/fileTree.png)
![文件查看](assets/fileViewer.png)
*实际使用截图由作者提供*

> 开发阶段部署形态：本仓库**原地**以绝对 `file://` 路径注册为 TUI 插件，不创建、不复制到全局插件目录（`~/.config/opencode/plugins` / `C:\Users\Administrator\.config\opencode\plugins`）。仓库路径需保持稳定，移动或删除仓库会导致注册失效。未来仅在项目完成后才考虑发布为 npm 包。

## 环境要求

- 已安装 `opencode` 1.18+
- 可执行 `npm` / `node`（用于安装运行时依赖与校验）

验证：

```powershell
opencode --version
```

未安装：

```powershell
npm i -g opencode
# 或
bun add -g opencode
```

## 运行时依赖（必读）

两种部署方式之前，都必须在**插件仓库根目录**显式安装运行时依赖。本项目不做零安装、宿主桥接或脚本自动安装。

在插件仓库根目录执行：

```bash
npm ci --omit=dev --ignore-scripts
```

该命令只安装 `package.json` 中 `dependencies` 的四个直接运行时包——`@opentui/core@0.4.5`、`@opentui/keymap@0.4.5`、`@opentui/solid@0.4.5`、`solid-js@1.9.12`——以及由 `package-lock.json` 锁定的传递闭包（transitive closure）。缺包时插件模块不加载、TUI 不激活。

设置脚本 `setup-opencode.ps1` / `setup-opencode.sh` **仅做校验**：不调用 npm、不改写或创建 `node_modules`、不启动 OpenCode、不修改全局配置。脚本只检查 `tui.test.json` 是否注册 `fs-plugin.tsx`、插件入口是否存在、上述四个运行时包是否已在本地安装；缺包或校验失败时仅向 stderr 输出中文错误并提示准确安装命令 `npm ci --omit=dev --ignore-scripts`。

## 安装与快速开始

### 1. 临时注册（同 Shell，仅当前会话生效）

关闭该 Shell 则注册失效，需在新 Shell 中重新执行同会话流程。

#### Windows PowerShell（临时，同 Shell）

在**同一个** PowerShell 会话内按顺序执行，可直接复制粘贴（请将路径替换为你的实际路径）：

```powershell
git clone https://github.com/exterrestialfake/opencode-fileReader.git
Set-Location .\opencode-fileReader
npm ci --omit=dev --ignore-scripts
& ".\setup-opencode.ps1"
Set-Location "D:\path\to\your-project"
opencode
```

说明：`setup-opencode.ps1` 仅校验 `tui.test.json` 与四个运行时包，并在当前 PowerShell 进程设置 `OPENCODE_TUI_CONFIG` 指向仓库内 `tui.test.json`，脚本本身不会启动 `opencode`。必须在同一会话设置变量后启动 `opencode`。

验证变量（可选）：

```powershell
$env:OPENCODE_TUI_CONFIG
```

#### POSIX / Bourne Shell（临时，同 Shell）

在**同一个** Shell 会话内按顺序执行（`sh` / `bash` / `zsh` / `dash` / `ksh` 均可）：

```bash
git clone https://github.com/exterrestialfake/opencode-fileReader.git
cd opencode-fileReader
npm ci --omit=dev --ignore-scripts
export OPENCODE_TUI_CONFIG="$(sh ./setup-opencode.sh)"
cd /path/to/your-project
opencode
```

说明：`setup-opencode.sh` 仅校验并把 `tui.test.json` 的绝对路径输出到 stdout；通过命令替换将其导出为 `OPENCODE_TUI_CONFIG` 后在同一会话启动 `opencode`。脚本本身不会启动 `opencode`，校验错误会写入 stderr。

验证变量（可选）：

```bash
printenv OPENCODE_TUI_CONFIG
```

### 2. 持久注册（手工修改全局 tui.json）

本项目**不会自动修改**全局配置。持久注册需用户手工编辑全局 `tui.json`。

- Windows 路径：`C:\Users\Administrator\.config\opencode\tui.json`
- POSIX 路径：`~/.config/opencode/tui.json`

步骤：

1. 先在插件仓库根目录完成显式运行时安装：

   ```bash
   npm ci --omit=dev --ignore-scripts
   ```

2. 用编辑器打开全局 `tui.json`，在已有的 `plugin` 数组中**追加**一项指向仓库内插件入口的绝对 `file://` 路径，保留已有插件（如 `oh-my-openagent`），不要覆盖：

   ```json
   {
     "$schema": "https://opencode.ai/tui.json",
     "plugin": [
       "file:///D:/path/to/opencode-fileReader/fs-plugin.tsx"
     ]
   }
   ```

   已有数组示例（需保留原有项）：

   ```json
   {
     "plugin": [
       "oh-my-openagent",
       "file:///D:/path/to/opencode-fileReader/fs-plugin.tsx"
     ]
   }
   ```

   POSIX 示例：

   ```json
   {
     "plugin": ["file:///home/you/opencode-fileReader/fs-plugin.tsx"]
   }
   ```

3. 保持仓库路径稳定，不要移动或删除仓库，否则绝对路径失效。
4. 保存后**退出并重启 OpenCode** 使配置生效。

> 持久注册不会自动安装依赖，仓库内仍需保留 `npm ci --omit=dev --ignore-scripts` 安装的 `node_modules`。

## 更新

在插件仓库根目录执行：

```bash
git pull --ff-only
npm ci --omit=dev --ignore-scripts
```

随后按你使用的临时或持久方式重新校验或重启 OpenCode 即可。

## 开发者

完整安装与校验（包含类型与测试依赖）：

```bash
npm ci
npm test
npm run typecheck
```

Windows 校验脚本单测：

```powershell
npm run test:setup:windows
# 或直接
powershell -NoProfile -ExecutionPolicy Bypass -File test/setup-opencode.test.ps1
```

说明：

- `npm test` 会依次执行 `test/file-tree.test.ts`、`test/file-viewer.test.ts`、`test/config.test.ts` 与 `test/setup-opencode.test.sh`（POSIX 校验脚本的契约测试）。
- `npm run typecheck` 等价于 `tsc -p tsconfig.json --noEmit`。
- `npm ci --omit=dev --ignore-scripts` 仅用于用户运行时部署；开发者本地请用完整 `npm ci`。

## 使用

- **浏览**：鼠标点击目录可折叠/展开，点击文件可在分栏中打开；再次按 `ctrl+o` 或 `esc/q` 返回
- **新建文件/文件夹**：在文件树中选中目标目录（选中文件时取其所在目录），按 `ctrl+n` 立即新建 `默认文件.txt`，按 `ctrl+alt+n` 新建 `默认文件夹`；新项出现后文件名处于可编辑状态，直接输入新名后按 `Enter` 确认，`Esc` 保留默认名；若重名会自动加序号
- **重命名/删除**：选中文件或目录后按 `ctrl+f2` 重命名，按 `delete` 删除（会弹出确认）
- **键盘驱动**：`ctrl+up`/`ctrl+down` 上下移动树光标（全局，选中文件时阅读页动态跟随渲染），`ctrl+left` 折叠或跳到上级，`ctrl+right` 展开目录或打开文件，`enter`（仅阅读页内）打开/折叠；尚无选中时按 `ctrl+o` 会先选中第一行作为起点
- **滚动**：在代码区使用 `pageup`、`pagedown` 或滚轮滚动；超长行会自动换到下一行显示
- **图像/二进制**：选中 `png/jpg` 等图像会显示文件名/大小/尺寸，按 `enter`（已显示时）或 `return` 用系统查看器打开原图

## 快捷键

可在 `tui.json` 中通过 `keybinds` 覆盖任意键（键名即下表左侧）。

| 功能 | 默认键 | 说明 |
| --- | --- | --- |
| 显隐文件树 | `ctrl+b` | 开/关右侧文件树 |
| 新建文件 | `ctrl+n` | 在选中目录下立即新建 `默认文件.txt`，文件名高亮可直接改名，`Enter` 确认、`Esc` 保留 |
| 新建文件夹 | `ctrl+alt+n` | 在选中目录下立即新建 `默认文件夹`，同上可直接改名 |
| 重命名 | `ctrl+f2` | 重命名选中文件或目录 |
| 删除 | `delete` | 删除选中文件或目录（弹出确认） |
| 打开/关闭文件 | `ctrl+o`（全局）/ `enter`（仅阅读页） | `ctrl+o` 选中文件时打开，阅读页内关闭；`enter` 仅阅读页内打开/折叠（目录切换，文件打开，二进制外部打开）；无选中时 `ctrl+o` 先选首行 |
| 手动刷新文件树 | `ctrl+r` | 自动刷新之外的手动兜底入口 |
| 光标上移 | `ctrl+up` | 全局移动树光标，到顶停留（带 ctrl 不影响输入） |
| 光标下移 | `ctrl+down` | 全局移动树光标，到底停留；落在文件上时阅读页跟随渲染 |
| 折叠/跳上级 | `ctrl+left` | 展开中的目录折叠；文件或已折叠目录跳到父目录 |
| 展开/打开 | `ctrl+right` | 折叠的目录展开（懒加载）；文件直接打开 |
| 代码区上滚 | `up` | 阅读页内代码区单行上滚 |
| 代码区下滚 | `down` | 阅读页内代码区单行下滚 |
| 关闭阅读页 | `esc, q` | `ctrl+o` 的备选 |
| 上/下翻页 | `pageup` / `pagedown` | 代码区翻页 |
| 系统打开 | `enter,return` | 二进制/图像用系统查看器打开 |

> 树光标键（`fs.cursor*`）已改为全局 `ctrl+up/ctrl+down/ctrl+left/ctrl+right`，带修饰键不影响提示词输入；
> 树 `ctrl+*` 与代码区 `up/down` 已分离，无冲突；`enter` 仅在阅读页内生效，未路由时回车归还给输入框。

覆盖示例：

```json
{
  "plugin": [
    ["file:///D:/path/to/opencode-fileReader/fs-plugin.tsx", {
      "keybinds": {
        "fs.toggle": "ctrl+shift+b",
        "fs.open": "ctrl+o"
      }
    }]
  ]
}
```

所有可覆盖的键名见 `config.json`。

## 配置

- 快捷键默认值集中在 `config.json`，插件会将 `tui.json` 中传入的 `keybinds` 与其合并
- 文件树默认仅展开根目录，隐藏文件默认可见，无需额外开关
- 文件树自动刷新：外部新增/删除/重命名文件后数秒内自动更新（`fs.watch` 递归监听 + 轮询保底），已展开目录与选中状态尽量保留；选中文件被删除则清空选中；也可按 `ctrl+r` 手动刷新

## 常见问题

**快捷键在输入框获焦时无效？**
本插件的 `fs.toggle` / `fs.open` 已注册为全局层，在输入框获焦时仍可触发；若与你现有键位冲突，请在 `tui.json` 中用 `keybinds` 改键。

**执行脚本后仍看不到文件树？**
先确认脚本没有向 stderr 报告错误，且插件仓库中已生成 `node_modules/@opentui/core` 等四个运行时包。然后确认 PowerShell 中的 `$env:OPENCODE_TUI_CONFIG` 或 POSIX Shell 中的 `printenv OPENCODE_TUI_CONFIG` 输出了 `tui.test.json` 的绝对路径；请使用上方 Windows 或 POSIX 的同 Shell 临时工作流，并在同一 Shell 会话启动 `opencode`。若脚本提示缺少运行时依赖，请在**插件仓库根目录**执行准确命令：

```bash
npm ci --omit=dev --ignore-scripts
```

该命令会安装 `@opentui/core`、`@opentui/keymap`、`@opentui/solid`、`solid-js` 及其传递闭包；安装后重新执行设置脚本再启动 `opencode`。

**提示缺少或部分运行时依赖？**
请在插件仓库根目录执行：

```bash
npm ci --omit=dev --ignore-scripts
```

不要期望设置脚本会自动安装依赖或持久注册会自动补装；两种部署方式前都必须显式执行该命令。

**看不到侧边栏？**
阅读页采用路由内左右分栏（左代码右树）实现，即使宿主在自定义路由下不渲染侧边栏，树仍会在阅读页右侧复现。

**持久注册后移动了仓库路径？**
`file://` 绝对路径会失效，需重新编辑全局 `tui.json` 指向新路径，并保持路径稳定后重启 OpenCode。

## 许可证

MIT — 见 [LICENSE](LICENSE)
