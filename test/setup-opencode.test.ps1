Set-StrictMode -Version 2.0

$ErrorActionPreference = "Stop"
$projectDir = Split-Path -Parent $PSScriptRoot
$fixtureDir = Join-Path $PSScriptRoot ".tmp-setup-$PID with spaces"
$scriptPath = Join-Path $fixtureDir "setup-opencode.ps1"
$configPath = Join-Path $fixtureDir "tui.test.json"
$pluginPath = Join-Path $fixtureDir "fs-plugin.tsx"

# 比较实际值与预期值，不相等时终止测试。
function Assert-Equal {
  param(
    $Expected,
    $Actual,
    [string]$Message
  )

  if ($Expected -ne $Actual) {
    throw "$Message；预期：$Expected；实际：$Actual"
  }
}

# 断言条件为真，不满足时终止测试。
function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )

  if (-not $Condition) {
    throw $Message
  }
}

# 断言设置脚本失败、错误信息正确且不污染现有 TUI 配置变量。
function Assert-SetupFailure {
  param([string]$ExpectedMessage)

  $before = $env:OPENCODE_TUI_CONFIG
  $failed = $false
  $actualMessage = ""
  try {
    & $scriptPath > $null
  } catch {
    $failed = $true
    $actualMessage = $_.Exception.Message
  }

  Assert-True $failed "设置脚本本应失败"
  Assert-True $actualMessage.Contains($ExpectedMessage) "错误信息不符合预期：$actualMessage"
  Assert-Equal $before $env:OPENCODE_TUI_CONFIG "失败时不应修改 OPENCODE_TUI_CONFIG"
}

$previousTuiConfig = [Environment]::GetEnvironmentVariable("OPENCODE_TUI_CONFIG", "Process")
$previousMainConfig = [Environment]::GetEnvironmentVariable("OPENCODE_CONFIG", "Process")

try {
  New-Item -ItemType Directory -Path $fixtureDir | Out-Null
  Copy-Item -LiteralPath (Join-Path $projectDir "setup-opencode.ps1") -Destination $scriptPath
  Copy-Item -LiteralPath (Join-Path $projectDir "tui.test.json") -Destination $configPath
  [System.IO.File]::WriteAllText($pluginPath, "export default {}`r`n", [System.Text.UTF8Encoding]::new($false))

  $configBefore = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($configPath))
  $pluginBefore = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($pluginPath))
  $env:OPENCODE_CONFIG = "C:\custom-opencode.json"

  Push-Location $env:TEMP
  try {
    $output = @(& $scriptPath)
  } finally {
    Pop-Location
  }

  Assert-Equal ([System.IO.Path]::GetFullPath($configPath)) $env:OPENCODE_TUI_CONFIG "环境变量路径错误"
  Assert-Equal "C:\custom-opencode.json" $env:OPENCODE_CONFIG "不应覆盖用户主配置"
  Assert-True ($output -contains "现在请手动执行：opencode") "脚本未提示用户手动启动 opencode"
  Assert-Equal $configBefore ([Convert]::ToBase64String([System.IO.File]::ReadAllBytes($configPath))) "脚本不应修改配置"
  Assert-Equal $pluginBefore ([Convert]::ToBase64String([System.IO.File]::ReadAllBytes($pluginPath))) "脚本不应修改插件入口"

  [System.IO.File]::WriteAllText(
    $configPath,
    '{"plugin":[["./fs-plugin.tsx",{"keybinds":{}}]]}',
    [System.Text.UTF8Encoding]::new($false)
  )
  & $scriptPath > $null
  Assert-Equal ([System.IO.Path]::GetFullPath($configPath)) $env:OPENCODE_TUI_CONFIG "元组插件配置未生效"

  $env:OPENCODE_TUI_CONFIG = "sentinel"
  [System.IO.File]::WriteAllText($configPath, "", [System.Text.UTF8Encoding]::new($false))
  Assert-SetupFailure "配置文件为空"

  [System.IO.File]::WriteAllText($configPath, "{ invalid json", [System.Text.UTF8Encoding]::new($false))
  Assert-SetupFailure "配置文件 JSON 无效"

  [System.IO.File]::WriteAllText($configPath, '{"plugin":["./other-plugin.ts"]}', [System.Text.UTF8Encoding]::new($false))
  Assert-SetupFailure "配置文件未注册 fs-plugin.tsx"

  Copy-Item -LiteralPath (Join-Path $projectDir "tui.test.json") -Destination $configPath -Force
  Remove-Item -LiteralPath $pluginPath
  Assert-SetupFailure "找不到插件入口"

  Write-Output "PASS: setup-opencode.ps1 Windows 配置链路"
} finally {
  if ($null -eq $previousTuiConfig) {
    Remove-Item Env:OPENCODE_TUI_CONFIG -ErrorAction SilentlyContinue
  } else {
    $env:OPENCODE_TUI_CONFIG = $previousTuiConfig
  }

  if ($null -eq $previousMainConfig) {
    Remove-Item Env:OPENCODE_CONFIG -ErrorAction SilentlyContinue
  } else {
    $env:OPENCODE_CONFIG = $previousMainConfig
  }

  Remove-Item -LiteralPath $fixtureDir -Recurse -Force -ErrorAction SilentlyContinue
}
