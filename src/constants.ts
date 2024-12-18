export const DEFAULT_CONFIG = {
  environment: 'production' as const,
  outputFormat: 'combined' as const,
  outputPath: './docusign_downloads',
  maxConcurrent: 3,
  retryAttempts: 3,
  retryDelay: 1000,
  rateLimit: 5,
};

export const API_ENDPOINTS = {
  production: 'https://apps.docusign.com/api/esign/na3/restapi/v2.1',
  demo: 'https://demo.docusign.net/restapi/v2.1',
};

export const HTTP_STATUS = {
  UNAUTHORIZED: 401,
  TOO_MANY_REQUESTS: 429,
  SERVER_ERROR_START: 500,
  SERVER_ERROR_END: 599,
} as const;

export const BATCH_SIZE = 100;
export const MAX_CONCURRENT_DOWNLOADS = 5; 