import mongoose, { Schema, Document, Types, Model } from "mongoose";
import bcrypt from "bcryptjs";

export interface IUser extends Document {
  _id: Types.ObjectId;
  displayName: string;
  email: string;
  password?: string;
  role: "admin" | "employee" | "viewer";
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: Types.ObjectId | null;
  lastLoginAt: Date | null;
  refreshTokens: string[];
  comparePassword(candidate: string): Promise<boolean>;
}

interface IUserModel extends Model<IUser> {
  findByEmail(email: string): Promise<IUser | null>;
}

const userSchema = new Schema<IUser, IUserModel>(
  {
    displayName: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 8, select: false },
    role: { type: String, enum: ["admin", "employee", "viewer"], required: true },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    lastLoginAt: { type: Date, default: null },
    refreshTokens: { type: [String], default: [] },
  },
  { timestamps: true }
);

// userSchema.index({ email: 1 }, { unique: true }); // Already defined as unique: true in schema
// PERF: explicit index for missing username field in user instructions, actually it's displayName here.
userSchema.index({ displayName: 1 }, { sparse: true });
userSchema.index({ role: 1, isActive: 1 });

userSchema.pre("save", async function () {
  if (!this.isModified("password") || !this.password) return;

  const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || "12", 10);
  const salt = await bcrypt.genSalt(saltRounds);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.comparePassword = async function (candidate: string): Promise<boolean> {
  if (!this.password) return false;
  return bcrypt.compare(candidate, this.password);
};

userSchema.statics.findByEmail = function (email: string) {
  return this.findOne({ email });
};

export const User = mongoose.model<IUser, IUserModel>("User", userSchema);
