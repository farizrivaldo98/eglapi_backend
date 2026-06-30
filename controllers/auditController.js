const { db, query } = require("../database");

// Tambahkan "ADMIN_UPDATE_PAGE_ACCESS" ke dalam array di bawah ini
const ALLOWED_ACTIONS = [
  "LOGIN", 
  "LOGOUT", 
  "VIEW_UTILITY", 
  "EXPORT_PDF",
  "ADMIN_UPDATE_PAGE_ACCESS" // <--- Fitur baru ditambahkan di sini
];

module.exports = {
  /**
   * POST /audit/log
   * Body : { action: string, detail: object }
   * Guard: veryfyToken
   * Dipanggil dari frontend untuk catat LOGOUT, VIEW_UTILITY, EXPORT_PDF, dan update page access.
   * LOGIN dicatat langsung di databaseControllers.login().
   */
  logAction: async (req, res) => {
    try {
      const { action, detail } = req.body;
      const { id, name } = req.user;

      if (!ALLOWED_ACTIONS.includes(action)) {
        return res.status(400).send({ message: "Invalid action" });
      }

      const ip =
        (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
        req.socket.remoteAddress ||
        "unknown";

      const detailJson = JSON.stringify(detail || {});

      await query(
        `INSERT INTO audit_trail (user_id, user_name, action, detail, ip_address)
         VALUES (${db.escape(id)}, ${db.escape(name)}, ${db.escape(action)}, ${db.escape(detailJson)}, ${db.escape(ip)})`
      );

      return res.status(200).send({ message: "Logged" });
    } catch (error) {
      console.error("auditController.logAction error:", error);
      return res.status(500).send({ message: "Internal server error" });
    }
  },

  /**
   * GET /audit/list
   * Query: { startDate?, endDate?, userId? }
   * Guard: veryfyToken + checkRole (admin only)
   */
  getAuditTrail: async (req, res) => {
    try {
      const { startDate, endDate, userId } = req.query;

      const conditions = [];
      if (startDate)
        conditions.push(`DATE(server_time) >= ${db.escape(startDate)}`);
      if (endDate)
        conditions.push(`DATE(server_time) <= ${db.escape(endDate)}`);
      if (userId && userId !== "all")
        conditions.push(`user_id = ${db.escape(parseInt(userId, 10))}`);

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const rows = await query(
        `SELECT id, user_id, user_name, action, detail, ip_address,server_time
         FROM audit_trail
         ${whereClause}
         ORDER BY server_time DESC
         LIMIT 1000`
      );

      return res.status(200).send(rows);
    } catch (error) {
      console.error("auditController.getAuditTrail error:", error);
      return res.status(500).send({ message: "Internal server error" });
    }
  },

  /**
   * GET /audit/users
   * Daftar user untuk dropdown filter di halaman AuditTrail.
   * Guard: veryfyToken + checkRole (admin only)
   */
  getUsers: async (req, res) => {
    try {
      const rows = await query(
        `SELECT id_users AS id, name, username
         FROM users
         ORDER BY name ASC`
      );
      return res.status(200).send(rows);
    } catch (error) {
      console.error("auditController.getUsers error:", error);
      return res.status(500).send({ message: "Internal server error" });
    }
  },
};