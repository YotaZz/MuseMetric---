import { Song, Album, Singer, SongWithStats, AlbumWithStats } from './types';

export const generateId = () => Math.random().toString(36).substr(2, 9);

export const calculateSongTotal = (lyrics: number, composition: number, arrangement: number): number => {
  return (lyrics + composition + arrangement) / 3;
};

// Sorts songs by Total Score (Desc), then Composition (Desc)
export const sortSongsAlgorithm = (a: { totalScore: number, scores: { composition: number } }, b: { totalScore: number, scores: { composition: number } }) => {
  const diff = b.totalScore - a.totalScore;
  // If difference is negligible (float precision), use composition score as tie breaker
  if (Math.abs(diff) < 0.001) {
    return b.scores.composition - a.scores.composition;
  }
  return diff;
};

export const enrichSingerData = (singer: Singer) => {
  const albumsWithStats: AlbumWithStats[] = singer.albums.map(album => {
    const totalSongs = album.songs.length;
    let sumLyrics = 0, sumComp = 0, sumArr = 0, sumTotal = 0;

    album.songs.forEach(song => {
      sumLyrics += song.scores.lyrics;
      sumComp += song.scores.composition;
      sumArr += song.scores.arrangement;
      sumTotal += calculateSongTotal(song.scores.lyrics, song.scores.composition, song.scores.arrangement);
    });

    return {
      ...album,
      averageLyrics: totalSongs ? sumLyrics / totalSongs : 0,
      averageComposition: totalSongs ? sumComp / totalSongs : 0,
      averageArrangement: totalSongs ? sumArr / totalSongs : 0,
      averageTotal: totalSongs ? sumTotal / totalSongs : 0,
    };
  });

  const allSongs: SongWithStats[] = singer.albums.flatMap(album => 
    album.songs.map(song => ({
      ...song,
      totalScore: calculateSongTotal(song.scores.lyrics, song.scores.composition, song.scores.arrangement),
      albumId: album.id,
      albumName: album.title,
      albumYear: album.year,
      albumCover: album.coverUrl,
    }))
  );

  return { albumsWithStats, allSongs };
};

export const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
};

// --- New Robust Data & Presentation Utilities ---

/**
 * Ensures imported JSON data adheres to strict structure, providing defaults for missing fields
 * and handling case-sensitivity or pluralization issues.
 */
export const sanitizeSingerImport = (data: any[]): Singer[] => {
  if (!Array.isArray(data)) return [];
  
  return data.map((singer: any) => ({
    id: singer.id || generateId(),
    name: singer.name || 'Unknown Singer',
    albums: Array.isArray(singer.albums) ? singer.albums.map((album: any) => ({
      id: album.id || generateId(),
      title: album.title || 'Untitled Album',
      year: album.year || 'Unknown Year',
      coverUrl: album.coverUrl,
      songs: Array.isArray(album.songs) ? album.songs.map((song: any) => {
        // Compatibility: handle 'score' vs 'scores'
        const rawScores = song.scores || song.score || {};
        
        // Compatibility: handle Case Sensitivity (lyrics vs Lyrics) & Parsing
        const parseScore = (val: any) => {
            const num = parseFloat(val);
            return isNaN(num) ? 0 : num;
        };

        const scores = {
          lyrics: parseScore(rawScores.lyrics ?? rawScores.Lyrics),
          composition: parseScore(rawScores.composition ?? rawScores.Composition),
          arrangement: parseScore(rawScores.arrangement ?? rawScores.Arrangement),
        };

        return {
          id: song.id || generateId(),
          title: song.title || 'Untitled Song',
          comment: song.comment || '',
          scores: scores,
          hasAudio: song.hasAudio,
          hasLrc: song.hasLrc,
          highlightStartTime: song.highlightStartTime
        };
      }) : []
    })) : []
  }));
};

export interface PresentationSong extends SongWithStats {
    rank: number;
}

/**
 * Prepares songs for video presentation:
 * 1. Calculates all stats.
 * 2. Assigns ranks based on Descending Score (Rank #1 is highest).
 * 3. Returns array Sorted Ascending (Lowest Rank Number first? No, Lowest Score first).
 *    Goal: Countdown effect. Play #100, then #99... then #1.
 *    So we need to sort such that the song with the lowest score (highest rank number) is first.
 */
export const getPresentationSongs = (singer: Singer): PresentationSong[] => {
    const { allSongs } = enrichSingerData(singer);

    // 1. Sort Descending to assign proper Ranks (#1 = Best)
    const sortedByRank = [...allSongs].sort(sortSongsAlgorithm);

    // 2. Map to add Rank property
    const songsWithRank = sortedByRank.map((s, idx) => ({
        ...s,
        rank: idx + 1
    }));

    // 3. Reverse to get Ascending order (Worst -> Best) for the "Countdown" reveal
    return songsWithRank.reverse();
};

export interface LrcLine {
    time: number; // Seconds
    text: string;
}

export const parseLrc = (lrcContent: string): LrcLine[] => {
    const lines = lrcContent.split('\n');
    const regex = /^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;
    const lrcData: LrcLine[] = [];

    lines.forEach(line => {
        const match = line.match(regex);
        if (match) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const milliseconds = parseInt(match[3], 10);
            const text = match[4].trim();
            // Convert to seconds. ms can be 2 or 3 digits
            const time = minutes * 60 + seconds + milliseconds / (match[3].length === 3 ? 1000 : 100);
            if (text) {
                lrcData.push({ time, text });
            }
        }
    });

    return lrcData.sort((a, b) => a.time - b.time);
};