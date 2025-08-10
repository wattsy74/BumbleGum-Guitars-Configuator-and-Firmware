# BGG Configurator Auto-Release Script
# Automates the entire release process: version bump, build, tag, and GitHub release

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("patch", "minor", "major")]
    [string]$VersionType,
    
    [Parameter(Mandatory=$false)]
    [string]$ReleaseNotes = "",
    
    [Parameter(Mandatory=$false)]
    [switch]$DryRun = $false
)

# Configuration
$ProjectRoot = $PSScriptRoot
$PackageJsonPath = Join-Path $ProjectRoot "package.json"
$OutPath = Join-Path $ProjectRoot "out\make"

# Colors for output
function Write-Success { param($Message) Write-Host "✅ $Message" -ForegroundColor Green }
function Write-Info { param($Message) Write-Host "ℹ️  $Message" -ForegroundColor Cyan }
function Write-Warning { param($Message) Write-Host "⚠️  $Message" -ForegroundColor Yellow }
function Write-Error { param($Message) Write-Host "❌ $Message" -ForegroundColor Red }
function Write-Step { param($Message) Write-Host "`n🚀 $Message" -ForegroundColor Blue }

# Function to validate prerequisites
function Test-Prerequisites {
    Write-Step "Validating prerequisites..."
    
    # Check if we're in a git repository
    if (-not (Test-Path ".git")) {
        Write-Error "Not in a git repository"
        exit 1
    }
    
    # Check if npm is available
    $npmExists = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npmExists) {
        Write-Error "npm not found. Please install Node.js"
        exit 1
    }
    
    # Check if package.json exists
    if (-not (Test-Path $PackageJsonPath)) {
        Write-Error "package.json not found"
        exit 1
    }
    
    # Check for uncommitted changes
    $gitStatus = & git status --porcelain
    if ($gitStatus -and -not $DryRun) {
        Write-Warning "Uncommitted changes detected:"
        Write-Host $gitStatus
        $response = Read-Host "Continue anyway? (y/N)"
        if ($response -ne 'y' -and $response -ne 'Y') {
            Write-Info "Aborted by user"
            exit 0
        }
    }
    
    Write-Success "Prerequisites validated"
}

# Function to get current version from package.json
function Get-CurrentVersion {
    try {
        $packageJson = Get-Content $PackageJsonPath -Raw | ConvertFrom-Json
        return $packageJson.version
    }
    catch {
        Write-Error "Failed to read current version from package.json: $_"
        exit 1
    }
}

# Function to calculate new version
function Get-NewVersion {
    param([string]$CurrentVersion, [string]$BumpType)
    
    $versionParts = $CurrentVersion.Split('.')
    $major = [int]$versionParts[0]
    $minor = [int]$versionParts[1]
    $patch = [int]$versionParts[2]
    
    switch ($BumpType) {
        "patch" { $patch++ }
        "minor" { $minor++; $patch = 0 }
        "major" { $major++; $minor = 0; $patch = 0 }
    }
    
    return "$major.$minor.$patch"
}

# Function to update package.json version
function Update-PackageVersion {
    param([string]$NewVersion)
    
    try {
        $packageContent = Get-Content $PackageJsonPath -Raw
        $packageContent = $packageContent -replace '"version":\s*"[^"]*"', "`"version`": `"$NewVersion`""
        Set-Content $PackageJsonPath -Value $packageContent -NoNewline
        Write-Success "Updated package.json version to $NewVersion"
    }
    catch {
        Write-Error "Failed to update package.json: $_"
        exit 1
    }
}

# Function to build the application
function Build-Application {
    Write-Step "Building application..."
    
    try {
        $buildResult = & npm run make 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Build failed: $buildResult"
            exit 1
        }
        Write-Success "Application built successfully"
    }
    catch {
        Write-Error "Build process failed: $_"
        exit 1
    }
}

# Function to find the portable executable
function Get-PortableExecutable {
    param([string]$Version)
    
    $expectedName = "BumbleGum-Guitars-Configurator-v$Version-portable.exe"
    $portableExe = Join-Path $OutPath $expectedName
    
    if (Test-Path $portableExe) {
        return $portableExe
    }
    else {
        Write-Error "Portable executable not found: $portableExe"
        exit 1
    }
}

# Function to commit and tag
function Commit-AndTag {
    param([string]$Version)
    
    Write-Step "Committing changes and creating tag..."
    
    try {
        # Add package.json changes
        & git add package.json
        if ($LASTEXITCODE -ne 0) { throw "Git add failed" }
        
        # Commit changes
        & git commit -m "Release v$Version - Automated release process"
        if ($LASTEXITCODE -ne 0) { throw "Git commit failed" }
        
        # Create tag
        & git tag "v$Version"
        if ($LASTEXITCODE -ne 0) { throw "Git tag failed" }
        
        # Push changes and tag
        & git push
        if ($LASTEXITCODE -ne 0) { throw "Git push failed" }
        
        & git push origin "v$Version"
        if ($LASTEXITCODE -ne 0) { throw "Git push tag failed" }
        
        Write-Success "Committed changes and created tag v$Version"
    }
    catch {
        Write-Error "Git operations failed: $_"
        exit 1
    }
}

# Function to generate release notes
function Generate-ReleaseNotes {
    param([string]$Version, [string]$CustomNotes)
    
    if ($CustomNotes) {
        return $CustomNotes
    }
    
    # Generate default release notes
    $releaseNotes = @"
## 🚀 BGG Configurator v$Version

### Features & Improvements
- Latest firmware updates and device compatibility
- Enhanced LED indicators for serial operations
- Improved auto-update system
- Bug fixes and performance improvements

### Auto-Update System
- Automatic update checking on startup
- Manual update check via config menu
- Secure download and installation process
- Progress tracking with visual indicators

### Installation
Download the portable executable below - no installation required!
Simply run the .exe file directly.

### Compatibility
- All BGG Guitar Controller models
- Windows 10/11 (x64)
- No additional dependencies required

---
**For technical support, visit our documentation or create an issue on GitHub.**
"@
    
    return $releaseNotes
}

# Function to create GitHub release
function Create-GitHubRelease {
    param([string]$Version, [string]$PortableExePath, [string]$ReleaseNotes)
    
    Write-Step "Creating GitHub release..."
    
    # Check if GitHub CLI is available
    $ghExists = Get-Command gh -ErrorAction SilentlyContinue
    if (-not $ghExists) {
        Write-Warning "GitHub CLI (gh) not found. Please install it from: https://cli.github.com/"
        Write-Info "You can create the release manually at: https://github.com/wattsy74/BumbleGum-Guitars-Configuator-and-Firmware/releases"
        Write-Info "Tag: v$Version"
        Write-Info "Binary: $PortableExePath"
        return
    }
    
    try {
        # Create release with GitHub CLI
        $releaseNotesFile = Join-Path $env:TEMP "release-notes-$Version.md"
        Set-Content $releaseNotesFile -Value $ReleaseNotes
        
        $releaseTitle = "BGG Configurator v$Version"
        
        & gh release create "v$Version" `
            --title $releaseTitle `
            --notes-file $releaseNotesFile `
            $PortableExePath
            
        if ($LASTEXITCODE -eq 0) {
            Write-Success "GitHub release created successfully!"
            Write-Info "Release URL: https://github.com/wattsy74/BumbleGum-Guitars-Configuator-and-Firmware/releases/tag/v$Version"
        }
        else {
            Write-Error "Failed to create GitHub release"
        }
        
        # Clean up temp file
        Remove-Item $releaseNotesFile -Force -ErrorAction SilentlyContinue
    }
    catch {
        Write-Error "Failed to create GitHub release: $_"
        Write-Info "You can create the release manually at: https://github.com/wattsy74/BumbleGum-Guitars-Configuator-and-Firmware/releases"
    }
}

# Main execution
function Main {
    Write-Host @"
╔══════════════════════════════════════════════════════════════╗
║                BGG Configurator Release Automation          ║
║                                                              ║
║  This script automates the complete release process:        ║
║  • Version bump ($VersionType)                                       ║
║  • Application build                                         ║
║  • Git commit and tagging                                    ║
║  • GitHub release creation                                   ║
╚══════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Magenta
    
    if ($DryRun) {
        Write-Warning "DRY RUN MODE - No changes will be made"
    }
    
    # Validate prerequisites
    Test-Prerequisites
    
    # Get current and new version
    $currentVersion = Get-CurrentVersion
    $newVersion = Get-NewVersion -CurrentVersion $currentVersion -BumpType $VersionType
    
    Write-Info "Current version: $currentVersion"
    Write-Info "New version: $newVersion"
    
    if (-not $DryRun) {
        $confirmation = Read-Host "`nProceed with release? (y/N)"
        if ($confirmation -ne 'y' -and $confirmation -ne 'Y') {
            Write-Info "Release cancelled by user"
            exit 0
        }
    }
    
    if ($DryRun) {
        Write-Info "DRY RUN: Would update version to $newVersion"
        Write-Info "DRY RUN: Would build application"
        Write-Info "DRY RUN: Would commit and tag v$newVersion"
        Write-Info "DRY RUN: Would create GitHub release"
        exit 0
    }
    
    # Execute release process
    Update-PackageVersion -NewVersion $newVersion
    Build-Application
    
    $portableExe = Get-PortableExecutable -Version $newVersion
    Write-Success "Portable executable ready: $(Split-Path $portableExe -Leaf)"
    
    Commit-AndTag -Version $newVersion
    
    $releaseNotes = Generate-ReleaseNotes -Version $newVersion -CustomNotes $ReleaseNotes
    Create-GitHubRelease -Version $newVersion -PortableExePath $portableExe -ReleaseNotes $releaseNotes
    
    Write-Step "Release Process Complete! 🎉"
    Write-Success "Version $newVersion has been released successfully"
    Write-Info "Users with auto-update enabled will be notified automatically"
    Write-Info "Release URL: https://github.com/wattsy74/BumbleGum-Guitars-Configuator-and-Firmware/releases/tag/v$newVersion"
}

# Execute main function
try {
    Main
}
catch {
    Write-Error "Release process failed: $_"
    exit 1
}
