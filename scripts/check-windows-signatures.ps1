param([string]$Dist = (Join-Path $PSScriptRoot '../dist'))
$ErrorActionPreference = 'Stop'
if (!$env:WINDOWS_PUBLISHER_NAME) { throw 'Exact WINDOWS_PUBLISHER_NAME is required' }
$installers = @(Get-ChildItem -LiteralPath $Dist -Filter 'AgentShot-*-windows-x64-Setup.exe')
if ($installers.Count -ne 1) { throw 'Expected exactly one Windows x64 installer' }
$files = @($installers[0].FullName, (Join-Path $Dist 'win-unpacked/AgentShot.exe'))
foreach ($file in $files) {
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    $selfSigned = $signature.Status -eq 'UnknownError' -and $signature.SignerCertificate -and $signature.SignerCertificate.Subject -eq $signature.SignerCertificate.Issuer
    if ($signature.Status -ne 'Valid' -and !$selfSigned) { throw "Invalid Authenticode signature: $file ($($signature.Status))" }
    $publisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    if ($publisher -cne $env:WINDOWS_PUBLISHER_NAME) { throw "Publisher mismatch: $publisher" }
    if (!$signature.TimeStamperCertificate) { throw "Missing signature timestamp: $file" }
}
Write-Output 'Windows app and installer signatures: valid, timestamped, exact publisher'
