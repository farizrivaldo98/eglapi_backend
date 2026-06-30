const { db2, db, query } = require("../database");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("../helpers/nodemailers");
const { request, response } = require("express");

// ─────────────────────────────────────────────────────────────────────────
// Helper error handling: dipanggil dari semua function di bawah supaya
// error DB selalu dibalas dengan response yang jelas (bukan crash, bukan
// diem-diem ngirim 200 kosong). TIDAK PERNAH throw.
// ─────────────────────────────────────────────────────────────────────────
function handleDbError(err, res, context) {
  console.error(`[${context}]`, err);
  const detail = (err && (err.sqlMessage || err.message)) || "Unknown error";
  return res.status(500).send({ message: "Gagal mengakses database", detail });
}

module.exports = {
  fetchOee: async (request, response) => {
    try {
      const { machine, start, finish } = request.query;
      if (!machine || !start || !finish) {
        return response.status(400).send({ message: "Parameter machine, start, finish wajib diisi" });
      }

      const fetchQuerry =
        "SELECT `data_index` as 'id', `time@timestamp` as 'time', `data_format_0` as 'avability', `data_format_1` as 'performance', `data_format_2` as 'quality', `data_format_3` as 'oee', `data_format_4` as 'output', `data_format_5` as 'runTime', `data_format_6` as 'stopTime', `data_format_7` as 'idleTime' FROM " +
        db.escapeId(machine) +
        " WHERE `time@timestamp` BETWEEN " +
        db.escape(start) +
        " AND " +
        db.escape(finish);

      db.query(fetchQuerry, (err, result) => {
        if (err) return handleDbError(err, response, "fetchOee");
        return response.status(200).send(result);
      });
    } catch (err) {
      return handleDbError(err, response, "fetchOee");
    }
  },

  fetchVariableOee: async (request, response) => {
    try {
      const { machine, start, finish } = request.query;
      if (!machine || !start || !finish) {
        return response.status(400).send({ message: "Parameter machine, start, finish wajib diisi" });
      }

      const fetchQuerry =
        "SELECT AVG(`data_format_0`) as Ava, AVG(`data_format_1`) as Per, AVG(`data_format_2`) as Qua, AVG(`data_format_3`) AS oee FROM " +
        db.escapeId(machine) +
        " WHERE `time@timestamp` BETWEEN " +
        db.escape(start) +
        " AND " +
        db.escape(finish);

      db.query(fetchQuerry, (err, result) => {
        if (err) return handleDbError(err, response, "fetchVariableOee");
        return response.status(200).send(result);
      });
    } catch (err) {
      return handleDbError(err, response, "fetchVariableOee");
    }
  },

  fetchDataHardness: async (request, response) => {
    try {
      const { nobatch } = request.body;
      if (!nobatch) return response.status(400).send({ message: "nobatch wajib diisi" });

      const fetchQuerry = `SELECT id as x, hardness AS y FROM instrument WHERE nobatch = ${db2.escape(nobatch)}`;
      db2.query(fetchQuerry, (err, result) => {
        if (err) return handleDbError(err, response, "fetchDataHardness");
        return response.status(200).send(result);
      });
    } catch (err) {
      return handleDbError(err, response, "fetchDataHardness");
    }
  },

  fetchDataTickness: async (request, response) => {
    try {
      const { nobatch } = request.body;
      if (!nobatch) return response.status(400).send({ message: "nobatch wajib diisi" });

      const fetchQuerry = `SELECT id as x, thickness AS y FROM instrument WHERE nobatch = ${db2.escape(nobatch)}`;
      db2.query(fetchQuerry, (err, result) => {
        if (err) return handleDbError(err, response, "fetchDataTickness");
        return response.status(200).send(result);
      });
    } catch (err) {
      return handleDbError(err, response, "fetchDataTickness");
    }
  },

  fetchDataDiameter: async (request, response) => {
    try {
      const { nobatch } = request.body;
      if (!nobatch) return response.status(400).send({ message: "nobatch wajib diisi" });

      const fetchQuerry = `SELECT id as x, diameter AS y FROM instrument WHERE nobatch = ${db2.escape(nobatch)}`;
      db2.query(fetchQuerry, (err, result) => {
        if (err) return handleDbError(err, response, "fetchDataDiameter");
        return response.status(200).send(result);
      });
    } catch (err) {
      return handleDbError(err, response, "fetchDataDiameter");
    }
  },

  fetchDataInstrument: async (request, response) => {
    try {
      const fetchQuerry = `SELECT * FROM instrument`;
      db2.query(fetchQuerry, (err, result) => {
        if (err) return handleDbError(err, response, "fetchDataInstrument");
        return response.status(200).send(result);
      });
    } catch (err) {
      return handleDbError(err, response, "fetchDataInstrument");
    }
  },

  fetchDataLine1: async (request, response) => {
    try {
      const { date } = request.query;
      if (!date) return response.status(400).send({ message: "Parameter date wajib diisi" });

      const fetchquerry = `SELECT Mesin, SUM(total) AS Line1 FROM part WHERE MONTH(tanggal) = ${db.escape(date)} AND Line = 'Line1' GROUP BY Mesin`;
      db.query(fetchquerry, (err, result) => {
        if (err) return handleDbError(err, response, "fetchDataLine1");
        return response.status(200).send(result);
      });
    } catch (err) {
      return handleDbError(err, response, "fetchDataLine1");
    }
  },

  fetchDataLine2: async (request, response) => {
    try {
      const { date } = request.query;
      if (!date) return response.status(400).send({ message: "Parameter date wajib diisi" });

      const fetchquerry = `SELECT Mesin, SUM(total) AS Line2 FROM part WHERE MONTH(tanggal) = ${db.escape(date)} AND Line = 'Line2' GROUP BY Mesin`;
      db.query(fetchquerry, (err, result) => {
        if (err) return handleDbError(err, response, "fetchDataLine2");
        return response.status(200).send(result);
      });
    } catch (err) {
      return handleDbError(err, response, "fetchDataLine2");
    }
  },

  fetchDataLine3: async (request, response) => {
    try {
      const { date } = request.query;
      if (!date) return response.status(400).send({ message: "Parameter date wajib diisi" });

      const fetchquerry = `SELECT Mesin, SUM(total) AS Line3 FROM part WHERE MONTH(tanggal) = ${db.escape(date)} AND Line = 'Line3' GROUP BY Mesin`;
      db.query(fetchquerry, (err, result) => {
        if (err) return handleDbError(err, response, "fetchDataLine3");
        return response.status(200).send(result);
      });
    } catch (err) {
      return handleDbError(err, response, "fetchDataLine3");
    }
  },

  fetchDataLine4: async (request, response) => {
    try {
      // Query asli: "MONTH(tanggal) = 4 AND WHERE Line='Line4'" -> double WHERE,
      // jadi SELALU syntax error tiap endpoint ini dipanggil. Sudah dibenerin.
      // NOTE: Line1-3 ambil bulan dari ?date, Line4 ini hardcode bulan ke-4 -
      // cek lagi apakah ini disengaja atau ketinggalan waktu nulis kode.
      const fetchquerry = `SELECT Mesin, SUM(total) AS Line4 FROM part WHERE MONTH(tanggal) = 4 AND Line = 'Line4' GROUP BY Mesin`;
      db.query(fetchquerry, (err, result) => {
        if (err) return handleDbError(err, response, "fetchDataLine4");
        return response.status(200).send(result);
      });
    } catch (err) {
      return handleDbError(err, response, "fetchDataLine4");
    }
  },

  fetchDataPareto: async (request, response) => {
    try {
      const { date } = request.query;
      if (!date) return response.status(400).send({ message: "Parameter date wajib diisi" });

      const fatchquerry = `SELECT Line, SUM(total) AS y FROM parammachine_saka.part WHERE MONTH(tanggal) = ${db.escape(date)} GROUP BY Line ORDER BY Line ASC`;
      db.query(fatchquerry, (err, result) => {
        if (err) return handleDbError(err, response, "fetchDataPareto");
        return response.status(200).send(result);
      });
    } catch (err) {
      return handleDbError(err, response, "fetchDataPareto");
    }
  },

  getData: async (request, response) => {
    try {
      const { date } = request.query;
      if (!date) return response.status(400).send({ message: "Parameter date wajib diisi" });

      const fatchquerry = `SELECT * FROM parammachine_saka.part WHERE MONTH(tanggal) = ${db.escape(date)}`;
      db.query(fatchquerry, (err, result) => {
        if (err) return handleDbError(err, response, "getData");
        return response.status(200).send(result);
      });
    } catch (err) {
      return handleDbError(err, response, "getData");
    }
  },

  fetchEdit: async (request, response) => {
    try {
      const fatchquerry = `SELECT * FROM parammachine_saka.part`;
      db.query(fatchquerry, (err, result) => {
        if (err) return handleDbError(err, response, "fetchEdit");
        return response.status(200).send(result);
      });
    } catch (err) {
      return handleDbError(err, response, "fetchEdit");
    }
  },

  addData: async (request, response) => {
    try {
      const { Mesin, Line, Pekerjaan, Detail, Tanggal, Quantity, Unit, Pic, Tawal, Tahir, Total } = request.body;

      // Kolom disebut eksplisit (bukan cuma VALUES(...) tanpa nama kolom) -
      // ini yang bikin register() crash sebelumnya, jadi sekalian dibenerin
      // di sini juga biar gak ketemu masalah yang sama di kemudian hari.
      const postQuery = `INSERT INTO part
        (Mesin, Line, Pekerjaan, Detail, Tanggal, Quantity, Unit, Pic, Tawal, Tahir, Total)
        VALUES (${db.escape(Mesin)}, ${db.escape(Line)}, ${db.escape(Pekerjaan)}, ${db.escape(Detail)}, ${db.escape(Tanggal)}, ${db.escape(Quantity)}, ${db.escape(Unit)}, ${db.escape(Pic)}, ${db.escape(Tawal)}, ${db.escape(Tahir)}, ${db.escape(Total)})`;

      db.query(postQuery, (err) => {
        if (err) return handleDbError(err, response, "addData");

        db.query("SELECT * FROM part", (err2, result2) => {
          if (err2) return handleDbError(err2, response, "addData (refetch)");
          return response.status(200).send(result2);
        });
      });
    } catch (err) {
      return handleDbError(err, response, "addData");
    }
  },

  editData: async (request, response) => {
    try {
      const ALLOWED_COLUMNS = [
        "Mesin", "Line", "Pekerjaan", "Detail", "Tanggal",
        "Quantity", "Unit", "Pic", "Tawal", "Tahir", "Total",
      ];

      const idParams = request.params.id;
      const dataUpdate = [];

      for (const prop in request.body) {
        if (!ALLOWED_COLUMNS.includes(prop)) {
          return response.status(400).send({ message: `Kolom '${prop}' tidak dikenali` });
        }
        dataUpdate.push(`${prop} = ${db.escape(request.body[prop])}`);
      }

      if (dataUpdate.length === 0) {
        return response.status(400).send({ message: "Tidak ada data yang diupdate" });
      }

      const updateQuery = `UPDATE part SET ${dataUpdate.join(", ")} WHERE id = ${db.escape(idParams)}`;
      db.query(updateQuery, (err, result) => {
        if (err) return handleDbError(err, response, "editData");
        return response.status(200).send(result);
      });
    } catch (err) {
      return handleDbError(err, response, "editData");
    }
  },

  deletData: async (request, response) => {
    try {
      const idParams = request.params.id;
      const deleteQuery = `DELETE FROM part WHERE id = ${db.escape(idParams)}`;
      db.query(deleteQuery, (err) => {
        if (err) return handleDbError(err, response, "deletData");
        return response.status(200).send({ isSucess: true, message: "Succes delete data" });
      });
    } catch (err) {
      return handleDbError(err, response, "deletData");
    }
  },

  register: async (req, res) => {
    try {
      const { username, email, name, password, level } = req.body;

      if (!username || !email || !name || !password) {
        return res.status(400).send({ message: "Username, email, name, dan password wajib diisi" });
      }

      const getEmailQuery = `SELECT id_users FROM users WHERE email = ${db.escape(email)}`;
      const isEmailExist = await query(getEmailQuery);
      if (isEmailExist.length > 0) {
        return res.status(400).send({ message: "Email has been used" });
      }

      const salt = await bcrypt.genSalt(10);
      const hashPassword = await bcrypt.hash(password, salt);

      // FIX UTAMA: ini sumber crash di error log kamu. Tabel `users` punya 7
      // kolom (id_users, username, email, password, name, isAdmin, level)
      // tapi INSERT versi lama cuma kasih 6 value (lupa `level`) -> MySQL
      // nolak ("Column count doesn't match value count"). Karena dulu gak
      // ada try/catch, error itu jadi unhandled promise rejection yang
      // langsung matiin proses Node. Sekarang kolom disebut eksplisit +
      // level diisi default 0 kalau gak dikirim dari frontend.
      const addUserQuery = `INSERT INTO users
        (username, email, password, name, isAdmin, level)
        VALUES (${db.escape(username)}, ${db.escape(email)}, ${db.escape(hashPassword)}, ${db.escape(name)}, 0, ${db.escape(level ?? 0)})`;

      const addUserResult = await query(addUserQuery);

      return res.status(200).send({ data: addUserResult, message: "Register success" });
    } catch (err) {
      return handleDbError(err, res, "register");
    }
  },

  // ============================================================
  // login — DIMODIFIKASI: tambah pencatatan audit LOGIN
  // ============================================================
  login: async (req, res) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).send({ message: "Username dan password wajib diisi" });
      }

      const isUserExist = await query(
        `SELECT * FROM users WHERE username = ${db.escape(username)}`
      );

      if (isUserExist.length == 0) {
        return res.status(400).send({ message: "Initial & password invalid" });
      }

      const isValid = await bcrypt.compare(password, isUserExist[0].password);

      if (!isValid) {
        return res.status(400).send({ message: "Initial & password invalid" });
      }

      let payload = {
        name: isUserExist[0].name,
        id: isUserExist[0].id_users,
        isAdmin: isUserExist[0].isAdmin,
        username: isUserExist[0].username,
        email: isUserExist[0].email,
        level: isUserExist[0].level, // ← sesuaikan nama kolom di DB kamu
      };
      const token = jwt.sign(payload, "khaerul", { expiresIn: "1h" });

      // ── AUDIT TRAIL: catat LOGIN ─────────────────────────────
      try {
        const ip =
          (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
          req.socket.remoteAddress ||
          "unknown";
        await query(
          `INSERT INTO audit_trail (user_id, user_name, action, detail, ip_address)
           VALUES (${db.escape(isUserExist[0].id_users)}, ${db.escape(isUserExist[0].name)}, 'LOGIN', '{}', ${db.escape(ip)})`
        );
      } catch (auditErr) {
        // Jangan blokir login walau audit gagal
        console.error("Audit login error:", auditErr);
      }
      // ─────────────────────────────────────────────────────────

      delete isUserExist[0].password;
      return res.status(200).send({
        token,
        message: "Login success",
        data: isUserExist[0],
      });
    } catch (error) {
      return handleDbError(error, res, "login");
    }
  },

  fetchAlluser: async (req, res) => {
    try {
      const users = await query(`SELECT * FROM users`);
      return res.status(200).send(users);
    } catch (err) {
      return handleDbError(err, res, "fetchAlluser");
    }
  },

  checkLogin: async (req, res) => {
    try {
      const users = await query(
        `SELECT * FROM users WHERE id_users = ${db.escape(req.user.id)}`
      );

      if (users.length === 0) {
        return res.status(404).send({ message: "User tidak ditemukan" });
      }

      return res.status(200).send({
        data: {
          name: users[0].name,
          id: users[0].id_users,
          isAdmin: users[0].isAdmin,
          username: users[0].username,
          email: users[0].email,
          level: users[0].level, // ← sesuaikan nama kolom di DB kamu
        },
      });
    } catch (err) {
      return handleDbError(err, res, "checkLogin");
    }
  },

  //===============EMS=================================================================
  getTableEMS: async (request, response) => {
    try {
      const queryData = `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE (TABLE_NAME LIKE '%cMT-C21B_%' OR TABLE_NAME LIKE '_data') AND TABLE_NAME NOT LIKE '%_data_format' AND TABLE_NAME NOT LIKE '%_data_section'`;
      db.query(queryData, (err, result) => {
        if (err) return handleDbError(err, response, "getTableEMS");
        return response.status(200).send(result);
      });
    } catch (err) {
      return handleDbError(err, response, "getTableEMS");
    }
  },

  getTempChart: async (request, response) => {
    try {
      const { area, start, finish, format } = request.query;
      if (!area || !start || !finish || format === undefined) {
        return response.status(400).send({ message: "Parameter area, start, finish, format wajib diisi" });
      }
      // format dipakai sebagai NAMA KOLOM (data_format_X) -> harus divalidasi
      // ketat, kalau enggak ini lubang SQL injection.
      if (!/^[0-7]$/.test(String(format))) {
        return response.status(400).send({ message: "Parameter format tidak valid (harus 0-7)" });
      }

      const queryData = `
        SELECT
          DATE_FORMAT(FROM_UNIXTIME(\`time@timestamp\`), '%Y-%m-%d %H:%i:%s') AS label,
          data_index AS x,
          data_format_${format} AS y
        FROM ${db.escapeId(area)}
        WHERE
          FROM_UNIXTIME(\`time@timestamp\`) BETWEEN ${db.escape(start)} AND ${db.escape(finish)}
        ORDER BY
          \`time@timestamp\`;
      `;

      db.query(queryData, (err, result) => {
        if (err) return handleDbError(err, response, "getTempChart");
        const parsedResult = result.map((entry) => ({
          ...entry,
          y: parseFloat(entry.y),
        }));
        return response.status(200).send(parsedResult);
      });
    } catch (err) {
      return handleDbError(err, response, "getTempChart");
    }
  },

  getAllDataEMS: async (request, response) => {
    try {
      const { area, start, finish } = request.query;
      if (!area || !start || !finish) {
        return response.status(400).send({ message: "Parameter area, start, finish wajib diisi" });
      }

      const queryData = `SELECT
        data_index AS id,
        DATE_FORMAT(FROM_UNIXTIME(\`time@timestamp\`), '%Y-%m-%d %H:%i:%s') AS date,
        ROUND(data_format_0, 2) AS temp,
        ROUND(data_format_1, 2) AS RH,
        ROUND(data_format_2, 2) AS DP
        FROM ${db.escapeId(area)}
        WHERE
          FROM_UNIXTIME(\`time@timestamp\`) BETWEEN ${db.escape(start)} AND ${db.escape(finish)}
        ORDER BY
          \`time@timestamp\``;

      db.query(queryData, (err, result) => {
        if (err) return handleDbError(err, response, "getAllDataEMS");
        return response.status(200).send(result);
      });
    } catch (err) {
      return handleDbError(err, response, "getAllDataEMS");
    }
  },
  //===================================================================================
};