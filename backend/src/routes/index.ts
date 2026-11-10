import { Router } from 'express';
import propertiesRoutes from '../modules/properties/properties.routes.ts';

const router = Router();

router.get('/', (_req, res) => {
  res.json({ message: 'BE API v1' });
});

router.use('/properties', propertiesRoutes);

export default router;
