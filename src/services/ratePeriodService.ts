import { Types } from "mongoose";
import { IRatePeriod, IInstructor } from "../models/Instructor";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RatePeriodOverlapCheck {
  hasOverlap: boolean;
  conflictingPeriod?: {
    id: string;
    startDate: Date;
    endDate: Date | null;
  };
}

// ─── Overlap Detection ────────────────────────────────────────────────────────

/**
 * Checks whether a proposed new date range conflicts with any existing
 * rate period on the same instructor.
 *
 * Two ranges [startA, endA] and [startB, endB] overlap when:
 *   startA <= (endB ?? +∞) AND startB <= (endA ?? +∞)
 *
 * @param existingPeriods  The instructor's current ratePeriods array
 * @param newStartDate     Start date of the proposed period (inclusive)
 * @param newEndDate       End date of the proposed period (inclusive); null = open-ended
 * @param excludePeriodId  When editing an existing period, exclude it by _id
 */
export function checkRatePeriodOverlap(
  existingPeriods: IRatePeriod[],
  newStartDate: Date,
  newEndDate: Date | null,
  excludePeriodId?: string
): RatePeriodOverlapCheck {
  const newStart = newStartDate.getTime();
  // null endDate → open-ended, treat as +Infinity
  const newEnd = newEndDate ? newEndDate.getTime() : Infinity;

  for (const period of existingPeriods) {
    // Skip the period being edited
    if (excludePeriodId && period._id.toString() === excludePeriodId) {
      continue;
    }

    const existStart = period.startDate.getTime();
    const existEnd = period.endDate ? period.endDate.getTime() : Infinity;

    // Overlap condition: both ranges touch each other
    if (newStart <= existEnd && existStart <= newEnd) {
      return {
        hasOverlap: true,
        conflictingPeriod: {
          id: period._id.toString(),
          startDate: period.startDate,
          endDate: period.endDate,
        },
      };
    }
  }

  return { hasOverlap: false };
}

// ─── Rate Period Lookup ───────────────────────────────────────────────────────

/**
 * Finds the rate period that was active on a given session date.
 * Returns null if no period covers the date (caller must fall back
 * to the deprecated flat fields).
 *
 * If multiple periods match (data integrity issue), returns the one with
 * the latest startDate and emits a console.warn.
 *
 * @param ratePeriods  The instructor's ratePeriods array
 * @param sessionDate  The date of the training session
 */
export function findApplicableRatePeriod(
  ratePeriods: IRatePeriod[],
  sessionDate: Date
): IRatePeriod | null {
  const ts = sessionDate.getTime();

  const matches = ratePeriods.filter((p) => {
    const start = p.startDate.getTime();
    const end = p.endDate ? p.endDate.getTime() : Infinity;
    return start <= ts && ts <= end;
  });

  if (matches.length === 0) {
    return null;
  }

  if (matches.length > 1) {
    console.warn(
      `[ratePeriodService] Data integrity issue: ${matches.length} overlapping rate periods found ` +
        `for sessionDate ${sessionDate.toISOString()}. Using the one with the latest startDate. ` +
        `Period IDs: ${matches.map((p) => p._id.toString()).join(", ")}`
    );
    // Sort descending by startDate, take the first
    matches.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
  }

  return matches[0];
}

// ─── Add Rate Period ──────────────────────────────────────────────────────────

/**
 * Mutates `instructor.ratePeriods` in-memory to add a new rate period.
 *
 * @important **CALLER MUST `await instructor.save()` IMMEDIATELY AFTER THIS CALL.**
 * This function only modifies the in-memory Mongoose document. If you forget
 * to call save(), the change will be silently lost with NO error thrown.
 * Example:
 * ```ts
 * const result = addRatePeriod(instructor, newPeriod);
 * if (!result.success) return res.status(400).json({ ... });
 * await instructor.save(); // ← required, do not omit
 * ```
 *
 * If the new period has endDate === null (becoming the new "current" period):
 *   - The existing current period (isCurrent: true) has its endDate set to
 *     the day before newPeriod.startDate and isCurrent set to false.
 *
 * Returns { success: false, error } if an overlap is detected.
 */
export function addRatePeriod(
  instructor: IInstructor,
  newPeriod: {
    startDate: Date;
    endDate: Date | null;
    dailyTrainingRate: number;
    dailyConsultationRate: number;
    createdBy: string;
    createdByName: string;
    note?: string;
  }
): { success: boolean; error?: string } {
  // 1. Overlap check
  const overlapResult = checkRatePeriodOverlap(
    instructor.ratePeriods.toObject ? instructor.ratePeriods.toObject() : Array.from(instructor.ratePeriods),
    newPeriod.startDate,
    newPeriod.endDate
  );

  if (overlapResult.hasOverlap && overlapResult.conflictingPeriod) {
    const { startDate, endDate } = overlapResult.conflictingPeriod;
    const startStr = startDate.toLocaleDateString("ar-EG");
    const endStr = endDate ? endDate.toLocaleDateString("ar-EG") : "مفتوح";
    return {
      success: false,
      error: `يوجد تعارض في التواريخ مع فترة تسعير موجودة (${startStr} — ${endStr})`,
    };
  }

  // 2. If the new period is open-ended (isCurrent), close the existing current period
  if (newPeriod.endDate === null) {
    const existingCurrent = instructor.ratePeriods.find((p) => p.isCurrent);
    if (existingCurrent) {
      // Close previous current period: endDate = one day before new period's startDate
      const dayBefore = new Date(newPeriod.startDate);
      dayBefore.setDate(dayBefore.getDate() - 1);
      // Set to end of that day for clean inclusion
      dayBefore.setHours(23, 59, 59, 999);
      existingCurrent.endDate = dayBefore;
      existingCurrent.isCurrent = false;
    }
  }

  // 3. Push the new period
  const isCurrentPeriod = newPeriod.endDate === null;
  instructor.ratePeriods.push({
    _id: new Types.ObjectId(),
    startDate: newPeriod.startDate,
    endDate: newPeriod.endDate,
    isCurrent: isCurrentPeriod,
    dailyTrainingRate: newPeriod.dailyTrainingRate,
    dailyConsultationRate: newPeriod.dailyConsultationRate,
    createdBy: new Types.ObjectId(newPeriod.createdBy),
    createdByName: newPeriod.createdByName,
    note: newPeriod.note ?? "",
    createdAt: new Date(),
  } as IRatePeriod);

  return { success: true };
}

// ─── Update Rate Period ───────────────────────────────────────────────────────

/**
 * Mutates `instructor.ratePeriods` in-memory to update an existing period.
 *
 * @important **CALLER MUST `await instructor.save()` IMMEDIATELY AFTER THIS CALL.**
 * This function only modifies the in-memory Mongoose document. If you forget
 * to call save(), the change will be silently lost with NO error thrown.
 * Example:
 * ```ts
 * const result = updateRatePeriod(instructor, periodId, updates);
 * if (!result.success) return res.status(400).json({ ... });
 * await instructor.save(); // ← required, do not omit
 * ```
 *
 * Handles cascading isCurrent logic when endDate changes from/to null.
 * Returns { success: false, error } if an overlap is detected.
 */
export function updateRatePeriod(
  instructor: IInstructor,
  periodId: string,
  updates: Partial<{
    startDate: Date;
    endDate: Date | null;
    dailyTrainingRate: number;
    dailyConsultationRate: number;
    note: string;
  }>
): { success: boolean; error?: string } {
  // Locate the target period
  const target = instructor.ratePeriods.find(
    (p) => p._id.toString() === periodId
  );

  if (!target) {
    return { success: false, error: "فترة التسعير المحددة غير موجودة" };
  }

  // Determine the effective startDate / endDate after update for overlap check
  const effectiveStart = updates.startDate ?? target.startDate;
  const effectiveEnd =
    updates.endDate !== undefined ? updates.endDate : target.endDate;

  // Overlap check only if dates are changing
  const datesChanging =
    updates.startDate !== undefined || updates.endDate !== undefined;

  if (datesChanging) {
    const overlapResult = checkRatePeriodOverlap(
      instructor.ratePeriods.toObject ? instructor.ratePeriods.toObject() : Array.from(instructor.ratePeriods),
      effectiveStart,
      effectiveEnd,
      periodId // exclude itself
    );

    if (overlapResult.hasOverlap && overlapResult.conflictingPeriod) {
      const { startDate, endDate } = overlapResult.conflictingPeriod;
      const startStr = startDate.toLocaleDateString("ar-EG");
      const endStr = endDate ? endDate.toLocaleDateString("ar-EG") : "مفتوح";
      return {
        success: false,
        error: `يوجد تعارض في التواريخ مع فترة تسعير موجودة (${startStr} — ${endStr})`,
      };
    }

    // Handle isCurrent cascading logic
    const wasOpenEnded = target.endDate === null;
    const willBeOpenEnded = effectiveEnd === null;

    if (!wasOpenEnded && willBeOpenEnded) {
      // Reopening as current: close whatever other period currently has isCurrent: true
      const otherCurrent = instructor.ratePeriods.find(
        (p) => p.isCurrent && p._id.toString() !== periodId
      );
      if (otherCurrent) {
        const dayBefore = new Date(effectiveStart);
        dayBefore.setDate(dayBefore.getDate() - 1);
        dayBefore.setHours(23, 59, 59, 999);
        otherCurrent.endDate = dayBefore;
        otherCurrent.isCurrent = false;
      }
      target.isCurrent = true;
    } else if (wasOpenEnded && !willBeOpenEnded) {
      // Closing a previously-open period
      target.isCurrent = false;
    }
  }

  // Apply all updates
  if (updates.startDate !== undefined) target.startDate = updates.startDate;
  if (updates.endDate !== undefined) target.endDate = updates.endDate;
  if (updates.dailyTrainingRate !== undefined)
    target.dailyTrainingRate = updates.dailyTrainingRate;
  if (updates.dailyConsultationRate !== undefined)
    target.dailyConsultationRate = updates.dailyConsultationRate;
  if (updates.note !== undefined) target.note = updates.note;

  return { success: true };
}
