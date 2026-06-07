import mongoose from "mongoose";

// PERF: Cache connection across serverless invocations
// Using global to persist across hot reloads in development
declare global {
  // eslint-disable-next-line no-var
  var mongooseCache: {
    conn: typeof mongoose | null;
    promise: Promise<typeof mongoose> | null;
  };
}

if (!global.mongooseCache) {
  global.mongooseCache = { conn: null, promise: null };
}

export async function connectDB(): Promise<typeof mongoose> {
  const MONGODB_URI = process.env.MONGODB_URI!;
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI environment variable is not defined");
  }

  // If already connected, return immediately
  if (global.mongooseCache.conn) {
    return global.mongooseCache.conn;
  }

  // If connection is in progress, wait for it
  if (!global.mongooseCache.promise) {
    const opts = {
      bufferCommands: false,       // fail fast instead of buffering
      maxPoolSize: 5,              // M0 limit is 500 but keep low for serverless
      minPoolSize: 1,
      serverSelectionTimeoutMS: 10000,  // fail after 10s not 30s
      socketTimeoutMS: 20000,
      connectTimeoutMS: 10000,
      // Keep alive to prevent connection drops
      heartbeatFrequencyMS: 10000,
    };

    global.mongooseCache.promise = mongoose
      .connect(MONGODB_URI, opts)
      .then((mongoose) => {
        console.log(`[DB] Connected to MongoDB: ${mongoose.connection.name}`);
        return mongoose;
      })
      .catch((err) => {
        global.mongooseCache.promise = null; // reset on failure
        throw err;
      });
  }

  global.mongooseCache.conn = await global.mongooseCache.promise;
  return global.mongooseCache.conn;
}
