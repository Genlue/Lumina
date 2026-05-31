Set ws = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
dirPath = fs.GetParentFolderName(WScript.ScriptFullName)
batPath = dirPath & "\start.bat"
ws.Run batPath, 0, False
