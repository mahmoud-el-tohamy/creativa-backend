import XlsxStyle from 'xlsx-js-style';

interface ParsedAttendanceRow {
  workshopName: string;
  dateFrom: string;
  name: string;
  gender: string;
  age: string | number;
  customerType: string;
  mobile: string;
  email: string;
  faculty: string;
  nationalId: string;
}

interface SessionGroup {
  workshopName: string;
  date: string;           // normalized date string for grouping
  dateDisplay: string;    // formatted as "M-D-YYYY"
  trainees: ParsedAttendanceRow[];
}

interface WorkshopGroup {
  workshopName: string;
  sessions: SessionGroup[];
  totalTrainees: number;
}

const OUTPUT_HEADERS = [
  "Details", "Name", "Gender", "Age",
  "Profile", "Phone No.", "Email", "Faculty", "ID No."
];

// Helper to convert (row, col) to Excel A1 notation
function cellAddr(r: number, c: number): string {
  return XlsxStyle.utils.encode_cell({ c, r });
}

function sanitizeSheetName(name: string): string {
  if (!name || name.trim() === "") return "غير محدد";
  // Replace invalid chars (\ / ? * [ ] :) with space
  let safeName = name.replace(/[\\/?*[\]:]/g, " ").trim();
  // Excel sheet names max 31 chars
  if (safeName.length > 31) {
    safeName = safeName.substring(0, 31).trim();
  }
  return safeName;
}

function buildWorkshopSheet(workshop: WorkshopGroup): XlsxStyle.WorkSheet {
  const ws: XlsxStyle.WorkSheet = {};
  let currentRow = 0;

  const thinBorder = { style: 'thin', color: { rgb: "000000" } };
  const thinBorderAll = {
    top: thinBorder,
    bottom: thinBorder,
    left: thinBorder,
    right: thinBorder
  };

  const SESSION_HEADER_STYLE = {
    fill: { fgColor: { rgb: "FFFF00" } },
    font: { bold: true, sz: 11 },
    border: thinBorderAll,
    alignment: { horizontal: "left", vertical: "center" },
  };

  const COLUMN_HEADER_STYLE = {
    fill: { fgColor: { rgb: "D9D9D9" } },
    font: { bold: true, sz: 10 },
    border: thinBorderAll,
    alignment: { horizontal: "center", vertical: "center" },
  };

  const INSTRUCTOR_CELL_STYLE = {
    fill: { fgColor: { rgb: "F5F5F5" } }, // light gray = "fill manually"
    font: { sz: 10, color: { rgb: "999999" }, italic: true },
    alignment: { horizontal: "left", vertical: "center" },
    border: thinBorderAll, // Ensure border for instructor cell too
  };

  const DATA_EVEN_STYLE = {
    fill: { fgColor: { rgb: "FFFFFF" } },
    font: { sz: 10 },
    border: thinBorderAll,
  };

  const DATA_ODD_STYLE = {
    fill: { fgColor: { rgb: "F9F9F9" } },
    font: { sz: 10 },
    border: thinBorderAll,
  };

  const BLACK_SEPARATOR_STYLE = {
    fill: { fgColor: { rgb: "000000" } },
  };

  for (let si = 0; si < workshop.sessions.length; si++) {
    const session = workshop.sessions[si];

    // SESSION HEADER ROW
    // Col A: Workshop Name
    ws[cellAddr(currentRow, 0)] = {
      v: session.workshopName || "غير محدد",
      t: 's',
      s: SESSION_HEADER_STYLE,
    };
    // Col B: Date
    ws[cellAddr(currentRow, 1)] = {
      v: session.dateDisplay,
      t: 's',
      s: SESSION_HEADER_STYLE,
    };
    // Col C: Instructor (blank, gray fill hint)
    ws[cellAddr(currentRow, 2)] = {
      v: "",
      t: 's',
      s: INSTRUCTOR_CELL_STYLE,
    };
    // Cols D-I: empty with session header style
    for (let c = 3; c <= 8; c++) {
      ws[cellAddr(currentRow, c)] = { v: "", t: 's', s: SESSION_HEADER_STYLE };
    }
    currentRow++;

    // COLUMN HEADERS ROW
    OUTPUT_HEADERS.forEach((header, ci) => {
      ws[cellAddr(currentRow, ci)] = {
        v: header,
        t: 's',
        s: COLUMN_HEADER_STYLE,
      };
    });
    currentRow++;

    // DATA ROWS
    session.trainees.forEach((trainee, ti) => {
      const style = ti % 2 === 0 ? DATA_EVEN_STYLE : DATA_ODD_STYLE;
      const values = [
        "",                        // Details (empty)
        trainee.name,
        trainee.gender,
        trainee.age,
        trainee.customerType,
        trainee.mobile,
        trainee.email,
        trainee.faculty,
        trainee.nationalId,
      ];
      values.forEach((val, ci) => {
        ws[cellAddr(currentRow, ci)] = { v: val ?? "", t: typeof val === 'number' ? 'n' : 's', s: style };
      });
      currentRow++;
    });

    // BLACK SEPARATOR (between sessions, not after last)
    if (si < workshop.sessions.length - 1) {
      for (let c = 0; c <= 8; c++) {
        ws[cellAddr(currentRow, c)] = { v: "", t: 's', s: BLACK_SEPARATOR_STYLE };
      }
      ws['!rows'] = ws['!rows'] || [];
      ws['!rows'][currentRow] = { hpt: 6 }; // 6pt height = thin black line
      currentRow++;
    }
  }

  // Set sheet range
  ws['!ref'] = `A1:I${currentRow}`;

  // Column widths
  ws['!cols'] = [
    { wch: 12 },  // A: Details
    { wch: 28 },  // B: Name
    { wch: 10 },  // C: Gender
    { wch: 6 },   // D: Age
    { wch: 18 },  // E: Profile/Customer Type
    { wch: 16 },  // F: Phone No.
    { wch: 28 },  // G: Email
    { wch: 24 },  // H: Faculty
    { wch: 16 },  // I: ID No.
  ];

  return ws;
}

export async function buildAttendanceSheet(fileBuffer: Buffer): Promise<{
  buffer: Buffer;
  stats: {
    totalRows: number;
    workshopCount: number;
    sessionCount: number;
  };
}> {
  const workbook = XlsxStyle.read(fileBuffer, { type: "buffer" });
  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error("الملف لا يحتوي على أوراق عمل صالحة");
  }
  
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows = XlsxStyle.utils.sheet_to_json<Record<string, unknown>>(
    firstSheet,
    { defval: "" }
  );

  const totalRows = rawRows.length;
  if (totalRows === 0) {
    throw new Error("الملف فارغ أو لا يحتوي على بيانات");
  }

  // Parse raw rows into structured rows
  const parsedRows: ParsedAttendanceRow[] = rawRows.map(row => ({
    workshopName: String(row["Workshop Name"] || "").trim(),
    dateFrom: String(row["Date - From"] || "").trim(),
    name: String(row['Name "In English"'] || row['Name'] || row['الاسم'] || "").trim(),
    gender: String(row["Gender"] || "").trim(),
    age: row["Age"] ? Number(row["Age"]) || String(row["Age"]) : "",
    customerType: String(row["Customer Type"] || "").trim(),
    mobile: String(row["Mobile"] || "").trim(),
    email: String(row["Email"] || "").trim(),
    faculty: String(row["Faculty"] || "").trim(),
    nationalId: String(row["National ID Number"] || "").trim(),
  }));

  // Group by workshopName -> date -> trainees
  const workshopMap = new Map<string, Map<string, ParsedAttendanceRow[]>>();

  for (const row of parsedRows) {
    let wName = row.workshopName;
    if (!wName) wName = "غير محدد";

    if (!workshopMap.has(wName)) {
      workshopMap.set(wName, new Map<string, ParsedAttendanceRow[]>());
    }
    const sessionMap = workshopMap.get(wName)!;

    // Normalize date for grouping (simple approach)
    let dateKey = row.dateFrom || "غير محدد";
    // Also store the exact raw string if it's not parseable, but we try to parse it
    // Wait, the input date string is like "3-6-2026" or "2026-06-03".
    // We group by the raw string since it should be consistent per session in the form.
    if (!sessionMap.has(dateKey)) {
      sessionMap.set(dateKey, []);
    }
    sessionMap.get(dateKey)!.push(row);
  }

  // Build sorted workshop array
  const sortedWorkshops: WorkshopGroup[] = [];
  let totalSessions = 0;

  for (const [wName, sessionMap] of workshopMap.entries()) {
    const sessions: SessionGroup[] = [];
    for (const [dateKey, trainees] of sessionMap.entries()) {
      sessions.push({
        workshopName: wName,
        date: dateKey,
        dateDisplay: dateKey,
        trainees
      });
      totalSessions++;
    }

    // Sort sessions by date natively (basic string sort works okay for most, but not true date sort)
    // For now, assume the raw dates are reasonably sortable or just keep them as-is
    
    let totalTrainees = 0;
    sessions.forEach(s => totalTrainees += s.trainees.length);

    sortedWorkshops.push({
      workshopName: wName,
      sessions,
      totalTrainees
    });
  }

  // Sort workshops alphabetically, "غير محدد" last
  sortedWorkshops.sort((a, b) => {
    if (a.workshopName === "غير محدد") return 1;
    if (b.workshopName === "غير محدد") return -1;
    return a.workshopName.localeCompare(b.workshopName, 'ar');
  });

  const outputWb = XlsxStyle.utils.book_new();
  const usedSheetNames = new Set<string>();

  for (const workshop of sortedWorkshops) {
    const sheet = buildWorkshopSheet(workshop);
    let safeName = sanitizeSheetName(workshop.workshopName);
    
    // Handle duplicates
    let counter = 2;
    let finalName = safeName;
    while (usedSheetNames.has(finalName)) {
      const suffix = `_${counter}`;
      const baseLen = 31 - suffix.length;
      finalName = safeName.substring(0, baseLen) + suffix;
      counter++;
    }
    usedSheetNames.add(finalName);

    XlsxStyle.utils.book_append_sheet(outputWb, sheet, finalName);
  }

  const buffer = XlsxStyle.write(outputWb, {
    type: "buffer",
    bookType: "xlsx",
    cellStyles: true,
  });

  return {
    buffer,
    stats: {
      totalRows,
      workshopCount: sortedWorkshops.length,
      sessionCount: totalSessions
    }
  };
}
