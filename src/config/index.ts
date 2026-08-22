// src/config — 配置模块：集中管理可配置项（快捷键等），合并 config.json 默认值与 tui.json 传入配置
// 遵循 guidance/engineering_spec.md：函数加中文注释，错误信息中文

/** 默认快捷键（与 config.json 保持一致，全部快捷键集中于此） */
export const defaultKeymap: Record<string, string> = {
  "fs.toggle": "ctrl+b",
  "fs.open": "ctrl+o",
  "fs.viewer.close": "esc,q,ctrl+o",
  "fs.viewer.up": "up,k",
  "fs.viewer.down": "down,j",
  "fs.viewer.pageup": "pageup",
  "fs.viewer.pagedown": "pagedown",
  "fs.viewer.open": "enter,return",
}

/** 合并 tui.json 传入的 keybinds 覆盖 */
export function resolveKeybinds(overrides?: Record<string, string>): Record<string, string> {
  if (!overrides) return { ...defaultKeymap }
  return { ...defaultKeymap, ...overrides }
}
