import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { applyRefresh, type AutoRefreshDeps } from "../src/file-tree/auto-refresh"
import { moveCursorIndex, visibleParentDir } from "../src/file-tree/cursor-utils"
import {
  buildFileTree,
  findNodeByPath,
  flattenFileTree,
  readDirEntries,
  refreshTree,
  type FileNode,
} from "../src/file-tree/tree-utils"

describe("file-tree", () => {
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

  test("按路径查找节点（命中与未命中）", () => {
    // Given: 根目录含 child/nested.txt 的已加载树
    const root = mkdtempSync(join(process.cwd(), "file-tree-"))
    try {
      mkdirSync(join(root, "child"))
      writeFileSync(join(root, "child", "nested.txt"), "text")
      const tree = buildFileTree(root)
      tree.children![0]!.children = readDirEntries(tree.children![0]!.path)
      // When: 按已存在路径与不存在路径分别查找
      // Then: 命中返回节点，未命中返回 null
      assert.equal(findNodeByPath(tree, join(root, "child", "nested.txt"))?.name, "nested.txt")
      assert.equal(findNodeByPath(tree, join(root, "missing.txt")), null)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("刷新树反映新增文件且保留已展开路径", () => {
    // Given: 已展开根目录与子目录 child，随后外部在 child 中新增文件
    const root = mkdtempSync(join(process.cwd(), "file-tree-"))
    try {
      mkdirSync(join(root, "child"))
      const tree = buildFileTree(root)
      const childPath = join(root, "child")
      tree.children![0]!.children = readDirEntries(childPath)
      writeFileSync(join(childPath, "new.txt"), "text")
      // When: 以原树与展开集合执行刷新
      const result = refreshTree(tree, new Set([root, childPath]))
      // Then: 新树包含新文件，展开集合完整保留
      const freshChild = findNodeByPath(result.tree!, childPath)
      assert.ok(freshChild!.children!.some((node) => node.name === "new.txt"))
      assert.deepEqual([...result.validExpanded].sort(), [root, childPath].sort())
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("刷新树清除已删除目录的展开路径并保持折叠目录懒加载", () => {
    // Given: 展开集合含已被外部删除的 gone；stay 存在但保持折叠（不在展开集合）
    const root = mkdtempSync(join(process.cwd(), "file-tree-"))
    try {
      mkdirSync(join(root, "gone"))
      mkdirSync(join(root, "stay"))
      const tree = buildFileTree(root)
      rmSync(join(root, "gone"), { recursive: true, force: true })
      // When: 执行刷新
      const result = refreshTree(tree, new Set([root, join(root, "gone")]))
      // Then: gone 从展开集合与新树中消失；stay 仍在树中且未读取 children（懒加载）
      assert.equal(result.validExpanded.has(join(root, "gone")), false)
      assert.ok(result.validExpanded.has(root))
      assert.ok(!result.tree!.children!.some((node) => node.name === "gone"))
      const stay = findNodeByPath(result.tree!, join(root, "stay"))
      assert.equal(stay!.children, undefined)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("根目录被删除时刷新返回空树", () => {
    // Given: 根目录已被外部删除
    const root = mkdtempSync(join(process.cwd(), "file-tree-"))
    const tree = buildFileTree(root)
    rmSync(root, { recursive: true, force: true })
    // When: 执行刷新
    const result = refreshTree(tree, new Set([root]))
    // Then: 新树为 null 且展开集合为空
    assert.equal(result.tree, null)
    assert.equal(result.validExpanded.size, 0)
  })

  test("刷新时选中文件被删除则清空选中，仍存在则保留原对象", () => {
    // Given: 注入普通变量的状态依赖，选中 a.txt 后外部删除它
    const root = mkdtempSync(join(process.cwd(), "file-tree-"))
    try {
      writeFileSync(join(root, "a.txt"), "text")
      writeFileSync(join(root, "b.txt"), "text")
      let tree: FileNode | null = buildFileTree(root)
      let expanded = new Set([root])
      let selected: FileNode | null = findNodeByPath(tree!, join(root, "a.txt"))
      const deps: AutoRefreshDeps = {
        rootDir: () => root,
        getTree: () => tree,
        setTree: (node) => (tree = node),
        getExpanded: () => expanded,
        setExpanded: (paths) => (expanded = paths),
        getSelected: () => selected,
        setSelected: (node) => (selected = node),
      }
      rmSync(join(root, "a.txt"), { force: true })
      // When: 执行刷新
      applyRefresh(deps)
      // Then: 被删除的选中被清空，树反映最新文件系统
      assert.equal(selected, null)
      assert.ok(tree!.children!.some((node) => node.name === "b.txt"))
      // Given(续): 改选仍存在的 b.txt
      selected = findNodeByPath(tree!, join(root, "b.txt"))
      const before = selected
      // When(续): 再次刷新（无外部变化）
      applyRefresh(deps)
      // Then: 选中保留原对象引用，阅读页状态不被重置
      assert.equal(selected, before)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("cursor-utils", () => {
  /** 构造测试可见行：root 下 a.txt、child/（目录）、b.txt */
  function makeRows(): { rows: ReturnType<typeof flattenFileTree>; root: string } {
    const rootPath = join("work", "proj")
    const dirNode: FileNode = { name: "child", path: join(rootPath, "child"), type: "dir" }
    const rows = [
      { node: { name: "a.txt", path: join(rootPath, "a.txt"), type: "file" } as FileNode, depth: 0 },
      { node: dirNode, depth: 0 },
      { node: { name: "nested.txt", path: join(rootPath, "child", "nested.txt"), type: "file" } as FileNode, depth: 1 },
      { node: { name: "b.txt", path: join(rootPath, "b.txt"), type: "file" } as FileNode, depth: 0 },
    ]
    return { rows, root: rootPath }
  }

  test("空树返回 -1，无选中或选中不可见时落到第一行", () => {
    const { rows } = makeRows()
    assert.equal(moveCursorIndex([], null, 1), -1)
    assert.equal(moveCursorIndex(rows, null, 1), 0)
    // 选中项已被刷新收缩出可见行（路径不存在）时同样落回第一行
    assert.equal(moveCursorIndex(rows, join("work", "proj", "gone.txt"), -1), 0)
  })

  test("上下移动边界停留不回绕", () => {
    const { rows } = makeRows()
    const last = rows[rows.length - 1]!.node.path
    const first = rows[0]!.node.path
    assert.equal(moveCursorIndex(rows, last, 1), rows.length - 1)
    assert.equal(moveCursorIndex(rows, first, -1), 0)
    assert.equal(moveCursorIndex(rows, rows[1]!.node.path, 1), 2)
    assert.equal(moveCursorIndex(rows, rows[1]!.node.path, -1), 0)
  })

  test("父目录定位仅命中可见行中已渲染的父目录", () => {
    const { rows, root } = makeRows()
    // 嵌套文件的父目录 child 已渲染：命中该目录节点
    const nested = rows[2]!.node
    assert.equal(visibleParentDir(nested, rows)?.path, join(root, "child"))
    // 根级文件的父目录为根（根不参与渲染）：返回 null（到顶为止）
    assert.equal(visibleParentDir(rows[0]!.node, rows), null)
  })
})
