import { set, get, del } from 'idb-keyval';

// Define the missing interface locally to satisfy TypeScript
interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

export const setFileHandle = async (songId: string, type: 'audio' | 'lrc', handle: FileSystemFileHandle) => {
  await set(`${songId}_${type}`, handle);
};

export const getFileHandle = async (songId: string, type: 'audio' | 'lrc'): Promise<FileSystemFileHandle | undefined> => {
  return await get(`${songId}_${type}`);
};

export const removeFileHandle = async (songId: string, type: 'audio' | 'lrc') => {
  await del(`${songId}_${type}`);
};

export const verifyPermission = async (handle: FileSystemFileHandle, readWrite = false): Promise<boolean> => {
  const options: FileSystemHandlePermissionDescriptor = {
    mode: readWrite ? 'readwrite' : 'read',
  };
  
  // Cast to any to access queryPermission and requestPermission which might be missing in some type definitions
  const h = handle as any;

  // Check if permission was already granted. If so, return true.
  if ((await h.queryPermission(options)) === 'granted') {
    return true;
  }
  // Request permission. If the user grants permission, return true.
  if ((await h.requestPermission(options)) === 'granted') {
    return true;
  }
  // The user didn't grant permission, so return false.
  return false;
};