import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { defaultKeymap, resolveKeybinds } from "../src/config/index"

describe("config", () => {
  test("默认快捷键包含全部键（含 viewer）", () => {
    assert.equal(defaultKeymap["fs.toggle"], "ctrl+b")
    assert.equal(defaultKeymap["fs.open"], "ctrl+o")
    assert.equal(defaultKeymap["fs.viewer.close"], "esc,q,ctrl+o")
    assert.equal(defaultKeymap["fs.viewer.up"], "up,k")
    assert.equal(defaultKeymap["fs.viewer.down"], "down,j")
  })

  test("resolveKeybinds 合并 tui.json 覆盖", () => {
    const merged = resolveKeybinds({ "fs.toggle": "ctrl+alt+b" })
    assert.equal(merged["fs.toggle"], "ctrl+alt+b")
    // 未覆盖的保持默认
    assert.equal(merged["fs.open"], defaultKeymap["fs.open"])
  })

  test("config.json 与模块默认值保持一致", async () => {
    const { readFileSync } = await import("node:fs")
    const raw = readFileSync("config.json", "utf8")
    const parsed = JSON.parse(raw) as { keybinds: Record<string, string> }
    for (const key of Object.keys(defaultKeymap)) {
      assert.equal(parsed.keybinds[key], defaultKeymap[key], `config.json 键 ${key} 应与模块一致`)
    }
  })
})
