import { config } from '../config.js';

export class HttpError extends Error {
  constructor(status, message, cause) {
    super(message, { cause });
    this.status = status;
  }
}

export function fail(status, message) {
  throw new HttpError(status, message);
}

export function errorResponse(error, where, requestId) {
  let status = Number(error.status ?? error.statusCode);
  if (error.code === 'LIMIT_FILE_SIZE') status = 413;
  else if (String(error.code).startsWith('LIMIT_')) status = 400;
  if (!Number.isInteger(status) || status < 400 || status > 599) status = 500;
  const body = {
    error: status < 500 || !config.production ? error.message : 'Something went wrong. Try again.',
    requestId
  };
  if (!config.production) {
    body.details = {
      what: error.name, why: error.cause?.message || error.message,
      where, code: error.code, stack: error.stack
    };
  }
  if (status >= 500) console.error({ requestId, where, error });
  return { status, body };
}
