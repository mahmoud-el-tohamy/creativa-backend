import { AuditLog } from "../models/AuditLog";
import { Request, Response } from "express";
import { buildAttendanceSheet } from "../services/attendanceSheetBuilder";

export async function buildAttendanceSheetHandler(req: Request, res: Response) {
  try {
    if (!(req as any).file) {
      return res.status(400).json({
        success: false,
        message: "لم يتم رفع أي ملف",
      });
    }

    const result = await buildAttendanceSheet((req as any).file.buffer);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="attendance_${Date.now()}.xlsx"`
    );
    res.setHeader("X-Stats-Workshops", result.stats.workshopCount.toString());
    res.setHeader("X-Stats-Sessions", result.stats.sessionCount.toString());
    res.setHeader("X-Stats-Total-Rows", result.stats.totalRows.toString());

    // Log audit
    if ((req as any).user) {
      await AuditLog.create({
        action: "attendance_sheet_build",
        performedBy: (req as any).user.id,
        performedByName: (req as any).user.displayName || "Unknown",
        performedByRole: (req as any).user.role,
        details: `تم بناء شيت الحضور — ${result.stats.totalRows} سجل | ${result.stats.workshopCount} Workshop | ${result.stats.sessionCount} جلسة`,
        metadata: result.stats,
        ipAddress: req.ip || req.socket.remoteAddress || "unknown",
      });
    }

    res.send(result.buffer);
  } catch (error: any) {
    console.error("Error building attendance sheet:", error);
    res.status(500).json({
      success: false,
      message: error.message || "حدث خطأ أثناء معالجة الملف",
    });
  }
}
