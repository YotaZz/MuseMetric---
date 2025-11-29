import React, { useState, useEffect, useRef } from 'react';
import { Singer } from '../types';
import { getPresentationSongs, PresentationSong, parseLrc, LrcLine } from '../utils';
import { IconPlay, IconPause, IconRefresh, IconX, IconMusic } from '../components/Icons';
import { Button } from '../components/UI';
import { getFileHandle, verifyPermission, StoredFile } from '../db';

interface RankingPresentationViewProps {
  singer: Singer;
  onExit: () => void;
  durationMs: number;
}

const UPDATE_INTERVAL_MS = 100;

export const RankingPresentationView: React.FC<RankingPresentationViewProps> = ({ singer, onExit, durationMs }) => {
  const [playlist, setPlaylist] = useState<PresentationSong[]>([]);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0); // For timer-based fallback
  const [currentTime, setCurrentTime] = useState(0); // Actual Audio Time
  const [permissionNeeded, setPermissionNeeded] = useState(false);
  const [permissionHandle, setPermissionHandle] = useState<StoredFile | null>(null);
  const [lrcLines, setLrcLines] = useState<LrcLine[]>([]);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lrcContainerRef = useRef<HTMLDivElement>(null);

  // Initialize playlist
  useEffect(() => {
    const songs = getPresentationSongs(singer);
    setPlaylist(songs);
  }, [singer]);

  const currentSong = playlist[currentSongIndex];

  // Helper to extract file content from handle or file object
  const resolveFileContent = async (handle: StoredFile): Promise<File> => {
      if (handle instanceof File) {
          return handle;
      }
      return await handle.getFile();
  };

  // Load Audio and LRC
  useEffect(() => {
    if (!currentSong) return;
    
    // Reset state
    setLrcLines([]);
    setCurrentTime(0);
    setElapsedTime(0);
    
    let isMounted = true;

    const loadMedia = async () => {
        if (!currentSong.hasAudio) {
            // Fallback mode
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.src = "";
            }
            if (isPlaying) {
                // Keep playing state true to trigger timer effect
            }
            return;
        }

        try {
            const handle = await getFileHandle(currentSong.id, 'audio');
            if (!handle) return;

            const hasPermission = await verifyPermission(handle, false);
            if (!hasPermission) {
                if (isMounted) {
                    setPermissionHandle(handle);
                    setPermissionNeeded(true);
                    setIsPlaying(false);
                }
                return;
            }

            const file = await resolveFileContent(handle);
            const url = URL.createObjectURL(file);
            
            if (audioRef.current) {
                audioRef.current.src = url;
                const start = currentSong.highlightStartTime || 0;
                audioRef.current.currentTime = start;
                setCurrentTime(start); // Init UI immediately
                
                if (isPlaying) {
                    audioRef.current.play().catch(e => console.log("Autoplay prevented", e.message));
                }
            }

            // Load LRC if exists
            if (currentSong.hasLrc) {
                const lrcHandle = await getFileHandle(currentSong.id, 'lrc');
                if (lrcHandle && await verifyPermission(lrcHandle, false)) {
                    const lrcFile = await resolveFileContent(lrcHandle);
                    const text = await lrcFile.text();
                    if (isMounted) setLrcLines(parseLrc(text));
                }
            }

        } catch (err) {
            console.error("Error loading media", err);
        }
    };

    loadMedia();

    return () => {
        isMounted = false;
        if (audioRef.current) {
             audioRef.current.pause();
             URL.revokeObjectURL(audioRef.current.src);
        }
    };
  }, [currentSong?.id, currentSong?.hasAudio, currentSong?.hasLrc]); // Re-run when song changes

  // Playback Control Effect
  useEffect(() => {
      if (!audioRef.current) return;
      
      if (isPlaying && !permissionNeeded && currentSong?.hasAudio) {
          audioRef.current.play().catch(() => setIsPlaying(false));
      } else {
          audioRef.current.pause();
      }
  }, [isPlaying, permissionNeeded, currentSong?.hasAudio]);

  // Timer Logic (Fallback for non-audio or when waiting)
  useEffect(() => {
    let interval: number;
    // Only run fallback timer if NO AUDIO file is present. 
    // If audio is present, we rely on `timeupdate` and `ended` events.
    if (isPlaying && currentSong && !currentSong.hasAudio) {
      interval = window.setInterval(() => {
        setElapsedTime(prev => {
           const next = prev + UPDATE_INTERVAL_MS;
           // Fallback duration logic
           const limit = durationMs > 0 ? durationMs : 15000;
           if (next >= limit) {
               handleNext();
               return 0; 
           }
           return next;
        });
      }, UPDATE_INTERVAL_MS);
    }
    return () => clearInterval(interval);
  }, [isPlaying, currentSong, durationMs]);

  // Audio Event Handlers
  const onAudioTimeUpdate = () => {
      if (audioRef.current) {
          setCurrentTime(audioRef.current.currentTime);
          
          // Scroll Lyrics
          // Simple logic: Find active index, scroll container
          if (lrcContainerRef.current) {
             const activeIdx = lrcLines.findIndex((line, i) => {
                 const nextLine = lrcLines[i+1];
                 return line.time <= audioRef.current!.currentTime && (!nextLine || nextLine.time > audioRef.current!.currentTime);
             });
             
             if (activeIdx !== -1) {
                 const activeEl = lrcContainerRef.current.children[activeIdx] as HTMLElement;
                 if (activeEl) {
                     lrcContainerRef.current.scrollTo({
                         top: activeEl.offsetTop - lrcContainerRef.current.clientHeight / 2 + 20,
                         behavior: 'smooth'
                     });
                 }
             }
          }
      }
  };

  const handleNext = () => {
      if (currentSongIndex < playlist.length - 1) {
          setCurrentSongIndex(c => c + 1);
          setElapsedTime(0);
          // Keep playing
      } else {
          setIsPlaying(false);
      }
  };

  const handleRequestPermission = async () => {
      if (permissionHandle) {
          await verifyPermission(permissionHandle, false); // This triggers the prompt
          setPermissionNeeded(false);
          setPermissionHandle(null);
          setIsPlaying(true); // Auto start
          
          // Reload current song media logic
           if (currentSong) {
               const handle = permissionHandle;
               const file = await resolveFileContent(handle);
               const url = URL.createObjectURL(file);
               if (audioRef.current) {
                    audioRef.current.src = url;
                    audioRef.current.currentTime = currentSong.highlightStartTime || 0;
                    audioRef.current.play();
               }
               // Also load LRC
               if(currentSong.hasLrc) {
                   const lrcHandle = await getFileHandle(currentSong.id, 'lrc');
                   if (lrcHandle && await verifyPermission(lrcHandle, false)) {
                       const lrcFile = await resolveFileContent(lrcHandle);
                       const text = await lrcFile.text();
                       setLrcLines(parseLrc(text));
                   }
               }
           }
      }
  };

  const handleReset = () => {
      setIsPlaying(false);
      setCurrentSongIndex(0);
      setElapsedTime(0);
      setCurrentTime(0);
  };

  const getScoreColorClass = (score: number) => {
      if (score > 8.5) return "text-amber-400 drop-shadow-[0_0_5px_rgba(251,191,36,0.5)]"; // Excellent
      if (score >= 7.5) return "text-cyan-400"; // Good
      return "text-slate-400"; // Average
  };

  if (playlist.length === 0) {
      return (
          <div className="fixed inset-0 z-50 bg-slate-900 text-white flex flex-col items-center justify-center">
              <p className="mb-4">该歌手暂无评分数据，无法生成榜单。</p>
              <Button onClick={onExit}>退出</Button>
          </div>
      );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black text-white font-sans overflow-hidden select-none">
       {/* Audio Element */}
       <audio 
         ref={audioRef} 
         onTimeUpdate={onAudioTimeUpdate}
         onEnded={handleNext}
         onError={(e) => console.log("Audio Error Occurred", (e.currentTarget as HTMLAudioElement).error?.message || 'Unknown error')}
       />

       {/* Permission Overlay */}
       {permissionNeeded && (
           <div className="absolute inset-0 z-[60] bg-black/80 flex flex-col items-center justify-center backdrop-blur-sm">
               <div className="bg-white text-slate-900 p-8 rounded-xl max-w-md text-center shadow-2xl">
                   <h3 className="text-xl font-bold mb-4">需要文件访问权限</h3>
                   <p className="text-slate-600 mb-6">为了播放本地音频文件，浏览器需要您再次确认授权。</p>
                   <Button onClick={handleRequestPermission} className="w-full py-3 text-lg">点击授权并播放</Button>
                   <Button variant="ghost" onClick={onExit} className="mt-4 w-full">退出</Button>
               </div>
           </div>
       )}

       {/* Background Layer with Blur */}
       <div className="absolute inset-0 z-0">
           {currentSong.albumCover ? (
                <img 
                    src={currentSong.albumCover} 
                    className="w-full h-full object-cover blur-xl opacity-40 scale-110 transition-all duration-1000" 
                    key={currentSong.id + 'bg'} 
                />
           ) : (
                <div className="w-full h-full bg-gradient-to-br from-indigo-900 to-black opacity-50" />
           )}
           <div className="absolute inset-0 bg-black/40" />
       </div>

       {/* Main Content Container */}
       <div className="relative z-10 flex flex-col h-full p-8 md:p-16">
           
           {/* Header */}
           <div className="flex-none mb-4 flex justify-between items-start">
                <div className="inline-block px-4 py-1 bg-white/10 backdrop-blur-md rounded-full border border-white/20 text-sm font-medium tracking-wider text-indigo-200 uppercase">
                    Ranking Countdown
                </div>
                {/* Visualizer / Status */}
                {isPlaying && (
                    <div className="flex items-center gap-1 h-6">
                        <div className="w-1 bg-indigo-400 animate-[bounce_1s_infinite] h-full"></div>
                        <div className="w-1 bg-indigo-400 animate-[bounce_1.2s_infinite] h-3/4"></div>
                        <div className="w-1 bg-indigo-400 animate-[bounce_0.8s_infinite] h-full"></div>
                        <div className="w-1 bg-indigo-400 animate-[bounce_1.5s_infinite] h-1/2"></div>
                    </div>
                )}
           </div>

           {/* Central Stage */}
           <div className="flex-1 flex flex-col md:flex-row items-center gap-8 md:gap-16 justify-center">
               
               {/* Left: Rotating Vinyl & Lyrics */}
               <div className="relative flex flex-col items-center w-full md:w-auto">
                   <div className="relative group perspective-1000">
                        <div 
                                className={`w-56 h-56 md:w-80 md:h-80 rounded-full border-4 border-white/10 shadow-2xl overflow-hidden relative flex items-center justify-center bg-black ${isPlaying ? 'animate-[spin_10s_linear_infinite]' : ''}`}
                                style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}
                        >
                            <div className="absolute inset-0 rounded-full border-[15px] border-black/80 z-20" />
                            <div className="absolute inset-0 rounded-full bg-[conic-gradient(transparent_0deg,rgba(255,255,255,0.1)_45deg,transparent_90deg)] z-20 pointer-events-none" />
                            
                            {currentSong.albumCover ? (
                                <img src={currentSong.albumCover} className="w-full h-full object-cover z-10" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center bg-slate-800 z-10">
                                    <IconMusic className="w-24 h-24 text-slate-600" />
                                </div>
                            )}
                            
                            <div className="absolute w-6 h-6 bg-black rounded-full z-30 border border-white/20" />
                        </div>
                        
                        {/* Rank Badge */}
                        <div className="absolute -top-2 -left-2 md:top-0 md:left-0 z-40">
                                <div className="text-5xl md:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-br from-yellow-300 to-yellow-600 drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)] font-mono italic">
                                    #{currentSong.rank}
                                </div>
                        </div>
                   </div>

                   {/* Lyrics Container */}
                   {lrcLines.length > 0 && (
                       <div className="mt-8 h-24 md:h-32 w-full max-w-md overflow-hidden relative mask-image-gradient">
                            <div 
                                ref={lrcContainerRef} 
                                className="h-full overflow-y-auto no-scrollbar space-y-3 text-center scroll-smooth"
                                style={{ scrollBehavior: 'smooth' }}
                            >
                                {lrcLines.map((line, idx) => {
                                    const isActive = line.time <= currentTime && (!lrcLines[idx+1] || lrcLines[idx+1].time > currentTime);
                                    return (
                                        <p 
                                            key={idx} 
                                            className={`transition-all duration-300 ${isActive ? 'text-yellow-300 font-bold scale-110 drop-shadow-md' : 'text-white/30 text-sm'}`}
                                        >
                                            {line.text}
                                        </p>
                                    )
                                })}
                            </div>
                            {/* Gradient Masks */}
                            <div className="absolute top-0 inset-x-0 h-4 bg-gradient-to-b from-black/80 to-transparent pointer-events-none"></div>
                            <div className="absolute bottom-0 inset-x-0 h-4 bg-gradient-to-t from-black/80 to-transparent pointer-events-none"></div>
                       </div>
                   )}
               </div>

               {/* Right: Info & Scores */}
               <div className="flex-1 text-center md:text-left space-y-6 max-w-2xl w-full">
                    <div className="space-y-2 animate-in slide-in-from-right-10 fade-in duration-500" key={currentSong.id + 'title'}>
                        <h1 className="text-3xl md:text-5xl font-bold leading-tight drop-shadow-lg line-clamp-2">
                            {currentSong.title}
                        </h1>
                        <p className="text-lg md:text-2xl text-white/70 font-light">
                            {currentSong.albumName} <span className="text-white/40 text-base">({currentSong.albumYear})</span>
                        </p>
                    </div>

                    {/* Comment Display */}
                    {currentSong.comment && (
                        <div className="bg-white/5 backdrop-blur-sm border-l-4 border-indigo-500 px-4 py-3 rounded-r-lg mx-auto md:mx-0 inline-block text-left">
                            <p className="text-base md:text-lg text-indigo-100 italic font-serif leading-relaxed">
                                "{currentSong.comment}"
                            </p>
                        </div>
                    )}

                    <div className="space-y-6 pt-4">
                        {/* Main Score */}
                        <div className="inline-flex flex-col items-center md:items-start">
                             <span className="text-xs uppercase tracking-[0.2em] text-indigo-300 mb-1">Total Score</span>
                             <div className="text-6xl md:text-8xl font-black text-white tracking-tighter drop-shadow-[0_0_15px_rgba(99,102,241,0.6)]">
                                 {currentSong.totalScore.toFixed(2)}
                             </div>
                        </div>

                        {/* Sub Scores with Colored Logic */}
                        <div className="grid grid-cols-3 gap-4 md:gap-6 pt-6 border-t border-white/10">
                             <div className="text-center md:text-left">
                                 <div className="text-xs text-white/50 mb-1">作词</div>
                                 <div className={`text-2xl md:text-3xl font-bold font-mono ${getScoreColorClass(currentSong.scores.lyrics)}`}>
                                     {currentSong.scores.lyrics.toFixed(1)}
                                 </div>
                             </div>
                             <div className="text-center md:text-left">
                                 <div className="text-xs text-white/50 mb-1">作曲</div>
                                 <div className={`text-2xl md:text-3xl font-bold font-mono ${getScoreColorClass(currentSong.scores.composition)}`}>
                                     {currentSong.scores.composition.toFixed(1)}
                                 </div>
                             </div>
                             <div className="text-center md:text-left">
                                 <div className="text-xs text-white/50 mb-1">编曲</div>
                                 <div className={`text-2xl md:text-3xl font-bold font-mono ${getScoreColorClass(currentSong.scores.arrangement)}`}>
                                     {currentSong.scores.arrangement.toFixed(1)}
                                 </div>
                             </div>
                        </div>
                    </div>
               </div>
           </div>

           {/* Bottom: Controls */}
           <div className="flex-none mt-8 flex justify-center md:justify-end relative z-50">
                <div className="flex items-center gap-4 md:gap-6 p-3 bg-black/50 backdrop-blur-md rounded-full border border-white/10 shadow-2xl">
                     <div className="text-sm text-white/50 font-mono ml-3 border-r border-white/10 pr-4 mr-2 hidden sm:block">
                         {currentSongIndex + 1} <span className="text-white/30">/</span> {playlist.length}
                     </div>
                     
                     <div className="flex gap-2">
                         <button 
                            onClick={handleReset} 
                            className="p-3 rounded-full hover:bg-white/10 transition-colors text-white/70 hover:text-white"
                            title="重置"
                         >
                             <IconRefresh className="w-5 h-5" />
                         </button>
                         <button 
                            onClick={() => setIsPlaying(!isPlaying)} 
                            className="p-3 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 transition-all hover:scale-105"
                            title={isPlaying ? "暂停" : "播放"}
                         >
                             {isPlaying ? <IconPause className="w-6 h-6 fill-current" /> : <IconPlay className="w-6 h-6 fill-current ml-0.5" />}
                         </button>
                     </div>

                     <button 
                        onClick={onExit} 
                        className="flex items-center gap-2 px-4 py-2 rounded-full hover:bg-white/10 text-white/70 hover:text-white transition-colors ml-2"
                     >
                         <span className="text-xs font-bold tracking-wider">EXIT</span>
                         <IconX className="w-4 h-4" />
                     </button>
                </div>
           </div>
    </div>
  );
};