import { useAppStore } from "@app/store/use-app-store";
import type { AppSettings, DateRangePreset } from "types/domain";

export function normalizeCharacterLabel(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

export function extractCharacterAccountIdsFromRawPayload(rawPayloadJson: string): Set<string> {
  if (!rawPayloadJson.trim()) {
    return new Set<string>();
  }
  const normalizedIds = new Set<string>();
  const idMatches = rawPayloadJson.match(/ch_[A-Za-z0-9]+/g) ?? [];
  for (const idMatch of idMatches) {
    normalizedIds.add(idMatch.toLowerCase());
  }
  return normalizedIds;
}

export function isZipReadyRow(row: { is_downloadable: boolean; video_id: string }): boolean {
  return Boolean(row.is_downloadable && row.video_id);
}

export function isFetchRangeConfigured(
  dateRangePreset: DateRangePreset,
  customDateStart: string,
  customDateEnd: string
): boolean {
  if (dateRangePreset !== "custom") {
    return true;
  }
  const parsedStart = parseDateInput(customDateStart);
  const parsedEnd = parseDateInput(customDateEnd);
  if (!parsedStart || !parsedEnd) {
    return false;
  }
  return parsedStart.getTime() <= parsedEnd.getTime();
}

export function normalizeRememberedDatePreset(settings: AppSettings): DateRangePreset {
  const preset = settings.remembered_date_range_preset;
  if (
    preset === "24h" ||
    preset === "7d" ||
    preset === "1m" ||
    preset === "3m" ||
    preset === "all" ||
    preset === "custom"
  ) {
    return preset;
  }
  return "all";
}

export function parseDateInput(value: string): Date | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDateInput(value: Date | null): string {
  if (!value) {
    return "";
  }
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase();
}

export async function waitForFetchToStop(timeoutMs = 10000): Promise<boolean> {
  const startedAtMs = Date.now();
  while (Date.now() - startedAtMs < timeoutMs) {
    if (useAppStore.getState().phase !== "fetching") {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return useAppStore.getState().phase !== "fetching";
}
