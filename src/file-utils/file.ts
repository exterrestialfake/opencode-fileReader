// src/file-utils/file.ts — 文件相关工具（类型判定、外部打开、尺寸、文件操作）
// 遵循 guidance/engineering_spec.md：函数加中文注释、错误信息中文
import { spawn } from "node:child_process"
import { closeSync, mkdirSync, openSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, readFileSync } from "node:fs"
import { dirname, extname, join } from "node:path"

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

/** Windows 保留名（不区分大小写，去扩展名后判定） */
const RESERVED_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
])

/**
 * 校验文件名是否合法
 * @param name 用户输入的文件名（不含路径）
 * @param siblingNames 同级已存在的文件名列表，用于重名检测
 * @returns null 表示通过，否则返回中文错误信息
 */
export function validateFileName(name: string, siblingNames: string[]): string | null {
  if (name.length === 0 || name.trim().length === 0) return "文件名不能为空"
  if (name === "." || name === "..") return "文件名不能为 . 或 .."
  if (/[\/\\:*?"<>|]/.test(name)) return "文件名不能包含 / \\ : * ? \" < > |"
  if (name.endsWith(" ") || name.endsWith(".")) return "文件名末尾不能是空格或点"
  const base = name.split(".")[0]!.toUpperCase()
  if (RESERVED_NAMES.has(base)) return "保留名称不可用"
  if (name.length > 255) return "文件名过长"
  const lower = name.toLowerCase()
  for (const s of siblingNames) {
    if (s.toLowerCase() === lower) return "同目录已存在同名文件"
  }
  return null
}

/** 将 fs 错误码映射为中文提示 */
function mapFsError(e: unknown, fallback: string): string {
  const code = (e as NodeJS.ErrnoException)?.code
  if (code === "EEXIST") return "同目录已存在同名文件"
  if (code === "EACCES" || code === "EPERM") return "权限不足，无法完成操作"
  if (code === "EBUSY") return "文件被占用，无法完成操作"
  if (code === "ENOSPC") return "磁盘空间不足"
  if (code === "ENOENT") return "路径不存在"
  const msg = (e as Error)?.message
  return msg ? `${fallback}：${msg}` : fallback
}

/**
 * 在父目录下创建空文件
 */
export function createFileAt(parentDir: string, name: string): { ok: true, path: string } | { ok: false, error: string } {
  const target = join(parentDir, name)
  try {
    writeFileSync(target, "", { flag: "wx" })
    return { ok: true, path: target }
  } catch (e) {
    return { ok: false, error: mapFsError(e, "创建文件失败") }
  }
}

/**
 * 在父目录下创建文件夹
 */
export function createFolderAt(parentDir: string, name: string): { ok: true, path: string } | { ok: false, error: string } {
  const target = join(parentDir, name)
  try {
    mkdirSync(target)
    return { ok: true, path: target }
  } catch (e) {
    return { ok: false, error: mapFsError(e, "创建文件夹失败") }
  }
}

/**
 * 重命名文件或目录
 */
export function renameAt(oldPath: string, newName: string): { ok: true, path: string } | { ok: false, error: string } {
  const target = join(dirname(oldPath), newName)
  try {
    renameSync(oldPath, target)
    return { ok: true, path: target }
  } catch (e) {
    return { ok: false, error: mapFsError(e, "重命名失败") }
  }
}

/**
 * 删除文件或目录（目录递归删除）
 */
export function removeAt(targetPath: string): { ok: true } | { ok: false, error: string } {
  try {
    rmSync(targetPath, { recursive: true, force: true })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: mapFsError(e, "删除失败") }
  }
}

/**
 * 获取指定路径的同级文件名列表（用于重名校验）
 */
export function getSiblingNames(parentDir: string): string[] {
  try {
    return readdirSync(parentDir)
  } catch {
    return []
  }
}

/** 大文件阈值（超过则截断，避免终端卡死） */
export const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB
export const MAX_LINES = 3000

/** 截断读取结果 */
export type LimitedFileContent = {
  lines: string[]
  truncated: boolean
  originalSize: number
  totalLines?: number
}

/**
 * 按大小与行数截断读取文本文件（避免 200M 级别文件卡死终端）
 * - 若文件大小超过 maxSize，仅读取前 maxSize 字节并按行截断
 * - 若行数超过 maxLines，仅保留前 maxLines 行
 */
export function readFileLinesLimited(filePath: string, maxSize: number = MAX_FILE_SIZE, maxLines: number = MAX_LINES): LimitedFileContent {
  try {
    const stat = statSync(filePath)
    const originalSize = stat.size
    if (originalSize <= maxSize) {
      const raw = readFileSync(filePath, "utf8")
      const allLines = raw.split(/\r?\n/)
      if (allLines.length > maxLines) {
        return { lines: allLines.slice(0, maxLines), truncated: true, originalSize, totalLines: allLines.length }
      }
      return { lines: allLines, truncated: false, originalSize, totalLines: allLines.length }
    }
    const fd = openSync(filePath, "r")
    const buf = Buffer.alloc(maxSize)
    const n = readSync(fd, buf, 0, maxSize, 0)
    closeSync(fd)
    const raw = buf.subarray(0, n).toString("utf8")
    const lines = raw.split(/\r?\n/)
    if (n === maxSize && !raw.endsWith("\n")) lines.pop()
    const sliced = lines.length > maxLines ? lines.slice(0, maxLines) : lines
    return { lines: sliced, truncated: true, originalSize, totalLines: undefined }
  } catch {
    return { lines: ["（读取文件失败：无法访问该文件）"], truncated: false, originalSize: 0 }
  }
}

/** 大文件优化阈值（对标 VS Code：20MB 或 300K 行） */
export const LARGE_FILE_SIZE = 20 * 1024 * 1024
export const LARGE_FILE_LINES = 300_000

/**
 * 判断是否为大文件（触发 largeFileOptimizations）
 * 仅通过 stat 快速判断大小，避免读取内容
 */
export function isLargeFile(filePath: string): boolean {
  try {
    const stat = statSync(filePath)
    return stat.size > LARGE_FILE_SIZE
  } catch {
    return false
  }
}

/**
 * 按偏移分块读取文本（用于大文件视口按需加载）
 * @param offset 起始字节偏移
 * @param length 读取字节数
 */
export function readFileChunk(filePath: string, offset: number, length: number): string {
  try {
    const fd = openSync(filePath, "r")
    const buf = Buffer.alloc(length)
    const n = readSync(fd, buf, 0, length, offset)
    closeSync(fd)
    return buf.subarray(0, n).toString("utf8")
  } catch {
    return ""
  }
}

/**
 * 构建行起始偏移索引（64KB 块扫描，适配大文件）
 * @returns offsets[i] 为第 i 行的起始字节偏移，offsets.length = 总行数
 */
export function buildLineOffsets(filePath: string): number[] {
  const offsets: number[] = [0]
  try {
    const stat = statSync(filePath)
    const size = stat.size
    if (size === 0) return offsets
    const fd = openSync(filePath, "r")
    const chunkSize = 64 * 1024
    const buf = Buffer.alloc(chunkSize)
    let fileOffset = 0
    let leftover = 0
    while (fileOffset < size) {
      const toRead = Math.min(chunkSize, size - fileOffset)
      const n = readSync(fd, buf, 0, toRead, fileOffset)
      if (n <= 0) break
      for (let i = 0; i < n; i++) {
        if (buf[i] === 10) { // \n
          offsets.push(fileOffset + i + 1)
        }
      }
      fileOffset += n
    }
    closeSync(fd)
    // 若文件以 \n 结尾，最后一个偏移指向 EOF，不计为新行
    if (offsets.length > 1 && offsets[offsets.length - 1] === size) offsets.pop()
    return offsets
  } catch {
    return offsets
  }
}

/**
 * 按行范围读取（依赖 buildLineOffsets，按需拉取）
 * @param startLine 起始行（0 基）
 * @param count 行数
 */
export function readLinesRange(filePath: string, startLine: number, count: number, offsets?: number[]): { lines: string[]; totalLines: number } {
  try {
    const offs = offsets ?? buildLineOffsets(filePath)
    const totalLines = offs.length
    const endLine = Math.min(startLine + count, totalLines)
    if (startLine >= totalLines) return { lines: [], totalLines }
    const startOffset = offs[startLine]!
    const endOffset = endLine < totalLines ? offs[endLine]! : statSync(filePath).size
    const len = endOffset - startOffset
    const fd = openSync(filePath, "r")
    const buf = Buffer.alloc(len)
    const n = readSync(fd, buf, 0, len, startOffset)
    closeSync(fd)
    const raw = buf.subarray(0, n).toString("utf8")
    const lines = raw.split(/\r?\n/)
    // 若读取块以 \n 结尾，split 会多一个空串，去掉
    if (raw.endsWith("\n") && lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
    return { lines, totalLines }
  } catch {
    return { lines: [], totalLines: 0 }
  }
}
