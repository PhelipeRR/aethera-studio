import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

for (const name of ["A", "B"]) {
  const file = `./backups/aethera/aethera-backup-${name}.db`;
  const db = new Database(file, { readonly: true });

  try {
    console.log(`\n===== MÁQUINA ${name} =====`);

    const hash = createHash("sha256")
      .update(readFileSync(file))
      .digest("hex");

    console.log("SHA256:", hash);
    console.log("Integridade:", db.query("PRAGMA integrity_check").get());

    const tables = db.query(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all();

    console.log("Tabelas e quantidade de registros:");

    for (const table of tables) {
      const safeName = table.name.replace(/"/g, '""');
      const count = db.query(
        `SELECT COUNT(*) AS total FROM "${safeName}"`
      ).get();

      console.log(`  ${table.name}: ${count.total}`);
    }
  } finally {
    db.close();
  }
}
