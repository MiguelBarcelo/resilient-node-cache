import { Router } from 'express';
import { listProperties } from './properties.controller.ts';

const router = Router();

router.get('/', listProperties);

export default router;
