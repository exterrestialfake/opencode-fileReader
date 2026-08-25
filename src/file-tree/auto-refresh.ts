// src/file-tree/auto-refresh.ts — 文件树自动刷新（fs.watch 递归监听 + 轮询保底）
// 遵循 guidance/engineering_spec.md：函数加中文注释、错误信息中文、camelCase
import { existsSync, statSync, watch, type FSWatcher } from "node:fs"
import { buildFileTree, findNodeByPath, refreshTree, type FileNode } from "./tree-utils"

/** watch 事件防抖间隔（毫秒）：合并短时间内的连续文件系统事件，避免频繁全量重读 */
export const REFRESH_DEBOUNCE_MS = 300

/** 轮询保底间隔（毫秒）：watch 不可用或漏事件时兜底检测目录变化 */
export const REFRESH_POLL_MS = 2000

/** 自动刷新所需的文件树状态读写接口（由插件入口注入，避免本模块依赖 solid 信号） */
export type AutoRefreshDeps = {
  /** 文件树根目录（当前工作目录） */
  rootDir: () => string
  /** 读取当前树根节点 */
  getTree: () => FileNode | null
  /** 写入新树根节点（传 null 表示根目录已失效，树被清空） */
  setTree: (node: FileNode | null) => void
  /** 读取已展开目录路径集合 */
  getExpanded: () => Set<string>
  /** 写入已展开目录路径集合 */
  setExpanded: (paths: Set<string>) => void
  /** 读取当前选中节点 */
  getSelected: () => FileNode | null
  /** 写入选中节点（选中文件被删除时置 null） */
  setSelected: (node: FileNode | null) => void
}

/**
 * 执行一次刷新：重读根目录与所有已展开目录的子项，
 * 收缩已被删除的展开路径；选中文件仍存在则保留原节点对象
 * （避免阅读页状态被重置），已被删除则清空选中。
 */
export function applyRefresh(deps: AutoRefreshDeps): void {
  const root = deps.getTree()
  if (!root) return
  const result = refreshTree(root, deps.getExpanded())
  deps.setExpanded(result.validExpanded)
  if (!result.tree) {
    // 根目录已被删除：清空树与选中，等待轮询在根目录恢复后整棵重建
    deps.setSelected(null)
    deps.setTree(null)
    return
  }
  const sel = deps.getSelected()
  if (sel && !findNodeByPath(result.tree, sel.path)) deps.setSelected(null)
  deps.setTree(result.tree)
}

/**
 * 启动自动刷新：优先用 fs.watch 递归监听根目录（事件经防抖合并），
 * 并始终保留低频轮询做 mtime 变更检测作为保底（覆盖 watch 不可用或漏事件的平台）；
 * 返回清理函数，供 onCleanup / api.lifecycle.onDispose 释放 watcher 与定时器。
 */
export function startAutoRefresh(deps: AutoRefreshDeps): () => void {
  const rootDir = deps.rootDir()
  let debounceTimer: ReturnType<typeof setTimeout> | undefined

  /** 防抖调度刷新：高频事件只触发最后一次重读 */
  const scheduleRefresh = () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => applyRefresh(deps), REFRESH_DEBOUNCE_MS)
  }

  // 递归 watch：Windows/macOS 原生支持；创建失败（如平台不支持）时静默降级为仅轮询
  let watcher: FSWatcher | undefined
  try {
    watcher = watch(rootDir, { recursive: true }, scheduleRefresh)
    watcher.on("error", () => {
      /* watch 失效（如根目录被暂时移除）时忽略，由轮询保底继续工作 */
    })
  } catch {
    watcher = undefined
  }

  // 轮询保底：对根目录与所有已展开目录做 mtime 廉价检测，仅在变化时才全量重读，避免卡顿 TUI
  const lastMtimes = new Map<string, number>()
  const poll = setInterval(() => {
    const root = deps.getTree()
    if (!root) {
      // 树已因根目录被删而清空：轮询等待根目录恢复后重建并默认展开根目录
      if (existsSync(rootDir)) {
        deps.setTree(buildFileTree(rootDir))
        deps.setExpanded(new Set([rootDir]))
        lastMtimes.clear()
      }
      return
    }
    let changed = false
    const seen = new Set<string>()
    for (const dir of [root.path, ...deps.getExpanded()]) {
      seen.add(dir)
      let mtime: number
      try {
        mtime = statSync(dir).mtimeMs
      } catch {
        mtime = -1 // 目录已消失，视为发生变化
      }
      const prev = lastMtimes.get(dir)
      if (prev === undefined) {
        lastMtimes.set(dir, mtime) // 首次记录基线，不触发刷新
      } else if (prev !== mtime) {
        changed = true
        lastMtimes.set(dir, mtime)
      }
    }
    for (const key of lastMtimes.keys()) {
      if (!seen.has(key)) lastMtimes.delete(key) // 清理已折叠/失效目录的基线记录
    }
    if (changed) applyRefresh(deps)
  }, REFRESH_POLL_MS)

  /** 清理：释放轮询定时器、防抖定时器与 watcher */
  return () => {
    clearInterval(poll)
    if (debounceTimer) clearTimeout(debounceTimer)
    watcher?.close()
  }
}
