import { createClient } from 'redis';

const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient.on('error', (err) => console.error('[redis] Client error', err));

(async () => {
  try {
    await redisClient.connect();
    console.log('[redis] Connected successfully');
  } catch (err) {
    console.error('[redis] Failed to connect initially:', err);
  }
})();

export default redisClient;
