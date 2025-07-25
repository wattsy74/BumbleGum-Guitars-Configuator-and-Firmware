# Remove all .uf2 files from the renderer directory
Remove-Item -Path ".\renderer\*.uf2" -Force -ErrorAction SilentlyContinue

# Prompt for version number
$version = Read-Host "Enter new firmware version (e.g. v2.4)"

# Set output path
$outPath = ".\renderer\bgg-fw-$version.uf2"

# Run picotool to save 2MB UF2
c:\tools\picotool.exe save --range 0x10000000 0x10200000 $outPath

Write-Host "UF2 saved to $outPath"