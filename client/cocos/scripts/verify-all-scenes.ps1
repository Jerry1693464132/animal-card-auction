$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$rel  = Join-Path $root "build\windows\proj\Release"
$exe  = Join-Path $rel "windows.exe"

function Run-Game([string]$scene, [int]$secs = 18) {
  & node (Join-Path $root "scripts\set-launch-scene.mjs") $scene | Out-Null
  $p = Start-Process -FilePath $exe -WorkingDirectory $rel -PassThru
  $thePid = $p.Id
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $conn = $false; $exited = $false
  while ($sw.Elapsed.TotalSeconds -lt $secs) {
    if ($p.HasExited) { $exited = $true; break }
    if (-not $conn) {
      $c = Get-NetTCPConnection -RemotePort 8787 -ErrorAction SilentlyContinue |
           Where-Object { $_.OwningProcess -eq $thePid -and $_.State -eq "Established" }
      if ($c) { $conn = $true }
    }
    Start-Sleep -Milliseconds 250
  }
  $sw.Stop()
  try { $p.Kill() } catch {}
  if ($exited) { return "CRASH@$([Math]::Round($sw.Elapsed.TotalSeconds,1))s" }
  if ($conn) { return "OK" }
  Start-Sleep -Milliseconds 400
  return "alive-but-no-scene"
}

Write-Output "=== all 4 scenes ==="
foreach ($s in @("Main","DouDizhuLobby","Auction","Table")) {
  Write-Output ("  {0,-15}: {1}" -f $s, (Run-Game $s))
}

& node (Join-Path $root "scripts\set-launch-scene.mjs") Main | Out-Null
Write-Output "launch scene restored to Main"
