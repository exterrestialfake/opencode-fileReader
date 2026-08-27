/** @jsxImportSource @opentui/solid */
// fs-plugin.tsx — 兼容入口（转发至模块化实现）
// 实际实现已拆至 src/file-tree、src/file-viewer、src/config；本文件保留以兼容 tui.test.json 的 file:// 指向
// 遵循 guidance/engineering_spec.md：组件 PascalCase、函数 camelCase、中文注释
import { createSignal, onCleanup, Show } from "solid-js"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { buildFileTree, flattenFileTree, toggleExpanded, type FileNode, type FlatNode } from "./src/file-tree-utils/tree"
import { applyRefresh, startAutoRefresh, type AutoRefreshDeps } from "./src/file-tree-utils/auto-refresh"
import { registerTreeNavLayer } from "./src/file-tree-utils/keyboard-nav"
import { resolveBaseRoute, returnToBase } from "./src/plugin/route-utils"
import { FileTree } from "./src/FileTree"
import { FileViewer } from "./src/FileViewer"
import { resolveKeybinds } from "./src/config/index"
import { tryOpenExternalIfNotText } from "./src/file-utils/file"

/** 全屏查看路由名（与宿主保留路由 home/session 区分） */
const VIEWER_ROUTE = "fs-viewer"

/** 阅读页模式名（路由挂载期间由宿主模式栈持有，卸载时弹出） */
const VIEWER_MODE = "fs-plugin.viewer"

// 模块级状态（跨组件共享）
const [visible, setVisible] = createSignal(true)
const [tree, setTree] = createSignal<FileNode | null>(null)
const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
const [selected, setSelected] = createSignal<FileNode | null>(null)
/** 打开查看器前的来源路由（用于关闭时返回） */
const [baseRoute, setBaseRoute] = createSignal<{ name: string; sessionID?: string }>({ name: "home" })

/** 切换目录展开/折叠（展开时懒加载子目录，已移除节点上限；集合更新逻辑下沉至 tree-utils.toggleExpanded） */
function toggleDir(node: FileNode) {
  // 文件夹也应赋予光标，方便键盘继续控制
  setSelected(node)
  setExpanded(toggleExpanded(node, expanded()))
  const root = tree()
  if (root) setTree({ ...root }) // 触发重渲染
}

/** 打开全屏查看器：记录来源路由并切换到 fs-viewer 路由（来源决策下沉至 route-utils.resolveBaseRoute） */
function openFile(api: TuiPluginApi, node: FileNode) {
  setSelected(node)
  const cur = api.route.current
  // 已在阅读页：仅更新选中信号，路由内 <Show keyed> 随之动态重渲染（键盘选择跟随）
  if (cur.name === VIEWER_ROUTE) return
  setBaseRoute(resolveBaseRoute(cur))
  api.route.navigate(VIEWER_ROUTE)
}

/** 用系统默认查看器打开文件（win32，已验证模式） */
/** 当前可见行（基于展开状态扁平化，供键盘导航与 fs.open 起点计算） */
function visibleRows(): FlatNode[] {
  const root = tree()
  return root ? flattenFileTree(root, expanded()) : []
}

/** 关闭查看器并返回来源界面（会话或主页；返回决策下沉至 route-utils.returnToBase） */
function closeViewer(api: TuiPluginApi) {
  returnToBase((name, params) => api.route.navigate(name, params), baseRoute())
}

/** 插件入口 */
const tui: TuiPlugin = async (api, options) => {
  if (options?.enabled === false) return

  // 初始化文件树（默认只展开当前目录，已移除目录条目上限）
  const rootDir = api.state.path.directory
  const root = buildFileTree(rootDir)
  setTree(root)
  setExpanded(new Set([root.path]))
  // 初始光标默认在第一个文件/文件夹，便于直接键盘移动
  const first = flattenFileTree(root, new Set([root.path]))[0]?.node ?? null
  setSelected(first)

  // 自动刷新状态依赖注入：把信号读写交给 auto-refresh 模块（该模块不感知 solid 信号实现）
  const autoRefreshDeps: AutoRefreshDeps = {
    rootDir: () => rootDir,
    getTree: () => tree(),
    setTree,
    getExpanded: () => expanded(),
    setExpanded,
    getSelected: () => selected(),
    setSelected,
  }
  // 启动自动刷新（fs.watch + 轮询保底），插件卸载时释放 watcher 与定时器
  api.lifecycle.onDispose(startAutoRefresh(autoRefreshDeps))

  // 解析快捷键（config.json 默认值 + tui.json 传入覆盖，单一来源）
  const resolvedKeymap = resolveKeybinds((options?.keybinds ?? {}) as Record<string, string>)

  // 注册文件树键盘导航
  registerTreeNavLayer({
    api,
    resolvedKeymap,
    visibleRows,
    getSelected: () => selected(),
    setSelected,
    isExpanded: (path) => expanded().has(path),
    toggleDir,
    openFile: (node) => openFile(api, node),
    isViewerRoute: () => api.route.current.name === VIEWER_ROUTE,
  })

  // 注册侧边栏槽位（order 600，内置 files 500 之后）
  api.slots.register({
    order: 600,
    slots: {
      sidebar_content() {
        return visible() ? (
          <FileTree
            api={api}
            tree={tree}
            expanded={expanded}
            selected={selected}
            onToggleDir={toggleDir}
            onOpenFile={(node) => openFile(api, node)}
          />
        ) : (
          <box />
        )
      },
    },
  })

  // 注册查看器路由（路由内左右分栏以确保侧边栏可见，esc/q 返回来源界面）
  api.route.register([
    {
      name: VIEWER_ROUTE,
      render() {
        const popMode = api.mode.push(VIEWER_MODE)
        onCleanup(popMode)
        // <Show keyed> 随选中信号动态重渲染：键盘移动光标到文件时阅读页即时切换内容
        return (
          <Show when={selected()} keyed fallback={<box />}>
            {(node: FileNode) => (
              <box flexDirection="row" width="100%" height="100%">
                <box flexGrow={1} flexBasis={0} minWidth={0}>
                  <FileViewer api={api} file={node} resolvedKeymap={resolvedKeymap} onClose={() => closeViewer(api)} />
                </box>
                <box width={42} flexShrink={0}>
                  <FileTree
                    api={api}
                    tree={tree}
                    expanded={expanded}
                    selected={selected}
                    onToggleDir={toggleDir}
                    onOpenFile={(n) => openFile(api, n)}
                  />
                </box>
              </box>
            )}
          </Show>
        )
      },
    },
  ])

  // 注册快捷键层（不带 mode 以确保在输入框获焦时仍可触发）
  const toggleKey = resolvedKeymap["fs.toggle"]
  const openKey = resolvedKeymap["fs.open"]
  const refreshKey = resolvedKeymap["fs.refresh"]
  api.keymap.registerLayer({
    commands: [
      {
        name: "fs.toggle",
        run() {
          setVisible(!visible())
        },
      },
      {
        name: "fs.open",
        run() {
          if (api.route.current.name === VIEWER_ROUTE) {
            closeViewer(api)
            return
          }
          const current = selected()
          if (!current) {
            // 纯键盘起点：尚无选中时先选中第一可见行（文件则直接打开进入阅读页；
            // 目录仅高亮选中，展开交给阅读页内的 right/l 或 enter/o，避免 ctrl+o 意外折叠）
            const first = visibleRows()[0]?.node ?? null
            setSelected(first)
            if (first?.type === "file") openFile(api, first)
            return
          }
          if (current.type === "dir") toggleDir(current)
          else openFile(api, current)
        },
      },
      {
        // 手动刷新文件树（自动刷新之外的兜底入口，默认键 ctrl+r 可在 tui.json 覆盖）
        name: "fs.refresh",
        run() {
          applyRefresh(autoRefreshDeps)
        },
      },
    ],
    bindings: [
      { key: toggleKey, cmd: "fs.toggle" },
      { key: openKey, cmd: "fs.open" },
      { key: refreshKey, cmd: "fs.refresh" },
    ],
  })

  // 合并后的 enter 打开（仅 viewer 模式，原 fs.cursorOpen 已并入 fs.open 语义，逻辑保持不变）
  api.keymap.registerLayer({
    mode: VIEWER_MODE,
    priority: 10,
    commands: [
      {
        name: "fs.cursorOpen",
        run() {
          const node = selected()
          if (!node) return
          if (node.type === "dir") {
            toggleDir(node)
            return
          }
          if (tryOpenExternalIfNotText(node.name, node.path)) return
          openFile(api, node)
        },
      },
    ],
    bindings: [{ key: "enter", cmd: "fs.cursorOpen" }],
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "fs-plugin",
  tui,
}

export default plugin
