import { Song } from './types';
import { setFileHandle } from './db';

// Helper to normalize string for fuzzy matching
// Removes extensions, leading numbers (track numbers), special chars, and lowercases
const normalize = (str: string) => {
    // Remove extension
    let s = str.substring(0, str.lastIndexOf('.')) || str;
    // Remove leading numbers (e.g., "01. ", "1 - ", "01 ")
    s = s.replace(/^[\d\s.\-]+/, '');
    return s.toLowerCase().replace(/\s+/g, '');
};

const normalizeTitle = (str: string) => {
    return str.toLowerCase().replace(/\s+/g, '');
};

export interface MatchingResult {
    updatedSongs: Song[];
    matchedAudioCount: number;
    matchedLrcCount: number;
}

const matchAndPersist = async (
    file: File | FileSystemFileHandle, 
    fileName: string, 
    songs: Song[], 
    matchedSongsMap: Map<string, Partial<Song>>,
    counters: { audio: number, lrc: number },
    onProgress?: (msg: string) => void
) => {
    const isAudio = /\.(mp3|flac|wav|m4a|ogg|aac)$/i.test(fileName);
    const isLrc = /\.lrc$/i.test(fileName);

    if (!isAudio && !isLrc) return;

    const normalizedFileName = normalize(fileName);

    // Find matching song
    // Logic: Filename contains Song Title OR Song Title contains Filename (less likely for short filenames)
    const matchedSong = songs.find(song => {
        const nTitle = normalizeTitle(song.title);
        // Strict inclusion check after normalization
        return normalizedFileName.includes(nTitle) && nTitle.length > 0;
    });

    if (matchedSong) {
        const type = isAudio ? 'audio' : 'lrc';
        
        // Persist handle
        try {
            await setFileHandle(matchedSong.id, type, file);
            
            // Track update
            const existingUpdate = matchedSongsMap.get(matchedSong.id) || {};
            if (isAudio) {
                existingUpdate.hasAudio = true;
                counters.audio++;
            }
            if (isLrc) {
                existingUpdate.hasLrc = true;
                counters.lrc++;
            }
            matchedSongsMap.set(matchedSong.id, existingUpdate);

            if (onProgress) onProgress(`已匹配: ${fileName} -> ${matchedSong.title}`);
        } catch (e) {
            console.error("Error saving file handle", e);
        }
    }
};

export const scanAndMatchDirectory = async (songs: Song[], dirHandle: FileSystemDirectoryHandle, onProgress?: (msg: string) => void): Promise<MatchingResult> => {
    const matchedSongsMap = new Map<string, Partial<Song>>();
    const counters = { audio: 0, lrc: 0 };

    // Helper to recursively scan directories
    async function scanDirectory(directory: FileSystemDirectoryHandle) {
        for await (const entry of directory.values()) {
            if (entry.kind === 'file') {
                await matchAndPersist(entry as FileSystemFileHandle, entry.name, songs, matchedSongsMap, counters, onProgress);
            } else if (entry.kind === 'directory') {
                await scanDirectory(entry as FileSystemDirectoryHandle);
            }
        }
    }

    await scanDirectory(dirHandle);

    return {
        updatedSongs: songs.map(song => {
            const updates = matchedSongsMap.get(song.id);
            if (updates) {
                return { ...song, ...updates };
            }
            return song;
        }),
        matchedAudioCount: counters.audio,
        matchedLrcCount: counters.lrc
    };
};

export const scanAndMatchFileList = async (songs: Song[], fileList: FileList, onProgress?: (msg: string) => void): Promise<MatchingResult> => {
    const matchedSongsMap = new Map<string, Partial<Song>>();
    const counters = { audio: 0, lrc: 0 };

    for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        await matchAndPersist(file, file.name, songs, matchedSongsMap, counters, onProgress);
    }

    return {
        updatedSongs: songs.map(song => {
            const updates = matchedSongsMap.get(song.id);
            if (updates) {
                return { ...song, ...updates };
            }
            return song;
        }),
        matchedAudioCount: counters.audio,
        matchedLrcCount: counters.lrc
    };
};