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
      // Ensure scores exist to prevent crashes
      const lyrics = song.scores?.lyrics || 0;
      const composition = song.scores?.composition || 0;
      const arrangement = song.scores?.arrangement || 0;
      
      sumLyrics += lyrics;
      sumComp += composition;
      sumArr += arrangement;
      sumTotal += calculateSongTotal(lyrics, composition, arrangement);
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
      // Ensure scores exist
      scores: song.scores || { lyrics: 0, composition: 0, arrangement: 0 },
      totalScore: calculateSongTotal(song.scores?.lyrics || 0, song.scores?.composition || 0, song.scores?.arrangement || 0),
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

export const sanitizeSingerData = (data: any[]): Singer[] => {
  if (!Array.isArray(data)) return [];

  return data.map((singer: any) => ({
    id: String(singer.id || generateId()),
    name: String(singer.name || '未命名歌手'),
    albums: Array.isArray(singer.albums) ? singer.albums.map((album: any) => ({
      id: String(album.id || generateId()),
      title: String(album.title || '未命名专辑'),
      year: String(album.year || ''),
      coverUrl: album.coverUrl,
      songs: Array.isArray(album.songs) ? album.songs.map((song: any) => ({
        id: String(song.id || generateId()),
        title: String(song.title || '未命名歌曲'),
        scores: {
          lyrics: Number(song.scores?.lyrics || 0),
          composition: Number(song.scores?.composition || 0),
          arrangement: Number(song.scores?.arrangement || 0),
        }
      })) : []
    })) : []
  }));
};