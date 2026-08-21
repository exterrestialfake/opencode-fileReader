/** @jsxImportSource @opentui/solid */
// fs-viewer.tsx — 查看面板组件（dialog 内容）
// 文本：行号 + 轻量着色（highlightLine 薄封装）+ 滚动；PNG/图像：元信息 + Enter 外部打开；其他二进制：大小 + 外部打开
// 遵循 guidance/engineering_spec.md：组件 PascalCase、函数 camelCase、中文注释、错误信息中文
import { createMemo, For, Show } from "solid-js"
import { useBindings } from "@opentui/keymap/solid"
import { createBindingLookup } from "@opentui/keymap/extras"
import { useTerminalDimensions, type JSX } from "@opentui/solid"
import type { ScrollBoxRenderable } from "@opentui/core"
import { spawn } from "node:child_process"
import { readFileSync, openSync, readSync, closeSync } from "node:fs"
import { extname } from "node:path"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import {
  isTextFile,
  isImageFile,
  formatFileSize,
  highlightLine,
  createSkin,
  type FileNode,
  type Skin,
} from "./fs-plugin-utils"

/** 文本查看最大行数（超出截断并提示） */
const MAX_LINES = 2000

/** 查看面板内快捷键（仅 dialog 打开时生效） */
const viewerKeymap = {
  "fs.viewer.up": "up,k",
  "fs.viewer.down": "down,j",
  "fs.viewer.pageup": "pageup",
  "fs.viewer.pagedown": "pagedown",
  "fs.viewer.open": "enter,return",
}

/** 用系统默认查看器打开文件（win32，已验证模式） */
function openExternal(filePath: string) {
  spawn("explorer.exe", [filePath], { detached: true, stdio: "ignore", windowsHide: true }).unref()
}

/** 读取图像尺寸（PNG 从文件头解析；其他格式返回 null） */
function readImageSize(path: string): { width: number; height: number } | null {
  try {
    const fd = openSync(path, "r")
    const buf = Buffer.alloc(24)
    const n = readSync(fd, buf, 0, 24, 0)
    closeSync(fd)
    // PNG 魔数 89 50 4E 47 0D 0A 1A 0A；宽高位于字节 16-23（大端）
    if (n >= 24 && buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
    }
    return null
  } catch {
    return null
  }
}

/** 将一行文本按着色区间拆分为渲染片段（轻量着色薄封装，调用方不感知实现） */
function renderHighlighted(line: string, fileExt: string, skin: Skin): JSX.Element[] {
  const spans = highlightLine(line, fileExt)
  if (spans.length === 0) return [line]
  const parts: JSX.Element[] = []
  let cursor = 0
  for (const span of spans) {
    if (span.start > cursor) parts.push(line.slice(cursor, span.start))
    const color =
      span.kind === "comment"
        ? skin.muted
        : span.kind === "string"
          ? skin.success
          : span.kind === "number"
            ? skin.warning
            : skin.accent
    parts.push(
      <span style={{ fg: color }}>{line.slice(span.start, span.end)}</span>,
    )
    cursor = span.end
  }
  if (cursor < line.length) parts.push(line.slice(cursor))
  return parts
}

/** 查看面板组件（dialog 内容） */
export function FileViewer(props: { api: TuiPluginApi; file: FileNode }) {
  const skin = createMemo<Skin>(() => createSkin(props.api.theme.current))
  const dim = useTerminalDimensions()
  let scroll: ScrollBoxRenderable | undefined

  // 文本内容（截断 + 提示；非文本返回 null）
  const content = createMemo<{ lines: string[]; truncated: boolean } | null>(() => {
    if (!isTextFile(props.file.name, props.file.path)) return null
    try {
      const raw = readFileSync(props.file.path, "utf8")
      const lines = raw.split(/\r?\n/)
      const truncated = lines.length > MAX_LINES
      return { lines: truncated ? lines.slice(0, MAX_LINES) : lines, truncated }
    } catch {
      return { lines: ["（读取文件失败：无法访问该文件）"], truncated: false }
    }
  })

  // 图像尺寸（仅图像文件）
  const imageSize = createMemo(() =>
    isImageFile(props.file.name) ? readImageSize(props.file.path) : null,
  )

  // 面板内滚动/打开快捷键（仅 dialog 打开时生效）
  const keys = createBindingLookup(viewerKeymap)
  const pageSize = () => Math.max(1, (scroll?.viewport.height ?? dim().height) - 2)
  const scrollBy = (delta: number) => {
    if (!scroll) return
    const max = Math.max(0, (content()?.lines.length ?? 0) - scroll.viewport.height)
    scroll.scrollTo(Math.max(0, Math.min(scroll.scrollTop + delta, max)))
  }
  useBindings(() => ({
    enabled: () => props.api.ui.dialog.open,
    commands: [
      {
        name: "fs.viewer.up",
        run() {
          scrollBy(-1)
        },
      },
      {
        name: "fs.viewer.down",
        run() {
          scrollBy(1)
        },
      },
      {
        name: "fs.viewer.pageup",
        run() {
          scrollBy(-pageSize())
        },
      },
      {
        name: "fs.viewer.pagedown",
        run() {
          scrollBy(pageSize())
        },
      },
      {
        name: "fs.viewer.open",
        run() {
          openExternal(props.file.path)
        },
      },
    ],
    bindings: keys.gather("fs.viewer", [
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
      {/* 头部：文件名 + 大小 */}
      <box flexDirection="row" justifyContent="space-between">
        <text fg={skin().text}>
          <b>{props.file.name}</b>
        </text>
        <text fg={skin().muted}>{formatFileSize(props.file.size ?? 0)}</text>
      </box>

      {/* 内容区 */}
      <box border borderColor={skin().border} flexGrow={1} paddingLeft={1} paddingRight={1}>
        <Show
          when={content()}
          keyed
          fallback={<BinaryInfo file={props.file} skin={skin()} imageSize={imageSize()} />}
        >
          {(c: { lines: string[]; truncated: boolean }) => (
            <scrollbox
              ref={(element: ScrollBoxRenderable) => (scroll = element)}
              verticalScrollbarOptions={{ visible: false }}
              horizontalScrollbarOptions={{ visible: false }}
            >
              <For each={c.lines}>
                {(line, index) => (
                  <box flexDirection="row">
                    <text fg={skin().muted} wrapMode="none" flexShrink={0}>
                      {String(index() + 1).padStart(4)} │
                    </text>
                    <text fg={skin().text} wrapMode="none">
                      {renderHighlighted(line, fileExt(), skin())}
                    </text>
                  </box>
                )}
              </For>
              <Show when={c.truncated}>
                <text fg={skin().warning}>… 文件过大，仅显示前 {MAX_LINES} 行</text>
              </Show>
            </scrollbox>
          )}
        </Show>
      </box>

      {/* 底部提示 */}
      <text fg={skin().muted}>esc 关闭 · ↑/↓ 滚动 · Enter 用系统查看器打开</text>
    </box>
  )
}

/** 二进制/图像信息面板 */
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
        <Show
          when={props.imageSize}
          keyed
          fallback={<text fg={props.skin.muted}>尺寸：未知</text>}
        >
          {(size: { width: number; height: number }) => (
            <text fg={props.skin.muted}>
              尺寸：{size.width} × {size.height} px
            </text>
          )}
        </Show>
      </Show>
      <text fg={props.skin.warning}>按 Enter 用系统默认查看器打开</text>
    </box>
  )
}