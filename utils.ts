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