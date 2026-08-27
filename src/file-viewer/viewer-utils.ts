// src/file-viewer/viewer-utils.ts — 查看器纯函数：轻量着色、折行、文件类型判定等（已移除文件长度限制）
// 遵循 guidance/engineering_spec.md：函数加中文注释、错误信息中文
import { spawn } from "node:child_process"
import { openSync, readSync, closeSync } from "node:fs"
import { extname } from "node:path"
import { RGBA } from "@opentui/core"
import type { Skin } from "../theme"

/** 轻量着色区间（接口稳定，日后可替换为完整语法高亮实现） */
export type HighlightSpan = {
  start: number
  end: number
  kind: "keyword" | "comment" | "string" | "number"
}

/** 格式化文件大小（B/KB/MB/GB） */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

/** 文本文件扩展名集合 */
const TEXT_EXTS = new Set([
  "txt", "md", "markdown", "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "jsonc",
  "css", "scss", "less", "html", "htm", "xml", "yaml", "yml", "toml", "ini", "conf",
  "py", "rs", "go", "c", "h", "cpp", "hpp", "cc", "java", "kt", "swift", "rb", "php",
  "sh", "bat", "ps1", "tex", "sty", "cls", "bib", "log", "csv", "sql", "lua", "vue",
  "svelte", "env", "gitignore", "editorconfig", "lock", "gradle", "properties",
])

/** 图像文件扩展名集合 */
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "ico", "tiff", "tif"])

/** 判断文件是否为文本（按扩展名；无扩展名时探测内容是否含空字节） */
export function isTextFile(name: string, path?: string): boolean {
  const ext = extname(name).slice(1).toLowerCase()
  if (TEXT_EXTS.has(ext)) return true
  if (IMAGE_EXTS.has(ext)) return false
  if (path) {
    try {
      const fd = openSync(path, "r")
      const buf = Buffer.alloc(8192)
      const n = readSync(fd, buf, 0, 8192, 0)
      closeSync(fd)
      return !buf.subarray(0, n).includes(0)
    } catch {
      return false
    }
  }
  return false
}

/** 判断文件是否为图像 */
export function isImageFile(name: string): boolean {
  return IMAGE_EXTS.has(extname(name).slice(1).toLowerCase())
}

/** 用系统默认查看器打开文件（win32，已验证模式） */
export function openExternal(filePath: string) {
  spawn("explorer.exe", [filePath], { detached: true, stdio: "ignore", windowsHide: true }).unref()
}

/** 若文件为非文本则用系统查看器打开并返回是否已打开（与 isTextFile 合并后的简洁 API，供键盘导航复用） */
export function tryOpenExternalIfNotText(fileName: string, filePath: string): boolean {
  if (isTextFile(fileName, filePath)) return false
  openExternal(filePath)
  return true
}

/** 常见编程语言关键词（轻量正则匹配用） */
const KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "elif", "for", "while", "do",
  "switch", "case", "break", "continue", "import", "export", "from", "default", "class",
  "interface", "type", "extends", "implements", "new", "async", "await", "try", "catch",
  "finally", "throw", "typeof", "instanceof", "in", "of", "this", "super", "null",
  "undefined", "true", "false", "void", "public", "private", "protected", "static",
  "readonly", "enum", "namespace", "package", "using", "struct", "union", "fn", "impl",
  "match", "mut", "pub", "use", "mod", "trait", "where", "def", "lambda", "print", "echo",
  "require", "include", "define", "endif", "end", "begin", "then", "elseif", "endfunction",
  "endclass", "enddef", "endmodule", "int", "float", "double", "char", "bool", "string",
  "number", "boolean", "object", "array", "record", "unknown", "never", "any", "yield",
  "delete", "debugger", "with", "global", "local", "select", "loop", "until", "repeat",
  "exit", "goto", "label", "val", "fun", "data", "when", "otherwise", "fi", "esac", "done",
  "procedure", "sub", "endfor", "endwhile", "endswitch", "endforeach", "endtry", "endusing",
  "endnamespace", "endinterface", "endtype", "endrecord", "endunion", "endstruct", "endimpl",
  "endmod", "endtrait", "endwhere", "endfn", "endlambda", "enddef", "endprint", "endecho",
  "endrequire", "endinclude", "enddefine", "endmacro", "macro", "endselect", "endloop",
  "enduntil", "endrepeat", "endexit", "endgoto", "endlabel", "endval", "endfun", "enddata",
  "endwhen", "endotherwise", "endfi", "endesac", "enddone", "endprocedure", "endsub",
])

/** 按扩展名返回注释正则片段 */
function commentPattern(fileExt: string): string {
  const ext = fileExt.toLowerCase()
  if (ext === "tex" || ext === "sty" || ext === "cls") return "%[^\\n]*"
  if (ext === "py" || ext === "sh" || ext === "yaml" || ext === "yml" || ext === "toml" || ext === "ini" || ext === "conf") return "#[^\\n]*"
  if (ext === "lua" || ext === "sql") return "--[^\\n]*"
  return "\\/\\/[^\\n]*"
}

/** 主正则缓存（按扩展名，避免每行重建） */
const masterCache = new Map<string, RegExp>()

/** 获取主匹配正则（注释/字符串/数字/单词 四组） */
function getMaster(fileExt: string): RegExp {
  let re = masterCache.get(fileExt)
  if (!re) {
    const comment = commentPattern(fileExt)
    re = new RegExp(
      `(${comment})|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`(?:[^\\\`\\\\]|\\\\.)*\`)|(\\b\\d+(?:\\.\\d+)?\\b)|(\\b[A-Za-z_]\\w*\\b)`,
      "g",
    )
    masterCache.set(fileExt, re)
  }
  return re
}

/**
 * 轻量着色：对单行文本做正则级匹配，返回着色区间数组。
 * 接口稳定（line, fileExt → HighlightSpan[]），日后可无缝替换为完整语法高亮实现，
 * 调用方（FileViewer）不感知变化。
 */
export function highlightLine(line: string, fileExt: string): HighlightSpan[] {
  const spans: HighlightSpan[] = []
  const re = getMaster(fileExt)
  re.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(line)) !== null) {
    const start = match.index
    const end = start + match[0].length
    if (match[1] !== undefined) {
      spans.push({ start, end, kind: "comment" })
    } else if (match[2] !== undefined) {
      spans.push({ start, end, kind: "string" })
    } else if (match[3] !== undefined) {
      spans.push({ start, end, kind: "number" })
    } else if (match[4] !== undefined && KEYWORDS.has(match[4])) {
      spans.push({ start, end, kind: "keyword" })
    }
  }
  return spans
}

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

/** 汇总折行布局的总可视行数（滚动上限计算依据）；从 FileViewer 原样提取，仅为可测性导出 */
export function totalVisualRows(rows: { chunks: string[] }[]): number {
  return rows.reduce((sum, row) => sum + row.chunks.length, 0)
}

/** 读取图像尺寸（PNG 从文件头解析；其他格式返回 null） */
export function readImageSize(path: string): { width: number; height: number } | null {
  try {
    const fd = openSync(path, "r")
    const buf = Buffer.alloc(24)
    const n = readSync(fd, buf, 0, 24, 0)
    closeSync(fd)
    if (n >= 24 && buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    }
    return null
  } catch {
    return null
  }
}

/** 将一行文本按着色区间拆分为渲染片段（轻量着色薄封装，调用方不感知实现） */
export type HighlightedPart = { text: string; color?: string | RGBA }
export function renderHighlighted(line: string, fileExt: string, skin: Skin): HighlightedPart[] {
  const spans = highlightLine(line, fileExt)
  if (spans.length === 0) return [{ text: line }]
  const parts: HighlightedPart[] = []
  let cursor = 0
  for (const span of spans) {
    if (span.start > cursor) parts.push({ text: line.slice(cursor, span.start) })
    const color =
      span.kind === "comment"
        ? skin.muted
        : span.kind === "string"
          ? skin.success
          : span.kind === "number"
            ? skin.warning
            : skin.accent
    parts.push({ text: line.slice(span.start, span.end), color })
    cursor = span.end
  }
  if (cursor < line.length) parts.push({ text: line.slice(cursor) })
  return parts
}
