# Build-time SDK only. End-user Vulkan loaders come from their GPU drivers.
$ErrorActionPreference = 'Stop'
$version = '1.4.363.1'
$installer = Join-Path $env:RUNNER_TEMP 'vulkan-sdk.exe'
Invoke-WebRequest "https://sdk.lunarg.com/sdk/download/$version/windows/vulkansdk-windows-X64-$version.exe" -OutFile $installer
$sig = Get-AuthenticodeSignature $installer
if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'LunarG') { throw 'Invalid Vulkan SDK signature' }
$install = Start-Process $installer -ArgumentList '--root', 'C:\VulkanSDK', '--accept-licenses', '--default-answer', '--confirm-command', 'install' -Wait -PassThru
if ($install.ExitCode -ne 0) { throw 'Vulkan SDK installation failed' }
'VULKAN_SDK=C:\VulkanSDK' | Out-File -FilePath $env:GITHUB_ENV -Append
'C:\VulkanSDK\Bin' | Out-File -FilePath $env:GITHUB_PATH -Append
