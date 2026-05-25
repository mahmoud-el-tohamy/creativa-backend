import mongoose, { Schema, Document, Types, Model } from "mongoose";

export interface ITrack extends Document {
  _id: Types.ObjectId;
  name: string;
  createdAt: Date;
}

const trackSchema = new Schema<ITrack>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    createdAt: { type: Date, default: Date.now },
  },
  {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

export const Track = mongoose.model<ITrack>("Track", trackSchema);
