# Auto-Updater Testing Script
# Creates test releases to verify the auto-update functionality

param(
    [Parameter(Mandatory=$false)]
    [switch]$CreateTestRelease = $false,
    
    [Parameter(Mandatory=$false)]
    [switch]$TestUpdateCheck = $false,
    
    [Parameter(Mandatory=$false)]
    [string]$TestVersion = ""
)

# Configuration
$ProjectRoot = $PSScriptRoot
$PackageJsonPath = Join-Path $ProjectRoot "package.json"

# Colors for output
function Write-Success { param($Message) Write-Host "✅ $Message" -ForegroundColor Green }
function Write-Info { param($Message) Write-Host "ℹ️  $Message" -ForegroundColor Cyan }
function Write-Warning { param($Message) Write-Host "⚠️  $Message" -ForegroundColor Yellow }
function Write-Error { param($Message) Write-Host "❌ $Message" -ForegroundColor Red }
function Write-Step { param($Message) Write-Host "`n🔧 $Message" -ForegroundColor Blue }

# Function to get current version
function Get-CurrentVersion {
    $packageJson = Get-Content $PackageJsonPath -Raw | ConvertFrom-Json
    return $packageJson.version
}

# Function to test update checker API
function Test-UpdateAPI {
    Write-Step "Testing Auto-Updater API..."
    
    $repoUrl = "https://api.github.com/repos/wattsy74/BumbleGum-Guitars-Configuator-and-Firmware/releases/latest"
    
    try {
        Write-Info "Fetching latest release from: $repoUrl"
        $response = Invoke-RestMethod -Uri $repoUrl -Method Get
        
        Write-Success "API Response received successfully"
        Write-Info "Latest version: $($response.tag_name)"
        Write-Info "Published: $($response.published_at)"
        Write-Info "Assets count: $($response.assets.Count)"
        
        # Check for portable executable
        $portableAsset = $response.assets | Where-Object { $_.name -like "*portable*.exe" }
        if ($portableAsset) {
            Write-Success "Portable executable found: $($portableAsset.name)"
            Write-Info "Download URL: $($portableAsset.browser_download_url)"
            Write-Info "File size: $([math]::Round($portableAsset.size / 1MB, 2)) MB"
        }
        else {
            Write-Warning "No portable executable found in release assets"
        }
        
        # Test version comparison
        $currentVersion = Get-CurrentVersion
        Write-Info "Current app version: $currentVersion"
        
        $latestVersion = $response.tag_name -replace '^v', ''
        Write-Info "Latest release version: $latestVersion"
        
        if ($latestVersion -eq $currentVersion) {
            Write-Info "✓ Versions match - no update needed"
        }
        elseif ([version]$latestVersion -gt [version]$currentVersion) {
            Write-Success "✓ Update available: $currentVersion → $latestVersion"
        }
        else {
            Write-Warning "Current version is newer than latest release"
        }
    }
    catch {
        Write-Error "API test failed: $_"
        
        if ($_.Exception.Response.StatusCode -eq 404) {
            Write-Warning "Repository not found or no releases available"
            Write-Info "Make sure you've created at least one release in the repository"
        }
    }
}

# Function to create a test release
function New-TestRelease {
    param([string]$Version)
    
    Write-Step "Creating test release for auto-updater..."
    
    if (-not $Version) {
        $currentVersion = Get-CurrentVersion
        $versionParts = $currentVersion.Split('.')
        $patch = [int]$versionParts[2] + 1
        $Version = "$($versionParts[0]).$($versionParts[1]).$patch"
    }
    
    Write-Info "Test version: $Version"
    
    # Create a minimal test executable (just copy the current one)
    $testExeName = "BumbleGum-Guitars-Configurator-v$Version-portable.exe"
    $currentExe = Get-ChildItem "out\make\*.exe" | Where-Object { $_.Name -like "*portable*" } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    
    if ($currentExe) {
        $testExePath = Join-Path $env:TEMP $testExeName
        Copy-Item $currentExe.FullName $testExePath
        Write-Success "Test executable created: $testExePath"
        
        # Instructions for manual release creation
        Write-Info "To complete the test:"
        Write-Info "1. Go to: https://github.com/wattsy74/BumbleGum-Guitars-Configuator-and-Firmware/releases"
        Write-Info "2. Create a new release with tag: v$Version"
        Write-Info "3. Upload the test executable: $testExePath"
        Write-Info "4. Publish the release"
        Write-Info "5. Run the current app and test 'Check for App Updates'"
    }
    else {
        Write-Error "No portable executable found. Please run 'npm run make' first."
    }
}

# Function to simulate update check
function Test-UpdateChecker {
    Write-Step "Simulating auto-updater check..."
    
    # This would be the JavaScript equivalent of what the auto-updater does
    $jsCode = @"
// Auto-updater test simulation
const currentVersion = '$((Get-CurrentVersion))';
const repoUrl = 'https://api.github.com/repos/wattsy74/BumbleGum-Guitars-Configuator-and-Firmware/releases/latest';

console.log('Current version:', currentVersion);
console.log('Checking:', repoUrl);

fetch(repoUrl)
  .then(response => {
    if (!response.ok) {
      throw new Error('GitHub API request failed: ' + response.status);
    }
    return response.json();
  })
  .then(release => {
    const latestVersion = release.tag_name.replace(/^v/, '');
    console.log('Latest version:', latestVersion);
    
    const portableAsset = release.assets.find(asset => 
      asset.name.includes('portable') && asset.name.endsWith('.exe')
    );
    
    if (portableAsset) {
      console.log('✅ Portable executable found:', portableAsset.name);
      console.log('📦 Download URL:', portableAsset.browser_download_url);
      console.log('📏 Size:', Math.round(portableAsset.size / 1024 / 1024 * 100) / 100, 'MB');
    } else {
      console.log('❌ No portable executable found');
    }
  })
  .catch(error => {
    console.error('❌ Update check failed:', error.message);
  });
"@
    
    $jsFile = Join-Path $env:TEMP "test-updater.js"
    Set-Content $jsFile $jsCode
    
    Write-Info "Testing update check with Node.js..."
    try {
        & node $jsFile
    }
    catch {
        Write-Warning "Node.js test failed. Testing with PowerShell instead..."
        Test-UpdateAPI
    }
    
    Remove-Item $jsFile -Force -ErrorAction SilentlyContinue
}

# Main execution
Write-Host @"
╔══════════════════════════════════════════════════════════════╗
║              BGG Configurator Auto-Updater Tester           ║
║                                                              ║
║  This script helps test the auto-update functionality       ║
╚══════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Magenta

if ($CreateTestRelease) {
    New-TestRelease -Version $TestVersion
}
elseif ($TestUpdateCheck) {
    Test-UpdateChecker
}
else {
    # Default: Test the API
    Test-UpdateAPI
    
    Write-Host "`n" -NoNewline
    Write-Info "Available options:"
    Write-Info "  -TestUpdateCheck     : Simulate the update checking process"
    Write-Info "  -CreateTestRelease   : Create a test release for testing"
    Write-Info "  -TestVersion 'x.y.z' : Specify version for test release"
    
    Write-Host "`nExamples:" -ForegroundColor Yellow
    Write-Host "  .\test-updater.ps1 -TestUpdateCheck"
    Write-Host "  .\test-updater.ps1 -CreateTestRelease -TestVersion '3.9.17'"
}
