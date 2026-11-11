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

export const getRedis = async (key: string) => {
  return await redisClient.get(key);
};

export const setRedis = async (key: string, value: any): Promise<void> => {
  await redisClient.set(key, value);
};

export const getOrSetDefault = async (
  key: string,
  fallbackFactory: () => any,
) => {
  const cachedValue = await redisClient.get(key);

  if (cachedValue !== null) return cachedValue;

  const defaultValue = await fallbackFactory();
  await redisClient.set(key, defaultValue);

  return defaultValue;
};

export default redisClient;
