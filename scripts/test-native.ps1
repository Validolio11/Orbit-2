$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$nativePath = Join-Path $projectRoot 'native\Orbit2.Input.exe'
if (-not (Test-Path -LiteralPath $nativePath)) { & (Join-Path $PSScriptRoot 'build-native.ps1') }

function Test-NativeLifecycle([string] $arguments, [bool] $sendQuit) {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $nativePath
    $startInfo.Arguments = $arguments
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) { throw 'Helper did not start.' }
        $readyTask = $process.StandardOutput.ReadLineAsync()
        if (-not $readyTask.Wait(3000)) { throw 'Helper readiness timed out.' }
        $ready = $readyTask.Result | ConvertFrom-Json
        if ($ready.type -ne 'ready') { throw 'Helper did not report readiness.' }
        if ($sendQuit) { $process.StandardInput.WriteLine('quit'); $process.StandardInput.Close() }
        if (-not $process.WaitForExit(4000)) { throw 'Helper did not cleanly exit.' }
        if ($process.ExitCode -ne 0) { throw "Helper exited with $($process.ExitCode)." }
        Write-Output "PASS: $arguments"
    } finally {
        if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
        $process.Dispose()
    }
}

& $nativePath --self-test
if ($LASTEXITCODE -ne 0) { throw 'Native self-test failed.' }
Test-NativeLifecycle '--button=4' $true
Test-NativeLifecycle '--button=5' $true
Test-NativeLifecycle '--button=0' $true
Test-NativeLifecycle '--button=4 --parent-pid=2147483647' $false
Test-NativeLifecycle '--button=0 --parent-pid=2147483647' $false
