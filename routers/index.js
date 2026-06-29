const databaseRouter = require("./databasaeRouter");
const auditRouter    = require("./auditRouter");
const adminRouter    = require("./Adminrouter");   // ← sesuai nama file di disk

module.exports = { databaseRouter, auditRouter, adminRouter };