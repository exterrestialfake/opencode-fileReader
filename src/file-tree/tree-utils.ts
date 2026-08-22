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
