/** @jsxImportSource @opentui/solid */
// src/FileTree.tsx — 文件树组件（侧边栏渲染，支持 inline 新建/重命名）
// 遵循 guidance/engineering_spec.md：组件 PascalCase、函数 camelCase、中文注释
import { createEffect, createMemo, For, onCleanup, Show } from "solid-js"
import type { ScrollBoxRenderable } from "@opentui/core"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createRowPrefixes, flattenFileTree, type FileNode, type FlatNode } from "./file-tree-utils/tree"
import { createSkin, type Skin } from "./theme-utils/theme"

/** inline 编辑状态 */
export type EditingState = {
  kind: "createFile" | "createFolder" | "rename"
  /** 重命名时为被重命名路径，新建时为空 */
  targetPath?: string
  /** 父目录路径（新建时创建位置，重命名时为 dirname(target)） */
  parentPath: string
  /** 输入框当前值 */
  value: string
  /** 实时校验错误（红字） */
  error: string | null
}

/** 文件树组件（sidebar_content 槽位内容） */
export function FileTree(props: {
  api: TuiPluginApi
  tree: () => FileNode | null
  expanded: () => Set<string>
  selected: () => FileNode | null
  onToggleDir: (node: FileNode) => void
  onOpenFile: (node: FileNode) => void
  editing?: () => EditingState | null
  onEditingChange?: (value: string) => void
  onEditingSubmit?: () => void
  onEditingCancel?: () => void
}) {
  const skin = createMemo<Skin>(() => createSkin(props.api.theme.current))
  const rows = createMemo<FlatNode[]>(() => {
    const root = props.tree()
    return root ? flattenFileTree(root, props.expanded()) : []
  })
  const prefixes = createMemo(() => createRowPrefixes(rows(), props.expanded()))
  let scroll: ScrollBoxRenderable | undefined

  // 稳定滚动：光标移出时仅滚动一行（模拟拉动滚动条），避免来回跳跃
  // 防御 viewport 未就绪时的闪回：高度过小则跳过本次滚动，等待布局完成
  createEffect(() => {
    const path = props.selected()?.path
    const index = rows().findIndex((row) => row.node.path === path)
    if (index === -1 || !scroll || !scroll.viewport) return
    const rawHeight = (scroll.viewport as unknown as { height: number }).height
    const height = Math.floor(rawHeight)
    if (height < 2) return
    const top = Math.floor(scroll.scrollTop)
    if (index < top) {
      scroll.scrollTo(index)
    } else if (index >= top + height) {
      scroll.scrollTo(index - height + 1)
    }
  })

  // 进入 inline 编辑时推高优先级 mode，确保 Enter/Esc 不抢 prompt（冗余保障：主推由 fs-plugin 同步 push/pop，此处保留以兼容直接渲染路径）
  createEffect(() => {
    const e = props.editing?.()
    if (!e) return
    const pop = props.api.mode.push("fs-plugin.inline-edit")
    onCleanup(pop)
  })

  const onRowClick = (row: FlatNode) => {
    const node = row.node
    if (node.type === "dir") props.onToggleDir(node)
    else props.onOpenFile(node)
  }

  /** 判断某行是否处于重命名编辑态 */
  const isRenameRow = (path: string) => {
    const e = props.editing?.()
    return !!e && e.kind === "rename" && e.targetPath === path
  }

  /** 判断是否需要渲染新建伪行（在父目录展开时插入） */
  const createRow = (): { parentDepth: number, editing: EditingState } | null => {
    const e = props.editing?.()
    if (!e || e.kind === "rename") return null
    const parent = e.parentPath
    const tree = props.tree()
    if (!tree) return null
    const isExpanded = props.expanded().has(parent)
    if (!isExpanded && parent !== tree.path) return null
    const flat = rows()
    const parentRow = flat.find((r) => r.node.path === parent)
    const depth = parentRow ? parentRow.depth + 1 : 0
    return { parentDepth: depth, editing: e }
  }

  // 新建输入框出现时确保其紧随父目录可见
  createEffect(() => {
    const cr = createRow()
    if (!cr) return
    if (!scroll || !scroll.viewport) return
    const parentPath = cr.editing.parentPath
    const idx = rows().findIndex((r) => r.node.path === parentPath)
    if (idx === -1) return
    const rawHeight = (scroll.viewport as unknown as { height: number }).height
    const height = Math.floor(rawHeight)
    if (height < 2) return
    const top = Math.floor(scroll.scrollTop)
    const target = idx + 1
    if (target < top) scroll.scrollTo(target)
    else if (target >= top + height) scroll.scrollTo(target - height + 1)
  })

  return (
    <box flexDirection="column" width="100%" height="100%">
      <scrollbox
        ref={(element: ScrollBoxRenderable) => (scroll = element)}
        flexGrow={1}
        viewportCulling={false}
        verticalScrollbarOptions={{ visible: false }}
        horizontalScrollbarOptions={{ visible: false }}
      >
        <For each={rows()}>
          {(row, index) => {
            const isSelected = () => props.selected()?.path === row.node.path
            const prefix = () => prefixes()[index()]
            const editing = () => props.editing?.() ?? null
            const renameActive = () => isRenameRow(row.node.path)
            const currentEditing = () => editing()
            const showCreateHere = () => {
              const cr = createRow()
              return cr && row.node.path === cr.editing.parentPath ? cr : null
            }
            return (
              <>
                <box
                  flexDirection="row"
                  width="100%"
                  backgroundColor={isSelected() && !renameActive() ? skin().accent : undefined}
                  onMouseUp={() => {
                    if (renameActive()) return
                    onRowClick(row)
                  }}
                >
                  <text fg={isSelected() && !renameActive() ? skin().panel : skin().muted} wrapMode="none" flexShrink={0}>
                    {prefix()}
                  </text>
                  <box flexGrow={1} minWidth={0}>
                    <Show when={renameActive() && currentEditing()} fallback={
                      <text
                        fg={isSelected() ? skin().panel : row.node.type === "dir" ? skin().accent : skin().text}
                        wrapMode="none"
                      >
                        {row.node.name}
                      </text>
                    }>
                      <box flexDirection="column" flexGrow={1} minWidth={0}>
                        <input
                          value={currentEditing()?.value ?? ""}
                          focused={true}
                          onInput={(v: string) => props.onEditingChange?.(v)}
                          onSubmit={() => props.onEditingSubmit?.()}
                          placeholder={currentEditing()?.kind === "createFolder" ? "默认文件夹" : "默认文件.txt"}
                        />
                        <Show when={currentEditing()?.error}>
                          <text fg={skin().warning} wrapMode="none">{currentEditing()?.error}</text>
                        </Show>
                      </box>
                    </Show>
                  </box>
                </box>
                {/* 新建态：紧随父目录行后插入输入框，而非堆在列表底部 */}
                <Show when={showCreateHere()}>
                  {(cr: { parentDepth: number, editing: EditingState }) => {
                    if (!cr || !cr.editing) return <box />
                    const depth = cr.parentDepth ?? 0
                    const editing = cr.editing
                    const indent = () => "   ".repeat(depth)
                    const branch = () => "├─ "
                    return (
                      <box flexDirection="column" width="100%">
                        <box flexDirection="row" width="100%" backgroundColor={skin().accent}>
                          <text fg={skin().panel} wrapMode="none" flexShrink={0}>
                            {`${indent()}${branch()}`}
                          </text>
                          <box flexGrow={1} minWidth={0}>
                            <input
                              value={editing?.value ?? ""}
                              focused={true}
                              onInput={(v: string) => props.onEditingChange?.(v)}
                              onSubmit={() => props.onEditingSubmit?.()}
                              placeholder={editing?.kind === "createFolder" ? "默认文件夹" : "默认文件.txt"}
                            />
                          </box>
                        </box>
                        <Show when={editing?.error}>
                          <box paddingLeft={depth * 3 + 3}>
                            <text fg={skin().warning} wrapMode="none">{editing?.error}</text>
                          </box>
                        </Show>
                      </box>
                    )
                  }}
                </Show>
              </>
            )
          }}
        </For>
        {/* 根目录新建时（无父行可跟随）的兜底渲染 */}
        <Show when={(() => { const cr = createRow(); return cr && !rows().some(r => r.node.path === cr.editing.parentPath) ? cr : null })()}>
          {(cr: { parentDepth: number, editing: EditingState }) => {
            if (!cr || !cr.editing) return <box />
            const depth = cr.parentDepth ?? 0
            const editing = cr.editing
            const indent = () => "   ".repeat(depth)
            const branch = () => "├─ "
            return (
              <box flexDirection="column" width="100%">
                <box flexDirection="row" width="100%" backgroundColor={skin().accent}>
                  <text fg={skin().panel} wrapMode="none" flexShrink={0}>
                    {`${indent()}${branch()}`}
                  </text>
                  <box flexGrow={1} minWidth={0}>
                    <input
                      value={editing?.value ?? ""}
                      focused={true}
                      onInput={(v: string) => props.onEditingChange?.(v)}
                      onSubmit={() => props.onEditingSubmit?.()}
                      placeholder={editing?.kind === "createFolder" ? "默认文件夹" : "默认文件.txt"}
                    />
                  </box>
                </box>
                <Show when={editing?.error}>
                  <box paddingLeft={depth * 3 + 3}>
                    <text fg={skin().warning} wrapMode="none">{editing?.error}</text>
                  </box>
                </Show>
              </box>
            )
          }}
        </Show>
      </scrollbox>
    </box>
  )
}
