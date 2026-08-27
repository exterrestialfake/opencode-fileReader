// src/file-utils/file.ts — 文件相关工具（类型判定、外部打开、尺寸）
// 遵循 guidance/engineering_spec.md：函数加中文注释、错误信息中文
import { spawn } from "node:child_process"
import { openSync, readSync, closeSync } from "node:fs"
import { extname } from "node:path"

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

/** 格式化文件大小（B/KB/MB/GB） */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

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

/** 若文件为非文本则用系统查看器打开并返回是否已打开（与 isTextFile 合并后的简洁 API） */
export function tryOpenExternalIfNotText(fileName: string, filePath: string): boolean {
  if (isTextFile(fileName, filePath)) return false
  openExternal(filePath)
  return true
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
