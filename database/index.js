const mysql = require("mysql2");
const util = require("util");

const db = mysql.createPool({
  host: "10.163.0.66",
  user: "ems_lapi",
  password: "111111",
  database: "uty_db1",
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,        // ← TCP keepalive
  keepAliveInitialDelay: 0,
});

const db2 = mysql.createPool({
  host: "10.126.15.138",
  user: "ems_saka",
  password: "s4k4f4rmA",
  database: "ems_saka",
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

// ── Keepalive ping setiap 1 jam ──────────────────────────────
// Cegah koneksi dalam pool jadi stale kena wait_timeout MySQL
const PING_INTERVAL = 60 * 60 * 1000; // 1 jam

setInterval(() => {
  db.query("SELECT 1", (err) => {
    if (err) console.error("[DB1 keepalive error]", err.message);
    else console.log("[DB1 keepalive] OK");
  });
}, PING_INTERVAL);

setInterval(() => {
  db2.query("SELECT 1", (err) => {
    if (err) console.error("[DB2 keepalive error]", err.message);
    else console.log("[DB2 keepalive] OK");
  });
}, PING_INTERVAL);

// ── Startup test connection ───────────────────────────────────
db.query("SELECT 1", (err) => {
  if (err) return console.error("DB1 error:", err.message);
  console.log("DB1 (uty_db1) pool connected");
});

db2.query("SELECT 1", (err) => {
  if (err) return console.error("DB2 error:", err.message);
  console.log("DB2 (ems_saka) pool connected");
});

const query = util.promisify(db.query).bind(db);
const query2 = util.promisify(db2.query).bind(db2);

module.exports = { db2, db, query };