#!/usr/bin/env node
/**
 * Corrige a corrupção do package.json dentro do app.asar.
 * O electron-builder tem um bug conhecido onde offsets ficam desalinhados,
 * causando prefixo HTML ("</html>\n") antes do JSON válido.
 *
 * Este script extrai o header, detecta e remove o prefixo corrompido,
 * recalcula todos os offsets, e reescreve o asar corrigido.
 *
 * Uso: node apps/aethera-desktop/scripts/fix-asar-corruption.mjs [caminho-para-app.asar]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const asarPath = process.argv[2] || resolve(__dirname, '../../../dist/aethera/win-unpacked/resources/app.asar');

if (!existsSync(asarPath)) {
  console.error(`❌ app.asar não encontrado em: ${asarPath}`);
  process.exit(1);
}

console.log(`📦 Lendo: ${asarPath}`);
const buf = readFileSync(asarPath);

// Parse do header ASAR
const jsonStart = 16;
let depth = 0, jsonEnd = -1;
for (let i = jsonStart; i < Math.min(buf.length, 50 * 1024 * 1024); i++) {
  if (buf[i] === 0x7b) depth++;
  if (buf[i] === 0x7d) { depth--; if (depth === 0) { jsonEnd = i + 1; break; } }
}

if (jsonEnd < 0) {
  console.error('❌ Não foi possível encontrar o fim do JSON no header');
  process.exit(1);
}

const headerJson = buf.slice(jsonStart, jsonEnd).toString('utf8');
const header = JSON.parse(headerJson);
const dataOffset = jsonEnd + (buf.readUInt32LE(12) - buf.readUInt32LE(8));

console.log(`📊 Header: ${jsonEnd - jsonStart} bytes, Dados começam em: ${dataOffset}`);

// Função para percorrer e corrigir offsets recursivamente
function fixOffsets(node, currentDataBuf, offsetAdjustments) {
  if (!node.files) return;

  for (const [name, entry] of Object.entries(node.files)) {
    if (entry.files) {
      fixOffsets(entry, currentDataBuf, offsetAdjustments);
    } else if (entry.offset !== undefined) {
      const absOffset = parseInt(entry.offset) + dataOffset;
      const size = entry.size;

      // Verifica se este arquivo é o package.json da raiz
      // Precisamos verificar pelo caminho completo, mas aqui só temos o nó
      // Vamos verificar lendo os primeiros bytes do conteúdo
      if (size > 0 && size < 10000) { // package.json é pequeno
        const content = currentDataBuf.slice(absOffset, absOffset + Math.min(size, 100));
        const contentStr = content.toString('utf8');

        if (contentStr.trimStart().startsWith('</') || contentStr.trimStart().startsWith('<!')) {
          // Encontrou arquivo corrompido! Procura onde começa o JSON real
          const fullContent = currentDataBuf.slice(absOffset, absOffset + size).toString('utf8');
          const jsonIdx = fullContent.indexOf('{');

          if (jsonIdx > 0) {
            console.log(`⚠️  Corrupção detectada em offset ${entry.offset} (${jsonIdx} bytes de prefixo HTML)`);
            console.log(`   Prefixo: ${JSON.stringify(fullContent.substring(0, Math.min(jsonIdx, 50)))}`);

            // Registra o ajuste necessário
            offsetAdjustments.push({
              originalOffset: parseInt(entry.offset),
              prefixSize: jsonIdx,
              originalSize: size,
              newSize: size - jsonIdx
            });
          }
        }
      }
    }
  }
}

const adjustments = [];
fixOffsets(header, buf, adjustments);

if (adjustments.length === 0) {
  console.log('✅ Nenhuma corrupção detectada no asar');
  process.exit(0);
}

console.log(`\n🔧 Aplicando ${adjustments.length} correção(ões)...`);

// Para cada arquivo corrompido, precisamos:
// 1. Remover o prefixo HTML dos dados
// 2. Recalcular todos os offsets subsequentes

// Simplificação: como só o package.json está corrompido e ele é o último arquivo
// (offset mais alto), podemos simplesmente truncar o prefixo e ajustar o offset dele

// Ordena ajustes por offset decrescente para processar do final para o início
adjustments.sort((a, b) => b.originalOffset - a.originalOffset);

// Cria novo buffer de dados sem os prefixos corrompidos
let newDataBuf = Buffer.from(buf.slice(dataOffset));

for (const adj of adjustments) {
  const relOffset = adj.originalOffset; // offset relativo ao início dos dados

  // Remove o prefixo: copia tudo antes, pula o prefixo, copia o resto
  const before = newDataBuf.slice(0, relOffset);
  const after = newDataBuf.slice(relOffset + adj.prefixSize);
  newDataBuf = Buffer.concat([before, after]);

  console.log(`   Removidos ${adj.prefixSize} bytes no offset relativo ${relOffset}`);
}

// Agora precisamos recalcular TODOS os offsets no header
// porque removemos bytes dos dados
function recalculateOffsets(node, adjustmentMap) {
  if (!node.files) return;

  for (const [name, entry] of Object.entries(node.files)) {
    if (entry.files) {
      recalculateOffsets(entry, adjustmentMap);
    } else if (entry.offset !== undefined) {
      let origOff = parseInt(entry.offset);

      // Aplica ajustes cumulativos: para cada remoção que ocorreu ANTES deste offset,
      // subtrai o tamanho removido
      let newOff = origOff;
      for (const adj of adjustmentMap) {
        if (adj.originalOffset < origOff) {
          newOff -= adj.prefixSize;
        } else if (adj.originalOffset === origOff) {
          // Este é o próprio arquivo corrompido - seu offset não muda,
          // mas seu tamanho diminui
          entry.size = adj.newSize;
        }
      }

      entry.offset = String(newOff);
    }
  }
}

recalculateOffsets(header, adjustments);

// Reconstrói o header JSON
const newHeaderJson = JSON.stringify(header);
const newHeaderBuf = Buffer.from(newHeaderJson, 'utf8');

// Formato ASAR:
// [4 bytes: pickle size][4 bytes: header size][4 bytes: header string size][header string][data]
// pickle size = header size + 8 (para os dois campos de tamanho seguintes)
// header size = tamanho total do pickle do header (header string size + 4 + header string length padded)

// O formato original usa padding para alinhamento. Vamos preservar o mesmo esquema.
const originalPickleSize = buf.readUInt32LE(0);
const originalHeaderSize = buf.readUInt32LE(4);
const originalHeaderStringSize = buf.readUInt32LE(8);

// Calcula novos tamanhos mantendo o mesmo formato de pickle
const newHeaderStringSize = newHeaderBuf.length;
// O pickle do header string é: [4 bytes size][string bytes][padding para alinhar a 4 bytes]
const headerStringPaddedSize = Math.ceil((4 + newHeaderStringSize) / 4) * 4;
const newHeaderSize = headerStringPaddedSize;
const newPickleSize = newHeaderSize + 8; // +8 para os dois uint32 do envelope externo

// Constrói o novo buffer
const result = Buffer.alloc(16 + headerStringPaddedSize + newDataBuf.length);

// Envelope externo
result.writeUInt32LE(4, 0); // pickle size do envelope (sempre 4 para o header size seguinte)
result.writeUInt32LE(newHeaderSize, 4); // tamanho do pickle do header
result.writeUInt32LE(newHeaderStringSize, 8); // tamanho da string do header
newHeaderBuf.copy(result, 12); // string do header

// Padding já está zerado pelo Buffer.alloc

// Dados
newDataBuf.copy(result, 16 + headerStringPaddedSize);

// Backup e escrita
const backupPath = asarPath + '.bak';
writeFileSync(backupPath, buf);
console.log(`💾 Backup salvo em: ${backupPath}`);

writeFileSync(asarPath, result);
console.log(`✅ app.asar corrigido e salvo!`);
console.log(`   Tamanho original: ${buf.length} bytes`);
console.log(`   Tamanho corrigido: ${result.length} bytes`);
console.log(`   Diferença: ${result.length - buf.length} bytes`);

// Validação rápida
const checkBuf = readFileSync(asarPath);
const checkJsonStart = 16;
let cd = 0, ce = -1;
for (let i = checkJsonStart; i < Math.min(checkBuf.length, 50*1024*1024); i++) {
  if (checkBuf[i] === 0x7b) cd++;
  if (checkBuf[i] === 0x7d) { cd--; if (cd === 0) { ce = i + 1; break; } }
}
const checkHeader = JSON.parse(checkBuf.slice(checkJsonStart, ce).toString('utf8'));
const checkDataOff = ce + (checkBuf.readUInt32LE(12) - checkBuf.readUInt32LE(8));

// Lê o package.json corrigido
const pkgNode = checkHeader.files['package.json'];
if (pkgNode) {
  const pkgAbsOff = parseInt(pkgNode.offset) + checkDataOff;
  const pkgContent = checkBuf.slice(pkgAbsOff, pkgAbsOff + pkgNode.size).toString('utf8');
  if (pkgContent.trimStart().startsWith('{')) {
    console.log('✅ Validação: package.json começa com "{" — correção bem-sucedida!');
  } else {
    console.error('❌ Validação FALHOU: package.json ainda corrompido');
    console.error('   Primeiros 50 chars:', JSON.stringify(pkgContent.substring(0, 50)));
    process.exit(1);
  }
} else {
  console.error('❌ Validação FALHOU: package.json não encontrado no header corrigido');
  process.exit(1);
}