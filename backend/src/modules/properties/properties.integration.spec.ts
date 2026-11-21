import {
  jest,
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
} from '@jest/globals';
import request from 'supertest';
import nock from 'nock';
import app from '../../app.ts';
import redisClient, { connectRedis } from '../../config/redis.ts';
import {
  CB_STATUS_KEY,
  CB_FAIL_COUNTER_KEY,
  CbStatus,
  MDM_PROPERTIES_KEY,
} from './properties.service.ts';
import { PropertyDto } from './mdm.types.ts';
import { MINUTE } from './properties.service.ts';

const API_BASE_URL = '/api/v1';
const MDM_BASE_URL = process.env.MDM_BASE_URL;
const factoryError = (message: string, code: string) =>
  Object.assign(new Error(message), { code });

describe('Properties Integration Tests', () => {
  let consoleWarnSpy: ReturnType<typeof jest.spyOn>;
  let consoleErrorSpy: ReturnType<typeof jest.spyOn>;
  let consoleInfoSpy: ReturnType<typeof jest.spyOn>;

  const networkError = factoryError('Connection refused', 'ECONNREFUSED');

  const mockProperties: PropertyDto[] = [
    {
      id: '999-999-999-99',
      listingType: 'SALE',
      type: 'HOUSE',
      address: '123 Main St',
      bedrooms: 3,
      baths: 2,
      squareFeet: 90,
      lotSize: 220,
      listPrice: 250000,
      status: 'ACTIVE',
    },
  ];

  beforeAll(async () => {
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    if (!process.env.REDIS_URL?.endsWith('/1')) {
      throw new Error(
        `[SAFETY ABORT] Integration tests must run against Redis DB 1, got: ${process.env.REDIS_URL}`,
      );
    }

    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    await connectRedis();
  });

  afterEach(async () => {
    jest.clearAllTimers();
    jest.useRealTimers();

    await redisClient.flushDb();
    nock.cleanAll();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    nock.cleanAll();
    nock.enableNetConnect();
    await redisClient.flushDb();
    await redisClient.quit();
  });

  it('should fetch from MDM via axios, persist in Redis, and return 200 OK on cold start', async () => {
    const mdmScope = nock(MDM_BASE_URL!)
      .get('/properties')
      .reply(200, { data: mockProperties });

    const response = await request(app)
      .get(`${API_BASE_URL}/properties`)
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body).toEqual({
      data: mockProperties,
      expiresAt: expect.any(Number),
    });

    expect(mdmScope.isDone()).toBe(true);

    const storedStatus = await redisClient.get(CB_STATUS_KEY);
    expect(storedStatus).toBe(CbStatus.Closed);
  });

  it('should serve cached properties from Redis on subsequent requests without hitting MDM', async () => {
    const mdmScope = nock(MDM_BASE_URL!)
      .get('/properties')
      .times(1)
      .reply(200, { data: mockProperties });

    // First call: Fill cache in Redis
    await request(app).get(`${API_BASE_URL}/properties`).expect(200);

    // Second call: direct response from Redis
    const cachedResponse = await request(app)
      .get(`${API_BASE_URL}/properties`)
      .expect(200);

    expect(cachedResponse.body.data).toEqual(mockProperties);
    expect(mdmScope.isDone()).toBe(true);
  });

  it('should trip the Circuit Breaker to OPEN in Redis after 5 consecutive MDM HTTP 500 errors', async () => {
    const mdmScope = nock(MDM_BASE_URL!)
      .get('/properties')
      .times(5)
      .reply(500, { error: 'Internal Server Error' });

    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .get(`${API_BASE_URL}/properties`)
        .expect(200);

      expect(res.body.data).toEqual([]);
    }

    expect(mdmScope.isDone()).toBe(true);

    // Check if the circuit breaker has been opened
    const status = await redisClient.get(CB_STATUS_KEY);
    const failCount = await redisClient.get(CB_FAIL_COUNTER_KEY);

    expect(status).toBe(CbStatus.Open);
    expect(failCount).toBe('5');

    // 6th request: with the circuit is open, it must no longer try to hit MDM
    const openResponse = await request(app)
      .get(`${API_BASE_URL}/properties`)
      .expect(200);

    expect(openResponse.body.data).toEqual([]);
  });

  it('should serve expired cache from Redis when MDM is not available', async () => {
    jest.useFakeTimers({
      doNotFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'clearImmediate',
        'nextTick',
      ],
    });

    // First call to MDM
    const firstMdmScope = nock(MDM_BASE_URL!)
      .get('/properties')
      .reply(200, {
        data: [
          ...mockProperties,
          {
            id: '888-888-888-88',
            listingType: 'RENT',
            type: 'APARTMENT',
            address: 'Rodeo St',
            bedrooms: 1,
            baths: 1,
            squareFeet: 90,
            lotSize: 90,
            listPrice: 350000,
            status: 'ACTIVE',
          },
        ],
      });

    // First request
    const firstResponse = await request(app)
      .get(`${API_BASE_URL}/properties`)
      .expect('Content-Type', /json/)
      .expect(200);

    const expiresAt = firstResponse.body.expiresAt;

    // Advance in time...
    const futureTime = 6 * MINUTE;
    jest.advanceTimersByTime(futureTime);

    // Second call to MDM

    const secondMdmScope = nock(MDM_BASE_URL!)
      .get('/properties')
      .replyWithError(networkError);

    const response = await request(app)
      .get(`${API_BASE_URL}/properties`)
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body).toEqual({
      data: [
        ...mockProperties,
        {
          id: '888-888-888-88',
          listingType: 'RENT',
          type: 'APARTMENT',
          address: 'Rodeo St',
          bedrooms: 1,
          baths: 1,
          squareFeet: 90,
          lotSize: 90,
          listPrice: 350000,
          status: 'ACTIVE',
        },
      ],
      expiresAt,
    });

    expect(firstMdmScope.isDone()).toBe(true);
    expect(secondMdmScope.isDone()).toBe(true);

    const storedStatus = await redisClient.get(CB_STATUS_KEY);
    expect(storedStatus).toBe(CbStatus.Closed);

    const storedFailCounter = await redisClient.get(CB_FAIL_COUNTER_KEY);
    expect(storedFailCounter).toEqual('1');
  });

  it('should serve fresh data from MDM and close the CB when request explorer has success into MDM', async () => {
    // I. Clock preparation and initial state OPEN
    jest.useFakeTimers({
      doNotFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'clearImmediate',
        'nextTick',
      ],
    });

    const firstsFiveMdmScope = nock(MDM_BASE_URL!)
      .get('/properties')
      .times(5)
      .replyWithError(networkError);

    for (let i = 0; i < 5; i++) {
      await request(app).get(`${API_BASE_URL}/properties`).expect(200);
    }

    expect(firstsFiveMdmScope.isDone()).toBe(true);

    let storedStatus = await redisClient.get(CB_STATUS_KEY);
    expect(storedStatus).toBe(CbStatus.Open);

    // II. Lock validation during backoff
    const immediateMdmScope = nock(MDM_BASE_URL!)
      .get('/properties')
      .replyWithError(networkError);

    // first backoff retry is 1 SECOND after
    await request(app).get(`${API_BASE_URL}/properties`).expect(200);

    expect(immediateMdmScope.isDone()).toBe(false);

    //fix3: Cleaning of the unconsumed interceptor
    nock.cleanAll();

    // III. Time jump and transition to HALF_OPEN
    jest.advanceTimersByTime(1500);

    // IV. Explorer request
    const timestampRequest = Date.now();
    const newData = [
      ...mockProperties,
      {
        id: '888-888-888-88',
        listingType: 'RENT',
        type: 'APARTMENT',
        address: 'Rodeo St',
        bedrooms: 1,
        baths: 1,
        squareFeet: 90,
        lotSize: 90,
        listPrice: 350000,
        status: 'ACTIVE',
      },
      {
        id: '777-777-777-77',
        listingType: 'SALE',
        type: 'HOUSE',
        address: 'Bervelly Hills',
        bedrooms: 6,
        baths: 6,
        squareFeet: 540,
        lotSize: 1000,
        listPrice: 950000,
        status: 'ACTIVE',
      },
    ];
    const checkingHealthMdmScope = nock(MDM_BASE_URL!)
      .get('/properties')
      .reply(200, { data: newData });

    const response = await request(app)
      .get(`${API_BASE_URL}/properties`)
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body).toEqual({
      data: newData,
      expiresAt: expect.closeTo(timestampRequest + 5 * MINUTE, -3),
    });

    expect(checkingHealthMdmScope.isDone()).toBe(true);

    storedStatus = await redisClient.get(CB_STATUS_KEY);
    expect(storedStatus).toBe(CbStatus.Closed);

    const storedFailsCounter = await redisClient.get(CB_FAIL_COUNTER_KEY);
    expect(storedFailsCounter).toBe('0');

    const cache = await redisClient.get(MDM_PROPERTIES_KEY);
    expect(cache).not.toBeNull();
    const storedData = JSON.parse(cache!);
    expect(storedData).toEqual(response.body);
  });

  it('should not affect Telemetry Circuit Breaker when MDM send errors other than 500', async () => {
    const mdmScope = nock(MDM_BASE_URL!)
      .get('/properties')
      .times(2)
      .reply(400, { error: 'Bad Request' })
      .get('/properties')
      .reply(401, { error: 'Unauthorized' })
      .get('/properties')
      .reply(403, { error: 'Forbidden' })
      .get('/properties')
      .reply(404, { error: 'Not Found' });

    for (let i = 0; i < 5; i++) {
      await request(app).get(`${API_BASE_URL}/properties`).expect(200);
    }

    expect(mdmScope.isDone()).toBe(true);

    const storedFailCounter = await redisClient.get(CB_FAIL_COUNTER_KEY);
    const storedStatus = await redisClient.get(CB_STATUS_KEY);
    expect(storedFailCounter).toBe('0');
    expect(storedStatus).toBe(CbStatus.Closed);
  });

  it('should not affect Telemetry Circuit Breaker when MDM send malformed responses', async () => {
    const mdmScope = nock(MDM_BASE_URL!)
      .get('/properties')
      .times(5)
      .reply(200, { newStructure: 'Garbage' });

    let response;
    for (let i = 0; i < 5; i++) {
      response = await request(app)
        .get(`${API_BASE_URL}/properties`)
        .expect(200);
    }

    expect(mdmScope.isDone()).toBe(true);

    expect(response).not.toBeFalsy();

    expect(response?.body).toEqual({
      data: [],
      expiresAt: expect.any(Number),
    });

    const cache = await redisClient.get(MDM_PROPERTIES_KEY);
    expect(cache).not.toBeNull();
    const storedData = JSON.parse(cache!);
    expect(storedData.data).not.toBeNull();
    expect(Array.isArray(storedData.data)).toBe(true);
    expect(storedData.expiresAt).not.toBeNull();

    expect(storedData.newStructure).toBeUndefined();

    const storedFailCounter = await redisClient.get(CB_FAIL_COUNTER_KEY);
    const storedStatus = await redisClient.get(CB_STATUS_KEY);
    expect(storedFailCounter).toBe('0');
    expect(storedStatus).toBe(CbStatus.Closed);
  });
});
