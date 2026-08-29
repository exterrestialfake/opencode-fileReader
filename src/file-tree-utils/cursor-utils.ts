// src/file-tree-utils/cursor-utils.ts — 文件树键盘光标纯函数（基于可见行下标的移动与父目录定位）
// 遵循 guidance/engineering_spec.md：函数加中文注释、错误信息中文、camelCase
import { dirname } from "node:path"
import type { FileNode, FlatNode } from "./tree"

/**
 * 计算光标移动后的可见行下标（边界停留，不回绕）。
 * 树为空返回 -1；尚无选中或选中项已不在可见行中（如被刷新收缩）时落到第一行。
 */
export function moveCursorIndex(
  rows: FlatNode[],
  selectedPath: string | null | undefined,
  delta: number,
): number {
  if (rows.length === 0) return -1
  const current = selectedPath ? rows.findIndex((row) => row.node.path === selectedPath) : -1
  if (current === -1) return 0
  return Math.min(rows.length - 1, Math.max(0, current + delta))
}

/**
 * 在可见行中定位节点的父目录（用于 left/h 从文件或折叠目录跳到上级）。
 * 父目录必须已渲染才可选中：根目录不参与扁平化渲染，故根级条目返回 null（到顶为止）。
 */
export function visibleParentDir(node: FileNode, rows: FlatNode[]): FileNode | null {
  const parentPath = dirname(node.path)
  if (parentPath === node.path) return null
  const row = rows.find((item) => item.node.path === parentPath && item.node.type === "dir")
  return row ? row.node : null
}
