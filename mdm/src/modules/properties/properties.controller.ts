import type { Request, Response, NextFunction } from 'express';
import * as propertiesService from './properties.service.ts';

export const listProperties = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const properties = await propertiesService.listProperties();
    res.json({ data: properties });
  } catch (error) {
    next(error);
  }
};
