# Installs STL Tools for the current user. No admin rights needed.
# App:  %LOCALAPPDATA%\Programs\STL Tools   (replaced on every install / upgrade)
# Data: %APPDATA%\STLTools                  (never touched: catalog, saved designs, custom files)
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $env:LOCALAPPDATA 'Programs\STL Tools'
Write-Host "Installing STL Tools to $dest"
if (Test-Path $dest) {
  foreach ($old in @('app', 'node')) {
    $p = Join-Path $dest $old
    if (Test-Path $p) { Remove-Item -Recurse -Force $p }
  }
}
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Recurse -Force (Join-Path $src '*') $dest
Get-ChildItem -Recurse -File $dest | Unblock-File -ErrorAction SilentlyContinue
$launcher = Join-Path $dest 'Start STL Tools.bat'
$shell = New-Object -ComObject WScript.Shell
$places = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
foreach ($dir in $places) {
  $lnk = $shell.CreateShortcut((Join-Path $dir 'STL Tools.lnk'))
  $lnk.TargetPath = $launcher
  $lnk.WorkingDirectory = $dest
  $lnk.Description = 'STL Tools: parametric STL generator'
  $lnk.Save()
}
Write-Host ''
Write-Host 'Done. Start STL Tools from the desktop or Start menu shortcut.'
Write-Host "Your data folder: $(Join-Path $env:APPDATA 'STLTools')"
Write-Host "To uninstall: run $(Join-Path $dest 'install\uninstall-windows.ps1') in PowerShell."
