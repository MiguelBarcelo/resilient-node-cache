import redisClient from '../../config/redis.ts';
import MdmClient from './mdm.client.ts';
import { setRedis, getOrSetDefault } from '../../config/redis.ts';
import { PropertyDto } from './mdm.types.ts';
import logger from '../../utils/logger.ts';

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

      logger.info({
        msg: 'Testing MDM recovery with a probe request',
        service: 'PropertiesService',
        event: 'CB_STATE_CHANGED',
        from: CbStatus.Open,
        to: CbStatus.HalfOpen,
      });

      try {
        const data = await MdmClient.fetchProperties();
        const expiresAt = getExpiresAt(5);

        await setRedis(CB_STATUS_KEY, CbStatus.Closed);
        await setRedis(CB_FAIL_COUNTER_KEY, 0);
        await setRedis(CB_RETRY_COUNTER_KEY, 0);
        await setRedis(MDM_PROPERTIES_KEY, JSON.stringify({ data, expiresAt }));

        logger.info({
          msg: 'MDM probe succeeded. Circuit Breaker closed and counters reset',
          service: 'PropertiesService',
          event: 'CB_STATE_CHANGED',
          from: CbStatus.HalfOpen,
          to: CbStatus.Closed,
        });

        return { data, expiresAt };
      } catch (error: any) {
        const CB_RETRY_COUNTER = await redisClient.incr(CB_RETRY_COUNTER_KEY);
        await setRedis(CB_STATUS_KEY, CbStatus.Open);
        await setRedis(
          CB_NEXT_RETRY_TIMESTAMP_KEY,
          Date.now() + backoffExp(CB_RETRY_COUNTER),
        );

        logger.warn({
          msg: 'MDM is currently unreachable. Serving stale cache data.',
          service: 'PropertiesService',
          event: 'CB_STATE_CHANGED',
          from: CbStatus.HalfOpen,
          to: CbStatus.Open,
        });
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

    if ((Array.isArray(data) && data.length === 0) || expiresAt <= Date.now()) {
      try {
        const data = await MdmClient.fetchProperties();

        const expiresAt = getExpiresAt(5);
        await setRedis(MDM_PROPERTIES_KEY, JSON.stringify({ data, expiresAt }));

        return { data, expiresAt };
      } catch (error: any) {
        if (!(error?.statusCode >= 400 && error?.statusCode < 500)) {
          // Increment atomically
          const CB_FAIL_COUNTER = await redisClient.incr(CB_FAIL_COUNTER_KEY);

          logger.error({
            msg: 'Failed to fetch properties',
            service: 'PropertiesService',
            event: 'CB_CLOSED',
            cbFailCounter: CB_FAIL_COUNTER,
          });

          if (CB_FAIL_COUNTER >= MAX_RETRIES) {
            await setRedis(CB_STATUS_KEY, CbStatus.Open);
            await setRedis(
              CB_NEXT_RETRY_TIMESTAMP_KEY,
              Date.now() + backoffExp(0),
            );

            logger.warn({
              msg: 'Circuit Breaker opened due to consecutive failures',
              service: 'PropertiesService',
              event: 'CB_STATE_CHANGED',
              from: CbStatus.Closed,
              to: CbStatus.Open,
            });
          }
        }
      }
    }

    return { data, expiresAt };
  }

  return { data: [], expiresAt: Date.now() };
};
