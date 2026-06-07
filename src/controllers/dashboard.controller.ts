import { Request, Response, NextFunction } from "express";
import { DailyStat } from "../models/DailyStat";
import { BlacklistEntry } from "../models/BlacklistEntry";
import { User } from "../models/User";

function getWeekNumber(d: Date) {
  const dObj = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = dObj.getUTCDay() || 7;
  dObj.setUTCDate(dObj.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dObj.getUTCFullYear(), 0, 1));
  return Math.ceil((((dObj.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getISOWeekBounds(d: Date) {
  const day = d.getDay() || 7;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day + 1);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { monday, sunday };
}

// PERF: Consolidated endpoint that runs all MongoDB queries in parallel using Promise.all()
// Returns the full blacklist and the calculated chart stats in a single round-trip.
export const getChartStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { range = "monthly" } = req.query;
    
    // Run ALL queries IN PARALLEL
    const [allStats, currentActiveTotal, fullBlacklist, totalUsers] = await Promise.all([
      DailyStat.find({}).sort({ date: 1 }).lean(),
      BlacklistEntry.countDocuments({}),
      BlacklistEntry.find({}).sort({ addedAt: -1 }).lean(),
      User.countDocuments({ isActive: true })
    ]);
    
    const now = new Date();
    const buckets: { label: string; fullLabel?: string; key: string; date: Date, endDate: Date }[] = [];

    if (range === "daily") {
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const endDate = new Date(d);
        endDate.setDate(d.getDate() + 1);
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        const label = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
        const fullLabel = `اليوم: ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
        buckets.push({ label, fullLabel, key, date: d, endDate });
      }
    } else if (range === "weekly") {
      for (let i = 7; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (i * 7));
        const weekNum = getWeekNumber(d);
        const { monday, sunday } = getISOWeekBounds(d);
        const endDate = new Date(sunday);
        endDate.setDate(sunday.getDate() + 1);
        const key = `${d.getFullYear()}-W${weekNum}`;
        const label = `أسبوع ${weekNum}`;
        const startStr = `${String(monday.getDate()).padStart(2, '0')}/${String(monday.getMonth() + 1).padStart(2, '0')}/${monday.getFullYear()}`;
        const endStr = `${String(sunday.getDate()).padStart(2, '0')}/${String(sunday.getMonth() + 1).padStart(2, '0')}/${sunday.getFullYear()}`;
        const fullLabel = `الأسبوع ${weekNum} من ${startStr} إلى ${endStr}`;
        buckets.push({ label, fullLabel, key, date: d, endDate });
      }
    } else if (range === "monthly") {
      const monthNames = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const endDate = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        const label = monthNames[d.getMonth()];
        const fullLabel = `شهر ${monthNames[d.getMonth()]} ${d.getFullYear()}`;
        buckets.push({ label, fullLabel, key, date: d, endDate });
      }
    } else if (range === "quarterly") {
      const currentQ = Math.floor(now.getMonth() / 3);
      for (let i = 3; i >= 0; i--) {
        let y = now.getFullYear();
        let q = currentQ - i;
        if (q < 0) {
          y -= 1;
          q += 4;
        }
        const d = new Date(y, q * 3, 1);
        const endDate = new Date(y, (q + 1) * 3, 1);
        const key = `${y}-Q${q}`;
        const label = `ر${q + 1} ${y}`;
        const fullLabel = `الربع ${q + 1} عام ${y}`;
        buckets.push({ label, fullLabel, key, date: d, endDate });
      }
    } else if (range === "yearly") {
      for (let i = 2; i >= 0; i--) {
        const y = now.getFullYear() - i;
        const d = new Date(y, 0, 1);
        const endDate = new Date(y + 1, 0, 1);
        const key = `${y}`;
        const label = `${y}`;
        const fullLabel = `عام ${y}`;
        buckets.push({ label, fullLabel, key, date: d, endDate });
      }
    }

    const countsMap = new Map<string, { additions: number; removals: number }>();
    buckets.forEach(b => countsMap.set(b.key, { additions: 0, removals: 0 }));

    const startDate = buckets[0].date;
    startDate.setHours(0, 0, 0, 0); 
    
    const veryEndDate = buckets[buckets.length - 1].endDate;
    let eventsAfterChart = { additions: 0, removals: 0 };

    allStats.forEach(stat => {
      const d = new Date(stat.date);
      
      if (d >= veryEndDate) {
        eventsAfterChart.additions += stat.additions;
        eventsAfterChart.removals += stat.removals;
        return;
      }

      if (d < startDate) return;

      let key = "";
      if (range === "daily") key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      else if (range === "weekly") key = `${d.getFullYear()}-W${getWeekNumber(d)}`;
      else if (range === "monthly") key = `${d.getFullYear()}-${d.getMonth()}`;
      else if (range === "quarterly") key = `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3)}`;
      else if (range === "yearly") key = `${d.getFullYear()}`;

      if (countsMap.has(key)) {
        const current = countsMap.get(key)!;
        countsMap.set(key, { 
          additions: current.additions + stat.additions, 
          removals: current.removals + stat.removals 
        });
      }
    });

    const chartData = [];
    let currentCumulative = currentActiveTotal - eventsAfterChart.additions + eventsAfterChart.removals;
    
    for (let i = buckets.length - 1; i >= 0; i--) {
      const b = buckets[i];
      const stats = countsMap.get(b.key) || { additions: 0, removals: 0 };
      
      chartData.unshift({
        label: b.label,
        fullLabel: b.fullLabel,
        additions: stats.additions,
        cumulative: Math.max(0, currentCumulative), 
        key: b.key,
        rawDate: b.date
      });
      
      currentCumulative = currentCumulative - stats.additions + stats.removals;
    }

    res.status(200).json({ 
      success: true, 
      data: chartData,
      blacklist: fullBlacklist,
      users: { total: totalUsers }
    });
  } catch (error) {
    next(error);
  }
};
