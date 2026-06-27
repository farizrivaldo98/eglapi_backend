const express = require("express");
const auditController = require("../controllers/auditController");
const { veryfyToken, checkRole } = require("../middleware/auth");

const router = express.Router();

// Catat aksi (LOGOUT / VIEW_UTILITY / EXPORT_PDF) — semua user yg sudah login
router.post("/log", veryfyToken, auditController.logAction);

// Ambil daftar log — admin only
router.get("/list", veryfyToken, checkRole, auditController.getAuditTrail);

// Ambil daftar user untuk dropdown filter — admin only
router.get("/users", veryfyToken, checkRole, auditController.getUsers);

module.exports = router;