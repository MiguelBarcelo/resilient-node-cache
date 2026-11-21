import axios from 'axios';
import type { PropertyDto } from './mdm.types.ts';
import {
  AppError,
  MdmConnectionFailed,
  MdmContractError,
  MdmHttpError,
  MdmTimeoutError,
} from '../../errors/AppError.ts';
import logger from '../../utils/logger.ts';

const MDM_BASE_URL = process.env.MDM_BASE_URL; // TODO: Enforce using Zod
export const REQUEST_TIMEOUT_MS = 3000; // 3secs limit timeout

export default class MdmClient {
  static async fetchProperties(): Promise<PropertyDto[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await axios.get<{ data: PropertyDto[] }>(
        `${MDM_BASE_URL}/properties`,
        {
          timeout: REQUEST_TIMEOUT_MS,
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      if (!Array.isArray(response.data.data)) {
        logger.error({
          msg: 'MDM Contract expected is not valid',
          service: 'MdmClient',
          event: 'MDM_INVALID_CONTRACT',
          receivedType: typeof response.data?.data,
        });
        throw new MdmContractError();
      }

      return response.data.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED' || error.name === 'CanceledError') {
          logger.error({
            msg: 'MDM request timed out of time',
            service: 'MdmClient',
            event: 'MDM_TIMEOUT',
            req_time_out: REQUEST_TIMEOUT_MS,
          });
          throw new MdmTimeoutError(
            `MDM request timed out after ${REQUEST_TIMEOUT_MS}ms`,
          );
        }

        if (error.response) {
          logger.error({
            msg: 'Response from MDM',
            service: 'MdmClient',
            event: 'MDM_HTTP_ERROR',
            status: error.response.status,
          });
          throw new MdmHttpError(
            `MDM respond with status: ${error.response.status}`,
            error.response.status,
          );
        }
      }

      logger.error({
        msg: 'MDM connection failed',
        service: 'MdmClient',
        event: 'MDM_CONNECTION_FAILED',
        error: error?.message,
      });
      throw new MdmConnectionFailed(`MDM connection failed: ${error?.message}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
