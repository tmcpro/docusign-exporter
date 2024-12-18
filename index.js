require('dotenv').config();
const { DocusignService } = require('./docusign_exporter');

async function main() {
    try {
        console.log('Starting DocuSign export...');
        
        const service = new DocusignService({
            environment: 'production',
            outputPath: './downloads',
            maxConcurrent: 5,
            retryAttempts: 3
        });

        // Set up event handlers for progress tracking
        service.on('searchStarted', ({ fromDate, toDate }) => {
            console.log(`🔍 Searching for envelopes from ${fromDate} to ${toDate}`);
        });

        service.on('envelopesFound', ({ count, total }) => {
            console.log(`📑 Found ${count} envelopes (Total: ${total})`);
        });

        service.on('downloadStarted', ({ envelopeId }) => {
            console.log(`⬇️  Downloading envelope: ${envelopeId}`);
        });

        service.on('downloadComplete', ({ envelopeId, progress }) => {
            console.log(`✅ Downloaded envelope: ${envelopeId} (${progress.toFixed(1)}% complete)`);
        });

        service.on('downloadError', ({ envelopeId, error }) => {
            console.error(`❌ Error downloading envelope ${envelopeId}:`, error);
        });

        service.on('retrying', ({ attempt, delay, error }) => {
            console.log(`🔄 Retry attempt ${attempt} after ${delay}ms due to: ${error}`);
        });

        service.on('tokenExpired', () => {
            console.error('🔑 Authentication token has expired. Please refresh your token.');
            console.log('To get a new token:');
            console.log('1. Go to apps.docusign.com and log in');
            console.log('2. Open Developer Tools (F12)');
            console.log('3. Go to Network tab');
            console.log('4. Find any request to /api/esign/');
            console.log('5. Copy the Bearer token from the authorization header');
            process.exit(1);
        });

        service.on('allDownloadsComplete', ({ total }) => {
            console.log(`🎉 Successfully downloaded ${total} documents`);
        });

        // Handle graceful shutdown
        process.on('SIGINT', () => {
            console.log('\n⏳ Cancelling downloads...');
            service.cancel();
        });

        // Start the export process
        const fromDate = '2024-01-01';
        const toDate = new Date().toISOString().split('T')[0];
        
        console.log('Fetching envelopes...');
        const envelopes = await service.getEnvelopesWebApi(fromDate, toDate);

        if (envelopes.length > 0) {
            console.log('Starting downloads...');
            await service.downloadDocuments();
        }
    } catch (error) {
        console.error('Error running DocuSign exporter:', error.message);
        if (error.response) {
            console.error('API Response:', {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data
            });
        }
        process.exit(1);
    }
}

main(); 