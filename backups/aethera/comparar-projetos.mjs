import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

const a = new Database("./backups/aethera/aethera-backup-A.db", { readonly: true });
const b = new Database("./backups/aethera/aethera-backup-B.db", { readonly: true });

function hash(value) {
  return createHash("sha256")
    .update(JSON.stringify(value, (_, v) =>
      typeof v === "bigint" ? v.toString() : v
    ))
    .digest("hex");
}

try {
  const rowsA = a.query("SELECT * FROM studio_projects").all();
  const rowsB = b.query("SELECT * FROM studio_projects").all();

  const columns = Object.keys(rowsA[0] ?? rowsB[0] ?? {});
  console.log("Colunas:", columns.join(", "));

  const idColumn = columns.find(c => c.toLowerCase() === "id");

  if (!idColumn) {
    console.log("Não foi encontrada uma coluna ID. Comparação por registro indisponível.");
  } else {
    const mapA = new Map(rowsA.map(r => [String(r[idColumn]), r]));
    const mapB = new Map(rowsB.map(r => [String(r[idColumn]), r]));

    for (const id of new Set([...mapA.keys(), ...mapB.keys()])) {
      const ra = mapA.get(id);
      const rb = mapB.get(id);

      if (!ra || !rb) {
        console.log("Registro presente apenas em:", ra ? "A" : "B");
        continue;
      }

      const different = columns.filter(c => hash(ra[c]) !== hash(rb[c]));

      if (different.length) {
        console.log("Registro diferente — colunas:", different.join(", "));
      }
    }
  }
} finally {
  a.close();
  b.close();
}
