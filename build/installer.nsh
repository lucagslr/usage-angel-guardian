; Désinstallation propre : retire le démarrage automatique et propose de conserver les données.
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "ch.luca.claude-desktop-usage-guardian"
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION "Supprimer aussi vos données Usage Guardian (historique et paramètres dans %USERPROFILE%\.claude-usage-guardian) ?$\r$\n$\r$\nNon = elles sont conservées pour une réinstallation." /SD IDNO IDNO keepData
      RMDir /r "$PROFILE\.claude-usage-guardian"
    keepData:
  ${endIf}
!macroend
