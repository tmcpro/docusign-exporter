import { DocusignService, DocusignConfig } from '../index';
import axios from 'axios';
import fs from 'fs-extra';

jest.mock('axios');
jest.mock('fs-extra');

describe('DocusignService', () => {
    const mockConfig = {
        token: 'test-token',
        accountId: 'test-account',
        userId: 'test-user',
        cookie: 'test-cookie'
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Configuration', () => {
        it('should validate required fields', () => {
            expect(() => new DocusignService({})).toThrow('DocuSign token is required');
            expect(() => new DocusignService({ token: 'test' })).toThrow('DocuSign account ID is required');
            expect(() => new DocusignService({ token: 'test', accountId: 'test' })).toThrow('DocuSign cookie is required');
        });

        it('should validate configuration values', () => {
            expect(() => new DocusignService({
                ...mockConfig,
                maxConcurrent: 0
            })).toThrow('maxConcurrent must be at least 1');

            expect(() => new DocusignService({
                ...mockConfig,
                retryAttempts: -1
            })).toThrow('retryAttempts must be non-negative');

            expect(() => new DocusignService({
                ...mockConfig,
                rateLimit: 0
            })).toThrow('rateLimit must be at least 1');
        });

        it('should cap maxConcurrent at 5', () => {
            const service = new DocusignService({
                ...mockConfig,
                maxConcurrent: 10
            });
            expect(service['config'].maxConcurrent).toBe(5);
        });

        it('should handle environment configuration', () => {
            const prodService = new DocusignService({ ...mockConfig, environment: 'production' });
            const demoService = new DocusignService({ ...mockConfig, environment: 'demo' });

            expect(prodService['baseApiUrl']).toContain('apps.docusign.com');
            expect(demoService['baseApiUrl']).toContain('demo.docusign.net');
        });
    });

    describe('Rate Limiting', () => {
        beforeEach(() => {
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('should respect rate limits', async () => {
            const service = new DocusignService({
                ...mockConfig,
                rateLimit: 2 // 2 requests per second
            });

            const mockFn = jest.fn().mockResolvedValue({ data: { envelopes: [] } });
            
            // First request should go through immediately
            await service['_retryableRequest'](mockFn);
            expect(mockFn).toHaveBeenCalledTimes(1);

            // Second request should be delayed
            const secondRequest = service['_retryableRequest'](mockFn);
            jest.advanceTimersByTime(500); // Advance 500ms
            await secondRequest;
            expect(mockFn).toHaveBeenCalledTimes(2);
        });
    });

    describe('API Calls', () => {
        const mockEnvelopes = [
            { envelopeId: 'env1', status: 'completed' },
            { envelopeId: 'env2', status: 'completed' }
        ];

        beforeEach(() => {
            (axios.get as jest.Mock).mockResolvedValueOnce({
                data: { envelopes: mockEnvelopes }
            });
        });

        it('should fetch envelopes', async () => {
            const service = new DocusignService(mockConfig);
            const envelopes = await service.getEnvelopesWebApi('2024-01-01', '2024-12-31');

            expect(envelopes).toEqual(mockEnvelopes);
            expect(axios.get).toHaveBeenCalledWith(
                expect.stringContaining('/envelopes'),
                expect.any(Object)
            );
        });

        it('should handle pagination', async () => {
            (axios.get as jest.Mock)
                .mockResolvedValueOnce({
                    data: { envelopes: [mockEnvelopes[0]] }
                })
                .mockResolvedValueOnce({
                    data: { envelopes: [mockEnvelopes[1]] }
                })
                .mockResolvedValueOnce({
                    data: { envelopes: [] }
                });

            const service = new DocusignService(mockConfig);
            const envelopes = await service.getEnvelopesWebApi();

            expect(envelopes).toHaveLength(2);
            expect(axios.get).toHaveBeenCalledTimes(3);
        });

        it('should handle API errors', async () => {
            (axios.get as jest.Mock).mockRejectedValueOnce({
                response: { status: 401 }
            });

            const service = new DocusignService(mockConfig);
            let tokenExpired = false;
            service.on('tokenExpired', () => { tokenExpired = true; });

            await expect(service.getEnvelopesWebApi()).rejects.toThrow('Token expired');
            expect(tokenExpired).toBe(true);
        });
    });

    describe('Document Downloads', () => {
        const mockEnvelopes = [
            { envelopeId: 'env1', status: 'completed' },
            { envelopeId: 'env2', status: 'completed' }
        ];

        it('should download documents concurrently', async () => {
            const service = new DocusignService({
                ...mockConfig,
                maxConcurrent: 2
            });
            service['envelopes'] = mockEnvelopes;

            const mockStream = {
                pipe: jest.fn(),
                on: jest.fn((event, cb) => {
                    if (event === 'finish') cb();
                    return mockStream;
                })
            };

            (axios.get as jest.Mock).mockResolvedValue({
                data: mockStream
            });

            (fs.createWriteStream as jest.Mock).mockReturnValue(mockStream);

            let downloadStartCount = 0;
            let downloadCompleteCount = 0;

            service.on('downloadStarted', () => downloadStartCount++);
            service.on('downloadComplete', () => downloadCompleteCount++);

            await service.downloadDocuments();

            expect(downloadStartCount).toBe(2);
            expect(downloadCompleteCount).toBe(2);
            expect(axios.get).toHaveBeenCalledTimes(2);
        });

        it('should handle cancellation', async () => {
            const service = new DocusignService(mockConfig);
            service['envelopes'] = mockEnvelopes;

            setTimeout(() => service.cancel(), 10);

            await service.downloadDocuments();

            expect(axios.get).not.toHaveBeenCalled();
        });
    });
}); 