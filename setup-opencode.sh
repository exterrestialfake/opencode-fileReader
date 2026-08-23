#!/usr/bin/env sh

# 解析脚本所在目录，使调用结果不依赖消费者的当前工作目录。
script_dir=$(CDPATH= cd "$(dirname "$0")" && pwd -P)
if [ -z "$script_dir" ]; then
  printf '无法解析设置脚本所在目录：%s\n' "$0" >&2
  exit 1
fi

plugin_path="$script_dir/fs-plugin.tsx"
config_path="$script_dir/tui.test.json"
node_modules_path="$script_dir/node_modules"
runtime_packages='@opentui/core @opentui/keymap @opentui/solid solid-js'

if [ ! -f "$plugin_path" ]; then
  printf '找不到插件入口：%s\n' "$plugin_path" >&2
  exit 1
fi

if [ ! -s "$config_path" ]; then
  printf '配置文件不存在或为空：%s\n' "$config_path" >&2
  exit 1
fi

# 仅验证运行时依赖；安装必须由用户在插件目录中手动执行。
missing_packages=
for package_name in $runtime_packages; do
  if [ ! -d "$node_modules_path/$package_name" ]; then
    if [ -n "$missing_packages" ]; then
      missing_packages="$missing_packages、$package_name"
    else
      missing_packages=$package_name
    fi
  fi
done
if [ -n "$missing_packages" ]; then
  printf '缺少运行时依赖：%s。请在插件目录手动执行：npm ci --omit=dev --ignore-scripts\n' "$missing_packages" >&2
  exit 1
fi

if command -v node >/dev/null 2>&1; then
  runtime=node
elif command -v bun >/dev/null 2>&1; then
  runtime=bun
else
  printf '找不到 node 或 bun，无法校验 TUI 配置。\n' >&2
  exit 1
fi

# 保留 node/bun 双运行时校验，并确认配置确实注册了插件入口。
if ! "$runtime" -e '
  const { readFileSync } = require("node:fs")
  const config = JSON.parse(readFileSync(process.argv[1], "utf8"))
  const entries = Array.isArray(config.plugin) ? config.plugin : []
  const specs = entries.map((entry) => Array.isArray(entry) ? entry[0] : entry)
  if (!specs.some((spec) => typeof spec === "string" && spec.endsWith("fs-plugin.tsx"))) process.exit(1)
' "$config_path" >/dev/null 2>&1; then
  printf '配置文件无效或未注册 fs-plugin.tsx：%s\n' "$config_path" >&2
  exit 1
fi

resolved_config_path=$config_path
if command -v cygpath >/dev/null 2>&1; then
  if ! resolved_config_path=$(cygpath -w "$config_path"); then
    printf '无法转换配置文件路径：%s\n' "$config_path" >&2
    exit 1
  fi
fi

printf '%s\n' "$resolved_config_path"
