/** @jsxImportSource @opentui/solid */
// fs-plugin.tsx — 兼容入口（转发至模块化实现）
// 实际实现已拆至 src 根组件、各类 -utils 与 src/config；本文件保留以兼容 tui.test.json 的 file:// 指向
// 遵循 guidance/engineering_spec.md：组件 PascalCase、函数 camelCase、中文注释
import { createSignal, onCleanup, Show } from "solid-js"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { buildFileTree, flattenFileTree, toggleExpanded, type FileNode, type FlatNode } from "./src/file-tree-utils/tree"
import { applyRefresh, startAutoRefresh, type AutoRefreshDeps } from "./src/file-tree-utils/auto-refresh"
import { registerTreeNavLayer } from "./src/file-tree-utils/keyboard-nav"
import { resolveBaseRoute, returnToBase } from "./src/route-utils/route"
import { FileTree, type EditingState } from "./src/FileTree"
import { FileViewer } from "./src/FileViewer"
import { resolveKeybinds } from "./src/config/index"
import { createFileAt, createFolderAt, getSiblingNames, removeAt, renameAt, tryOpenExternalIfNotText, validateFileName } from "./src/file-utils/file"
import { dirname, extname, join } from "node:path"
import { readdirSync, statSync } from "node:fs"

/** 全屏查看路由名（与宿主保留路由 home/session 区分） */
const VIEWER_ROUTE = "fs-viewer"

/** 阅读页模式名（路由挂载期间由宿主模式栈持有，卸载时弹出） */
const VIEWER_MODE = "fs-plugin.viewer"

// 模块级状态（跨组件共享）
const [visible, setVisible] = createSignal(true)
const [tree, setTree] = createSignal<FileNode | null>(null)
const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
const [selected, setSelected] = createSignal<FileNode | null>(null)
/** inline 编辑状态（新建/重命名） */
const [editing, setEditing] = createSignal<EditingState | null>(null)
/** 打开查看器前的来源路由（用于关闭时返回） */
const [baseRoute, setBaseRoute] = createSignal<{ name: string; sessionID?: string }>({ name: "home" })

/** 切换目录展开/折叠（展开时懒加载子目录，已移除节点上限；集合更新逻辑下沉至 file-tree-utils/tree.toggleExpanded） */
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

/** 获取新建操作的父目录（选中为文件时取其父目录，选中为目录时取自身，否则取根） */
function getParentDirForCreate(): string {
  const cur = selected()
  const root = tree()
  if (!root) return ""
  if (!cur) return root.path
  if (cur.type === "dir") return cur.path
  return dirname(cur.path)
}

let popInlineEdit: (() => void) | null = null
function pushInlineEditMode(api: TuiPluginApi) {
  if (popInlineEdit) return
  popInlineEdit = api.mode.push("fs-plugin.inline-edit")
}
function popInlineEditMode() {
  if (!popInlineEdit) return
  try { popInlineEdit() } catch {}
  popInlineEdit = null
}

/** 取消 inline 编辑（失焦或 Esc） */
function cancelEditing(api?: TuiPluginApi) {
  setEditing(null)
  popInlineEditMode()
}

/** 实时校验：根据当前 editing.value 与同级文件名更新 error */
function updateEditingError() {
  const e = editing()
  if (!e) return
  const siblings = getSiblingNames(e.parentPath)
  // 重命名时排除自身
  const filtered = e.kind === "rename" && e.targetPath ? siblings.filter((n) => join(e.parentPath, n) !== e.targetPath) : siblings
  const err = validateFileName(e.value, filtered)
  if (err !== e.error) setEditing({ ...e, error: err })
}

/** 提交 inline 编辑（Enter） */
function submitEditing(api: TuiPluginApi) {
  const e = editing()
  if (!e) {
    popInlineEditMode()
    return
  }
  if (e.error) return
  const trimmed = e.value.trim()
  // 再次校验空
  if (trimmed.length === 0) {
    setEditing({ ...e, error: "文件名不能为空" })
    return
  }
  if (e.kind === "createFile") {
    const res = createFileAt(e.parentPath, trimmed)
    if (!res.ok) {
      setEditing({ ...e, error: res.error })
      api.ui.dialog.replace(() => <api.ui.DialogAlert title="创建失败" message={res.error} onConfirm={() => api.ui.dialog.clear()} />)
      return
    }
    setEditing(null)
    // 确保父目录展开
    if (!expanded().has(e.parentPath)) setExpanded(new Set([...expanded(), e.parentPath]))
    if (tree()) applyRefresh({ getTree: () => tree()!, getExpanded: () => expanded(), setTree, setExpanded, getSelected: () => selected(), setSelected, rootDir: () => tree()!.path } as unknown as AutoRefreshDeps)
    else {
      const root = buildFileTree(e.parentPath)
      setTree(root)
    }
    popInlineEditMode()
    // 选中新文件
    const newPath = join(e.parentPath, trimmed)
    // 尝试在新树中找到节点
    const rootNode = tree()
    if (rootNode) {
      const walk = (node: FileNode): FileNode | null => {
        if (node.path === newPath) return node
        for (const c of node.children ?? []) { const hit = walk(c); if (hit) return hit }
        return null
      }
      const hit = walk(rootNode)
      if (hit) setSelected(hit)
    }
  } else if (e.kind === "createFolder") {
    const res = createFolderAt(e.parentPath, trimmed)
    if (!res.ok) {
      setEditing({ ...e, error: res.error })
      api.ui.dialog.replace(() => <api.ui.DialogAlert title="创建失败" message={res.error} onConfirm={() => api.ui.dialog.clear()} />)
      return
    }
    setEditing(null)
    popInlineEditMode()
    if (!expanded().has(e.parentPath)) setExpanded(new Set([...expanded(), e.parentPath]))
    if (tree()) applyRefresh({ getTree: () => tree()!, getExpanded: () => expanded(), setTree, setExpanded, getSelected: () => selected(), setSelected, rootDir: () => tree()!.path } as unknown as AutoRefreshDeps)
    const newPath = join(e.parentPath, trimmed)
    const rootNode = tree()
    if (rootNode) {
      const walk = (node: FileNode): FileNode | null => {
        if (node.path === newPath) return node
        for (const c of node.children ?? []) { const hit = walk(c); if (hit) return hit }
        return null
      }
      const hit = walk(rootNode)
      if (hit) setSelected(hit)
    }
  } else if (e.kind === "rename") {
    const oldPath = e.targetPath!
    const res = renameAt(oldPath, trimmed)
    if (!res.ok) {
      setEditing({ ...e, error: res.error })
      api.ui.dialog.replace(() => <api.ui.DialogAlert title="重命名失败" message={res.error} onConfirm={() => api.ui.dialog.clear()} />)
      return
    }
    setEditing(null)
    popInlineEditMode()
    if (tree()) applyRefresh({ getTree: () => tree()!, getExpanded: () => expanded(), setTree, setExpanded, getSelected: () => selected(), setSelected, rootDir: () => tree()!.path } as unknown as AutoRefreshDeps)
    const newPath = join(e.parentPath, trimmed)
    const rootNode = tree()
    if (rootNode) {
      const walk = (node: FileNode): FileNode | null => {
        if (node.path === newPath) return node
        for (const c of node.children ?? []) { const hit = walk(c); if (hit) return hit }
        return null
      }
      const hit = walk(rootNode)
      if (hit) setSelected(hit)
    }
  }
}

/** 生成不冲突的默认名（带序号递增） */
function uniqueDefaultName(parent: string, base: string): string {
  const siblings = new Set(getSiblingNames(parent).map(s => s.toLowerCase()))
  if (!siblings.has(base.toLowerCase())) return base
  const dot = base.lastIndexOf(".")
  const namePart = dot > 0 ? base.slice(0, dot) : base
  const extPart = dot > 0 ? base.slice(dot) : ""
  for (let i = 1; i < 100; i++) {
    const cand = `${namePart} (${i})${extPart}`
    if (!siblings.has(cand.toLowerCase())) return cand
  }
  return base
}

/** 开始新建文件：立即落盘并进入重命名（按用户要求：ctrl+n 后直接出现文件，只需改名） */
function startCreateFile(api?: TuiPluginApi) {
  const parent = getParentDirForCreate()
  if (!parent) {
    if (api) api.ui.dialog.replace(() => <api.ui.DialogAlert title="无法创建" message="当前无可用目录" onConfirm={() => api.ui.dialog.clear()} />)
    return
  }
  const name = uniqueDefaultName(parent, "默认文件.txt")
  const res = createFileAt(parent, name)
  if (!res.ok) {
    if (api) api.ui.dialog.replace(() => <api.ui.DialogAlert title="创建失败" message={res.error} onConfirm={() => api.ui.dialog.clear()} />)
    return
  }
  if (!expanded().has(parent)) setExpanded(new Set([...expanded(), parent]))
  if (tree()) applyRefresh({ getTree: () => tree()!, getExpanded: () => expanded(), setTree, setExpanded, getSelected: () => selected(), setSelected, rootDir: () => tree()!.path } as unknown as AutoRefreshDeps)
  else setTree(buildFileTree(parent))
  const newPath = join(parent, name)
  const rootNode = tree()
  if (rootNode) {
    const walk = (node: FileNode): FileNode | null => {
      if (node.path === newPath) return node
      for (const c of node.children ?? []) { const hit = walk(c); if (hit) return hit }
      return null
    }
    const hit = walk(rootNode)
    if (hit) setSelected(hit)
  } else {
    // 兜底：若树重建失败仍尝试选中
    setSelected({ name, path: newPath, type: "file" } as FileNode)
  }
  setEditing({ kind: "rename", targetPath: newPath, parentPath: parent, value: name, error: null })
  updateEditingError()
  if (api) pushInlineEditMode(api)
}

/** 开始新建文件夹：立即落盘并进入重命名 */
function startCreateFolder(api?: TuiPluginApi) {
  const parent = getParentDirForCreate()
  if (!parent) {
    if (api) api.ui.dialog.replace(() => <api.ui.DialogAlert title="无法创建" message="当前无可用目录" onConfirm={() => api.ui.dialog.clear()} />)
    return
  }
  const name = uniqueDefaultName(parent, "默认文件夹")
  const res = createFolderAt(parent, name)
  if (!res.ok) {
    if (api) api.ui.dialog.replace(() => <api.ui.DialogAlert title="创建失败" message={res.error} onConfirm={() => api.ui.dialog.clear()} />)
    return
  }
  if (!expanded().has(parent)) setExpanded(new Set([...expanded(), parent]))
  if (tree()) applyRefresh({ getTree: () => tree()!, getExpanded: () => expanded(), setTree, setExpanded, getSelected: () => selected(), setSelected, rootDir: () => tree()!.path } as unknown as AutoRefreshDeps)
  else setTree(buildFileTree(parent))
  const newPath = join(parent, name)
  const rootNode = tree()
  if (rootNode) {
    const walk = (node: FileNode): FileNode | null => {
      if (node.path === newPath) return node
      for (const c of node.children ?? []) { const hit = walk(c); if (hit) return hit }
      return null
    }
    const hit = walk(rootNode)
    if (hit) setSelected(hit)
  }
  setEditing({ kind: "rename", targetPath: newPath, parentPath: parent, value: name, error: null })
  updateEditingError()
  if (api) pushInlineEditMode(api)
}

/** 开始重命名 */
function startRename(api?: TuiPluginApi) {
  const cur = selected()
  if (!cur) return
  const root = tree()
  if (root && cur.path === root.path) return
  const parent = dirname(cur.path)
  setEditing({ kind: "rename", targetPath: cur.path, parentPath: parent, value: cur.name, error: null })
  updateEditingError()
  if (api) pushInlineEditMode(api)
}

/** 执行删除（弹 confirm） */
function executeDelete(api: TuiPluginApi) {
  const cur = selected()
  if (!cur) return
  const root = tree()
  if (root && cur.path === root.path) {
    api.ui.dialog.replace(() => <api.ui.DialogAlert title="无法删除" message="不能对根目录执行此操作" onConfirm={() => api.ui.dialog.clear()} />)
    return
  }
  const isDir = cur.type === "dir"
  let count = 0
  if (isDir) {
    try {
      const entries = readdirSync(cur.path)
      count = entries.length
    } catch { count = 0 }
  }
  const message = isDir
    ? (count === 0 ? `确定删除空文件夹“${cur.name}”？` : `确定删除“${cur.name}”及其 ${count} 项内容？此操作不可撤销。`)
    : `确定删除文件“${cur.name}”？此操作不可撤销。`
  api.ui.dialog.replace(() => (
    <api.ui.DialogConfirm
      title="确认删除"
      message={message}
      onConfirm={() => {
        api.ui.dialog.clear()
        const res = removeAt(cur.path)
        if (!res.ok) {
          api.ui.dialog.replace(() => <api.ui.DialogAlert title="删除失败" message={res.error} onConfirm={() => api.ui.dialog.clear()} />)
          return
        }
        // 成功后刷新，选中回落父目录
        const parent = dirname(cur.path)
        if (tree()) applyRefresh({ getTree: () => tree()!, getExpanded: () => expanded(), setTree, setExpanded, getSelected: () => selected(), setSelected, rootDir: () => tree()!.path } as unknown as AutoRefreshDeps)
        // 选中回落
        const rootNode = tree()
        if (rootNode) {
          const walk = (node: FileNode): FileNode | null => {
            if (node.path === parent) return node
            for (const c of node.children ?? []) { const hit = walk(c); if (hit) return hit }
            return null
          }
          const hit = walk(rootNode)
          if (hit) setSelected(hit)
          else setSelected(rootNode.children?.[0] ?? null)
        }
      }}
      onCancel={() => api.ui.dialog.clear()}
    />
  ))
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
  const handleEditingChange = (value: string) => {
    const e = editing()
    if (!e) return
    const siblings = getSiblingNames(e.parentPath)
    const filtered = e.kind === "rename" && e.targetPath ? siblings.filter((n) => join(e.parentPath, n) !== e.targetPath) : siblings
    const err = validateFileName(value, filtered)
    setEditing({ ...e, value, error: err })
  }
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
            editing={editing}
            onEditingChange={handleEditingChange}
            onEditingSubmit={() => submitEditing(api)}
            onEditingCancel={cancelEditing}
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
                    editing={editing}
                    onEditingChange={handleEditingChange}
                    onEditingSubmit={() => submitEditing(api)}
                    onEditingCancel={cancelEditing}
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

  // 文件操作快捷键（创建/重命名/删除，priority 20 确保在输入框获焦时仍可触发，覆盖 prompt 的低优层）
  // 为规避终端对 ctrl+alt 组合的拦截，额外提供备用键：createFile 备用 ctrl+alt+f，createFolder 备用 ctrl+shift+f
  const createFileKey = resolvedKeymap["fs.createFile"]
  const createFolderKey = resolvedKeymap["fs.createFolder"]
  const renameKey = resolvedKeymap["fs.rename"]
  const deleteKey = resolvedKeymap["fs.delete"]
  const disposeFileOps = api.keymap.registerLayer({
    priority: 20,
    commands: [
      { name: "fs.createFile", run() { startCreateFile(api) } },
      { name: "fs.createFolder", run() { startCreateFolder(api) } },
      { name: "fs.rename", run() { startRename(api) } },
      { name: "fs.delete", run() { executeDelete(api) } },
    ],
    bindings: [
      { key: createFileKey, cmd: "fs.createFile" },
      { key: "ctrl+alt+f", cmd: "fs.createFile" },
      { key: createFolderKey, cmd: "fs.createFolder" },
      { key: "ctrl+shift+f", cmd: "fs.createFolder" },
      { key: renameKey, cmd: "fs.rename" },
      { key: deleteKey, cmd: "fs.delete" },
    ],
  })
  api.lifecycle.onDispose(() => { try { (disposeFileOps as unknown as () => void)?.() } catch {} })

  // inline 编辑态高优先级层（Enter 提交、Esc 取消，确保不抢 prompt）
  api.keymap.registerLayer({
    mode: "fs-plugin.inline-edit",
    priority: 20,
    commands: [
      { name: "fs.inline.confirm", run() { submitEditing(api) } },
      { name: "fs.inline.cancel", run() { cancelEditing(api) } },
    ],
    bindings: [
      { key: "enter", cmd: "fs.inline.confirm" },
      { key: "esc", cmd: "fs.inline.cancel" },
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
