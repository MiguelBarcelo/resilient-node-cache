export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;

    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class MdmContractError extends AppError {
  constructor() {
    super('MDM Contract expected is not valid', 502, 'MDM_INVALID_CONTRACT');
  }
}

export class MdmTimeoutError extends AppError {
  constructor(message: string) {
    super(message, 503, 'MDM_TIMEOUT');
  }
}

export class MdmHttpError extends AppError {
  constructor(message: string, statusCode: number) {
    super(message, statusCode, 'MDM_HTTP_ERROR');
  }
}

export class MdmConnectionFailed extends AppError {
  constructor(message: string) {
    super(message, 503, 'MDM_CONNECTION_FAILED');
  }
}
