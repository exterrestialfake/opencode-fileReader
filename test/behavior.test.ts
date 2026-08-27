import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { resolveBaseRoute, returnToBase } from "../src/plugin/route-utils"
import {
  buildFileTree,
  findNodeByPath,
  flattenFileTree,
  toggleExpanded,
  type FileNode,
  type FlatNode,
} from "../src/file-tree-utils/tree"
import { applyRefresh, REFRESH_DEBOUNCE_MS, REFRESH_POLL_MS, startAutoRefresh, type AutoRefreshDeps } from "../src/file-tree-utils/auto-refresh"
import { registerTreeNavLayer, type TreeNavDeps } from "../src/file-tree-utils/keyboard-nav"
import { defaultKeymap, resolveKeybinds } from "../src/config/index"
import { viewerWrapWidth, wrapLine } from "../src/layout-utils/layout"

/** 等待条件成立（轮询 50ms），超时抛出中文错误 */
async function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`等待条件超时（${timeoutMs}ms）`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/** 简单延时 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 最小 keymap 宿主：记录注册的层，按「模式过滤 + 优先级最高」语义分发按键 */
type MockLayer = {
  priority: number
  mode?: string
  commands: Map<string, () => void>
  /** 展开逗号分隔序列后的键到命令映射（与宿主解析 "up,k" 形态绑定的语义一致） */
  keyMap: Map<string, string>
  active: boolean
}

function createKeymapHost() {
  const layers: MockLayer[] = []
  const host = {
    layers,
    registerLayer(spec: {
      priority?: number
      mode?: string
      commands: { name: string; run: () => void }[]
      bindings: readonly { key: string; cmd: string }[]
    }) {
      const keyMap = new Map<string, string>()
      for (const binding of spec.bindings) {
        for (const key of binding.key.split(",")) keyMap.set(key, binding.cmd)
      }
      const layer: MockLayer = {
        priority: spec.priority ?? 0,
        mode: spec.mode,
        commands: new Map(spec.commands.map((c) => [c.name, c.run])),
        keyMap,
        active: true,
      }
      layers.push(layer)
      return () => {
        layer.active = false
      }
    },
    /** 分发按键：仅考虑当前模式可激活的层，取绑定该键的最高优先级层执行 */
    dispatch(key: string, currentMode?: string): boolean {
      let best: MockLayer | undefined
      for (const layer of layers) {
        if (!layer.active) continue
        if (layer.mode !== undefined && layer.mode !== currentMode) continue
        if (!layer.keyMap.has(key)) continue
        if (!best || layer.priority > best.priority) best = layer
      }
      if (!best) return false
      best.commands.get(best.keyMap.get(key)!)?.()
      return true
    },
  }
  return host
}

/** 构造与既有 cursor-utils 测试同构的可见行：root 下 a.txt、child/（展开含 nested.txt）、b.txt */
function makeRows(): { rows: FlatNode[]; rootPath: string; child: FileNode; nested: FileNode } {
  const rootPath = join("work", "proj")
  const child: FileNode = { name: "child", path: join(rootPath, "child"), type: "dir" }
  const nested: FileNode = { name: "nested.txt", path: join(rootPath, "child", "nested.txt"), type: "file" }
  const rows: FlatNode[] = [
    { node: { name: "a.txt", path: join(rootPath, "a.txt"), type: "file" }, depth: 0 },
    { node: child, depth: 0 },
    { node: nested, depth: 1 },
    { node: { name: "b.txt", path: join(rootPath, "b.txt"), type: "file" }, depth: 0 },
  ]
  return { rows, rootPath, child, nested }
}

describe("行为测试：路由往返", () => {
  test("来源路由记录：会话提取 sessionID，缺失回落主页，其余按名保留", () => {
    // Given: 三种打开阅读页时的宿主路由状态
    // When: 记录来源路由
    // Then: 会话带回 sessionID；会话缺 sessionID 与主页都回落 home；自定义路由按名保留
    assert.deepEqual(resolveBaseRoute({ name: "session", params: { sessionID: "s1" } }), { name: "session", sessionID: "s1" })
    assert.deepEqual(resolveBaseRoute({ name: "session" }), { name: "home" })
    assert.deepEqual(resolveBaseRoute({ name: "home" }), { name: "home" })
    assert.deepEqual(resolveBaseRoute({ name: "custom" }), { name: "custom" })
  })

  test("返回来源：会话导航回原会话，其余一律回主页", () => {
    // Given: 导航间谍（params 缺省时不记录，便于整体比较）
    const calls: [string, Record<string, unknown>?][] = []
    const navigate = (name: string, params?: Record<string, unknown>) => {
      if (params) calls.push([name, params])
      else calls.push([name])
    }
    // When: 分别从会话来源、主页来源、缺 sessionID 的会话来源返回
    returnToBase(navigate, { name: "session", sessionID: "s1" })
    returnToBase(navigate, { name: "home" })
    returnToBase(navigate, { name: "session" })
    // Then: 仅带 sessionID 的会话来源回到该会话，其余回主页
    assert.deepEqual(calls, [
      ["session", { sessionID: "s1" }],
      ["home"],
      ["home"],
    ])
  })

  test("完整往返：session(s1) 进入 fs-viewer 后原样返回同一会话", () => {
    // Given: 用户正处于 session s1，导航序列记录进入与关闭
    const calls: string[] = []
    const navigate = (name: string) => calls.push(name)
    const base = resolveBaseRoute({ name: "session", params: { sessionID: "s1" } })
    // When: 打开阅读页再关闭
    navigate("fs-viewer")
    returnToBase(navigate, base)
    // Then: 来源会话被精确保留（往返不丢失 sessionID）
    assert.deepEqual(calls, ["fs-viewer", "session"])
    assert.equal(base.sessionID, "s1")
  })
})

describe("行为测试：快捷键冲突与优先级", () => {
  test("树导航层以 priority 10 注册并绑定解析后的快捷键（tui.json 覆盖生效）", () => {
    // Given: 覆盖 fs.cursorUp 为 ctrl+up 的已解析快捷键与最小 keymap 宿主
    const host = createKeymapHost()
    const resolvedKeymap = resolveKeybinds({ "fs.cursorUp": "ctrl+up" })
    const { rows, child } = makeRows()
    // When: 注册树导航层
    const unregister = registerTreeNavLayer({
      api: { keymap: host } as unknown as TuiPluginApi, // 测试接缝：仅注入 keymap，其余 API 不被本模块触达
      resolvedKeymap,
      visibleRows: () => rows,
      getSelected: () => null,
      setSelected: () => {},
      isExpanded: (path) => path === child.path,
      toggleDir: () => {},
      openFile: () => {},
      isViewerRoute: () => true,
    })
    // Then: 层优先级为 10（高于阅读页默认 0）；覆盖整体替换绑定序列（默认 ctrl+up 不再保留为 up）
    const layer = host.layers[0]!
    assert.equal(layer.priority, 10)
    assert.equal(layer.keyMap.get("ctrl+up"), "fs.cursorUp")
    assert.equal(layer.keyMap.get("up"), undefined)
    assert.equal(layer.keyMap.get("ctrl+down"), "fs.cursorDown")
    assert.equal(typeof unregister, "function")
  })

  test("同键分层：树光标与代码区滚动键位已分离（ctrl+down vs down），注销后滚动恢复", () => {
    // Given: 先注册代码区滚动层（priority 0，模拟 FileViewer.useBindings），再挂载树导航层（priority 10）
    const host = createKeymapHost()
    let scrolled = 0
    host.registerLayer({
      commands: [{ name: "fs.viewer.down", run: () => (scrolled += 1) }],
      bindings: [{ key: "down", cmd: "fs.viewer.down" }],
    })
    const { rows, child } = makeRows()
    let selected: FileNode | null = rows[0]!.node
    const unregister = registerTreeNavLayer({
      api: { keymap: host } as unknown as TuiPluginApi,
      resolvedKeymap: resolveKeybinds(),
      visibleRows: () => rows,
      getSelected: () => selected,
      setSelected: (node) => (selected = node),
      isExpanded: (path) => path === child.path,
      toggleDir: () => {},
      openFile: () => {},
      isViewerRoute: () => true,
    })
    // When: 按 ctrl+down（树光标，19:41 后为 ctrl+up/down）
    // Then: 树光标执行（选中移到 child），滚动层不触发
    assert.equal(host.dispatch("ctrl+down"), true)
    assert.equal(selected?.path, child.path)
    assert.equal(scrolled, 0)
    // When(续): 按 down 触发滚动层
    host.dispatch("down")
    assert.equal(scrolled, 1)
    // When(续): 树导航层注销后再按 ctrl+down
    unregister()
    // Then: ctrl+down 已无树层响应
    assert.equal(host.dispatch("ctrl+down"), false)
    assert.equal(scrolled, 1)
  })

  test("输入框获焦时无 mode 的全局层仍触发，带 mode 的层被抑制", () => {
    // Given: 带模式限制的宿主层（模拟会在输入态失效的绑定）与插件全局层形态（不带 mode）
    const host = createKeymapHost()
    let chatFired = 0
    let toggled = 0
    host.registerLayer({
      mode: "chat",
      commands: [{ name: "host.chat", run: () => (chatFired += 1) }],
      bindings: [{ key: "ctrl+b", cmd: "host.chat" }],
    })
    host.registerLayer({
      commands: [{ name: "fs.toggle", run: () => (toggled += 1) }],
      bindings: [{ key: "ctrl+b", cmd: "fs.toggle" }],
    })
    // When: 输入框获焦（input 模式）与普通模式下分别按 ctrl+b
    // Then: 全局层在两种模式下都触发；带 mode 的层在非所属模式不触发
    host.dispatch("ctrl+b", "input")
    assert.equal(toggled, 1)
    assert.equal(chatFired, 0)
    host.dispatch("ctrl+b")
    assert.equal(toggled, 2)
  })

  test("树导航命令：目录仅选中、文件触发打开、折叠跳父级、空树安全", () => {
    // Given: 选中 a.txt 的树导航依赖（展开状态随 toggleDir 有状态更新）
    const host = createKeymapHost()
    const { rows, child, nested } = makeRows()
    let selected: FileNode | null = rows[0]!.node
    const opened: FileNode[] = []
    const toggledPaths: string[] = []
    const expandedPaths = new Set([child.path])
    const deps: TreeNavDeps = {
      api: { keymap: host } as unknown as TuiPluginApi,
      resolvedKeymap: resolveKeybinds(),
      visibleRows: () => rows,
      getSelected: () => selected,
      setSelected: (node) => (selected = node),
      isExpanded: (path) => expandedPaths.has(path),
      toggleDir: (node) => {
        toggledPaths.push(node.path)
        if (expandedPaths.has(node.path)) expandedPaths.delete(node.path)
        else expandedPaths.add(node.path)
      },
      openFile: (node) => opened.push(node),
      isViewerRoute: () => true,
    }
    registerTreeNavLayer(deps)
    // When: ctrl+down 从 a.txt 移到目录 child
    host.dispatch("ctrl+down")
    // Then: 目录只选中不打开
    assert.equal(selected?.path, child.path)
    assert.equal(opened.length, 0)
    // When(续): 再 ctrl+down 落到文件 nested.txt
    host.dispatch("ctrl+down")
    // Then: 文件触发打开（阅读页动态跟随）
    assert.deepEqual(opened.map((n) => n.name), ["nested.txt"])
    // When(续): ctrl+left 在文件上跳到可见父目录
    host.dispatch("ctrl+left")
    // Then: 选中父目录 child
    assert.equal(selected?.path, child.path)
    // When(续): ctrl+left 在展开目录上折叠
    host.dispatch("ctrl+left")
    // Then: 触发折叠而非移动
    assert.deepEqual(toggledPaths, [child.path])
    // When(续): ctrl+right 在折叠目录上展开
    host.dispatch("ctrl+right")
    // Then: 再次触发切换（展开）
    assert.deepEqual(toggledPaths, [child.path, child.path])
    // When(续): enter 在文本文件上（阅读页内）—— 已合并至 fs.open，本层不再直接处理
    assert.equal(host.dispatch("enter", "fs-plugin.viewer"), false)
    // Then: 键盘导航层不再触发打开，打开由 fs.open 的 viewer 模式层负责（此处不新增打开记录）
    assert.equal(opened.length, 1)
  })

  test("空树时导航命令安全无副作用", () => {
    // Given: 无可见行、无选中的树导航依赖
    const host = createKeymapHost()
    const opened: FileNode[] = []
    registerTreeNavLayer({
      api: { keymap: host } as unknown as TuiPluginApi,
      resolvedKeymap: resolveKeybinds(),
      visibleRows: () => [],
      getSelected: () => null,
      setSelected: () => {},
      isExpanded: () => false,
      toggleDir: () => {},
      openFile: (node) => opened.push(node),
      isViewerRoute: () => true,
    })
    // When: 依次按全部导航键（ctrl+up/down/left/right 全局；enter 已合并至 fs.open，不在本层）
    // Then: 移动/折叠键均安全返回且不触发打开；enter 在本层不处理
    for (const key of ["ctrl+up", "ctrl+down", "ctrl+left", "ctrl+right"]) {
      assert.equal(host.dispatch(key), true)
    }
    assert.equal(host.dispatch("enter", "fs-plugin.viewer"), false)
    assert.equal(host.dispatch("enter"), false)
    assert.equal(opened.length, 0)
  })

  test("默认键位约定：全局命令互不冲突，树与阅读页滚动已分离为不同键", () => {
    // Given: 默认键表与一次 tui.json 覆盖合并结果
    const merged = resolveKeybinds({ "fs.toggle": "ctrl+alt+b" })
    // When: 取三个全局命令的键
    const globals = ["fs.toggle", "fs.open", "fs.refresh"].map((k) => merged[k])
    // Then: 覆盖后仍两两不同
    assert.equal(new Set(globals).size, globals.length)
    // 树光标与阅读页滚动已分离为不同键（ctrl+up vs up），避免冲突
    assert.notEqual(defaultKeymap["fs.cursorUp"], defaultKeymap["fs.viewer.up"])
    assert.equal(defaultKeymap["fs.cursorUp"], "ctrl+up")
    assert.equal(defaultKeymap["fs.viewer.up"], "up")
    // ctrl+o 同时承担打开与关闭：由路由判断分流（fs.open 在阅读页内复用为关闭）
    assert.equal(defaultKeymap["fs.open"], "ctrl+o")
    assert.equal(defaultKeymap["fs.viewer.close"], "esc,q,ctrl+o")
  })
})

describe("行为测试：插件重载与 dispose 清理", () => {
  /** 构造接普通变量的自动刷新依赖（与 fs-plugin 注入信号读写同构），并统计 setTree 次数 */
  function makeDeps(rootDir: string) {
    let tree: FileNode | null = buildFileTree(rootDir)
    let expanded = new Set([rootDir])
    let selected: FileNode | null = null
    let setTreeCalls = 0
    const deps: AutoRefreshDeps = {
      rootDir: () => rootDir,
      getTree: () => tree,
      setTree: (node) => {
        setTreeCalls += 1
        tree = node
      },
      getExpanded: () => expanded,
      setExpanded: (paths) => (expanded = paths),
      getSelected: () => selected,
      setSelected: (node) => (selected = node),
    }
    return { deps, getTree: () => tree, getSetTreeCalls: () => setTreeCalls }
  }

  test("watcher 自动刷新新增文件，dispose 后停止刷新", async () => {
    // Given: 自动刷新运行中的临时目录
    const root = mkdtempSync(join(process.cwd(), "behavior-dispose-"))
    try {
      const { deps, getTree, getSetTreeCalls } = makeDeps(root)
      const dispose = startAutoRefresh(deps)
      try {
        // When: 外部新增文件
        writeFileSync(join(root, "new.txt"), "text")
        // Then: 数秒内自动出现在树中
        await waitFor(() => getTree()?.children?.some((n) => n.name === "new.txt") === true, 5000)
        // When(续): dispose 后再新增文件并等待超过防抖窗口
        const callsBefore = getSetTreeCalls()
        dispose()
        writeFileSync(join(root, "after.txt"), "text")
        await sleep(REFRESH_DEBOUNCE_MS + 900)
        // Then: 不再有刷新发生
        assert.equal(getSetTreeCalls(), callsBefore)
        assert.ok(!getTree()?.children?.some((n) => n.name === "after.txt"))
      } finally {
        dispose()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("重载模拟：旧实例清理后新实例独立刷新，旧实例保持沉寂", async () => {
    // Given: 旧实例先启动后立即清理（模拟插件卸载），新实例随即启动（模拟重载）
    const root = mkdtempSync(join(process.cwd(), "behavior-reload-"))
    try {
      const old = makeDeps(root)
      const oldDispose = startAutoRefresh(old.deps)
      oldDispose()
      const fresh = makeDeps(root)
      const freshDispose = startAutoRefresh(fresh.deps)
      try {
        // When: 外部新增文件
        writeFileSync(join(root, "reload.txt"), "text")
        // Then: 新实例刷新到新文件
        await waitFor(() => fresh.getTree()?.children?.some((n) => n.name === "reload.txt") === true, 5000)
        // When(续): 再新增一个文件并等待超过防抖窗口
        const oldCalls = old.getSetTreeCalls()
        writeFileSync(join(root, "another.txt"), "text")
        await sleep(REFRESH_DEBOUNCE_MS + 900)
        // Then: 旧实例不再收到任何刷新
        assert.equal(old.getSetTreeCalls(), oldCalls)
      } finally {
        freshDispose()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("dispose 释放轮询定时器与待处理的防抖定时器", async () => {
    // Given: 透传式定时器桩（记录句柄但不改变真实计时行为）
    const recorded = {
      intervals: [] as { ms: number | undefined }[],
      timeouts: [] as { ms: number | undefined }[],
      clearedIntervals: [] as unknown[],
      clearedTimeouts: [] as unknown[],
    }
    const originals = {
      si: globalThis.setInterval,
      ci: globalThis.clearInterval,
      st: globalThis.setTimeout,
      ct: globalThis.clearTimeout,
    }
    // 测试接缝：包装全局定时器以观测句柄创建/释放，真实计时透传
    globalThis.setInterval = ((handler: () => void, ms?: number) => {
      const handle = originals.si(handler, ms)
      recorded.intervals.push({ ms })
      return handle
    }) as unknown as typeof setInterval
    globalThis.clearInterval = ((handle: unknown) => {
      recorded.clearedIntervals.push(handle)
      return originals.ci(handle as Parameters<typeof clearInterval>[0])
    }) as unknown as typeof clearInterval
    globalThis.setTimeout = ((handler: () => void, ms?: number) => {
      const handle = originals.st(handler, ms)
      recorded.timeouts.push({ ms })
      return handle
    }) as unknown as typeof setTimeout
    globalThis.clearTimeout = ((handle: unknown) => {
      recorded.clearedTimeouts.push(handle)
      return originals.ct(handle as Parameters<typeof clearTimeout>[0])
    }) as unknown as typeof clearTimeout
    const root = mkdtempSync(join(process.cwd(), "behavior-handles-"))
    let dispose: () => void = () => {}
    try {
      const { deps } = makeDeps(root)
      dispose = startAutoRefresh(deps)
      // When: 触发一次文件系统事件使防抖定时器挂起，然后 dispose
      writeFileSync(join(root, "x.txt"), "x")
      await waitFor(() => recorded.timeouts.some((t) => t.ms === REFRESH_DEBOUNCE_MS), 5000)
      dispose()
      // Then: 轮询间隔按 REFRESH_POLL_MS 创建且被清除；防抖定时器句柄也被释放
      assert.ok(recorded.intervals.some((t) => t.ms === REFRESH_POLL_MS))
      assert.equal(recorded.clearedIntervals.length, 1)
      assert.ok(recorded.clearedTimeouts.length >= 1)
    } finally {
      dispose()
      Object.assign(globalThis, originals)
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("轮询保底：树被清空且根目录恢复时重建并默认展开根目录", () => {
    // Given: 树为 null（根目录曾被删除）但根目录现已恢复；透传桩捕获 REFRESH_POLL_MS 轮询回调
    const root = mkdtempSync(join(process.cwd(), "behavior-poll-"))
    const originals = { si: globalThis.setInterval, ci: globalThis.clearInterval }
    let pollHandler: (() => void) | undefined
    // 测试接缝：包装 setInterval 以捕获轮询回调（真实计时透传，测试内手动驱动避免等待 2s）
    globalThis.setInterval = ((handler: () => void, ms?: number) => {
      const handle = originals.si(handler, ms)
      if (ms === REFRESH_POLL_MS) pollHandler = handler
      return handle
    }) as unknown as typeof setInterval
    try {
      writeFileSync(join(root, "back.txt"), "text")
      // 可变存储对象：闭包内赋值后经属性读取，避免 let 初始化 null 的控制流收窄为 never
      const store = { tree: null as FileNode | null, expanded: new Set<string>() }
      const deps: AutoRefreshDeps = {
        rootDir: () => root,
        getTree: () => store.tree,
        setTree: (node) => (store.tree = node),
        getExpanded: () => store.expanded,
        setExpanded: (paths) => (store.expanded = paths),
        getSelected: () => null,
        setSelected: () => {},
      }
      const dispose = startAutoRefresh(deps)
      try {
        // When: 轮询到点（手动驱动捕获到的回调）
        assert.ok(pollHandler, "应已创建 REFRESH_POLL_MS 轮询回调")
        pollHandler!()
        // Then: 树整棵重建且根目录默认展开
        assert.equal(store.tree?.type, "dir")
        assert.deepEqual([...store.expanded], [root])
        assert.ok(store.tree?.children!.some((n) => n.name === "back.txt"))
      } finally {
        dispose()
      }
    } finally {
      Object.assign(globalThis, originals)
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("行为测试：双树一致性（侧边栏 + 阅读页右侧）", () => {
  test("共享单一状态源：两个树实例渲染始终一致，刷新保留选中对象身份", () => {
    // Given: 真实临时目录上的共享存储（tree/expanded/selected 单一来源，模拟 fs-plugin 信号）
    const root = mkdtempSync(join(process.cwd(), "behavior-dual-"))
    try {
      mkdirSync(join(root, "child"))
      writeFileSync(join(root, "child", "nested.txt"), "text")
      writeFileSync(join(root, "a.txt"), "text")
      let tree: FileNode | null = buildFileTree(root)
      let expanded = new Set([root])
      let selected: FileNode | null = null
      /** 渲染实例：侧边栏与阅读页右侧树都是同一状态的纯读取视图 */
      const renderView = () => {
        const rows = flattenFileTree(tree!, expanded)
        return {
          paths: rows.map((row) => row.node.path),
          selectedIndex: rows.findIndex((row) => row.node.path === selected?.path),
        }
      }
      // 初始（仅根目录展开）：两实例一致
      const sidebar = renderView()
      const viewerSide = renderView()
      assert.deepEqual(viewerSide.paths, sidebar.paths)
      assert.deepEqual(sidebar.paths, [join(root, "child"), join(root, "a.txt")])
      // When: 经共享 toggleExpanded 展开 child（懒加载子项）
      const child = findNodeByPath(tree!, join(root, "child"))!
      const nextExpanded = toggleExpanded(child, expanded)
      // Then: 原集合不被修改（信号更新以新集合触发）
      assert.equal(expanded.has(child.path), false)
      expanded = nextExpanded
      tree = { ...tree! }
      const expandedSidebar = renderView()
      const expandedViewerSide = renderView()
      assert.deepEqual(expandedViewerSide.paths, expandedSidebar.paths)
      assert.deepEqual(expandedSidebar.paths, [join(root, "child"), join(root, "child", "nested.txt"), join(root, "a.txt")])
      // When: 选中嵌套文件（阅读页跟随渲染）
      selected = findNodeByPath(tree!, join(root, "child", "nested.txt"))
      const selectedBefore = selected
      // Then: 两实例高亮下标一致
      assert.equal(renderView().selectedIndex, renderView().selectedIndex)
      assert.equal(renderView().selectedIndex, 1)
      // When: 折叠回 child
      expanded = toggleExpanded(child, expanded)
      tree = { ...tree! }
      // Then: 两实例同步收缩，选中项不可见（下标 -1）
      assert.deepEqual(renderView().paths, renderView().paths)
      assert.deepEqual(renderView().paths, [join(root, "child"), join(root, "a.txt")])
      assert.equal(renderView().selectedIndex, -1)
      // When: 保持 child 展开并外部新增文件，经 applyRefresh 刷新共享状态
      expanded = toggleExpanded(child, expanded)
      tree = { ...tree! }
      writeFileSync(join(root, "c.txt"), "text")
      const deps: AutoRefreshDeps = {
        rootDir: () => root,
        getTree: () => tree,
        setTree: (node) => (tree = node),
        getExpanded: () => expanded,
        setExpanded: (paths) => (expanded = paths),
        getSelected: () => selected,
        setSelected: (node) => (selected = node),
      }
      applyRefresh(deps)
      // Then: 两实例同时看到新文件；选中对象身份保留（阅读页状态不被重置）
      assert.ok(renderView().paths.includes(join(root, "c.txt")))
      assert.equal(selected, selectedBefore)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("行为测试：窄终端折行与可视行计算", () => {
  test("终端宽度 40/60/80 下折行宽度钳制为 32（估算下限 40 扣除行号与内边距）", () => {
    // Given: 三档窄终端宽度（视口未知，按终端估算）
    // When: 计算内容折行宽度
    // Then: max(40, w-50)=40 → 40-6-2=32
    assert.equal(viewerWrapWidth(0, 40), 32)
    assert.equal(viewerWrapWidth(0, 60), 32)
    assert.equal(viewerWrapWidth(0, 80), 32)
    // 对照：宽终端按实际差值计算
    assert.equal(viewerWrapWidth(0, 120), 62)
  })

  test("视口宽度优先于终端估算，最终下限 20 列", () => {
    // Given: 有效视口与极小视口
    // When: 计算折行宽度
    // Then: 视口 >0 时直接采用；过小时钳制到 20
    assert.equal(viewerWrapWidth(100, 40), 92)
    assert.equal(viewerWrapWidth(10, 40), 20)
  })

  test("宽度 32 下长行切分与制表符展开", () => {
    // Given: 100 字符长行与含制表符的行（制表符展开为 4 空格后共 65 显示宽）
    // When: 按宽度 32 折行
    // Then: 长行切分为 32/32/32/4；制表符行首块以 4 空格开头
    assert.deepEqual(wrapLine("x".repeat(100), 32), ["x".repeat(32), "x".repeat(32), "x".repeat(32), "x".repeat(4)])
    assert.deepEqual(wrapLine("\t" + "y".repeat(61), 32), ["    " + "y".repeat(28), "y".repeat(32), "y"])
  })

  test("totalVisualRows 汇总多逻辑行的可视行数（滚动上限依据，逻辑已内联）", () => {
    // Given: 混合长度的逻辑行布局（4+1+1+2 个显示行）
    const layout = [
      { lineIndex: 0, chunks: wrapLine("x".repeat(100), 32) },
      { lineIndex: 1, chunks: wrapLine("short", 32) },
      { lineIndex: 2, chunks: wrapLine("", 32) },
      { lineIndex: 3, chunks: wrapLine("y".repeat(64), 32) },
    ]
    // When: 按内联逻辑汇总总可视行数
    // Then: 总数为各块之和 8；滚动上限非负
    const totalRows = layout.reduce((sum, row) => sum + row.chunks.length, 0)
    assert.equal(totalRows, 8)
    assert.equal(Math.max(0, totalRows - 24), 0)
    assert.equal(Math.max(0, totalRows - 5), 3)
  })
})
