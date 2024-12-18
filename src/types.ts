export interface DocusignEvents {
  searchStarted: (data: { fromDate: string; toDate: string }) => void;
  envelopesFound: (data: { count: number; total: number }) => void;
  downloadStarted: (data: { envelopeId: string }) => void;
  downloadComplete: (data: { envelopeId: string; progress: number }) => void;
  downloadError: (data: { envelopeId: string; error: string }) => void;
  retrying: (data: { attempt: number; delay: number; error: string }) => void;
  tokenExpired: () => void;
  error: (error: Error) => void;
  allDownloadsComplete: (data: { total: number }) => void;
  cancelled: () => void;
}

declare interface DocusignService {
  on<K extends keyof DocusignEvents>(event: K, listener: DocusignEvents[K]): this;
  emit<K extends keyof DocusignEvents>(event: K, ...args: Parameters<DocusignEvents[K]>): boolean;
} 