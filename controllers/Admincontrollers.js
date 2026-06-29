const { db, query } = require("../database");
const bcrypt = require("bcrypt");

module.exports = {
  // ── GET all users (admin only) ────────────────────────────────
  getAllUsers: async (req, res) => {
    try {
      // Double-check: hanya admin yang boleh akses
      if (!req.user || Number(req.user.isAdmin) !== 1) {
        return res.status(403).send({ message: "Access denied: Admins only" });
      }

      const users = await query(
        `SELECT id_users, username, email, name, isAdmin, level
         FROM users
         ORDER BY id_users ASC`
      );
      return res.status(200).send(users);
    } catch (err) {
      console.error("getAllUsers error:", err);
      res.status(500).send({ message: err.message });
    }
  },

  // ── PATCH user by id (update username, name, email, password, level, isAdmin) ──
  updateUser: async (req, res) => {
    try {
      if (!req.user || Number(req.user.isAdmin) !== 1) {
        return res.status(403).send({ message: "Access denied: Admins only" });
      }

      const targetId                                 = Number(req.params.id);
      const { username, name, email, password, level, isAdmin } = req.body;

      // Cegah admin menghapus hak admin-nya sendiri
      if (req.user.id === targetId && Number(isAdmin) === 0) {
        return res.status(400).send({
          message: "Tidak bisa mencabut hak admin dari akun sendiri",
        });
      }

      // Cek user target ada
      const existing = await query(
        `SELECT id_users FROM users WHERE id_users = ${db.escape(targetId)}`
      );
      if (existing.length === 0) {
        return res.status(404).send({ message: "User tidak ditemukan" });
      }

      // Build update fields
      const fields = [];
      if (username !== undefined && username.trim() !== "")
        fields.push(`username = ${db.escape(username.trim())}`);
      if (name !== undefined && name.trim() !== "")
        fields.push(`name = ${db.escape(name.trim())}`);
      if (email !== undefined && email.trim() !== "")
        fields.push(`email = ${db.escape(email.trim())}`);
      if (level !== undefined)
        fields.push(`level = ${db.escape(Number(level))}`);
      if (isAdmin !== undefined)
        fields.push(`isAdmin = ${db.escape(Number(isAdmin))}`);

      // Hash password baru jika diisi
      if (password && password.trim() !== "") {
        const salt     = await bcrypt.genSalt(10);
        const hashPass = await bcrypt.hash(password.trim(), salt);
        fields.push(`password = ${db.escape(hashPass)}`);
      }

      if (fields.length === 0) {
        return res.status(400).send({ message: "Tidak ada field yang diubah" });
      }

      await query(
        `UPDATE users SET ${fields.join(", ")} WHERE id_users = ${db.escape(targetId)}`
      );

      // ── Audit ────────────────────────────────────────────────
      try {
        const ip =
          (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
          req.socket.remoteAddress ||
          "unknown";
        const detail = JSON.stringify({
          target_id: targetId,
          updated_fields: fields
            .map((f) => f.split("=")[0].trim())
            .filter((f) => f !== "password"), // jangan log password
        });
        await query(
          `INSERT INTO audit_trail (user_id, user_name, action, detail, ip_address)
           VALUES (
             ${db.escape(req.user.id)},
             ${db.escape(req.user.name)},
             'ADMIN_EDIT_USER',
             ${db.escape(detail)},
             ${db.escape(ip)}
           )`
        );
      } catch (auditErr) {
        console.error("Audit error:", auditErr);
      }
      // ────────────────────────────────────────────────────────

      return res.status(200).send({ message: "User berhasil diupdate" });
    } catch (err) {
      console.error("updateUser error:", err);
      res.status(500).send({ message: err.message });
    }
  },

  // ── DELETE user by id ──────────────────────────────────────────
  deleteUser: async (req, res) => {
    try {
      if (!req.user || Number(req.user.isAdmin) !== 1) {
        return res.status(403).send({ message: "Access denied: Admins only" });
      }

      const targetId = Number(req.params.id);

      // Cegah hapus diri sendiri
      if (req.user.id === targetId) {
        return res.status(400).send({
          message: "Tidak bisa menghapus akun sendiri",
        });
      }

      // Cek user target ada
      const existing = await query(
        `SELECT id_users, name, username FROM users WHERE id_users = ${db.escape(targetId)}`
      );
      if (existing.length === 0) {
        return res.status(404).send({ message: "User tidak ditemukan" });
      }

      const deletedUser = existing[0];
      await query(`DELETE FROM users WHERE id_users = ${db.escape(targetId)}`);

      // ── Audit ────────────────────────────────────────────────
      try {
        const ip =
          (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
          req.socket.remoteAddress ||
          "unknown";
        const detail = JSON.stringify({
          deleted_id:       targetId,
          deleted_name:     deletedUser.name,
          deleted_username: deletedUser.username,
        });
        await query(
          `INSERT INTO audit_trail (user_id, user_name, action, detail, ip_address)
           VALUES (
             ${db.escape(req.user.id)},
             ${db.escape(req.user.name)},
             'ADMIN_DELETE_USER',
             ${db.escape(detail)},
             ${db.escape(ip)}
           )`
        );
      } catch (auditErr) {
        console.error("Audit error:", auditErr);
      }
      // ────────────────────────────────────────────────────────

      return res
        .status(200)
        .send({ message: `User "${deletedUser.name}" berhasil dihapus` });
    } catch (err) {
      console.error("deleteUser error:", err);
      res.status(500).send({ message: err.message });
    }
  },
};