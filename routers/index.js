// routers/index.js
const databaseRouter = require("./databasaeRouter");  // ← sesuai nama file asli (ada typo 'ae')
const auditRouter    = require("./auditRouter");
const adminRouter    = require("./adminRouter");       // ← yang baru

module.exports = { databaseRouter, auditRouter, adminRouter };