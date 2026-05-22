import { Request, Response, NextFunction } from "express";
import Joi from "joi";

export const validate = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    
    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message, // Assuming Arabic Joi messages are handled at schema definition
      }));

      res.status(400).json({ success: false, message: "بيانات غير صالحة", errors });
      return;
    }
    
    next();
  };
};
