import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  buildFileTree,
  flattenFileTree,
  isHiddenFile,
  readDirEntries,
  sortEntries,
  type FileNode,
} from "../src/file-tree/tree-utils"

describe("file-tree", () => {
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

  test("读取目录并保留隐藏文件（已去目录条目上限）", () => {
    const root = mkdtempSync(join(process.cwd(), "file-tree-"))
    try {
      mkdirSync(join(root, ".hidden"))
      writeFileSync(join(root, "visible.txt"), "text")
      assert.deepEqual(readDirEntries(root).map((node) => node.name), [".hidden", "visible.txt"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("构建树并按展开状态扁平化", () => {
    const root = mkdtempSync(join(process.cwd(), "file-tree-"))
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
})
