#!/usr/bin/env node
/**
 * Wrapper de build que executa electron-builder e corrige o app.asar automaticamente.
 * Contorna bugs de hooks do electron-builder com bun executando a correção inline.
 *
 * Uso: node apps/aethera-desktop/scripts/build-and-fix.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(__dirname, '..');
const asarPath = resolve(appDir, '../../dist/aethera/win-unpacked/resources/app.asar');

// Passo 0: Garantir que os ícones canônicos do Aethera existam antes do empacotamento
const iconIcoPath = resolve(appDir, 'build/icon.ico');
const iconPngPath = resolve(appDir, 'build/icon.png');
if (!existsSync(iconIcoPath) || !existsSync(iconPngPath)) {
 console.log('🎨 Gerando ícones canônicos Aethera (icon.ico / icon.png)...');
 execSync('node scripts/generate-icon.mjs', { cwd: appDir, stdio: 'inherit' });
}

// Passo 1: Executar electron-builder
console.log('🔨 Executando electron-builder...');
try {
 execSync('bunx electron-builder --config electron-builder.yml --win', {
 cwd: appDir,
 stdio: 'inherit',
 });
 console.log('✅ electron-builder concluído\n');
} catch (e) {
 console.error('❌ electron-builder falhou:', e.message);
 process.exit(1);
}

// Passo 2: Verificar se o app.asar existe
if (!existsSync(asarPath)) {
 console.error(`❌ app.asar não encontrado em: ${asarPath}`);
 process.exit(1);
}

// Passo 3: Corrigir corrupção do package.json no asar
console.log('📦 Verificando integridade do app.asar...');
const buf = readFileSync(asarPath);

// Parse do header ASAR
const jsonStart = 16;
let depth = 0, jsonEnd = -1;
for (let i = jsonStart; i < Math.min(buf.length, 50 * 1024 * 1024); i++) {
 if (buf[i] === 0x7b) depth++;
 if (buf[i] === 0x7d) { depth--; if (depth === 0) { jsonEnd = i + 1; break; } }
}

if (jsonEnd < 0) {
 console.error('❌ Não foi possível parsear o header do asar');
 process.exit(1);
}

const header = JSON.parse(buf.slice(jsonStart, jsonEnd).toString('utf8'));
const dataOffset = jsonEnd + (buf.readUInt32LE(12) - buf.readUInt32LE(8));

// Verifica package.json
const pkgNode = header.files?.['package.json'];
if (!pkgNode) {
 console.error('❌ package.json não encontrado no header do asar');
 process.exit(1);
}

const pkgAbsOffset = parseInt(pkgNode.offset) + dataOffset;
const pkgContent = buf.slice(pkgAbsOffset, pkgAbsOffset + pkgNode.size).toString('utf8');

if (!pkgContent.trimStart().startsWith('</') && !pkgContent.trimStart().startsWith('<!')) {
 console.log('✅ package.json está íntegro — nenhuma correção necessária\n');
 // Executa validação
 try {
 execSync('node scripts/validate-build.mjs', { cwd: appDir, stdio: 'inherit' });
 } catch {}
 process.exit(0);
}

// Correção necessária
console.log('⚠️ Corrupção detectada no package.json!');
console.log(` Prefixo: ${JSON.stringify(pkgContent.substring(0, Math.min(50, pkgContent.indexOf('{'))))}`);

const jsonIdx = pkgContent.indexOf('{');
if (jsonIdx < 0) {
 console.error('❌ Não foi possível encontrar início do JSON válido');
 process.exit(1);
}

// Remove prefixo dos dados
const newDataBuf = Buffer.concat([
 buf.slice(dataOffset, pkgAbsOffset),
 buf.slice(pkgAbsOffset + jsonIdx),
]);

// Ajusta offset e tamanho do package.json
pkgNode.offset = String(parseInt(pkgNode.offset)); // offset não muda (é o último arquivo)
pkgNode.size = pkgNode.size - jsonIdx;

// Recalcula offsets de todos os arquivos APÓS o package.json (se houver)
function adjustOffsets(node, thresholdOffset, bytesRemoved) {
 if (!node.files) return;
 for (const entry of Object.values(node.files)) {
 if (entry.files) {
 adjustOffsets(entry, thresholdOffset, bytesRemoved);
 } else if (entry.offset !== undefined) {
 const off = parseInt(entry.offset);
 if (off > thresholdOffset) {
 entry.offset = String(off - bytesRemoved);
 }
 }
 }
}
adjustOffsets(header, parseInt(pkgNode.offset), jsonIdx);

// Reconstrói o asar
const newHeaderJson = JSON.stringify(header);
const newHeaderBuf = Buffer.from(newHeaderJson, 'utf8');
const headerStringPaddedSize = Math.ceil((4 + newHeaderBuf.length) / 4) * 4;
const newHeaderSize = headerStringPaddedSize;

const result = Buffer.alloc(16 + headerStringPaddedSize + newDataBuf.length);
result.writeUInt32LE(4, 0);
result.writeUInt32LE(newHeaderSize, 4);
result.writeUInt32LE(newHeaderBuf.length, 8);
newHeaderBuf.copy(result, 12);
newDataBuf.copy(result, 16 + headerStringPaddedSize);

// Backup e escrita
writeFileSync(asarPath + '.bak', buf);
writeFileSync(asarPath, result);
console.log(`✅ app.asar corrigido (${buf.length} → ${result.length} bytes)\n`);

// Passo 4: Validação final
console.log('🔍 Executando validação final...');
try {
 execSync('node scripts/validate-build.mjs', { cwd: appDir, stdio: 'inherit' });
 console.log('\n🎉 Build concluído com sucesso!');
} catch {
 console.error('\n❌ Validação falhou após correção');
 process.exit(1);
}