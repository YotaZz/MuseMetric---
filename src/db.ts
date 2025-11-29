import { set, get, del } from 'idb-keyval';

// Define the missing interface locally to satisfy TypeScript
interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

export type StoredFile = FileSystemFileHandle | File;

export const setFileHandle = async (songId: string, type: 'audio' | 'lrc', handle: StoredFile) => {
  await set(`${songId}_${type}`, handle);
};

export const getFileHandle = async (songId: string, type: 'audio' | 'lrc'): Promise<StoredFile | undefined> => {
  return await get(`${songId}_${type}`);
};

export const removeFileHandle = async (songId: string, type: 'audio' | 'lrc') => {
  await del(`${songId}_${type}`);
};

export const verifyPermission = async (handle: StoredFile, readWrite = false): Promise<boolean> => {
  // If it's a standard File object (fallback mode), permission is implicit
  if (handle instanceof File) {
      return true;
  }

  const options: FileSystemHandlePermissionDescriptor = {
    mode: readWrite ? 'readwrite' : 'read',
  };
  
  // Cast to any to access queryPermission and requestPermission which might be missing in some type definitions
  const h = handle as any;

  // Check if permission was already granted. If so, return true.
  try {
      if ((await h.queryPermission(options)) === 'granted') {
        return true;
      }
      // Request permission. If the user grants permission, return true.
      if ((await h.requestPermission(options)) === 'granted') {
        return true;
      }
  } catch (e) {
      console.warn("Permission check failed", e);
      return false;
  }
  // The user didn't grant permission, so return false.
  return false;
};