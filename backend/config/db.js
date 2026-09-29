const odbc = require("odbc");

const connectionString =
  "Driver={ODBC Driver 18 for SQL Server};" +
  "Server=localhost\\SQLEXPRESS;" +
  "Database=SmartAttendance;" +
  "Trusted_Connection=Yes;" +
  "TrustServerCertificate=Yes;";

/* ROOT-CAUSE FIX:
   The original code used ONE shared odbc connection for the whole server. A single ODBC connection
   can only run one statement at a time (no MARS), but the dashboards fire several API calls at once
   (classes + sections + subjects + assignments ...). The overlapping queries collided on the same
   connection and failed with "Connection is busy with results for another command" -> HTTP 500.
   A connection POOL gives every query its own connection. The pool exposes the same
   .query(sql, params) API, so no controller code has to change. */
let poolPromise = null;

function wrap(pool) {
  return {
    query: async (sql, params) => {
      try {
        return await pool.query(sql, params);
      } catch (e) {
        // make the real SQL error visible in the backend console (it used to be hidden behind "Database error.")
        const detail = e && e.odbcErrors ? e.odbcErrors.map((x) => x.message).join(" | ") : e.message;
        console.error("[SQL ERROR]", detail, "\n   SQL:", String(sql).replace(/\s+/g, " ").slice(0, 300));
        if (detail && detail !== e.message) e.message = detail;
        throw e;
      }
    },
  };
}

let wrapped = null;
async function getConnection() {
  if (!wrapped) {
    if (!poolPromise) {
      poolPromise = odbc.pool({ connectionString, initialSize: 4, incrementSize: 2, maxSize: 20 });
    }
    const pool = await poolPromise;
    wrapped = wrap(pool);
    console.log("Connected to SQL Server (connection pool)");
  }
  return wrapped;
}

module.exports = { getConnection };
