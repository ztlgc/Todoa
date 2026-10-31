param([int]$Port = 19331, [switch]$WaitForExit)
$ErrorActionPreference = 'Stop'
$root = 'E:\2025Code\Todoa'
$evidence = Join-Path $root 'docs\journal-review-2026-10-31'
$exe = Join-Path $root 'src-tauri\target\debug\todoa.exe'
$expected = 'com.todoa.desktop.test.review20261031'
$bytes = [System.IO.File]::ReadAllBytes($exe)
if (-not [System.Text.Encoding]::UTF8.GetString($bytes).Contains($expected)) { throw 'Isolated identity absent from binary' }
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "Port $Port already in use" }
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port --remote-debugging-address=127.0.0.1"
$env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $env:LOCALAPPDATA "$expected\native-gui-webview"
$p = Start-Process -FilePath $exe -WorkingDirectory $root -PassThru -RedirectStandardOutput (Join-Path $evidence 'native-stdout.log') -RedirectStandardError (Join-Path $evidence 'native-stderr.log')
@{ pid = $p.Id; executable = $exe; identifier = $expected; port = $Port; startedAt = (Get-Date).ToString('o'); webviewProfile = $env:WEBVIEW2_USER_DATA_FOLDER } | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $evidence 'native-process.json')
Write-Output "Started isolated Todoa PID $($p.Id), CDP port $Port"
if ($WaitForExit) { Wait-Process -Id $p.Id }
