import cron from "node-cron";
import { BlacklistEntry } from "../models/BlacklistEntry";
import { AuditLog } from "../models/AuditLog";

export const initCronJobs = () => {
  // Run automatically once a day at 3:00 AM
  cron.schedule("0 3 * * *", async () => {
    console.log("[Cron] Starting daily cleanup tasks...");
    
    try {
      // 1. Clean up expired Blacklist and Warning List entries
      // The BlacklistEntry.cleanupExpired() deletes entries where expiresAt < now
      const blacklistDeleted = await BlacklistEntry.cleanupExpired();
      
      if (blacklistDeleted > 0) {
        console.log(`[Cron] Cleaned up ${blacklistDeleted} expired blacklist/warning entries.`);
        // We log this action directly to the DB without HTTP request context
        await AuditLog.create({
          action: "blacklist_bulk_cleanup",
          performedBy: "000000000000000000000000", // System ID
          performedByName: "System Cron",
          performedByRole: "system",
          details: `تنظيف آلي: إزالة ${blacklistDeleted} سجل منتهي الصلاحية من القائمة السوداء/الإنذارات`,
          metadata: { count: blacklistDeleted, trigger: "cron" },
          ipAddress: "127.0.0.1",
        });
      }

      // 2. Clean up old Audit Logs (older than 60 days or exceeding limit)
      const auditLogsDeleted = await AuditLog.cleanupOldLogs();
      if (auditLogsDeleted > 0) {
        console.log(`[Cron] Cleaned up ${auditLogsDeleted} old audit logs.`);
      }

      console.log("[Cron] Daily cleanup tasks completed successfully.");
    } catch (error) {
      console.error("[Cron] Error during daily cleanup tasks:", error);
    }
  });

  console.log("[Cron] Scheduled daily cleanup jobs (3:00 AM).");
};
