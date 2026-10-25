$ErrorActionPreference = "SilentlyContinue"
$repo = Split-Path -Parent $PSScriptRoot
$out = Join-Path $repo "temp\diag-build.txt"
$lines = New-Object System.Collections.Generic.List[string]
$root = Join-Path $repo "client\cocos"

function Stat($p, $label) {
  if (Test-Path $p) {
    $i = Get-Item $p
    $lines.Add(("{0,-46} {1,10:N0} B  {2}" -f $label, $i.Length, $i.LastWriteTime.ToString("MM-dd HH:mm:ss")))
  } else {
    $lines.Add(("{0,-46} MISSING" -f $label))
  }
}

$lines.Add("=== BUILD ARTIFACT TIMESTAMPS ===")
Stat "$root\build\windows\proj\Release\windows.exe" "Release\windows.exe"
Stat "$root\build\windows\proj\Release\v8.dll" "Release\v8.dll"
Stat "$root\build\windows\assets\assets\main\index.js" "build\windows\assets\main\index.js"
Stat "$root\build\windows\proj\Release\Resources\assets\main\index.js" "Release\Resources\main\index.js"
Stat "$root\build\windows\proj\cfg.cmake" "cfg.cmake"

$lines.Add("")
$lines.Add("=== cfg.cmake SWITCHES ===")
if (Test-Path "$root\build\windows\proj\cfg.cmake") {
  Select-String -Path "$root\build\windows\proj\cfg.cmake" -Pattern "USE_SOCKET|USE_EDIT_BOX" |
    ForEach-Object { $lines.Add("  " + $_.Line.Trim()) }
}

$lines.Add("")
$lines.Add("=== KEYWORD COUNT IN Release\Resources main index.js ===")
$res = "$root\build\windows\proj\Release\Resources\assets\main\index.js"
if (Test-Path $res) {
  $txt = Get-Content $res -Raw
  foreach ($k in @("mountRoomCodeInput", "stripNativeEditBoxes", "roomCaretBlink", "EditBox")) {
    $n = ([regex]::Matches($txt, [regex]::Escape($k))).Count
    $lines.Add(("  {0,-24} count={1}" -f $k, $n))
  }
}

$lines.Add("")
$lines.Add("=== KEYWORD COUNT IN build\windows main index.js ===")
$b = "$root\build\windows\assets\assets\main\index.js"
if (Test-Path $b) {
  $txt2 = Get-Content $b -Raw
  foreach ($k in @("mountRoomCodeInput", "stripNativeEditBoxes", "roomCaretBlink", "EditBox")) {
    $n = ([regex]::Matches($txt2, [regex]::Escape($k))).Count
    $lines.Add(("  {0,-24} count={1}" -f $k, $n))
  }
}

$lines.Add("")
$lines.Add("=== EditBox LEFTOVER IN SOURCE SCRIPTS ===")
$srcHits = Get-ChildItem -Path "$root\assets\scripts" -Recurse -Include *.ts |
  Select-String -Pattern "EditBox" -SimpleMatch
if ($srcHits) { foreach ($h in $srcHits) { $lines.Add("  " + $h.Path.Replace($root, "") + ":" + $h.LineNumber + "  " + $h.Line.Trim()) } }
else { $lines.Add("  (none)") }

$lines.Add("")
$lines.Add("=== EditBox LEFTOVER IN SCENE FILES ===")
$scHits = Get-ChildItem -Path "$root\assets\scenes" -Recurse -Include *.scene,*.prefab |
  Select-String -Pattern "cc.EditBox" -SimpleMatch
if ($scHits) { foreach ($h in $scHits) { $lines.Add("  " + (Split-Path $h.Path -Leaf) + ":" + $h.LineNumber) } }
else { $lines.Add("  (none)") }

[System.IO.File]::WriteAllLines($out, $lines, (New-Object System.Text.UTF8Encoding($false)))
Write-Output "written"
