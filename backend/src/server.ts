import 'dotenv/config';
import app from './app.ts';
import { connectRedis } from './config/redis.ts';

const PORT = process.env.PORT || 3000;

async function main() {
  await connectRedis();
  app.listen(PORT, () => {
    console.log(`[server] Server is running at http://localhost:${PORT}`);
  });
}

main();
