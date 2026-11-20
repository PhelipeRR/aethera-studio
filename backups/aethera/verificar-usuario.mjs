import { Database } from "bun:sqlite";

const db = new Database("/data/aethera-web.db", {
  readonly: true
});

try {
  const colunas = db.query("PRAGMA table_info(auth_users)").all();

  console.log("Colunas:", colunas.map(c => c.name));

  const colunaEmail = colunas.find(c =>
    ["email", "email_address"].includes(c.name.toLowerCase())
  );

  if (colunaEmail) {
    const nome = colunaEmail.name.replaceAll('"', '""');
    const usuarios = db.query(
      `SELECT "${nome}" AS email FROM auth_users`
    ).all();

    console.log("E-mails cadastrados:", usuarios);
  }
} finally {
  db.close();
}
