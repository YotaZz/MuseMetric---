import React, { useState, useCallback, useMemo, useRef } from 'react';
import { Singer, Album, Song, SongWithStats } from '../types';
import { generateId, calculateSongTotal, enrichSingerData, sortSongsAlgorithm, fileToBase64 } from '../utils';
import { Button, Input, Card, Modal } from '../components/UI';
import { IconPlus, IconTrash, IconMagic, IconUpload, IconEdit, IconMusic, IconEraser, IconDragHandle, IconMessage, IconSettings, IconRefresh } from '../components/Icons';
import { generateAlbumTracklist } from '../geminiService';
import { scanAndMatchDirectory, scanAndMatchFileList } from '../matchingService';
import { setFileHandle, removeFileHandle } from '../db';

interface DataEntryViewProps {
  singer: Singer;
  onUpdateSinger: (updatedSinger: Singer) => void;
}

interface DragItem {
    type: 'album' | 'song';
    index: number;
    albumIndex?: number; // Index of the album in the singer.albums array
}

export const DataEntryView: React.FC<DataEntryViewProps> = ({ singer, onUpdateSinger }) => {
  const [expandedAlbumId, setExpandedAlbumId] = useState<string | null>(null);
  
  // Modals
  const [isAddAlbumModalOpen, setIsAddAlbumModalOpen] = useState(false);
  const [isEditAlbumModalOpen, setIsEditAlbumModalOpen] = useState(false);
  const [editingAlbumId, setEditingAlbumId] = useState<string | null>(null);

  // Song Settings Modal
  const [songSettingsTarget, setSongSettingsTarget] = useState<{ albumId: string, song: Song } | null>(null);
  
  // Delete Confirmation State
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'album' | 'song', albumId: string, songId?: string } | null>(null);
  const [clearScoreTarget, setClearScoreTarget] = useState<{ type: 'album' | 'song', albumId: string, songId?: string } | null>(null);

  // AI Generation State
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiTargetAlbumId, setAiTargetAlbumId] = useState<string | null>(null);
  const [generatedSongs, setGeneratedSongs] = useState<string[]>([]);
  const [showGenerationConfirm, setShowGenerationConfirm] = useState(false);
  
  // Local File Matching State
  const [isMatching, setIsMatching] = useState(false);
  
  // Fallback Input Ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Album Form State (Used for both Add and Edit)
  const [albumFormTitle, setAlbumFormTitle] = useState('');
  const [albumFormYear, setAlbumFormYear] = useState('');
  const [albumFormCover, setAlbumFormCover] = useState<string | undefined>(undefined);

  // Active Song for Realtime Feedback
  const [activeSongId, setActiveSongId] = useState<string | null>(null);
  const [previewDimension, setPreviewDimension] = useState<'lyrics' | 'composition' | 'arrangement'>('lyrics');

  // DnD State
  const dragItem = useRef<DragItem | null>(null);
  const dragOverItem = useRef<DragItem | null>(null);
  const isDragHandleActive = useRef(false); // To restrict drag start to handle
  
  const [draggingId, setDraggingId] = useState<string | null>(null); // For visual style (opacity)
  const [dragOverId, setDragOverId] = useState<string | null>(null); // For visual style (border/highlight)

  const { albumsWithStats, allSongs } = useMemo(() => enrichSingerData(singer), [singer]);

  // Derived stats for the currently focused song
  const activeSongStats = useMemo(() => {
    if (!activeSongId) return null;
    
    // Find the song in the enriched data to get scores
    const currentSong = allSongs.find(s => s.id === activeSongId);
    if (!currentSong) return null;

    // Rank in Album
    const albumSongs = allSongs.filter(s => s.albumId === currentSong.albumId);
    const sortedAlbumSongs = [...albumSongs].sort(sortSongsAlgorithm);
    const rankInAlbum = sortedAlbumSongs.findIndex(s => s.id === activeSongId) + 1;
    
    // Rank Global
    const sortedAllSongs = [...allSongs].sort(sortSongsAlgorithm);
    const rankOverall = sortedAllSongs.findIndex(s => s.id === activeSongId) + 1;

    // Album Rank
    const currentAlbum = albumsWithStats.find(a => a.id === currentSong.albumId);
    const sortedAlbums = [...albumsWithStats].sort((a, b) => b.averageTotal - a.averageTotal);
    const albumRank = currentAlbum ? sortedAlbums.findIndex(a => a.id === currentAlbum.id) + 1 : 0;

    return {
      totalScore: currentSong.totalScore,
      rankInAlbum,
      totalInAlbum: albumSongs.length,
      rankOverall,
      totalOverall: allSongs.length,
      albumRank,
      totalAlbums: albumsWithStats.length,
      albumName: currentSong.albumName
    };
  }, [activeSongId, allSongs, albumsWithStats]);

  // Derived neighbors for the ranking preview
  const rankingNeighbors = useMemo(() => {
    if (!activeSongId) return [];
    
    // Sort all songs to determine rank
    const sortedAllSongs = [...allSongs].sort(sortSongsAlgorithm);
    
    const currentIndex = sortedAllSongs.findIndex(s => s.id === activeSongId);
    if (currentIndex === -1) return [];

    const total = sortedAllSongs.length;
    const windowSize = 5;
    
    // Determine window start/end logic to keep window size consistent if possible
    let start = currentIndex - 2;
    let end = start + windowSize;

    // Adjust boundaries
    if (start < 0) {
        start = 0;
        end = Math.min(total, windowSize);
    } else if (end > total) {
        end = total;
        start = Math.max(0, end - windowSize);
    }

    return sortedAllSongs.slice(start, end).map((s, i) => ({
        ...s,
        absoluteRank: start + i + 1,
        isCurrent: s.id === activeSongId
    }));
  }, [activeSongId, allSongs]);

  // --- Handlers ---

  const processMatchingResults = (updatedSongs: Song[], matchedAudioCount: number, matchedLrcCount: number) => {
        // Reconstruct album structure
        const updatedAlbums = singer.albums.map(album => ({
            ...album,
            songs: album.songs.map(originalSong => 
                updatedSongs.find(u => u.id === originalSong.id) || originalSong
            )
        }));

        onUpdateSinger({ ...singer, albums: updatedAlbums });
        alert(`匹配完成！\n成功关联音频: ${matchedAudioCount} 首\n成功关联歌词: ${matchedLrcCount} 首`);
  };

  const handleConnectLocalFolder = async () => {
    try {
        const dirHandle = await (window as any).showDirectoryPicker();
        setIsMatching(true);
        
        // Flatten songs for matching
        const flatSongs = singer.albums.flatMap(a => a.songs);
        const { updatedSongs, matchedAudioCount, matchedLrcCount } = await scanAndMatchDirectory(flatSongs, dirHandle);
        
        processMatchingResults(updatedSongs, matchedAudioCount, matchedLrcCount);
    } catch (err: any) {
        if (err.name === 'AbortError') return;

        // SecurityError or generally failing in iframe
        console.warn("showDirectoryPicker failed, falling back to input", err);
        if (fileInputRef.current) {
            fileInputRef.current.click();
        } else {
             alert('无法访问文件夹选择器，且回退模式不可用。');
        }
    } finally {
        setIsMatching(false);
    }
  };

  const handleFallbackFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files || e.target.files.length === 0) return;
      setIsMatching(true);
      try {
          const flatSongs = singer.albums.flatMap(a => a.songs);
          const { updatedSongs, matchedAudioCount, matchedLrcCount } = await scanAndMatchFileList(flatSongs, e.target.files);
          processMatchingResults(updatedSongs, matchedAudioCount, matchedLrcCount);
      } catch (err) {
          console.error("Fallback matching error", err);
          alert("文件处理出错");
      } finally {
          setIsMatching(false);
          // Reset value to allow selecting same folder again
          e.target.value = '';
      }
  };

  const handleSelectFileManually = async (type: 'audio' | 'lrc') => {
      if (!songSettingsTarget) return;
      try {
          // Try newer API first
          const [fileHandle] = await (window as any).showOpenFilePicker({
              types: type === 'audio' 
                ? [{ description: 'Audio Files', accept: { 'audio/*': ['.mp3', '.flac', '.wav', '.m4a'] } }] 
                : [{ description: 'Lyrics Files', accept: { 'text/plain': ['.lrc'] } }]
          });

          await setFileHandle(songSettingsTarget.song.id, type, fileHandle);
          updateSongFileState(type, true);

      } catch (err: any) {
           if (err.name === 'AbortError') return;
           // If API fails, we could potentially have a fallback single file input, 
           // but for now keeping it simple or relying on the folder scan fallback.
           alert('手动文件选择仅支持现代浏览器或非沙盒环境。请尝试使用上方的“关联本地文件夹”功能。');
      }
  };
  
  const updateSongFileState = (type: 'audio' | 'lrc', hasFile: boolean) => {
      if (!songSettingsTarget) return;
      
      const updatedAlbums = singer.albums.map(a => {
            if (a.id !== songSettingsTarget.albumId) return a;
            return {
                ...a,
                songs: a.songs.map(s => {
                    if (s.id !== songSettingsTarget.song.id) return s;
                    return {
                        ...s,
                        [type === 'audio' ? 'hasAudio' : 'hasLrc']: hasFile
                    };
                })
            };
        });
        onUpdateSinger({ ...singer, albums: updatedAlbums });
        
        // Update local target for immediate UI reflection in modal
        setSongSettingsTarget({
            ...songSettingsTarget,
            song: {
                ...songSettingsTarget.song,
                [type === 'audio' ? 'hasAudio' : 'hasLrc']: hasFile
            }
        });
  };

  const handleRemoveFileAssociation = async (type: 'audio' | 'lrc') => {
      if (!songSettingsTarget) return;
      await removeFileHandle(songSettingsTarget.song.id, type);
      updateSongFileState(type, false);
  };

  const handleUpdateHighlightTime = (time: string) => {
      if (!songSettingsTarget) return;
      const numTime = Math.max(0, parseFloat(time) || 0);

      const updatedAlbums = singer.albums.map(a => {
          if (a.id !== songSettingsTarget.albumId) return a;
          return {
              ...a,
              songs: a.songs.map(s => {
                  if (s.id !== songSettingsTarget.song.id) return s;
                  return { ...s, highlightStartTime: numTime };
              })
          };
      });
      onUpdateSinger({ ...singer, albums: updatedAlbums });
      setSongSettingsTarget({ ...songSettingsTarget, song: { ...songSettingsTarget.song, highlightStartTime: numTime }});
  };

  const openAddAlbumModal = () => {
      setAlbumFormTitle('');
      setAlbumFormYear('');
      setAlbumFormCover(undefined);
      setIsAddAlbumModalOpen(true);
  };

  const openEditAlbumModal = (album: Album) => {
      setEditingAlbumId(album.id);
      setAlbumFormTitle(album.title);
      setAlbumFormYear(album.year);
      setAlbumFormCover(album.coverUrl);
      setIsEditAlbumModalOpen(true);
  };

  const handleSaveAlbum = () => {
    if (!albumFormTitle || !albumFormYear) return;

    if (isEditAlbumModalOpen && editingAlbumId) {
        // Edit Mode
        const updatedAlbums = singer.albums.map(a => 
            a.id === editingAlbumId 
            ? { ...a, title: albumFormTitle, year: albumFormYear, coverUrl: albumFormCover } 
            : a
        );
        onUpdateSinger({ ...singer, albums: updatedAlbums });
        setIsEditAlbumModalOpen(false);
        setEditingAlbumId(null);
    } else {
        // Add Mode
        const newAlbum: Album = {
            id: generateId(),
            title: albumFormTitle,
            year: albumFormYear,
            coverUrl: albumFormCover,
            songs: []
        };
        onUpdateSinger({ ...singer, albums: [...singer.albums, newAlbum] });
        setIsAddAlbumModalOpen(false);
    }
    
    // Reset Form
    setAlbumFormTitle('');
    setAlbumFormYear('');
    setAlbumFormCover(undefined);
  };

  const handleDeleteClick = (e: React.MouseEvent, type: 'album' | 'song', albumId: string, songId?: string) => {
    e.stopPropagation(); // Stop bubble to prevent album expansion
    setDeleteTarget({ type, albumId, songId });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;

    if (deleteTarget.type === 'album') {
        onUpdateSinger({
            ...singer,
            albums: singer.albums.filter(a => a.id !== deleteTarget.albumId)
        });
    } else if (deleteTarget.type === 'song' && deleteTarget.songId) {
        const updatedAlbums = singer.albums.map(album => {
            if (album.id !== deleteTarget.albumId) return album;
            return {
                ...album,
                songs: album.songs.filter(s => s.id !== deleteTarget.songId)
            };
        });
        onUpdateSinger({ ...singer, albums: updatedAlbums });
    }
    setDeleteTarget(null);
  };

  const handleClearScoresClick = (e: React.MouseEvent, type: 'album' | 'song', albumId: string, songId?: string) => {
      e.stopPropagation();
      setClearScoreTarget({ type, albumId, songId });
  };

  const confirmClearScores = () => {
      if (!clearScoreTarget) return;

      const updatedAlbums = singer.albums.map(album => {
          if (album.id !== clearScoreTarget.albumId) return album;
          
          if (clearScoreTarget.type === 'album') {
              // Clear all songs in album
              return {
                  ...album,
                  songs: album.songs.map(song => ({
                      ...song,
                      scores: { lyrics: 0, composition: 0, arrangement: 0 }
                  }))
              };
          } else if (clearScoreTarget.type === 'song' && clearScoreTarget.songId) {
              // Clear specific song
              return {
                  ...album,
                  songs: album.songs.map(song => {
                      if (song.id !== clearScoreTarget.songId) return song;
                      return {
                          ...song,
                          scores: { lyrics: 0, composition: 0, arrangement: 0 }
                      };
                  })
              };
          }
          return album;
      });

      onUpdateSinger({ ...singer, albums: updatedAlbums });
      setClearScoreTarget(null);
  };


  const handleUpdateScore = (albumId: string, songId: string, field: 'lyrics' | 'composition' | 'arrangement', value: string) => {
    const numValue = Math.min(10, Math.max(0, parseFloat(value) || 0));
    setActiveSongId(songId);

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

  // AI Handlers
  const openAIModal = (albumId: string) => {
      setAiTargetAlbumId(albumId);
      const album = singer.albums.find(a => a.id === albumId);
      if(album) {
         // Trigger generation immediately
         handleStartAI(album.title);
      }
      setShowGenerationConfirm(true);
  };

  const handleStartAI = async (albumTitle: string) => {
    setIsGenerating(true);
    setGeneratedSongs([]);
    const tracks = await generateAlbumTracklist(singer.name, albumTitle);
    setGeneratedSongs(tracks);
    setIsGenerating(false);
  };

  const handleConfirmAI = () => {
      if(!aiTargetAlbumId) return;
      
      const newSongs: Song[] = generatedSongs.map(title => ({
        id: generateId(),
        title,
        scores: { lyrics: 0, composition: 0, arrangement: 0 }
      }));

      const updatedAlbums = singer.albums.map(a => 
         a.id === aiTargetAlbumId ? { ...a, songs: [...a.songs, ...newSongs]} : a
      );
      
      onUpdateSinger({ ...singer, albums: updatedAlbums });
      setShowGenerationConfirm(false);
      setAiTargetAlbumId(null);
      setGeneratedSongs([]);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const base64 = await fileToBase64(file);
        setAlbumFormCover(base64);
      } catch (err) {
        console.error("Image upload failed", err);
      }
    }
  };

  // --- Drag and Drop Logic (Index Based + Handle Restricted) ---

  const handleDragStart = (e: React.DragEvent, type: 'album' | 'song', index: number, albumIndex?: number, id?: string) => {
      // STOP PROPAGATION: Crucial to prevent nested drag events (e.g. dragging a song triggers album drag)
      e.stopPropagation();

      // STRICT CHECK: Only allow drag if initiated from the handle
      if (!isDragHandleActive.current) {
          e.preventDefault();
          return;
      }

      dragItem.current = { type, index, albumIndex };
      if (id) setDraggingId(id);
      
      e.dataTransfer.effectAllowed = "move";
      // Optional: Set transparent drag image or similar if needed
  };

  const handleDragOver = (e: React.DragEvent, type: 'album' | 'song', index: number, albumIndex?: number, id?: string) => {
       e.preventDefault(); // Crucial for allowing drop
       e.stopPropagation();

       if (!dragItem.current) return;
       
       // Ensure we are dragging same type
       if (dragItem.current.type !== type) return;

       // If sorting songs, must be within the SAME album index
       if (type === 'song' && dragItem.current.albumIndex !== albumIndex) return;

       // Update reference with current hover target index
       dragOverItem.current = { type, index, albumIndex };
       
       // Update visual state
       if (id && dragOverId !== id) {
           setDragOverId(id);
       }
  };

  const handleDragEnd = () => {
      // Reset visual states
      setDraggingId(null);
      setDragOverId(null);
      isDragHandleActive.current = false;

      // Validate Drag Pointers
      if(!dragItem.current || !dragOverItem.current) {
          dragItem.current = null;
          dragOverItem.current = null;
          return;
      }

      const sourceIndex = dragItem.current.index;
      const targetIndex = dragOverItem.current.index;

      if (sourceIndex === targetIndex) {
          dragItem.current = null;
          dragOverItem.current = null;
          return;
      }

      // Logic for Albums
      if (dragItem.current.type === 'album') {
          const newAlbums = [...singer.albums];
          // Simple array move by index
          const [movedAlbum] = newAlbums.splice(sourceIndex, 1);
          newAlbums.splice(targetIndex, 0, movedAlbum);
          onUpdateSinger({ ...singer, albums: newAlbums });
      } 
      // Logic for Songs
      else if (dragItem.current.type === 'song') {
          const albumIdx = dragItem.current.albumIndex;
          
          if (albumIdx !== undefined && albumIdx >= 0 && albumIdx < singer.albums.length) {
              const currentAlbum = singer.albums[albumIdx];
              const newSongs = [...currentAlbum.songs];
              
              // Simple array move by index
              const [movedSong] = newSongs.splice(sourceIndex, 1);
              newSongs.splice(targetIndex, 0, movedSong);
              
              const newAlbums = [...singer.albums];
              newAlbums[albumIdx] = { ...newAlbums[albumIdx], songs: newSongs };
              onUpdateSinger({ ...singer, albums: newAlbums });
          }
      }

      dragItem.current = null;
      dragOverItem.current = null;
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-full">
      {/* Hidden Fallback Input */}
      <input 
         type="file" 
         ref={fileInputRef} 
         onChange={handleFallbackFolderSelect} 
         style={{display: 'none'}} 
         multiple 
         {...({webkitdirectory: "", directory: ""} as any)} 
      />

      {/* Main Content: Album List */}
      <div className="flex-1 space-y-6 overflow-y-auto pb-20">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold text-slate-800">专辑列表 ({singer.albums.length})</h2>
          <div className="flex gap-2">
            <Button onClick={handleConnectLocalFolder} variant="secondary" className="gap-2 text-indigo-600 border-indigo-200 hover:bg-indigo-50" disabled={isMatching}>
                {isMatching ? '扫描中...' : '📂 关联本地音乐文件夹'}
            </Button>
            <Button onClick={openAddAlbumModal} className="gap-2">
                <IconPlus className="w-4 h-4" /> 添加专辑
            </Button>
          </div>
        </div>

        {singer.albums.length === 0 && (
          <div className="text-center py-12 text-slate-400 bg-white rounded-xl border border-dashed border-slate-300">
            <p>暂无专辑，请点击右上方按钮添加</p>
          </div>
        )}

        {singer.albums.map((album, albumIdx) => {
          // Check if all songs have a total score > 0
          const isAlbumCompleted = album.songs.length > 0 && album.songs.every(s => 
              calculateSongTotal(s.scores.lyrics, s.scores.composition, s.scores.arrangement) > 0
          );

          return (
          <div
             key={album.id}
             draggable
             onDragStart={(e) => handleDragStart(e, 'album', albumIdx, undefined, album.id)}
             onDragOver={(e) => handleDragOver(e, 'album', albumIdx, undefined, album.id)}
             onDragEnd={handleDragEnd}
             className={`transition-all duration-200 ${draggingId === album.id ? 'opacity-40' : 'opacity-100'} ${dragOverId === album.id ? 'translate-x-2' : ''}`}
          >
          <Card className={`overflow-hidden mb-6 transition-all ${dragOverId === album.id ? 'ring-2 ring-indigo-400 shadow-lg' : ''} ${isAlbumCompleted ? '!border-emerald-500/50 shadow-sm' : ''}`}>
            <div 
              className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between transition-colors cursor-pointer"
               onClick={() => setExpandedAlbumId(expandedAlbumId === album.id ? null : album.id)}
            >
              <div className="flex items-center gap-4 flex-1">
                {/* Drag Handle for Album */}
                <div 
                    className="cursor-move text-slate-300 hover:text-slate-500 p-1" 
                    onMouseDown={() => isDragHandleActive.current = true}
                    onMouseUp={() => isDragHandleActive.current = false}
                    onClick={(e) => e.stopPropagation()} 
                >
                    <IconDragHandle className="w-5 h-5 rotate-90" />
                </div>

                <div className="w-12 h-12 bg-slate-200 rounded overflow-hidden flex-shrink-0 relative group">
                  {album.coverUrl ? (
                    <img src={album.coverUrl} alt={album.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">No Cover</div>
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 flex items-center gap-2">
                      {album.title}
                  </h3>
                  <p className="text-sm text-slate-500">{album.year} · {album.songs.length} 首歌</p>
                </div>
              </div>
              
              <div className="flex items-center gap-1">
                 {/* Toolbar */}
                 <Button 
                    type="button"
                    variant="ghost" 
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); openAIModal(album.id); }}
                    title="AI 智能生成歌单"
                    className="text-indigo-500 hover:bg-indigo-50"
                 >
                   <IconMagic className="w-4 h-4 pointer-events-none" />
                 </Button>
                 
                 <Button 
                    type="button"
                    variant="ghost" 
                    size="sm"
                    onClick={(e) => handleClearScoresClick(e, 'album', album.id)}
                    title="清空本专辑所有分数"
                    className="text-orange-400 hover:bg-orange-50 hover:text-orange-500"
                 >
                   <IconEraser className="w-4 h-4 pointer-events-none" />
                 </Button>

                 <Button 
                    type="button"
                    variant="ghost" 
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); openEditAlbumModal(album); }}
                    title="编辑专辑信息"
                    className="text-slate-500 hover:bg-slate-100"
                 >
                   <IconEdit className="w-4 h-4 pointer-events-none" />
                 </Button>

                 <Button 
                    type="button"
                    variant="ghost" 
                    size="sm"
                    className="text-red-500 hover:bg-red-50 hover:text-red-600"
                    onClick={(e) => handleDeleteClick(e, 'album', album.id)}
                    title="删除专辑"
                 >
                   <IconTrash className="w-4 h-4 pointer-events-none" />
                 </Button>
              </div>
            </div>

            {expandedAlbumId === album.id && (
              <div className="p-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-100">
                      <th className="w-8"></th>
                      <th className="text-left py-2 pl-2">歌名</th>
                      <th className="text-left py-2 w-48">简评 (20字)</th>
                      <th className="w-10 py-2 text-center">源</th>
                      <th className="w-16 py-2 text-center">作词</th>
                      <th className="w-16 py-2 text-center">作曲</th>
                      <th className="w-16 py-2 text-center">编曲</th>
                      <th className="w-16 py-2 text-right pr-2">总分</th>
                      <th className="w-16">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {album.songs.map((song, songIdx) => {
                       const total = calculateSongTotal(song.scores.lyrics, song.scores.composition, song.scores.arrangement);
                       const isDraggingThis = draggingId === song.id;
                       const isDragOverThis = dragOverId === song.id;
                       
                       return (
                        <tr 
                          key={song.id} 
                          draggable
                          onDragStart={(e) => handleDragStart(e, 'song', songIdx, albumIdx, song.id)}
                          onDragOver={(e) => handleDragOver(e, 'song', songIdx, albumIdx, song.id)}
                          onDragEnd={handleDragEnd}
                          className={`
                            group border-b border-slate-50 transition-all duration-200
                            ${activeSongId === song.id ? 'bg-indigo-50' : 'hover:bg-indigo-50/30'}
                            ${isDraggingThis ? 'opacity-30 bg-slate-100' : ''}
                            ${isDragOverThis && !isDraggingThis ? 'border-t-2 border-t-indigo-500 bg-indigo-50/50' : ''}
                          `}
                          onFocus={() => setActiveSongId(song.id)}
                        >
                          <td 
                            className="w-8 text-center text-slate-300 cursor-move hover:text-slate-500 p-1"
                            onMouseDown={() => isDragHandleActive.current = true}
                            onMouseUp={() => isDragHandleActive.current = false}
                          >
                              <IconDragHandle className="w-4 h-4 mx-auto" />
                          </td>
                          <td className="py-2 pl-2 font-medium text-slate-700">
                             <input 
                                className="bg-transparent border-none w-full focus:ring-0 p-0 font-medium text-slate-700" 
                                value={song.title} 
                                onChange={(e) => {
                                  const newTitle = e.target.value;
                                  const newAlbums = singer.albums.map(a => 
                                    a.id === album.id ? {...a, songs: a.songs.map(s => s.id === song.id ? {...s, title: newTitle} : s)} : a
                                  );
                                  onUpdateSinger({...singer, albums: newAlbums});
                                }} 
                             />
                          </td>
                          {/* Comment Input */}
                          <td className="py-2 pr-2">
                             <div className="relative group/input">
                                <input 
                                    className="bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-400 focus:ring-0 w-full text-slate-500 text-xs py-1 transition-colors" 
                                    placeholder="添加简评..."
                                    maxLength={20}
                                    value={song.comment || ''}
                                    onChange={(e) => {
                                        const newComment = e.target.value;
                                        const newAlbums = singer.albums.map(a => 
                                            a.id === album.id ? {...a, songs: a.songs.map(s => s.id === song.id ? {...s, comment: newComment} : s)} : a
                                        );
                                        onUpdateSinger({...singer, albums: newAlbums});
                                    }}
                                />
                                {song.comment && (
                                    <IconMessage className="w-3 h-3 absolute right-0 top-1.5 text-indigo-300 opacity-50 pointer-events-none" />
                                )}
                             </div>
                          </td>
                          <td className="py-2 text-center">
                              <div className="flex items-center justify-center gap-1 text-[10px]">
                                  <span title={song.hasAudio ? "已关联音频" : "未关联音频"} className={song.hasAudio ? "text-indigo-500" : "text-slate-200"}>♫</span>
                                  <span title={song.hasLrc ? "已关联歌词" : "未关联歌词"} className={song.hasLrc ? "text-indigo-500" : "text-slate-200"}>T</span>
                              </div>
                          </td>
                          <td className="py-2 px-1">
                            <Input 
                              type="number" step="0.1" min="0" max="10" 
                              value={song.scores.lyrics || ''} 
                              onChange={(e) => handleUpdateScore(album.id, song.id, 'lyrics', e.target.value)}
                              className="text-center h-8 !px-1"
                            />
                          </td>
                          <td className="py-2 px-1">
                            <Input 
                              type="number" step="0.1" min="0" max="10" 
                              value={song.scores.composition || ''} 
                              onChange={(e) => handleUpdateScore(album.id, song.id, 'composition', e.target.value)}
                              className="text-center h-8 !px-1"
                            />
                          </td>
                          <td className="py-2 px-1">
                            <Input 
                              type="number" step="0.1" min="0" max="10" 
                              value={song.scores.arrangement || ''} 
                              onChange={(e) => handleUpdateScore(album.id, song.id, 'arrangement', e.target.value)}
                              className="text-center h-8 !px-1"
                            />
                          </td>
                          <td className="py-2 text-right pr-2 font-bold text-indigo-600">
                            {total > 0 ? total.toFixed(1) : '-'}
                          </td>
                          <td className="py-2 text-center">
                              <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button 
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setSongSettingsTarget({ albumId: album.id, song }); }}
                                    title="歌曲设置"
                                    className="text-slate-300 hover:text-indigo-500 transition-colors p-1"
                                  >
                                    <IconSettings className="w-4 h-4" />
                                  </button>
                                  <button 
                                    type="button"
                                    onClick={(e) => handleDeleteClick(e, 'song', album.id, song.id)}
                                    className="text-slate-300 hover:text-red-500 transition-colors p-1"
                                    title="删除歌曲"
                                  >
                                      <IconTrash className="w-4 h-4"/>
                                  </button>
                              </div>
                          </td>
                        </tr>
                      );
                    })}
                    {/* Add Song Button Row */}
                     <tr>
                        <td colSpan={9} className="py-3 text-center">
                            <button 
                                type="button"
                                onClick={() => {
                                    const newSong: Song = { id: generateId(), title: "新歌曲", scores: { lyrics: 0, composition: 0, arrangement: 0 }};
                                    const updatedAlbums = singer.albums.map(a => a.id === album.id ? {...a, songs: [...a.songs, newSong]} : a);
                                    onUpdateSinger({...singer, albums: updatedAlbums});
                                }}
                                className="text-indigo-500 hover:text-indigo-700 text-sm font-medium flex items-center justify-center gap-1 w-full"
                            >
                                <IconPlus className="w-3 h-3"/> 添加歌曲
                            </button>
                        </td>
                     </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          </div>
        )})}
      </div>

      {/* Side Panel: Realtime Stats - Sticky */}
      <div className="hidden lg:block w-80 flex-shrink-0">
        <div className="sticky top-6 space-y-4">
           <Card className="p-4 bg-indigo-900 text-white border-none shadow-lg">
             <h3 className="text-sm font-semibold uppercase tracking-wider opacity-75 mb-2">实时评分反馈</h3>
             {activeSongStats ? (
               <div className="space-y-4">
                 <div>
                   <p className="text-xs opacity-75">当前正在编辑</p>
                   <p className="text-lg font-bold truncate">{allSongs.find(s => s.id === activeSongId)?.title}</p>
                   <p className="text-xs opacity-75">{activeSongStats.albumName}</p>
                 </div>
                 
                 <div className="flex items-end gap-2">
                   <span className="text-4xl font-bold">{activeSongStats.totalScore.toFixed(2)}</span>
                   <span className="mb-2 text-sm opacity-75">总分</span>
                 </div>

                 <div className="space-y-2 pt-2 border-t border-indigo-700/50">
                   <div className="flex justify-between text-sm">
                     <span>专辑内排名</span>
                     <span className="font-mono font-bold">{activeSongStats.rankInAlbum} <span className="text-xs opacity-60">/ {activeSongStats.totalInAlbum}</span></span>
                   </div>
                   <div className="w-full bg-indigo-950/50 rounded-full h-1.5">
                     <div className="bg-green-400 h-1.5 rounded-full transition-all duration-500" style={{ width: `${(1 - (activeSongStats.rankInAlbum - 1) / activeSongStats.totalInAlbum) * 100}%`}}></div>
                   </div>

                   <div className="flex justify-between text-sm">
                     <span>全生涯排名</span>
                     <span className="font-mono font-bold">{activeSongStats.rankOverall} <span className="text-xs opacity-60">/ {activeSongStats.totalOverall}</span></span>
                   </div>
                   <div className="w-full bg-indigo-950/50 rounded-full h-1.5">
                     <div className="bg-yellow-400 h-1.5 rounded-full transition-all duration-500" style={{ width: `${(1 - (activeSongStats.rankOverall - 1) / activeSongStats.totalOverall) * 100}%`}}></div>
                   </div>

                   <div className="flex justify-between text-sm mt-4">
                     <span>专辑排名</span>
                     <span className="font-mono font-bold">{activeSongStats.albumRank} <span className="text-xs opacity-60">/ {activeSongStats.totalAlbums}</span></span>
                   </div>
                 </div>
               </div>
             ) : (
               <div className="h-40 flex flex-col items-center justify-center opacity-50 text-center">
                 <IconEdit className="w-8 h-8 mb-2" />
                 <p className="text-sm">点击任意歌曲的分数框<br/>查看实时排名分析</p>
               </div>
             )}
           </Card>
           
           {/* Ranking Neighborhood Preview */}
           {activeSongId && rankingNeighbors.length > 0 && (
             <Card className="p-4 bg-white border-slate-200 shadow-lg">
                <div className="flex justify-between items-center mb-3 pb-2 border-b border-slate-100">
                    <h3 className="text-sm font-bold text-slate-700">实时位次预览</h3>
                    <select
                        className="text-xs border-none bg-slate-100 rounded px-2 py-1 text-slate-600 focus:ring-0 cursor-pointer hover:bg-slate-200 transition-colors"
                        value={previewDimension}
                        onChange={(e) => setPreviewDimension(e.target.value as any)}
                    >
                        <option value="lyrics">作词</option>
                        <option value="composition">作曲</option>
                        <option value="arrangement">编曲</option>
                    </select>
                </div>
                <div className="space-y-1">
                    {rankingNeighbors.map(song => (
                        <div 
                            key={song.id} 
                            className={`flex items-center gap-2 p-2 rounded text-sm transition-all ${
                                song.isCurrent 
                                ? 'bg-indigo-600 text-white shadow-md scale-[1.02]' 
                                : 'text-slate-600'
                            }`}
                        >
                            <div className={`w-6 text-center font-mono text-xs ${song.isCurrent ? 'text-indigo-200' : 'text-slate-400'}`}>
                                #{song.absoluteRank}
                            </div>
                            <div className="flex-1 truncate font-medium">
                                {song.title}
                            </div>
                            <div className={`w-12 text-right font-mono text-xs opacity-75 border-r border-white/20 pr-2 mr-1`}>
                                {song.scores[previewDimension].toFixed(1)}
                            </div>
                            <div className={`w-12 text-right font-mono font-bold ${song.isCurrent ? 'text-white' : 'text-indigo-600'}`}>
                                {song.totalScore.toFixed(2)}
                            </div>
                        </div>
                    ))}
                </div>
             </Card>
           )}

           <div className="text-xs text-slate-400 text-center px-4">
              评分规则：如果总分相同，作曲分更高者排名靠前。
           </div>
        </div>
      </div>

      {/* Album Form Modal (Add & Edit) */}
      <Modal 
        isOpen={isAddAlbumModalOpen || isEditAlbumModalOpen} 
        onClose={() => { setIsAddAlbumModalOpen(false); setIsEditAlbumModalOpen(false); }} 
        title={isEditAlbumModalOpen ? "编辑专辑信息" : "添加新专辑"}
      >
        <div className="space-y-4">
            <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">专辑名称</label>
            <Input value={albumFormTitle} onChange={e => setAlbumFormTitle(e.target.value)} placeholder="例如：范特西" />
            </div>
            <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">发行年份</label>
            <Input type="number" value={albumFormYear} onChange={e => setAlbumFormYear(e.target.value)} placeholder="2001" />
            </div>
            <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">封面图片</label>
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-slate-300 border-dashed rounded-lg cursor-pointer bg-slate-50 hover:bg-slate-100 relative overflow-hidden">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                    {albumFormCover ? (
                        <img src={albumFormCover} className="absolute inset-0 w-full h-full object-contain" />
                    ) : (
                        <>
                            <IconUpload className="w-8 h-8 text-slate-400 mb-2" />
                            <p className="text-xs text-slate-500">点击上传封面 (可选)</p>
                        </>
                    )}
                </div>
                <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                {albumFormCover && <div className="absolute inset-0 bg-black/0 hover:bg-black/10 transition-colors" />}
            </label>
            {albumFormCover && (
                <button onClick={() => setAlbumFormCover(undefined)} className="text-xs text-red-500 mt-1 hover:underline">移除封面</button>
            )}
            </div>
            <div className="flex justify-end gap-2 mt-6">
            <Button variant="ghost" onClick={() => { setIsAddAlbumModalOpen(false); setIsEditAlbumModalOpen(false); }}>取消</Button>
            <Button onClick={handleSaveAlbum}>保存</Button>
            </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal 
        isOpen={!!deleteTarget} 
        onClose={() => setDeleteTarget(null)} 
        title={deleteTarget?.type === 'album' ? "删除专辑" : "删除歌曲"}
      >
         <div className="space-y-4">
            <p className="text-slate-600">
                {deleteTarget?.type === 'album' 
                  ? '确定要删除这张专辑吗？删除后所有歌曲数据将无法恢复。' 
                  : '确定要删除这首歌曲吗？'}
            </p>
            <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setDeleteTarget(null)}>取消</Button>
                <Button variant="danger" onClick={confirmDelete}>确认删除</Button>
            </div>
         </div>
      </Modal>

      {/* Clear Score Confirmation Modal */}
      <Modal 
        isOpen={!!clearScoreTarget} 
        onClose={() => setClearScoreTarget(null)} 
        title={clearScoreTarget?.type === 'album' ? "清空专辑分数" : "清空歌曲分数"}
      >
         <div className="space-y-4">
            <p className="text-slate-600">
                {clearScoreTarget?.type === 'album' 
                  ? '确定要清空该专辑内所有歌曲的分数吗？这操作不可撤销。' 
                  : '确定要清空这首歌曲的分数吗？'}
            </p>
            <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setClearScoreTarget(null)}>取消</Button>
                <Button variant="primary" className="bg-orange-500 hover:bg-orange-600 focus:ring-orange-500" onClick={confirmClearScores}>确认清空</Button>
            </div>
         </div>
      </Modal>

       {/* Song Settings Modal */}
       <Modal
           isOpen={!!songSettingsTarget}
           onClose={() => setSongSettingsTarget(null)}
           title={`歌曲设置: ${songSettingsTarget?.song.title}`}
       >
           {songSettingsTarget && (
               <div className="space-y-6">
                   <div>
                       <label className="block text-sm font-medium text-slate-700 mb-1">高潮片段起始时间 (秒)</label>
                       <p className="text-xs text-slate-500 mb-2">在播放榜单时，将直接从该时间点开始播放，营造高潮氛围。</p>
                       <div className="flex items-center gap-2">
                         <Input
                           type="number"
                           min="0"
                           step="1"
                           value={songSettingsTarget.song.highlightStartTime || ''}
                           onChange={(e) => handleUpdateHighlightTime(e.target.value)}
                           placeholder="例如: 65"
                         />
                         <span className="text-sm text-slate-500">秒</span>
                       </div>
                   </div>

                   <div className="border-t border-slate-100 pt-4">
                       <h4 className="text-sm font-medium text-slate-700 mb-3">本地文件关联</h4>
                       
                       <div className="space-y-3">
                           <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                               <div className="flex items-center gap-3">
                                   <div className={`p-2 rounded-full ${songSettingsTarget.song.hasAudio ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-200 text-slate-400'}`}>
                                       <IconMusic className="w-5 h-5" />
                                   </div>
                                   <div>
                                       <div className="text-sm font-medium text-slate-800">音频文件</div>
                                       <div className="text-xs text-slate-500">{songSettingsTarget.song.hasAudio ? '已关联' : '未关联'}</div>
                                   </div>
                                </div>
                                <div className="flex gap-2">
                                    {songSettingsTarget.song.hasAudio && (
                                        <Button size="sm" variant="ghost" className="text-red-500 hover:bg-red-50" onClick={() => handleRemoveFileAssociation('audio')}>解绑</Button>
                                    )}
                                    <Button size="sm" variant="secondary" onClick={() => handleSelectFileManually('audio')}>
                                        {songSettingsTarget.song.hasAudio ? '重新选择' : '选择文件'}
                                    </Button>
                                </div>
                           </div>

                           <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                               <div className="flex items-center gap-3">
                                   <div className={`p-2 rounded-full ${songSettingsTarget.song.hasLrc ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-200 text-slate-400'}`}>
                                       <span className="font-bold text-xs w-5 h-5 flex items-center justify-center">LRC</span>
                                   </div>
                                   <div>
                                       <div className="text-sm font-medium text-slate-800">歌词文件</div>
                                       <div className="text-xs text-slate-500">{songSettingsTarget.song.hasLrc ? '已关联' : '未关联'}</div>
                                   </div>
                                </div>
                                <div className="flex gap-2">
                                    {songSettingsTarget.song.hasLrc && (
                                        <Button size="sm" variant="ghost" className="text-red-500 hover:bg-red-50" onClick={() => handleRemoveFileAssociation('lrc')}>解绑</Button>
                                    )}
                                    <Button size="sm" variant="secondary" onClick={() => handleSelectFileManually('lrc')}>
                                        {songSettingsTarget.song.hasLrc ? '重新选择' : '选择文件'}
                                    </Button>
                                </div>
                           </div>
                       </div>
                   </div>

                   <div className="flex justify-end pt-2">
                       <Button onClick={() => setSongSettingsTarget(null)}>完成</Button>
                   </div>
               </div>
           )}
       </Modal>

      {/* AI Generation Modal */}
      <Modal isOpen={showGenerationConfirm} onClose={() => setShowGenerationConfirm(false)} title="AI 智能生成歌单">
          <div className="space-y-4 h-[60vh] flex flex-col">
            {isGenerating ? (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
                    <IconMagic className="w-10 h-10 mb-4 animate-pulse text-indigo-500" />
                    <p>正在搜索并生成歌曲列表...</p>
                </div>
            ) : (
                <>
                    <p className="text-sm text-slate-600">
                        AI 已为专辑 <span className="font-bold">{singer.albums.find(a => a.id === aiTargetAlbumId)?.title}</span> 找到以下歌曲：
                    </p>
                    <div className="flex-1 overflow-y-auto border rounded-md p-2 bg-slate-50">
                        {generatedSongs.length === 0 ? (
                             <div className="flex h-full items-center justify-center text-slate-400 text-sm">
                                未找到歌曲，或者生成失败。
                             </div>
                        ) : (
                            generatedSongs.map((song, idx) => (
                                <div key={idx} className="flex gap-2 mb-2">
                                    <span className="text-slate-400 text-sm py-2 w-6">{idx + 1}.</span>
                                    <Input 
                                        value={song} 
                                        onChange={(e) => {
                                            const newSongs = [...generatedSongs];
                                            newSongs[idx] = e.target.value;
                                            setGeneratedSongs(newSongs);
                                        }} 
                                    />
                                    <button onClick={() => setGeneratedSongs(generatedSongs.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600 px-2">
                                        <IconTrash className="w-4 h-4" />
                                    </button>
                                </div>
                            ))
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setGeneratedSongs([...generatedSongs, "新歌曲"])} className="w-full mt-2 border-dashed border border-slate-300">
                            <IconPlus className="w-4 h-4 mr-1" /> 添加一行
                        </Button>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="ghost" onClick={() => setShowGenerationConfirm(false)}>取消</Button>
                        <Button onClick={handleConfirmAI} disabled={generatedSongs.length === 0}>确认添加</Button>
                    </div>
                </>
            )}
        </div>
      </Modal>
    </div>
  );
};