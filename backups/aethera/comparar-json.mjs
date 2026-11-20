import { Database } from "bun:sqlite";
import { isDeepStrictEqual } from "node:util";

const a = new Database("./backups/aethera/aethera-backup-A.db", { readonly: true });
const b = new Database("./backups/aethera/aethera-backup-B.db", { readonly: true });

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, normalize(value[key])])
    );
  }

  return value;
}

try {
  const rowsA = a.query("SELECT id, payload FROM studio_projects").all();
  const rowsB = b.query("SELECT id, payload FROM studio_projects").all();

  const mapB = new Map(rowsB.map(row => [String(row.id), row]));

  for (const rowA of rowsA) {
    const rowB = mapB.get(String(rowA.id));

    if (!rowB) {
      console.log("Projeto ausente na máquina B");
      continue;
    }

    try {
      const payloadA = normalize(JSON.parse(rowA.payload));
      const payloadB = normalize(JSON.parse(rowB.payload));

      console.log(
        isDeepStrictEqual(payloadA, payloadB)
          ? "Projeto: JSON equivalente"
          : "Projeto: conteúdo realmente diferente"
      );
    } catch {
      console.log("Projeto: payload não pôde ser comparado como JSON");
    }
  }
} finally {
  a.close();
  b.close();
}
