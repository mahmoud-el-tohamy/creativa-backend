import { Types } from "mongoose";
import { Instructor, IInstructor } from "../models/Instructor";
import { TrainingSession } from "../models/TrainingSession";
import { calculateSessionPayout } from "./payoutCalculator";

// ─── Date Range ───────────────────────────────────────────────────────────────

export interface DateRangeFilter {
  period: "month" | "3months" | "6months" | "year" | "custom";
  startDate?: string;
  endDate?: string;
}

export function getDateRange(filter: DateRangeFilter): { start: Date; end: Date; label: string } {
  const now = new Date();
  let start: Date;
  let end = new Date(now);
  let label: string;

  switch (filter.period) {
    case "month":
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0); // last day of month
      end.setHours(23, 59, 59, 999);
      label = `${now.toLocaleString("ar-EG", { month: "long" })} ${now.getFullYear()}`;
      break;
    case "3months":
      start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      label = "آخر 3 أشهر";
      break;
    case "6months":
      start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      label = "آخر 6 أشهر";
      break;
    case "year":
      start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      label = "آخر سنة";
      break;
    case "custom":
      start = filter.startDate ? new Date(filter.startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
      if (filter.endDate) {
        end = new Date(filter.endDate);
        end.setHours(23, 59, 59, 999);
      }
      label = `من ${start.toLocaleDateString("ar-EG")} إلى ${end.toLocaleDateString("ar-EG")}`;
      break;
    default:
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      label = "الفترة الحالية";
  }

  return { start, end, label };
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface InstructorSessionRow {
  _id: string;
  sessionName: string;
  programName: string;
  date: Date;
  dateFrom: Date;
  dateTo: Date;
  hours: number;
  dayValue: number;
  attendeesCount: number;
  mode: string;
  type: string;

  // Financial
  unitRate: number;
  sessionAmount: number;
  isConsultation: boolean;
  isPaid: boolean;
}

export interface InstructorDashboardData {
  instructor: IInstructor;

  period: { start: Date; end: Date; label: string };

  totalHours: number;
  totalSessions: number;
  totalDays: number;
  avgAttendeesPerSession: number;
  avgHoursPerSession: number;
  onlineCount: number;
  offlineCount: number;
  onlinePct: number;
  offlinePct: number;

  programBreakdown: {
    program: string;
    hours: number;
    sessions: number;
    totalAmount: number;
  }[];

  typeBreakdown: {
    type: string;
    hours: number;
    sessions: number;
    totalAmount: number;
  }[];

  sessions: InstructorSessionRow[];

  periodTotalAmount: number;
  consultationAmount: number;
  trainingAmount: number;
}

// ─── Dashboard Computation ────────────────────────────────────────────────────

export async function getInstructorDashboard(
  instructorId: string,
  period: DateRangeFilter["period"]
): Promise<InstructorDashboardData> {
  // 1. Fetch instructor with virtuals
  const instructor = await Instructor.findById(instructorId);
  if (!instructor) {
    throw new Error("المدرب غير موجود");
  }

  // 2. Get date range
  const { start, end, label } = getDateRange({ period });

  // 3. Run aggregation pipeline in parallel
  const [rawSessions, aggregates] = await Promise.all([
    TrainingSession.find({
      instructorId: new Types.ObjectId(instructorId),
      date: { $gte: start, $lte: end },
    })
      .sort({ date: -1 })
      .lean(),

    TrainingSession.aggregate([
      {
        $match: {
          instructorId: new Types.ObjectId(instructorId),
          date: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: null,
          totalHours: { $sum: "$hours" },
          totalSessions: { $sum: 1 },
          totalDays: { $sum: "$dayValue" },
          avgAttendees: { $avg: "$attendeesCount" },
          avgHours: { $avg: "$hours" },
          onlineCount: {
            $sum: { $cond: [{ $eq: ["$mode", "online"] }, 1, 0] },
          },
          offlineCount: {
            $sum: { $cond: [{ $eq: ["$mode", "offline"] }, 1, 0] },
          },
        },
      },
    ]),
  ]);

  const agg = aggregates[0] ?? {
    totalHours: 0,
    totalSessions: 0,
    totalDays: 0,
    avgAttendees: 0,
    avgHours: 0,
    onlineCount: 0,
    offlineCount: 0,
  };

  const totalSessions: number = agg.totalSessions;
  const onlinePct =
    totalSessions > 0
      ? Math.round((agg.onlineCount / totalSessions) * 1000) / 10
      : 0;
  const offlinePct =
    totalSessions > 0
      ? Math.round((agg.offlineCount / totalSessions) * 1000) / 10
      : 0;

  // 4. Compute financial data per session
  const sessions: InstructorSessionRow[] = rawSessions.map((s) => {
    const isConsultation = (s.programName as string) === "Consultation & Mentorship" || s.type === "Consultation";

    const payout = calculateSessionPayout({
      sessionDate: new Date(s.date),
      hours: s.hours ?? 0,
      attendeesCount: s.attendeesCount ?? 0,
      isConsultation,
      isPaid: s.isPaid,
      instructor: {
        ratePeriods: instructor.ratePeriods ?? [],
        dailyTrainingRate: instructor.dailyTrainingRate ?? 0,
        dailyConsultationRate: instructor.dailyConsultationRate ?? 0,
      },
    });

    const unitRate = payout.applicableDailyRate / 7;
    const sessionAmount = payout.finalAmount;

    return {
      _id: String(s._id),
      sessionName: s.sessionName,
      programName: s.programName,
      date: s.date,
      dateFrom: s.date,
      dateTo: s.date,
      hours: s.hours,
      dayValue: s.dayValue,
      attendeesCount: s.attendeesCount,
      mode: s.mode,
      type: s.type,
      unitRate,
      sessionAmount,
      attendancePercentage: payout.attendancePercentage,
      isConsultation,
      isPaid: s.isPaid ?? true,
    };
  });

  // 5. Group by program for chart
  const programMap = new Map<
    string,
    { hours: number; sessions: number; totalAmount: number }
  >();
  for (const s of sessions) {
    const existing = programMap.get(s.programName);
    if (existing) {
      existing.hours += s.hours;
      existing.sessions += 1;
      existing.totalAmount += s.sessionAmount;
    } else {
      programMap.set(s.programName, {
        hours: s.hours,
        sessions: 1,
        totalAmount: s.sessionAmount,
      });
    }
  }

  const programBreakdown = Array.from(programMap.entries()).map(
    ([program, data]) => ({
      program,
      hours: Math.round(data.hours * 100) / 100,
      sessions: data.sessions,
      totalAmount: Math.round(data.totalAmount * 1000) / 1000,
    })
  );

  const typeMap = new Map<string, { hours: number; sessions: number; totalAmount: number }>();
  for (const s of sessions) {
    const existing = typeMap.get(s.type);
    if (existing) {
      existing.hours += s.hours;
      existing.sessions += 1;
      existing.totalAmount += s.sessionAmount;
    } else {
      typeMap.set(s.type, {
        hours: s.hours,
        sessions: 1,
        totalAmount: s.sessionAmount,
      });
    }
  }

  const typeBreakdown = Array.from(typeMap.entries()).map(
    ([type, data]) => ({
      type,
      hours: Math.round(data.hours * 100) / 100,
      sessions: data.sessions,
      totalAmount: Math.round(data.totalAmount * 1000) / 1000,
    })
  );

  // 6. Sum totals
  const periodTotalAmount = sessions.reduce((acc, s) => acc + s.sessionAmount, 0);
  const consultationAmount = sessions
    .filter((s) => s.isConsultation)
    .reduce((acc, s) => acc + s.sessionAmount, 0);
  const trainingAmount = sessions
    .filter((s) => !s.isConsultation)
    .reduce((acc, s) => acc + s.sessionAmount, 0);

  return {
    instructor: instructor.toObject({ virtuals: true }) as IInstructor,
    period: { start, end, label },
    totalHours: Math.round((agg.totalHours ?? 0) * 100) / 100,
    totalSessions,
    totalDays: Math.round((agg.totalDays ?? 0) * 100) / 100,
    avgAttendeesPerSession: Math.round((agg.avgAttendees ?? 0) * 10) / 10,
    avgHoursPerSession: Math.round((agg.avgHours ?? 0) * 100) / 100,
    onlineCount: agg.onlineCount,
    offlineCount: agg.offlineCount,
    onlinePct,
    offlinePct,
    programBreakdown,
    typeBreakdown,
    sessions,
    periodTotalAmount: Math.round(periodTotalAmount * 1000) / 1000,
    consultationAmount: Math.round(consultationAmount * 1000) / 1000,
    trainingAmount: Math.round(trainingAmount * 1000) / 1000,
  };
}
