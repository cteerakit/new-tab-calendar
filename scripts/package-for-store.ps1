# Builds a Chrome Web Store-ready .zip (flat root: manifest.json at archive root).
# Run from repo root: powershell -File scripts/package-for-store.ps1

$ErrorActionPreference = "Stop"
# scripts/package-for-store.ps1 -> repo root
$root = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $root "manifest.json"))) {
  throw "manifest.json not found under $root; run from repo as scripts/package-for-store.ps1."
}

$manifestPath = Join-Path $root "manifest.json"
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$version = $manifest.version

$cid = [string]$manifest.oauth2.client_id
if (-not $cid -or $cid -match "YOUR_GOOGLE_OAUTH") {
  throw "manifest.json oauth2.client_id must be set to your Google Cloud 'Chrome extension' OAuth client ID (not the placeholder). See README.md Setup."
}

$dist = Join-Path $root "dist"
$staging = Join-Path $dist "_staging"

if (Test-Path $staging) {
  Remove-Item $staging -Recurse -Force
}
New-Item -ItemType Directory -Path $staging -Force | Out-Null

$files = @(
  "manifest.json",
  "newtab.html",
  "newtab.js",
  "auth.js",
  "calendar.js",
  "styles.css"
)

foreach ($f in $files) {
  Copy-Item (Join-Path $root $f) (Join-Path $staging $f) -Force
}

$iconsOut = Join-Path $staging "icons"
New-Item -ItemType Directory -Path $iconsOut -Force | Out-Null
foreach ($size in @(16, 48, 128)) {
  Copy-Item (Join-Path $root "icons\icon$size.png") (Join-Path $iconsOut "icon$size.png") -Force
}

# Required by newtab.html; same as config.example.js (OAuth is in manifest.json).
Copy-Item (Join-Path $root "config.example.js") (Join-Path $staging "config.js") -Force

$zipName = "new-tab-calendar-v$version.zip"
$zipPath = Join-Path $dist $zipName
if (-not (Test-Path $dist)) {
  New-Item -ItemType Directory -Path $dist -Force | Out-Null
}
if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
}

Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zipPath -CompressionLevel Optimal
Remove-Item $staging -Recurse -Force

Write-Host "Created: $zipPath"
Get-Item $zipPath | Format-List FullName, Length, LastWriteTime
