/**
 * Hook afterPack do electron-builder.
 * Verifica e corrige o package.json no diretório de staging ANTES de gerar o app.asar.
 *
 * Uso: referenciado em electron-builder.yml como afterPack.
 */
const fs = require('fs');
const path = require('path');

/**
 * @param {object} context - Contexto do electron-builder com appOutDir, packager, etc.
 */
module.exports = async function fixPackageJsonHook(context) {
  const { appOutDir, packager } = context;
  const pkgPath = path.join(appOutDir, 'resources', 'app.asar.unpacked', '..', 'package.json');

  // O package.json pode estar na raiz do appOutDir ou em resources/
  const candidates = [
    path.join(appOutDir, 'package.json'),
    path.join(appOutDir, 'resources', 'package.json'),
  ];

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;

    let content = fs.readFileSync(candidate, 'utf8');

    // Detecta corrupção: prefixo HTML antes do JSON
    const trimmed = content.trimStart();
    if (trimmed.startsWith('</') || trimmed.startsWith('<!')) {
      console.log(`[fix-package-json-hook] ⚠️  Corrupção detectada em ${candidate}`);
      console.log(`[fix-package-json-hook]    Primeiros 80 chars: ${JSON.stringify(content.substring(0, 80))}`);

      // Extrai apenas o JSON válido (começa com '{')
      const jsonStart = content.indexOf('{');
      if (jsonStart >= 0) {
        const cleanContent = content.substring(jsonStart);
        try {
          // Valida que é JSON válido
          JSON.parse(cleanContent);
          fs.writeFileSync(candidate, cleanContent, 'utf8');
          console.log(`[fix-package-json-hook] ✅ Corrigido: removidos ${jsonStart} bytes de prefixo HTML`);
        } catch (e) {
          console.error(`[fix-package-json-hook] ❌ Falha ao corrigir: JSON inválido após remoção do prefixo`);
          console.error(`[fix-package-json-hook]    Erro: ${e.message}`);
        }
      } else {
        console.error(`[fix-package-json-hook] ❌ Não foi possível encontrar início do JSON`);
      }
    } else {
      console.log(`[fix-package-json-hook] ✅ ${candidate} está íntegro`);
    }
  }
};