[CmdletBinding()]
param(
    [ValidateSet("major", "minor", "patch")]
    [string]$VersionType = "patch",
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
    param([string]$newVersion)
    
    Write-Step "Updating package.json version to $newVersion..."
    
    if ($DryRun) {
        Write-Info "DRY RUN: Would update package.json version to $newVersion"
        return $true
    }
    
    try {
        npm version $newVersion --no-git-tag-version | Out-Null
        Write-Success "Updated package.json to version $newVersion"
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
    
    # Check if executable exists
    $exePath = "out\BumbleGum Guitars Configurator-win32-x64\BumbleGum Guitars Configurator.exe"
    if (-not (Test-Path $exePath)) {
        Write-Warning "Executable not found at $exePath"
        Write-Info "Checking for alternative paths..."
        
        # Look for the executable in different possible locations
        $possiblePaths = @(
            "out\*\*.exe",
            "out\BumbleGum Guitars Configurator-win32-x64\BumbleGum Guitars Configurator.exe",
            "out\BGG Configurator-win32-x64\BGG Configurator.exe",
            "out\make\squirrel.windows\*\*.exe",
            "dist\*\*.exe"
        )
        
        $foundPath = $null
        foreach ($pattern in $possiblePaths) {
            $found = Get-ChildItem $pattern -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($found) {
                $foundPath = $found.FullName
                break
            }
        }
        
        if ($foundPath) {
            $exePath = $foundPath
            Write-Success "Found executable at: $exePath"
        } else {
            Write-Error "Could not find BGG Configurator.exe"
            return $false
        }
    }
    
    if ($DryRun) {
        Write-Info "DRY RUN: Would create GitHub release v$version with executable: $exePath"
        return $true
    }
    
    # Check if GitHub CLI is available
    try {
        gh --version | Out-Null
    } catch {
        Write-Warning "GitHub CLI not available. Manual steps required:"
        Write-Info "1. Go to: https://github.com/YourUsername/BGG-Windows-App/releases/new"
        Write-Info "2. Tag: v$version"
        Write-Info "3. Title: BGG Configurator v$version"
        Write-Info "4. Upload: $exePath"
        Write-Info "5. Mark as latest release"
        return $true
    }
    
    try {
        # Generate release notes
        $releaseNotes = @"
# BGG Configurator v$version

## Changes
- Bug fixes and improvements
- Updated to version $version

## Installation
Download the BGG Configurator.exe file below and run it. No installation required - it's a portable executable.

## Auto-Update
If you have a previous version installed, the app will automatically check for updates and prompt you to upgrade.
"@
        
        # Create the release
        gh release create "v$version" $exePath --title "BGG Configurator v$version" --notes $releaseNotes --latest
        
        Write-Success "Created GitHub release v$version with executable"
        return $true
    } catch {
        Write-Error "Failed to create GitHub release: $($_.Exception.Message)"
        Write-Info "You can manually create the release at: https://github.com/YourUsername/BGG-Windows-App/releases/new"
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
Write-Info "Version type: $VersionType"
if ($DryRun) {
    Write-Warning "DRY RUN MODE - No changes will be made"
}

# Validate prerequisites
if (-not (Test-Prerequisites)) {
    Write-Error "Prerequisites validation failed"
    exit 1
}

# Get current and new versions
$currentVersion = Get-CurrentVersion
$newVersion = Get-NewVersion -currentVersion $currentVersion -versionType $VersionType

Write-Info "Current version: $currentVersion"
Write-Info "New version: $newVersion"

if (-not $DryRun) {
    $confirmation = Read-Host "`nProceed with release? (y/N)"
    if ($confirmation -ne 'y' -and $confirmation -ne 'Y') {
        Write-Info "Release cancelled by user"
        exit 0
    }
}

# Execute release steps
$success = $true

# Update version
if ($success) {
    $success = Update-PackageVersion -newVersion $newVersion
}

# Build application
if ($success) {
    $success = Build-Application
}

# Commit changes
if ($success) {
    $success = Commit-Changes -version $newVersion
}

# Push changes
if ($success) {
    $success = Push-Changes -version $newVersion
}

# Create GitHub release
if ($success) {
    $success = Create-GitHubRelease -version $newVersion
}

# Show summary
Show-Summary -version $newVersion -success $success

if ($success) {
    exit 0
} else {
    exit 1
}
