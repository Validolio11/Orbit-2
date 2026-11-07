$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$helper = Join-Path $project 'native\Update.ps1'
$psExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$testRoot = Join-Path $tempParent ('Orbit updater tests ' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($testRoot)
$ownedProcesses = New-Object 'System.Collections.Generic.List[object]'

function Assert([bool]$condition, [string]$message) { if (-not $condition) { throw $message } }
function File-Hash([string]$file) {
    $hasher = [Security.Cryptography.SHA256]::Create(); $stream = [IO.File]::OpenRead($file)
    try { return [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $hasher.Dispose() }
}
function Write-Text([string]$file, [string]$text) {
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file))
    [IO.File]::WriteAllText($file, $text, (New-Object Text.UTF8Encoding($false)))
}
function Wait-File([string]$file, $process) {
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while (-not [IO.File]::Exists($file) -and [DateTime]::UtcNow -lt $deadline) {
        if ($process.HasExited) { throw ('Helper exited early: ' + $file) }
        Start-Sleep -Milliseconds 50
    }
    Assert ([IO.File]::Exists($file)) ('Timed out waiting for ' + $file)
}
function Wait-Helper($process, [int]$expected) {
    Assert ($process.WaitForExit(15000)) 'Update helper timed out.'
    $process.Refresh()
    if ($process.ExitCode -ne $expected -and $process.ResultPath) { Get-Content -LiteralPath $process.ResultPath -Raw -ErrorAction SilentlyContinue | Write-Output }
    Assert ($process.ExitCode -eq $expected) ('Unexpected helper exit code: ' + $process.ExitCode)
}
function New-Case([string]$name, [bool]$badSmoke = $false, [string]$markerVersion = '0.2.0', [bool]$traversal = $false) {
    $root = Join-Path $testRoot $name
    $install = Join-Path $root 'Orbit2-win32-x64'
    $token = [Guid]::NewGuid().ToString('N')
    $work = Join-Path $root ('updates\' + $token)
    $source = Join-Path $root 'payload'
    foreach ($directory in @($install, $source)) {
        [void][IO.Directory]::CreateDirectory((Join-Path $directory 'resources\app.asar.unpacked\native'))
        Copy-Item -LiteralPath (Join-Path $testRoot 'Fixture.exe') -Destination (Join-Path $directory 'Orbit2.exe')
        Write-Text (Join-Path $directory 'resources\app.asar') 'fixture asar'
        Write-Text (Join-Path $directory 'resources\app.asar.unpacked\native\Orbit2.Input.exe') 'fixture native'
        Copy-Item -LiteralPath $helper -Destination (Join-Path $directory 'resources\app.asar.unpacked\native\Update.ps1')
    }
    Write-Text (Join-Path $install 'old.txt') 'previous version'
    Write-Text (Join-Path $source 'new.txt') 'new version'
    Write-Text (Join-Path $source 'orbit-release.json') (@{product='com.creationsoft.orbit2';version=$markerVersion;platform='win32';arch='x64'} | ConvertTo-Json -Compress)
    if ($badSmoke) { Write-Text (Join-Path $source 'fail-smoke.txt') 'fail' }
    [void][IO.Directory]::CreateDirectory($work)
    $archive = Join-Path $work 'Orbit2-0.2.0-win32-x64.zip'
    $zip = [IO.Compression.ZipFile]::Open($archive, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in Get-ChildItem -LiteralPath $source -Recurse -File) {
            $relative = $file.FullName.Substring($source.Length + 1).Replace('\','/')
            [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, ('Orbit2-win32-x64/' + $relative))
        }
        if ($traversal) {
            $entry = $zip.CreateEntry('Orbit2-win32-x64/../escaped.txt')
            $stream = New-Object IO.StreamWriter($entry.Open()); $stream.Write('escape'); $stream.Dispose()
        }
    } finally { $zip.Dispose() }
    return @{root=$root;install=$install;stage=(Join-Path $root ('.Orbit2-update-stage-'+$token));backup=(Join-Path $root ('.Orbit2-update-backup-'+$token));work=$work;archive=$archive;sha256=(File-Hash $archive);token=$token}
}
function Helper-Args($case, [string]$mode, [int]$parentProcess = 0, [int]$nativeProcess = 0, [int]$wait = 3) {
    return @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$helper,'-Mode',$mode,'-InstallDir',$case.install,'-StagePath',$case.stage,'-BackupPath',$case.backup,'-ArchivePath',$case.archive,'-WorkDir',$case.work,'-ExpectedVersion','0.2.0','-ExpectedSha256',$case.sha256,'-ParentPid',[string]$parentProcess,'-NativePid',[string]$nativeProcess,'-WaitSeconds',[string]$wait)
}
function Prepare($case, [int]$exitCode = 0) {
    $arguments = Helper-Args $case 'Prepare'
    & $psExe @arguments
    Assert ($LASTEXITCODE -eq $exitCode) ('Unexpected preparation result: ' + $LASTEXITCODE)
}
function Install-Helper($case, [int]$parentProcess, [int]$nativeProcess = 0, [int]$wait = 3) {
    $arguments = Helper-Args $case 'Install' $parentProcess $nativeProcess $wait
    $quotedArguments = @($arguments | ForEach-Object { '"' + $_ + '"' })
    $process = Start-Process -FilePath $psExe -ArgumentList $quotedArguments -WindowStyle Hidden -PassThru
    $process | Add-Member -NotePropertyName ResultPath -NotePropertyValue (Join-Path $case.work 'result.json')
    $ownedProcesses.Add($process)
    Wait-File (Join-Path $case.work 'ready.json') $process
    return $process
}
function Commit($case, [int]$parentProcess) { Write-Text (Join-Path $case.work 'commit.json') (@{token=$case.token;parentPid=$parentProcess}|ConvertTo-Json -Compress) }
function New-Waiter {
    $process = Start-Process -FilePath $psExe -ArgumentList @('-NoProfile','-NonInteractive','-Command','"Start-Sleep -Seconds 30"') -WindowStyle Hidden -PassThru
    $ownedProcesses.Add($process)
    return $process
}

try {
    $fixtureSource = Join-Path $testRoot 'Fixture.cs'
    Write-Text $fixtureSource @'
using System;
using System.IO;
class Fixture {
    static int Main(string[] args) {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        if (Array.IndexOf(args, "--smoke-test") >= 0) {
            if (File.Exists(Path.Combine(root,"fail-smoke.txt"))) return 17;
            Console.WriteLine("ORBIT_SMOKE {\"ok\":true}");
            return 0;
        }
        File.WriteAllText(Path.Combine(root,"launched.txt"),"started");
        return 0;
    }
}
'@
    & $compiler /nologo /target:exe /platform:x64 "/out:$(Join-Path $testRoot 'Fixture.exe')" $fixtureSource
    Assert ($LASTEXITCODE -eq 0) 'Fixture compilation failed.'
    $settings = Join-Path $testRoot 'user-data\settings.json'
    Write-Text $settings '{"menus":"keep me"}'
    $settingsHash = File-Hash $settings

    $safe = New-Case 'safe prepare'
    Prepare $safe
    Assert (Test-Path -LiteralPath (Join-Path $safe.stage 'new.txt')) 'Prepared payload missing.'
    Assert (Test-Path -LiteralPath (Join-Path $safe.install 'old.txt')) 'Prepare changed installation.'
    Write-Output 'PASS: checked ZIP prepares without changing the running app'

    $badHash = New-Case 'bad checksum'; $badHash.sha256 = '0' * 64; Prepare $badHash 1
    Assert (-not (Test-Path -LiteralPath $badHash.stage)) 'Invalid checksum created staging.'
    $unsafe = New-Case 'traversal' $false '0.2.0' $true; Prepare $unsafe 1
    Assert (-not (Test-Path -LiteralPath (Join-Path $unsafe.root 'escaped.txt'))) 'Archive escaped staging.'
    $wrongVersion = New-Case 'wrong version' $false '8.0.0'; Prepare $wrongVersion 1
    Assert (-not (Test-Path -LiteralPath $wrongVersion.stage)) 'Rejected version retained staging.'
    Write-Output 'PASS: checksum, archive traversal and wrong version rejected'

    $unarmed = Install-Helper $safe $PID 0 1
    Wait-Helper $unarmed 1
    Assert (Test-Path -LiteralPath (Join-Path $safe.install 'old.txt')) 'Unarmed update changed files.'
    $alive = New-Case 'parent stays alive'; Prepare $alive
    $waiting = Install-Helper $alive $PID 0 1; Commit $alive $PID
    Wait-Helper $waiting 1
    Assert (Test-Path -LiteralPath (Join-Path $alive.install 'old.txt')) 'Live-parent timeout changed files.'
    Write-Output 'PASS: no replacement before commit and process exit'

    $success = New-Case 'successful update'; Prepare $success
    $parentWaiter = New-Waiter; $nativeWaiter = New-Waiter
    $installer = Install-Helper $success $parentWaiter.Id $nativeWaiter.Id 10
    Commit $success $parentWaiter.Id
    Start-Sleep -Milliseconds 200
    Assert (Test-Path -LiteralPath (Join-Path $success.install 'old.txt')) 'Update did not wait for parent.'
    Stop-Process -Id $parentWaiter.Id
    Start-Sleep -Milliseconds 200
    Assert (Test-Path -LiteralPath (Join-Path $success.install 'old.txt')) 'Update did not wait for native helper.'
    Stop-Process -Id $nativeWaiter.Id
    Wait-Helper $installer 0
    Wait-File (Join-Path $success.install 'launched.txt') $null
    Assert (Test-Path -LiteralPath (Join-Path $success.install 'new.txt')) 'New version not installed.'
    Assert (Test-Path -LiteralPath (Join-Path $success.backup 'old.txt')) 'Previous version not preserved.'
    Assert ((Get-Content -LiteralPath (Join-Path $success.work 'result.json') -Raw | ConvertFrom-Json).ok -eq $true) 'Install result missing.'
    Write-Output 'PASS: process exit, swap, health probe, restart and backup'

    $rollback = New-Case 'failed health rollback' $true; Prepare $rollback
    $parentWaiter = New-Waiter
    $installer = Install-Helper $rollback $parentWaiter.Id 0 10
    Commit $rollback $parentWaiter.Id; Stop-Process -Id $parentWaiter.Id
    Wait-Helper $installer 1
    Assert (Test-Path -LiteralPath (Join-Path $rollback.install 'old.txt')) 'Rollback did not restore old app.'
    Assert (-not (Test-Path -LiteralPath (Join-Path $rollback.install 'new.txt'))) 'Broken new app was retained at live path.'
    Assert ((Get-Content -LiteralPath (Join-Path $rollback.work 'result.json') -Raw | ConvertFrom-Json).rolledBack -eq $true) 'Rollback result missing.'
    Wait-File (Join-Path $rollback.install 'launched.txt') $null
    Assert ((File-Hash $settings) -eq $settingsHash) 'User settings changed.'
    Write-Output 'PASS: failed startup rolls back and leaves user settings unchanged'
    Write-Output 'ORBIT_UPDATER_TRANSACTIONS_OK'
} finally {
    foreach ($process in $ownedProcesses) {
        try { if (-not $process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }; $process.Dispose() } catch { }
    }
    $resolvedRoot = [IO.Path]::GetFullPath($testRoot)
    if (-not $resolvedRoot.StartsWith($tempParent + '\', [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolvedRoot) -notlike 'Orbit updater tests *') { throw 'Refused unexpected test cleanup path.' }
    Remove-Item -LiteralPath $resolvedRoot -Recurse -Force -ErrorAction SilentlyContinue
}
