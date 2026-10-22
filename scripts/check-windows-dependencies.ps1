param([string]$Bin = (Join-Path $PSScriptRoot '../resources/bin/win32-x64'))
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Dependency inspection requires native Windows' }
Get-Command dumpbin -ErrorAction Stop | Out-Null
& node (Join-Path $PSScriptRoot 'check-whisper-manifest.mjs') (Join-Path $Bin 'whisper-cli.exe')
if ($LASTEXITCODE -ne 0) { throw 'Bundled whisper UTF-8 manifest verification failed' }
$runtime = Join-Path $Bin 'vcruntime140.dll'
if (!(Test-Path -LiteralPath $runtime -PathType Leaf)) { throw 'Bundled BrowserSkill VC runtime missing' }
$signature = Get-AuthenticodeSignature -LiteralPath $runtime
# Microsoft ships the redistributable CRT under CN=Microsoft Windows Software
# Compatibility Publisher, O=Microsoft Corporation (and older builds as
# CN=Microsoft Corporation), so match the Organization, not the SimpleName/CN.
$signerSubject = ''
if ($signature.SignerCertificate) { $signerSubject = $signature.SignerCertificate.Subject }
if ($signature.Status -ne 'Valid' -or
    $signerSubject -notmatch '(?:^|,\s*)O=Microsoft Corporation(?:\s*,|$)') {
    throw 'Bundled VCRUNTIME140.dll must have a valid Microsoft signature'
}
foreach ($name in @('ffmpeg.exe', 'ffprobe.exe', 'bsk.exe', 'whisper-cli.exe')) {
    $exe = Join-Path $Bin $name
    if (!(Test-Path -LiteralPath $exe -PathType Leaf)) { throw "Missing $exe" }
    $output = & dumpbin /DEPENDENTS $exe 2>&1
    if ($LASTEXITCODE -ne 0) { throw "dumpbin failed for $exe" }
    Write-Output $output
    $dlls = @($output | ForEach-Object {
        if ($_ -match '^\s+([A-Za-z0-9_.-]+\.dll)\s*$') { $Matches[1] }
    })
    if ($dlls.Count -eq 0) { throw "No PE imports found for $exe" }
    foreach ($dll in $dlls) {
        if ($name -eq 'bsk.exe' -and $dll -ieq 'VCRUNTIME140.dll') {
            if (!(Test-Path -LiteralPath $runtime)) { throw 'BrowserSkill runtime is not bundled' }
            continue
        }
        # A developer runner may have these installed; a clean end-user PC need not.
        if ($dll -match '^(vcruntime|msvcp|concrt|vcomp|libomp|libgcc|libstdc\+\+|libwinpthread|ggml|whisper)') {
            throw "$name requires non-system runtime $dll; use static CRT/no OpenMP or explicitly bundle and audit it"
        }
        if ($dll -notmatch '^(api-ms-win-|ext-ms-win-)' -and
            !(Test-Path -LiteralPath (Join-Path $env:WINDIR "System32/$dll")) -and
            !(Test-Path -LiteralPath (Join-Path $Bin $dll))) {
            throw "$name requires unbundled DLL $dll"
        }
    }
}
# Inspect the redistributable itself as well; it may only import inbox Windows/UCRT APIs.
$output = & dumpbin /DEPENDENTS $runtime 2>&1
if ($LASTEXITCODE -ne 0) { throw 'dumpbin failed for bundled VC runtime' }
Write-Output $output
$runtimeImports = 0
foreach ($line in $output) {
    if ($line -match '^\s+([A-Za-z0-9_.-]+\.dll)\s*$') {
        $runtimeImports++
        $dll = $Matches[1]
        if ($dll -notmatch '^(api-ms-win-|ext-ms-win-)' -and !(Test-Path -LiteralPath (Join-Path $env:WINDIR "System32/$dll"))) {
            throw "Bundled VC runtime requires unbundled DLL $dll"
        }
    }
}
if ($runtimeImports -eq 0) { throw 'No PE imports found for bundled VC runtime' }
Write-Output 'Windows bundled executable dependencies: ok'
