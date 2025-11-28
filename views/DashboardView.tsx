import React, { useMemo, useState } from 'react';
import { Singer, SongWithStats } from '../types';
import { enrichSingerData, sortSongsAlgorithm, calculateSongTotal } from '../utils';
import { Card, Modal, Input } from '../components/UI';
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

interface DashboardViewProps {
  singer: Singer;
  onUpdateSinger: (updatedSinger: Singer) => void;
}

type SortKey = 'title' | 'album' | 'lyrics' | 'composition' | 'arrangement' | 'total';
interface SortConfig {
  key: SortKey;
  direction: 'asc' | 'desc';
}

// Helper to include rank in song data
interface SongWithRank extends SongWithStats {
    rank: number;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ singer, onUpdateSinger }) => {
  const { albumsWithStats, allSongs } = useMemo(() => enrichSingerData(singer), [singer]);
  const [selectedAlbumIdForRadar, setSelectedAlbumIdForRadar] = useState<string>(albumsWithStats[0]?.id || '');
  const [activeTab, setActiveTab] = useState<'overview' | 'songs' | 'albums'>('overview');
  
  // Sorting State for Songs Tab
  const [songSortConfig, setSongSortConfig] = useState<SortConfig>({ key: 'total', direction: 'desc' });
  
  // Album Detail Modal
  const [selectedAlbumForDetail, setSelectedAlbumForDetail] = useState<string | null>(null);

  // Calculate Ranks and enrich data
  const songsWithRank: SongWithRank[] = useMemo(() => {
     // Sort by total score (desc) to assign ranks
     const sortedByScore = [...allSongs].sort(sortSongsAlgorithm);
     return allSongs.map(song => {
         const rank = sortedByScore.findIndex(s => s.id === song.id) + 1;
         return { ...song, rank };
     });
  }, [allSongs]);

  // Sorting Logic Helper
  const sortData = (data: SongWithRank[], config: SortConfig) => {
    return [...data].sort((a, b) => {
      let valA: any = '';
      let valB: any = '';

      // Value extraction
      switch (config.key) {
        case 'title': valA = a.title; valB = b.title; break;
        case 'album': valA = a.albumYear; valB = b.albumYear; break; // Sort by year for album context
        case 'lyrics': valA = a.scores.lyrics; valB = b.scores.lyrics; break;
        case 'composition': valA = a.scores.composition; valB = b.scores.composition; break;
        case 'arrangement': valA = a.scores.arrangement; valB = b.scores.arrangement; break;
        case 'total': valA = a.totalScore; valB = b.totalScore; break;
      }

      // 1. Primary Sort
      let comparison = 0;
      const isNumeric = typeof valA === 'number';
      
      if (isNumeric) {
         if (Math.abs(valA - valB) > 0.001) {
             comparison = valA - valB;
         }
      } else {
         if (valA < valB) comparison = -1;
         else if (valA > valB) comparison = 1;
      }

      if (comparison !== 0) {
          return config.direction === 'asc' ? comparison : -comparison;
      }

      // 2. Tie-Breaker: Composition (Only if sorting by Total)
      if (config.key === 'total') {
          const compDiff = a.scores.composition - b.scores.composition;
          if (Math.abs(compDiff) > 0.001) {
              return config.direction === 'asc' ? compDiff : -compDiff;
          }
      }

      // 3. Final Tie-Breaker: Rank
      // This ensures that for identical primary values (and identical composition if total), 
      // the order is deterministic and reverses correctly.
      // Rank 1 is "Best". Rank 100 is "Worst".
      // Ascending (Worst first): Rank 100 should be before Rank 1. (b.rank - a.rank > 0 -> b comes first).
      // Descending (Best first): Rank 1 should be before Rank 100. (a.rank - b.rank < 0 -> a comes first).
      return config.direction === 'asc' ? b.rank - a.rank : a.rank - b.rank;
    });
  };

  const sortedSongs = useMemo(() => sortData(songsWithRank, songSortConfig), [songsWithRank, songSortConfig]);
  const sortedAlbums = useMemo(() => [...albumsWithStats].sort((a, b) => b.averageTotal - a.averageTotal), [albumsWithStats]);

  const handleSort = (key: SortKey) => {
    setSongSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const getSortIcon = (key: SortKey) => {
    if (songSortConfig.key !== key) return <span className="text-slate-300 ml-1">⇅</span>;
    return songSortConfig.direction === 'asc' ? <span className="ml-1 text-indigo-500">↑</span> : <span className="ml-1 text-indigo-500">↓</span>;
  };

  // Score Update Handler (Reused from DataEntry, but for Dashboard)
  const handleUpdateScore = (albumId: string, songId: string, field: 'lyrics' | 'composition' | 'arrangement', value: string) => {
    const numValue = Math.min(10, Math.max(0, parseFloat(value) || 0));
    const updatedAlbums = singer.albums.map(album => {
      if (album.id !== albumId) return album;
      return {
        ...album,
        songs: album.songs.map(song => {
          if (song.id !== songId) return song;
          return {
            ...song,
            scores: {
              ...song.scores,
              [field]: numValue
            }
          };
        })
      };
    });
    onUpdateSinger({ ...singer, albums: updatedAlbums });
  };

  // Chart Data
  const careerData = useMemo(() => {
    return [...albumsWithStats]
      .sort((a, b) => parseInt(a.year) - parseInt(b.year))
      .map(album => ({
        name: album.title,
        year: album.year,
        score: parseFloat(album.averageTotal.toFixed(2))
      }));
  }, [albumsWithStats]);

  const radarData = useMemo(() => {
    const album = albumsWithStats.find(a => a.id === selectedAlbumIdForRadar);
    if (!album) return [];
    return [
      { subject: '作词', A: parseFloat(album.averageLyrics.toFixed(1)), fullMark: 10 },
      { subject: '作曲', A: parseFloat(album.averageComposition.toFixed(1)), fullMark: 10 },
      { subject: '编曲', A: parseFloat(album.averageArrangement.toFixed(1)), fullMark: 10 },
    ];
  }, [albumsWithStats, selectedAlbumIdForRadar]);

  if (albumsWithStats.length === 0) {
      return <div className="p-10 text-center text-slate-500">暂无数据，请先在“数据录入”页面添加专辑和打分。</div>
  }

  // Helper for Song Table
  const SongTable = ({ songs, showAlbum = true }: { songs: SongWithRank[], showAlbum?: boolean }) => (
    <div className="overflow-x-auto">
        <table className="min-w-full text-sm text-left">
            <thead className="bg-slate-50 text-slate-500 font-medium select-none">
                <tr>
                    <th className="px-4 py-3 w-12 text-center whitespace-nowrap">排名</th>
                    <th className="px-4 py-3 cursor-pointer hover:bg-slate-100 min-w-[120px]" onClick={() => handleSort('title')}>歌曲 {getSortIcon('title')}</th>
                    {showAlbum && <th className="px-4 py-3 cursor-pointer hover:bg-slate-100 whitespace-nowrap" onClick={() => handleSort('album')}>专辑 {getSortIcon('album')}</th>}
                    <th className="px-2 py-3 w-20 text-center cursor-pointer hover:bg-slate-100 whitespace-nowrap" onClick={() => handleSort('lyrics')}>作词 {getSortIcon('lyrics')}</th>
                    <th className="px-2 py-3 w-20 text-center cursor-pointer hover:bg-slate-100 whitespace-nowrap" onClick={() => handleSort('composition')}>作曲 {getSortIcon('composition')}</th>
                    <th className="px-2 py-3 w-20 text-center cursor-pointer hover:bg-slate-100 whitespace-nowrap" onClick={() => handleSort('arrangement')}>编曲 {getSortIcon('arrangement')}</th>
                    <th className="px-4 py-3 w-24 text-right cursor-pointer hover:bg-slate-100 whitespace-nowrap" onClick={() => handleSort('total')}>总分 {getSortIcon('total')}</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
                {songs.map((song, idx) => (
                    <tr key={song.id} className="hover:bg-slate-50 transition-colors group">
                        <td className="px-4 py-3 text-center font-mono text-slate-500 align-middle">
                            {song.rank}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900 break-words align-middle">
                            {song.title}
                        </td>
                        {showAlbum && <td className="px-4 py-3 text-slate-500 text-xs align-middle whitespace-nowrap">{song.albumName} <span className="opacity-50">({song.albumYear})</span></td>}
                        <td className="px-2 py-3 align-middle">
                            <Input 
                                type="number" step="0.1" min="0" max="10" 
                                value={song.scores.lyrics} 
                                onChange={(e) => handleUpdateScore(song.albumId, song.id, 'lyrics', e.target.value)}
                                className="text-center h-8 bg-transparent hover:bg-white focus:bg-white border-transparent hover:border-slate-200 focus:border-indigo-500 text-slate-600 !px-1"
                            />
                        </td>
                        <td className="px-2 py-3 align-middle">
                            <Input 
                                type="number" step="0.1" min="0" max="10" 
                                value={song.scores.composition} 
                                onChange={(e) => handleUpdateScore(song.albumId, song.id, 'composition', e.target.value)}
                                className="text-center h-8 bg-transparent hover:bg-white focus:bg-white border-transparent hover:border-slate-200 focus:border-indigo-500 text-slate-600 !px-1"
                            />
                        </td>
                        <td className="px-2 py-3 align-middle">
                            <Input 
                                type="number" step="0.1" min="0" max="10" 
                                value={song.scores.arrangement} 
                                onChange={(e) => handleUpdateScore(song.albumId, song.id, 'arrangement', e.target.value)}
                                className="text-center h-8 bg-transparent hover:bg-white focus:bg-white border-transparent hover:border-slate-200 focus:border-indigo-500 text-slate-600 !px-1"
                            />
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-indigo-600 align-middle">{song.totalScore.toFixed(2)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
  );

  return (
    <div className="space-y-6 pb-20">
      {/* Tabs */}
      <div className="flex space-x-1 bg-slate-200/50 p-1 rounded-lg w-fit">
        <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'overview' ? 'bg-white shadow text-indigo-600' : 'text-slate-600 hover:text-slate-900'}`}
        >
            生涯概况
        </button>
        <button
            onClick={() => setActiveTab('albums')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'albums' ? 'bg-white shadow text-indigo-600' : 'text-slate-600 hover:text-slate-900'}`}
        >
            全专辑排行
        </button>
        <button
            onClick={() => setActiveTab('songs')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'songs' ? 'bg-white shadow text-indigo-600' : 'text-slate-600 hover:text-slate-900'}`}
        >
            全歌曲排行
        </button>
      </div>

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Career Trajectory */}
          <Card className="p-6 col-span-1 lg:col-span-2">
            <h3 className="text-lg font-bold text-slate-800 mb-6">歌手生涯分数走势</h3>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={careerData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="year" stroke="#64748b" tick={{fontSize: 12}} />
                  <YAxis domain={[0, 10]} stroke="#64748b" tick={{fontSize: 12}} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    formatter={(value: number) => [value, '平均分']}
                    labelFormatter={(label) => `年份: ${label}`}
                  />
                  <Line type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={3} activeDot={{ r: 8 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Album Radar */}
          <Card className="p-6">
            <div className="flex justify-between items-start mb-4">
                <h3 className="text-lg font-bold text-slate-800">专辑能力雷达</h3>
                <select 
                    className="text-sm border-slate-300 rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500 py-1"
                    value={selectedAlbumIdForRadar}
                    onChange={(e) => setSelectedAlbumIdForRadar(e.target.value)}
                >
                    {albumsWithStats.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
                </select>
            </div>
            <div className="h-80 w-full flex items-center justify-center">
               <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
                  <PolarGrid stroke="#e2e8f0" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: '#475569', fontSize: 14, fontWeight: 500 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 10]} tick={false} axisLine={false} />
                  <Radar name="得分" dataKey="A" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.5} />
                  <Tooltip />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Top 5 Songs Summary */}
          <Card className="p-6">
             <h3 className="text-lg font-bold text-slate-800 mb-4">全生涯 Top 5 金曲</h3>
             <div className="space-y-3">
                {[...songsWithRank].sort((a,b) => a.rank - b.rank).slice(0, 5).map((song, idx) => (
                    <div key={song.id} className="flex items-center gap-3 p-2 rounded hover:bg-slate-50">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${idx < 3 ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>
                            {song.rank}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="font-medium text-slate-900 truncate">{song.title}</div>
                            <div className="text-xs text-slate-500 truncate">{song.albumName} ({song.albumYear})</div>
                        </div>
                        <div className="text-lg font-bold text-indigo-600">{song.totalScore.toFixed(2)}</div>
                    </div>
                ))}
             </div>
          </Card>
        </div>
      )}

      {activeTab === 'songs' && (
          <Card className="overflow-hidden">
             <div className="p-4 bg-yellow-50 text-yellow-700 text-xs flex justify-between items-center">
                <span>提示：点击表头可进行多维度排序，点击分数单元格可直接修改。</span>
             </div>
             <SongTable songs={sortedSongs} />
          </Card>
      )}

      {activeTab === 'albums' && (
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {sortedAlbums.map((album, idx) => (
                    <Card 
                        key={album.id} 
                        className="flex flex-col overflow-hidden hover:shadow-lg transition-all cursor-pointer ring-0 hover:ring-2 ring-indigo-500/20"
                    >
                         <div onClick={() => setSelectedAlbumForDetail(album.id)}>
                            <div className="h-48 bg-slate-200 relative">
                                {album.coverUrl ? (
                                    <img src={album.coverUrl} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-slate-400">无封面</div>
                                )}
                                <div className="absolute top-2 right-2 bg-black/60 text-white px-2 py-1 rounded text-xs backdrop-blur-sm">
                                    No.{idx + 1}
                                </div>
                                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-4">
                                     <h3 className="font-bold text-lg text-white truncate">{album.title}</h3>
                                     <p className="text-xs text-slate-200">{album.year} · {album.songs.length} 首歌</p>
                                </div>
                            </div>
                            <div className="p-4 flex-1 flex flex-col space-y-4">
                                <div className="flex justify-between items-end">
                                    <span className="text-xs text-slate-500 uppercase tracking-wider">专辑总分</span>
                                    <span className="text-2xl font-bold text-indigo-600">{album.averageTotal.toFixed(2)}</span>
                                </div>
                                <div className="space-y-2">
                                    <div className="flex justify-between text-xs text-slate-600">
                                        <span>作词</span>
                                        <span className="font-mono">{album.averageLyrics.toFixed(1)}</span>
                                    </div>
                                    <div className="w-full bg-slate-100 rounded-full h-1.5">
                                        <div className="bg-blue-400 h-1.5 rounded-full" style={{width: `${album.averageLyrics * 10}%`}}></div>
                                    </div>
                                    <div className="flex justify-between text-xs text-slate-600">
                                        <span>作曲</span>
                                        <span className="font-mono">{album.averageComposition.toFixed(1)}</span>
                                    </div>
                                    <div className="w-full bg-slate-100 rounded-full h-1.5">
                                        <div className="bg-purple-400 h-1.5 rounded-full" style={{width: `${album.averageComposition * 10}%`}}></div>
                                    </div>
                                    <div className="flex justify-between text-xs text-slate-600">
                                        <span>编曲</span>
                                        <span className="font-mono">{album.averageArrangement.toFixed(1)}</span>
                                    </div>
                                    <div className="w-full bg-slate-100 rounded-full h-1.5">
                                        <div className="bg-pink-400 h-1.5 rounded-full" style={{width: `${album.averageArrangement * 10}%`}}></div>
                                    </div>
                                </div>
                                <div className="pt-2 text-center text-xs text-indigo-500 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                                    点击查看详情
                                </div>
                            </div>
                        </div>
                    </Card>
                ))}
           </div>
      )}

      {/* Album Detail Modal */}
      {selectedAlbumForDetail && (
          <Modal 
            isOpen={!!selectedAlbumForDetail} 
            onClose={() => setSelectedAlbumForDetail(null)} 
            title={albumsWithStats.find(a => a.id === selectedAlbumForDetail)?.title || '专辑详情'}
          >
             <div className="mt-2 -mx-6 mb-[-1.5rem] overflow-y-auto max-h-[70vh] border-t border-slate-100">
                {(() => {
                    const albumSongs = songsWithRank.filter(s => s.albumId === selectedAlbumForDetail);
                    // Use the same sort function but applied to the subset
                    const sortedAlbumSongs = sortData(albumSongs, songSortConfig);
                    return <SongTable songs={sortedAlbumSongs} showAlbum={false} />;
                })()}
             </div>
          </Modal>
      )}
    </div>
  );
};