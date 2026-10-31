param([Parameter(Mandatory=$true)][long]$Handle, [string]$Path)
$source = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class DialogChild {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, string lParam);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr hWnd);
}
'@
Add-Type $source
$rows = [System.Collections.ArrayList]::new()
$script:edit = [IntPtr]::Zero
$script:save = [IntPtr]::Zero
$callback = [DialogChild+EnumProc]{
  param($child, $unused)
  $title = [Text.StringBuilder]::new(512)
  $class = [Text.StringBuilder]::new(256)
  [DialogChild]::GetWindowText($child, $title, 512) | Out-Null
  [DialogChild]::GetClassName($child, $class, 256) | Out-Null
  $id = [DialogChild]::GetDlgCtrlID($child)
  [void]$rows.Add([pscustomobject]@{ Handle = $child.ToInt64(); Id = $id; Class = $class.ToString(); Text = $title.ToString() })
  if ($script:edit -eq [IntPtr]::Zero -and $id -eq 1001 -and $class.ToString() -eq 'Edit') { $script:edit = $child }
  if ($script:save -eq [IntPtr]::Zero -and $id -eq 1 -and $class.ToString() -eq 'Button') { $script:save = $child }
  return $true
}
[DialogChild]::EnumChildWindows([IntPtr]$Handle, $callback, [IntPtr]::Zero) | Out-Null
if (-not $Path) { [pscustomobject]@{ Edit = $script:edit.ToInt64(); Save = $script:save.ToInt64(); Children = $rows } | ConvertTo-Json -Depth 4; exit 0 }
if ($script:edit -eq [IntPtr]::Zero) { throw 'Editable file-name control not found' }
if ($script:save -eq [IntPtr]::Zero) { throw 'Save button not found' }
[DialogChild]::SendMessage($script:edit, 0x000C, [IntPtr]::Zero, $Path) | Out-Null
Start-Sleep -Milliseconds 400
[DialogChild]::SendMessage($script:save, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
Start-Sleep -Milliseconds 1800
[pscustomobject]@{ RequestedPath = $Path; Exists = (Test-Path -LiteralPath $Path); Length = if (Test-Path -LiteralPath $Path) { (Get-Item -LiteralPath $Path).Length } else { 0 } } | ConvertTo-Json
