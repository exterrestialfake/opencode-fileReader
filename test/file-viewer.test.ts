import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createFileAt, createFolderAt, formatFileSize, isImageFile, isTextFile, removeAt, renameAt, validateFileName } from "../src/file-utils/file"
import { highlightLine } from "../src/highlight-utils/highlight"
import { wrapLine } from "../src/layout-utils/layout"

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

  test("校验文件名覆盖 Q10 全表", () => {
    assert.equal(validateFileName("", []), "文件名不能为空")
    assert.equal(validateFileName("   ", []), "文件名不能为空")
    assert.equal(validateFileName(".", []), "文件名不能为 . 或 ..")
    assert.equal(validateFileName("..", []), "文件名不能为 . 或 ..")
    assert.equal(validateFileName("a/b", []), "文件名不能包含 / \\ : * ? \" < > |")
    assert.equal(validateFileName("a\\b", []), "文件名不能包含 / \\ : * ? \" < > |")
    assert.equal(validateFileName("a:b", []), "文件名不能包含 / \\ : * ? \" < > |")
    assert.equal(validateFileName("a ", []), "文件名末尾不能是空格或点")
    assert.equal(validateFileName("a.", []), "文件名末尾不能是空格或点")
    assert.equal(validateFileName("CON", []), "保留名称不可用")
    assert.equal(validateFileName("con.txt", []), "保留名称不可用")
    assert.equal(validateFileName("NUL", []), "保留名称不可用")
    assert.equal(validateFileName("a".repeat(256), []), "文件名过长")
    assert.equal(validateFileName("exists.txt", ["exists.txt"]), "同目录已存在同名文件")
    assert.equal(validateFileName("Exists.TXT", ["exists.txt"]), "同目录已存在同名文件")
    assert.equal(validateFileName("good-name_123.txt", ["other.txt"]), null)
  })

  test("文件操作纯函数在临时目录可用", () => {
    const root = mkdtempSync(join(process.cwd(), "file-ops-"))
    try {
      // 创建文件
      const f1 = createFileAt(root, "a.txt")
      assert.equal(f1.ok, true)
      // 重复创建应失败
      const f2 = createFileAt(root, "a.txt")
      assert.equal(f2.ok, false)
      // 创建文件夹
      const d1 = createFolderAt(root, "dir")
      assert.equal(d1.ok, true)
      // 重命名
      const r1 = renameAt(join(root, "a.txt"), "b.txt")
      assert.equal(r1.ok, true)
      // 删除
      const rm = removeAt(join(root, "b.txt"))
      assert.equal(rm.ok, true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
