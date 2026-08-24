/** @jsxImportSource @opentui/solid */
// fs-plugin.tsx — 兼容入口（转发至模块化实现）
// 实际实现已拆至 src/file-tree、src/file-viewer、src/config；本文件保留以兼容 tui.test.json 的 file:// 指向
// 遵循 guidance/engineering_spec.md：组件 PascalCase、函数 camelCase、中文注释
import { createSignal, onCleanup } from "solid-js"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { buildFileTree, readDirEntries, type FileNode } from "./src/file-tree/tree-utils"
import { FileTree } from "./src/file-tree/FileTree"
import { FileViewer } from "./src/file-viewer/FileViewer"
import { resolveKeybinds } from "./src/config/index"

/** 全屏查看路由名（与宿主保留路由 home/session 区分） */
const VIEWER_ROUTE = "fs-viewer"

// 模块级状态（跨组件共享）
const [visible, setVisible] = createSignal(true)
const [tree, setTree] = createSignal<FileNode | null>(null)
const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
const [selected, setSelected] = createSignal<FileNode | null>(null)
/** 打开查看器前的来源路由（用于关闭时返回） */
const [baseRoute, setBaseRoute] = createSignal<{ name: string; sessionID?: string }>({ name: "home" })

/** 切换目录展开/折叠（展开时懒加载子目录，已移除节点上限） */
function toggleDir(node: FileNode) {
  const next = new Set(expanded())
  if (next.has(node.path)) {
    next.delete(node.path)
  } else {
    if (!node.children) node.children = readDirEntries(node.path)
    next.add(node.path)
  }
  setExpanded(next)
  const root = tree()
  if (root) setTree({ ...root }) // 触发重渲染
}

/** 打开全屏查看器：记录来源路由并切换到 fs-viewer 路由 */
function openFile(api: TuiPluginApi, node: FileNode) {
  setSelected(node)
  const cur = api.route.current
  if (cur.name === "session") {
    const sid = (cur.params as { sessionID?: string } | undefined)?.sessionID
    setBaseRoute(sid ? { name: "session", sessionID: sid } : { name: "home" })
  } else if (cur.name !== VIEWER_ROUTE) {
    setBaseRoute({ name: cur.name })
  }
  api.route.navigate(VIEWER_ROUTE)
}

/** 关闭查看器并返回来源界面（会话或主页） */
function closeViewer(api: TuiPluginApi) {
  const base = baseRoute()
  if (base.name === "session" && base.sessionID) {
    api.route.navigate("session", { sessionID: base.sessionID })
  } else {
    api.route.navigate("home")
  }
}

/** 插件入口 */
const tui: TuiPlugin = async (api, options) => {
  if (options?.enabled === false) return

  // 初始化文件树（默认只展开当前目录，已移除目录条目上限）
  const rootDir = api.state.path.directory
  const root = buildFileTree(rootDir)
  setTree(root)
  setExpanded(new Set([root.path]))

  // 解析快捷键（config.json 默认值 + tui.json 传入覆盖，单一来源）
  const resolvedKeymap = resolveKeybinds((options?.keybinds ?? {}) as Record<string, string>)

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
        const node = selected()
        const popMode = api.mode.push("fs-plugin.viewer")
        onCleanup(popMode)
        if (!node) return <box />
        return (
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
        )
      },
    },
  ])

  // 注册快捷键层（不带 mode 以确保在输入框获焦时仍可触发；2026/8/23 1:19：fs.open 在 viewer 内复用为关闭）
  const toggleKey = resolvedKeymap["fs.toggle"]
  const openKey = resolvedKeymap["fs.open"]
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
          const node = selected()
          if (!node) return
          if (node.type === "dir") toggleDir(node)
          else openFile(api, node)
        },
      },
    ],
    bindings: [
      { key: toggleKey, cmd: "fs.toggle" },
      { key: openKey, cmd: "fs.open" },
    ],
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "fs-plugin",
  tui,
}

export default plugin
