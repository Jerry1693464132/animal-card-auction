$ErrorActionPreference = "SilentlyContinue"
$repo = Split-Path -Parent $PSScriptRoot
$out = Join-Path $repo "temp\diag-playtest.txt"
$lines = New-Object System.Collections.Generic.List[string]

$lines.Add("=== windows.exe running? ===")
$p = Get-Process windows -ErrorAction SilentlyContinue
if ($p) {
  foreach ($x in $p) { $lines.Add(("pid={0} start={1} cpu={2}s mem={3}MB" -f $x.Id, $x.StartTime, [math]::Round($x.CPU, 1), [math]::Round($x.WorkingSet64 / 1MB, 1))) }
} else {
  $lines.Add("(not running)")
}

$lines.Add("")
$lines.Add("=== windows.exe 相关事件（最近 20 条，含完整时间） ===")
$ev = Get-WinEvent -FilterHashtable @{ LogName = 'Application' } -MaxEvents 500 |
  Where-Object { $_.Message -like '*windows.exe*' } | Select-Object -First 20
if ($ev) {
  foreach ($e in $ev) {
    $first = ($e.Message -split "`r?`n")[0]
    $lines.Add(("[{0}] {1} | {2}" -f $e.TimeCreated.ToString("yyyy-MM-dd HH:mm:ss"), $e.ProviderName, $first))
  }
} else {
  $lines.Add("(none)")
}

$lines.Add("")
$lines.Add("=== 异常代码 / 故障偏移 ===")
$ev2 = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; ProviderName = 'Application Error' } -MaxEvents 20
foreach ($e in $ev2) {
  if ($e.Message -like '*windows.exe*') {
    foreach ($ln in ($e.Message -split "`r?`n")) {
      if ($ln -match '异常|模块|偏移|错误|Exception|Module|offset') { $lines.Add($ln.Trim()) }
    }
    $lines.Add("---")
  }
}

[System.IO.File]::WriteAllLines($out, $lines, (New-Object System.Text.UTF8Encoding($false)))
Write-Output "written: $out"
