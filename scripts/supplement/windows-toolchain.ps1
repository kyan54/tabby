$ErrorActionPreference='Stop'
$vswhere="${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$install=& $vswhere -latest -requires Microsoft.Component.MSBuild -property installationPath
if (-not $install) { throw 'Visual Studio installation missing' }
$arch=if ($env:ARCH -eq 'arm64') { 'arm64' } else { 'amd64' }
& "$install\Common7\Tools\Launch-VsDevShell.ps1" -Arch $arch -HostArch $arch -SkipAutomaticLocation
if (-not $env:VCINSTALLDIR -or -not $env:VSCMD_VER -or -not $env:WindowsSDKVersion) { throw 'Native developer environment missing' }
$globalRoot=& npm root --global
if ($LASTEXITCODE -ne 0) { throw 'Cannot locate installed node-gyp' }
$gyp=Join-Path $globalRoot 'node-gyp\bin\node-gyp.js'
$version=& node $gyp --version
if ($LASTEXITCODE -ne 0 -or $version -ne 'v13.0.2') { throw 'Expected node-gyp 13.0.2' }
foreach ($key in @('VCINSTALLDIR','VSCMD_VER','WindowsSDKVersion','WindowsSdkDir','VCToolsInstallDir','VCToolsVersion','INCLUDE','LIB','LIBPATH','PATH')) {
 $value=[Environment]::GetEnvironmentVariable($key)
 if ($value) { Add-Content $env:GITHUB_ENV "$key=$value" }
}
Add-Content $env:GITHUB_ENV "npm_config_node_gyp=$gyp"
Add-Content $env:GITHUB_ENV "NODE_PATH=$globalRoot"
Write-Output "Native VS $env:VSCMD_VER, SDK $env:WindowsSDKVersion, node-gyp $version"
