# Never use this on a developer's PC: NSIS writes the real HKCU and shell folders, not mocked env paths.
param([string]$Dist = (Join-Path $PSScriptRoot '../dist'))
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:OS -ne 'Windows_NT') {
    throw 'Installer smoke is restricted to disposable GitHub-hosted Windows runners'
}
$registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
function Get-AgentShotEntries {
    @(Get-ChildItem $registry -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.DisplayName -match '^AgentShot(?:\s|$)' })
}
if ((Get-AgentShotEntries).Count -ne 0) { throw 'Refusing to touch an existing AgentShot installation' }
$installers = @(Get-ChildItem -LiteralPath $Dist -Filter 'AgentShot-*-windows-x64-Setup.exe')
if ($installers.Count -ne 1) { throw 'Expected exactly one Windows x64 installer' }
$tmp = Join-Path $env:RUNNER_TEMP ('agentshot installer ' + [guid]::NewGuid())
$installDir = Join-Path $tmp 'app'
New-Item -ItemType Directory -Path $tmp | Out-Null
$oldExe = $env:MANUL_PACKAGED_EXE
$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'AgentShot.lnk'
$startLink = Join-Path ([Environment]::GetFolderPath('Programs')) 'AgentShot.lnk'
if ((Test-Path -LiteralPath $desktopLink) -or (Test-Path -LiteralPath $startLink)) { throw 'Refusing to overwrite existing AgentShot shortcuts' }
try {
    # One-click uses setInstallModePerUser/GetDParameter too. /D must be last and unquoted.
    # /S suppresses runAfterFinish; normal interactive installation launches the app.
    $p = Start-Process -FilePath $installers[0].FullName -ArgumentList @('/S', '/currentuser', "/D=$installDir") -PassThru
    if (!$p.WaitForExit(180000)) { $p.Kill(); throw 'Installer timed out' }
    if ($p.ExitCode -ne 0) { throw "Installer exited $($p.ExitCode)" }
    $env:MANUL_PACKAGED_EXE = Join-Path $installDir 'AgentShot.exe'
    if (!(Test-Path -LiteralPath $env:MANUL_PACKAGED_EXE)) { throw 'Installer did not create AgentShot.exe in the requested path' }
    if ((Get-AgentShotEntries).Count -ne 1) { throw 'Expected one per-user uninstall entry' }
    $shell = New-Object -ComObject WScript.Shell
    foreach ($link in @($desktopLink, $startLink)) {
        if (!(Test-Path -LiteralPath $link)) { throw "Installer did not create shortcut $link" }
        if ($shell.CreateShortcut($link).TargetPath -ine $env:MANUL_PACKAGED_EXE) { throw "Wrong shortcut target: $link" }
    }
    & node (Join-Path $PSScriptRoot 'check-whisper-manifest.mjs') (Join-Path $installDir 'resources/bin/whisper-cli.exe')
    if ($LASTEXITCODE -ne 0) { throw 'Installed whisper UTF-8 manifest verification failed' }
    & node (Join-Path $PSScriptRoot '../test/e2e/packaged.e2e.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Installed packaged app E2E failed' }
} finally {
    $env:MANUL_PACKAGED_EXE = $oldExe
    $uninstaller = Join-Path $installDir 'Uninstall AgentShot.exe'
    if (Test-Path -LiteralPath $uninstaller) {
        # _?= avoids the detached temporary uninstaller so we can wait for it in CI.
        $p = Start-Process -FilePath $uninstaller -ArgumentList @('/S', "_?=$installDir") -PassThru
        if (!$p.WaitForExit(180000)) { $p.Kill(); throw 'Uninstaller timed out' }
        if ($p.ExitCode -ne 0) { throw "Uninstaller exited $($p.ExitCode)" }
        if (Test-Path -LiteralPath (Join-Path $installDir 'AgentShot.exe')) { throw 'Uninstaller left AgentShot.exe behind' }
        if ((Get-AgentShotEntries).Count -ne 0) { throw 'Uninstaller left a per-user registry entry behind' }
        foreach ($link in @($desktopLink, $startLink)) {
            if (Test-Path -LiteralPath $link) { throw "Uninstaller left shortcut $link behind" }
        }
    } else {
        throw 'Uninstaller missing; installer smoke incomplete'
    }
    Remove-Item -LiteralPath $tmp -Recurse -Force
}
Write-Output 'Per-user NSIS install, packaged app and uninstall: ok'
