// src/layout-utils/layout.ts — 布局/折行工具
// 遵循 guidance/engineering_spec.md：函数加中文注释、错误信息中文

/** CJK 与全角字符按 2 列计宽的判定（覆盖常用汉字、假名、韩文及全角符号） */
const WIDE_RE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\u4E00-\u9FFF\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u3040-\u309F\u30A0-\u30FF]/

/**
 * 计算字符串的终端显示宽度（CJK 计 2，ASCII 计 1）
 */
export function displayWidth(str: string): number {
  let w = 0
  for (const ch of str) {
    w += WIDE_RE.test(ch) ? 2 : 1
  }
  return w
}

/**
 * 自动折行：将单行文本按显示宽度切分为多行。
 * 制表符展开为 4 空格；按 displayWidth 累加，超宽则换行而非截断。
 */
export function wrapLine(line: string, width: number): string[] {
  if (width <= 0) return [line]
  const expanded = line.replace(/\t/g, "    ")
  if (expanded.length === 0) return [""]
  if (displayWidth(expanded) <= width) return [expanded]
  const out: string[] = []
  let cur = ""
  let curW = 0
  for (const ch of expanded) {
    const w = WIDE_RE.test(ch) ? 2 : 1
    if (curW + w > width) {
      out.push(cur)
      cur = ch
      curW = w
    } else {
      cur += ch
      curW += w
    }
  }
  if (cur) out.push(cur)
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
