import axios from 'axios';
import type { PropertyDto } from './mdm.types.ts';

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

      return response.data.data;
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED' || error.name === 'CanceledError') {
          throw new Error(
            `MDM request timed out after ${REQUEST_TIMEOUT_MS}ms`,
          );
        }

        if (error.response) {
          throw new Error(`MDM respond with status: ${error.response.status}`);
        }
      }

      throw new Error(`MDM connection failed: ${error.message}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
