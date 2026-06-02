import { ipKeyGenerator } from "express-rate-limit";
import express from "express";

const app = express();
app.use((req, res) => {
  const ip = ipKeyGenerator(req, res);
  console.log(ip);
});
