#!/usr/bin/env sh

set -u

project_dir=$(CDPATH= cd "$(dirname "$0")/.." && pwd -P) || exit 1
fixture_dir="$project_dir/test/.tmp-setup-$$ with spaces"
script_path="$fixture_dir/setup-opencode.sh"
config_path="$fixture_dir/tui.test.json"
plugin_path="$fixture_dir/fs-plugin.tsx"
plugin_copy="$fixture_dir/fs-plugin.tsx.before"
config_copy="$fixture_dir/tui.test.json.before"
stdout_file="$fixture_dir/stdout"
stderr_file="$fixture_dir/stderr"

# 删除本次测试创建的临时文件。
cleanup() {
  rm -rf "$fixture_dir"
}
trap cleanup 0 HUP INT TERM

# 输出失败原因并终止测试。
fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

# 按当前平台规则计算脚本应输出的配置路径。
expected_config_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$config_path"
  else
    printf '%s\n' "$config_path"
  fi
}

# 断言配置或入口校验失败时只向 stderr 输出预期错误。
expect_config_failure() {
  failure_name=$1
  expected_error=$2
  if sh "$script_path" >"$stdout_file" 2>"$stderr_file"; then
    fail "$failure_name 时脚本不应报告成功"
  fi
  [ ! -s "$stdout_file" ] || fail "$failure_name 时 stdout 必须保持为空"
  [ -s "$stderr_file" ] || fail "$failure_name 时应向 stderr 输出中文错误"
  grep -F "$expected_error" "$stderr_file" >/dev/null || fail "$failure_name 时没有输出预期的中文错误"
}

mkdir -p "$fixture_dir" || fail '无法创建临时目录'
cp "$project_dir/setup-opencode.sh" "$script_path" || fail '无法复制设置脚本'
cp "$project_dir/tui.test.json" "$config_path" || fail '无法复制测试配置'
cp "$config_path" "$config_copy" || fail '无法保存配置副本'
printf 'export default {}\n' >"$plugin_path"
cp "$plugin_path" "$plugin_copy" || fail '无法保存插件入口副本'

expected_config=$(expected_config_path) || fail '无法计算预期配置路径'
actual_config=$(sh "$script_path") || fail '从脚本所在目录执行时失败'
[ "$actual_config" = "$expected_config" ] || fail 'stdout 没有仅输出解析后的配置路径'
cmp -s "$config_path" "$config_copy" || fail '脚本不应修改 tui.test.json'
cmp -s "$plugin_path" "$plugin_copy" || fail '脚本不应修改 fs-plugin.tsx'

actual_from_other_cwd=$(
  cd "$project_dir/test" || exit 1
  sh "$script_path"
) || fail '从其他当前目录执行时失败'
[ "$actual_from_other_cwd" = "$expected_config" ] || fail '配置路径不应依赖当前目录'

consumer_value=$(
  unset OPENCODE_TUI_CONFIG
  export OPENCODE_TUI_CONFIG="$(sh "$script_path")" || exit 1
  printf '%s\n' "${OPENCODE_TUI_CONFIG-<unset>}"
) || fail '消费者 export 命令失败'
[ "$consumer_value" = "$expected_config" ] || fail '消费者 export 契约没有设置正确路径'

: >"$config_path"
expect_config_failure '配置为空' '配置文件不存在或为空'
[ ! -s "$config_path" ] || fail '空配置校验失败时脚本不应写入配置'

printf '{ invalid json\n' >"$config_path"
cp "$config_path" "$config_copy"
expect_config_failure '配置 JSON 无效' '配置文件无效或未注册 fs-plugin.tsx'
cmp -s "$config_path" "$config_copy" || fail '无效配置校验失败时脚本不应写入配置'

printf '{"plugin":["./other-plugin.ts"]}\n' >"$config_path"
cp "$config_path" "$config_copy"
expect_config_failure '配置未注册 fs-plugin.tsx' '配置文件无效或未注册 fs-plugin.tsx'
cmp -s "$config_path" "$config_copy" || fail '缺少插件配置时脚本不应写入配置'

cp "$project_dir/tui.test.json" "$config_path"
rm "$plugin_path"
expect_config_failure '插件入口不存在' '找不到插件入口'

printf 'PASS: setup-opencode.sh POSIX 路径输出契约\n'
