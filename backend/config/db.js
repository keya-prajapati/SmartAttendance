const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,

  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,

  ssl: {
    rejectUnauthorized: false,
  },
});

async function getConnection() {
  return {
    query: async (sql, params = []) => {
      try {
        return await pool.query(sql, params);
      } catch (e) {
        console.error(
          "[POSTGRES SQL ERROR]",
          e.message,
          "\nSQL:",
          String(sql).replace(/\s+/g, " ").slice(0, 500)
        );

        throw e;
      }
    },
  };
}

module.exports = { getConnection };