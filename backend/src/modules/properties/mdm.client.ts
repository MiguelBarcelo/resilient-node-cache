import axios from 'axios';
import type { PropertyDto } from './mdm.types.ts';
import {
  AppError,
  MdmConnectionFailed,
  MdmContractError,
  MdmHttpError,
  MdmTimeoutError,
} from '../../errors/AppError.ts';

const MDM_BASE_URL = process.env.MDM_BASE_URL; // TODO: Enforce using Zod
const REQUEST_TIMEOUT_MS = 3000; // 3secs limit timeout

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
        throw new MdmContractError();
      }

      return response.data.data;
    } catch (error: any) {
      if (error instanceof AppError) throw error;

      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED' || error.name === 'CanceledError') {
          throw new MdmTimeoutError(
            `MDM request timed out after ${REQUEST_TIMEOUT_MS}ms`,
          );
        }

        if (error.response) {
          throw new MdmHttpError(
            `MDM respond with status: ${error.response.status}`,
            error.response.status,
          );
        }
      }

      throw new MdmConnectionFailed(`MDM connection failed: ${error?.message}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
