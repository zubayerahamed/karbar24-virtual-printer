# Makes "K24 Virtual Printer" shortcuts on the Desktop and in the Start menu (npm run shortcut).
# They start the app from source: electron.exe <project>. Safe to run again (it replaces them).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electron)) { throw "Electron is not installed yet - run 'npm install' in $root first." }

$shell = New-Object -ComObject WScript.Shell
$places = @(
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs')
)
foreach ($dir in $places) {
  $link = $shell.CreateShortcut((Join-Path $dir 'K24 Virtual Printer.lnk'))
  $link.TargetPath = $electron
  $link.Arguments = '"' + $root + '"'
  $link.WorkingDirectory = $root
  $link.IconLocation = (Join-Path $root 'assets\icon.ico') + ',0'
  $link.Description = 'A pretend thermal printer and cash drawer for testing a POS'
  $link.Save()
  Write-Output "Shortcut: $(Join-Path $dir 'K24 Virtual Printer.lnk')"
}
