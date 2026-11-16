import {
  fetchProperties,
  CbStatus,
  MINUTE,
  MDM_PROPERTIES_KEY,
  CB_STATUS_KEY,
  CB_NEXT_RETRY_TIMESTAMP_KEY,
  CB_FAIL_COUNTER_KEY,
  CB_RETRY_COUNTER_KEY,
} from './properties.service.ts';
import redisClient, { setRedis, getOrSetDefault } from '../../config/redis.ts';
import MdmClient from './mdm.client.ts';
import { PropertyDto } from './mdm.types.ts';

jest.mock('../../config/redis.ts');
jest.mock('./mdm.client.ts');

describe('Properties Service', () => {
  const mockMdmClient = jest.mocked(MdmClient);
  const mockGetOrSetDefault = jest.mocked(getOrSetDefault);
  const mockSetRedis = jest.mocked(setRedis);
  const mockRedisClient = jest.mocked(redisClient);

  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleInfoSpy: jest.SpyInstance;

  const data: PropertyDto[] = [
    {
      id: '999 - 999 - 999 - 99',
      listingType: 'SALE',
      type: 'HOUSE',
      address: 'address',
      bedrooms: 3,
      baths: 2,
      squareFeet: 90,
      lotSize: 220,
      listPrice: 250000,
      status: 'ACTIVE',
    },
  ];

  beforeEach(() => {
    jest.resetAllMocks();

    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('Circuit Breaker: CLOSED State Operations', () => {
    it('should invoke fallback factories when cache keys are missing in Redis', async () => {
      mockGetOrSetDefault.mockImplementationOnce(async (_key, fallback) =>
        fallback(),
      );
      mockGetOrSetDefault.mockImplementationOnce(async (_key, fallback) =>
        fallback(),
      );
      mockGetOrSetDefault.mockImplementationOnce(async (_key, fallback) =>
        fallback(),
      );

      mockMdmClient.fetchProperties.mockResolvedValueOnce(data);

      const now = Date.now();
      const result = await fetchProperties();

      expect(result.data).toEqual(data);
      expect(result.expiresAt).toBeGreaterThan(now);
      expect(mockSetRedis).toHaveBeenCalledWith(
        MDM_PROPERTIES_KEY,
        expect.any(String),
      );
    });

    it('should fetch data from MdmClient when cache is expired/empty', async () => {
      const fixedNow = new Date('2026-11-14T12:00:00Z').getTime();
      jest.useFakeTimers().setSystemTime(fixedNow);

      mockGetOrSetDefault.mockResolvedValueOnce(CbStatus.Closed);
      mockGetOrSetDefault.mockResolvedValueOnce(Date.now() + 5 * MINUTE);
      mockGetOrSetDefault.mockResolvedValueOnce(
        JSON.stringify({
          data: [],
          expiresAt: Date.now() - MINUTE,
        }),
      );

      mockMdmClient.fetchProperties.mockResolvedValueOnce(data);

      const result = await fetchProperties();
      const expectedExpiresAt = fixedNow + 5 * MINUTE;

      expect(result.data).toEqual(data);
      expect(result.expiresAt).toEqual(expectedExpiresAt);
      expect(mockSetRedis).toHaveBeenCalledWith(
        MDM_PROPERTIES_KEY,
        JSON.stringify({ data, expiresAt: expectedExpiresAt }),
      );
    });

    it('should handle MdmClient failure gracefully, log the error, increment failure counter, and return stale data', async () => {
      mockGetOrSetDefault.mockResolvedValueOnce(CbStatus.Closed);
      mockGetOrSetDefault.mockResolvedValueOnce(Date.now() + 5 * MINUTE);
      const expiresAt = Date.now() - MINUTE;
      mockGetOrSetDefault.mockResolvedValueOnce(
        JSON.stringify({
          data: [],
          expiresAt,
        }),
      );

      (mockRedisClient.incr as jest.Mock).mockResolvedValue(1);

      mockMdmClient.fetchProperties.mockRejectedValue(
        new Error('Network error'),
      );

      const result = await fetchProperties();
      expect(result).toEqual({
        data: [],
        expiresAt,
      });
      expect(mockSetRedis).not.toHaveBeenCalledWith(
        MDM_PROPERTIES_KEY,
        expect.any(String),
      );
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[PropertiesService] [CB:CLOSED] Failed to fetch properties (Attempt 1/5). Error: Network error',
      );
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should open the CB and return stale data when reach the max fails counter', async () => {
      mockGetOrSetDefault.mockResolvedValueOnce(CbStatus.Closed);
      mockGetOrSetDefault.mockResolvedValueOnce(Date.now() + 5 * MINUTE);
      const expiresAt = Date.now() - MINUTE;
      mockGetOrSetDefault.mockResolvedValueOnce(
        JSON.stringify({
          data: [],
          expiresAt,
        }),
      );

      (mockRedisClient.incr as jest.Mock).mockResolvedValue(5);

      mockMdmClient.fetchProperties.mockRejectedValue(
        new Error('Network error'),
      );

      const result = await fetchProperties();
      expect(result).toEqual({
        data: [],
        expiresAt,
      });
      expect(mockSetRedis).toHaveBeenCalledWith(CB_STATUS_KEY, CbStatus.Open);
      expect(mockSetRedis).toHaveBeenCalledWith(
        CB_NEXT_RETRY_TIMESTAMP_KEY,
        expect.any(Number),
      );
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[PropertiesService] [CB:TRIPPED] Circuit Breaker opened due to consecutive failures. Next retry scheduled in 1000ms.',
      );
    });

    it('should return valid cache data when cache is not expired/empty', async () => {
      mockGetOrSetDefault.mockResolvedValueOnce(CbStatus.Closed);
      mockGetOrSetDefault.mockResolvedValueOnce(Date.now() + 5 * MINUTE);

      const expiresAt = Date.now() + MINUTE;
      mockGetOrSetDefault.mockResolvedValueOnce(
        JSON.stringify({
          data,
          expiresAt,
        }),
      );

      const result = await fetchProperties();

      expect(result.data).toEqual(data);
      expect(result.expiresAt).toEqual(expiresAt);
      expect(mockMdmClient.fetchProperties).not.toHaveBeenCalled();
    });
  });

  describe('Circuit Breaker: OPEN State Operations', () => {
    it('should fetch data from MdmClient and close the circuit when retry timeout has elapsed', async () => {
      mockGetOrSetDefault.mockResolvedValueOnce(CbStatus.Open);
      mockGetOrSetDefault.mockResolvedValueOnce(Date.now() - MINUTE);
      mockGetOrSetDefault.mockResolvedValueOnce(
        JSON.stringify({ data: [], expiresAt: Date.now() }),
      );

      mockMdmClient.fetchProperties.mockResolvedValue(data);

      const now = Date.now();
      const result = await fetchProperties();

      expect(result.data).toEqual(data);
      expect(result.expiresAt).toBeGreaterThan(now);
      expect(result.expiresAt).toBeLessThanOrEqual(now + 6 * MINUTE);

      expect(mockSetRedis).toHaveBeenCalledWith(
        CB_STATUS_KEY,
        CbStatus.HalfOpen,
      );
      expect(mockSetRedis).toHaveBeenCalledWith(CB_STATUS_KEY, CbStatus.Closed);
      expect(mockSetRedis).toHaveBeenCalledWith(CB_FAIL_COUNTER_KEY, 0);
      expect(mockSetRedis).toHaveBeenCalledWith(CB_RETRY_COUNTER_KEY, 0);
      expect(mockSetRedis).toHaveBeenCalledWith(
        MDM_PROPERTIES_KEY,
        expect.any(String),
      );

      expect(consoleInfoSpy).toHaveBeenCalledTimes(2);
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        '[PropertiesService] [CB:HALF_OPEN] Testing MDM recovery with a probe request...',
      );
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        '[PropertiesService] [CB:RECOVERED] MDM probe succeeded. Circuit Breaker closed and counters reset.',
      );
    });

    it('should keep the circuit open and return stale data when recovery attempt to MdmClient fails', async () => {
      mockGetOrSetDefault.mockResolvedValueOnce(CbStatus.Open);
      mockGetOrSetDefault.mockResolvedValueOnce(Date.now() - MINUTE);
      const expiresAt = Date.now() - MINUTE;
      mockGetOrSetDefault.mockResolvedValueOnce(
        JSON.stringify({ data, expiresAt }),
      );

      mockMdmClient.fetchProperties.mockRejectedValue(
        new Error('Networ error: ERRCONN'),
      );

      const result = await fetchProperties();

      expect(result.data).toEqual(data);
      expect(result.expiresAt).toEqual(expiresAt);

      expect(mockRedisClient.incr).toHaveBeenCalled();
      expect(mockSetRedis).toHaveBeenCalledWith(CB_STATUS_KEY, CbStatus.Open);
      expect(mockSetRedis).toHaveBeenCalledWith(
        CB_NEXT_RETRY_TIMESTAMP_KEY,
        expect.any(Number),
      );

      expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[PropertiesService] [CB:OPEN] MDM is currently unreachable. Serving stale cache data.',
      );
    });

    it('should bypass MdmClient and return stale data immediately when retry timeout has not elapsed', async () => {
      mockGetOrSetDefault.mockResolvedValueOnce(CbStatus.Open);
      mockGetOrSetDefault.mockResolvedValueOnce(Date.now() + MINUTE);
      const expiresAt = Date.now() - MINUTE;
      mockGetOrSetDefault.mockResolvedValueOnce(
        JSON.stringify({ data, expiresAt }),
      );

      const result = await fetchProperties();

      expect(mockMdmClient.fetchProperties).not.toHaveBeenCalled();
      expect(result.data).toEqual(data);
      expect(result.expiresAt).toEqual(expiresAt);
    });
  });

  describe('Circuit Breaker: HALF_OPEN State Operations', () => {
    it('should bypass MdmClient and return stale data immediately', async () => {
      mockGetOrSetDefault.mockResolvedValueOnce(CbStatus.HalfOpen);
      mockGetOrSetDefault.mockResolvedValueOnce(Date.now() + MINUTE);
      const expiresAt = Date.now() - MINUTE;
      mockGetOrSetDefault.mockResolvedValueOnce(
        JSON.stringify({ data, expiresAt }),
      );

      const result = await fetchProperties();

      expect(mockMdmClient.fetchProperties).not.toHaveBeenCalled();
      expect(result.data).toEqual(data);
      expect(result.expiresAt).toEqual(expiresAt);
    });
  });

  it('should return empty fallback data when circuit breaker state is unknown', async () => {
    mockGetOrSetDefault.mockResolvedValueOnce('UNKNOWN_STATE');
    mockGetOrSetDefault.mockResolvedValueOnce(Date.now());
    mockGetOrSetDefault.mockResolvedValueOnce(
      JSON.stringify({ data, expiresAt: Date.now() }),
    );

    const now = Date.now();
    const result = await fetchProperties();

    expect(mockMdmClient.fetchProperties).not.toHaveBeenCalled();
    expect(result.data).toEqual([]);
    expect(result.expiresAt).toBeGreaterThanOrEqual(now);
  });
});
