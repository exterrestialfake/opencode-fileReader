// src/file-tree-utils/keyboard-nav.ts — 文件树键盘导航层（ctrl+up 上移、ctrl+down 下移、ctrl+left 折叠、ctrl+right 展开）
// 2026/8/24 19:41 enter 已合并至 fs.open（fs-plugin 全局 ctrl+o + viewer 模式 enter），本模块不再注册打开
// 遵循 guidance/engineering_spec.md：函数加中文注释、错误信息中文、camelCase
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { moveCursorIndex, visibleParentDir } from "./cursor-utils"
import type { FileNode, FlatNode } from "./tree"

/** 键盘导航层运行所需的树状态读写接口（由插件入口注入，本模块不感知 solid 信号实现） */
export type TreeNavDeps = {
  /** 插件 API（用于注册 keymap 层与查询当前路由） */
  api: TuiPluginApi
  /** 已解析快捷键（config.json 默认值 + tui.json 覆盖后的单一来源） */
  resolvedKeymap: Record<string, string>
  /** 当前可见行（随展开状态变化的扁平化结果） */
  visibleRows: () => FlatNode[]
  /** 读取当前选中节点 */
  getSelected: () => FileNode | null
  /** 写入选中节点 */
  setSelected: (node: FileNode | null) => void
  /** 判断目录是否处于展开状态 */
  isExpanded: (path: string) => boolean
  /** 切换目录展开/折叠 */
  toggleDir: (node: FileNode) => void
  /** 打开文件（阅读页动态跟随渲染） */
  openFile: (node: FileNode) => void
  /** 是否处于 fs-viewer 阅读页路由 */
  isViewerRoute: () => boolean
}

/** 光标上移一行（到顶停留）；落在文件上时阅读页自动跟随打开 */
function moveCursor(deps: TreeNavDeps, delta: number): void {
  const rows = deps.visibleRows()
  const index = moveCursorIndex(rows, deps.getSelected()?.path ?? null, delta)
  if (index === -1) return
  const next = rows[index]!.node
  if (next.type === "file") deps.openFile(next)
  else deps.setSelected(next)
}

/** ctrl+left：展开中的目录折叠；已折叠目录或文件跳到父目录（父目录未渲染则不动） */
function cursorLeft(deps: TreeNavDeps): void {
  const node = deps.getSelected()
  if (!node) return
  if (node.type === "dir" && deps.isExpanded(node.path)) {
    deps.toggleDir(node)
    return
  }
  const parent = visibleParentDir(node, deps.visibleRows())
  if (parent) deps.setSelected(parent)
}

/** ctrl+right：折叠的目录展开（懒加载）；文件直接打开 */
function cursorRight(deps: TreeNavDeps): void {
  const node = deps.getSelected()
  if (!node) return
  if (node.type === "dir") {
    if (!deps.isExpanded(node.path)) deps.toggleDir(node)
    return
  }
  deps.openFile(node)
}

/**
 * 注册树键盘导航层并返回注销函数：
 * 全局注册（ctrl+up/down/left/right），带 ctrl 不影响提示词输入；打开已合并至 fs.open
 */
export function registerTreeNavLayer(deps: TreeNavDeps): () => void {
  return deps.api.keymap.registerLayer({
    priority: 10,
    commands: [
      { name: "fs.cursorUp", run() { moveCursor(deps, -1) } },
      { name: "fs.cursorDown", run() { moveCursor(deps, 1) } },
      { name: "fs.cursorLeft", run() { cursorLeft(deps) } },
      { name: "fs.cursorRight", run() { cursorRight(deps) } },
    ],
    bindings: [
      { key: deps.resolvedKeymap["fs.cursorUp"]!, cmd: "fs.cursorUp" },
      { key: deps.resolvedKeymap["fs.cursorDown"]!, cmd: "fs.cursorDown" },
      { key: deps.resolvedKeymap["fs.cursorLeft"]!, cmd: "fs.cursorLeft" },
      { key: deps.resolvedKeymap["fs.cursorRight"]!, cmd: "fs.cursorRight" },
    ],
  })
}
