$ErrorActionPreference = "SilentlyContinue"
$repo = Split-Path -Parent $PSScriptRoot
$base = Join-Path $repo "client\cocos"
$exe = "$base\build\windows\proj\Release\windows.exe"
$settings = "$base\build\windows\proj\Release\Resources\src\settings.json"
$out = Join-Path $repo "temp\verify-run.txt"
$stdout = Join-Path $repo "temp\verify-run-stdout.txt"
$lines = New-Object System.Collections.Generic.List[string]
function L($s) { $lines.Add($s) }

function CrashCount {
  $ev = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; ProviderName = 'Application Error' } -MaxEvents 400 |
    Where-Object { $_.Message -like '*windows.exe*' }
  return @($ev).Count
}

function DumpCrashes($tag) {
  $ev = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; ProviderName = 'Application Error' } -MaxEvents 400 |
    Where-Object { $_.Message -like '*windows.exe*' } | Select-Object -First 3
  foreach ($e in $ev) {
    L("  [$tag] " + $e.TimeCreated.ToUniversalTime().ToString("MM-dd HH:mm:ss") + " UTC  " + (($e.Message -split "`r?`n")[0]))
  }
}

L("=== PATHS ===")
L("exe exists      : " + (Test-Path $exe))
L("settings exists : " + (Test-Path $settings))

$bak = $settings + ".verifybak"
if ((Test-Path $settings) -and -not (Test-Path $bak)) { Copy-Item $settings $bak }
$orig = ""
if (Test-Path $bak) { $orig = (Get-Content $bak -Raw | ConvertFrom-Json).launch.launchScene }

L("")
L("=== BASELINE ===")
$before = CrashCount
L("windows.exe crash events before: $before")
L("original launchScene: $orig")

# point launch at the previously crashing scene
$j = Get-Content $bak -Raw | ConvertFrom-Json
$j.launch.launchScene = "db://assets/scenes/DouDizhuLobby.scene"
[System.IO.File]::WriteAllText($settings, ($j | ConvertTo-Json -Depth 100 -Compress), (New-Object System.Text.UTF8Encoding($false)))
L("patched launchScene -> " + (Get-Content $settings -Raw | ConvertFrom-Json).launch.launchScene)

L("")
L("=== LAUNCH (launch scene = DouDizhuLobby) ===")
Get-Process windows -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item $stdout -ErrorAction SilentlyContinue
$p = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru -RedirectStandardOutput $stdout
L("started pid=" + $p.Id)

for ($i = 1; $i -le 7; $i++) {
  Start-Sleep -Seconds 5
  $alive = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
  $ws = (netstat -ano | Select-String ":8787" | Select-String "ESTABLISHED" | Select-String (" " + $p.Id + "$"))
  L(("  t+{0,2}s  alive={1}  wsEstablished={2}" -f ($i * 5), [bool]$alive, [bool]$ws))
  if (-not $alive) { break }
}

L("")
L("=== RESULT ===")
$aliveEnd = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
L("process alive at end : " + [bool]$aliveEnd)
if ($aliveEnd) {
  L("  mem  : " + [math]::Round($aliveEnd.WorkingSet64 / 1MB, 1) + " MB")
  L("  cpu  : " + [math]::Round($aliveEnd.CPU, 1) + " s")
}
$after = CrashCount
L("windows.exe crash events after: $after  (delta " + ($after - $before) + ")")
if ($after -gt $before) { L("  !! NEW CRASHES:"); DumpCrashes("new") } else { L("  no new crashes") }

L("")
L("=== netstat 8787 ===")
netstat -ano | Select-String ":8787" | ForEach-Object { L("  " + $_.Line.Trim()) }

L("")
L("=== exe stdout tail ===")
if (Test-Path $stdout) {
  Get-Content $stdout -Tail 30 | ForEach-Object { L("  " + $_) }
} else { L("  (no stdout)") }

# cleanup
if ($aliveEnd) { Stop-Process -Id $p.Id -Force }
if (Test-Path $bak) { Copy-Item $bak $settings -Force }
L("")
L("restored launchScene -> " + (Get-Content $settings -Raw | ConvertFrom-Json).launch.launchScene)

[System.IO.File]::WriteAllLines($out, $lines, (New-Object System.Text.UTF8Encoding($false)))
Write-Output "done"
