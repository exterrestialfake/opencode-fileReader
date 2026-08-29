// src/route-utils/route.ts — 路由往返纯函数（记录来源路由与返回来源界面）
// 从 fs-plugin.tsx 的 openFile/closeViewer 中原样提取，仅为可测性导出（行为不变）：
// fs-plugin.tsx 含 JSX 与 TUI 运行时导入，无法在 node:test 中加载，故将纯决策逻辑下沉到本模块。
// 遵循 guidance/engineering_spec.md：函数加中文注释、错误信息中文、camelCase

/** 宿主路由位置的最小结构（与 TuiRouteCurrent 结构兼容） */
export type RouteLocationLike = {
  name: string
  params?: unknown
}

/** 打开阅读页前记录的来源路由（关闭时据此返回） */
export type BaseRouteRef = {
  name: string
  sessionID?: string
}

/**
 * 记录打开阅读页前的来源路由：
 * 会话路由提取 sessionID（缺失则回落主页），其余路由按名保留。
 */
export function resolveBaseRoute(current: RouteLocationLike): BaseRouteRef {
  if (current.name === "session") {
    // 宿主类型保证 session 参数携带 sessionID；此处仅放宽为可选以容忍异常宿主状态
    const sid = (current.params as { sessionID?: string } | undefined)?.sessionID
    return sid ? { name: "session", sessionID: sid } : { name: "home" }
  }
  return { name: current.name }
}

/**
 * 返回来源界面：会话来源带 sessionID 时导航回该会话，否则回主页。
 * navigate 由调用方注入（通常为 api.route.navigate 的箭头包装，避免 this 绑定问题）。
 */
export function returnToBase(
  navigate: (name: string, params?: Record<string, unknown>) => void,
  base: BaseRouteRef,
): void {
  if (base.name === "session" && base.sessionID) {
    navigate("session", { sessionID: base.sessionID })
  } else {
    navigate("home")
  }
}
