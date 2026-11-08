import express from 'express';
import type { Request, Response, NextFunction } from 'express';

const app = express();

// Middleware to parse incoming JSON payloads
app.use(express.json());

app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'Hello from MDM' });
});

// Centralized Error Handling Middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

export default app;
