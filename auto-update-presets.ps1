# Auto-Update Community Presets
# This script downloads the latest community presets and merges them automatically

param(
    [string]$PresetsJsonPath = ".\bgg-firmware-updates\presets.json",
    [string]$TempDir = ".\temp-community-presets"
)

Write-Host " BumbleGum Community Preset Auto-Updater" -ForegroundColor Yellow
Write-Host "===========================================" -ForegroundColor Yellow

# Create temp directory
if (Test-Path $TempDir) {
    Remove-Item $TempDir -Recurse -Force
}
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

try {
    # Download latest community presets
    Write-Host "  Downloading latest community presets..." -ForegroundColor Blue
    Set-Location $TempDir
    git clone https://github.com/wattsy74/BumbleGum-Presets.git . 2>$null
    Set-Location ..
    
    if (-not (Test-Path "$TempDir\presets")) {
        throw "Failed to download community presets"
    }
    
    # Load existing presets.json
    if (Test-Path $PresetsJsonPath) {
        Write-Host " Loading existing presets..." -ForegroundColor Green
        $existingPresets = Get-Content $PresetsJsonPath | ConvertFrom-Json
    } else {
        throw "Could not find presets.json at: $PresetsJsonPath"
    }
    
    # Backup existing presets
    $backupPath = $PresetsJsonPath -replace "\.json", "-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
    Copy-Item $PresetsJsonPath $backupPath
    Write-Host " Backup created: $backupPath" -ForegroundColor Yellow
    
    # Initialize merged presets
    $mergedPresets = @{
        "_metadata" = @{
            "version" = $existingPresets._metadata.version
            "description" = $existingPresets._metadata.description
            "lastUpdated" = (Get-Date -Format "yyyy-MM-dd")
            "communityPresetsLastSync" = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
        }
        "presets" = @{}
    }
    
    # Copy existing presets (excluding old community ones)
    foreach ($preset in $existingPresets.presets.PSObject.Properties) {
        if (-not $preset.Name.StartsWith("Community - ")) {
            $mergedPresets.presets[$preset.Name] = $preset.Value
            Write-Host " Keeping: $($preset.Name)" -ForegroundColor Cyan
        } else {
            Write-Host "  Removing old: $($preset.Name)" -ForegroundColor DarkYellow
        }
    }
    
    $communityCount = 0
    
    # Add new community presets
    $bgpFiles = Get-ChildItem -Path "$TempDir\presets" -Filter "*.bgp"
    
    foreach ($bgpFile in $bgpFiles) {
        try {
            Write-Host " Processing: $($bgpFile.Name)" -ForegroundColor Blue
            $bgpContent = Get-Content $bgpFile.FullName | ConvertFrom-Json
            
            $presetName = $bgpContent.name
            $presetData = $bgpContent.preset
            $communityPresetName = "Community - $presetName"
            
            $mergedPresets.presets[$communityPresetName] = $presetData
            $communityCount++
            
            Write-Host " Added: $communityPresetName" -ForegroundColor Green
            
        } catch {
            Write-Host " Failed to process $($bgpFile.Name): $($_.Exception.Message)" -ForegroundColor Red
        }
    }
    
    # Update metadata
    $mergedPresets._metadata.communityPresets = $communityCount
    
    # Save updated presets.json
    $mergedJson = $mergedPresets | ConvertTo-Json -Depth 10
    $mergedJson | Out-File -FilePath $PresetsJsonPath -Encoding UTF8
    
    Write-Host ""
    Write-Host " Auto-Update Complete!" -ForegroundColor Green
    Write-Host " Community presets added: $communityCount" -ForegroundColor Cyan
    Write-Host " Total presets: $($mergedPresets.presets.Count)" -ForegroundColor Cyan
    Write-Host " Updated: $PresetsJsonPath" -ForegroundColor Yellow
    Write-Host " Backup: $backupPath" -ForegroundColor Yellow
    
} catch {
    Write-Host " Error: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    # Cleanup
    if (Test-Path $TempDir) {
        Remove-Item $TempDir -Recurse -Force
    }
}

Write-Host ""
Write-Host " Next steps:"
Write-Host "1. Restart BumbleGum Configurator to see new presets"
Write-Host "2. Community presets will appear with 'Community - ' prefix"
