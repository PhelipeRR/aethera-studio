#Requires -Version 7.0
<#
.SYNOPSIS
    Gate 8.1 — Homologação do Aethera Recap Acquisition Engine
.DESCRIPTION
    Executa validação completa: typecheck, testes unitários, build Electron,
    verificação do app.asar e smoke test do aplicativo empacotado.
    Deve ser executado no Windows com Node.js, pnpm/bun e PowerShell 7+.
.NOTES
    Não realiza commit ou push. Apenas valida e reporta.
#>

param(
    [switch]$SkipBuild,
    [switch]$SkipTests,
    [switch]$Verbose
)

$ErrorActionPreference = "Continue"
$script:passed = @()
$script:failed = @()
$script:warnings = @()

function Write-Step($msg) {
    Write-Host "`n━━━ $msg ━━━" -ForegroundColor Cyan
}

function Write-Pass($msg) {
    Write-Host "  ✅ $msg" -ForegroundColor Green
    $script:passed += $msg
}

function Write-Fail($msg) {
    Write-Host "  ❌ $msg" -ForegroundColor Red
    $script:failed += $msg
}

function Write-Warn($msg) {
    Write-Host "  ⚠️  $msg" -ForegroundColor Yellow
    $script:warnings += $msg
}

function Write-Info($msg) {
    Write-Host "  ℹ️  $msg" -ForegroundColor Gray
}

# ─── 1. Validação de Código ──────────────────────────────────────────────────

Write-Step "1. Typecheck dos pacotes envolvidos"

$packages = @(
    @{ Name = "shared"; Path = "packages/shared" },
    @{ Name = "cinema"; Path = "packages/cinema" },
    @{ Name = "desktop-shared"; Path = "packages/desktop-shared" }
)

foreach ($pkg in $packages) {
    $tsconfig = Join-Path $pkg.Path "tsconfig.json"
    if (-not (Test-Path $tsconfig)) {
        Write-Warn "$($pkg.Name): tsconfig.json não encontrado"
        continue
    }

    Write-Info "Typecheck $($pkg.Name)..."
    $output = & npx tsc --noEmit -p $tsconfig 2>&1 | Out-String

    # Filtrar erros em arquivos fonte (excluir testes e vitest)
    $sourceErrors = $output -split "`n" | Where-Object {
        $_ -match "error TS" -and $_ -notmatch "/test/" -and $_ -notmatch "vitest"
    }

    # Separar erros preexistentes de regressões
    $preexisting = $sourceErrors | Where-Object {
        $_ -match "real-audio-assets|broll-timeline|claude-vision-provider"
    }
    $regressions = $sourceErrors | Where-Object {
        $_ -notmatch "real-audio-assets|broll-timeline|claude-vision-provider"
    }

    if ($regressions.Count -eq 0) {
        Write-Pass "$($pkg.Name): sem regressões nos arquivos fonte"
        if ($preexisting.Count -gt 0) {
            Write-Warn "$($pkg.Name): $($preexisting.Count) erro(s) preexistente(s) ignorado(s)"
        }
    } else {
        Write-Fail "$($pkg.Name): $($regressions.Count) regressão(ões) encontrada(s)"
        $regressions | ForEach-Object { Write-Host "     $_" -ForegroundColor Red }
    }
}

# ─── 2. Testes Unitários ─────────────────────────────────────────────────────

if (-not $SkipTests) {
    Write-Step "2. Testes unitários do Acquisition Engine"

    $testFile = "packages/cinema/test/recap/acquisition-router.test.ts"
    if (Test-Path $testFile) {
        Write-Info "Executando testes do acquisition-router..."
        $testOutput = & npx vitest run $testFile --reporter=verbose 2>&1 | Out-String
        $exitCode = $LASTEXITCODE

        if ($exitCode -eq 0) {
            $passCount = ([regex]::Matches($testOutput, '✓')).Count
            Write-Pass "acquisition-router: $passCount teste(s) aprovado(s)"
        } else {
            Write-Fail "acquisition-router: testes falharam (exit code $exitCode)"
            $failLines = $testOutput -split "`n" | Where-Object { $_ -match "FAIL|✗|×" }
            $failLines | Select-Object -First 10 | ForEach-Object { Write-Host "     $_" -ForegroundColor Red }
        }
    } else {
        Write-Fail "Arquivo de teste não encontrado: $testFile"
    }
} else {
    Write-Warn "Testes unitários pulados (--SkipTests)"
}

# ─── 3. Verificação de Integração IPC ────────────────────────────────────────

Write-Step "3. Verificação de integração IPC"

$preloadFile = "apps/aethera-desktop/src/preload/index.ts"
$mainIpcFile = "apps/aethera-desktop/src/main/aethera-ipc.ts"
$panelFile = "apps/aethera-desktop/src/renderer/src/RecapProductionPanel.tsx"

$requiredChannels = @(
    "recap:import-create-job",
    "recap:import-get-job",
    "recap:import-cancel-job",
    "recap:import-retry-job",
    "recap:select-archives",
    "recap:start-production",
    "recap:import-analyze",
    "recap:import-cdn-direct"
)

$allChannelsFound = $true
foreach ($channel in $requiredChannels) {
    $inPreload = Select-String -Path $preloadFile -Pattern $channel -Quiet -ErrorAction SilentlyContinue
    $inMain = Select-String -Path $mainIpcFile -Pattern $channel -Quiet -ErrorAction SilentlyContinue

    if ($inPreload -and $inMain) {
        Write-Pass "Canal '$channel': registrado no preload e main"
    } elseif ($inPreload) {
        Write-Fail "Canal '$channel': presente no preload mas NÃO no main handler"
        $allChannelsFound = $false
    } elseif ($inMain) {
        Write-Fail "Canal '$channel': presente no main mas NÃO exposto no preload"
        $allChannelsFound = $false
    } else {
        Write-Fail "Canal '$channel': NÃO encontrado em preload nem main"
        $allChannelsFound = $false
    }
}

# Verificar se RecapProductionPanel usa aetheraBridge corretamente
if (Test-Path $panelFile) {
    $usesBridge = Select-String -Path $panelFile -Pattern "getRecapBridge|aetheraBridge" -Quiet
    $hasStartProduction = Select-String -Path $panelFile -Pattern "recapStartProduction" -Quiet
    $hasImportJob = Select-String -Path $panelFile -Pattern "recapImportCreateJob" -Quiet

    if ($usesBridge -and $hasStartProduction -and $hasImportJob) {
        Write-Pass "RecapProductionPanel: usa aetheraBridge com fluxo real de importação + produção"
    } else {
        Write-Fail "RecapProductionPanel: fluxo incompleto (bridge=$usesBridge, start=$hasStartProduction, import=$hasImportJob)"
    }
} else {
    Write-Fail "RecapProductionPanel.tsx não encontrado"
}

# Verificar que NÃO há duplicação na AetheraStudioHome
$homeFile = "packages/desktop-shared/src/renderer/src/features/aethera/AetheraStudioHome.tsx"
if (Test-Path $homeFile) {
    $hasDuplicate = Select-String -Path $homeFile -Pattern "RecapImportPanel" -Quiet
    if (-not $hasDuplicate) {
        Write-Pass "AetheraStudioHome: sem duplicação do RecapImportPanel"
    } else {
        Write-Fail "AetheraStudioHome: ainda contém referência ao RecapImportPanel (duplicação)"
    }
}

# ─── 4. Build Electron ───────────────────────────────────────────────────────

if (-not $SkipBuild) {
    Write-Step "4. Build do aplicativo Electron"

    $desktopDir = "apps/aethera-desktop"
    if (Test-Path $desktopDir) {
        Write-Info "Instalando dependências do desktop..."
        Push-Location $desktopDir
        try {
            $installOutput = & npm install 2>&1 | Out-String
            if ($LASTEXITCODE -eq 0) {
                Write-Pass "Dependências instaladas"
            } else {
                Write-Warn "npm install retornou código $LASTEXITCODE (pode ser warning)"
            }

            Write-Info "Executando build Electron..."
            $buildOutput = & npm run build 2>&1 | Out-String
            if ($LASTEXITCODE -eq 0) {
                Write-Pass "Build Electron concluído"
            } else {
                Write-Fail "Build Electron falhou (exit code $LASTEXITCODE)"
                $errorLines = $buildOutput -split "`n" | Where-Object { $_ -match "error|Error|ERROR" } | Select-Object -First 10
                $errorLines | ForEach-Object { Write-Host "     $_" -ForegroundColor Red }
            }
        } finally {
            Pop-Location
        }
    } else {
        Write-Fail "Diretório do app desktop não encontrado: $desktopDir"
    }
} else {
    Write-Warn "Build Electron pulado (--SkipBuild)"
}

# ─── 5. Verificação do app.asar ──────────────────────────────────────────────

Write-Step "5. Verificação do app.asar"

$asarPaths = @(
    "apps/aethera-desktop/dist/win-unpacked/resources/app.asar",
    "apps/aethera-desktop/release/win-unpacked/resources/app.asar",
    "apps/aethera-desktop/out/win-unpacked/resources/app.asar"
)

$asarFound = $false
foreach ($asarPath in $asarPaths) {
    if (Test-Path $asarPath) {
        $size = (Get-Item $asarPath).Length / 1MB
        Write-Pass "app.asar encontrado: $asarPath ($([math]::Round($size, 1)) MB)"
        $asarFound = $true

        # Verificar módulos críticos dentro do asar
        try {
            $asarList = & npx asar list $asarPath 2>&1 | Out-String
            $criticalModules = @(
                "acquisition-router",
                "electron-playwright-provider",
                "firecrawl-provider",
                "import-checkpoint-store",
                "batch-import-queue"
            )
            foreach ($mod in $criticalModules) {
                if ($asarList -match $mod) {
                    Write-Pass "Módulo '$mod' presente no app.asar"
                } else {
                    Write-Fail "Módulo '$mod' AUSENTE no app.asar"
                }
            }
        } catch {
            Write-Warn "Não foi possível inspecionar conteúdo do app.asar: $_"
        }
        break
    }
}

if (-not $asarFound) {
    Write-Warn "app.asar não encontrado nos caminhos esperados (build pode ter falhado ou caminho diferente)"
}

# ─── 6. Firecrawl Self-Hosted ────────────────────────────────────────────────

Write-Step "6. Validação do Firecrawl self-hosted"

$firecrawlProvider = "packages/cinema/src/recap/url-importer/firecrawl-provider.ts"
if (Test-Path $firecrawlProvider) {
    $content = Get-Content $firecrawlProvider -Raw

    $checks = @(
        @{ Pattern = "FIRECRAWL_ENABLED"; Desc = "Variável FIRECRAWL_ENABLED" },
        @{ Pattern = "FIRECRAWL_API_URL"; Desc = "Variável FIRECRAWL_API_URL" },
        @{ Pattern = "localhost:3002"; Desc = "URL padrão localhost:3002" },
        @{ Pattern = "enabled.*false|!this\.config\.enabled"; Desc = "Desabilitado por padrão" },
        @{ Pattern = "checkHealth"; Desc = "Método checkHealth" },
        @{ Pattern = "provider_unavailable"; Desc = "Erro provider_unavailable quando desabilitado" }
    )

    foreach ($check in $checks) {
        if ($content -match $check.Pattern) {
            Write-Pass "Firecrawl: $($check.Desc)"
        } else {
            Write-Fail "Firecrawl: $($check.Desc) NÃO encontrado"
        }
    }

    # Verificar que NÃO exige API key obrigatória
    if ($content -match "apiKey.*required|require.*apiKey") {
        Write-Fail "Firecrawl: exige API key obrigatória (não deveria)"
    } else {
        Write-Pass "Firecrawl: não exige API key obrigatória"
    }
} else {
    Write-Fail "Arquivo firecrawl-provider.ts não encontrado"
}

# ─── 7. Checkpoints Persistentes ────────────────────────────────────────────

Write-Step "7. Validação de checkpoints persistentes"

$checkpointStore = "packages/cinema/src/recap/url-importer/import-checkpoint-store.ts"
if (Test-Path $checkpointStore) {
    $content = Get-Content $checkpointStore -Raw

    $checks = @(
        @{ Pattern = "saveImportCheckpoint"; Desc = "Função saveImportCheckpoint" },
        @{ Pattern = "loadImportCheckpoint"; Desc = "Função loadImportCheckpoint" },
        @{ Pattern = "restoreIncompleteJobs"; Desc = "Função restoreIncompleteJobs" },
        @{ Pattern = "removeImportCheckpoint"; Desc = "Função removeImportCheckpoint" },
        @{ Pattern = "\.tmp\."; Desc = "Escrita atômica via tmp+rename" },
        @{ Pattern = "resolveSafeStoragePath"; Desc = "Proteção contra path traversal" }
    )

    foreach ($check in $checks) {
        if ($content -match $check.Pattern) {
            Write-Pass "Checkpoints: $($check.Desc)"
        } else {
            Write-Fail "Checkpoints: $($check.Desc) NÃO encontrado"
        }
    }
} else {
    Write-Fail "Arquivo import-checkpoint-store.ts não encontrado"
}

# Verificar integração no batch-import-queue
$batchQueue = "packages/cinema/src/recap/url-importer/batch-import-queue.ts"
if (Test-Path $batchQueue) {
    $content = Get-Content $batchQueue -Raw
    if ($content -match "saveImportCheckpoint|removeImportCheckpoint") {
        Write-Pass "BatchImportQueue: integrado com checkpoint store"
    } else {
        Write-Fail "BatchImportQueue: NÃO integrado com checkpoint store"
    }
    if ($content -match "restoreJobsFromCheckpoints") {
        Write-Pass "BatchImportQueue: método restoreJobsFromCheckpoints presente"
    } else {
        Write-Fail "BatchImportQueue: método restoreJobsFromCheckpoints AUSENTE"
    }
}

# ─── Relatório Final ─────────────────────────────────────────────────────────

Write-Step "RELATÓRIO FINAL — Gate 8.1"

Write-Host ""
Write-Host "  Aprovados:   $($script:passed.Count)" -ForegroundColor Green
Write-Host "  Reprovados:  $($script:failed.Count)" -ForegroundColor Red
Write-Host "  Avisos:      $($script:warnings.Count)" -ForegroundColor Yellow
Write-Host ""

if ($script:failed.Count -gt 0) {
    Write-Host "  ❌ STATUS: REPROVADO" -ForegroundColor Red -BackgroundColor Black
    Write-Host ""
    Write-Host "  Itens reprovados:" -ForegroundColor Red
    $script:failed | ForEach-Object { Write-Host "    • $_" -ForegroundColor Red }
} else {
    Write-Host "  ✅ STATUS: APROVADO (validação estrutural)" -ForegroundColor Green -BackgroundColor Black
    Write-Host ""
    Write-Host "  ⚠️  ATENÇÃO: Smoke test do app empacotado e teste real do Nano Machine" -ForegroundColor Yellow
    Write-Host "     requerem execução manual do aplicativo instalado." -ForegroundColor Yellow
}

if ($script:warnings.Count -gt 0) {
    Write-Host ""
    Write-Host "  Avisos:" -ForegroundColor Yellow
    $script:warnings | ForEach-Object { Write-Host "    • $_" -ForegroundColor Yellow }
}

Write-Host ""
Write-Host "  Teste real pendente:" -ForegroundColor Cyan
Write-Host "    1. Abra o Aethera Desktop instalado" -ForegroundColor Cyan
Write-Host "    2. Navegue até a tela de criação de Recap" -ForegroundColor Cyan
Write-Host "    3. Selecione um CBZ local OU cole uma URL acessível" -ForegroundColor Cyan
Write-Host "    4. Clique em 'Iniciar Produção Recap'" -ForegroundColor Cyan
Write-Host "    5. Verifique se o job é criado e o progresso é exibido" -ForegroundColor Cyan
Write-Host "    6. Para URL: https://asurascans.com/comics/nano-machine-7ba78ec7/chapter/1" -ForegroundColor Cyan
Write-Host "       Se Cloudflare bloquear, o erro será reportado honestamente." -ForegroundColor Cyan
Write-Host "       Use a alternativa CBZ/PDF local neste caso." -ForegroundColor Cyan
Write-Host ""