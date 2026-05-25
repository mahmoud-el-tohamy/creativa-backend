import mongoose, { Schema, Document, Types } from "mongoose";

export interface IAuditLog extends Document {
  _id: Types.ObjectId;
  action: 
    | "blacklist_add" 
    | "blacklist_remove" 
    | "blacklist_bulk_add" 
    | "blacklist_bulk_cleanup"
    | "user_create" 
    | "user_deactivate"
    | "user_activate"
    | "user_delete"
    | "user_role_change" 
    | "attendance_upload" 
    | "filter_run" 
    | "certificate_generate" 
    | "sheet_organize" 
    | "login" 
    | "logout"
    | "track_add"
    | "track_remove";
  performedBy: Types.ObjectId;
  performedByName: string;
  performedByRole: string;
  targetId: string;
  targetName: string;
  details: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
  ipAddress: string;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    action: { type: String, required: true },
    performedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    performedByName: { type: String, required: true },
    performedByRole: { type: String, required: true },
    targetId: { type: String, default: "" },
    targetName: { type: String, default: "" },
    details: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    timestamp: { type: Date, default: Date.now },
    ipAddress: { type: String, required: true },
  }
);

auditLogSchema.index({ timestamp: -1 }, { expireAfterSeconds: 5184000 }); // Expire after ~2 months (60 days)
auditLogSchema.index({ performedBy: 1 });
auditLogSchema.index({ action: 1 });

auditLogSchema.pre("save", async function() {
  const Model = this.constructor as mongoose.Model<IAuditLog>;
  const count = await Model.countDocuments();
  if (count >= 10000) {
    // Find oldest document(s) and delete to keep count at 9999 (plus this new 1)
    const logsToDelete = await Model.find().sort({ timestamp: 1 }).limit(count - 9999).select("_id");
    const idsToDelete = logsToDelete.map(log => log._id);
    if (idsToDelete.length > 0) {
      await Model.deleteMany({ _id: { $in: idsToDelete } });
    }
  }
});

export const AuditLog = mongoose.model<IAuditLog>("AuditLog", auditLogSchema);
