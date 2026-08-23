// src/config — 配置模块：集中管理可配置项（快捷键等），合并 config.json 默认值与 tui.json 传入配置
// 遵循 guidance/engineering_spec.md：函数加中文注释，错误信息中文
import config from "../../config.json" with { type: "json" }

/** 从唯一配置源读取默认快捷键 */
export const defaultKeymap: Readonly<Record<string, string>> = config.keybinds

/** 合并 tui.json 传入的 keybinds 覆盖 */
export function resolveKeybinds(overrides?: Record<string, string>): Record<string, string> {
  if (!overrides) return { ...defaultKeymap }
  return { ...defaultKeymap, ...overrides }
}
