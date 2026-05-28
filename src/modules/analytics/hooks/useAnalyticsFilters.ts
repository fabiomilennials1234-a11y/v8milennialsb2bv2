import { useCallback } from "react";
import { usePersistedState } from "@/hooks/usePersistedState";
import {
  startOfDay,
  endOfDay,
  subDays,
  differenceInDays,
  format,
} from "date-fns";

export type DatePreset = "hoje" | "7d" | "14d" | "30d" | "90d" | "custom";

export interface AnalyticsFilters {
  startDate: string;
  endDate: string;
  preset: DatePreset;
  compareEnabled: boolean;
  compareStartDate: string;
  compareEndDate: string;
  memberId: string | null;
  origin: string | null;
}

export function getPresetDates(preset: DatePreset): { start: Date; end: Date } {
  const now = new Date();
  const end = endOfDay(now);
  switch (preset) {
    case "hoje":
      return { start: startOfDay(now), end };
    case "7d":
      return { start: startOfDay(subDays(now, 6)), end };
    case "14d":
      return { start: startOfDay(subDays(now, 13)), end };
    case "30d":
      return { start: startOfDay(subDays(now, 29)), end };
    case "90d":
      return { start: startOfDay(subDays(now, 89)), end };
    default:
      return { start: startOfDay(subDays(now, 29)), end };
  }
}

export function getComparisonDates(start: Date, end: Date): { start: Date; end: Date } {
  const days = differenceInDays(end, start) + 1;
  const compEnd = startOfDay(subDays(start, 1));
  const compStart = startOfDay(subDays(compEnd, days - 1));
  return { start: compStart, end: endOfDay(compEnd) };
}

const defaultPreset: DatePreset = "30d";
const defaultDates = getPresetDates(defaultPreset);

const DEFAULT_FILTERS: AnalyticsFilters = {
  startDate: defaultDates.start.toISOString(),
  endDate: defaultDates.end.toISOString(),
  preset: defaultPreset,
  compareEnabled: false,
  compareStartDate: "",
  compareEndDate: "",
  memberId: null,
  origin: null,
};

export function useAnalyticsFilters() {
  const [filters, setFilters, clearFilters] = usePersistedState<AnalyticsFilters>(
    "analytics-filters",
    DEFAULT_FILTERS,
  );

  const setPreset = useCallback(
    (preset: DatePreset) => {
      const dates = getPresetDates(preset);
      const comp = getComparisonDates(dates.start, dates.end);
      setFilters((prev) => ({
        ...prev,
        preset,
        startDate: dates.start.toISOString(),
        endDate: dates.end.toISOString(),
        compareStartDate: comp.start.toISOString(),
        compareEndDate: comp.end.toISOString(),
      }));
    },
    [setFilters],
  );

  const setCustomRange = useCallback(
    (start: Date, end: Date) => {
      const comp = getComparisonDates(start, end);
      setFilters((prev) => ({
        ...prev,
        preset: "custom" as DatePreset,
        startDate: startOfDay(start).toISOString(),
        endDate: endOfDay(end).toISOString(),
        compareStartDate: comp.start.toISOString(),
        compareEndDate: comp.end.toISOString(),
      }));
    },
    [setFilters],
  );

  const toggleCompare = useCallback(() => {
    setFilters((prev) => {
      if (!prev.compareEnabled) {
        const start = new Date(prev.startDate);
        const end = new Date(prev.endDate);
        const comp = getComparisonDates(start, end);
        return {
          ...prev,
          compareEnabled: true,
          compareStartDate: comp.start.toISOString(),
          compareEndDate: comp.end.toISOString(),
        };
      }
      return { ...prev, compareEnabled: false };
    });
  }, [setFilters]);

  const setMemberId = useCallback(
    (id: string | null) => setFilters((prev) => ({ ...prev, memberId: id })),
    [setFilters],
  );

  const setOrigin = useCallback(
    (origin: string | null) => setFilters((prev) => ({ ...prev, origin })),
    [setFilters],
  );

  const startStr = format(new Date(filters.startDate), "yyyy-MM-dd");
  const endStr = format(new Date(filters.endDate), "yyyy-MM-dd");
  const compareStartStr = filters.compareStartDate
    ? format(new Date(filters.compareStartDate), "yyyy-MM-dd")
    : null;
  const compareEndStr = filters.compareEndDate
    ? format(new Date(filters.compareEndDate), "yyyy-MM-dd")
    : null;

  return {
    filters,
    startStr,
    endStr,
    compareStartStr,
    compareEndStr,
    setPreset,
    setCustomRange,
    toggleCompare,
    setMemberId,
    setOrigin,
    clearFilters,
  };
}
