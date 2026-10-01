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

function logQueryError(error, sql) {
  const detail = error && error.odbcErrors ? error.odbcErrors.map((x) => x.message).join(" | ") : error.message;
  console.error("[SQL ERROR]", detail, "\n   SQL:", String(sql).replace(/\s+/g, " ").slice(0, 300));
  if (detail && detail !== error.message) error.message = detail;
}

function wrapConnection(connection) {
  return {
    query: async (sql, params) => {
      try { return await connection.query(sql, params); }
      catch (e) { logQueryError(e, sql); throw e; }
    },
  };
}

function wrap(pool) {
  return {
    query: async (sql, params) => {
      try { return await pool.query(sql, params); }
      catch (e) { logQueryError(e, sql); throw e; }
    },
    withTransaction: async (work) => {
      const connection = await pool.connect();
      let transactionOpen = false;
      try {
        await connection.setIsolationLevel(odbc.SQL_TXN_SERIALIZABLE);
        await connection.beginTransaction();
        transactionOpen = true;
        const result = await work(wrapConnection(connection));
        await connection.commit();
        transactionOpen = false;
        return result;
      } catch (e) {
        if (transactionOpen) {
          try { await connection.rollback(); } catch (rollbackError) {
            console.error("[SQL ROLLBACK ERROR]", rollbackError.message);
          }
        }
        throw e;
      } finally {
        try { await connection.close(); }
        catch (closeError) { console.error("[SQL CONNECTION CLOSE ERROR]", closeError.message); }
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
