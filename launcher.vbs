Set ws = CreateObject("WScript.Shell")
dirPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
ws.Run "node """ & dirPath & "\launcher.js""", 0, False
