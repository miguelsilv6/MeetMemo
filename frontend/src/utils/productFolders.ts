// The audios of a chosen folder and their call records: an intercepted
// audio sits in the product folder's __CLIENT__ folder, with the product's
// TranslatedPRI.xml one level up. A folder with several product folders
// gives one entry per audio.

export const CALL_RECORD_NAME = 'TranslatedPRI.xml';
const AUDIO_EXTENSION = /\.(mp3|wav|m4a|webm|ogg|flac|aac)$/i;
const CLIENT_FOLDER = '__CLIENT__';

export interface ProductFiles {
  audio: File;
  /** The product's TranslatedPRI.xml, if the folder has one. */
  callRecord: File | null;
  /** The product folder, as the browser names it ("Casos/2414"). */
  folder: string;
}

/** The file's path within the chosen folder (its name when not chosen as a folder). */
export function relativePath(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

function lastPart(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * Each audio of the chosen files with its call record: the TranslatedPRI.xml
 * of the folder above its own (the product folder, above __CLIENT__), or of its
 * own folder. Only the audios in __CLIENT__ folders count when there are any
 * (other folders hold the raw data).
 */
export function findProducts(files: File[]): ProductFiles[] {
  const records = new Map<string, File>();
  for (const file of files) {
    if (file.name.toLowerCase() === CALL_RECORD_NAME.toLowerCase()) {
      records.set(parentOf(relativePath(file)), file);
    }
  }
  const audios = files.filter((file) => AUDIO_EXTENSION.test(file.name));
  const inClient = audios.filter(
    (file) => lastPart(parentOf(relativePath(file))).toUpperCase() === CLIENT_FOLDER
  );
  return (inClient.length > 0 ? inClient : audios)
    .map((audio) => {
      const folder = parentOf(relativePath(audio));
      const product = lastPart(folder).toUpperCase() === CLIENT_FOLDER ? parentOf(folder) : folder;
      return {
        audio,
        callRecord: records.get(product) ?? records.get(folder) ?? null,
        folder: product,
      };
    })
    .sort((a, b) => relativePath(a.audio).localeCompare(relativePath(b.audio)));
}
