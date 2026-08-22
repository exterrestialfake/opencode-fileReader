import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

/**
 * 为 `node --experimental-strip-types` 补齐无后缀导入的解析：
 * `import "./foo"` 尝试解析为 `foo.ts` / `foo.tsx` / `foo/index.ts` 等。
 * 仅处理相对路径且原本无后缀的说明符，避免影响包导入。
 */
export async function resolve(specifier, context, nextResolve) {
  // 仅处理相对导入且原本无后缀
  if (specifier.startsWith(".") && !/\.[a-zA-Z0-9]+$/.test(specifier)) {
    const parentURL = context.parentURL
    if (parentURL) {
      const candidates = [
        specifier + ".ts",
        specifier + ".tsx",
        specifier + ".json",
        specifier + "/index.ts",
        specifier + "/index.tsx",
      ]
      for (const cand of candidates) {
        try {
          const candidateURL = new URL(cand, parentURL).href
          const filePath = fileURLToPath(candidateURL)
          if (existsSync(filePath)) {
            return nextResolve(candidateURL, context)
          }
        } catch {
          // 忽略 URL 解析失败，继续尝试下一个候选
        }
      }
    }
  }
  return nextResolve(specifier, context)
}
