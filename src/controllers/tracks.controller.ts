import { Request, Response } from "express";
import { Track } from "../models/Track";
import { AuditLog } from "../models/AuditLog";

export const getTracks = async (req: Request, res: Response) => {
  try {
    // PERF: lean() for read-only query
    const tracks = await Track.find().sort({ createdAt: -1 }).lean();
    res.json(tracks);
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
};

export const addTrack = async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: "Track name is required" });

    const existing = await Track.findOne({ name });
    if (existing) return res.status(400).json({ message: "Track already exists" });

    const track = await Track.create({ name });
    
    // Log action
    await AuditLog.create({
      action: "track_add",
      performedBy: req.user?.id,
      performedByName: req.user?.displayName,
      performedByRole: req.user?.role,
      targetName: "System",
      details: `Added new track: ${name}`,
      ipAddress: req.ip || req.socket.remoteAddress || "unknown",
    });

    res.status(201).json(track);
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
};

export const removeTrack = async (req: Request, res: Response) => {
  try {
    const track = await Track.findById(req.params.id);
    if (!track) return res.status(404).json({ message: "Track not found" });

    await track.deleteOne();

    // Log action
    await AuditLog.create({
      action: "track_remove",
      performedBy: req.user?.id,
      performedByName: req.user?.displayName,
      performedByRole: req.user?.role,
      targetName: "System",
      details: `Removed track: ${track.name}`,
      ipAddress: req.ip || req.socket.remoteAddress || "unknown",
    });

    res.json({ message: "Track removed successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
};
