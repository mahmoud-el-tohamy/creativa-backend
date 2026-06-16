import { Request, Response } from "express";
import { TrainingSession } from "../models/TrainingSession";

export const getInstructorFinancials = async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, instructorName, period, sessionType, programName, page: rawPage, limit: rawLimit } = req.query;

    const page = parseInt(rawPage as string) || 1;
    const limit = parseInt(rawLimit as string) || 20;
    const skip = (page - 1) * limit;

    const query: any = {};

    // 1. Date filter (based on period or custom startDate/endDate)
    let finalStartDate: Date | null = null;
    let finalEndDate: Date | null = null;

    if (period && period !== "all") {
      const now = new Date();
      finalEndDate = new Date(now);
      finalEndDate.setHours(23, 59, 59, 999);

      if (period === "month") {
        // Current month
        finalStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
        finalEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      } else if (period === "3months") {
        // Last 3 months
        finalStartDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      } else if (period === "6months") {
        // Last 6 months
        finalStartDate = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      } else if (period === "year") {
        // Last year
        finalStartDate = new Date(now.getFullYear(), now.getMonth() - 11, 1);
      }
    } else {
      // Use custom start/end dates if period is "all" or not provided
      if (startDate) {
        finalStartDate = new Date(startDate as string);
      }
      if (endDate) {
        finalEndDate = new Date(endDate as string);
        finalEndDate.setHours(23, 59, 59, 999);
      }
    }

    if (finalStartDate || finalEndDate) {
      query.date = {};
      if (finalStartDate) query.date.$gte = finalStartDate;
      if (finalEndDate) query.date.$lte = finalEndDate;
    }

    // 2. Instructor name filter
    if (instructorName) {
      query.instructorName = { $regex: instructorName, $options: "i" };
    }

    // 3. Session type filter
    if (sessionType && sessionType !== "all") {
      query.type = sessionType;
    }

    // 4. Program name (Session Program/Track) filter
    if (programName && programName !== "all") {
      query.programName = programName;
    }

    // Populate instructor to get daily rates and cvLink
    const sessions = await TrainingSession.find(query)
      .populate("instructorId", "dailyTrainingRate dailyConsultationRate cvLink")
      .sort({ date: 1 })
      .lean();

    const allData = sessions.map((session: any) => {
      const instructor = session.instructorId || {};
      const isConsultation = session.type === "Consultation" || session.type === "Consultation & Mentorship";
      const dailyRate = isConsultation
        ? (instructor.dailyConsultationRate || 0)
        : (instructor.dailyTrainingRate || 0);

      const totalCost = session.dayValue * dailyRate;

      return {
        _id: session._id,
        sessionDate: session.date,
        daysCount: session.dayValue,
        sessionType: session.type,
        sessionName: session.sessionName,
        program: session.programName,
        attendance: session.attendeesCount,
        instructorName: session.instructorName || "بدون مدرب",
        dailyRate: dailyRate,
        totalCost: totalCost,
        cvLink: instructor.cvLink || "",
        reportLink: session.trainingReportUrl || session.evaluationReportUrl || "",
      };
    });

    const totalCostSum = allData.reduce((sum, item) => sum + item.totalCost, 0);

    const total = allData.length;
    const totalPages = Math.ceil(total / limit);
    const paginatedData = allData.slice(skip, skip + limit);

    res.status(200).json({
      success: true,
      data: paginatedData,
      totalCostSum,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      }
    });
  } catch (error) {
    console.error("Error in getInstructorFinancials:", error);
    res.status(500).json({ success: false, message: "حدث خطأ في الخادم" });
  }
};
