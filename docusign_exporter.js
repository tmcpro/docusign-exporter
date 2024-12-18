const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

class DocusignConfig {
    constructor(config = {}) {
        this.token = (config.token || process.env.DOCUSIGN_TOKEN || '').replace('Bearer ', '');
        this.accountId = config.accountId || process.env.DOCUSIGN_ACCOUNT_ID;
        this.userId = config.userId || process.env.DOCUSIGN_USER_ID;
        this.cookie = config.cookie || process.env.DOCUSIGN_COOKIE;
        this.environment = config.environment || 'production';
        this.outputFormat = config.outputFormat || 'combined'; // 'combined', 'individual'
        this.outputPath = config.outputPath || './docusign_downloads';
        this.maxConcurrent = config.maxConcurrent || 3;
        this.retryAttempts = config.retryAttempts || 3;
        this.retryDelay = config.retryDelay || 1000;
        
        this.validate();
    }

    validate() {
        if (!this.token) throw new Error('DocuSign token is required');
        if (!this.accountId) throw new Error('DocuSign account ID is required');
        if (!this.cookie) throw new Error('DocuSign cookie is required');
        if (!['production', 'demo'].includes(this.environment)) {
            throw new Error('Environment must be either "production" or "demo"');
        }
    }

    getBaseUrl() {
        return this.environment === 'production' 
            ? 'https://apps.docusign.com/api/esign/na3/restapi/v2.1'
            : 'https://demo.docusign.net/restapi/v2.1';
    }
}

class DocusignService extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = new DocusignConfig(config);
        this.headers = this._buildHeaders();
        this.baseApiUrl = this.config.getBaseUrl();
        this.envelopes = [];
        this.isCancelled = false;
    }

    _buildHeaders() {
        return {
            'accept': 'application/json',
            'authorization': `Bearer ${this.config.token}`,
            'Cookie': this.config.cookie
        };
    }

    async _retryableRequest(requestFn, attempt = 1) {
        try {
            return await requestFn();
        } catch (error) {
            if (error.response?.status === 401) {
                this.emit('tokenExpired');
                throw new Error('Token expired. Please refresh your authentication token.');
            }

            if (error.response?.status === 429 || (error.response?.status >= 500 && error.response?.status < 600)) {
                if (attempt <= this.config.retryAttempts) {
                    const delay = this.config.retryDelay * Math.pow(2, attempt - 1);
                    this.emit('retrying', { attempt, delay, error: error.message });
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return this._retryableRequest(requestFn, attempt + 1);
                }
            }

            throw error;
        }
    }

    async getEnvelopesWebApi(fromDate = '2017-05-13', toDate = '2021-06-01') {
        if (this.isCancelled) return [];

        try {
            const fromDateISO = new Date(fromDate).toISOString();
            const toDateISO = new Date(toDate).toISOString();
            
            let url = `${this.baseApiUrl}/accounts/${this.config.accountId}/envelopes`;
            const params = {
                from_date: fromDateISO,
                to_date: toDateISO,
                user_id: this.config.userId,
                start_position: 0,
                count: 100,
                order: 'desc',
                order_by: 'last_modified',
                folder_types: 'normal,inbox,sentitems'
            };

            this.emit('searchStarted', { fromDate, toDate });
            let hasMore = true;
            while (hasMore && !this.isCancelled) {
                const response = await this._retryableRequest(() => 
                    axios.get(url, { headers: this.headers, params })
                );

                if (response.data.envelopes) {
                    this.envelopes.push(...response.data.envelopes);
                    this.emit('envelopesFound', {
                        count: response.data.envelopes.length,
                        total: this.envelopes.length
                    });
                    params.start_position = this.envelopes.length;
                }

                hasMore = response.data.envelopes?.length === params.count;
            }

            return this.envelopes;
        } catch (error) {
            this.emit('error', error);
            throw error;
        }
    }

    async downloadDocuments() {
        if (!this.envelopes.length || this.isCancelled) return;

        const outputDir = this.config.outputPath;
        await fs.ensureDir(outputDir);

        const chunks = [];
        for (let i = 0; i < this.envelopes.length; i += this.config.maxConcurrent) {
            chunks.push(this.envelopes.slice(i, i + this.config.maxConcurrent));
        }

        let downloadedCount = 0;
        for (const chunk of chunks) {
            if (this.isCancelled) break;

            await Promise.all(chunk.map(async envelope => {
                try {
                    const fileName = `${envelope.envelopeId}.pdf`;
                    const filePath = path.join(outputDir, fileName);

                    this.emit('downloadStarted', { envelopeId: envelope.envelopeId });

                    const response = await this._retryableRequest(() =>
                        axios.get(
                            `${this.baseApiUrl}/accounts/${this.config.accountId}/envelopes/${envelope.envelopeId}/documents/combined`,
                            {
                                headers: this.headers,
                                responseType: 'stream'
                            }
                        )
                    );

                    const writer = fs.createWriteStream(filePath);
                    response.data.pipe(writer);

                    await new Promise((resolve, reject) => {
                        writer.on('finish', resolve);
                        writer.on('error', reject);
                    });

                    downloadedCount++;
                    this.emit('downloadComplete', {
                        envelopeId: envelope.envelopeId,
                        progress: (downloadedCount / this.envelopes.length) * 100
                    });

                } catch (error) {
                    this.emit('downloadError', {
                        envelopeId: envelope.envelopeId,
                        error: error.message
                    });
                }
            }));
        }

        this.emit('allDownloadsComplete', { total: downloadedCount });
    }

    cancel() {
        this.isCancelled = true;
        this.emit('cancelled');
    }
}

module.exports = { DocusignService, DocusignConfig }; 