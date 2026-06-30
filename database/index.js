const mysql = require("mysql2");
const util = require("util");

// ── DB1: uty_db1 (10.163.0.66) ───────────────────────────────
const db = mysql.createPool({
  host: "10.163.0.66",
  user: "ems_lapi",
  password: "111111",
  database: "uty_db1",
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// ── DB2: ems_saka (10.126.15.138) ────────────────────────────
const db2 = mysql.createPool({
  host: "10.126.15.138",
  user: "ems_saka",
  password: "s4k4f4rmA",
  database: "ems_saka",
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Pool tidak butuh .connect() manual — auto manage sendiri
db.query("SELECT 1", (err) => {
  if (err) return console.error("DB1 error:", err.message);
  console.log("DB1 (uty_db1) connected via pool");
});

db2.query("SELECT 1", (err) => {
  if (err) return console.error("DB2 error:", err.message);
  console.log("DB2 (ems_saka) connected via pool");
});

const query = util.promisify(db.query).bind(db);
const query2 = util.promisify(db2.query).bind(db2);

module.exports = { db2, db, query };