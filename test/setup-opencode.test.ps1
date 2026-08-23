Set-StrictMode -Version 2.0

$ErrorActionPreference = "Stop"
$projectDir = Split-Path -Parent $PSScriptRoot
$fixtureDir = Join-Path $PSScriptRoot ".tmp-setup-$PID with spaces"
$scriptPath = Join-Path $fixtureDir "setup-opencode.ps1"
$configPath = Join-Path $fixtureDir "tui.test.json"
$pluginPath = Join-Path $fixtureDir "fs-plugin.tsx"
$nodeModulesPath = Join-Path $fixtureDir "node_modules"
$npmBinDir = Join-Path $fixtureDir "fake-bin"
$npmPath = Join-Path $npmBinDir "npm.cmd"
$npmLogPath = Join-Path $fixtureDir "npm-call.log"
$runtimePackages = @("@opentui/core", "@opentui/keymap", "@opentui/solid", "solid-js")

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

# 在临时 node_modules 中创建全部必需的运行时包目录。
function New-RuntimePackageDirectories {
  foreach ($packageName in $runtimePackages) {
    New-Item -ItemType Directory -Path (Join-Path $nodeModulesPath $packageName) -Force | Out-Null
  }
}

# 返回 node_modules 的稳定快照，以检测设置脚本是否修改依赖目录。
function Get-NodeModulesSnapshot {
  if (-not (Test-Path -LiteralPath $nodeModulesPath)) {
    return "<absent>"
  }

  $entries = Get-ChildItem -LiteralPath $nodeModulesPath -Recurse -Force |
    Sort-Object FullName |
    ForEach-Object {
      $relativePath = $_.FullName.Substring($nodeModulesPath.Length).TrimStart([char[]]@('\', '/'))
      if ($_.PSIsContainer) {
        "directory:$relativePath"
      } else {
        "file:${relativePath}:$([Convert]::ToBase64String([System.IO.File]::ReadAllBytes($_.FullName)))"
      }
    }
  return ($entries -join "`n")
}

# 断言设置脚本失败、错误信息正确且不污染现有 TUI 配置变量。
function Assert-SetupFailure {
  param([string]$ExpectedMessage)

  Remove-Item -LiteralPath $npmLogPath -Force -ErrorAction SilentlyContinue
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
  Assert-True (-not (Test-Path -LiteralPath $npmLogPath)) "失败时设置脚本不应调用 npm"
}

# 断言缺少运行时包时只给出安装指引，不安装、不改写配置也不污染进程环境。
function Assert-DependencyFailure {
  param([string]$MissingPackage)

  Remove-Item -LiteralPath $npmLogPath -Force -ErrorAction SilentlyContinue
  $nodeModulesBefore = Get-NodeModulesSnapshot
  $configBefore = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($configPath))
  $pluginBefore = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($pluginPath))
  $before = $env:OPENCODE_TUI_CONFIG
  $failed = $false
  $actualMessage = ""
  try {
    & $scriptPath > $null
  } catch {
    $failed = $true
    $actualMessage = $_.Exception.Message
  }

  Assert-True (-not (Test-Path -LiteralPath $npmLogPath)) "缺少 $MissingPackage 时设置脚本不应调用 npm"
  Assert-True $failed "缺少 $MissingPackage 时设置脚本本应失败"
  Assert-True $actualMessage.Contains($MissingPackage) "缺少 $MissingPackage 时错误必须点名该包：$actualMessage"
  Assert-True $actualMessage.Contains("npm ci --omit=dev --ignore-scripts") "缺少 $MissingPackage 时错误必须给出准确安装命令：$actualMessage"
  Assert-Equal $nodeModulesBefore (Get-NodeModulesSnapshot) "缺少 $MissingPackage 时不应修改 node_modules"
  Assert-Equal $configBefore ([Convert]::ToBase64String([System.IO.File]::ReadAllBytes($configPath))) "缺少 $MissingPackage 时不应修改配置"
  Assert-Equal $pluginBefore ([Convert]::ToBase64String([System.IO.File]::ReadAllBytes($pluginPath))) "缺少 $MissingPackage 时不应修改插件入口"
  Assert-Equal $before $env:OPENCODE_TUI_CONFIG "缺少 $MissingPackage 时不应修改 OPENCODE_TUI_CONFIG"
}

$previousTuiConfig = [Environment]::GetEnvironmentVariable("OPENCODE_TUI_CONFIG", "Process")
$previousMainConfig = [Environment]::GetEnvironmentVariable("OPENCODE_CONFIG", "Process")
$previousPath = [Environment]::GetEnvironmentVariable("PATH", "Process")
$previousNpmCallLog = [Environment]::GetEnvironmentVariable("NPM_CALL_LOG", "Process")

try {
  New-Item -ItemType Directory -Path $fixtureDir | Out-Null
  New-Item -ItemType Directory -Path $npmBinDir | Out-Null
  Copy-Item -LiteralPath (Join-Path $projectDir "setup-opencode.ps1") -Destination $scriptPath
  Copy-Item -LiteralPath (Join-Path $projectDir "tui.test.json") -Destination $configPath
  Copy-Item -LiteralPath (Join-Path $projectDir "package.json") -Destination (Join-Path $fixtureDir "package.json")
  Copy-Item -LiteralPath (Join-Path $projectDir "package-lock.json") -Destination (Join-Path $fixtureDir "package-lock.json")
  [System.IO.File]::WriteAllText($pluginPath, "export default {}`r`n", [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText(
    $npmPath,
    "@echo off`r`n> `"%NPM_CALL_LOG%`" echo %*`r`nexit /b 0`r`n",
    [System.Text.ASCIIEncoding]::new()
  )

  $configBefore = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($configPath))
  $pluginBefore = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($pluginPath))
  $env:OPENCODE_CONFIG = "C:\custom-opencode.json"
  $env:PATH = "$npmBinDir;$previousPath"
  $env:NPM_CALL_LOG = $npmLogPath
  New-RuntimePackageDirectories

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
  foreach ($packageName in $runtimePackages) {
    Assert-True (Test-Path -LiteralPath (Join-Path $nodeModulesPath $packageName) -PathType Container) "成功夹具必须包含运行时包 $packageName"
  }
  Assert-True (-not (Test-Path -LiteralPath $npmLogPath)) "依赖完整时设置脚本不应调用 npm"

  [System.IO.File]::WriteAllText(
    $configPath,
    '{"plugin":[["./fs-plugin.tsx",{"keybinds":{}}]]}',
    [System.Text.UTF8Encoding]::new($false)
  )
  & $scriptPath > $null
  Assert-Equal ([System.IO.Path]::GetFullPath($configPath)) $env:OPENCODE_TUI_CONFIG "元组插件配置未生效"
  Assert-True (-not (Test-Path -LiteralPath $npmLogPath)) "元组配置成功时设置脚本不应调用 npm"

  $env:OPENCODE_TUI_CONFIG = "sentinel"
  [System.IO.File]::WriteAllText($configPath, "", [System.Text.UTF8Encoding]::new($false))
  Assert-SetupFailure "配置文件为空"

  [System.IO.File]::WriteAllText($configPath, "{ invalid json", [System.Text.UTF8Encoding]::new($false))
  Assert-SetupFailure "配置文件 JSON 无效"

  [System.IO.File]::WriteAllText($configPath, '{"plugin":["./other-plugin.ts"]}', [System.Text.UTF8Encoding]::new($false))
  Assert-SetupFailure "配置文件未注册 fs-plugin.tsx"

  Copy-Item -LiteralPath (Join-Path $projectDir "tui.test.json") -Destination $configPath -Force
  Remove-Item -LiteralPath $nodeModulesPath -Recurse -Force
  $env:OPENCODE_TUI_CONFIG = "sentinel"
  Assert-DependencyFailure "@opentui/core"

  foreach ($missingPackage in $runtimePackages) {
    New-RuntimePackageDirectories
    Remove-Item -LiteralPath (Join-Path $nodeModulesPath $missingPackage) -Recurse -Force
    $env:OPENCODE_TUI_CONFIG = "sentinel"
    Assert-DependencyFailure $missingPackage
  }

  New-RuntimePackageDirectories
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

  $env:PATH = $previousPath
  if ($null -eq $previousNpmCallLog) {
    Remove-Item Env:NPM_CALL_LOG -ErrorAction SilentlyContinue
  } else {
    $env:NPM_CALL_LOG = $previousNpmCallLog
  }
  Remove-Item -LiteralPath $fixtureDir -Recurse -Force -ErrorAction SilentlyContinue
}
