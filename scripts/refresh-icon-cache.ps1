# Restarts Explorer and clears the Windows icon database so .exe icons refresh in File Explorer.
# Closes all Explorer windows briefly — save work first.
$ErrorActionPreference = 'SilentlyContinue'
Write-Host 'Stopping Explorer...'
Stop-Process -Name explorer -Force
Start-Sleep -Seconds 2
$iconPath = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Explorer'
Get-ChildItem -Path $iconPath -Filter 'iconcache*' | Remove-Item -Force
Write-Host 'Starting Explorer...'
Start-Process explorer
Write-Host 'Done. Re-open your folder and check Yoinkr.exe.'
