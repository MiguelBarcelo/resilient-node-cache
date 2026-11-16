import redisClient from '../../config/redis.ts';
import MdmClient from './mdm.client.ts';
import { setRedis, getOrSetDefault } from '../../config/redis.ts';
import { PropertyDto } from './mdm.types.ts';

export const CB_NEXT_RETRY_TIMESTAMP_KEY = 'mdm:cb:next_retry_timestamp';
export const CB_STATUS_KEY = 'mdm:cb:status';
export const CB_FAIL_COUNTER_KEY = 'mdm:cb:fail_counter';
export const CB_RETRY_COUNTER_KEY = 'mdm:cb:retry_counter';
export const MDM_PROPERTIES_KEY = 'mdm:properties';
export const MINUTE = 60_000; // 60 secs (1 minute)
const MAX_RETRIES = 5;
export const CbStatus = {
  Open: 'OPEN',
  HalfOpen: 'HALF_OPEN',
  Closed: 'CLOSED',
} as const;
const getExpiresAt = (minutes: number) => Date.now() + minutes * MINUTE;
const backoffExp = (retry: number) => {
  const SECOND = 1_000;
  const base = SECOND;
  const maxDelay = 32 * SECOND;

  return Math.min(base * Math.pow(2, retry), maxDelay);
};

export const fetchProperties = async (): Promise<{
  data: PropertyDto[];
  expiresAt: number;
}> => {
  // Set Redis keys
  const CB_STATUS = await getOrSetDefault(CB_STATUS_KEY, () => CbStatus.Closed);
  const CB_NEXT_RETY_TIMESTAMP = await getOrSetDefault(
    CB_NEXT_RETRY_TIMESTAMP_KEY,
    () => Date.now() + 5 * MINUTE,
  );
  const MDM_PROPERTIES = await getOrSetDefault(MDM_PROPERTIES_KEY, () => {
    return JSON.stringify({ data: [], expiresAt: Date.now() });
  });

  // State Machine
  if (CB_STATUS === CbStatus.Open) {
    if (+CB_NEXT_RETY_TIMESTAMP <= Date.now()) {
      await setRedis(CB_STATUS_KEY, CbStatus.HalfOpen);

      console.info(
        `[PropertiesService] [CB:HALF_OPEN] Testing MDM recovery with a probe request...`,
      );

      try {
        const data = await MdmClient.fetchProperties();
        const expiresAt = getExpiresAt(5);

        await setRedis(CB_STATUS_KEY, CbStatus.Closed);
        await setRedis(CB_FAIL_COUNTER_KEY, 0);
        await setRedis(CB_RETRY_COUNTER_KEY, 0);
        await setRedis(MDM_PROPERTIES_KEY, JSON.stringify({ data, expiresAt }));

        console.info(
          `[PropertiesService] [CB:RECOVERED] MDM probe succeeded. Circuit Breaker closed and counters reset.`,
        );

        return { data, expiresAt };
      } catch (error: any) {
        const CB_RETRY_COUNTER = await redisClient.incr(CB_RETRY_COUNTER_KEY);
        await setRedis(CB_STATUS_KEY, CbStatus.Open);
        await setRedis(
          CB_NEXT_RETRY_TIMESTAMP_KEY,
          Date.now() + backoffExp(CB_RETRY_COUNTER),
        );

        console.warn(
          `[PropertiesService] [CB:OPEN] MDM is currently unreachable. Serving stale cache data.`,
        );
      }
    }

    const { data, expiresAt } = JSON.parse(MDM_PROPERTIES);
    return { data, expiresAt };
  }

  if (CB_STATUS === CbStatus.HalfOpen) {
    const { data, expiresAt } = JSON.parse(MDM_PROPERTIES);
    return { data, expiresAt };
  }

  if (CB_STATUS === CbStatus.Closed) {
    const { data, expiresAt } = JSON.parse(MDM_PROPERTIES);

    if (data.length === 0 || expiresAt <= Date.now()) {
      try {
        const data = await MdmClient.fetchProperties();

        const expiresAt = getExpiresAt(5);
        await setRedis(MDM_PROPERTIES_KEY, JSON.stringify({ data, expiresAt }));

        return { data, expiresAt };
      } catch (error: any) {
        // Increment atomically
        const CB_FAIL_COUNTER = await redisClient.incr(CB_FAIL_COUNTER_KEY);

        console.error(
          `[PropertiesService] [CB:CLOSED] Failed to fetch properties (Attempt ${CB_FAIL_COUNTER}/${MAX_RETRIES}). Error: ${error.message}`,
        );

        if (CB_FAIL_COUNTER >= MAX_RETRIES) {
          await setRedis(CB_STATUS_KEY, CbStatus.Open);
          await setRedis(
            CB_NEXT_RETRY_TIMESTAMP_KEY,
            Date.now() + backoffExp(0),
          );

          console.warn(
            `[PropertiesService] [CB:TRIPPED] Circuit Breaker opened due to consecutive failures. Next retry scheduled in ${backoffExp(0)}ms.`,
          );
        }
      }
    }

    return { data, expiresAt };
  }

  return { data: [], expiresAt: Date.now() };
};
