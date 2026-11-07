$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compilerPath)) { throw 'The Windows .NET Framework C# compiler was not found.' }
$nativeSources = @((Join-Path $projectRoot 'native\MouseHook.cs'), (Join-Path $projectRoot 'native\AdminTask.cs'))
$nativeOutput = Join-Path $projectRoot 'native\Orbit2.Input.exe'
& $compilerPath /nologo /target:exe /platform:x64 /optimize+ "/out:$nativeOutput" @nativeSources
if ($LASTEXITCODE -ne 0) { throw 'Native mouse helper compilation failed.' }
& $nativeOutput --self-test
if ($LASTEXITCODE -ne 0) { throw 'Native mouse helper self-test failed.' }
