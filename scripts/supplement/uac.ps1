$ErrorActionPreference='Stop'
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$install = & $vswhere -latest -requires Microsoft.Component.MSBuild -property installationPath
$version = & $vswhere -latest -requires Microsoft.Component.MSBuild -property installationVersion
$msbuild = & $vswhere -latest -requires Microsoft.Component.MSBuild -find MSBuild\**\Bin\MSBuild.exe | Select-Object -First 1
if (-not $install -or -not $msbuild) { throw 'Installed MSBuild not found' }
$major=[int]($version.Split('.')[0])
if ($major -eq 18) { $toolset='v145' } elseif ($major -eq 17) { $toolset='v143' } else { throw "Unsupported installed VS major $major" }
$platform=if ($env:ARCH -eq 'arm64') { 'ARM64' } else { 'x64' }
# Derive only build configuration in a temporary copy; all C++ source bytes stay
# identical to the frozen checkout. The ARM runner need not have x64 VC targets.
$temp=Join-Path $env:RUNNER_TEMP ('tabby-uac-'+[guid]::NewGuid())
Copy-Item tabby-uac $temp -Recurse
if ($platform -eq 'ARM64') {
 foreach ($f in Get-ChildItem $temp -Recurse -Include *.sln,*.vcxproj) {
  [IO.File]::WriteAllText($f.FullName,([IO.File]::ReadAllText($f.FullName).Replace('x64','ARM64')))
 }
}
Write-Output "Using installed VS $major / $toolset / $platform"
& $msbuild "$temp\UAC.sln" /p:Configuration=Release /p:Platform=$platform /p:PlatformToolset=$toolset /p:WindowsTargetPlatformVersion=10.0 /verbosity:minimal
if ($LASTEXITCODE -ne 0) { throw 'UAC build failed' }
$built=Get-ChildItem $temp -Recurse -Filter UAC.exe | Where-Object { $_.FullName -match '\\Release\\' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $built) { throw 'UAC.exe not found' }
Copy-Item $built.FullName extras\UAC.exe -Force
