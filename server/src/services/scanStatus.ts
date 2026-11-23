/**
 * Son zamanlanmis taramanin durumu (bellekte). Health ucu okur, scheduler yazar.
 * Sunucu yeniden basladiginda null'dir ("henuz tarama yok") - bu normaldir.
 */
export type LastScan = { at: string; ok: boolean; durationMs: number };

let lastScan: LastScan | null = null;

export function getLastScan(): LastScan | null {
  return lastScan;
}

export function setLastScan(value: LastScan | null): void {
  lastScan = value;
}
