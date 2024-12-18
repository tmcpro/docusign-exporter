#!/usr/bin/env node

import { DocusignService } from './index';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import ora from 'ora';
import chalk from 'chalk';
import 'dotenv/config';
import { AxiosError, isAxiosError } from 'axios';

interface CliArguments {
  from: string;
  to: string;
  output: string;
  concurrent: number;
  rateLimit: number;
  retryAttempts: number;
  retryDelay: number;
}

const argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 [options]')
  .options({
    from: {
      alias: 'f',
      describe: 'Start date (YYYY-MM-DD)',
      default: '2024-01-01',
      type: 'string',
    },
    to: {
      alias: 't',
      describe: 'End date (YYYY-MM-DD)',
      default: new Date().toISOString().split('T')[0],
      type: 'string',
    },
    output: {
      alias: 'o',
      describe: 'Output directory',
      default: './downloads',
      type: 'string',
    },
    concurrent: {
      alias: 'c',
      describe: 'Number of concurrent downloads (max 5)',
      default: 3,
      type: 'number',
    },
    rateLimit: {
      alias: 'r',
      describe: 'Rate limit (requests per second)',
      default: 5,
      type: 'number',
    },
    retryAttempts: {
      describe: 'Number of retry attempts for failed requests',
      default: 3,
      type: 'number',
    },
    retryDelay: {
      describe: 'Initial retry delay in milliseconds',
      default: 1000,
      type: 'number',
    },
  })
  .check((argv) => {
    const fromDate = new Date(argv.from);
    const toDate = new Date(argv.to);
    
    if (isNaN(fromDate.getTime())) {
      throw new Error('Invalid from date format. Use YYYY-MM-DD');
    }
    if (isNaN(toDate.getTime())) {
      throw new Error('Invalid to date format. Use YYYY-MM-DD');
    }
    if (fromDate > toDate) {
      throw new Error('From date must be before or equal to to date');
    }
    if (argv.concurrent < 1 || argv.concurrent > 5) {
      throw new Error('Concurrent downloads must be between 1 and 5');
    }
    if (argv.rateLimit < 1) {
      throw new Error('Rate limit must be at least 1 request per second');
    }
    return true;
  })
  .example('$0', 'Download all documents from 2024')
  .example('$0 -f 2023-01-01 -t 2023-12-31', 'Download documents from 2023')
  .example('$0 -o ./my-docs -c 5', 'Download to custom directory with 5 concurrent downloads')
  .example('$0 -r 2', 'Limit to 2 requests per second')
  .parseSync() as CliArguments;

let spinner: ora.Ora;
let totalDownloaded = 0;
const failedDownloads: Array<{ envelopeId: string; error: string }> = [];

async function main() {
  try {
    spinner = ora('Initializing DocuSign exporter...').start();

    const service = new DocusignService({
      environment: 'production',
      outputPath: argv.output,
      maxConcurrent: argv.concurrent,
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
  } catch (err) {
    spinner.fail('Error running DocuSign exporter');
    console.error(chalk.red('\nError details:'));

    if (err instanceof Error) {
      console.error(err.message);
    }

    if (isAxiosError(err)) {
      const error = err as AxiosError;
      if (error.response) {
        console.error('\nAPI Response:', {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data,
        });
      }
    }

    process.exit(1);
  }
}

process.on('unhandledRejection', (err: unknown) => {
  const error = err as Error;
  console.error('Unhandled rejection:', error.message || String(err));
  process.exit(1);
});

main(); 