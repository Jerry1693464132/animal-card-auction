Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win2 {
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string c, string n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
}
"@

$p = Get-Process windows -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { Write-Output "NO_WINDOW"; exit 1 }
$h = $p.MainWindowHandle
[Win2]::ShowWindow($h, 9) | Out-Null
[Win2]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 1200

$cr = New-Object Win2+RECT
[Win2]::GetClientRect($h, [ref]$cr) | Out-Null
$pt = New-Object Win2+POINT
$pt.X = 0; $pt.Y = 0
[Win2]::ClientToScreen($h, [ref]$pt) | Out-Null

$w = [int]($cr.R - $cr.L); $ht = [int]($cr.B - $cr.T)
Write-Output ("client size: " + $w + "x" + $ht + " at screen " + $pt.X + "," + $pt.Y)

$bmp = New-Object System.Drawing.Bitmap -ArgumentList $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($pt.X, $pt.Y, 0, 0, $bmp.Size)
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "temp\game-client.png"
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output ("saved=" + $out)
