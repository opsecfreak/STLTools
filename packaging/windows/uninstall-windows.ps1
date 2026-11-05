# Removes the STL Tools app and shortcuts. Keeps your data in %APPDATA%\STLTools.
$dest = Join-Path $env:LOCALAPPDATA 'Programs\STL Tools'
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  $lnk = Join-Path $dir 'STL Tools.lnk'
  if (Test-Path $lnk) { Remove-Item -Force $lnk }
}
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
Write-Host "STL Tools removed. Your data is still in $(Join-Path $env:APPDATA 'STLTools'). Delete that folder too if you want."
