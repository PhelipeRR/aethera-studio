#!/usr/bin/env node
/**
 * Script de validação pós-build para o Aethera Studio.
 * Verifica a integridade do app.asar antes de gerar o instalador.
 *
 * Uso: node apps/aethera-desktop/scripts/validate-build.mjs [caminho-para-app.asar]
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const asarModule = process.env.AETHERA_ASAR_MODULE;

if (!asarModule) {
  console.error('AETHERA_ASAR_MODULE não configurado');
  process.exit(1);
}

const { pathToFileURL } = await import('node:url');
const { join } = await import('node:path');

const asar = await import(
  pathToFileURL(join(asarModule, 'lib', 'asar.js')).href
);
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// O output do electron-builder está em ../../dist/aethera a partir de apps/aethera-desktop,
// ou seja, na raiz do monorepo: dist/aethera/
const asarPath = process.argv[2] || resolve(__dirname, '../../../dist/aethera/win-unpacked/resources/app.asar');

if (!existsSync(asarPath)) {
  console.error(`❌ ERRO: app.asar não encontrado em: ${asarPath}`);
  process.exit(1);
}

console.log(`📦 Validando: ${asarPath}`);

const header = asar.getRawHeader(asarPath).header;

function extractFile(filePath) {
  try {
    return asar.extractFile(
      asarPath,
      filePath.replace(/^\/+/, '')
    );
  } catch {
    return null;
  }
}

function listFiles(obj, prefix = '') {
  const results = [];

  if (obj.files) {
    for (const [name, value] of Object.entries(obj.files)) {
      const fullPath = prefix + '/' + name;

      if (value.files) {
        results.push(...listFiles(value, fullPath));
      } else {
        results.push(fullPath);
      }
    }
  }

  return results;
}

const files = listFiles(header, '');
let errors = 0;

// 1. Valida entrypoint do Electron
console.log('\n🔍 Verificando entrypoint...');
const pkgBuf = extractFile('/package.json');
if (!pkgBuf) {
  console.error('  ❌ package.json NÃO encontrado na raiz do asar!');
  errors++;
} else {
  const pkgContent = pkgBuf.toString('utf8');

  // Verifica corrupção (prefixo HTML)
  if (pkgContent.trimStart().startsWith('</')) {
    console.error('  ❌ package.json CORROMPIDO: contém prefixo HTML!</html>');
    console.error('     Primeiros 50 chars:', JSON.stringify(pkgContent.substring(0, 50)));
    errors++;
  } else {
    try {
      const pkg = JSON.parse(pkgContent);
      const mainEntry = pkg.main;
      if (!mainEntry) {
        console.error('  ❌ Campo "main" ausente no package.json!');
        errors++;
      } else {
        const mainPath = '/' + mainEntry;
        if (files.includes(mainPath)) {
          console.log(`  ✅ Entrypoint válido: ${mainEntry}`);
        } else {
          console.error(`  ❌ Entrypoint "${mainEntry}" NÃO existe no asar!`);
          errors++;
        }
      }
    } catch (e) {
      console.error('  ❌ package.json não é JSON válido:', e.message);
      errors++;
    }
  }
}

// 2. Verifica arquivos obrigatórios
console.log('\n🔍 Verificando arquivos obrigatórios...');
const requiredFiles = [
  '/out/main/index.js',
  '/out/preload/index.js',
  '/out/renderer/index.html',
];

for (const f of requiredFiles) {
  if (files.includes(f)) {
    console.log(`  ✅ ${f}`);
  } else {
    console.error(`  ❌ ${f} NÃO ENCONTRADO!`);
    errors++;
  }
}

// 3. Verifica workers
console.log('\n🔍 Verificando workers...');
const workerFiles = files.filter(f => f.includes('worker') && f.endsWith('.js'));
if (workerFiles.length === 0) {
  console.warn('  ⚠️  Nenhum arquivo worker encontrado (pode ser esperado se não houver workers)');
} else {
  for (const w of workerFiles) {
    console.log(`  ✅ ${w}`);
  }
}

// 4. Verifica imports não resolvidos no entrypoint
console.log('\n🔍 Verificando imports no entrypoint...');
const indexBuf = extractFile('/out/main/index.js');
if (indexBuf) {
  const indexContent = indexBuf.toString('utf8');
  // Procura requires relativos que podem estar quebrados
  const relativeRequires = indexContent.match(/require\("\.\/[^"]+"\)/g) || [];
  const uniqueRequires = [...new Set(relativeRequires)];

  for (const req of uniqueRequires.slice(0, 10)) {
    const match = req.match(/require\("(\.\/[^"]+)"\)/);
    if (match) {
      const relPath = match[1];
      // Verifica se o arquivo existe nos chunks
      const expectedChunk = '/out/main/' + relPath.replace('./', '');
      const chunkExists = files.some(f => f.includes(relPath.replace('./', '')));
      if (!chunkExists) {
        console.warn(`  ⚠️  Import relativo possivelmente não resolvido: ${relPath}`);
      }
    }
  }
  console.log(`  ✅ ${uniqueRequires.length} imports relativos verificados`);
}

// 5. Resumo
console.log('\n' + '='.repeat(50));
if (errors === 0) {
  console.log('✅ VALIDAÇÃO APROVADA: app.asar está íntegro');
  process.exit(0);
} else {
  console.error(`❌ VALIDAÇÃO FALHOU: ${errors} erro(s) encontrado(s)`);
  process.exit(1);
}