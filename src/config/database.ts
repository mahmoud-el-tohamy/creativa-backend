import mongoose from "mongoose";

// Global cache for serverless environment
let cached = (global as any).mongoose;

if (!cached) {
  cached = (global as any).mongoose = { conn: null, promise: null };
}

export const connectDB = async (): Promise<void> => {
  if (cached.conn) {
    // console.log("Using cached MongoDB connection");
    return;
  }

  if (!cached.promise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error("MONGODB_URI environment variable is not defined");
    }

    cached.promise = mongoose.connect(uri).then((mongoose) => {
      return mongoose;
    });
  }

  try {
    cached.conn = await cached.promise;
    console.log(`MongoDB Connected: ${cached.conn.connection.name}`);
  } catch (error: any) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    cached.promise = null;
    throw error;
  }
};
