// src/layout-utils/layout.ts — 布局/折行工具
// 遵循 guidance/engineering_spec.md：函数加中文注释、错误信息中文

/**
 * 自动折行：将单行文本按显示宽度切分为多行。
 * 制表符展开为 4 空格；长行换到下一显示行而非截断。
 */
export function wrapLine(line: string, width: number): string[] {
  if (width <= 0) return [line]
  const expanded = line.replace(/\t/g, "    ")
  if (expanded.length === 0) return [""]
  if (expanded.length <= width) return [expanded]
  const out: string[] = []
  for (let i = 0; i < expanded.length; i += width) {
    out.push(expanded.slice(i, i + width))
  }
  return out
}

/**
 * 计算阅读页内容折行宽度：视口宽度优先（>0 时），否则按终端宽度估算（下限 40）；
 * 再扣除行号占位（6 列，"0001  "）与内容区内边距（2 列），最终下限 20 列。
 * 从 FileViewer 的 wrappedLines 记忆体原样提取，仅为可测性导出（窄终端行为可独立验证）。
 */
export function viewerWrapWidth(viewportWidth: number, termWidth: number): number {
  const estimated = Math.max(40, termWidth - 50)
  const available = viewportWidth > 0 ? viewportWidth : estimated
  return Math.max(20, available - 6 - 2)
}
