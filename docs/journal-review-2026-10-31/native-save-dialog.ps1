param([Parameter(Mandatory=$true)][long]$Handle, [string]$Path)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Handle)
if (-not $root) { throw 'Save dialog handle not found' }
$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$rows = foreach ($element in $all) {
  $name = $element.Current.Name
  $automationId = $element.Current.AutomationId
  $className = $element.Current.ClassName
  $controlType = $element.Current.ControlType.ProgrammaticName
  if ($name -or $automationId) { [pscustomobject]@{ Name = $name; AutomationId = $automationId; Class = $className; Type = $controlType; Enabled = $element.Current.IsEnabled } }
}
if (-not $Path) { $rows | ConvertTo-Json -Depth 3; exit 0 }
$edit = $null
foreach ($element in $all) {
  if ($element.Current.AutomationId -eq '1001' -and $element.Current.ClassName -eq 'Edit') { $edit = $element; break }
}
if (-not $edit) { throw 'File name edit not found' }
$pattern = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
$pattern.SetValue($Path)
Start-Sleep -Milliseconds 300
$save = $null
foreach ($element in $all) {
  if ($element.Current.AutomationId -eq '1' -and $element.Current.ClassName -eq 'Button') { $save = $element; break }
}
if (-not $save) { throw 'Save button not found' }
$invoke = $save.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
$invoke.Invoke()
Start-Sleep -Milliseconds 1200
[pscustomobject]@{ RequestedPath = $Path; Exists = (Test-Path -LiteralPath $Path); Length = if (Test-Path -LiteralPath $Path) { (Get-Item -LiteralPath $Path).Length } else { 0 } } | ConvertTo-Json
