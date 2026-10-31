$ErrorActionPreference = 'Stop'
$auditRoot = $PSScriptRoot
$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $auditRoot '../..')).Path
$sourceFile = Join-Path $repositoryRoot 'src-tauri/src/commands/content.rs'
$source = [System.IO.File]::ReadAllText($sourceFile)
$begin = $source.IndexOf('pub(crate) fn document(')
$end = $source.IndexOf('pub async fn save(', $begin)
if ($begin -lt 0 -or $end -le $begin) { throw 'Shared document parser could not be located.' }
$extracted = "use serde_json::Value;`n" + $source.Substring($begin, $end - $begin)
[System.IO.File]::WriteAllText((Join-Path $auditRoot 'native-probe/src/document.inc.rs'), $extracted, [System.Text.UTF8Encoding]::new($false))
& cargo run --offline --locked --manifest-path (Join-Path $auditRoot 'native-probe/Cargo.toml') --target x86_64-pc-windows-msvc --target-dir (Join-Path $repositoryRoot 'src-tauri/target')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
