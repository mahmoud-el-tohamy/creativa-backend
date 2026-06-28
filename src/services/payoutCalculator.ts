import { IRatePeriod } from "../models/Instructor";
import { findApplicableRatePeriod } from "./ratePeriodService";

// ─── Input / Output Interfaces ────────────────────────────────────────────────

export interface PayoutCalculationInput {
  sessionDate: Date;
  hours: number;
  attendeesCount: number;
  /**
   * Caller determines this however the existing 6 locations already do
   * (some check programName, some check session.type). This function
   * just takes the already-determined boolean.
   */
  isConsultation: boolean;
  /**
   * Existing isPaid:false override — if false, payout is always 0
   * regardless of everything else (preserves existing behavior).
   */
  isPaid?: boolean;
  instructor: {
    ratePeriods: IRatePeriod[];
    /** Deprecated fallback — used when ratePeriods is empty or no period covers this date */
    dailyTrainingRate: number;
    /** Deprecated fallback — used when ratePeriods is empty or no period covers this date */
    dailyConsultationRate: number;
  };
}

export interface PayoutCalculationResult {
  /** Whichever rate (training or consultation) was applicable for this session's date */
  applicableDailyRate: number;
  /** applicableDailyRate / 7, rounded to 2 decimals */
  applicableHourlyRate: number;
  /** hours × applicableHourlyRate BEFORE attendance discount, rounded to 3 decimals */
  rawAmount: number;
  /** 0-100; always 100 for consultation sessions */
  attendancePercentage: number;
  /** rawAmount × (attendancePercentage / 100), rounded to 3 decimals */
  finalAmount: number;
  /** Indicates which pricing path was used — useful for debugging/auditing */
  ratePeriodUsed: "history" | "deprecated_fallback";
}

// ─── Attendance Percentage Helper ─────────────────────────────────────────────

/**
 * Returns the attendance-based payout percentage for Training sessions.
 * Consultation sessions always use 100 — this function is for Training only.
 *
 * Rule:
 *   attendeesCount <= 5  → 0%
 *   attendeesCount == 6  → 60%
 *   attendeesCount == 7  → 70%
 *   attendeesCount == 8  → 80%
 *   attendeesCount == 9  → 90%
 *   attendeesCount >= 10 → 100%
 */
export function getAttendancePercentage(attendeesCount: number): number {
  if (attendeesCount <= 5) return 0;
  if (attendeesCount >= 10) return 100;
  // For 6, 7, 8, 9: percentage = attendeesCount * 10
  return attendeesCount * 10;
}

// ─── Centralized Payout Calculator ───────────────────────────────────────────

/**
 * Single source of truth for all instructor session payout calculations.
 *
 * Implements two business rules:
 *   RULE 1 — Attendance-based payout discount (Training sessions ONLY)
 *   RULE 2 — Historical/time-bound rate lookup via ratePeriods[]
 *
 * Falls back to deprecated flat fields (dailyTrainingRate / dailyConsultationRate)
 * when ratePeriods is empty or no period covers the session's date, so existing
 * instructors remain functional before the migration script is run.
 */
export function calculateSessionPayout(
  input: PayoutCalculationInput
): PayoutCalculationResult {
  // ── Step 1: isPaid === false override ────────────────────────────────────────
  // When a session is marked as unpaid, payout is always 0 regardless of rates.
  if (input.isPaid === false) {
    // We still need to determine which path would have been used for auditing
    const hasHistory =
      input.instructor.ratePeriods.length > 0 &&
      findApplicableRatePeriod(input.instructor.ratePeriods, input.sessionDate) !== null;

    return {
      applicableDailyRate: 0,
      applicableHourlyRate: 0,
      rawAmount: 0,
      attendancePercentage: 0,
      finalAmount: 0,
      ratePeriodUsed: hasHistory ? "history" : "deprecated_fallback",
    };
  }

  // ── Step 2: Find applicable daily rate for this session's date ───────────────
  let applicableDailyRate: number;
  let ratePeriodUsed: "history" | "deprecated_fallback";

  const matchedPeriod = findApplicableRatePeriod(
    input.instructor.ratePeriods,
    input.sessionDate
  );

  if (matchedPeriod !== null) {
    // History path: use the rate that was active on the session's date
    applicableDailyRate = input.isConsultation
      ? matchedPeriod.dailyConsultationRate
      : matchedPeriod.dailyTrainingRate;
    ratePeriodUsed = "history";
  } else if (input.instructor.ratePeriods && input.instructor.ratePeriods.length > 0) {
    // Has rate periods defined, but none cover this session's date (e.g. before the first period).
    // Strictly enforce rate periods: do not fall back, rate is 0.
    applicableDailyRate = 0;
    ratePeriodUsed = "history";
  } else {
    // Fallback path: instructor predates the new system and has no periods defined
    applicableDailyRate = input.isConsultation
      ? input.instructor.dailyConsultationRate
      : input.instructor.dailyTrainingRate;
    ratePeriodUsed = "deprecated_fallback";
  }

  // ── Step 3: Hourly rate (daily / 7) ──────────────────────────────────────────
  const applicableHourlyRate =
    applicableDailyRate > 0
      ? Math.round((applicableDailyRate / 7) * 1000) / 1000
      : 0;

  // ── Step 4: Raw amount before attendance discount (3-decimal precision) ───────
  const rawAmount =
    Math.round(input.hours * applicableHourlyRate * 1000) / 1000;

  // ── Step 5: Attendance percentage ────────────────────────────────────────────
  // Consultation sessions always receive 100% of the calculated amount.
  // Training sessions are subject to the tiered attendance discount.
  const attendancePercentage = input.isConsultation
    ? 100
    : getAttendancePercentage(input.attendeesCount);

  // ── Step 6: Final payable amount (3-decimal precision) ────────────────────────
  const finalAmount =
    Math.round(rawAmount * (attendancePercentage / 100) * 1000) / 1000;

  return {
    applicableDailyRate,
    applicableHourlyRate,
    rawAmount,
    attendancePercentage,
    finalAmount,
    ratePeriodUsed,
  };
}
