@echo off
REM Quick Release Script for BGG Configurator
REM Usage: quick-release.bat [patch|minor|major]

setlocal

if "%1"=="" (
    echo Usage: quick-release.bat [patch^|minor^|major]
    echo.
    echo Examples:
    echo   quick-release.bat patch    ^(3.9.16 -^> 3.9.17^)
    echo   quick-release.bat minor    ^(3.9.16 -^> 3.10.0^)
    echo   quick-release.bat major    ^(3.9.16 -^> 4.0.0^)
    exit /b 1
)

set VERSION_TYPE=%1

echo.
echo ======================================================
echo  BGG Configurator Quick Release - %VERSION_TYPE% version
echo ======================================================
echo.

REM Execute the PowerShell release script
powershell -ExecutionPolicy Bypass -File "%~dp0release.ps1" -VersionType %VERSION_TYPE%

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ======================================================
    echo  Release completed successfully! 🎉
    echo ======================================================
) else (
    echo.
    echo ======================================================
    echo  Release failed! ❌
    echo ======================================================
    exit /b 1
)

pause
