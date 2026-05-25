import mongoose from "mongoose";
import dotenv from "dotenv";
import { User } from "../models/User";

dotenv.config();

const seed = async () => {
  await mongoose.connect(process.env.MONGODB_URI as string);
  
  const adminEmail = process.env.ADMIN_EMAIL || "admin@creativa.com";
  const adminPassword = process.env.ADMIN_PASSWORD || "password123";

  const adminExists = await User.findOne({ email: adminEmail });
  if (adminExists) {
    console.log(`Admin user ${adminEmail} already exists!`);
  } else {
    await User.create({
      displayName: "Admin",
      email: adminEmail,
      password: adminPassword,
      role: "admin",
      isActive: true,
    });
    console.log(`Admin user created: ${adminEmail} / ${adminPassword}`);
  }
  
  process.exit(0);
};

seed();
