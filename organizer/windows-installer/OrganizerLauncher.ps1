Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Show-ErrorDialog {
  param([string]$Message)
  [System.Windows.Forms.MessageBox]::Show($Message, "Save Sora Organizer", "OK", "Error") | Out-Null
}

function Show-InfoDialog {
  param([string]$Message)
  [System.Windows.Forms.MessageBox]::Show($Message, "Save Sora Organizer", "OK", "Information") | Out-Null
}

$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Select the extracted Save Sora ZIP folder"
$dialog.ShowNewFolderButton = $false
$dialog.UseDescriptionForTitle = $true

$result = $dialog.ShowDialog()
if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
  exit 0
}

$rootDir = $dialog.SelectedPath
if ([string]::IsNullOrWhiteSpace($rootDir)) {
  Show-ErrorDialog "No folder selected."
  exit 1
}

$organizerScript = Join-Path $rootDir "organizer\create-links-windows.ps1"
if (-not (Test-Path -LiteralPath $organizerScript)) {
  Show-ErrorDialog "Could not find organizer script at:`n$organizerScript`n`nMake sure you selected the extracted Save Sora ZIP root folder."
  exit 1
}

try {
  powershell -NoProfile -ExecutionPolicy Bypass -File $organizerScript $rootDir
  $organizedPath = Join-Path $rootDir "organized"
  if (Test-Path -LiteralPath $organizedPath) {
    Start-Process explorer.exe $organizedPath | Out-Null
  }
  Show-InfoDialog "Organizer complete."
  exit 0
} catch {
  Show-ErrorDialog "Organizer failed.`n`n$($_.Exception.Message)"
  exit 1
}
