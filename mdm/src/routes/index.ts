import { Router } from 'express';
import type { Request, Response } from 'express';
import propertiesRoutes from '../modules/properties/properties.routes.ts';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({ message: 'MDM API v1' });
});

router.use('/properties', propertiesRoutes);

export default router;
