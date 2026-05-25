import mongoose from "mongoose";

export const connectDB = async (): Promise<void> => {
  try {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      throw new Error("MONGODB_URI environment variable is not defined");
    }

    const conn = await mongoose.connect(uri);
    console.log(`MongoDB Connected: ${conn.connection.name}`);
  } catch (error: any) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    // In serverless environments, throwing/logging is better than exiting
    // Mongoose connection logic will naturally retry or fail on operations
    throw error;
  }
};
