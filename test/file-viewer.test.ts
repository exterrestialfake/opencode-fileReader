import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  formatFileSize,
  highlightLine,
  isImageFile,
  isTextFile,
  wrapLine,
} from "../src/file-viewer/viewer-utils"

describe("file-viewer", () => {
  test("格式化文件大小", () => {
    assert.equal(formatFileSize(512), "512 B")
    assert.equal(formatFileSize(2048), "2.0 KB")
    assert.equal(formatFileSize(1024 * 1024), "1.0 MB")
  })

  test("识别文本和图像文件", () => {
    assert.equal(isTextFile("main.ts"), true)
    assert.equal(isImageFile("icon.png"), true)
    assert.equal(isImageFile("main.ts"), false)
  })

  test("无扩展名文件按内容探测文本", () => {
    const root = mkdtempSync(join(process.cwd(), "file-viewer-"))
    try {
      const textPath = join(root, "text")
      const binaryPath = join(root, "binary")
      writeFileSync(textPath, "plain text")
      writeFileSync(binaryPath, Buffer.from([0, 1, 2]))
      assert.equal(isTextFile("text", textPath), true)
      assert.equal(isTextFile("binary", binaryPath), false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("轻量着色识别字符串、数字、关键字和注释", () => {
    const spans = highlightLine('const value = "42" // note', "ts")
    assert.equal(spans.some((span) => span.kind === "keyword"), true)
    assert.equal(spans.some((span) => span.kind === "string"), true)
    assert.equal(spans.some((span) => span.kind === "comment"), true)
  })

  test("自动折行将长行按宽度切分", () => {
    assert.deepEqual(wrapLine("abcdefghij", 4), ["abcd", "efgh", "ij"])
    assert.deepEqual(wrapLine("short", 10), ["short"])
    assert.deepEqual(wrapLine("", 10), [""])
  })

  test("自动折行处理制表符与边界宽度", () => {
    assert.equal(wrapLine("\thello", 4).join(""), "    hello")
    assert.deepEqual(wrapLine("hello", 0), ["hello"])
    assert.deepEqual(wrapLine("1234", 4), ["1234"])
  })
})
