const databaseRouter = require("./databasaeRouter");
const auditRouter   = require("./auditRouter");     // ← TAMBAHAN

module.exports = {
  databaseRouter,
  auditRouter,                                        // ← TAMBAHAN
};