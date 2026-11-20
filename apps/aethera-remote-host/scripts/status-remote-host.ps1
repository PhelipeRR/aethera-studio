<#
.SYNOPSIS
  Verifica o estado do Aethera Remote Host, GPU/CPU/RAM, agentes instalados e túnel HTTPS ativo.
#>
[CmdletBinding()]
param(
  [int]$Port = 4848
)

$ErrorActionPreference = 'Continue'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$EnvFile = Join-Path (Resolve-Path (Join-Path $ScriptDir '..')) '.env.local'

$envMap = @{}
if (Test-Path $EnvFile) {
  Get-Content $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
      $idx = $line.IndexOf('=')
      $envMap[$line.Substring(0, $idx).Trim()] = $line.Substring($idx + 1).Trim()
    }
  }
}

$EffectivePort = if ($envMap['AETHERA_REMOTE_PORT']) { [int]$envMap['AETHERA_REMOTE_PORT'] } else { $Port }
$Token = $envMap['AETHERA_REMOTE_TOKEN']

Write-Host "=== Verificando Aethera Remote Host (127.0.0.1:$EffectivePort) ===" -ForegroundColor Cyan
try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:$EffectivePort/api/health" -TimeoutSec 3
  Write-Host "Health     : ONLINE | versão $($health.version) | contrato v$($health.schemaVersion) | modo $($health.engineMode)" -ForegroundColor Green
} catch {
  Write-Host 'Health     : OFFLINE (inicie com start-remote-host.ps1)' -ForegroundColor Red
  exit 1
}

if ($Token) {
  $headers = @{ Authorization = "Bearer $Token" }
  try {
    $status = Invoke-RestMethod -Uri "http://127.0.0.1:$EffectivePort/api/host/status" -Headers $headers -TimeoutSec 5
    Write-Host "Host       : $($status.hostname) ($($status.platform)/$($status.arch))"
    Write-Host "CPU / RAM  : $($status.cpu.cores) núcleos ($($status.cpu.usagePct)%) | RAM $($status.memory.usedMb)/$($status.memory.totalMb) MB ($($status.memory.usagePct)%)"
    if ($status.gpus.Count -gt 0) {
      foreach ($g in $status.gpus) {
        Write-Host "GPU        : $($g.name) | NVENC: $($g.nvencSupported) | VRAM: $($g.vramUsedMb)/$($g.vramTotalMb) MB" -ForegroundColor Green
      }
    } else {
      Write-Host 'GPU        : Nenhuma GPU dedicada detectada (usará libx264 CPU)' -ForegroundColor Yellow
    }

    $agents = Invoke-RestMethod -Uri "http://127.0.0.1:$EffectivePort/api/agents" -Headers $headers -TimeoutSec 5
    Write-Host "Agentes    : $($agents.availableCount) disponível(is) | Solo Ready: $($agents.soloModeReady)"
    foreach ($a in $agents.agents) {
      $flag = if ($a.available) { '[OK]' } else { '[--]' }
      Write-Host "  $flag $($a.label) $($a.version) $($a.problem)"
    }
  } catch {
    Write-Host "Erro ao consultar /api/host/status: $_" -ForegroundColor Red
  }
}

try {
  $tunnels = Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 2
  foreach ($t in $tunnels.tunnels) {
    Write-Host "Túnel ngrok: $($t.public_url) -> $($t.config.addr)" -ForegroundColor Magenta
  }
} catch {
  Write-Host 'Túnel ngrok: Nenhum túnel ngrok detectado em 127.0.0.1:4040.' -ForegroundColor Yellow
}
