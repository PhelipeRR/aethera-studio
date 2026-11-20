<#
.SYNOPSIS
  Encerra de forma segura o Aethera Remote Host e o túnel (ngrok/cloudflared) iniciados pelo start-remote-host.ps1.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
$PidDir = Join-Path $env:LOCALAPPDATA 'AetheraRemoteHost\run'

function Stop-SavedProcess([string]$PidFile, [string]$Label) {
  if (-not (Test-Path $PidFile)) {
    Write-Host "[Aethera Remote] Nenhum PID registrado para $Label." -ForegroundColor Yellow
    return
  }
  $rawPid = (Get-Content $PidFile -Raw).Trim()
  if ($rawPid -match '^\d+$') {
    $pidNum = [int]$rawPid
    try {
      $proc = Get-Process -Id $pidNum -ErrorAction SilentlyContinue
      if ($proc) {
        Stop-Process -Id $pidNum -Force -ErrorAction SilentlyContinue
        Write-Host "[Aethera Remote] $Label encerrado (PID $pidNum)." -ForegroundColor Green
      } else {
        Write-Host "[Aethera Remote] $Label (PID $pidNum) já estava encerrado." -ForegroundColor Yellow
      }
    } catch {
      Write-Host "[Aethera Remote] Aviso ao encerrar $Label (PID $pidNum): $_" -ForegroundColor Yellow
    }
  }
  Remove-Item -Force $PidFile -ErrorAction SilentlyContinue
}

Stop-SavedProcess (Join-Path $PidDir 'tunnel.pid') 'Túnel HTTPS'
Stop-SavedProcess (Join-Path $PidDir 'host.pid') 'Aethera Remote Host'
