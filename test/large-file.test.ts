import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { mkdtempSync, rmSync, writeFileSync, statSync } from "node:fs"
import { join } from "node:path"
import * as fileUtils from "../src/file-utils/file"

describe("large-file", () => {
  test("大文件应在截断后快速返回且不卡死", () => {
    const root = mkdtempSync(join(process.cwd(), "large-file-"))
    try {
      const largePath = join(root, "large.txt")
      // 构造 5MB 文件（5000 行，每行 ~1KB），模拟 200M 的缩小版
      const line = "a".repeat(1024) + "\n"
      const content = line.repeat(5000) // ~5MB
      writeFileSync(largePath, content)
      const size = statSync(largePath).size
      assert.ok(size > 4 * 1024 * 1024, "文件应大于 4MB")

      const start = performance.now()
      // 当前 FileViewer 逻辑：直接 readFileSync + split + wrap + highlight
      // 期望修复后：应在 200ms 内返回截断结果，而非完整渲染 5000 行
      // 这里直接测试辅助函数（修复后存在），修复前该函数不存在或不截断则测试失败
      const fn = (fileUtils as unknown as { readFileLinesLimited?: (p: string) => { lines: string[]; truncated: boolean } }).readFileLinesLimited
      if (!fn) {
        assert.fail("readFileLinesLimited 未实现，修复前应为红灯")
      }
      const res = fn!(largePath)
      const truncated = res.truncated
      const lines = res.lines
      const elapsed = performance.now() - start
      assert.equal(truncated, true, "大文件应被标记为截断")
      assert.ok(lines.length <= 5000, "截断后行数应在限制内")
      assert.ok(elapsed < 500, `截断后应在 500ms 内完成，实际 ${elapsed.toFixed(1)}ms`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("普通小文件不应被截断", () => {
    const root = mkdtempSync(join(process.cwd(), "small-file-"))
    try {
      const smallPath = join(root, "small.txt")
      writeFileSync(smallPath, "hello\nworld")
      // 修复后小文件应完整返回且 truncated=false
      const fn = (fileUtils as unknown as { readFileLinesLimited?: (p: string) => { lines: string[]; truncated: boolean } }).readFileLinesLimited
      if (!fn) return // 修复前跳过
      const res = fn!(smallPath)
      assert.equal(res.truncated, false)
      assert.equal(res.lines.length, 2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
