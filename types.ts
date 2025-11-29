export interface Score {
  lyrics: number;
  composition: number;
  arrangement: number;
}

export interface Song {
  id: string;
  title: string;
  comment?: string; // Max 20 chars
  scores: Score;
  hasAudio?: boolean; // New: Local audio file linked
  hasLrc?: boolean;   // New: Local lrc file linked
  highlightStartTime?: number; // New: Start time for playback (seconds)
}

export interface Album {
  id: string;
  title: string;
  year: string;
  coverUrl?: string; // Base64 string
  songs: Song[];
}

export interface Singer {
  id: string;
  name: string;
  albums: Album[];
}

export type ViewMode = 'entry' | 'dashboard' | 'presentation';

// Helper types for analytics
export interface SongWithStats extends Song {
  totalScore: number;
  albumId: string;
  albumName: string;
  albumYear: string;
  albumCover?: string;
}

export interface AlbumWithStats extends Album {
  averageTotal: number;
  averageLyrics: number;
  averageComposition: number;
  averageArrangement: number;
}