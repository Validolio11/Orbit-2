param([Parameter(Mandatory=$true)][string]$BundlePath, [Parameter(Mandatory=$true)][string]$ArchivePath)
$ErrorActionPreference = 'Stop'
$resolvedBundle = (Resolve-Path -LiteralPath $BundlePath).Path
$resolvedArchive = [System.IO.Path]::GetFullPath($ArchivePath)
if ((Split-Path -Leaf $resolvedBundle) -ne 'Orbit2-win32-x64') { throw 'Unexpected bundle name.' }
if (-not (Test-Path -LiteralPath (Join-Path $resolvedBundle 'Orbit2.exe'))) { throw 'Orbit2.exe missing.' }
if (-not (Test-Path -LiteralPath (Join-Path $resolvedBundle 'orbit-release.json'))) { throw 'Release marker missing.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
if ([IO.File]::Exists($resolvedArchive)) { [IO.File]::Delete($resolvedArchive) }
[IO.Compression.ZipFile]::CreateFromDirectory($resolvedBundle, $resolvedArchive, [IO.Compression.CompressionLevel]::Optimal, $true)
