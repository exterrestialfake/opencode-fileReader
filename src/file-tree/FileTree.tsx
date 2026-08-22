/** @jsxImportSource @opentui/solid */
// src/file-tree/FileTree.tsx — 文件树独立模块（侧边栏渲染）
// 遵循 guidance/engineering_spec.md：组件 PascalCase、函数 camelCase、中文注释
import { createMemo, For } from "solid-js"
import type { ScrollBoxRenderable } from "@opentui/core"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { flattenFileTree, type FileNode, type FlatNode } from "./tree-utils"
import { createSkin, type Skin } from "../file-viewer/viewer-utils"

/** 生成树行前缀（一次计算，避免每行向后扫描整棵树） */
export function createRowPrefixes(rows: FlatNode[], expandedSet: Set<string>): string[] {
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
export function FileTree(props: {
  api: TuiPluginApi
  tree: () => FileNode | null
  expanded: () => Set<string>
  selected: () => FileNode | null
  onToggleDir: (node: FileNode) => void
  onOpenFile: (node: FileNode) => void
}) {
  const skin = createMemo<Skin>(() => createSkin(props.api.theme.current))
  const rows = createMemo<FlatNode[]>(() => {
    const root = props.tree()
    return root ? flattenFileTree(root, props.expanded()) : []
  })
  const prefixes = createMemo(() => createRowPrefixes(rows(), props.expanded()))
  let scroll: ScrollBoxRenderable | undefined

  const onRowClick = (row: FlatNode) => {
    const node = row.node
    if (node.type === "dir") props.onToggleDir(node)
    else props.onOpenFile(node)
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
            const isSelected = () => props.selected()?.path === row.node.path
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
