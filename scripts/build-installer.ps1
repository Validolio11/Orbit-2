param([string]$ArchivePath, [string]$OutputPath)
$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$version = (Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') | ConvertFrom-Json).version
if (-not $ArchivePath) { $ArchivePath = Join-Path $projectRoot "release\Orbit2-$version-win32-x64.zip" }
if (-not $OutputPath) { $OutputPath = Join-Path $projectRoot "release\Orbit2-Setup-$version.exe" }
$ArchivePath = [System.IO.Path]::GetFullPath($ArchivePath)
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
if (-not (Test-Path -LiteralPath $ArchivePath)) { throw "Release archive not found: $ArchivePath" }
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compilerPath)) { throw 'The Windows .NET Framework C# compiler was not found.' }
$source = Join-Path $projectRoot 'installer\Setup.cs'
$icon = Join-Path $projectRoot 'assets\orbit.ico'
$references = @('/r:System.IO.Compression.dll', '/r:System.IO.Compression.FileSystem.dll', '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll')
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("orbit-installer-" + [guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $work)
try {
    $uninstaller = Join-Path $work 'Uninstall.exe'
    & $compilerPath /nologo /target:winexe /platform:x64 /optimize+ /define:UNINSTALLER "/win32icon:$icon" @references "/out:$uninstaller" $source
    if ($LASTEXITCODE -ne 0) { throw 'Uninstaller compilation failed.' }
    [void](New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputPath))
    & $compilerPath /nologo /target:winexe /platform:x64 /optimize+ "/win32icon:$icon" @references "/resource:$ArchivePath,Orbit.zip" "/resource:$uninstaller,Uninstall.exe" "/out:$OutputPath" $source
    if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $OutputPath).Hash.ToLowerInvariant()
Write-Output (@{ installer = $OutputPath; size = (Get-Item -LiteralPath $OutputPath).Length; sha256 = $hash } | ConvertTo-Json -Compress)
