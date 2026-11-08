import 'dotenv/config';
import app from './app.ts';
import './config/redis.ts';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`[server] Server is running at http://localhost:${PORT}`);
});
