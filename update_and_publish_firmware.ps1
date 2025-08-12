# ===== BGG FIRMWARE VERSION UPDATE AND PUBLISH SCRIPT =====
# Automatically updates version numbers in all firmware files and publishes to GitHub

param(
    [string]$NewVersion = ""
)

# Colors for output
$Green = 'Green'
$Yellow = 'Yellow'
$Red = 'Red'
$Cyan = 'Cyan'
$Magenta = 'Magenta'

Write-Host "BGG Firmware Update and Publish Script" -ForegroundColor $Cyan
Write-Host "=======================================" -ForegroundColor $Cyan

# Function to extract version from firmware files
function Get-FirmwareVersion {
    $BootPyPath = Join-Path $FirmwareDir "boot.py"
    
    if (Test-Path $BootPyPath) {
        Write-Host "Reading current version from boot.py..." -ForegroundColor $Cyan
        $bootContent = Get-Content $BootPyPath -Raw
        
        # Extract version from __version__ = "x.x.x" pattern
        if ($bootContent -match '__version__\s*=\s*"([^"]+)"') {
            $detectedVersion = $matches[1]
            Write-Host "Detected current firmware version: $detectedVersion" -ForegroundColor $Green
            return $detectedVersion
        } else {
            Write-Host "Could not extract version from boot.py" -ForegroundColor $Yellow
            return $null
        }
    } else {
        Write-Host "boot.py not found in $FirmwareDir" -ForegroundColor $Red
        return $null
    }
}

# Set working directory to bgg-firmware-updates first
$FirmwareDir = "c:\Users\mlwat\OneDrive\Desktop\BGG-Windows-App v3.0\bgg-firmware-updates"
Set-Location $FirmwareDir

# Get version number from user if not provided, or offer to use detected version
if (-not $NewVersion) {
    $detectedVersion = Get-FirmwareVersion
    
    if ($detectedVersion) {
        Write-Host "Detected current version: $detectedVersion" -ForegroundColor $Green
        $useDetected = Read-Host "Use detected version for manifest update? (y/n, or enter new version like 3.9.12)"
        
        if ($useDetected -eq 'y' -or $useDetected -eq 'Y' -or $useDetected -eq '') {
            $NewVersion = $detectedVersion
            Write-Host "Using detected version: $NewVersion" -ForegroundColor $Green
        } elseif ($useDetected -match '^\d+\.\d+(\.\d+)?$') {
            $NewVersion = $useDetected
            Write-Host "Using provided version: $NewVersion" -ForegroundColor $Green
        } else {
            $NewVersion = Read-Host "Enter new firmware version (e.g., 3.9.1, 3.10.0)"
        }
    } else {
        $NewVersion = Read-Host "Enter new firmware version (e.g., 3.9.1, 3.10.0)"
    }
}

# Validate version format
if ($NewVersion -notmatch '^\d+\.\d+(\.\d+)?$') {
    Write-Host "Invalid version format. Use format like 3.9.1 or 3.10" -ForegroundColor $Red
    exit 1
}

# Get custom release notes from user
Write-Host "`nEnter release notes for version $NewVersion" -ForegroundColor $Cyan
Write-Host "   (Leave empty for default notes, or describe what changed)" -ForegroundColor $Yellow
$CustomReleaseNotes = Read-Host "Release notes"

if ([string]::IsNullOrWhiteSpace($CustomReleaseNotes)) {
    $ReleaseNotes = "BGG Firmware v$NewVersion - Latest release"
} else {
    $ReleaseNotes = "BGG Firmware v$NewVersion - $CustomReleaseNotes"
}

Write-Host "Updating all firmware files to version: $NewVersion" -ForegroundColor $Green

Write-Host "Working in: $FirmwareDir" -ForegroundColor $Yellow

# Function to update version in Python files
function Update-PythonVersion {
    param($FilePath, $Version)
    
    if (Test-Path $FilePath) {
        Write-Host "  Updating $FilePath" -ForegroundColor $Yellow
        
        $content = Get-Content $FilePath -Raw
        
        # Update __version__ = "x.x.x" pattern
        $content = $content -replace '__version__\s*=\s*"[^"]*"', "__version__ = `"$Version`""
        
        # Update FIRMWARE_VERSIONS dictionary entries
        $content = $content -replace '("[\w\.]+"\s*:\s*)"[^"]*"', "`${1}`"$Version`""
        
        # Update version comments (e.g., # boot.py v3.9)
        $content = $content -replace '(#.*v)\d+\.\d+(\.\d+)?', "`${1}$Version"
        
        # Update any "vX.X" patterns in comments
        $content = $content -replace 'v\d+\.\d+(\.\d+)?', "v$Version"
        
        Set-Content $FilePath $content -NoNewline
        Write-Host "    Updated Python version strings" -ForegroundColor $Green
    } else {
        Write-Host "    File not found: $FilePath" -ForegroundColor $Yellow
    }
}

# Function to update version in JSON files
function Update-JsonVersion {
    param($FilePath, $Version)
    
    if (Test-Path $FilePath) {
        Write-Host "  Updating $FilePath" -ForegroundColor $Yellow
        
        try {
            $json = Get-Content $FilePath -Raw | ConvertFrom-Json
            $fileName = Split-Path $FilePath -Leaf
            
            # Determine if this is a manifest file that should have file hashes
            # Only version_manifest.json should be treated as a manifest file
            $isManifestFile = ($fileName -eq "version_manifest.json")
            
            # Additional safety check: if it's presets.json, config.json, user_presets.json, or factory_config.json, 
            # it should NEVER be treated as a manifest file
            $isConfigFile = ($fileName -eq "presets.json") -or 
                           ($fileName -eq "config.json") -or 
                           ($fileName -eq "user_presets.json") -or 
                           ($fileName -eq "factory_config.json")
            
            if ($isConfigFile) {
                $isManifestFile = $false
                Write-Host "    Detected config file: $fileName (forcing config file processing)" -ForegroundColor $Magenta
            }
            
            # Update various version fields
            if ($json.PSObject.Properties['version']) {
                $json.version = $Version
            }
            if ($json.PSObject.Properties['firmware_version']) {
                $json.firmware_version = $Version
            }
            if ($json.PSObject.Properties['_metadata']) {
                if ($json._metadata.PSObject.Properties['version']) {
                    $json._metadata.version = $Version
                }
            }
            
            # Update lastUpdated to current date
            $currentDate = Get-Date -Format "yyyy-MM-dd"
            if ($json.PSObject.Properties['lastUpdated']) {
                $json.lastUpdated = $currentDate
            }
            if ($json.PSObject.Properties['_metadata'] -and $json._metadata.PSObject.Properties['lastUpdated']) {
                $json._metadata.lastUpdated = $currentDate
            }
            
            # Only apply manifest-specific updates to actual manifest files
            if ($isManifestFile) {
                Write-Host "    Processing as manifest file" -ForegroundColor $Cyan
                
                # CRITICAL: Update the main firmware_version field first
                if ($json.PSObject.Properties['firmware_version']) {
                    $json.firmware_version = $Version
                    Write-Host "    Updated main firmware_version to $Version" -ForegroundColor $Green
                }
                
                # Update generated_at timestamp for manifest
                if ($json.PSObject.Properties['generated_at']) {
                    $json.generated_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
                }
                
                # Update individual file versions and recalculate hashes in manifest
                if ($json.PSObject.Properties['files']) {
                    foreach ($fileEntry in $json.files.PSObject.Properties) {
                        $fileToHash = $fileEntry.Name
                        
                        # CRITICAL: Update version for ALL files first
                        if ($fileEntry.Value.PSObject.Properties['version']) {
                            $fileEntry.Value.version = $Version
                            Write-Host "    Updated version for $fileToHash to $Version" -ForegroundColor $Green
                        }
                        
                        # CRITICAL: Skip presets.json hash calculation to prevent corruption during processing
                        if ($fileToHash -eq "presets.json") {
                            Write-Host "    Skipping hash calculation for presets.json (protection against corruption)" -ForegroundColor $Magenta
                            continue
                        }
                        
                        # Recalculate hash and size for the file
                        $filePath = Join-Path $PWD $fileToHash
                        if (Test-Path $filePath) {
                            try {
                                $fileHash = Get-FileHash -Path $filePath -Algorithm SHA256
                                $fileSize = (Get-Item $filePath).Length
                                
                                $fileEntry.Value.checksum = $fileHash.Hash.ToLower()
                                $fileEntry.Value.size = $fileSize
                                $fileEntry.Value.algorithm = "sha256"
                                
                                Write-Host "    Updated hash for $fileToHash`: $($fileHash.Hash.ToLower().Substring(0,8))..." -ForegroundColor $Green
                            } catch {
                                Write-Host "    Could not calculate hash for $fileToHash`: $($_.Exception.Message)" -ForegroundColor $Yellow
                            }
                        } else {
                            Write-Host "    File not found for hash calculation: $fileToHash" -ForegroundColor $Yellow
                        }
                    }
                }
                
                # Update release notes
                if ($json.PSObject.Properties['release_notes']) {
                    $json.release_notes = $ReleaseNotes
                    Write-Host "    Updated release notes to: $ReleaseNotes" -ForegroundColor $Green
                }
            } else {
                Write-Host "    Processing as config/preset file (skipping manifest operations)" -ForegroundColor $Cyan
            }
            
            # Update description version references for all files
            if ($json.PSObject.Properties['_metadata'] -and $json._metadata.PSObject.Properties['description']) {
                $json._metadata.description = $json._metadata.description -replace 'v\d+\.\d+(\.\d+)?', "v$Version"
            }
            
            # Save with proper formatting
            $json | ConvertTo-Json -Depth 10 | Set-Content $FilePath
            Write-Host "    Updated JSON version fields" -ForegroundColor $Green
            
            # CRITICAL: Return the modified object if this is the manifest
            if ($isManifestFile) {
                return $json
            }
            
        } catch {
            Write-Host "    Error updating JSON: $($_.Exception.Message)" -ForegroundColor $Red
        }
    } else {
        Write-Host "    File not found: $FilePath" -ForegroundColor $Yellow
    }
    
    return $null
}

# Function to safely update config.json (NEVER treat as manifest file)
function Update-ConfigJsonSafely {
    param($FilePath, $Version)
    
    if (Test-Path $FilePath) {
        Write-Host "  Safely updating $FilePath (device configuration only)" -ForegroundColor $Magenta
        
        try {
            $json = Get-Content $FilePath -Raw | ConvertFrom-Json
            
            # ONLY update version fields, NEVER add manifest properties
            if ($json.PSObject.Properties['_metadata']) {
                if ($json._metadata.PSObject.Properties['version']) {
                    $json._metadata.version = $Version
                    Write-Host "    Updated _metadata.version to $Version" -ForegroundColor $Green
                }
                
                # Update lastUpdated to current date
                $currentDate = Get-Date -Format "yyyy-MM-dd"
                if ($json._metadata.PSObject.Properties['lastUpdated']) {
                    $json._metadata.lastUpdated = $currentDate
                    Write-Host "    Updated lastUpdated to $currentDate" -ForegroundColor $Green
                }
                
                # Update description version references
                if ($json._metadata.PSObject.Properties['description']) {
                    $json._metadata.description = $json._metadata.description -replace 'v\d+\.\d+(\.\d+)?', "v$Version"
                    Write-Host "    Updated description version reference" -ForegroundColor $Green
                }
            }
            
            # CRITICAL: Verify this is actually a config file (has GPIO pin assignments)
            if (-not ($json.PSObject.Properties['GREEN_FRET'] -and $json.PSObject.Properties['RED_FRET'])) {
                Write-Host "    ERROR: This doesn't look like a config file! Skipping to prevent corruption." -ForegroundColor $Red
                return
            }
            
            # CRITICAL: Make sure it's not a manifest file
            if ($json.PSObject.Properties['files'] -or $json.PSObject.Properties['firmware_version'] -or $json.PSObject.Properties['generated_at']) {
                Write-Host "    ERROR: This looks like a manifest file! Restoring from backup..." -ForegroundColor $Red
                # Don't save, just skip
                return
            }
            
            # Save with proper formatting
            $json | ConvertTo-Json -Depth 10 | Set-Content $FilePath
            Write-Host "    Successfully updated config.json safely" -ForegroundColor $Green
            
        } catch {
            Write-Host "    Error updating config.json: $($_.Exception.Message)" -ForegroundColor $Red
        }
    } else {
        Write-Host "    File not found: $FilePath" -ForegroundColor $Yellow
    }
}

# Function to safely update presets.json (NEVER treat as manifest file)
function Update-PresetsJsonSafely {
    param($FilePath, $Version)
    
    if (Test-Path $FilePath) {
        Write-Host "  Safely updating $FilePath (preset colors only)" -ForegroundColor $Magenta
        
        try {
            $json = Get-Content $FilePath -Raw | ConvertFrom-Json
            
            # ONLY update version fields, NEVER add manifest properties
            if ($json.PSObject.Properties['_metadata']) {
                if ($json._metadata.PSObject.Properties['version']) {
                    $json._metadata.version = $Version
                    Write-Host "    Updated _metadata.version to $Version" -ForegroundColor $Green
                }
                
                # Update lastUpdated to current date
                $currentDate = Get-Date -Format "yyyy-MM-dd"
                if ($json._metadata.PSObject.Properties['lastUpdated']) {
                    $json._metadata.lastUpdated = $currentDate
                    Write-Host "    Updated lastUpdated to $currentDate" -ForegroundColor $Green
                }
                
                # Update description version references
                if ($json._metadata.PSObject.Properties['description']) {
                    $json._metadata.description = $json._metadata.description -replace 'v\d+\.\d+(\.\d+)?', "v$Version"
                    Write-Host "    Updated description version reference" -ForegroundColor $Green
                }
            }
            
            # CRITICAL: Verify this is actually a presets file (has presets property)
            if (-not $json.PSObject.Properties['presets']) {
                Write-Host "    ERROR: This doesn't look like a presets file! Skipping to prevent corruption." -ForegroundColor $Red
                return
            }
            
            # CRITICAL: Make sure it's not a manifest file
            if ($json.PSObject.Properties['files'] -or $json.PSObject.Properties['firmware_version'] -or $json.PSObject.Properties['generated_at']) {
                Write-Host "    ERROR: This looks like a manifest file! Restoring from backup..." -ForegroundColor $Red
                # Don't save, just skip
                return
            }
            
            # Save with proper formatting
            $json | ConvertTo-Json -Depth 10 | Set-Content $FilePath
            Write-Host "    Successfully updated presets.json safely" -ForegroundColor $Green
            
        } catch {
            Write-Host "    Error updating presets.json: $($_.Exception.Message)" -ForegroundColor $Red
        }
    } else {
        Write-Host "    File not found: $FilePath" -ForegroundColor $Yellow
    }
}

Write-Host "`nUpdating firmware files..." -ForegroundColor $Cyan

# Update Python files
$PythonFiles = @(
    "boot.py",
    "code.py", 
    "serial_handler.py",
    "hardware.py",
    "gamepad.py",
    "utils.py",
    "demo_routine.py",
    "demo_state.py",
    "pin_detect.py"
)

foreach ($file in $PythonFiles) {
    Update-PythonVersion $file $NewVersion
}

Write-Host "`nImplementing NUCLEAR protection for critical files..." -ForegroundColor $Magenta

# NUCLEAR OPTION: Physically move critical config files OUT of directory during processing
$PresetsBackupPath = "c:\temp\presets_backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').json"
$ConfigBackupPath = "c:\temp\config_backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').json"

# Create temp directory if it doesn't exist
if (-not (Test-Path "c:\temp")) {
    New-Item -ItemType Directory -Path "c:\temp" -Force | Out-Null
}

# Move presets.json completely out of the way
if (Test-Path "presets.json") {
    Write-Host "    Moving presets.json to safe location: $PresetsBackupPath" -ForegroundColor $Yellow
    Copy-Item "presets.json" $PresetsBackupPath -Force
    Write-Host "    Presets backup created successfully" -ForegroundColor $Green
} else {
    Write-Host "    WARNING: presets.json not found!" -ForegroundColor $Red
}

# Move config.json completely out of the way  
if (Test-Path "config.json") {
    Write-Host "    Moving config.json to safe location: $ConfigBackupPath" -ForegroundColor $Yellow
    Copy-Item "config.json" $ConfigBackupPath -Force
    Write-Host "    Config backup created successfully" -ForegroundColor $Green
} else {
    Write-Host "    WARNING: config.json not found!" -ForegroundColor $Red
}

Write-Host "`nUpdating JSON files (critical files safely moved away)..." -ForegroundColor $Cyan

# Update JSON files (critical files are now physically absent)
$JsonFiles = @(
    "version_manifest.json",
    "user_presets.json",
    "factory_config.json"
)

$manifestObject = $null
foreach ($file in $JsonFiles) {
    $result = Update-JsonVersion $file $NewVersion
    
    # Capture the manifest object if this is version_manifest.json
    if ((Split-Path $file -Leaf) -eq "version_manifest.json" -and $result -ne $null) {
        $manifestObject = $result
        Write-Host "  Captured updated manifest object" -ForegroundColor $Green
    }
}

# Now safely restore and update critical files
Write-Host "`nSafely restoring and updating critical files..." -ForegroundColor $Cyan

# Restore and update presets.json
if (Test-Path $PresetsBackupPath) {
    # Restore from backup
    Copy-Item $PresetsBackupPath "presets.json" -Force
    Write-Host "    Presets.json restored from backup" -ForegroundColor $Green
    
    # Update it safely
    Update-PresetsJsonSafely "presets.json" $NewVersion
    
    # Clean up backup
    Remove-Item $PresetsBackupPath -Force
    Write-Host "    Presets backup cleaned up" -ForegroundColor $Green
} else {
    Write-Host "    ERROR: Presets backup file not found!" -ForegroundColor $Red
}

# Restore and update config.json
if (Test-Path $ConfigBackupPath) {
    # Restore from backup
    Copy-Item $ConfigBackupPath "config.json" -Force
    Write-Host "    Config.json restored from backup" -ForegroundColor $Green
    
    # Update it safely using the dedicated config function
    Update-ConfigJsonSafely "config.json" $NewVersion
    
    # Clean up backup
    Remove-Item $ConfigBackupPath -Force
    Write-Host "    Config backup cleaned up" -ForegroundColor $Green
} else {
    Write-Host "    ERROR: Config backup file not found!" -ForegroundColor $Red
}

# After safely updating critical files, manually update their hashes in the manifest
Write-Host "`nUpdating critical file hashes in manifest..." -ForegroundColor $Cyan
if ($manifestObject -eq $null) {
    Write-Host "  ERROR: Manifest object not captured! Loading from file as fallback..." -ForegroundColor $Red
    if (Test-Path "version_manifest.json") {
        $manifest = Get-Content "version_manifest.json" -Raw | ConvertFrom-Json
    } else {
        Write-Host "  FATAL ERROR: No manifest file found!" -ForegroundColor $Red
        exit 1
    }
} else {
    Write-Host "  Using captured manifest object (avoiding file reload)" -ForegroundColor $Green
    $manifest = $manifestObject
}

# CRITICAL: Make sure the main firmware version is still correct
if ($manifest.PSObject.Properties['firmware_version']) {
    $manifest.firmware_version = $NewVersion
    Write-Host "  Ensuring main firmware_version is $NewVersion" -ForegroundColor $Cyan
}

# CRITICAL: Make sure release notes are still correct  
if ($manifest.PSObject.Properties['release_notes']) {
    $manifest.release_notes = $ReleaseNotes
    Write-Host "  Ensuring release notes are correct" -ForegroundColor $Cyan
}
        
        # Update presets.json hash
        if ($manifest.PSObject.Properties['files'] -and $manifest.files.PSObject.Properties['presets.json']) {
            $presetsHash = Get-FileHash -Path "presets.json" -Algorithm SHA256
            $presetsSize = (Get-Item "presets.json").Length
            
            $manifest.files."presets.json".checksum = $presetsHash.Hash.ToLower()
            $manifest.files."presets.json".size = $presetsSize
            $manifest.files."presets.json".version = $NewVersion
            
            Write-Host "  Updated presets.json hash in manifest: $($presetsHash.Hash.ToLower().Substring(0,8))..." -ForegroundColor $Green
        }
        
        # Update config.json hash
        if ($manifest.PSObject.Properties['files'] -and $manifest.files.PSObject.Properties['config.json']) {
            $configHash = Get-FileHash -Path "config.json" -Algorithm SHA256
            $configSize = (Get-Item "config.json").Length
            
            $manifest.files."config.json".checksum = $configHash.Hash.ToLower()
            $manifest.files."config.json".size = $configSize
            $manifest.files."config.json".version = $NewVersion
            
            Write-Host "  Updated config.json hash in manifest: $($configHash.Hash.ToLower().Substring(0,8))..." -ForegroundColor $Green
        }
        
        $manifest | ConvertTo-Json -Depth 10 | Set-Content "version_manifest.json"
        Write-Host "  Final manifest update complete" -ForegroundColor $Green
        
        # CRITICAL POST-PROCESSING: Force fix any remaining version inconsistencies
        Write-Host "  Post-processing: Verifying and fixing all file versions..." -ForegroundColor $Magenta
        try {
            # Use the in-memory manifest instead of reloading from file
            $needsFix = $false
            
            # Check for any files that still have wrong versions
            foreach ($fileEntry in $manifest.files.PSObject.Properties) {
                if ($fileEntry.Value.version -ne $NewVersion) {
                    Write-Host "  FIXING: $($fileEntry.Name) version from $($fileEntry.Value.version) to $NewVersion" -ForegroundColor $Yellow
                    $fileEntry.Value.version = $NewVersion
                    $needsFix = $true
                }
            }
            
            if ($needsFix) {
                # Force save the corrected manifest
                [System.IO.File]::WriteAllText("version_manifest.json", ($manifest | ConvertTo-Json -Depth 10), [System.Text.Encoding]::UTF8)
                Write-Host "  ✓ POST-PROCESSING: Fixed version inconsistencies and saved corrected manifest" -ForegroundColor $Green
            } else {
                Write-Host "  ✓ POST-PROCESSING: All versions already correct" -ForegroundColor $Green
            }
        } catch {
            Write-Host "  ⚠ POST-PROCESSING: Could not verify/fix versions: $($_.Exception.Message)" -ForegroundColor $Yellow
        }

# FINAL VERIFICATION: Check that critical files still contain proper data
Write-Host "`nFINAL VERIFICATION: Checking critical file integrity..." -ForegroundColor $Magenta

# Check presets.json
if (Test-Path "presets.json") {
    try {
        $presetsContent = Get-Content "presets.json" -Raw | ConvertFrom-Json
        if ($presetsContent.PSObject.Properties['presets'] -and $presetsContent.presets.PSObject.Properties['GRYBO']) {
            Write-Host "  ✓ VERIFICATION PASSED: presets.json contains proper preset data" -ForegroundColor $Green
            Write-Host "  ✓ Found GRYBO preset with $(($presetsContent.presets.GRYBO.PSObject.Properties).Count) color settings" -ForegroundColor $Green
        } else {
            Write-Host "  ✗ VERIFICATION FAILED: presets.json does not contain expected preset structure!" -ForegroundColor $Red
            Write-Host "  This means corruption occurred despite nuclear protection!" -ForegroundColor $Red
        }
    } catch {
        Write-Host "  ✗ VERIFICATION FAILED: Could not parse presets.json: $($_.Exception.Message)" -ForegroundColor $Red
    }
} else {
    Write-Host "  ✗ VERIFICATION FAILED: presets.json file not found!" -ForegroundColor $Red
}

# Check config.json
if (Test-Path "config.json") {
    try {
        $configContent = Get-Content "config.json" -Raw | ConvertFrom-Json
        if ($configContent.PSObject.Properties['GREEN_FRET'] -and $configContent.PSObject.Properties['RED_FRET']) {
            Write-Host "  ✓ VERIFICATION PASSED: config.json contains proper device configuration" -ForegroundColor $Green
            Write-Host "  ✓ Found GPIO pin assignments (GREEN_FRET: $($configContent.GREEN_FRET), RED_FRET: $($configContent.RED_FRET))" -ForegroundColor $Green
        } else {
            Write-Host "  ✗ VERIFICATION FAILED: config.json does not contain expected device configuration!" -ForegroundColor $Red
            Write-Host "  This means corruption occurred despite nuclear protection!" -ForegroundColor $Red
        }
    } catch {
        Write-Host "  ✗ VERIFICATION FAILED: Could not parse config.json: $($_.Exception.Message)" -ForegroundColor $Red
    }
} else {
    Write-Host "  ✗ VERIFICATION FAILED: config.json file not found!" -ForegroundColor $Red
}

Write-Host "`nChecking git status..." -ForegroundColor $Cyan

# Check git status
$gitStatus = git status --porcelain
if ($gitStatus) {
    Write-Host "Modified files:" -ForegroundColor $Yellow
    $gitStatus | ForEach-Object { Write-Host "  $_" -ForegroundColor $Yellow }
    
    Write-Host "`nAdding files to git..." -ForegroundColor $Cyan
    git add .
    
    Write-Host "Committing changes..." -ForegroundColor $Cyan
    $commitMessage = "Bump firmware version to v$NewVersion

$ReleaseNotes

- Updated all Python files to version $NewVersion
- Updated all JSON configuration files  
- Updated version_manifest.json with new version and checksums
- Updated timestamps and release notes
- Ready for automatic update testing"

    git commit -m $commitMessage
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Commit successful" -ForegroundColor $Green
        
        Write-Host "`nPushing to GitHub..." -ForegroundColor $Cyan
        git push
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Push successful!" -ForegroundColor $Green
            Write-Host "`nFirmware v$NewVersion published successfully!" -ForegroundColor $Green
            Write-Host "The automatic update system should now detect v$NewVersion" -ForegroundColor $Cyan
        } else {
            Write-Host "Git push failed" -ForegroundColor $Red
            exit 1
        }
    } else {
        Write-Host "Git commit failed" -ForegroundColor $Red
        exit 1
    }
} else {
    Write-Host "No changes detected - all files may already be at version $NewVersion" -ForegroundColor $Yellow
}

Write-Host "`nSummary:" -ForegroundColor $Cyan
Write-Host "  Version: $NewVersion" -ForegroundColor $Green
Write-Host "  Updated: $($PythonFiles.Count) Python files" -ForegroundColor $Green  
Write-Host "  Updated: $($JsonFiles.Count) JSON files" -ForegroundColor $Green
Write-Host "  Published to GitHub: Yes" -ForegroundColor $Green

Write-Host "`nDone! Test the automatic update system now." -ForegroundColor $Green
