Set-StrictMode -Version 2.0

$ErrorActionPreference = "Stop"

$pluginPath = Join-Path $PSScriptRoot "fs-plugin.tsx"
$configPath = Join-Path $PSScriptRoot "tui.test.json"

if (-not (Test-Path -LiteralPath $pluginPath -PathType Leaf)) {
  throw "找不到插件入口：$pluginPath"
}

if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
  throw "配置文件不存在：$configPath"
}

if ((Get-Item -LiteralPath $configPath).Length -eq 0) {
  throw "配置文件为空：$configPath"
}

try {
  $configText = [System.IO.File]::ReadAllText($configPath, [System.Text.Encoding]::UTF8)
  $config = $configText | ConvertFrom-Json -ErrorAction Stop
} catch {
  throw "配置文件 JSON 无效：$configPath"
}

# 同时支持字符串插件项和 [插件路径, 配置] 元组。
$pluginProperty = $config.PSObject.Properties |
  Where-Object { $_.Name -eq "plugin" } |
  Select-Object -First 1
$registered = $false

if ($null -ne $pluginProperty) {
  foreach ($entry in @($pluginProperty.Value)) {
    $spec = $null
    if ($entry -is [string]) {
      $spec = $entry
    } elseif ($entry -is [System.Array] -and $entry.Count -gt 0) {
      $spec = $entry[0]
    }

    if ($spec -is [string] -and $spec.EndsWith("fs-plugin.tsx", [System.StringComparison]::OrdinalIgnoreCase)) {
      $registered = $true
      break
    }
  }
}

if (-not $registered) {
  throw "配置文件未注册 fs-plugin.tsx：$configPath"
}

$resolvedConfigPath = [System.IO.Path]::GetFullPath($configPath)
$env:OPENCODE_TUI_CONFIG = $resolvedConfigPath

Write-Output "配置文件：$resolvedConfigPath"
Write-Output "插件入口：$pluginPath"
Write-Output "已设置 OPENCODE_TUI_CONFIG=$resolvedConfigPath"
Write-Output "现在请手动执行：opencode"
