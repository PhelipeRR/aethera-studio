import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

const files = {
  A: "./backups/aethera/aethera-backup-A.db",
  B: "./backups/aethera/aethera-backup-B.db"
};

const databases = Object.fromEntries(
  Object.entries(files).map(([name, file]) => [
    name,
    new Database(file, { readonly: true })
  ])
);

try {
  const tables = databases.A.query(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all();

  for (const { name } of tables) {
    const safeName = name.replace(/"/g, '""');
    const hashes = {};

    for (const [machine, db] of Object.entries(databases)) {
      const rows = db.query(`SELECT * FROM "${safeName}"`).all();

      const rowHashes = rows.map(row =>
        createHash("sha256")
          .update(JSON.stringify(row, (_, value) =>
            typeof value === "bigint" ? value.toString() : value
          ))
          .digest("hex")
      ).sort();

      hashes[machine] = createHash("sha256")
        .update(JSON.stringify(rowHashes))
        .digest("hex");
    }

    console.log(
      `${name}: ${hashes.A === hashes.B ? "IGUAL" : "DIFERENTE"}`
    );
  }
} finally {
  databases.A.close();
  databases.B.close();
}
