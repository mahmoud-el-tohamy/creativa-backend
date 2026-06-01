import mongoose from "mongoose";
import dotenv from "dotenv";
import { BlacklistEntry } from "../src/models/BlacklistEntry";
import { AuditLog } from "../src/models/AuditLog";
import { DailyStat } from "../src/models/DailyStat";

dotenv.config();

const runMigration = async () => {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGODB_URI as string);
    console.log("Connected to MongoDB.");

    console.log("Clearing existing DailyStats...");
    await DailyStat.deleteMany({});

    const dailyStatsMap = new Map<string, { additions: number, removals: number }>();

    const getStat = (date: Date) => {
      const dateString = date.toISOString().split('T')[0];
      if (!dailyStatsMap.has(dateString)) {
        dailyStatsMap.set(dateString, { additions: 0, removals: 0 });
      }
      return dailyStatsMap.get(dateString)!;
    };

    console.log("Processing AuditLogs for historical events...");
    const auditLogs = await AuditLog.find({ action: { $in: ["blacklist_add", "blacklist_bulk_add", "blacklist_remove", "blacklist_bulk_cleanup"] } });
    
    const addedViaAudit = new Set<string>();

    for (const log of auditLogs) {
      const stat = getStat(log.timestamp);
      
      if (log.action === "blacklist_add") {
        stat.additions++;
        if (log.targetId) addedViaAudit.add(log.targetId);
      } else if (log.action === "blacklist_bulk_add") {
        if (log.metadata && typeof log.metadata.addedCount === 'number') {
          stat.additions += log.metadata.addedCount;
        }
        if (log.metadata && typeof log.metadata.upgradedCount === 'number') {
          stat.additions += log.metadata.upgradedCount;
        }
        if (log.metadata && typeof log.metadata.clearedCount === 'number') {
          stat.removals += log.metadata.clearedCount;
        }
      } else if (log.action === "blacklist_remove") {
        stat.removals++;
      } else if (log.action === "blacklist_bulk_cleanup") {
        if (log.metadata && typeof log.metadata.count === 'number') {
          stat.removals += log.metadata.count;
        }
      }
    }

    console.log("Processing active BlacklistEntries to catch additions older than 60 days...");
    const activeEntries = await BlacklistEntry.find({});
    for (const entry of activeEntries) {
      if (!addedViaAudit.has(entry.nationalId)) {
        const stat = getStat(entry.addedAt);
        stat.additions++;
      }
    }

    console.log("Saving DailyStats...");
    for (const [dateString, stats] of dailyStatsMap.entries()) {
      if (stats.additions > 0 || stats.removals > 0) {
        await DailyStat.create({
          date: dateString,
          additions: stats.additions,
          removals: stats.removals
        });
      }
    }

    console.log("Migration complete!");
  } catch (err) {
    console.error(err);
  } finally {
    mongoose.disconnect();
  }
};

runMigration();
