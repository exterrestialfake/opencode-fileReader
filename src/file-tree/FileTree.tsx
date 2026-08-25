/** @jsxImportSource @opentui/solid */
// src/file-tree/FileTree.tsx — 文件树独立模块（侧边栏渲染）
// 遵循 guidance/engineering_spec.md：组件 PascalCase、函数 camelCase、中文注释
import { createEffect, createMemo, For } from "solid-js"
import type { ScrollBoxRenderable } from "@opentui/core"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createRowPrefixes, flattenFileTree, type FileNode, type FlatNode } from "./tree-utils"
import { createSkin, type Skin } from "../file-viewer/viewer-utils"

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

  // 稳定滚动：光标移出时仅滚动一行（模拟拉动滚动条），避免来回跳跃
  createEffect(() => {
    const path = props.selected()?.path
    const index = rows().findIndex((row) => row.node.path === path)
    if (index === -1 || !scroll) return
    const top = Math.floor(scroll.scrollTop)
    const height = Math.max(1, Math.floor(scroll.viewport.height))
    if (index < top) {
      // 向上越界一格 -> 仅上滚一行，光标出现在可视区顶部
      scroll.scrollTo(index)
    } else if (index >= top + height) {
      // 向下越界一格 -> 仅下滚一行，光标出现在可视区底部
      scroll.scrollTo(index - height + 1)
    }
  })

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
