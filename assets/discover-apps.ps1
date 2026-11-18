$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$records = New-Object 'System.Collections.Generic.List[object]'
$maximumRecords = 5000

function Add-Discovery($name, $target, $source, $resolvedTarget = '', $resolvedArgs = '') {
    if ($records.Count -ge $maximumRecords -or [string]::IsNullOrWhiteSpace($name)) { return }
    $records.Add([pscustomobject]@{ name = [string]$name; target = [string]$target; args = ''; source = $source; resolvedTarget = [string]$resolvedTarget; resolvedArgs = [string]$resolvedArgs })
}

# Only the two Windows Programs folders are traversed. Junctions and deep trees are skipped.
$shortcutShell = $null
try { $shortcutShell = New-Object -ComObject WScript.Shell } catch { }
foreach ($root in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('CommonPrograms'))) {
    if ([string]::IsNullOrWhiteSpace($root) -or -not [IO.Directory]::Exists($root)) { continue }
    $folders = New-Object 'System.Collections.Generic.Stack[object]'
    $folders.Push(@{ Path = $root; Depth = 0 })
    while ($folders.Count -gt 0 -and $records.Count -lt $maximumRecords) {
        $folder = $folders.Pop()
        try {
            foreach ($file in [IO.Directory]::EnumerateFiles($folder.Path, '*.lnk', [IO.SearchOption]::TopDirectoryOnly)) {
                $resolvedTarget = ''; $resolvedArgs = ''; $shortcut = $null
                try {
                    if ($shortcutShell) {
                        $shortcut = $shortcutShell.CreateShortcut($file)
                        $resolvedTarget = [Environment]::ExpandEnvironmentVariables([string]$shortcut.TargetPath)
                        $resolvedArgs = [string]$shortcut.Arguments
                    }
                    if ($resolvedTarget) {
                        if ($resolvedTarget -notmatch '^[A-Za-z]:[\\/]' -or [IO.Path]::GetExtension($resolvedTarget) -ine '.exe' -or -not [IO.File]::Exists($resolvedTarget)) { continue }
                    }
                    Add-Discovery ([IO.Path]::GetFileNameWithoutExtension($file)) $file 'start-menu' $resolvedTarget $resolvedArgs
                } catch { }
                finally { if ($shortcut) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut) } }
                if ($records.Count -ge $maximumRecords) { break }
            }
            if ($folder.Depth -lt 8) {
                foreach ($directory in [IO.Directory]::EnumerateDirectories($folder.Path)) {
                    if (([IO.File]::GetAttributes($directory) -band [IO.FileAttributes]::ReparsePoint) -eq 0) { $folders.Push(@{ Path = $directory; Depth = $folder.Depth + 1 }) }
                }
            }
        } catch { }
    }
}
if ($shortcutShell) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shortcutShell) }

# Read both registry views explicitly; no registry values are changed.
foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
    foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
        $baseKey = $null; $appPaths = $null
        try {
            $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
            $appPaths = $baseKey.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths', $false)
            if (-not $appPaths) { continue }
            foreach ($keyName in $appPaths.GetSubKeyNames()) {
                $entry = $null
                try {
                    $entry = $appPaths.OpenSubKey($keyName, $false)
                    $target = [Environment]::ExpandEnvironmentVariables([string]$entry.GetValue('')).Trim().Trim('"')
                    if ($target -notmatch '^[A-Za-z]:[\\/]' -or [IO.Path]::GetExtension($target) -ine '.exe' -or -not [IO.File]::Exists($target)) { continue }
                    $name = [IO.Path]::GetFileNameWithoutExtension($target)
                    try { $description = [Diagnostics.FileVersionInfo]::GetVersionInfo($target).FileDescription; if (-not [string]::IsNullOrWhiteSpace($description)) { $name = $description } } catch { }
                    Add-Discovery $name $target 'app-paths' $target ''
                } catch { }
                finally { if ($entry) { $entry.Dispose() } }
            }
        } catch { }
        finally { if ($appPaths) { $appPaths.Dispose() }; if ($baseKey) { $baseKey.Dispose() } }
    }
}

# Get-StartApps includes classic IDs too; only packaged family!application IDs are added here.
try {
    if (Get-Command Get-StartApps -ErrorAction SilentlyContinue) {
        foreach ($entry in Get-StartApps -ErrorAction Stop) {
            $appId = [string]$entry.AppID
            if ($appId.Length -le 128 -and $appId -match '^[A-Za-z0-9][A-Za-z0-9._-]*![A-Za-z0-9][A-Za-z0-9._-]*$') { Add-Discovery $entry.Name ('app-id:' + $appId) 'windows-app' }
        }
    }
} catch { }

ConvertTo-Json -InputObject @($records.ToArray()) -Compress -Depth 4
