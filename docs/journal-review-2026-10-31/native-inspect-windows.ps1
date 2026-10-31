param([Parameter(Mandatory=$true)][int]$ProcessId)
$source = @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class NativeWindows {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
Add-Type $source
$rows = [System.Collections.ArrayList]::new()
$callback = [NativeWindows+EnumProc]{
  param($handle, $unused)
  $owner = 0
  [NativeWindows]::GetWindowThreadProcessId($handle, [ref]$owner) | Out-Null
  if ($owner -eq $ProcessId) {
    $title = [Text.StringBuilder]::new(512)
    $class = [Text.StringBuilder]::new(256)
    [NativeWindows]::GetWindowText($handle, $title, 512) | Out-Null
    [NativeWindows]::GetClassName($handle, $class, 256) | Out-Null
    [void]$rows.Add([pscustomobject]@{ Handle = $handle.ToInt64(); Class = $class.ToString(); Title = $title.ToString(); Visible = [NativeWindows]::IsWindowVisible($handle) })
  }
  return $true
}
[NativeWindows]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
[pscustomobject]@{ Foreground = ([NativeWindows]::GetForegroundWindow()).ToInt64(); Windows = $rows } | ConvertTo-Json -Depth 4
