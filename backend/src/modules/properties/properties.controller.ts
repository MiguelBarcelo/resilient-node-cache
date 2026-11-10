import type { Request, Response, NextFunction } from 'express';
import * as propertiesService from './properties.service.ts';

export const listProperties = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    throw new Error('[properties] List properties not implemented yet');
  } catch (error: any) {
    next(error);
  }
};
