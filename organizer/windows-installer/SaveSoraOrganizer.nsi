Unicode True
RequestExecutionLevel user

!define APP_NAME "Save Sora Organizer"
!define APP_PUBLISHER "Save Sora"
!define APP_VERSION "1.0.0"

Name "${APP_NAME}"
OutFile "SaveSoraOrganizerSetup.exe"
InstallDir "$LOCALAPPDATA\SaveSoraOrganizer"
InstallDirRegKey HKCU "Software\SaveSoraOrganizer" "InstallDir"

Page directory
Page instfiles

UninstPage uninstConfirm
UninstPage instfiles

Section "Install"
  SetOutPath "$INSTDIR"
  File "OrganizerLauncher.cmd"
  File "OrganizerLauncher.ps1"

  WriteRegStr HKCU "Software\SaveSoraOrganizer" "InstallDir" "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\Save Sora Organizer"
  CreateShortcut "$SMPROGRAMS\Save Sora Organizer\Launch Organizer.lnk" "$INSTDIR\OrganizerLauncher.cmd"
  CreateShortcut "$DESKTOP\Save Sora Organizer.lnk" "$INSTDIR\OrganizerLauncher.cmd"
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\OrganizerLauncher.cmd"
  Delete "$INSTDIR\OrganizerLauncher.ps1"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"

  Delete "$SMPROGRAMS\Save Sora Organizer\Launch Organizer.lnk"
  RMDir "$SMPROGRAMS\Save Sora Organizer"
  Delete "$DESKTOP\Save Sora Organizer.lnk"
  DeleteRegKey HKCU "Software\SaveSoraOrganizer"
SectionEnd
