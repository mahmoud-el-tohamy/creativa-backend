import mongoose from "mongoose";
import dotenv from "dotenv";
import { User } from "../models/User";

dotenv.config();

const seed = async () => {
  await mongoose.connect(process.env.MONGODB_URI as string);
  
  const adminExists = await User.findOne({ email: "admin@creativa.com" });
  if (adminExists) {
    console.log("Admin user already exists!");
  } else {
    await User.create({
      displayName: "Admin",
      email: "admin@creativa.com",
      password: "password123",
      role: "admin",
      isActive: true,
    });
    console.log("Admin user created: admin@creativa.com / password123");
  }
  
  process.exit(0);
};

seed();
