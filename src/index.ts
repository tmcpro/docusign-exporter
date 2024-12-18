import axios, { AxiosError, AxiosResponse } from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { EventEmitter } from 'events';

export interface DocusignConfigOptions {
  token?: string;
  accountId?: string;
  userId?: string;
  cookie?: string;
  environment?: 'production' | 'demo';
  outputFormat?: 'combined' | 'individual';
  outputPath?: string;
  maxConcurrent?: number;
  retryAttempts?: number;
  retryDelay?: number;
  rateLimit?: number;
}

export interface Envelope {
  envelopeId: string;
  status: string;
  emailSubject?: string;
  sentDateTime?: string;
  completedDateTime?: string;
}

export interface DocusignError extends Error {
  response?: {
    status: number;
    statusText: string;
    data: unknown;
  };
}

export class DocusignConfig {
  token: string;
  accountId: string;
  userId: string;
  cookie: string;
  environment: 'production' | 'demo';
  outputFormat: 'combined' | 'individual';
  outputPath: string;
  maxConcurrent: number;
  retryAttempts: number;
  retryDelay: number;
  rateLimit: number;

  constructor(config: DocusignConfigOptions = {}) {
    this.token = (config.token || process.env.DOCUSIGN_TOKEN || '').replace('Bearer ', '');
    this.accountId = config.accountId || process.env.DOCUSIGN_ACCOUNT_ID || '';
    this.userId = config.userId || process.env.DOCUSIGN_USER_ID || '';
    this.cookie = config.cookie || process.env.DOCUSIGN_COOKIE || '';
    this.environment = config.environment || 'production';
    this.outputFormat = config.outputFormat || 'combined';
    this.outputPath = config.outputPath || './docusign_downloads';
    this.maxConcurrent = Math.min(config.maxConcurrent || 3, 5);
    this.retryAttempts = config.retryAttempts || 3;
    this.retryDelay = config.retryDelay || 1000;
    this.rateLimit = config.rateLimit || 5;

    this.validate();
  }

  validate(): void {
    if (!this.token) throw new Error('DocuSign token is required');
    if (!this.accountId) throw new Error('DocuSign account ID is required');
    if (!this.cookie) throw new Error('DocuSign cookie is required');
    if (!['production', 'demo'].includes(this.environment)) {
      throw new Error('Environment must be either "production" or "demo"');
    }
    if (this.maxConcurrent < 1) throw new Error('maxConcurrent must be at least 1');
    if (this.retryAttempts < 0) throw new Error('retryAttempts must be non-negative');
    if (this.retryDelay < 0) throw new Error('retryDelay must be non-negative');
    if (this.rateLimit < 1) throw new Error('rateLimit must be at least 1');
  }

  getBaseUrl(): string {
    return this.environment === 'production'
      ? 'https://apps.docusign.com/api/esign/na3/restapi/v2.1'
      : 'https://demo.docusign.net/restapi/v2.1';
  }
}

export class DocusignService extends EventEmitter {
  private config: DocusignConfig;
  private headers: Record<string, string>;
  private baseApiUrl: string;
  private envelopes: Envelope[];
  private isCancelled: boolean;
  private lastRequestTime: number;

  constructor(config: DocusignConfigOptions = {}) {
    super();
    this.config = new DocusignConfig(config);
    this.headers = this._buildHeaders();
    this.baseApiUrl = this.config.getBaseUrl();
    this.envelopes = [];
    this.isCancelled = false;
    this.lastRequestTime = 0;
  }

  private _buildHeaders(): Record<string, string> {
    return {
      accept: 'application/json',
      authorization: `Bearer ${this.config.token}`,
      Cookie: this.config.cookie,
    };
  }

  private async _rateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    const minRequestInterval = 1000 / this.config.rateLimit;

    if (timeSinceLastRequest < minRequestInterval) {
      await new Promise(resolve => setTimeout(resolve, minRequestInterval - timeSinceLastRequest));
    }
    this.lastRequestTime = Date.now();
  }

  private async _retryableRequest<T>(requestFn: () => Promise<T>, attempt = 1): Promise<T> {
    try {
      await this._rateLimit();
      return await requestFn();
    } catch (error) {
      if (error instanceof AxiosError) {
        if (error.response?.status === 401) {
          this.emit('tokenExpired');
          throw new Error('Token expired. Please refresh your authentication token.');
        }

        if (error.response?.status === 429 || (error.response?.status ?? 0) >= 500) {
          if (attempt <= this.config.retryAttempts) {
            const delay = this.config.retryDelay * Math.pow(2, attempt - 1);
            this.emit('retrying', { attempt, delay, error: error.message });
            await new Promise(resolve => setTimeout(resolve, delay));
            return this._retryableRequest(requestFn, attempt + 1);
          }
        }

        const message = error.response?.data?.message || error.message;
        throw new Error(`DocuSign API Error: ${message} (Status: ${error.response?.status})`);
      }

      throw error;
    }
  }

  async getEnvelopesWebApi(fromDate = '2017-05-13', toDate = '2021-06-01'): Promise<Envelope[]> {
    if (this.isCancelled) return [];

    try {
      const fromDateISO = new Date(fromDate).toISOString();
      const toDateISO = new Date(toDate).toISOString();

      const url = `${this.baseApiUrl}/accounts/${this.config.accountId}/envelopes`;
      const params = {
        from_date: fromDateISO,
        to_date: toDateISO,
        user_id: this.config.userId,
        start_position: 0,
        count: 100,
        order: 'desc',
        order_by: 'last_modified',
        folder_types: 'normal,inbox,sentitems',
      };

      this.emit('searchStarted', { fromDate, toDate });
      let hasMore = true;

      while (hasMore && !this.isCancelled) {
        const response = await this._retryableRequest(() =>
          axios.get<{ envelopes?: Envelope[] }>(url, { headers: this.headers, params })
        );

        if (response.data.envelopes) {
          this.envelopes.push(...response.data.envelopes);
          this.emit('envelopesFound', {
            count: response.data.envelopes.length,
            total: this.envelopes.length,
          });
          params.start_position = this.envelopes.length;
        }

        hasMore = (response.data.envelopes?.length ?? 0) === params.count;
      }

      return this.envelopes;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  async downloadDocuments(): Promise<void> {
    if (!this.envelopes.length || this.isCancelled) return;

    const outputDir = this.config.outputPath;
    await fs.ensureDir(outputDir);

    const chunks: Envelope[][] = [];
    for (let i = 0; i < this.envelopes.length; i += this.config.maxConcurrent) {
      chunks.push(this.envelopes.slice(i, i + this.config.maxConcurrent));
    }

    let downloadedCount = 0;
    for (const chunk of chunks) {
      if (this.isCancelled) break;

      await Promise.all(
        chunk.map(async envelope => {
          try {
            const fileName = `${envelope.envelopeId}.pdf`;
            const filePath = path.join(outputDir, fileName);

            this.emit('downloadStarted', { envelopeId: envelope.envelopeId });

            const response = await this._retryableRequest(() =>
              axios.get(
                `${this.baseApiUrl}/accounts/${this.config.accountId}/envelopes/${envelope.envelopeId}/documents/combined`,
                {
                  headers: this.headers,
                  responseType: 'stream',
                }
              )
            );

            const writer = fs.createWriteStream(filePath);
            response.data.pipe(writer);

            await new Promise<void>((resolve, reject) => {
              writer.on('finish', resolve);
              writer.on('error', reject);
            });

            downloadedCount++;
            this.emit('downloadComplete', {
              envelopeId: envelope.envelopeId,
              progress: (downloadedCount / this.envelopes.length) * 100,
            });
          } catch (error) {
            this.emit('downloadError', {
              envelopeId: envelope.envelopeId,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        })
      );
    }

    this.emit('allDownloadsComplete', { total: downloadedCount });
  }

  cancel(): void {
    this.isCancelled = true;
    this.emit('cancelled');
  }
} 