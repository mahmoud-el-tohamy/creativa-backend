const XLSX = require("xlsx");
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([ ["Time"], [0.1875] ]);
ws.B1 = { t: 'n', v: 0.1875, z: 'h:mm' };
// Wait, xlsx-js-style or xlsx. Let's just create a test
