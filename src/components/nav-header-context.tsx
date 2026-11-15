import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { MediaBookmarkKind } from '../types/bookmark';

export type MarkahKindFilter = 'all' | MediaBookmarkKind;
export type HistorySortOrder = 'newest' | 'oldest' | 'host';

export interface MarkahHeaderControls {
  query: string;
  onQueryChange: (value: string) => void;
  kindFilter: MarkahKindFilter;
  onKindFilterChange: (value: MarkahKindFilter) => void;
  totalCount: number;
  imageCount: number;
  videoCount: number;
  filteredCount: number;
  onExportJson: () => void;
  onOpenImportModal: () => void;
  onRequestClearAll: () => void;
}

export interface HistoryHeaderControls {
  query: string;
  onQueryChange: (value: string) => void;
  sortOrder: HistorySortOrder;
  onSortOrderChange: (value: HistorySortOrder) => void;
  totalCount: number;
  filteredCount: number;
  onRequestClearAll: () => void;
}

interface NavHeaderContextValue {
  markahControls: MarkahHeaderControls | null;
  setMarkahControls: (controls: MarkahHeaderControls | null) => void;
  historyControls: HistoryHeaderControls | null;
  setHistoryControls: (controls: HistoryHeaderControls | null) => void;
}

const NavHeaderContext = createContext<NavHeaderContextValue | null>(null);

export function NavHeaderProvider({ children }: { children: ReactNode }) {
  const [markahControls, setMarkahControls] =
    useState<MarkahHeaderControls | null>(null);
  const [historyControls, setHistoryControls] =
    useState<HistoryHeaderControls | null>(null);

  const value = useMemo(
    () => ({
      markahControls,
      setMarkahControls,
      historyControls,
      setHistoryControls,
    }),
    [markahControls, historyControls],
  );

  return (
    <NavHeaderContext.Provider value={value}>
      {children}
    </NavHeaderContext.Provider>
  );
}

export function useNavHeaderContext(): NavHeaderContextValue {
  const ctx = useContext(NavHeaderContext);
  if (!ctx) {
    throw new Error(
      'useNavHeaderContext harus digunakan di dalam NavHeaderProvider',
    );
  }
  return ctx;
}
