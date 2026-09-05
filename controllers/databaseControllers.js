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

// ─────────────────────────────────────────────────────────────────────────
// ENERGY WATER (Trane1/Trane2 flow meter totalizer) helpers
// Sumber data: 2 tabel raw per-jam dari flow meter Trane1 & Trane2, kolom
// `data_format_1` adalah TOTALIZER (nilai kumulatif yang terus naik), BUKAN
// pemakaian per periode. Supaya dapet pemakaian per jam/hari/bulan, kita
// ambil selisih antar baris berurutan (delta), baru di-group per periode.
//
// Penanganan reset/rollover meter: kalau delta ketemu negatif (totalizer
// ke-reset ke 0, atau meter diganti), delta itu di-clamp jadi 0 - biar
// nggak muncul lonjakan minus aneh di grafik/tabel. Ini best-effort, bukan
// solusi sempurna buat semua kasus reset.
//
// ⚠️ Nama tabel di-HARDCODE (bukan dari input user) karena cuma ada 2 meter
// yang tetap untuk fitur ini - beda kasus sama Area EMS yang dinamis dari DB.
// ─────────────────────────────────────────────────────────────────────────
const ENERGY_WATER_TABLES = {
  trane1: "cMT-C21B_Trane1_data",
  trane2: "cMT-C21B_Trane2_data",
  SW_Supplay: "cMT-C21B_SW_Supplay_data",
  PDAM_Supplay: "cMT-C21B_PDAM_Supplay_data",
  PWG_Return:"cMT-C21B_PWG_Return_data"

};
const ENERGY_WATER_PERIODS = ["hourly", "daily", "monthly"];

// rows: [{ ts, label, totalizer }] terurut ascending berdasarkan waktu.
// return: [{ label, value }] delta antar baris berurutan (baris pertama
// dibuang karena belum ada baseline buat dihitung selisihnya).
function computeEnergyWaterDeltas(rows) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = Number(rows[i - 1].totalizer);
    const curr = Number(rows[i].totalizer);
    let delta = curr - prev;
    if (!Number.isFinite(delta) || delta < 0) delta = 0; // reset/rollover/data aneh
    out.push({ label: rows[i].label, value: Number(delta.toFixed(3)) });
  }
  return out;
}

// Group delta hourly ke daily/monthly pakai potongan string label
// ('YYYY-MM-DD HH:mm:ss' -> 'YYYY-MM-DD' buat daily, 'YYYY-MM' buat monthly).
function groupEnergyWaterByPeriod(deltaRows, period) {
  if (period === "hourly") return deltaRows;
  const map = new Map();
  for (const row of deltaRows) {
    const key = period === "monthly" ? row.label.slice(0, 7) : row.label.slice(0, 10);
    if (!map.has(key)) map.set(key, { label: key, value: 0 });
    map.get(key).value += row.value;
  }
  return Array.from(map.values()).map((r) => ({ ...r, value: Number(r.value.toFixed(3)) }));
}

// Format hasil grouping jadi bentuk output generik: { id, label, value }.
// "value" = delta pemakaian meter yang diminta pada periode itu. Rata-rata
// dihitung di FRONTEND dari kolom value ini (rata-rata dari data yang
// ke-tarik pada rentang tanggal yang dipilih), bukan dihitung di backend.
function formatEnergyWaterRows(groupedRows) {
  return groupedRows
    .sort((a, b) => (a.label > b.label ? 1 : a.label < b.label ? -1 : 0))
    .map((r, idx) => ({ id: idx + 1, label: r.label, value: r.value }));
}

// ─────────────────────────────────────────────────────────────────────────
// ENERGY POWER (PP UTY1/PP LAPI1 power meter totalizer) helpers
// Sumber data: 2 tabel raw per-jam dari power meter PP UTY1 & PP LAPI1,
// kolom `data_format_4` adalah TOTALIZER Total Energy (Wh) (nilai kumulatif
// yang terus naik), BUKAN pemakaian per periode. Sama persis pola-nya
// dengan ENERGY WATER di atas: ambil selisih antar baris berurutan (delta),
// baru di-group per periode.
//
// Penanganan reset/rollover meter: kalau delta ketemu negatif (totalizer
// ke-reset ke 0, atau meter diganti), delta itu di-clamp jadi 0 - biar
// nggak muncul lonjakan minus aneh di grafik/tabel. Ini best-effort, bukan
// solusi sempurna buat semua kasus reset.
//
// ⚠️ Nama tabel di-HARDCODE (bukan dari input user) karena cuma ada 2 meter
// yang tetap untuk fitur ini - beda kasus sama Area EMS yang dinamis dari DB.
// Konversi Wh/kWh/MWh dilakukan di FRONTEND, backend selalu balikin Wh.
// ─────────────────────────────────────────────────────────────────────────
const ENERGY_POWER_TABLES = {
  uty1: "cMT-C21B_PP_UTY1_data",
  lapi1: "cMT-C21B_PP_LAPI1_data",
  SDP2_PRO1:"cMT-C21B_SDP2-PRO1_data",
  SDP1_OFC1:"cMT-C21B_SDP1-OFC1_data",
  PP_Chiller:"cMT-C21B_PP_Chiller_data",
  SDP1_OFC23 : "cMT-C21B_SDP1-OFC23_data",
  SDP2_PRO2 :"cMT-C21B_SDP2-PRO2_data",
  SDP1_OFC45 :"cMT-C21B_SDP1-OFC45_data",
  SDP2_OFC45 :"cMT-C21B_SDP2-OFC45_data",
  SDP_MC :"cMT-C21B_SDP-MC_data",
  PP_HVAC_Mezzanine3 :"cMT-C21B_PP_HVAC_Mezzanine3_data",
  PP_LP :"cMT-C21B_PP_LP_data",
  SDP2_Pro3 :"cMT-C21B_SDP2_Pro3_data",
  LVMDP1 :"cMT-C21B_LVMDP1_data"


};
const ENERGY_POWER_PERIODS = ["hourly", "daily", "monthly"];
  
// Dipakai KHUSUS oleh getEnergyPowerParameters (V/A/kW/Hz) - parameter ini
// bacaan instan (bukan totalizer), jadi agregasi AVG/MAX/MIN per periode
// dilakukan langsung di SQL pakai GROUP BY hasil DATE_FORMAT ini. Beda
// pendekatan sama Total Energy di atas yang harus dihitung delta di JS dulu.
const ENERGY_POWER_PARAM_PERIOD_FORMAT = {
  hourly: "%Y-%m-%d %H:00:00",
  daily: "%Y-%m-%d",
  monthly: "%Y-%m",
};

// rows: [{ ts, label, totalizer }] terurut ascending berdasarkan waktu.
// return: [{ label, value }] delta antar baris berurutan (baris pertama
// dibuang karena belum ada baseline buat dihitung selisihnya).
function computeEnergyPowerDeltas(rows) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = Number(rows[i - 1].totalizer);
    const curr = Number(rows[i].totalizer);
    let delta = curr - prev;
    if (!Number.isFinite(delta) || delta < 0) delta = 0; // reset/rollover/data aneh
    out.push({ label: rows[i].label, value: Number(delta.toFixed(3)) });
  }
  return out;
}

// Group delta hourly ke daily/monthly pakai potongan string label
// ('YYYY-MM-DD HH:mm:ss' -> 'YYYY-MM-DD' buat daily, 'YYYY-MM' buat monthly).
// function groupEnergyPowerByPeriod(deltaRows, period) {
//   if (period === "hourly") return deltaRows;
//   const map = new Map();
//   for (const row of deltaRows) {
//     const key = period === "monthly" ? row.label.slice(0, 7) : row.label.slice(0, 10);
//     if (!map.has(key)) map.set(key, { label: key, value: 0 });
//     map.get(key).value += row.value;
//   }
//   return Array.from(map.values()).map((r) => ({ ...r, value: Number(r.value.toFixed(3)) }));
// }
function groupEnergyPowerByPeriod(deltaRows, period) {
  const map = new Map();

  for (const row of deltaRows) {
    let key;

    if (period === "hourly") {
      // YYYY-MM-DD HH:00:00
      key = row.label.slice(0, 13) + ":00:00";
    } else if (period === "daily") {
      // YYYY-MM-DD
      key = row.label.slice(0, 10);
    } else if (period === "monthly") {
      // YYYY-MM
      key = row.label.slice(0, 7);
    }

    if (!map.has(key)) {
      map.set(key, {
        label: key,
        value: 0,
      });
    }

    map.get(key).value += Number(row.value) || 0;
  }

  return Array.from(map.values()).map((r) => ({
    ...r,
    value: Number(r.value.toFixed(3)),
  }));
}

// Format hasil grouping jadi bentuk output generik: { id, label, value }.
// "value" = delta pemakaian energi (Wh) meter yang diminta pada periode itu.
// Rata-rata & konversi unit dihitung di FRONTEND dari kolom value ini.
function formatEnergyPowerRows(groupedRows) {
  return groupedRows
    .sort((a, b) => (a.label > b.label ? 1 : a.label < b.label ? -1 : 0))
    .map((r, idx) => ({ id: idx + 1, label: r.label, value: r.value }));
}

// ─────────────────────────────────────────────────────────────────────────
// MACHINE (mesin produksi - realtime, historical parameter, & running hours)
// Sumber data: tabel raw per-menit per mesin (skema data_format_0..7, tiap
// kolom = 1 parameter instan, BUKAN totalizer). Beda mesin bisa beda jumlah
// & arti parameter -> di-config per key di MACHINE_CONFIG, tinggal tambah
// key baru kalau ada mesin baru yang mau dipantau.
//
// Deteksi RUNNING/STOP: salah satu parameter (biasanya speed/flow, default
// "flowCol") dipakai sebagai acuan - kalau nilainya > threshold dianggap
// RUNNING, selain itu STOP. flowCol & threshold dikirim dari frontend biar
// bisa disesuaikan per mesin tanpa ubah backend (default per mesin ada di
// MACHINE_CONFIG[...].defaultFlowCol / defaultThreshold).
// ─────────────────────────────────────────────────────────────────────────
const MACHINE_CONFIG = {
  fbd_gea: {
    table: "cMT-C21B_FBD_GEA_data",
    label: "FBD GEA",
    // urutan HARUS sama dengan data_format_0..7 di tabel (lihat Node-RED
    // function "Build Insert FBD_GEA" / "Parse & Cache FBD_GEA")FIC2000_Flow
    params: [
      { col: 0, key: "SC3076_SpeedMotor", label: "Speed Motor", tag: "SC3076", unit: "%" },
      { col: 1, key: "TIS3012_OutletTemp", label: "Outlet Temp", tag: "TIS3012", unit: "°C" },
      { col: 2, key: "TIC0115_ProductTemp", label: "Product Temp", tag: "TIC0115", unit: "°C" },
      { col: 3, key: "TIC2001_InletTemp", label: "Inlet Temp", tag: "TIC2001", unit: "°C" },
      { col: 4, key: "FCV2002_ValvePosition", label: "Valve Position", tag: "FCV2002", unit: "%" },
      { col: 5, key: "PI0140_InletPress", label: "Inlet Pressure", tag: "PI0140", unit: "Pa" },
      { col: 6, key: "PI0141_ProdPress", label: "Product Pressure", tag: "PI0141", unit: "Pa" },
      { col: 7, key: "PI0142_OutPress", label: "Outlet Pressure", tag: "PI0142", unit: "Pa" },
      { col: 8, key: "FIC2000_Flow", label: "Flow", tag: "FIC2000", unit: "m3/h" },

    ],
    defaultFlowCol: 0, // default parameter acuan running = Speed Motor
    defaultThreshold: 0,
  },
  // Tambah mesin lain di sini kalau ada, contoh:
  // mesin_lain: { table: "cMT-C21B_XXX_data", label: "Mesin Lain", params: [...], defaultFlowCol: 0, defaultThreshold: 200 },
};

const MACHINE_SHIFT_DEFAULT = {
  shift1_start: "06:00", shift1_end: "14:00",
  shift2_start: "14:00", shift2_end: "22:00",
  shift3_start: "22:00", shift3_end: "06:00",
};

// "HH:mm" -> menit sejak 00:00. Balikin fallback kalau formatnya salah.
function hhmmToMinutes(str, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(str || "").trim());
  if (!m) return fallback;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return fallback;
  return h * 60 + mi;
}

// Cek apakah `minuteOfDay` masuk range shift [start, end). Support shift yang
// nyebrang tengah malam (mis. 22:00 - 06:00).
function isInShiftRange(minuteOfDay, startMin, endMin) {
  if (startMin === endMin) return true; // shift 24 jam penuh
  if (startMin < endMin) return minuteOfDay >= startMin && minuteOfDay < endMin;
  return minuteOfDay >= startMin || minuteOfDay < endMin;
}

function pad2(n) {
  return String(n).padStart(2, "0");
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
      const queryData = `SELECT TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE
(
    TABLE_NAME LIKE '%cMT-C21B_%'
    OR TABLE_NAME LIKE '%_data'
)
AND TABLE_NAME NOT LIKE '%_data_format'
AND TABLE_NAME NOT LIKE '%_data_section'
AND NOT (BINARY TABLE_NAME LIKE 'cMT-C21B_CH%');`;
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
          DATE_FORMAT(FROM_UNIXTIME(\`time@timestamp\`- 7 * 3600 ), '%Y-%m-%d %H:%i:%s') AS label,
          data_index AS x,
          data_format_${format} AS y
        FROM ${db.escapeId(area)}
        WHERE
          FROM_UNIXTIME(\`time@timestamp\` - 7 * 3600) BETWEEN ${db.escape(start)} AND ${db.escape(finish)}
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
        DATE_FORMAT(FROM_UNIXTIME(\`time@timestamp\`- 7 * 3600), '%Y-%m-%d %H:%i:%s') AS date,
        ROUND(data_format_0, 2) AS temp,
        ROUND(data_format_1, 2) AS RH,
        ROUND(data_format_2, 2) AS DP
        FROM ${db.escapeId(area)}
        WHERE
          FROM_UNIXTIME(\`time@timestamp\`- 7 * 3600) BETWEEN ${db.escape(start)} AND ${db.escape(finish)}
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

  // Area EMS dikelompokkan per AHU, dipakai buat dropdown Area yang
  // bertingkat (header AHU + list ruangan) di frontend.
  // Sumber grouping: tabel ems_area_ahu_mapping (lihat migration SQL).
  // Ruangan yang ada di DB tapi belum ke-mapping ke AHU manapun tetap
  // ditampilkan, dikumpulkan di grup "Belum Dikelompokkan" - supaya
  // ruangan baru nggak hilang begitu aja dari dropdown.



//   getAreaGroupedByAhu: async (request, response) => {
//     try {
//       const mappingRows = await query(
//         `SELECT ahu, table_name FROM ems_area_ahu_mapping ORDER BY ahu, table_name`
//       );

//       const liveTablesQuery = `SELECT TABLE_NAME
// FROM INFORMATION_SCHEMA.TABLES
// WHERE
// (
//     TABLE_NAME LIKE '%cMT-C21B_%'
//     OR TABLE_NAME LIKE '%_data'
// )
// AND TABLE_NAME NOT LIKE '%_data_format'
// AND TABLE_NAME NOT LIKE '%_data_section'
// AND NOT (BINARY TABLE_NAME LIKE 'cMT-C21B_CH%');`;
//       const liveTables = await query(liveTablesQuery);

//       const mappedNames = new Set(mappingRows.map((row) => row.table_name));
//       const grouped = {};

//       mappingRows.forEach((row) => {
//         if (!grouped[row.ahu]) grouped[row.ahu] = [];
//         grouped[row.ahu].push(row.table_name);
//       });

//       const unmapped = liveTables
//         .map((row) => row.TABLE_NAME)
//         .filter((name) => !mappedNames.has(name));

//       if (unmapped.length > 0) {
//         grouped["Belum Dikelompokkan"] = unmapped;
//       }

//       const result = Object.keys(grouped)
//         .sort()
//         .map((ahu) => ({ ahu, rooms: grouped[ahu] }));

//       return response.status(200).send(result);
//     } catch (err) {
//       return handleDbError(err, response, "getAreaGroupedByAhu");
//     }
//   },

getAreaGroupedByAhu: async (request, response) => {
    try {
      const mappingRows = await query(
        `SELECT ahu, table_name FROM ems_area_ahu_mapping ORDER BY ahu, table_name`
      );

      // --- PERBAIKAN DI SINI ---
      // Menambahkan TABLE_SCHEMA = 'uty_db1_backup' agar tidak bocor mengambil tabel dari uty_db1
      const liveTablesQuery = `SELECT TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = 'uty_db1_backup'
AND (
    TABLE_NAME LIKE '%cMT-C21B_%'
    OR TABLE_NAME LIKE '%_data'
)
AND TABLE_NAME NOT LIKE '%_data_format'
AND TABLE_NAME NOT LIKE '%_data_section'
AND NOT (BINARY TABLE_NAME LIKE 'cMT-C21B_CH%');`;
      
      const liveTables = await query(liveTablesQuery);

      const mappedNames = new Set(mappingRows.map((row) => row.table_name));
      const grouped = {};

      mappingRows.forEach((row) => {
        if (!grouped[row.ahu]) grouped[row.ahu] = [];
        grouped[row.ahu].push(row.table_name);
      });

      const unmapped = liveTables
        .map((row) => row.TABLE_NAME)
        .filter((name) => !mappedNames.has(name));

      if (unmapped.length > 0) {
        //grouped["Belum Dikelompokkan"] = unmapped;
      }

      const result = Object.keys(grouped)
        .sort()
        .map((ahu) => ({ ahu, rooms: grouped[ahu] }));

      return response.status(200).send(result);
    } catch (err) {
      return handleDbError(err, response, "getAreaGroupedByAhu");
    }
  },
  //===================================================================================




  //===============CHILLER================================================================
  getAllDataChiller: async (request, response) => {
    try {
      const { area, start, finish } = request.query;
      if (!area || !start || !finish) {
        return response.status(400).send({ message: "Parameter area, start, finish wajib diisi" });
      }

      const queryData = `SELECT
        data_index AS id,
        DATE_FORMAT(FROM_UNIXTIME(\`time@timestamp\`- 7 * 3600), '%Y-%m-%d %H:%i:%s') AS date,
        ROUND(data_format_0, 2) AS capacity,
        ROUND(data_format_1, 2) AS current,
        ROUND(data_format_2, 2) AS kwInput,
        ROUND(data_format_3, 2) AS kwOutput,
        ROUND(data_format_4, 2) AS cop,
        ROUND(data_format_5, 2) AS deltaT,
        ROUND(data_format_6, 2) AS kwTr
        FROM ${db.escapeId(area)}
        WHERE
          FROM_UNIXTIME(\`time@timestamp\`- 7 * 3600) BETWEEN ${db.escape(start)} AND ${db.escape(finish)}
        ORDER BY
          \`time@timestamp\``;

      db.query(queryData, (err, result) => {
        if (err) return handleDbError(err, response, "getAllDataChiller");
        return response.status(200).send(result);
      });
    } catch (err) {
      return handleDbError(err, response, "getAllDataChiller");
    }
  },
  //===================================================================================


  //===============MACHINE (mesin - realtime, historical & running hours)============
  // Konstanta & helper (MACHINE_CONFIG, hhmmToMinutes, isInShiftRange, pad2)
  // ada di atas, deket handleDbError - bukan di sini karena object literal
  // module.exports cuma boleh isi key: value.

  // Daftar mesin & parameter yang dipantau - dipakai frontend buat isi
  // dropdown mesin/parameter tanpa hardcode di React.
  getMachineConfig: async (request, response) => {
    try {
      const machines = Object.keys(MACHINE_CONFIG).map((key) => {
        const cfg = MACHINE_CONFIG[key];
        return {
          key,
          label: cfg.label,
          params: cfg.params,
          defaultFlowCol: cfg.defaultFlowCol,
          defaultThreshold: cfg.defaultThreshold,
        };
      });
      return response.status(200).send({ machines });
    } catch (err) {
      return handleDbError(err, response, "getMachineConfig");
    }
  },

  // Semua parameter mesin (data_format_0..7, sudah dikasih nama sesuai
  // MACHINE_CONFIG) untuk rentang tanggal tertentu - dipakai grafik
  // historikal parameter.
  getMachineHistorical: async (request, response) => {
    try {
      const { machine, start, finish } = request.query;
      if (!machine || !start || !finish) {
        return response.status(400).send({ message: "Parameter machine, start, finish wajib diisi" });
      }
      if (!Object.prototype.hasOwnProperty.call(MACHINE_CONFIG, machine)) {
        return response.status(400).send({
          message: `Parameter machine wajib diisi salah satu dari: ${Object.keys(MACHINE_CONFIG).join(", ")}`,
        });
      }
      const cfg = MACHINE_CONFIG[machine];

      const selectCols = cfg.params
        .map((p) => `ROUND(data_format_${p.col}, 2) AS ${db.escapeId(p.key)}`)
        .join(",\n        ");

      const queryData = `SELECT
        DATE_FORMAT(FROM_UNIXTIME(\`time@timestamp\`- 7 * 3600), '%Y-%m-%d %H:%i:%s') AS date,
        ${selectCols}
        FROM ${db.escapeId(cfg.table)}
        WHERE
          FROM_UNIXTIME(\`time@timestamp\`- 7 * 3600) BETWEEN ${db.escape(start)} AND ${db.escape(finish)}
        ORDER BY
          \`time@timestamp\``;

      db.query(queryData, (err, result) => {
        if (err) return handleDbError(err, response, "getMachineHistorical");
        return response.status(200).send(result);
      });
    } catch (err) {
      return handleDbError(err, response, "getMachineHistorical");
    }
  },

  // Kalkulasi jam RUNNING vs STOP, di-group per hari & per shift.
  // Logika: ambil tiap baris + timestamp baris berikutnya (window function
  // LEAD - butuh MariaDB >= 10.2 / MySQL >= 8.0), durasi baris = selisih
  // waktu ke baris berikutnya. Kalau durasi > MAX_GAP_SEC (data logging
  // sempat putus/nge-gap), durasi itu DIBUANG - biar downtime sistem gak
  // asal ke-count jadi RUN atau STOP.
  getMachineRunningHours: async (request, response) => {
    try {
      const { machine, start, finish } = request.query;
      if (!machine || !start || !finish) {
        return response.status(400).send({ message: "Parameter machine, start, finish wajib diisi" });
      }
      if (!Object.prototype.hasOwnProperty.call(MACHINE_CONFIG, machine)) {
        return response.status(400).send({
          message: `Parameter machine wajib diisi salah satu dari: ${Object.keys(MACHINE_CONFIG).join(", ")}`,
        });
      }
      const cfg = MACHINE_CONFIG[machine];

      let { flowCol, threshold } = request.query;
      flowCol = flowCol === undefined ? cfg.defaultFlowCol : Number(flowCol);
      threshold = threshold === undefined ? cfg.defaultThreshold : Number(threshold);
      if (!Number.isInteger(flowCol) || flowCol < 0 || flowCol > 7) {
        return response.status(400).send({ message: "Parameter flowCol tidak valid (harus 0-7)" });
      }
      if (!Number.isFinite(threshold)) {
        return response.status(400).send({ message: "Parameter threshold tidak valid" });
      }

      // Setingan shift - kalau gak dikirim dari frontend, pakai default.
      const s1s = hhmmToMinutes(request.query.shift1Start, hhmmToMinutes(MACHINE_SHIFT_DEFAULT.shift1_start));
      const s1e = hhmmToMinutes(request.query.shift1End, hhmmToMinutes(MACHINE_SHIFT_DEFAULT.shift1_end));
      const s2s = hhmmToMinutes(request.query.shift2Start, hhmmToMinutes(MACHINE_SHIFT_DEFAULT.shift2_start));
      const s2e = hhmmToMinutes(request.query.shift2End, hhmmToMinutes(MACHINE_SHIFT_DEFAULT.shift2_end));
      const s3s = hhmmToMinutes(request.query.shift3Start, hhmmToMinutes(MACHINE_SHIFT_DEFAULT.shift3_start));
      const s3e = hhmmToMinutes(request.query.shift3End, hhmmToMinutes(MACHINE_SHIFT_DEFAULT.shift3_end));
      const shiftRanges = [
        { shift: 1, start: s1s, end: s1e },
        { shift: 2, start: s2s, end: s2e },
        { shift: 3, start: s3s, end: s3e },
      ];

      const MAX_GAP_SEC = 300; // > 5 menit dianggap logging putus, gak dihitung

      const q = `
        SELECT
          \`time@timestamp\` AS ts,
          data_format_${flowCol} AS flowVal,
          LEAD(\`time@timestamp\`) OVER (ORDER BY \`time@timestamp\` ASC) AS nextTs
        FROM ${db.escapeId(cfg.table)}
        WHERE FROM_UNIXTIME(\`time@timestamp\` - 7 * 3600) BETWEEN ${db.escape(start)} AND ${db.escape(finish)}
        ORDER BY \`time@timestamp\` ASC
      `;

      const rows = await query(q);

      const dailyMap = new Map();       // dayKey -> { runSec, stopSec }
      const shiftDailyMap = new Map();  // `${dayKey}|${shift}` -> { runSec, stopSec }
      const shiftSummaryMap = new Map([
        [1, { runSec: 0, stopSec: 0 }],
        [2, { runSec: 0, stopSec: 0 }],
        [3, { runSec: 0, stopSec: 0 }],
      ]);

      // Timeline: segmen kontinu RUN/STOP dengan waktu mulai-selesai persis
      // (sampai detik), dipecah per hari kalau segmennya nyebrang tengah
      // malam - dipakai komponen "Timeline Run/Stop per Hari" di frontend
      // biar keliatan potongan jam:menit berapa sampai berapa mesin run/stop.
      const timelineMap = new Map(); // dayKey -> [{ state, start, end, durationMin }]
      let openSeg = null;            // segmen yang lagi "kebuka": { state, startLocalMs, endLocalMs }
      const fmtLocal = (ms) => {
        const d = new Date(ms);
        return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} `
          + `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
      };
      const dayKeyOfMs = (ms) => {
        const d = new Date(ms);
        return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
      };
      // Tutup segmen yang lagi kebuka & simpan ke timelineMap, dipecah per
      // hari kalau segmennya nyebrang tengah malam.
      const flushOpenSeg = () => {
        if (!openSeg) return;
        let cur = openSeg.startLocalMs;
        while (cur < openSeg.endLocalMs) {
          const dayStartMs = Math.floor(cur / 86400000) * 86400000;
          const segEndMs = Math.min(openSeg.endLocalMs, dayStartMs + 86400000);
          const dayKey = dayKeyOfMs(cur);
          if (!timelineMap.has(dayKey)) timelineMap.set(dayKey, []);
          timelineMap.get(dayKey).push({
            state: openSeg.state,
            start: fmtLocal(cur),
            end: fmtLocal(segEndMs),
            durationMin: Number(((segEndMs - cur) / 60000).toFixed(1)),
          });
          cur = segEndMs;
        }
        openSeg = null;
      };

      for (const row of rows) {
        if (row.nextTs === null || row.nextTs === undefined) { flushOpenSeg(); continue; } // baris terakhir, gak ada next
        const gapSec = Number(row.nextTs) - Number(row.ts);
        if (!Number.isFinite(gapSec) || gapSec <= 0 || gapSec > MAX_GAP_SEC) { flushOpenSeg(); continue; } // logging putus -> tutup segmen lama, jangan disambung

        // ts di tabel sudah "+7 jam" waktu disimpan Node-RED (lihat komentar
        // di flow), jadi buat balikin ke wall-clock WIB tinggal dikurangi 7
        // jam lagi lalu dibaca sebagai UTC (BUKAN local time server) - persis
        // pola FROM_UNIXTIME(ts - 7*3600) yang dipakai query lain di file ini.
        const localMs = (Number(row.ts) - 7 * 3600) * 1000;
        const nextLocalMs = (Number(row.nextTs) - 7 * 3600) * 1000;
        const d = new Date(localMs);
        const dayKey = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
        const minuteOfDay = d.getUTCHours() * 60 + d.getUTCMinutes();

        const isRun = Number(row.flowVal) > threshold;
        const state = isRun ? "run" : "stop";

        if (!dailyMap.has(dayKey)) dailyMap.set(dayKey, { runSec: 0, stopSec: 0 });
        const dailyBucket = dailyMap.get(dayKey);
        if (isRun) dailyBucket.runSec += gapSec;
        else dailyBucket.stopSec += gapSec;

        const matchedShift = shiftRanges.find((s) => isInShiftRange(minuteOfDay, s.start, s.end));
        if (matchedShift) {
          const shiftKey = `${dayKey}|${matchedShift.shift}`;
          if (!shiftDailyMap.has(shiftKey)) shiftDailyMap.set(shiftKey, { runSec: 0, stopSec: 0 });
          const shiftBucket = shiftDailyMap.get(shiftKey);
          if (isRun) shiftBucket.runSec += gapSec;
          else shiftBucket.stopSec += gapSec;

          const summaryBucket = shiftSummaryMap.get(matchedShift.shift);
          if (isRun) summaryBucket.runSec += gapSec;
          else summaryBucket.stopSec += gapSec;
        }

        // Sambung ke segmen timeline yang lagi kebuka kalau state-nya sama &
        // beneran nyambung (endLocalMs segmen sebelumnya == localMs baris
        // ini) - selain itu tutup segmen lama & mulai segmen baru.
        if (openSeg && openSeg.state === state && openSeg.endLocalMs === localMs) {
          openSeg.endLocalMs = nextLocalMs;
        } else {
          flushOpenSeg();
          openSeg = { state, startLocalMs: localMs, endLocalMs: nextLocalMs };
        }
      }
      flushOpenSeg(); // flush segmen terakhir yang masih kebuka pas loop selesai

      const toHours = (sec) => Number((sec / 3600).toFixed(2));

      const daily = Array.from(dailyMap.entries())
        .sort((a, b) => (a[0] > b[0] ? 1 : -1))
        .map(([date, v]) => ({ date, runHours: toHours(v.runSec), stopHours: toHours(v.stopSec) }));

      const shiftDaily = Array.from(shiftDailyMap.entries())
        .sort((a, b) => (a[0] > b[0] ? 1 : -1))
        .map(([key, v]) => {
          const [date, shift] = key.split("|");
          return { date, shift: Number(shift), runHours: toHours(v.runSec), stopHours: toHours(v.stopSec) };
        });

      const shiftSummary = [1, 2, 3].map((shift) => {
        const v = shiftSummaryMap.get(shift);
        return { shift, runHours: toHours(v.runSec), stopHours: toHours(v.stopSec) };
      });

      // timelineMap -> object biasa, diurutin per tanggal, dipakai frontend
      // buat render 1 bar per hari yang dipecah jadi segmen run(hijau)/stop(merah).
      const timeline = Object.fromEntries(
        Array.from(timelineMap.entries()).sort((a, b) => (a[0] > b[0] ? 1 : -1))
      );

      return response.status(200).send({
        machine,
        flowCol,
        threshold,
        shiftSettings: {
          shift1: { start: request.query.shift1Start || MACHINE_SHIFT_DEFAULT.shift1_start, end: request.query.shift1End || MACHINE_SHIFT_DEFAULT.shift1_end },
          shift2: { start: request.query.shift2Start || MACHINE_SHIFT_DEFAULT.shift2_start, end: request.query.shift2End || MACHINE_SHIFT_DEFAULT.shift2_end },
          shift3: { start: request.query.shift3Start || MACHINE_SHIFT_DEFAULT.shift3_start, end: request.query.shift3End || MACHINE_SHIFT_DEFAULT.shift3_end },
        },
        daily,
        shiftDaily,
        shiftSummary,
        timeline,
      });
    } catch (err) {
      return handleDbError(err, response, "getMachineRunningHours");
    }
  },

  // Setingan jam shift (dipakai sebagai default saat halaman Machine dibuka) -
  // disimpan 1 baris (id=1), pola UPSERT sama kayak getPageAccess /
  // updatePageAccess di bawah. Butuh tabel `machine_shift_config` (lihat SQL
  // migration yang dikirim terpisah).
  getMachineShiftConfig: async (request, response) => {
    try {
      const rows = await query(`SELECT * FROM machine_shift_config WHERE id = 1`);
      const cfg = rows[0] || { id: 1, ...MACHINE_SHIFT_DEFAULT };
      return response.status(200).send(cfg);
    } catch (err) {
      return handleDbError(err, response, "getMachineShiftConfig");
    }
  },

  updateMachineShiftConfig: async (request, response) => {
    try {
      const {
        shift1_start, shift1_end,
        shift2_start, shift2_end,
        shift3_start, shift3_end,
      } = request.body;

      const fields = { shift1_start, shift1_end, shift2_start, shift2_end, shift3_start, shift3_end };
      for (const key in fields) {
        if (!/^\d{1,2}:\d{2}$/.test(String(fields[key] || ""))) {
          return response.status(400).send({ message: `Format jam '${key}' tidak valid (HH:mm)` });
        }
      }

      const upsertQuery = `
        INSERT INTO machine_shift_config
          (id, shift1_start, shift1_end, shift2_start, shift2_end, shift3_start, shift3_end)
        VALUES (1, ${db.escape(shift1_start)}, ${db.escape(shift1_end)}, ${db.escape(shift2_start)}, ${db.escape(shift2_end)}, ${db.escape(shift3_start)}, ${db.escape(shift3_end)})
        ON DUPLICATE KEY UPDATE
          shift1_start = ${db.escape(shift1_start)}, shift1_end = ${db.escape(shift1_end)},
          shift2_start = ${db.escape(shift2_start)}, shift2_end = ${db.escape(shift2_end)},
          shift3_start = ${db.escape(shift3_start)}, shift3_end = ${db.escape(shift3_end)}
      `;
      await query(upsertQuery);
      return response.status(200).send({ message: "Setingan shift berhasil disimpan" });
    } catch (err) {
      return handleDbError(err, response, "updateMachineShiftConfig");
    }
  },
  //===================================================================================


  //===============ENERGY WATER (Trane1/Trane2 flow meter totalizer)==================
  // Helper functions & konstanta ada di atas, dekat handleDbError (bukan di
  // sini) karena object literal module.exports cuma boleh isi key: value.
  getEnergyWaterHistorical: async (request, response) => {
    try {
      const { start, finish } = request.query;
      let { period, meter } = request.query;
      if (!start || !finish) {
        return response.status(400).send({ message: "Parameter start, finish wajib diisi" });
      }
      if (!ENERGY_WATER_PERIODS.includes(period)) period = "hourly";
      if (!Object.prototype.hasOwnProperty.call(ENERGY_WATER_TABLES, meter)) {
        return response.status(400).send({
          message: `Parameter meter wajib diisi salah satu dari: ${Object.keys(ENERGY_WATER_TABLES).join(", ")}`,
        });
      }

      const fetchMeterRows = (tableName) => {
        const q = `
          SELECT
            \`time@timestamp\` AS ts,
            DATE_FORMAT(FROM_UNIXTIME(\`time@timestamp\` - 7 * 3600), '%Y-%m-%d %H:%i:%s') AS label,
            data_format_1 AS totalizer
          FROM ${db.escapeId(tableName)}
          WHERE FROM_UNIXTIME(\`time@timestamp\` - 7 * 3600) BETWEEN ${db.escape(start)} AND ${db.escape(finish)}
          ORDER BY \`time@timestamp\` ASC
        `;
        return query(q);
      };

      // Cuma query 1 tabel sesuai meter yang diminta - bukan Trane1+Trane2
      // sekaligus kayak sebelumnya. Rata-rata dihitung di frontend dari data
      // yang ke-tarik ini.
      const rawRows = await fetchMeterRows(ENERGY_WATER_TABLES[meter]);
      const grouped = groupEnergyWaterByPeriod(computeEnergyWaterDeltas(rawRows), period);
      const rows = formatEnergyWaterRows(grouped);

      return response.status(200).send({ period, meter, data: rows });
    } catch (err) {
      return handleDbError(err, response, "getEnergyWaterHistorical");
    }
  },
  //===================================================================================


  //===============ENERGY POWER (PP UTY1/PP LAPI1 power meter totalizer)==============
  // Helper functions & konstanta ada di atas, deket ENERGY_WATER_TABLES (bukan
  // di sini) karena object literal module.exports cuma boleh isi key: value.
  getEnergyPowerHistorical: async (request, response) => {
    try {
      const { start, finish } = request.query;
      let { period, meter } = request.query;
      if (!start || !finish) {
        return response.status(400).send({ message: "Parameter start, finish wajib diisi" });
      }
      if (!ENERGY_POWER_PERIODS.includes(period)) period = "hourly";
      if (!Object.prototype.hasOwnProperty.call(ENERGY_POWER_TABLES, meter)) {
        return response.status(400).send({
          message: `Parameter meter wajib diisi salah satu dari: ${Object.keys(ENERGY_POWER_TABLES).join(", ")}`,
        });
      }

      const fetchMeterRows = (tableName) => {
        const q = `
          SELECT
            \`time@timestamp\` AS ts,
            DATE_FORMAT(FROM_UNIXTIME(\`time@timestamp\` - 7 * 3600), '%Y-%m-%d %H:%i:%s') AS label,
            data_format_4 AS totalizer
          FROM ${db.escapeId(tableName)}
          WHERE FROM_UNIXTIME(\`time@timestamp\` - 7 * 3600) BETWEEN ${db.escape(start)} AND ${db.escape(finish)}
          ORDER BY \`time@timestamp\` ASC
        `;
        return query(q);
      };

      // Cuma query 1 tabel sesuai meter yang diminta - bukan UTY1+LAPI1
      // sekaligus. Rata-rata & konversi unit dihitung di frontend dari data
      // yang ke-tarik ini (backend selalu balikin satuan Wh).
      const rawRows = await fetchMeterRows(ENERGY_POWER_TABLES[meter]);
      const grouped = groupEnergyPowerByPeriod(computeEnergyPowerDeltas(rawRows), period);
      const rows = formatEnergyPowerRows(grouped);

      return response.status(200).send({ period, meter, data: rows });
    } catch (err) {
      return handleDbError(err, response, "getEnergyPowerHistorical");
    }
  },
  //===================================================================================


  //=========ENERGY POWER PARAMETERS (Voltage/Current/Power/Frequency analysis)=======
  // Beda sama getEnergyPowerHistorical di atas: data_format_0..3 itu bacaan
  // instan (Voltage, Current, Power, Frequency) - BUKAN totalizer. Jadi gak
  // ada delta, tinggal AVG/MAX/MIN langsung per bucket periode di SQL.
  getEnergyPowerParameters: async (request, response) => {
    try {
      const { start, finish } = request.query;
      let { period, meter } = request.query;
      if (!start || !finish) {
        return response.status(400).send({ message: "Parameter start, finish wajib diisi" });
      }
      if (!ENERGY_POWER_PERIODS.includes(period)) period = "hourly";
      if (!Object.prototype.hasOwnProperty.call(ENERGY_POWER_TABLES, meter)) {
        return response.status(400).send({
          message: `Parameter meter wajib diisi salah satu dari: ${Object.keys(ENERGY_POWER_TABLES).join(", ")}`,
        });
      }

      const tableName = ENERGY_POWER_TABLES[meter];
      const dateFormat = ENERGY_POWER_PARAM_PERIOD_FORMAT[period];

      const q = `
        SELECT
          DATE_FORMAT(FROM_UNIXTIME(\`time@timestamp\` - 7 * 3600), ${db.escape(dateFormat)}) AS label,
          AVG(data_format_0) AS voltage_avg, MAX(data_format_0) AS voltage_max, MIN(data_format_0) AS voltage_min,
          AVG(data_format_1) AS current_avg, MAX(data_format_1) AS current_max, MIN(data_format_1) AS current_min,
          AVG(data_format_2) AS power_avg, MAX(data_format_2) AS power_max, MIN(data_format_2) AS power_min,
          AVG(data_format_3) AS freq_avg, MAX(data_format_3) AS freq_max, MIN(data_format_3) AS freq_min
        FROM ${db.escapeId(tableName)}
        WHERE FROM_UNIXTIME(\`time@timestamp\` - 7 * 3600) BETWEEN ${db.escape(start)} AND ${db.escape(finish)}
        GROUP BY label
        ORDER BY label ASC
      `;

      const rawRows = await query(q);

      const round = (v, d) => (v === null || v === undefined ? null : Number(Number(v).toFixed(d)));

      const rows = rawRows.map((r, idx) => ({
        id: idx + 1,
        label: r.label,
        voltage: { avg: round(r.voltage_avg, 1), max: round(r.voltage_max, 1), min: round(r.voltage_min, 1) },
        current: { avg: round(r.current_avg, 2), max: round(r.current_max, 2), min: round(r.current_min, 2) },
        power: { avg: round(r.power_avg, 3), max: round(r.power_max, 3), min: round(r.power_min, 3) },
        frequency: { avg: round(r.freq_avg, 2), max: round(r.freq_max, 2), min: round(r.freq_min, 2) },
      }));

      return response.status(200).send({ period, meter, data: rows });
    } catch (err) {
      return handleDbError(err, response, "getEnergyPowerParameters");
    }
  },
  //===================================================================================


  // ============================================================
  // PAGE MANAGEMENT ACCESS
  // ============================================================
  
  getPageAccess: async (req, res) => {
    try {
      const getQueryData = "SELECT level, pages FROM page_access";
      const result = await query(getQueryData);

      const matrix = {};
      
      // Transformasi dari array object DB menjadi bentuk: { "1": [...], "2": [...] }
      result.forEach((row) => {
        try {
          matrix[row.level] = JSON.parse(row.pages);
        } catch(e) {
          // Fallback jika string tidak bisa di-parse
          matrix[row.level] = []; 
        }
      });
      
      return res.status(200).send(matrix);
    } catch (err) {
      return handleDbError(err, res, "getPageAccess");
    }
  },

  updatePageAccess: async (req, res) => {
    try {
      const matrix = req.body; // Payload dari frontend: { "1": ["Maintenance"], "2": [...] }
      
      if (!matrix || typeof matrix !== "object") {
        return res.status(400).send({ message: "Data matrix tidak valid" });
      }

      // Looping object matrix untuk melakukan UPSERT (Insert if not exist, Update if exist)
      const promises = Object.keys(matrix).map((level) => {
        const pagesStr = JSON.stringify(matrix[level]); // Ubah array jadi string
        
        const upsertQuery = `
          INSERT INTO page_access (level, pages)
          VALUES (${db.escape(level)}, ${db.escape(pagesStr)})
          ON DUPLICATE KEY UPDATE pages = ${db.escape(pagesStr)}
        `;
        
        return query(upsertQuery);
      });

      await Promise.all(promises); // Tunggu semua level selesai disimpan

      return res.status(200).send({ message: "Akses halaman berhasil disimpan" });
    } catch (err) {
      return handleDbError(err, res, "updatePageAccess");
    }
  },
  
};