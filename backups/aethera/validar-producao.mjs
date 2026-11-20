import { Database } from "bun:sqlite";

const db = new Database("/data/aethera-web.db", {
  readonly: true
});

try {
  console.log("Integridade:", db.query("PRAGMA integrity_check").get());

  const projetos = db.query(
    "SELECT COUNT(*) AS total FROM studio_projects"
  ).get();

  console.log("Projetos:", projetos.total);

  const usuarios = db.query(
    "SELECT COUNT(*) AS total FROM auth_users"
  ).get();

  console.log("Usuários:", usuarios.total);
} finally {
  db.close();
}

