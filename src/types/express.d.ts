import { Types } from "mongoose";

declare global {
  namespace Express {
    export interface Request {
      user?: {
        id: string | Types.ObjectId;
        role: "admin" | "employee" | "viewer" | string;
        displayName: string;
      };
    }
  }
}
