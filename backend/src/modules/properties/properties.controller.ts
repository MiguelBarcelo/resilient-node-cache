import type { Request, Response, NextFunction } from 'express';
import * as propertiesService from './properties.service.ts';

export const listProperties = async (
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const data = await propertiesService.fetchProperties();
    res.json(data);
  } catch (error: any) {
    next(error);
  }
};
