import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, renameSync, statSync } from "node:fs";

const dir = "/data";
const origem = `${dir}/aethera-restauracao.db`;
const destino = `${dir}/aethera-web.db`;
const antigo = `${dir}/aethera-web-antes-restauracao.db`;

if (!existsSync(origem)) {
  throw new Error("Backup de restauracao nao encontrado");
}

const db = new Database(origem, { readonly: true });

try {
  const resultado = db.query("PRAGMA integrity_check").get();

  if (resultado.integrity_check !== "ok") {
    throw new Error("Falha na integridade do backup");
  }
} finally {
  db.close();
}

for (const sufixo of ["", "-wal", "-shm"]) {
  const arquivo = destino + sufixo;

  if (existsSync(arquivo)) {
    copyFileSync(arquivo, antigo + sufixo);
  }
}

if (existsSync(destino + "-wal")) {
  renameSync(destino + "-wal", destino + "-wal.anterior");
}

if (existsSync(destino + "-shm")) {
  renameSync(destino + "-shm", destino + "-shm.anterior");
}

copyFileSync(origem, destino);

console.log("Restauracao concluida");
console.log("Tamanho:", statSync(destino).size);
