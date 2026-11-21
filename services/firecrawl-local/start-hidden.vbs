Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\dev\neuralbridge-studio\services\firecrawl-local"
WshShell.Run "node server.mjs", 0, False
