// routers/index.js
const databaseRouter = require("./databaseRouter");
const auditRouter    = require("./auditRouter");
const adminRouter    = require("./adminRouter");   // ← TAMBAHAN

module.exports = { databaseRouter, auditRouter, adminRouter };