export class DocusignError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocusignError';
  }
}

export class TokenExpiredError extends DocusignError {
  constructor() {
    super('Token expired. Please refresh your authentication token.');
    this.name = 'TokenExpiredError';
  }
}

export class RateLimitError extends DocusignError {
  constructor(retryAfter?: number) {
    super(`Rate limit exceeded. ${retryAfter ? `Try again after ${retryAfter} seconds.` : ''}`);
    this.name = 'RateLimitError';
  }
}

export class ConfigurationError extends DocusignError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export class NetworkError extends DocusignError {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
} 