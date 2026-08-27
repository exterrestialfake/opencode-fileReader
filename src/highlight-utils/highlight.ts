// src/highlight-utils/highlight.ts — 文字渲染/着色工具
// 遵循 guidance/engineering_spec.md：函数加中文注释、错误信息中文
import { RGBA } from "@opentui/core"
import type { Skin } from "../theme-utils/theme"

/** 轻量着色区间（接口稳定，日后可替换为完整语法高亮实现） */
export type HighlightSpan = {
  start: number
  end: number
  kind: "keyword" | "comment" | "string" | "number"
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
