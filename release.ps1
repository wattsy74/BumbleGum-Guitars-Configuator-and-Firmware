[CmdletBinding()]
param(
    [Parameter(ParameterSetName = "AutoIncrement")]
    [ValidateSet("major", "minor", "patch")]
    [string]$VersionType = "patch",
    
    [Parameter(ParameterSetName = "ManualVersion")]
    [string]$Version,
    
    [ValidateSet("Update", "Recreate", "Skip")]
    [string]$ExistingReleaseAction = "Update",
    
    [switch]$DryRun
)

# Set encoding to UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# Colors for output
function Write-Success { param($Message) Write-Host "[SUCCESS] $Message" -ForegroundColor Green }
function Write-Info { param($Message) Write-Host "[INFO] $Message" -ForegroundColor Cyan }
function Write-Warning { param($Message) Write-Host "[WARNING] $Message" -ForegroundColor Yellow }
function Write-Error { param($Message) Write-Host "[ERROR] $Message" -ForegroundColor Red }
function Write-Step { param($Message) Write-Host "`n[STEP] $Message" -ForegroundColor Blue }

# Function to validate prerequisites
function Test-Prerequisites {
    Write-Step "Validating prerequisites..."
    
    # Check if we're in a git repository
    if (-not (Test-Path ".git")) {
        Write-Error "Not in a git repository"
        return $false
    }
    
    # Check if git is available
    try {
        git --version | Out-Null
        Write-Success "Git is available"
    } catch {
        Write-Error "Git is not available in PATH"
        return $false
    }
    
    # Check if npm is available
    try {
        npm --version | Out-Null
        Write-Success "npm is available"
    } catch {
        Write-Error "npm is not available in PATH"
        return $false
    }
    
    # Check if package.json exists
    if (-not (Test-Path "package.json")) {
        Write-Error "package.json not found"
        return $false
    }
    
    # Check for uncommitted changes
    $gitStatus = git status --porcelain
    if ($gitStatus) {
        Write-Warning "Uncommitted changes detected:"
        Write-Host $gitStatus
        if (-not $DryRun) {
            $continue = Read-Host "Continue anyway? (y/N)"
            if ($continue -ne 'y' -and $continue -ne 'Y') {
                Write-Info "Release cancelled"
                return $false
            }
        }
    } else {
        Write-Success "Working directory is clean"
    }
    
    # Check GitHub CLI availability
    try {
        gh --version | Out-Null
        Write-Success "GitHub CLI is available"
        return $true
    } catch {
        Write-Warning "GitHub CLI not found. Install it for automatic GitHub releases:"
        Write-Info "  https://cli.github.com/"
        Write-Info "  Or: winget install GitHub.cli"
        return $true  # Continue without gh
    }
}

# Function to get target version (either from parameter or auto-increment)
function Get-TargetVersion {
    param([string]$currentVersion, [string]$versionType, [string]$manualVersion)
    
    if ($manualVersion) {
        # Validate manual version format
        if ($manualVersion -notmatch '^\d+\.\d+\.\d+$') {
            throw "Invalid version format. Expected format: x.y.z (e.g., 3.9.26)"
        }
        return $manualVersion
    } else {
        # Auto-increment based on version type
        return Get-NewVersion -currentVersion $currentVersion -versionType $versionType
    }
}

# Function to get current version from package.json
function Get-CurrentVersion {
    $packageJson = Get-Content "package.json" | ConvertFrom-Json
    return $packageJson.version
}

# Function to calculate new version
function Get-NewVersion {
    param([string]$currentVersion, [string]$versionType)
    
    $versionParts = $currentVersion.Split('.')
    $major = [int]$versionParts[0]
    $minor = [int]$versionParts[1]
    $patch = [int]$versionParts[2]
    
    switch ($versionType) {
        "major" { 
            $major++
            $minor = 0
            $patch = 0
        }
        "minor" { 
            $minor++
            $patch = 0
        }
        "patch" { 
            $patch++
        }
    }
    
    return "$major.$minor.$patch"
}

# Function to update package.json version
function Update-PackageVersion {
    param([string]$newVersion, [string]$currentVersion)
    
    Write-Step "Updating package.json version to $newVersion..."
    
    if ($newVersion -eq $currentVersion) {
        Write-Info "Version $newVersion is already set in package.json - skipping version update"
        return $true
    }
    
    if ($DryRun) {
        Write-Info "DRY RUN: Would update package.json version from $currentVersion to $newVersion"
        return $true
    }
    
    try {
        npm version $newVersion --no-git-tag-version | Out-Null
        Write-Success "Updated package.json from $currentVersion to version $newVersion"
        return $true
    } catch {
        Write-Error "Failed to update package.json: $($_.Exception.Message)"
        return $false
    }
}

# Function to build the application
function Build-Application {
    Write-Step "Building application..."
    
    if ($DryRun) {
        Write-Info "DRY RUN: Would run npm run build and npm run make"
        return $true
    }
    
    try {
        Write-Info "Running npm run make..."
        npm run make
        if ($LASTEXITCODE -ne 0) { throw "Make failed" }
        
        Write-Success "Application built successfully"
        return $true
    } catch {
        Write-Error "Build failed: $($_.Exception.Message)"
        return $false
    }
}

# Function to commit and tag changes
function Commit-Changes {
    param([string]$version)
    
    Write-Step "Committing changes and creating tag..."
    
    if ($DryRun) {
        Write-Info "DRY RUN: Would commit changes and create tag v$version"
        return $true
    }
    
    try {
        # Check if tag already exists
        $tagExists = git tag -l "v$version"
        if ($tagExists) {
            Write-Warning "Tag v$version already exists"
            $recreate = Read-Host "Delete and recreate tag? (y/N)"
            if ($recreate -eq 'y' -or $recreate -eq 'Y') {
                git tag -d "v$version"
                git push origin ":refs/tags/v$version" 2>$null  # Delete remote tag, ignore errors
                Write-Info "Deleted existing tag v$version"
            } else {
                Write-Info "Skipping tag creation - using existing tag"
                return $true
            }
        }
        
        git add package.json package-lock.json
        git commit -m "Release v$version"
        git tag -a "v$version" -m "Release v$version"
        Write-Success "Created commit and tag for v$version"
        return $true
    } catch {
        Write-Error "Failed to commit changes: $($_.Exception.Message)"
        return $false
    }
}

# Function to push changes
function Push-Changes {
    param([string]$version)
    
    Write-Step "Pushing changes to remote..."
    
    if ($DryRun) {
        Write-Info "DRY RUN: Would push commits and tags to origin"
        return $true
    }
    
    try {
        git push origin main
        git push origin "v$version"
        Write-Success "Pushed changes and tags to remote"
        return $true
    } catch {
        Write-Error "Failed to push changes: $($_.Exception.Message)"
        return $false
    }
}

# Function to create GitHub release
function Create-GitHubRelease {
    param([string]$version)
    
    Write-Step "Creating GitHub release..."
    
    # Look for the correct portable executable in the make directory
    $portableExePath = "out\make\BumbleGum-Guitars-Configurator-v$version-portable.exe"
    
    if (Test-Path $portableExePath) {
        $exePath = $portableExePath
        Write-Success "Found portable executable at: $exePath"
    } else {
        Write-Warning "Portable executable not found at $portableExePath"
        Write-Info "Checking for alternative portable executables..."
        
        # Look for any portable executable in the make directory
        $possiblePaths = @(
            "out\make\BumbleGum-Guitars-Configurator-*-portable.exe",
            "out\make\BumbleGum-Guitars-Configurator.exe"
        )
        
        $foundPath = $null
        foreach ($pattern in $possiblePaths) {
            $found = Get-ChildItem $pattern -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if ($found) {
                $foundPath = $found.FullName
                break
            }
        }
        
        if ($foundPath) {
            $exePath = $foundPath
            Write-Success "Found portable executable at: $exePath"
        } else {
            Write-Error "Could not find portable BGG Configurator executable in out\make directory"
            Write-Warning "Available files in out\make:"
            Get-ChildItem "out\make\*.exe" -ErrorAction SilentlyContinue | ForEach-Object { 
                $sizeKB = [math]::Round($_.Length/1KB,0)
                Write-Info "  $($_.Name) ($sizeKB KB)"
            }
            return $false
        }
    }
    
    # Show file size for verification
    $fileSize = [math]::Round((Get-Item $exePath).Length/1MB,2)
    Write-Info "Executable size: $fileSize MB"
    
    if ($fileSize -gt 100) {
        Write-Warning "Executable size is unusually large ($fileSize MB). Expected ~67MB for portable version."
        if (-not $DryRun) {
            $continue = Read-Host "Continue anyway? (y/N)"
            if ($continue -ne 'y' -and $continue -ne 'Y') {
                Write-Info "Upload cancelled due to file size concern"
                return $false
            }
        }
    }
    
    if ($DryRun) {
        Write-Info "DRY RUN: Would create GitHub release v$version with executable: BumbleGum-Guitars-Configurator.exe (from $exePath)"
        return $true
    }
    
    # Check if GitHub CLI is available
    try {
        gh --version | Out-Null
    } catch {
        Write-Warning "GitHub CLI not available. Manual steps required:"
        Write-Info "1. Go to: https://github.com/wattsy74/BumbleGum-Guitars-Configurator/releases/new"
        Write-Info "2. Tag: v$version"
        Write-Info "3. Title: BGG Configurator v$version"
        Write-Info "4. Upload: $exePath"
        Write-Info "5. Mark as latest release"
        return $true
    }
    
    try {
        # Check if release already exists
        $existingRelease = gh release view "v$version" 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Warning "GitHub release v$version already exists"
            
            if ($ExistingReleaseAction -eq "Update") {
                $action = "U"
            } elseif ($ExistingReleaseAction -eq "Recreate") {
                $action = "D"
            } elseif ($ExistingReleaseAction -eq "Skip") {
                $action = "S"
            } else {
                $action = Read-Host "Choose action: (U)pdate existing release, (D)elete and recreate, (S)kip release creation"
            }
            
            switch ($action.ToUpper()) {
                'U' {
                    Write-Info "Updating existing release v$version..."
                    # Create a copy with a clean name for GitHub release
                    $cleanFileName = "BumbleGum-Guitars-Configurator.exe"
                    $renamedExePath = Join-Path (Get-Location) $cleanFileName
                    Copy-Item $exePath $renamedExePath -Force
                    
                    # Upload new file (this will replace existing file)
                    gh release upload "v$version" $renamedExePath --clobber
                    
                    # Clean up temporary file
                    Remove-Item $renamedExePath -Force
                    
                    Write-Success "Updated GitHub release v$version with new executable ($fileSize MB)"
                    return $true
                }
                'D' {
                    Write-Info "Deleting and recreating release v$version..."
                    gh release delete "v$version" --yes
                    # Continue to create new release below
                }
                'S' {
                    Write-Info "Skipping GitHub release creation"
                    return $true
                }
                default {
                    Write-Info "Invalid choice. Skipping release creation."
                    return $true
                }
            }
        }
        
        # Create a copy with a clean name for GitHub release
        $cleanFileName = "BumbleGum-Guitars-Configurator.exe"
        $renamedExePath = Join-Path (Get-Location) $cleanFileName
        Copy-Item $exePath $renamedExePath -Force
        
        Write-Info "Created release copy: $cleanFileName ($(([math]::Round((Get-Item $renamedExePath).Length/1MB,2))) MB)"
        
        # Generate release notes
        $releaseNotes = @"
# BGG Configurator v$version

## Changes
- Bug fixes and improvements
- Updated to version $version

## Installation
Download the **BumbleGum-Guitars-Configurator.exe** file below and run it. 

✅ **Portable Application** - No installation required!  
✅ **Single File** - Just download and run  
✅ **Auto-Update** - The app will check for updates automatically  

## System Requirements
- Windows 10/11 (64-bit)
- No additional software required

## Auto-Update
If you have a previous version, the app will automatically detect this new version and prompt you to upgrade.
"@
        
        # Create the release first without assets
        gh release create "v$version" --title "BGG Configurator v$version" --notes $releaseNotes --latest
        
        # Then upload the portable executable
        gh release upload "v$version" $renamedExePath --clobber
        
        # Clean up temporary file
        Remove-Item $renamedExePath -Force
        
        Write-Success "Created GitHub release v$version with portable executable ($fileSize MB)"
        return $true
    } catch {
        Write-Error "Failed to create GitHub release: $($_.Exception.Message)"
        Write-Info "You can manually create the release at: https://github.com/wattsy74/BumbleGum-Guitars-Configurator/releases/new"
        Write-Info "Upload file: $exePath"
        return $false
    }
}

# Function to display summary
function Show-Summary {
    param([string]$version, [bool]$success)
    
    Write-Host "`n" -NoNewline
    Write-Host "=" * 50 -ForegroundColor Blue
    if ($DryRun) {
        Write-Host "DRY RUN SUMMARY" -ForegroundColor Blue
    } else {
        Write-Host "RELEASE SUMMARY" -ForegroundColor Blue
    }
    Write-Host "=" * 50 -ForegroundColor Blue
    
    if ($success) {
        Write-Success "Release v$version completed successfully!"
        if (-not $DryRun) {
            Write-Info "The new version is now available:"
            Write-Info "- GitHub: https://github.com/YourUsername/BGG-Windows-App/releases/tag/v$version"
            Write-Info "- The app's auto-updater will notify users of the new version"
        }
    } else {
        Write-Error "Release process failed"
        Write-Info "Please check the errors above and try again"
    }
    
    Write-Host "=" * 50 -ForegroundColor Blue
}

# Main execution
Write-Step "BGG Configurator Release Script"

# Determine which mode we're in
if ($Version) {
    Write-Info "Manual version mode: $Version"
} else {
    Write-Info "Auto-increment mode: $VersionType"
}

if ($DryRun) {
    Write-Warning "DRY RUN MODE - No changes will be made"
}

# Validate prerequisites
if (-not (Test-Prerequisites)) {
    Write-Error "Prerequisites validation failed"
    exit 1
}

# Get current and target versions
$currentVersion = Get-CurrentVersion
$targetVersion = Get-TargetVersion -currentVersion $currentVersion -versionType $VersionType -manualVersion $Version

Write-Info "Current version: $currentVersion"
Write-Info "Target version: $targetVersion"

if (-not $DryRun) {
    if ($Version) {
        $confirmation = Read-Host "`nProceed with release v$targetVersion? (y/N)"
    } else {
        $confirmation = Read-Host "`nProceed with $VersionType release v$targetVersion? (y/N)"
    }
    if ($confirmation -ne 'y' -and $confirmation -ne 'Y') {
        Write-Info "Release cancelled by user"
        exit 0
    }
}

# Execute release steps
$success = $true

# Update version (only if different from current)
if ($success) {
    $success = [bool](Update-PackageVersion -newVersion $targetVersion -currentVersion $currentVersion)
}

# Build application
if ($success) {
    $success = [bool](Build-Application)
}

# Commit changes (only if version was updated)
if ($success) {
    if ($targetVersion -eq $currentVersion) {
        Write-Info "Version unchanged - skipping commit step"
    } else {
        $success = [bool](Commit-Changes -version $targetVersion)
    }
}

# Push changes (only if version was updated)
if ($success) {
    if ($targetVersion -eq $currentVersion) {
        Write-Info "Version unchanged - skipping push step"
    } else {
        $success = [bool](Push-Changes -version $targetVersion)
    }
}

# Create GitHub release
if ($success) {
    $success = [bool](Create-GitHubRelease -version $targetVersion)
}

# Show summary
Show-Summary -version $targetVersion -success ([bool]$success)

if ($success) {
    exit 0
} else {
    exit 1
}
