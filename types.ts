export interface Score {
  lyrics: number;
  composition: number;
  arrangement: number;
}

export interface Song {
  id: string;
  title: string;
  scores: Score;
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

export type ViewMode = 'entry' | 'dashboard';

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