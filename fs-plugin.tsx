/** @jsxImportSource @opentui/solid */
// fs-plugin.tsx — 插件入口：注册侧边栏文件树槽位（order 600）+ 快捷键层 + 查看面板生命周期
// 遵循 guidance/engineering_spec.md：组件 PascalCase、函数 camelCase、中文注释、错误信息中文
import { createSignal, createMemo, For } from "solid-js"
import type { ScrollBoxRenderable } from "@opentui/core"
import {
  createBindingLookup,
  type TuiPlugin,
  type TuiPluginApi,
  type TuiPluginModule,
} from "@opencode-ai/plugin/tui"
import {
  buildFileTree,
  flattenFileTree,
  readDirEntries,
  createSkin,
  type FileNode,
  type FlatNode,
  type Skin,
} from "./fs-plugin-utils"
import { FileViewer } from "./fs-viewer"

/** 默认快捷键（tui.json 可覆盖） */
const defaultKeymap = {
  "fs.toggle": "ctrl+shift+b",
  "fs.open": "ctrl+shift+enter",
}

// 模块级状态（跨组件共享）
const [visible, setVisible] = createSignal(true)
const [tree, setTree] = createSignal<FileNode | null>(null)
const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
const [selected, setSelected] = createSignal<FileNode | null>(null)

/** 切换目录展开/折叠（展开时懒加载子目录） */
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

/** 打开查看面板（dialog） */
function openFile(api: TuiPluginApi, node: FileNode) {
  setSelected(node)
  // 宿主 dialog 目前只提供尺寸档位，不提供左侧定位接口；使用最大档位扩大代码阅读区域。
  api.ui.dialog.setSize("xlarge")
  api.ui.dialog.replace(() => <FileViewer api={api} file={node} />)
}

/** 生成树行前缀（一次计算，避免每行向后扫描整棵树） */
function createRowPrefixes(rows: FlatNode[], expandedSet: Set<string>): string[] {
  const maxDepth = rows.reduce((max, row) => Math.max(max, row.depth), 0)
  const nextAtOrShallower = Array.from({ length: maxDepth + 1 }, () => -1)
  const laterSibling = rows.map(() => Array<boolean>(maxDepth + 1).fill(false))

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!
    for (let depth = 0; depth <= row.depth; depth += 1) {
      const next = nextAtOrShallower[depth]
      laterSibling[index]![depth] = next !== -1 && rows[next]!.depth === depth
    }
    for (let depth = row.depth; depth <= maxDepth; depth += 1) {
      nextAtOrShallower[depth] = index
    }
  }

  return rows.map((row, index) => {
    const indentation = Array.from({ length: row.depth }, (_, depth) => {
      if (depth === 0 && !laterSibling[index]![0]) return " "
      return laterSibling[index]![depth] ? "│  " : "   "
    }).join("")
    const topRoot = index === 0 && row.depth === 0
    const branch = topRoot ? " " : laterSibling[index]![row.depth] ? "├─ " : "└─ "
    const marker = row.node.type === "dir" ? (expandedSet.has(row.node.path) ? "▾ " : "▸ ") : ""
    return `${indentation}${branch}${marker}`
  })
}

/** 文件树组件（sidebar_content 槽位内容） */
function FileTree(props: { api: TuiPluginApi }) {
  const skin = createMemo<Skin>(() => createSkin(props.api.theme.current))
  const rows = createMemo<FlatNode[]>(() => {
    const root = tree()
    return root ? flattenFileTree(root, expanded()) : []
  })
  const prefixes = createMemo(() => createRowPrefixes(rows(), expanded()))
  let scroll: ScrollBoxRenderable | undefined

  const onRowClick = (row: FlatNode) => {
    const node = row.node
    setSelected(node)
    if (node.type === "dir") toggleDir(node)
    else openFile(props.api, node)
  }

  return (
    <box flexDirection="column" width="100%">
      <scrollbox
        ref={(element: ScrollBoxRenderable) => (scroll = element)}
        verticalScrollbarOptions={{ visible: false }}
        horizontalScrollbarOptions={{ visible: false }}
      >
        <For each={rows()}>
          {(row, index) => {
            const isSelected = () => selected()?.path === row.node.path
            const prefix = () => prefixes()[index()]
            return (
              <box
                flexDirection="row"
                width="100%"
                backgroundColor={isSelected() ? skin().accent : undefined}
                onMouseUp={() => onRowClick(row)}
              >
                <text fg={isSelected() ? skin().panel : skin().muted} wrapMode="none" flexShrink={0}>
                  {prefix()}
                </text>
                <box flexGrow={1} minWidth={0}>
                  <text
                    fg={isSelected() ? skin().panel : row.node.type === "dir" ? skin().accent : skin().text}
                    wrapMode="none"
                  >
                    {row.node.name}
                  </text>
                </box>
              </box>
            )
          }}
        </For>
      </scrollbox>
    </box>
  )
}

/** 插件入口 */
const tui: TuiPlugin = async (api, options) => {
  if (options?.enabled === false) return

  // 初始化文件树（默认只展开当前目录）
  const rootDir = api.state.path.directory
  const root = buildFileTree(rootDir)
  setTree(root)
  setExpanded(new Set([root.path]))

  // 注册侧边栏槽位（order 600，内置 files 500 之后）
  api.slots.register({
    order: 600,
    slots: {
      sidebar_content() {
        return visible() ? <FileTree api={api} /> : <box />
      },
    },
  })

  // 注册快捷键层（默认键 + tui.json 覆盖）
  const keybinds = (options?.keybinds ?? {}) as Record<string, string>
  const keys = createBindingLookup({ ...defaultKeymap, ...keybinds })
  api.keymap.registerLayer({
    enabled: true,
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
          const node = selected()
          if (!node) return
          if (node.type === "dir") toggleDir(node)
          else openFile(api, node)
        },
      },
    ],
    bindings: keys.gather("fs.global", ["fs.toggle", "fs.open"]),
  })
}

const plugin: TuiPluginModule & { id: string } = {
  id: "fs-plugin",
  tui,
}

export default plugin
