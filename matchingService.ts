import { Song } from './types';
import { setFileHandle } from './db';

// Helper to normalize string for fuzzy matching
// Removes extensions, leading numbers (track numbers), special chars, and lowercases
const normalize = (str: string) => {
    // Remove extension
    let s = str.substring(0, str.lastIndexOf('.')) || str;
    // Remove leading numbers (e.g., "01. ", "1 - ", "01 ")
    s = s.replace(/^[\d\s.\-]+/, '');
    // Remove content in brackets usually associated with metadata not in title
    // s = s.replace(/\s*[\(\[].*?[\)\]]/g, ''); 
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

export const scanAndMatchDirectory = async (songs: Song[], dirHandle: FileSystemDirectoryHandle, onProgress?: (msg: string) => void): Promise<MatchingResult> => {
    const matchedSongsMap = new Map<string, Partial<Song>>(); // songId -> updates
    let matchedAudioCount = 0;
    let matchedLrcCount = 0;

    // Helper to recursively scan directories
    async function scanDirectory(directory: FileSystemDirectoryHandle) {
        for await (const entry of directory.values()) {
            if (entry.kind === 'file') {
                await processFile(entry as FileSystemFileHandle);
            } else if (entry.kind === 'directory') {
                await scanDirectory(entry as FileSystemDirectoryHandle);
            }
        }
    }

    async function processFile(fileHandle: FileSystemFileHandle) {
        const name = fileHandle.name;
        
        const isAudio = /\.(mp3|flac|wav|m4a|ogg|aac)$/i.test(name);
        const isLrc = /\.lrc$/i.test(name);

        if (!isAudio && !isLrc) return;

        const normalizedFileName = normalize(name);

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
                await setFileHandle(matchedSong.id, type, fileHandle);
                
                // Track update
                const existingUpdate = matchedSongsMap.get(matchedSong.id) || {};
                if (isAudio) {
                    existingUpdate.hasAudio = true;
                    matchedAudioCount++;
                }
                if (isLrc) {
                    existingUpdate.hasLrc = true;
                    matchedLrcCount++;
                }
                matchedSongsMap.set(matchedSong.id, existingUpdate);

                if (onProgress) onProgress(`已匹配: ${name} -> ${matchedSong.title}`);
            } catch (e) {
                console.error("Error saving file handle", e);
            }
        }
    }

    await scanDirectory(dirHandle);

    // Merge updates into song list
    // Note: We need to traverse the structure properly, but this function receives a flat list of ALL songs usually? 
    // Wait, the input `songs` in the app is strictly structured inside Albums. 
    // The caller needs to pass a flattened list or we iterate the structure in the caller.
    // Let's assume the caller will handle the state update logic based on ID. 
    // But to make it easier, let's return a map of updates or assume the input is flat for matching but we need to update the Singer object in the end.
    
    // Actually, `scanAndMatchDirectory` just returns the statistics and updates the DB.
    // We should return a list of IDs and what changed, so the View can update the Singer state.
    
    // Let's return the full list of songs with updates applied (assuming input was flat list of all songs in the Singer).
    // The DataEntryView uses `singer.albums`, so we have to update that structure.
    
    return {
        updatedSongs: songs.map(song => {
            const updates = matchedSongsMap.get(song.id);
            if (updates) {
                return { ...song, ...updates };
            }
            return song;
        }),
        matchedAudioCount,
        matchedLrcCount
    };
};