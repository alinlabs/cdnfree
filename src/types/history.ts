export interface HistoryEntry {
  id: string;
  url: string;
  displayUrl: string;
  host: string;
  title?: string;
  inspectedAt: string;
  status: 'completed' | 'failed';
}

export interface HistoryStorageSchemaV1 {
  version: 1;
  entries: HistoryEntry[];
}
