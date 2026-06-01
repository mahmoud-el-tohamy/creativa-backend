import { Request, Response, NextFunction } from "express";
import { DailyStat } from "../models/DailyStat";

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

export const getChartStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { range = "monthly" } = req.query;
    
    // First, let's determine the time boundary for baseCumulative and fetch all records
    const allStats = await DailyStat.find({}).sort({ date: 1 });
    
    const now = new Date();
    const buckets: { label: string; fullLabel?: string; key: string; date: Date }[] = [];

    if (range === "daily") {
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        const label = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
        const fullLabel = `اليوم: ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
        buckets.push({ label, fullLabel, key, date: d });
      }
    } else if (range === "weekly") {
      for (let i = 7; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (i * 7));
        const weekNum = getWeekNumber(d);
        const { monday, sunday } = getISOWeekBounds(d);
        const key = `${d.getFullYear()}-W${weekNum}`;
        const label = `أسبوع ${weekNum}`;
        const startStr = `${String(monday.getDate()).padStart(2, '0')}/${String(monday.getMonth() + 1).padStart(2, '0')}/${monday.getFullYear()}`;
        const endStr = `${String(sunday.getDate()).padStart(2, '0')}/${String(sunday.getMonth() + 1).padStart(2, '0')}/${sunday.getFullYear()}`;
        const fullLabel = `الأسبوع ${weekNum} من ${startStr} إلى ${endStr}`;
        buckets.push({ label, fullLabel, key, date: d });
      }
    } else if (range === "monthly") {
      const monthNames = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        const label = monthNames[d.getMonth()];
        const fullLabel = `شهر ${monthNames[d.getMonth()]} ${d.getFullYear()}`;
        buckets.push({ label, fullLabel, key, date: d });
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
        const key = `${y}-Q${q}`;
        const label = `ر${q + 1} ${y}`;
        const fullLabel = `الربع ${q + 1} عام ${y}`;
        buckets.push({ label, fullLabel, key, date: d });
      }
    } else if (range === "yearly") {
      for (let i = 2; i >= 0; i--) {
        const y = now.getFullYear() - i;
        const d = new Date(y, 0, 1);
        const key = `${y}`;
        const label = `${y}`;
        const fullLabel = `عام ${y}`;
        buckets.push({ label, fullLabel, key, date: d });
      }
    }

    const countsMap = new Map<string, { additions: number; removals: number }>();
    buckets.forEach(b => countsMap.set(b.key, { additions: 0, removals: 0 }));

    const startDate = buckets[0].date;
    startDate.setHours(0, 0, 0, 0); // ensure start date comparison is correct
    
    let baseCumulative = 0;

    allStats.forEach(stat => {
      const d = new Date(stat.date);
      
      if (d < startDate) {
        baseCumulative += stat.additions;
        baseCumulative -= stat.removals;
        return;
      }

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
      } else if (d < startDate) {
        baseCumulative += stat.additions;
        baseCumulative -= stat.removals;
      }
    });

    const chartData = [];
    let cumulative = baseCumulative;
    
    for (const b of buckets) {
      const stats = countsMap.get(b.key) || { additions: 0, removals: 0 };
      cumulative += stats.additions;
      cumulative -= stats.removals;
      
      chartData.push({
        label: b.label,
        fullLabel: b.fullLabel,
        additions: stats.additions,
        cumulative: Math.max(0, cumulative), // Ensure it doesn't go below 0 due to anomalies
        key: b.key,
        rawDate: b.date
      });
    }

    res.status(200).json({ success: true, data: chartData });
  } catch (error) {
    next(error);
  }
};
