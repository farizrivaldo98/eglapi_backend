const express = require("express");
const databaseControllers = require("../controllers/databaseControllers");

const routers = express.Router();
const { veryfyToken, checkRole } = require("../middleware/auth");

routers.get("/get", databaseControllers.getData);
routers.get("/fetch", databaseControllers.fetchEdit);
routers.post("/add", databaseControllers.addData);
routers.patch("/edit/:id", databaseControllers.editData);
routers.delete("/delet/:id", databaseControllers.deletData);

routers.get("/pareto", databaseControllers.fetchDataPareto);
routers.get("/line1", databaseControllers.fetchDataLine1);
routers.get("/line2", databaseControllers.fetchDataLine2);
routers.get("/line3", databaseControllers.fetchDataLine3);
routers.get("/line4", databaseControllers.fetchDataLine4);

routers.post("/register", databaseControllers.register);
routers.post("/login", databaseControllers.login);
routers.get("/user", veryfyToken, checkRole, databaseControllers.fetchAlluser);
routers.post("/check-Login", veryfyToken, databaseControllers.checkLogin);

routers.get("/instrument", databaseControllers.fetchDataInstrument);
routers.post("/hardness", databaseControllers.fetchDataHardness);
routers.post("/thickness", databaseControllers.fetchDataTickness);
routers.post("/diameter", databaseControllers.fetchDataDiameter);

routers.get("/oee", databaseControllers.fetchOee);
routers.get("/variableoee", databaseControllers.fetchVariableOee);


routers.get("/getTabelEMS", databaseControllers.getTableEMS);
routers.get("/getAreaGroupedByAhu", databaseControllers.getAreaGroupedByAhu);
routers.get("/getTempChart", databaseControllers.getTempChart);
routers.get("/getAllDataEMS", databaseControllers.getAllDataEMS);
routers.get("/getAllDataChiller", databaseControllers.getAllDataChiller);

// Tambahkan di bawah kumpulan router lainnya
routers.get("/page-access",veryfyToken,databaseControllers.getPageAccess);
routers.put("/page-access",veryfyToken,checkRole,databaseControllers.updatePageAccess);

// Energy Water - historical hourly/daily/monthly consumption (Trane1/Trane2 flow meter totalizer)
routers.get("/getEnergyWaterHistorical", databaseControllers.getEnergyWaterHistorical);

// Energy Power - historical hourly/daily/monthly consumption (PP UTY1/PP LAPI1 power meter totalizer)
routers.get("/getEnergyPowerHistorical", databaseControllers.getEnergyPowerHistorical);

// Energy Power - Voltage/Current/Power/Frequency analysis (AVG/MAX/MIN per periode)
routers.get("/getEnergyPowerParameters", databaseControllers.getEnergyPowerParameters);


router.get("/getMachineConfig", Controller.getMachineConfig);
router.get("/getMachineHistorical", Controller.getMachineHistorical);
router.get("/getMachineRunningHours", Controller.getMachineRunningHours);
router.get("/getMachineShiftConfig", Controller.getMachineShiftConfig);
router.post("/updateMachineShiftConfig", Controller.updateMachineShiftConfig);


module.exports = routers;