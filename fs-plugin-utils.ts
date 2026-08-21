// fs-plugin-utils.ts — 文件树构建/排序/隐藏文件判定/轻量着色（纯函数，便于测试）
// 遵循 guidance/engineering_spec.md：函数加中文注释、错误信息用中文、camelCase 命名
import { readdirSync, statSync, openSync, readSync, closeSync } from "node:fs"
import { join, basename, extname } from "node:path"
import { RGBA } from "@opentui/core"
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"

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

/** 轻量着色区间（接口稳定，日后可替换为完整语法高亮实现） */
export type HighlightSpan = {
  start: number
  end: number
  kind: "keyword" | "comment" | "string" | "number"
}

/** 主题色皮肤（从 api.theme.current 提取，跟随主题） */
export type Skin = {
  panel: RGBA | string
  border: RGBA | string
  text: RGBA | string
  muted: RGBA | string
  accent: RGBA | string
  selected: RGBA | string
  success: RGBA | string
  warning: RGBA | string
}

/** 单目录最多读取条目数（防止超大目录卡顿） */
const MAX_DIR_ENTRIES = 300
/** 整棵树最多节点数（默认展开时防止卡顿） */
const MAX_TREE_NODES = 3000

/** 判断是否为隐藏文件（`.` 开头）——默认可见，不做过滤 */
export function isHiddenFile(name: string): boolean {
  return name.startsWith(".")
}

/** 目录优先排序，同类型按名称排序 */
export function sortEntries(a: FileNode, b: FileNode): number {
  if (a.type !== b.type) return a.type === "dir" ? -1 : 1
  return a.name.localeCompare(b.name)
}

/** 读取目录下一级条目（隐藏文件默认包含，不做过滤） */
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
  } catch (error) {
    return []
  }
}

/** 构建文件树（仅读取根目录下一级，子目录按需加载） */
export function buildFileTree(root: string): FileNode {
  return { name: basename(root) || root, path: root, type: "dir", children: readDirEntries(root) }
}

/** 递归加载所有子目录（默认展开用），带节点上限防止卡顿 */
export function expandAll(node: FileNode, limit = MAX_TREE_NODES): number {
  if (node.type !== "dir" || limit <= 0) return limit
  if (!node.children) node.children = readDirEntries(node.path)
  for (const child of node.children) {
    limit = expandAll(child, limit - 1)
    if (limit <= 0) break
  }
  return limit
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
 * 调用方（fs-viewer）不感知变化。
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

/** 从主题中提取颜色（兼容 RGBA 与字符串） */
function ink(map: Record<string, unknown>, name: string, fallback: string): RGBA | string {
  const value = map[name]
  if (typeof value === "string") return value
  if (value instanceof RGBA) return value
  return fallback
}

/** 创建主题皮肤（面板背景/文字跟随主题） */
export function createSkin(theme: TuiThemeCurrent): Skin {
  const map = theme as unknown as Record<string, unknown>
  return {
    panel: ink(map, "backgroundPanel", "#1d1d1d"),
    border: ink(map, "border", "#4a4a4a"),
    text: ink(map, "text", "#f0f0f0"),
    muted: ink(map, "textMuted", "#a5a5a5"),
    accent: ink(map, "primary", "#5f87ff"),
    selected: ink(map, "selectedListItemText", "#f0f0f0"),
    success: ink(map, "success", "#87d787"),
    warning: ink(map, "warning", "#d7af5f"),
  }
}