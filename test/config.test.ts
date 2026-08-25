import assert from "node:assert/strict"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, test } from "node:test"
import { pathToFileURL } from "node:url"
import { defaultKeymap, resolveKeybinds } from "../src/config/index"

describe("config", () => {
  test("默认快捷键包含全部键（含 viewer 与树光标）", () => {
    assert.equal(defaultKeymap["fs.toggle"], "ctrl+b")
    assert.equal(defaultKeymap["fs.open"], "ctrl+o")
    assert.equal(defaultKeymap["fs.cursorUp"], "ctrl+up")
    assert.equal(defaultKeymap["fs.cursorDown"], "ctrl+down")
    assert.equal(defaultKeymap["fs.cursorLeft"], "ctrl+left")
    assert.equal(defaultKeymap["fs.cursorRight"], "ctrl+right")
    assert.equal(defaultKeymap["fs.viewer.close"], "esc,q,ctrl+o")
    assert.equal(defaultKeymap["fs.viewer.up"], "up")
    assert.equal(defaultKeymap["fs.viewer.down"], "down")
    // fs.cursorOpen 已合并至 fs.open（enter 仅 viewer 模式，见 fs-plugin），不再单独配置
    assert.equal(defaultKeymap["fs.cursorOpen"], undefined)
  })

  test("resolveKeybinds 合并 tui.json 覆盖", () => {
    const merged = resolveKeybinds({ "fs.toggle": "ctrl+alt+b" })
    assert.equal(merged["fs.toggle"], "ctrl+alt+b")
    // 未覆盖的保持默认
    assert.equal(merged["fs.open"], defaultKeymap["fs.open"])
  })

  test("config.json 与模块默认值保持一致", async () => {
    const raw = readFileSync("config.json", "utf8")
    const parsed = JSON.parse(raw) as { keybinds: Record<string, string> }
    for (const key of Object.keys(defaultKeymap)) {
      assert.equal(parsed.keybinds[key], defaultKeymap[key], `config.json 键 ${key} 应与模块一致`)
    }
  })

  test("修改 config.json 即更新模块默认快捷键", async () => {
    // Given：复制配置模块，并只修改临时目录中的 config.json
    const tempRoot = mkdtempSync(join(tmpdir(), "fs-plugin-config-"))
    const tempModuleDir = join(tempRoot, "src", "config")
    const tempModulePath = join(tempModuleDir, "index.ts")
    const changedToggleKey = "ctrl+alt+t"
    mkdirSync(tempModuleDir, { recursive: true })
    copyFileSync(new URL("../src/config/index.ts", import.meta.url), tempModulePath)
    const parsed = JSON.parse(
      readFileSync(new URL("../config.json", import.meta.url), "utf8"),
    ) as { keybinds: Record<string, string> }
    parsed.keybinds["fs.toggle"] = changedToggleKey
    writeFileSync(join(tempRoot, "config.json"), `${JSON.stringify(parsed, null, 2)}\n`, "utf8")

    try {
      // When：从临时目录重新加载配置模块
      const loaded = (await import(pathToFileURL(tempModulePath).href)) as {
        defaultKeymap: Record<string, string>
      }

      // Then：模块默认值直接跟随 config.json，而非另一份硬编码对象
      assert.equal(loaded.defaultKeymap["fs.toggle"], changedToggleKey)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })
})
