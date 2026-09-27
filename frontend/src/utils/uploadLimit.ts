// The upload size limit set in the admin panel, checked before sending a file.

const MIB = 1024 * 1024;

/** Whether a file is larger than the limit (no limit known: never). */
export function exceedsUploadLimit(file: Blob, maxUploadMb: number | null): boolean {
  return maxUploadMb !== null && file.size > maxUploadMb * MIB;
}

/** A file size in MB with one decimal, for messages. */
export function sizeInMb(file: Blob): string {
  return (file.size / MIB).toFixed(1);
}
