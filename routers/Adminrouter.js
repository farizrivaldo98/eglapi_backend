const express          = require("express");
const router           = express.Router();
const { veryfyToken }  = require("../middleware/auth");
const adminControllers = require("../controllers/Admincontrollers");  // ← kapital A, c kecil

// Semua route admin butuh token valid
// isAdmin dicek ulang di controller sebagai double safety
router.get   ("/users",     veryfyToken, adminControllers.getAllUsers);
router.patch ("/users/:id", veryfyToken, adminControllers.updateUser);
router.delete("/users/:id", veryfyToken, adminControllers.deleteUser);

module.exports = router;