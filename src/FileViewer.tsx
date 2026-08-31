/** @jsxImportSource @opentui/solid */
// src/FileViewer.tsx — 文件查看器组件（全屏路由分栏中的代码区）
// 遵循 guidance/engineering_spec.md：组件 PascalCase、函数 camelCase、中文注释
import { createMemo, For, Show } from "solid-js"
import { useBindings } from "@opentui/keymap/solid"
import { createBindingLookup } from "@opentui/keymap/extras"
import { useTerminalDimensions, type JSX } from "@opentui/solid"
import type { ScrollBoxRenderable } from "@opentui/core"
import { extname } from "node:path"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import {
  isTextFile,
  isImageFile,
  formatFileSize,
  readImageSize,
  openExternal,
  readFileLinesLimited,
} from "./file-utils/file"
import { renderHighlighted } from "./highlight-utils/highlight"
import { wrapLine, viewerWrapWidth } from "./layout-utils/layout"
import { createSkin, type Skin } from "./theme-utils/theme"
import type { FileNode } from "./file-tree-utils/tree"

/** 文件查看器组件（去文件长度限制，完整渲染） */
export function FileViewer(props: {
  api: TuiPluginApi
  file: FileNode
  resolvedKeymap: Record<string, string>
  onClose: () => void
}) {
  // 查看面板快捷键（由入口传入的 resolvedKeymap 提供，已合并 config.json + tui.json 覆盖，避免与 resolveKeybinds 冲撞）
  const viewerKeymap: Record<string, string> = {
    "fs.viewer.close": props.resolvedKeymap["fs.viewer.close"]!,
    "fs.viewer.up": props.resolvedKeymap["fs.viewer.up"]!,
    "fs.viewer.down": props.resolvedKeymap["fs.viewer.down"]!,
    "fs.viewer.pageup": props.resolvedKeymap["fs.viewer.pageup"]!,
    "fs.viewer.pagedown": props.resolvedKeymap["fs.viewer.pagedown"]!,
    "fs.viewer.open": props.resolvedKeymap["fs.viewer.open"]!,
  }
  const skin = createMemo<Skin>(() => createSkin(props.api.theme.current))
  const dim = useTerminalDimensions()
  let scroll: ScrollBoxRenderable | undefined

  // 文本内容（按大小与行数截断，避免大文件卡死）
  const content = createMemo<{ lines: string[]; truncated: boolean; originalSize: number; totalLines?: number } | null>(() => {
    if (!isTextFile(props.file.name, props.file.path)) return null
    return readFileLinesLimited(props.file.path)
  })

  const imageSize = createMemo(() =>
    isImageFile(props.file.name) ? readImageSize(props.file.path) : null,
  )

  // 自动折行：按视口宽度将逻辑行切为显示行（宽度推导收敛到 layout-utils.viewerWrapWidth）
  const wrappedLines = createMemo<
    { lineIndex: number; chunks: string[] }[] | null
  >(() => {
    const c = content()
    if (!c) return null
    void dim().width
    const viewportWidth = scroll?.viewport.width ?? 0
    const width = viewerWrapWidth(viewportWidth, dim().width)
    return c.lines.map((line, idx) => ({
      lineIndex: idx,
      chunks: wrapLine(line, width),
    }))
  })

  // 总可视行数（滚动上限依据，直接内联求和）
  const totalRows = createMemo(() => {
    const w = wrappedLines()
    if (!w) return 0
    return w.reduce((sum, row) => sum + row.chunks.length, 0)
  })

  const keys = createBindingLookup(viewerKeymap)
  const pageSize = () => Math.max(1, (scroll?.viewport.height ?? dim().height) - 2)
  const scrollBy = (delta: number) => {
    if (!scroll) return
    const max = Math.max(0, totalRows() - scroll.viewport.height)
    scroll.scrollTo(Math.max(0, Math.min(scroll.scrollTop + delta, max)))
  }
  useBindings(() => ({
    enabled: () => true,
    commands: [
      { name: "fs.viewer.close", run() { props.onClose() } },
      { name: "fs.viewer.up", run() { scrollBy(-1) } },
      { name: "fs.viewer.down", run() { scrollBy(1) } },
      { name: "fs.viewer.pageup", run() { scrollBy(-pageSize()) } },
      { name: "fs.viewer.pagedown", run() { scrollBy(pageSize()) } },
      { name: "fs.viewer.open", run() { openExternal(props.file.path) } },
    ],
    bindings: keys.gather("fs.viewer", [
      "fs.viewer.close",
      "fs.viewer.up",
      "fs.viewer.down",
      "fs.viewer.pageup",
      "fs.viewer.pagedown",
      "fs.viewer.open",
    ]),
  }))

  const fileExt = () => extname(props.file.name).slice(1)

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      gap={1}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text fg={skin().text}>
          <b>{props.file.name}</b>
        </text>
        <text fg={skin().muted}>{formatFileSize(props.file.size ?? content()?.originalSize ?? 0)}</text>
      </box>

      <Show when={content()?.truncated}>
        <box flexDirection="column" gap={1} paddingLeft={1} paddingRight={1}>
          <text fg={skin().warning}>文件过大（{formatFileSize(content()!.originalSize)}{content()!.totalLines ? `，${content()!.totalLines} 行` : ""}），已截断显示前 {content()!.lines.length} 行，按 Enter 用系统查看器打开完整文件</text>
        </box>
      </Show>

      <box flexGrow={1} paddingLeft={1} paddingRight={1}>
        <Show
          when={wrappedLines()}
          keyed
          fallback={<BinaryInfo file={props.file} skin={skin()} imageSize={imageSize()} />}
        >
          {(rows: { lineIndex: number; chunks: string[] }[]) => (
            <scrollbox
              ref={(element: ScrollBoxRenderable) => (scroll = element)}
              verticalScrollbarOptions={{ visible: false }}
              horizontalScrollbarOptions={{ visible: false }}
            >
              <For each={rows}>
                {(row) => (
                  <For each={row.chunks}>
                    {(chunk, chunkIndex) => (
                      <box flexDirection="row">
                        <text fg={skin().muted} wrapMode="none" flexShrink={0}>
                          {chunkIndex() === 0 ? `${String(row.lineIndex + 1).padStart(4)}  ` : "      "}
                        </text>
                        <text fg={skin().text} wrapMode="none">
                          <For each={renderHighlighted(chunk, fileExt(), skin())}>
                            {(part) => (part.color ? <span style={{ fg: part.color }}>{part.text}</span> : part.text)}
                          </For>
                        </text>
                      </box>
                    )}
                  </For>
                )}
              </For>
            </scrollbox>
          )}
        </Show>
      </box>

      <text fg={skin().muted}>ctrl+o/esc/q 关闭 · ctrl+↑/↓ 移动树光标 · pageup/pagedown 滚动 · return 用系统查看器打开</text>
    </box>
  )
}

function BinaryInfo(props: {
  file: FileNode
  skin: Skin
  imageSize: { width: number; height: number } | null
}) {
  const isImage = isImageFile(props.file.name)
  return (
    <box flexDirection="column" gap={1} paddingTop={1}>
      <text fg={props.skin.text}>文件名：{props.file.name}</text>
      <text fg={props.skin.muted}>大小：{formatFileSize(props.file.size ?? 0)}</text>
      <Show when={isImage}>
        <Show when={props.imageSize} keyed fallback={<text fg={props.skin.muted}>尺寸：未知</text>}>
          {(size: { width: number; height: number }) => (
            <text fg={props.skin.muted}>尺寸：{size.width} × {size.height} px</text>
          )}
        </Show>
      </Show>
      <text fg={props.skin.warning}>按 Enter 用系统默认查看器打开</text>
    </box>
  )
}
