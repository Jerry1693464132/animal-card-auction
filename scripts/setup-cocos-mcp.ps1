# Install Funplay MCP extension into the Cocos project (requires git + network).
# Run from repo root:  powershell -File scripts/setup-cocos-mcp.ps1

$ErrorActionPreference = 'Stop'

$ProjectRoot = Join-Path $PSScriptRoot '..'
$CocosProject = Join-Path $ProjectRoot 'client/cocos'
$ExtDir = Join-Path $CocosProject 'extensions'
$ExtPath = Join-Path $ExtDir 'funplay-cocos-mcp'
$Repo = 'https://github.com/FunplayAI/funplay-cocos-mcp.git'

New-Item -ItemType Directory -Force -Path $ExtDir | Out-Null

if (Test-Path $ExtPath) {
  Write-Host "Extension already exists at $ExtPath"
} else {
  Write-Host "Cloning Funplay MCP from $Repo ..."
  git clone --depth 1 $Repo $ExtPath
}

# Fallback: npm (when git/GitHub unreachable)
if (-not (Test-Path (Join-Path $ExtPath 'package.json'))) {
  Write-Host "Git clone unavailable; trying npm install funplay-cocos-mcp ..."
  New-Item -ItemType Directory -Force -Path $ExtPath | Out-Null
  npm install funplay-cocos-mcp@latest --prefix $ExtPath --no-save
  $pkg = Join-Path $ExtPath 'node_modules/funplay-cocos-mcp'
  if (Test-Path $pkg) {
    Get-ChildItem $pkg | ForEach-Object { Move-Item $_.FullName (Join-Path $ExtPath $_.Name) -Force }
    Remove-Item (Join-Path $ExtPath 'node_modules') -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $ExtPath 'package-lock.json') -Force -ErrorAction SilentlyContinue
  }
}

Write-Host ""
Write-Host "Next steps (manual, in Cocos Creator 3.8.8):"
Write-Host "  1. Open project: $CocosProject"
Write-Host "  2. Extension Manager -> PROJECT tab (not Store/Global) -> Refresh"
Write-Host "     If still missing: Import Extension and select: $ExtPath"
Write-Host "  3. Menu: Funplay -> MCP Server -> Start server (default http://127.0.0.1:8765/)"
Write-Host "  4. Optional: One-Click Configure for Cursor in the MCP panel"
Write-Host "  5. Cursor: reload MCP (.cursor/mcp.json already points to funplay_cocos)"
Write-Host ""
Write-Host "Verify in Cursor chat: ask agent to read Cocos scene hierarchy via funplay_cocos tools."
