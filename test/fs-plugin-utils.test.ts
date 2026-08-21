import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  buildFileTree,
  flattenFileTree,
  formatFileSize,
  highlightLine,
  isHiddenFile,
  isImageFile,
  isTextFile,
  readDirEntries,
  sortEntries,
  type FileNode,
} from "../fs-plugin-utils.ts"

describe("fs-plugin-utils", () => {
  test("识别隐藏文件且默认不隐藏", () => {
    assert.equal(isHiddenFile(".env"), true)
    assert.equal(isHiddenFile("config.json"), false)
  })

  test("目录优先排序", () => {
    const directory: FileNode = { name: "dir", path: "dir", type: "dir" }
    const file: FileNode = { name: "file", path: "file", type: "file" }
    assert.ok(sortEntries(directory, file) < 0)
    assert.ok(sortEntries(file, directory) > 0)
  })

  test("读取目录并保留隐藏文件", () => {
    const root = mkdtempSync(join(process.cwd(), "fs-utils-"))
    try {
      mkdirSync(join(root, ".hidden"))
      writeFileSync(join(root, "visible.txt"), "text")
      assert.deepEqual(readDirEntries(root).map((node) => node.name), [".hidden", "visible.txt"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("构建树并按展开状态扁平化", () => {
    const root = mkdtempSync(join(process.cwd(), "fs-utils-"))
    try {
      mkdirSync(join(root, "child"))
      writeFileSync(join(root, "child", "nested.txt"), "text")
      const tree = buildFileTree(root)
      const child = tree.children?.[0]
      assert.equal(child?.type, "dir")
      assert.equal(flattenFileTree(tree, new Set([root])).length, 1)
      child!.children = readDirEntries(child!.path)
      assert.equal(flattenFileTree(tree, new Set([root, child!.path])).length, 2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

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
    const root = mkdtempSync(join(process.cwd(), "fs-utils-"))
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
})
