const { request } = require("express");
const express     = require("express");
const cors        = require("cors");
const port        = 8002;
const app         = express();

// ← TAMBAH adminRouter di destructure
const { databaseRouter, auditRouter, adminRouter } = require("./routers");

const { body, validationResult } = require("express-validator");
const { log }    = require("console");
const { db, query } = require("./database");
const upload     = require("./middleware/multer");

// ← TAMBAHAN: dependency buat proxy VNC (dipake ChillerVNC.jsx di frontend)
const net = require("net");
const { WebSocketServer } = require("ws");

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

app.post(
  "/validation",
  body("email").isEmail(),
  body("password").isLength({ min: 5 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array() });
    }
    return res.status(200).send(req.body);
  }
);

app.post("/upload", upload.single("file"), async (req, res) => {
  const { file }  = req;
  const filepath  = file ? "/" + file.filename : null;
  let data        = JSON.parse(req.body.data);

  let response = await query(
    `UPDATE users SET imagePath = ${db.escape(filepath)} WHERE id_users = ${db.escape(data.id)}`
  );

  res.status(200).send({ filepath });
});

app.use("/part",  databaseRouter);
app.use("/audit", auditRouter);
app.use("/admin", adminRouter);   // ← TAMBAHAN

const server = app.listen(port, () => {
  console.log("SERVER RUNNING IN PORT " + port);
});

// ← TAMBAHAN: proxy VNC (WebSocket <-> TCP), dipake ChillerVNC.jsx buat konek ke IP VNC target
const wss = new WebSocketServer({ server, path: "/websockify", perMessageDeflate: false });

wss.on("connection", (ws, req) => {
  const params = new URLSearchParams((req.url.split("?")[1] || ""));
  const targetHost = params.get("host");
  const targetPort = parseInt(params.get("port"), 10) || 5900;

  if (!targetHost) {
    console.log("[VNC Proxy] Ditolak: host tujuan kosong");
    ws.close(1008, "Host tujuan wajib diisi");
    return;
  }

  console.log(`[VNC Proxy] Menghubungkan ke ${targetHost}:${targetPort} ...`);

  const tcpSocket = net.connect(targetPort, targetHost);
  tcpSocket.setNoDelay(true);

  tcpSocket.on("connect", () => {
    console.log(`[VNC Proxy] Terhubung ke ${targetHost}:${targetPort}`);
  });

  tcpSocket.on("data", (data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });

  tcpSocket.on("close", () => {
    console.log(`[VNC Proxy] Koneksi TCP ke ${targetHost}:${targetPort} ditutup`);
    if (ws.readyState === ws.OPEN) ws.close();
  });

  tcpSocket.on("error", (err) => {
    console.error(`[VNC Proxy] Error TCP ke ${targetHost}:${targetPort} - ${err.message}`);
    if (ws.readyState === ws.OPEN) ws.close(1011, "Gagal konek ke VNC target");
  });

  ws.on("message", (data) => {
    if (tcpSocket.writable) tcpSocket.write(data);
  });

  ws.on("close", () => {
    tcpSocket.end();
  });

  ws.on("error", (err) => {
    console.error(`[VNC Proxy] Error WS: ${err.message}`);
    tcpSocket.end();
  });
});