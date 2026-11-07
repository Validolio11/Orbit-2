param(
    [Parameter(Mandatory = $true)][ValidateSet('Prepare', 'Install')][string]$Mode,
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [Parameter(Mandatory = $true)][string]$StagePath,
    [Parameter(Mandatory = $true)][string]$BackupPath,
    [Parameter(Mandatory = $true)][string]$ArchivePath,
    [Parameter(Mandatory = $true)][string]$WorkDir,
    [Parameter(Mandatory = $true)][string]$ExpectedVersion,
    [Parameter(Mandatory = $true)][string]$ExpectedSha256,
    [int]$ParentPid = 0,
    [int]$NativePid = 0,
    [ValidateRange(1, 120)][int]$WaitSeconds = 60,
    [switch]$Detach
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if ($Detach) {
    # Node keeps direct children in a kill-on-close job and PowerShell cannot run as a detached process,
    # so the installer restarts itself as a hidden grandchild that outlives Orbit.
    $arguments = @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'))
    foreach ($entry in $PSBoundParameters.GetEnumerator()) {
        if ($entry.Key -eq 'Detach') { continue }
        $value = [string]$entry.Value
        if ($value.Contains('"')) { throw 'Invalid update argument.' }
        if ($value.EndsWith('\')) { $value += '\' }
        $arguments += @(('-' + $entry.Key), ('"' + $value + '"'))
    }
    $start = New-Object Diagnostics.ProcessStartInfo (Join-Path $PSHOME 'powershell.exe')
    $start.Arguments = $arguments -join ' '
    # A process whose current directory is inside the app folder would block moving that folder.
    $start.WorkingDirectory = Split-Path -Parent $PSCommandPath
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $installer = [Diagnostics.Process]::Start($start)
    [Console]::Out.Write($installer.Id)
    exit 0
}
$productId = 'com.creationsoft.orbit2'
$createdStage = $false
$oldMoved = $false
$newMoved = $false
$parentExited = $false
$ownedSmoke = $null

function Absolute-Path([string]$value) {
    if (-not [IO.Path]::IsPathRooted($value)) { throw 'An absolute update path is required.' }
    return [IO.Path]::GetFullPath($value).TrimEnd([IO.Path]::DirectorySeparatorChar)
}

function Same-Path([string]$left, [string]$right) { return [string]::Equals($left, $right, [StringComparison]::OrdinalIgnoreCase) }
function Within-Path([string]$candidate, [string]$directory) { return (Same-Path $candidate $directory) -or $candidate.StartsWith($directory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) }

function Assert-Paths {
    $script:install = Absolute-Path $InstallDir
    $script:stage = Absolute-Path $StagePath
    $script:backup = Absolute-Path $BackupPath
    $script:archive = Absolute-Path $ArchivePath
    $script:work = Absolute-Path $WorkDir
    if ($install.Length -le [IO.Path]::GetPathRoot($install).TrimEnd('\').Length) { throw 'A drive root cannot be updated.' }
    $script:installParent = [IO.Directory]::GetParent($install).FullName
    $script:token = [IO.Path]::GetFileName($work)
    if ($token -notmatch '^[0-9a-f]{32}$') { throw 'Invalid update transaction identifier.' }
    if (-not (Same-Path $stage (Join-Path $installParent ('.Orbit2-update-stage-' + $token)))) { throw 'Stage path is outside the update scope.' }
    if (-not (Same-Path $backup (Join-Path $installParent ('.Orbit2-update-backup-' + $token)))) { throw 'Backup path is outside the update scope.' }
    if ((Within-Path $work $install) -or (Within-Path $work $stage) -or (Within-Path $work $backup)) { throw 'The update helper must run outside the application.' }
    if ($ExpectedVersion -notmatch '^\d+\.\d+\.\d+(\+[0-9A-Za-z.-]+)?$' -or $ExpectedSha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'Invalid release metadata.' }
    if (-not (Same-Path $archive (Join-Path $work ('Orbit2-' + $ExpectedVersion + '-win32-x64.zip')))) { throw 'Archive path is outside the transaction.' }
    if (-not [IO.Directory]::Exists($work)) { throw 'The update workspace is missing.' }
}

function Write-Json([string]$name, $value) {
    $destination = Join-Path $work $name
    $temporary = $destination + '.tmp'
    [IO.File]::WriteAllText($temporary, ($value | ConvertTo-Json -Compress -Depth 5), (New-Object Text.UTF8Encoding($false)))
    if ([IO.File]::Exists($destination)) {
        $previous = $destination + '.previous'
        [IO.File]::Replace($temporary, $destination, $previous)
        [IO.File]::Delete($previous)
    }
    else { [IO.File]::Move($temporary, $destination) }
}

function Assert-AppFiles([string]$directory) {
    foreach ($relative in @('Orbit2.exe', 'resources\app.asar', 'resources\app.asar.unpacked\native\Orbit2.Input.exe')) {
        if (-not [IO.File]::Exists((Join-Path $directory $relative))) { throw 'The Orbit application is incomplete.' }
    }
}

function Assert-Release([string]$directory) {
    Assert-AppFiles $directory
    if (-not [IO.File]::Exists((Join-Path $directory 'resources\app.asar.unpacked\native\Update.ps1'))) { throw 'The next Orbit release is missing its updater.' }
    $marker = Join-Path $directory 'orbit-release.json'
    if (-not [IO.File]::Exists($marker) -or (Get-Item -LiteralPath $marker).Length -gt 4096) { throw 'The release marker is missing or invalid.' }
    $release = [IO.File]::ReadAllText($marker) | ConvertFrom-Json
    if ($release.product -cne $productId -or $release.version -cne $ExpectedVersion -or $release.platform -cne 'win32' -or $release.arch -cne 'x64') { throw 'The archive is not the expected Orbit release.' }
}

function Assert-Archive {
    if (-not [IO.File]::Exists($archive) -or (Get-Item -LiteralPath $archive).Length -gt 1073741824) { throw 'The update archive is missing or oversized.' }
    $hasher = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($archive)
    try { $hash = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $hasher.Dispose() }
    if ($hash -ine $ExpectedSha256) { throw 'Update archive checksum mismatch.' }
}

function Assert-ManagedDirectory([string]$directory) {
    # Re-check resolved absolute paths immediately before every directory move/delete.
    $resolved = Absolute-Path $directory
    if (-not ((Same-Path $resolved $install) -or (Same-Path $resolved $stage) -or (Same-Path $resolved $backup))) { throw 'Directory operation escaped the update scope.' }
    if (-not (Same-Path ([IO.Directory]::GetParent($resolved).FullName) $installParent)) { throw 'Directory operation escaped the install parent.' }
    if ([IO.Directory]::Exists($resolved) -and (([IO.File]::GetAttributes($resolved) -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { throw 'Update directories cannot be junctions.' }
}

function Move-ManagedDirectory([string]$source, [string]$destination) {
    Assert-ManagedDirectory $source
    Assert-ManagedDirectory $destination
    if (Test-Path -LiteralPath $destination) { throw 'The update destination already exists.' }
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while ($true) {
        try { Move-Item -LiteralPath $source -Destination $destination; return }
        catch { if ([DateTime]::UtcNow -ge $deadline) { throw }; Start-Sleep -Milliseconds 200 }
    }
}

function Extract-Release {
    if (Test-Path -LiteralPath $stage) { throw 'The update staging directory already exists.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Add-Type -AssemblyName System.IO.Compression
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        if ($zip.Entries.Count -gt 10000) { throw 'The archive has too many files.' }
        $destinations = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        $entries = New-Object 'System.Collections.Generic.List[object]'
        [long]$expanded = 0
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName.Replace('\', '/')
            $directory = $name.EndsWith('/')
            $parts = $name.TrimEnd('/').Split('/')
            if ($name.StartsWith('/') -or $parts[0] -cne 'Orbit2-win32-x64') { throw 'The archive root is invalid.' }
            foreach ($part in $parts) {
                if (-not $part -or $part -eq '.' -or $part -eq '..' -or $part -match '[\x00-\x1f<>:"|?*]' -or $part.EndsWith('.') -or $part.EndsWith(' ') -or $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)') { throw 'An archive path is unsafe.' }
            }
            $unixType = ($entry.ExternalAttributes -shr 16) -band 61440
            if ($unixType -ne 0 -and $unixType -ne 32768 -and $unixType -ne 16384) { throw 'Archive links and special files are not supported.' }
            if (($entry.ExternalAttributes -band 1024) -ne 0) { throw 'Archive reparse points are not supported.' }
            if ($parts.Length -eq 1) { if (-not $directory) { throw 'The archive root is not a directory.' }; continue }
            $relative = [string]::Join([IO.Path]::DirectorySeparatorChar, $parts[1..($parts.Length - 1)])
            $destination = [IO.Path]::GetFullPath((Join-Path $stage $relative))
            if (-not (Within-Path $destination $stage) -or (Same-Path $destination $stage) -or -not $destinations.Add($destination)) { throw 'Duplicate or escaping archive path.' }
            $expanded += $entry.Length
            if ($expanded -gt 2147483648 -or $entry.Length -gt 1073741824) { throw 'The expanded archive is oversized.' }
            $entries.Add(@{ Entry = $entry; Destination = $destination; Directory = $directory })
        }
        Assert-ManagedDirectory $stage
        [void][IO.Directory]::CreateDirectory($stage)
        $script:createdStage = $true
        foreach ($item in $entries) {
            if ($item.Directory) { [void][IO.Directory]::CreateDirectory($item.Destination); continue }
            [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($item.Destination))
            $inputStream = $item.Entry.Open()
            $outputStream = $null
            try {
                $outputStream = New-Object IO.FileStream($item.Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
                $inputStream.CopyTo($outputStream)
            } finally { if ($outputStream) { $outputStream.Dispose() }; $inputStream.Dispose() }
        }
    } finally { $zip.Dispose() }
    Assert-Release $stage
}

function Assert-NotAborted {
    if ([IO.File]::Exists((Join-Path $work 'abort.json'))) { throw 'Update was canceled before application exit.' }
}

function Wait-Commit {
    $deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        Assert-NotAborted
        $commitFile = Join-Path $work 'commit.json'
        if ([IO.File]::Exists($commitFile)) {
            try { $commit = [IO.File]::ReadAllText($commitFile) | ConvertFrom-Json; if ($commit.token -ceq $token -and $commit.parentPid -eq $ParentPid) { return } } catch { }
        }
        Start-Sleep -Milliseconds 50
    }
    throw 'Update commit timed out.'
}

function Wait-ProcessExit([int]$processId) {
    if ($processId -le 0) { return }
    $deadline = [DateTime]::UtcNow.AddSeconds($WaitSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        Assert-NotAborted
        try { $process = [Diagnostics.Process]::GetProcessById($processId) } catch { return }
        try { if ($process.HasExited) { return } } finally { $process.Dispose() }
        Start-Sleep -Milliseconds 100
    }
    throw 'Orbit did not exit in time. Its application files were not replaced.'
}

function Run-SmokeTest {
    $stdout = Join-Path $work 'smoke.stdout'
    $stderr = Join-Path $work 'smoke.stderr'
    $script:ownedSmoke = New-Object Diagnostics.Process
    $ownedSmoke.StartInfo.FileName = Join-Path $install 'Orbit2.exe'
    $ownedSmoke.StartInfo.Arguments = '--smoke-test'
    $ownedSmoke.StartInfo.WorkingDirectory = $install
    $ownedSmoke.StartInfo.UseShellExecute = $false
    $ownedSmoke.StartInfo.CreateNoWindow = $true
    $ownedSmoke.StartInfo.RedirectStandardOutput = $true
    $ownedSmoke.StartInfo.RedirectStandardError = $true
    if (-not $ownedSmoke.Start()) { throw 'The new Orbit startup check could not start.' }
    $stdoutTask = $ownedSmoke.StandardOutput.ReadToEndAsync()
    $stderrTask = $ownedSmoke.StandardError.ReadToEndAsync()
    if (-not $ownedSmoke.WaitForExit(30000)) {
        # This PID was created above by this transaction; no unrelated process is stopped.
        & (Join-Path $env:WINDIR 'System32\taskkill.exe') '/PID' ([string]$ownedSmoke.Id) '/T' '/F' *> $null
        throw 'The new Orbit version did not pass its startup check in time.'
    }
    [IO.File]::WriteAllText($stdout, $stdoutTask.GetAwaiter().GetResult())
    [IO.File]::WriteAllText($stderr, $stderrTask.GetAwaiter().GetResult())
    if ($ownedSmoke.ExitCode -ne 0) { throw 'The new Orbit version failed its startup check.' }
    $healthy = $false
    foreach ($line in [IO.File]::ReadAllLines($stdout)) {
        if ($line.StartsWith('ORBIT_SMOKE ')) {
            try { $probe = $line.Substring(12) | ConvertFrom-Json; if ($probe.ok -eq $true) { $healthy = $true } } catch { }
        }
    }
    if (-not $healthy) { throw 'The new Orbit version did not confirm startup readiness.' }
    $ownedSmoke.Dispose(); $script:ownedSmoke = $null
}

try {
    Assert-Paths
    Assert-AppFiles $install
    Assert-ManagedDirectory $install
    Assert-Archive
    if ($Mode -eq 'Prepare') {
        Extract-Release
        Write-Json 'prepared.json' @{ ok = $true; version = $ExpectedVersion }
        exit 0
    }
    if ($ParentPid -le 0 -or $ParentPid -eq $PID -or $NativePid -lt 0 -or $NativePid -eq $PID) { throw 'Invalid application process identifiers.' }
    Assert-Release $stage
    if (Test-Path -LiteralPath $backup) { throw 'The rollback directory already exists.' }
    Write-Json 'ready.json' @{ token = $token; pid = $PID }
    Wait-Commit
    Wait-ProcessExit $ParentPid
    Wait-ProcessExit $NativePid
    $parentExited = $true
    Assert-NotAborted
    Write-Json 'journal.json' @{ phase = 'prepared'; install = $install; stage = $stage; backup = $backup; version = $ExpectedVersion }
    Move-ManagedDirectory $install $backup
    $oldMoved = $true
    Write-Json 'journal.json' @{ phase = 'old-moved'; install = $install; stage = $stage; backup = $backup; version = $ExpectedVersion }
    Move-ManagedDirectory $stage $install
    $newMoved = $true
    Write-Json 'journal.json' @{ phase = 'new-installed'; install = $install; stage = $stage; backup = $backup; version = $ExpectedVersion }
    Run-SmokeTest
    Write-Json 'journal.json' @{ phase = 'verified'; install = $install; backup = $backup; version = $ExpectedVersion }
    Write-Json 'result.json' @{ ok = $true; version = $ExpectedVersion; backup = $backup }
    # Only the backup of this verified update is kept; older ones would add a full app copy per update.
    try {
        foreach ($previous in [IO.Directory]::GetDirectories($installParent, '.Orbit2-update-backup-*')) {
            try {
                if ((Same-Path $previous $backup) -or [IO.Path]::GetFileName($previous) -notmatch '^\.Orbit2-update-backup-[0-9a-f]{32}$') { continue }
                if (([IO.File]::GetAttributes($previous) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
                Remove-Item -LiteralPath $previous -Recurse -Force
            } catch { }
        }
    } catch { }
    # The new version is verified; a failed restart must not roll it back.
    try { [void](Start-Process -FilePath (Join-Path $install 'Orbit2.exe') -WorkingDirectory $install -WindowStyle Hidden -PassThru) } catch { }
    exit 0
} catch {
    $reason = $_.Exception.Message
    if ($ownedSmoke) {
        try { if (-not $ownedSmoke.HasExited) { & (Join-Path $env:WINDIR 'System32\taskkill.exe') '/PID' ([string]$ownedSmoke.Id) '/T' '/F' *> $null } } catch { }
        $ownedSmoke.Dispose()
    }
    $rolledBack = $false
    if ($Mode -eq 'Install' -and $oldMoved) {
        try {
            if ($newMoved -and [IO.Directory]::Exists($install)) { Move-ManagedDirectory $install $stage }
            if (-not [IO.Directory]::Exists($install) -and [IO.Directory]::Exists($backup)) { Move-ManagedDirectory $backup $install; $rolledBack = $true }
        } catch { $reason += ' Rollback requires recovery from the preserved backup.' }
    }
    if ($Mode -eq 'Prepare' -and $createdStage) {
        try { Assert-ManagedDirectory $stage; Remove-Item -LiteralPath $stage -Recurse -Force } catch { }
    }
    if ($work -and [IO.Directory]::Exists($work)) {
        try { Write-Json $(if ($Mode -eq 'Prepare') { 'prepared.json' } else { 'result.json' }) @{ ok = $false; error = $reason; rolledBack = $rolledBack } } catch { }
    }
    if ($parentExited -and ($rolledBack -or -not $oldMoved)) {
        try { [void](Start-Process -FilePath (Join-Path $install 'Orbit2.exe') -WorkingDirectory $install -WindowStyle Hidden -PassThru) } catch { }
    }
    exit 1
}
