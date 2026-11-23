import { createClient } from 'redis';

export type RedisClientType = ReturnType<typeof createClient>;

const redisClient: RedisClientType = createClient({
  url: process.env.REDIS_URL,
  password: process.env.REDIS_PASSWORD,
});

redisClient.on('error', (err) => console.error('[redis] Client error', err));

export const connectRedis = async (): Promise<void> => {
  if (!redisClient.isOpen) {
    try {
      await redisClient.connect();
      console.log('[redis] Connected successfully');
    } catch (err) {
      console.error('[redis] Failed to connect:', err);
      throw err;
    }
  }
};

export const getRedis = async (key: string): Promise<string | null> => {
  return await redisClient.get(key);
};

export const setRedis = async (key: string, value: any): Promise<void> => {
  await redisClient.set(key, value);
};

export const getOrSetDefault = async (
  key: string,
  fallbackFactory: () => any,
): Promise<any> => {
  const cachedValue = await redisClient.get(key);

  if (cachedValue !== null) return cachedValue;

  const defaultValue = await fallbackFactory();
  await redisClient.set(key, defaultValue);

  return defaultValue;
};

export default redisClient;
