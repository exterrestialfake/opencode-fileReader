// src/file-tree/tree-utils.ts — 文件树纯函数（无目录/节点上限，去限制后的版本）
// 遵循 guidance/engineering_spec.md：函数加中文注释、错误信息中文、camelCase
import { readdirSync, statSync } from "node:fs"
import { join, basename } from "node:path"

/** 文件树节点 */
export type FileNode = {
  name: string
  path: string
  type: "dir" | "file"
  size?: number
  children?: FileNode[]
}

/** 扁平化后的树节点（带缩进深度，用于渲染） */
export type FlatNode = {
  node: FileNode
  depth: number
}

/** 判断是否为隐藏文件（`.` 开头）——默认可见，不做过滤 */
export function isHiddenFile(name: string): boolean {
  return name.startsWith(".")
}

/** 目录优先排序，同类型按名称排序 */
export function sortEntries(a: FileNode, b: FileNode): number {
  if (a.type !== b.type) return a.type === "dir" ? -1 : 1
  return a.name.localeCompare(b.name)
}

/** 读取目录下一级条目（隐藏文件默认包含，已移除条目上限） */
export function readDirEntries(dir: string): FileNode[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .map((entry) => {
        const path = join(dir, entry.name)
        const node: FileNode = { name: entry.name, path, type: entry.isDirectory() ? "dir" : "file" }
        if (!entry.isDirectory()) {
          try {
            node.size = statSync(path).size
          } catch {
            /* 忽略 stat 失败（如权限不足） */
          }
        }
        return node
      })
      .sort(sortEntries)
  } catch {
    return []
  }
}

/** 构建文件树（仅读取根目录下一级，子目录按需加载） */
export function buildFileTree(root: string): FileNode {
  return { name: basename(root) || root, path: root, type: "dir", children: readDirEntries(root) }
}

/** 递归加载所有子目录（已移除节点上限） */
export function expandAll(node: FileNode): void {
  if (node.type !== "dir") return
  if (!node.children) node.children = readDirEntries(node.path)
  for (const child of node.children) expandAll(child)
}

/** 收集所有目录路径（用于默认展开状态） */
export function collectDirPaths(node: FileNode): Set<string> {
  const set = new Set<string>()
  const walk = (n: FileNode) => {
    if (n.type === "dir") {
      set.add(n.path)
      n.children?.forEach(walk)
    }
  }
  walk(node)
  return set
}

/** 在树中按路径查找节点（仅遍历已加载部分，折叠目录未加载子项自然不深入） */
export function findNodeByPath(root: FileNode, path: string): FileNode | null {
  if (root.path === path) return root
  for (const child of root.children ?? []) {
    const hit = findNodeByPath(child, path)
    if (hit) return hit
  }
  return null
}

/** 刷新结果：tree 为刷新后的新树（根目录被删除时为 null）；validExpanded 为仍存在的已展开目录路径 */
export type RefreshResult = {
  tree: FileNode | null
  validExpanded: Set<string>
}

/**
 * 刷新文件树以反映外部文件系统变化（新增/删除/重命名）：
 * 重读根目录与所有已展开目录的子项，折叠目录保持懒加载不读取；
 * 已被删除的展开路径不会出现在 validExpanded 中，由调用方同步收缩展开集合。
 */
export function refreshTree(root: FileNode, expandedPaths: Set<string>): RefreshResult {
  // 根目录已被删除或不可访问：整棵树作废，由调用方清空相关状态
  try {
    if (!statSync(root.path).isDirectory()) return { tree: null, validExpanded: new Set() }
  } catch {
    return { tree: null, validExpanded: new Set() }
  }
  const validExpanded = new Set<string>()
  if (expandedPaths.has(root.path)) validExpanded.add(root.path)

  /** 重读单个目录并递归处理子项：仍在展开集合中的子目录继续向下重读，其余保持懒加载 */
  const rebuildDir = (dirPath: string, name: string): FileNode => {
    const children = readDirEntries(dirPath).map((child) => {
      if (child.type !== "dir") return child // 文件节点由 readDirEntries 生成，大小等信息已是最新
      if (!expandedPaths.has(child.path)) {
        const collapsed: FileNode = { name: child.name, path: child.path, type: "dir" }
        return collapsed // 折叠目录不读取子项，保持懒加载
      }
      validExpanded.add(child.path)
      return rebuildDir(child.path, child.name)
    })
    return { name, path: dirPath, type: "dir", children }
  }

  return { tree: rebuildDir(root.path, root.name), validExpanded }
}

/** 将文件树扁平化为带缩进深度的列表（跳过根节点，用于渲染） */
export function flattenFileTree(root: FileNode, expanded: Set<string>): FlatNode[] {
  const out: FlatNode[] = []
  const walk = (node: FileNode, depth: number) => {
    out.push({ node, depth })
    if (node.type === "dir" && expanded.has(node.path) && node.children) {
      for (const child of node.children) walk(child, depth + 1)
    }
  }
  if (root.children) for (const child of root.children) walk(child, 0)
  return out
}

/**
 * 切换目录展开/折叠：展开时懒加载子目录（children 缺失才读取），返回新的展开集合。
 * 不修改传入集合，调用方以新集合触发重渲染；从 fs-plugin 入口原样提取，仅为可测性导出。
 */
export function toggleExpanded(node: FileNode, expanded: Set<string>): Set<string> {
  const next = new Set(expanded)
  if (next.has(node.path)) {
    next.delete(node.path)
  } else {
    if (!node.children) node.children = readDirEntries(node.path)
    next.add(node.path)
  }
  return next
}
