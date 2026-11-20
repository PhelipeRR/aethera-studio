<#
.SYNOPSIS
  Inicia o Aethera Remote Host em 127.0.0.1:4848 e opcionalmente abre o túnel HTTPS (ngrok ou Cloudflare Tunnel).
.DESCRIPTION
  - Gera automaticamente um token Bearer criptográfico em apps\aethera-remote-host\.env.local se ainda não existir.
  - Inicia o servidor escutando EXCLUSIVAMENTE em 127.0.0.1 (porta padrão 4848, sem conflito com localhost:8080).
  - Inicia ngrok (padrão) ou cloudflared apontando para http://127.0.0.1:4848 e exibe a URL HTTPS pública.
.EXAMPLE
  .\apps\aethera-remote-host\scripts\start-remote-host.ps1 -Tunnel ngrok
.EXAMPLE
  .\apps\aethera-remote-host\scripts\start-remote-host.ps1 -Tunnel cloudflared -Port 4848
.EXAMPLE
  .\apps\aethera-remote-host\scripts\start-remote-host.ps1 -Tunnel none
#>
[CmdletBinding()]
param(
  [int]$Port = 4848,
  [ValidateSet('ngrok', 'cloudflared', 'none')]
  [string]$Tunnel = 'ngrok',
  [string]$AllowedOrigins = 'http://localhost:3000,http://127.0.0.1:3000,https://*.run.app,https://*.ngrok-free.app,https://*.ngrok-free.dev,https://*.trycloudflare.com'
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$HostAppDir = Resolve-Path (Join-Path $ScriptDir '..')
$RepoRoot = Resolve-Path (Join-Path $HostAppDir '..\..')
$EnvFile = Join-Path $HostAppDir '.env.local'
$PidDir = Join-Path $env:LOCALAPPDATA 'AetheraRemoteHost\run'
New-Item -ItemType Directory -Force -Path $PidDir | Out-Null

# 1. Garantir token forte em .env.local (nunca versionado)
if (-not (Test-Path $EnvFile)) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $token = [Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=')

  @"
AETHERA_REMOTE_BIND_HOST=127.0.0.1
AETHERA_REMOTE_PORT=$Port
AETHERA_REMOTE_TOKEN=$token
AETHERA_ALLOWED_ORIGINS=$AllowedOrigins
AETHERA_RATE_LIMIT_WINDOW_MS=60000
AETHERA_RATE_LIMIT_MAX=240
"@ | Set-Content -Path $EnvFile -Encoding UTF8

  Write-Host '[Aethera Remote] Arquivo .env.local criado com token Bearer seguro.' -ForegroundColor Green
}

# Ler token e porta do .env.local
$envMap = @{}
Get-Content $EnvFile | ForEach-Object {
  $line = $_.Trim()
  if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
    $idx = $line.IndexOf('=')
    $envMap[$line.Substring(0, $idx).Trim()] = $line.Substring($idx + 1).Trim()
  }
}

$EffectivePort = if ($envMap['AETHERA_REMOTE_PORT']) { [int]$envMap['AETHERA_REMOTE_PORT'] } else { $Port }
$Token = $envMap['AETHERA_REMOTE_TOKEN']
if (-not $Token) {
  throw 'AETHERA_REMOTE_TOKEN está vazio em .env.local. Preencha ou remova .env.local para gerar um novo.'
}

# 2. Verificar se já existe Remote Host saudável
$healthUrl = "http://127.0.0.1:$EffectivePort/api/health"
$alreadyUp = $false
try {
  $resp = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
  if ($resp.ok -eq $true) { $alreadyUp = $true }
} catch {
  $alreadyUp = $false
}

if (-not $alreadyUp) {
  Write-Host "[Aethera Remote] Iniciando Aethera Remote Host em 127.0.0.1:$EffectivePort ..." -ForegroundColor Cyan
  $hostLogOut = Join-Path $PidDir 'remote-host.out.log'
  $hostLogErr = Join-Path $PidDir 'remote-host.err.log'
  $npxPath = (Get-Command npx.cmd -ErrorAction Stop).Source

  $hostProc = Start-Process -FilePath $npxPath `
    -ArgumentList @('tsx', 'apps/aethera-remote-host/src/server.ts') `
    -WorkingDirectory $RepoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $hostLogOut `
    -RedirectStandardError $hostLogErr `
    -PassThru

  $hostProc.Id | Set-Content -Path (Join-Path $PidDir 'host.pid') -Encoding ASCII

  $ready = $false
  for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Milliseconds 400
    try {
      $resp = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
      if ($resp.ok -eq $true) { $ready = $true; break }
    } catch {}
  }

  if (-not $ready) {
    Write-Host '[Aethera Remote] Falha ao subir o Remote Host. Últimas linhas do log:' -ForegroundColor Red
    if (Test-Path $hostLogErr) { Get-Content $hostLogErr -Tail 25 }
    exit 1
  }
  Write-Host "[Aethera Remote] Host online em http://127.0.0.1:$EffectivePort (PID $($hostProc.Id))." -ForegroundColor Green
} else {
  Write-Host "[Aethera Remote] Host já está ativo em http://127.0.0.1:$EffectivePort." -ForegroundColor Yellow
}

# 3. Iniciar túnel HTTPS seguro
$publicUrl = $null
if ($Tunnel -eq 'ngrok') {
  $ngrokCmd = Get-Command ngrok -ErrorAction SilentlyContinue
  if (-not $ngrokCmd) {
    Write-Host '[Aethera Remote] AVISO: ngrok não encontrado no PATH. Instale ou rode com -Tunnel cloudflared.' -ForegroundColor Yellow
  } else {
    # Verificar se já existe um túnel ngrok ativo apontando para outra porta (ex.: localhost:8080)
    $existingWrongTunnel = $null
    try {
      $existing = Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 2
      $matching = $existing.tunnels | Where-Object { $_.public_url -like 'https://*' -and $_.config.addr -match ":$EffectivePort$" } | Select-Object -First 1
      if ($matching) {
        $publicUrl = $matching.public_url
        Write-Host "[Aethera Remote] Túnel ngrok já apontando para 127.0.0.1:$EffectivePort ($publicUrl)." -ForegroundColor Green
      } else {
        $existingWrongTunnel = $existing.tunnels | Select-Object -First 1
      }
    } catch {}

    if (-not $publicUrl) {
      if ($existingWrongTunnel) {
        Write-Host "[Aethera Remote] Encerrando túnel ngrok antigo que apontava para $($existingWrongTunnel.config.addr)..." -ForegroundColor Yellow
        Get-Process -Name 'ngrok' -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Milliseconds 600
      }

      Write-Host "[Aethera Remote] Iniciando túnel HTTPS ngrok para http://127.0.0.1:$EffectivePort ..." -ForegroundColor Cyan
      $tunnelProc = Start-Process -FilePath $ngrokCmd.Source `
        -ArgumentList @('http', "http://127.0.0.1:$EffectivePort", '--log=stdout') `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $PidDir 'tunnel.out.log') `
        -RedirectStandardError (Join-Path $PidDir 'tunnel.err.log') `
        -PassThru
      $tunnelProc.Id | Set-Content -Path (Join-Path $PidDir 'tunnel.pid') -Encoding ASCII

      for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 500
        try {
          $tunnels = Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 2
          $httpsTunnel = $tunnels.tunnels | Where-Object { $_.public_url -like 'https://*' -and $_.config.addr -match ":$EffectivePort$" } | Select-Object -First 1
          if ($httpsTunnel) {
            $publicUrl = $httpsTunnel.public_url
            break
          }
        } catch {}
      }
    }
  }
} elseif ($Tunnel -eq 'cloudflared') {
  $cfCmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if (-not $cfCmd) {
    Write-Host '[Aethera Remote] AVISO: cloudflared não encontrado no PATH.' -ForegroundColor Yellow
  } else {
    Write-Host "[Aethera Remote] Iniciando Cloudflare Tunnel para http://127.0.0.1:$EffectivePort ..." -ForegroundColor Cyan
    $cfLog = Join-Path $PidDir 'tunnel.err.log'
    $tunnelProc = Start-Process -FilePath $cfCmd.Source `
      -ArgumentList @('tunnel', '--url', "http://127.0.0.1:$EffectivePort") `
      -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $PidDir 'tunnel.out.log') `
      -RedirectStandardError $cfLog `
      -PassThru
    $tunnelProc.Id | Set-Content -Path (Join-Path $PidDir 'tunnel.pid') -Encoding ASCII

    for ($i = 0; $i -lt 25; $i++) {
      Start-Sleep -Milliseconds 500
      if (Test-Path $cfLog) {
        $content = Get-Content $cfLog -Raw
        if ($content -match '(https://[a-z0-9-]+\.trycloudflare\.com)') {
          $publicUrl = $Matches[1]
          break
        }
      }
    }
  }
}

Write-Host ''
Write-Host '================ AETHERA REMOTE STUDIO ================' -ForegroundColor Magenta
Write-Host "Host local : http://127.0.0.1:$EffectivePort (somente loopback)"
if ($publicUrl) {
  Write-Host "URL HTTPS  : $publicUrl" -ForegroundColor Green
} else {
  Write-Host 'URL HTTPS  : (nenhum túnel ativo ou ainda inicializando — rode status-remote-host.ps1)' -ForegroundColor Yellow
}
Write-Host "Token      : $($Token.Substring(0, 8))... (completo salvo em apps\aethera-remote-host\.env.local)"
Write-Host 'Dica       : No Aethera Web, abra a aba "Remote Host", informe a URL HTTPS e cole o token do .env.local.'
Write-Host '=======================================================' -ForegroundColor Magenta
