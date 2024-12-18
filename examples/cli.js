#!/usr/bin/env node

const { DocusignService } = require('../dist');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const ora = require('ora');
const chalk = require('chalk');

const argv = yargs(hideBin(process.argv))
    .usage('Usage: $0 [options]')
    .options({
        'from': {
            alias: 'f',
            describe: 'Start date (YYYY-MM-DD)',
            default: '2024-01-01',
            type: 'string'
        },
        'to': {
            alias: 't',
            describe: 'End date (YYYY-MM-DD)',
            default: new Date().toISOString().split('T')[0],
            type: 'string'
        },
        'output': {
            alias: 'o',
            describe: 'Output directory',
            default: './downloads',
            type: 'string'
        },
        'concurrent': {
            alias: 'c',
            describe: 'Number of concurrent downloads',
            default: 3,
            type: 'number'
        }
    })
    .example('$0', 'Download all documents from 2024')
    .example('$0 -f 2023-01-01 -t 2023-12-31', 'Download documents from 2023')
    .example('$0 -o ./my-docs -c 5', 'Download to custom directory with 5 concurrent downloads')
    .argv;

let spinner;
let totalDownloaded = 0;
let failedDownloads = [];

async function main() {
    try {
        spinner = ora('Initializing DocuSign exporter...').start();

        const service = new DocusignService({
            environment: 'production',
            outputPath: argv.output,
            maxConcurrent: argv.concurrent
        });

        // Progress tracking
        service.on('searchStarted', ({ fromDate, toDate }) => {
            spinner.text = `Searching for documents from ${fromDate} to ${toDate}...`;
        });

        service.on('envelopesFound', ({ count, total }) => {
            spinner.succeed(`Found ${chalk.green(count)} new documents (Total: ${chalk.green(total)})`);
            spinner = ora('Starting downloads...').start();
        });

        service.on('downloadStarted', ({ envelopeId }) => {
            spinner.text = `Downloading document ${chalk.blue(envelopeId)}...`;
        });

        service.on('downloadComplete', ({ envelopeId, progress }) => {
            totalDownloaded++;
            spinner.text = `Progress: ${chalk.green(progress.toFixed(1))}% (${totalDownloaded} documents)`;
        });

        service.on('downloadError', ({ envelopeId, error }) => {
            failedDownloads.push({ envelopeId, error });
            spinner.warn(`Failed to download ${chalk.yellow(envelopeId)}: ${error}`);
        });

        service.on('retrying', ({ attempt, delay, error }) => {
            spinner.warn(`Retrying attempt ${attempt} after ${delay}ms due to: ${error}`);
        });

        service.on('tokenExpired', () => {
            spinner.fail('Authentication token has expired');
            console.log(chalk.yellow('\nTo get a new token:'));
            console.log('1. Go to apps.docusign.com and log in');
            console.log('2. Open Developer Tools (F12)');
            console.log('3. Go to Network tab');
            console.log('4. Find any request to /api/esign/');
            console.log('5. Copy the Bearer token from the authorization header');
            process.exit(1);
        });

        // Handle graceful shutdown
        process.on('SIGINT', () => {
            spinner.info('\nCancelling downloads...');
            service.cancel();
        });

        // Start the export process
        const envelopes = await service.getEnvelopesWebApi(argv.from, argv.to);

        if (envelopes.length === 0) {
            spinner.info('No documents found in the specified date range');
            return;
        }

        await service.downloadDocuments();

        if (failedDownloads.length > 0) {
            spinner.warn(`\nCompleted with ${chalk.yellow(failedDownloads.length)} failed downloads:`);
            failedDownloads.forEach(({ envelopeId, error }) => {
                console.log(`  ${chalk.yellow('•')} ${envelopeId}: ${error}`);
            });
        }

        spinner.succeed(`Downloaded ${chalk.green(totalDownloaded)} documents to ${chalk.blue(argv.output)}`);

    } catch (error) {
        spinner.fail('Error running DocuSign exporter');
        console.error(chalk.red('\nError details:'));
        console.error(error.message);
        if (error.response) {
            console.error('\nAPI Response:', {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data
            });
        }
        process.exit(1);
    }
}

main(); 