# DocuSign Exporter

A Node.js library for bulk exporting documents from DocuSign with concurrent downloads, progress tracking, and robust error handling.

Docusign typically will charge fees to access their API or bulk download documents. This library uses the web API using your token & cookie to download documents programmatically for free on any account type.  

Take a look at the [examples/cli.js](examples/cli.js) as a good starting point to run the script. 

## Features

- 🚀 Concurrent downloads with configurable batch size
- 📊 Real-time progress tracking with event emitters
- 🔄 Automatic retries with exponential backoff
- 🌐 Support for both production and demo environments
- 💾 Streaming downloads for efficient memory usage
- 🛑 Graceful cancellation support
- 📝 Written in TypeScript with full type definitions
- ✅ Comprehensive test coverage

## Installation

```bash
npm install docusign-exporter
```

## Quick Start

```typescript
import { DocusignService } from 'docusign-exporter';

const service = new DocusignService({
  environment: 'production',
  outputPath: './downloads',
  maxConcurrent: 5
});

// Set up event handlers
service.on('downloadComplete', ({ envelopeId, progress }) => {
  console.log(`Downloaded ${envelopeId} (${progress}% complete)`);
});

// Start downloading
const envelopes = await service.getEnvelopesWebApi('2024-01-01', '2024-12-31');
await service.downloadDocuments();
```

## Configuration

The `DocusignService` accepts the following configuration options:

```typescript
interface DocusignConfig {
  // Required
  token: string;        // DocuSign API token
  accountId: string;    // DocuSign account ID
  cookie: string;       // DocuSign session cookie

  // Optional
  environment?: 'production' | 'demo';  // Default: 'production'
  outputPath?: string;                  // Default: './docusign_downloads'
  maxConcurrent?: number;              // Default: 3
  retryAttempts?: number;              // Default: 3
  retryDelay?: number;                 // Default: 1000 (ms)
}
```

## Events

The service emits the following events:

- `searchStarted`: When envelope search begins
- `envelopesFound`: When envelopes are found
- `downloadStarted`: When a document download begins
- `downloadComplete`: When a document is downloaded
- `downloadError`: When a download fails
- `retrying`: When retrying a failed request
- `tokenExpired`: When the authentication token expires
- `allDownloadsComplete`: When all downloads are finished
- `cancelled`: When the download process is cancelled

## Environment Variables

Create a .env file with your DocuSign credentials:

```env
DOCUSIGN_TOKEN=your_token_here
DOCUSIGN_ACCOUNT_ID=your_account_id
DOCUSIGN_USER_ID=your_user_id
DOCUSIGN_COOKIE=your_cookie_value
```

## Getting DocuSign Credentials

1. Log in to apps.docusign.com
2. Open Developer Tools (F12)
3. Go to Network tab
4. Find any request to /api/esign/
5. Copy these values from the request:
   - Bearer token from Authorization header
   - Account ID from the URL
   - Cookie value from Cookie header

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build
npm run build

# Run tests
npm test

# Lint
npm run lint

# Format code
npm run format
```

## License
MIT

## Support
If you encounter any issues or have an issue with this repo please reach out. 
