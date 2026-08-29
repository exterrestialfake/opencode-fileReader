// src/theme-utils/theme.ts — 主题皮肤共享模块（供 FileTree/FileViewer 共用）
// 遵循 guidance/engineering_spec.md：函数加中文注释、错误信息中文
import { RGBA } from "@opentui/core"
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"

/** 主题色皮肤（从 api.theme.current 提取，跟随主题） */
export type Skin = {
  panel: RGBA | string
  border: RGBA | string
  text: RGBA | string
  muted: RGBA | string
  accent: RGBA | string
  selected: RGBA | string
  success: RGBA | string
  warning: RGBA | string
}

/** 从主题中提取颜色（兼容 RGBA 与字符串） */
function ink(map: Record<string, unknown>, name: string, fallback: string): RGBA | string {
  const value = map[name]
  if (typeof value === "string") return value
  if (value instanceof RGBA) return value
  return fallback
}

/** 创建主题皮肤（面板背景/文字跟随主题） */
export function createSkin(theme: TuiThemeCurrent): Skin {
  const map = theme as unknown as Record<string, unknown>
  return {
    panel: ink(map, "backgroundPanel", "#1d1d1d"),
    border: ink(map, "border", "#4a4a4a"),
    text: ink(map, "text", "#f0f0f0"),
    muted: ink(map, "textMuted", "#a5a5a5"),
    accent: ink(map, "primary", "#5f87ff"),
    selected: ink(map, "selectedListItemText", "#f0f0f0"),
    success: ink(map, "success", "#87d787"),
    warning: ink(map, "warning", "#d7af5f"),
  }
}
