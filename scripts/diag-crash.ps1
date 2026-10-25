$ErrorActionPreference = "SilentlyContinue"
$repo = Split-Path -Parent $PSScriptRoot
$out = Join-Path $repo "temp\diag-crash.txt"
$lines = New-Object System.Collections.Generic.List[string]

$lines.Add("now local = " + (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"))
$lines.Add("now utc   = " + (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss"))
$lines.Add("")

$lines.Add("=== windows.exe 崩溃事件（UTC 精确时间 + 异常码） ===")
$ev = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; ProviderName = 'Application Error' } -MaxEvents 200 |
  Where-Object { $_.Message -like '*windows.exe*' }
foreach ($e in $ev) {
  $x = [xml]$e.ToXml()
  $utc = $e.TimeCreated.ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss")
  $d = @{}
  foreach ($n in $x.Event.EventData.Data) { $d[$n.Name] = $n.'#text' }
  $lines.Add(("[{0} UTC] code={1} mod={2}+{3} off={4}" -f $utc, $d['P7'], $d['P4'], $d['P5'], $d['P6']))
  $lines.Add(("             faultAddr={0} modVer={1} path={2}" -f $d['P8'], $d['P3'], $d['P6']))
}

$lines.Add("")
$lines.Add("=== 所有 windows.exe 崩溃的 UTC 时间列表（判断是否在修复之后） ===")
foreach ($e in $ev) {
  $lines.Add("  " + $e.TimeCreated.ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss") + " UTC")
}

$lines.Add("")
$lines.Add("=== accounts.json 结构键 ===")
$accountsPath = Join-Path $repo "data\accounts.json"
$acct = Get-Content $accountsPath -Raw | ConvertFrom-Json
$lines.Add(($acct.PSObject.Properties.Name) -join ", ")

[System.IO.File]::WriteAllLines($out, $lines, (New-Object System.Text.UTF8Encoding($false)))
Write-Output "written"
