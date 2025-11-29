import React, { useState, useEffect, useRef } from 'react';
import { Singer } from '../types';
import { getPresentationSongs, PresentationSong, parseLrc, LrcLine } from '../utils';
import { IconPlay, IconPause, IconRefresh, IconX, IconMusic, IconChevronLeft, IconChevronRight } from '../components/Icons';
import { Button } from '../components/UI';
import { getFileHandle, verifyPermission } from '../db';

interface RankingPresentationViewProps {
  singer: Singer;
  onExit: () => void;
  durationMs: number;
}

const UPDATE_INTERVAL_MS = 100;
// 歌词同步补偿值
const LYRIC_SYNC_OFFSET = 0.5;
// 过渡动画时长 (毫秒)
const TRANSITION_DURATION_MS = 600;

export const RankingPresentationView: React.FC<RankingPresentationViewProps> = ({ singer, onExit, durationMs }) => {
  const [playlist, setPlaylist] = useState<PresentationSong[]>([]);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  
  // 播放状态
  const [isPlaying, setIsPlaying] = useState(true);
  const isPlayingRef = useRef(true);
  
  // 控制栏折叠状态
  const [showControls, setShowControls] = useState(true);

  // 跳转排名状态
  const [targetRank, setTargetRank] = useState('');

  // 过渡状态
  const [isTransitioning, setIsTransitioning] = useState(false);

  const [currentTime, setCurrentTime] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0); 
  const [permissionNeeded, setPermissionNeeded] = useState(false);
  const [permissionHandle, setPermissionHandle] = useState<FileSystemFileHandle | null>(null);
  const [lrcLines, setLrcLines] = useState<LrcLine[]>([]);
  
  const switchingRef = useRef(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lrcContainerRef = useRef<HTMLDivElement>(null);

  // --- 核心：处理淡入淡出过渡的通用函数 ---
  const performTransition = (nextAction: () => void) => {
      if (switchingRef.current || isTransitioning) return;
      
      switchingRef.current = true; // 锁定
      setIsPlaying(false); // 暂停
      setIsTransitioning(true); // 淡出

      setTimeout(() => {
          nextAction(); // 数据切换

          setTimeout(() => {
              setIsTransitioning(false); // 淡入
              setIsPlaying(true); // 恢复播放
              switchingRef.current = false; // 解锁
          }, 50);
          
      }, TRANSITION_DURATION_MS);
  };

  // 同步 Ref
  useEffect(() => {
      isPlayingRef.current = isPlaying;
      if (audioRef.current) {
          if (isPlaying) {
              if (audioRef.current.readyState >= 3) {
                   audioRef.current.play().catch(() => {});
              }
          } else {
              audioRef.current.pause();
          }
      }
  }, [isPlaying]);

  // 初始化播放列表
  useEffect(() => {
    const songs = getPresentationSongs(singer);
    setPlaylist(songs);
  }, [singer]);

  const currentSong = playlist[currentSongIndex];

  // 歌曲加载副作用
  useEffect(() => {
    if (!currentSong) return;
    
    setLrcLines([]);
    setCurrentTime(0);
    setElapsedTime(0);
    
    if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = ""; 
    }
    
    let isMounted = true;

    const loadMedia = async () => {
        if (!currentSong.hasAudio) return;

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

            const file = await handle.getFile();
            const url = URL.createObjectURL(file);
            
            if (isMounted && audioRef.current) {
                audioRef.current.src = url;
                const start = currentSong.highlightStartTime || 0;
                audioRef.current.currentTime = start;
                
                if (currentSong.hasLrc) {
                    const lrcHandle = await getFileHandle(currentSong.id, 'lrc');
                    if (lrcHandle && await verifyPermission(lrcHandle, false)) {
                        const lrcFile = await lrcHandle.getFile();
                        const text = await lrcFile.text();
                        if (isMounted) setLrcLines(parseLrc(text));
                    }
                }
            }

        } catch (err) {
            console.error("Error loading media", err);
        }
    };

    loadMedia();

    return () => {
        isMounted = false;
        if (audioRef.current && audioRef.current.src) {
             URL.revokeObjectURL(audioRef.current.src);
        }
    };
  }, [currentSong]); 

  const handleCanPlay = () => {
      if (isPlayingRef.current && !isTransitioning && currentSong?.hasAudio && audioRef.current) {
          const start = currentSong.highlightStartTime || 0;
          if (Math.abs(audioRef.current.currentTime - start) > 0.5) {
               audioRef.current.currentTime = start;
          }
          
          const playPromise = audioRef.current.play();
          if (playPromise !== undefined) {
              playPromise.catch(error => {
                  console.log("Autoplay blocked or interrupted:", error);
              });
          }
      }
  };

  useEffect(() => {
    let interval: number;
    if (isPlaying && currentSong && !currentSong.hasAudio && !switchingRef.current) {
      interval = window.setInterval(() => {
        setElapsedTime(prev => {
           const next = prev + UPDATE_INTERVAL_MS;
           const limit = durationMs > 0 ? durationMs : 15000;
           if (next >= limit) {
               handleNext();
               return prev; 
           }
           return next;
        });
      }, UPDATE_INTERVAL_MS);
    }
    return () => clearInterval(interval);
  }, [isPlaying, currentSong, durationMs]);

  const onAudioTimeUpdate = () => {
      if (audioRef.current && !switchingRef.current) { 
          const now = audioRef.current.currentTime;
          setCurrentTime(now);
          
          const start = currentSong?.highlightStartTime || 0;
          const playedDuration = (now - start) * 1000;
          const limit = durationMs > 0 ? durationMs : 15000;

          if (playedDuration >= limit && playedDuration > 500) {
              handleNext();
              return; 
          }
          
          if (lrcContainerRef.current) {
             const syncTime = now + LYRIC_SYNC_OFFSET;
             const activeIdx = lrcLines.findIndex((line, i) => {
                 const nextLine = lrcLines[i+1];
                 return line.time <= syncTime && (!nextLine || nextLine.time > syncTime);
             });
             
             if (activeIdx !== -1) {
                 const activeEl = lrcContainerRef.current.children[activeIdx] as HTMLElement;
                 if (activeEl) {
                     lrcContainerRef.current.scrollTo({
                         top: activeEl.offsetTop - lrcContainerRef.current.clientHeight / 2 + 30, 
                         behavior: 'smooth'
                     });
                 }
             }
          }
      }
  };

  const handleNext = () => {
      if (currentSongIndex < playlist.length - 1) {
          performTransition(() => {
              setCurrentSongIndex(c => c + 1);
          });
      } else {
          setIsPlaying(false);
      }
  };

  const handlePrev = () => {
      if (currentSongIndex > 0) {
          performTransition(() => {
              setCurrentSongIndex(c => c - 1);
          });
      }
  };

  const handleReset = () => {
      performTransition(() => {
          setCurrentSongIndex(0);
          setElapsedTime(0);
          setCurrentTime(0);
      });
  };
  
  const handleRequestPermission = async () => {
    if (permissionHandle) {
        await verifyPermission(permissionHandle, false);
        setPermissionNeeded(false);
        setPermissionHandle(null);
        setIsPlaying(true); 
    }
  };

  const handleJumpToRank = () => {
      if (!targetRank) return;
      const rank = parseInt(targetRank);
      if (isNaN(rank)) return;

      const index = playlist.findIndex(song => song.rank === rank);
      
      if (index !== -1 && index !== currentSongIndex) {
          performTransition(() => {
              setCurrentSongIndex(index);
              setTargetRank('');
          });
      } else {
          setTargetRank('');
      }
  };

  const getScoreColorClass = (score: number) => {
      if (score > 8.5) return "text-amber-400 drop-shadow-[0_0_5px_rgba(251,191,36,0.5)]";
      if (score >= 7.5) return "text-cyan-400";
      return "text-slate-400";
  };

  const transitionClass = `transition-opacity ease-in-out duration-${TRANSITION_DURATION_MS} ${isTransitioning ? 'opacity-0' : 'opacity-100'}`;

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
       <style>{`
          .no-scrollbar::-webkit-scrollbar {
            display: none;
          }
          .no-scrollbar {
            -ms-overflow-style: none;
            scrollbar-width: none;
          }
          .duration-${TRANSITION_DURATION_MS} {
              transition-duration: ${TRANSITION_DURATION_MS}ms;
          }
       `}</style>
       <audio 
         ref={audioRef} 
         onTimeUpdate={onAudioTimeUpdate}
         onEnded={handleNext}
         onCanPlay={handleCanPlay} 
         onError={(e) => console.log("Audio Error", e)}
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

       {/* Background Layer */}
       <div className={`absolute inset-0 z-0 ${transitionClass}`}>
           {currentSong.albumCover ? (
                <img 
                    src={currentSong.albumCover} 
                    className="w-full h-full object-cover blur-xl opacity-40 scale-110 transition-transform duration-1000" 
                    key={currentSong.id + 'bg'} 
                />
           ) : (
                <div className="w-full h-full bg-gradient-to-br from-indigo-900 to-black opacity-50" />
           )}
           <div className="absolute inset-0 bg-black/40" />
       </div>

       {/* Main Content */}
       <div className="relative z-10 flex flex-col h-full p-6 md:p-8 max-w-[1600px] mx-auto">
           {/* Header */}
           <div className="flex-none mb-2 md:mb-4 flex justify-end items-start h-8">
                {isPlaying && !isTransitioning && (
                    <div className="flex items-center gap-1 h-6">
                        <div className="w-1 bg-indigo-400 animate-[bounce_1s_infinite] h-full"></div>
                        <div className="w-1 bg-indigo-400 animate-[bounce_1.2s_infinite] h-3/4"></div>
                        <div className="w-1 bg-indigo-400 animate-[bounce_0.8s_infinite] h-full"></div>
                        <div className="w-1 bg-indigo-400 animate-[bounce_1.5s_infinite] h-1/2"></div>
                    </div>
                )}
           </div>

           {/* Central Stage - Gap 回调 */}
           <div className="flex-1 flex flex-col md:flex-row gap-8 lg:gap-16 items-stretch justify-center overflow-hidden">
               
               {/* LEFT COLUMN: Visuals (Record & Rank) */}
               <div className={`flex-1 flex flex-col items-center justify-center relative ${transitionClass}`}>
                   <div className="relative group perspective-1000 scale-90 md:scale-100 transition-transform duration-700">
                        {/* 唱片容器：尺寸回调到 w-[30rem] (约480px) */}
                        <div 
                                className={`w-64 h-64 md:w-80 md:h-80 lg:w-[30rem] lg:h-[30rem] rounded-full border-4 border-white/10 shadow-2xl overflow-hidden relative flex items-center justify-center bg-black ${isPlaying && !isTransitioning ? 'animate-[spin_20s_linear_infinite]' : ''}`}
                                style={{ animationPlayState: isPlaying && !isTransitioning ? 'running' : 'paused' }}
                        >
                            <div className="absolute inset-0 rounded-full border-[20px] border-black/80 z-20" />
                            <div className="absolute inset-0 rounded-full bg-[conic-gradient(transparent_0deg,rgba(255,255,255,0.1)_45deg,transparent_90deg)] z-20 pointer-events-none" />
                            {currentSong.albumCover ? (
                                <img src={currentSong.albumCover} className="w-full h-full object-cover z-10" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center bg-slate-800 z-10">
                                    <IconMusic className="w-32 h-32 text-slate-600" />
                                </div>
                            )}
                        </div>
                        
                        {/* Rank Badge: 尺寸回调 */}
                        <div className="absolute -top-6 -left-6 md:-top-4 md:-left-4 z-40 transition-all hover:scale-105">
                             <div className="relative">
                                {/* 字号回调到 text-[9rem] */}
                                <div className="text-7xl md:text-[9rem] pr-6 font-black text-transparent bg-clip-text bg-gradient-to-b from-yellow-200 via-amber-500 to-amber-700 drop-shadow-[0_10px_10px_rgba(0,0,0,0.8)] leading-none italic font-sans" style={{ WebkitTextStroke: '1.5px rgba(255,255,255,0.1)' }}>
                                    <span className="text-4xl md:text-6xl mr-1 opacity-90 align-top not-italic text-amber-500">#</span>{currentSong.rank}
                                </div>
                             </div>
                        </div>
                   </div>
               </div>

               {/* RIGHT COLUMN: Info & Lyrics */}
               <div className={`flex-1 flex flex-col min-w-0 max-w-4xl justify-center h-full ${transitionClass}`}>
                    {/* Top Section */}
                    <div className="space-y-4" key={currentSong.id + 'info'}>
                        <div className="space-y-1">
                            {/* 标题：字号回调 text-6xl */}
                            <h1 className="text-3xl md:text-5xl lg:text-6xl font-bold leading-normal drop-shadow-lg line-clamp-2 text-white tracking-tight pb-2">
                                {currentSong.title}
                            </h1>
                            {/* 专辑信息：字号回调 text-2xl */}
                            <p className="text-lg md:text-2xl text-indigo-200/80 font-light tracking-wide flex items-center gap-3">
                                {currentSong.albumName} <span className="text-white/30 text-base px-2 py-0.5 border border-white/20 rounded-full font-mono">{currentSong.albumYear}</span>
                            </p>
                        </div>

                        {currentSong.comment && (
                            <div className="relative pl-6 border-l-4 border-indigo-500/50 py-1">
                                <p className="text-lg text-white/90 italic font-serif leading-relaxed">"{currentSong.comment}"</p>
                            </div>
                        )}

                        {/* Scores Row */}
                        <div className="flex items-center gap-8 pt-6 pb-2">
                             <div className="flex flex-col relative group cursor-default">
                                 {/* Total Label: 位置尺寸回调 */}
                                 <div className="absolute -top-5 left-0 text-sm font-bold uppercase tracking-[0.3em] text-indigo-300 opacity-80">Total Score</div>
                                 {/* Total Value: 字号回调 text-8xl */}
                                 <div className="text-7xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-indigo-100 to-indigo-300 tracking-tighter drop-shadow-[0_0_30px_rgba(99,102,241,0.6)] leading-none -ml-1">
                                     {currentSong.totalScore.toFixed(2)}
                                 </div>
                             </div>
                             
                             {/* Divider */}
                             <div className="h-20 w-px bg-gradient-to-b from-transparent via-white/20 to-transparent mx-2 hidden sm:block"></div>

                             <div className="flex gap-8 hidden sm:flex">
                                 {/* 维度分: 字号回调到 text-5xl */}
                                 <div className="flex flex-col items-center gap-1">
                                     <div className="text-base font-bold text-indigo-300 uppercase tracking-wider">作词</div>
                                     <div className={`text-5xl font-bold font-mono ${getScoreColorClass(currentSong.scores.lyrics)}`}>{currentSong.scores.lyrics.toFixed(1)}</div>
                                 </div>
                                 <div className="flex flex-col items-center gap-1">
                                     <div className="text-base font-bold text-indigo-300 uppercase tracking-wider">作曲</div>
                                     <div className={`text-5xl font-bold font-mono ${getScoreColorClass(currentSong.scores.composition)}`}>{currentSong.scores.composition.toFixed(1)}</div>
                                 </div>
                                 <div className="flex flex-col items-center gap-1">
                                     <div className="text-base font-bold text-indigo-300 uppercase tracking-wider">编曲</div>
                                     <div className={`text-5xl font-bold font-mono ${getScoreColorClass(currentSong.scores.arrangement)}`}>{currentSong.scores.arrangement.toFixed(1)}</div>
                                 </div>
                             </div>
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="h-px w-full bg-gradient-to-r from-white/20 via-white/10 to-transparent my-4" />

                    {/* Bottom Section: Lyrics Area */}
                    <div className="relative w-full h-56 md:h-72 lg:h-80 flex-col justify-end">
                       {lrcLines.length > 0 ? (
                           <div className="absolute inset-0 w-full h-full">
                                {/* Gradient Mask */}
                                <div 
                                    className="h-full w-full overflow-hidden"
                                    style={{ 
                                        maskImage: 'linear-gradient(180deg, transparent 0%, #000 15%, #000 85%, transparent 100%)',
                                        WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, #000 15%, #000 85%, transparent 100%)'
                                    }}
                                >
                                    <div 
                                        ref={lrcContainerRef} 
                                        className="h-full overflow-y-auto no-scrollbar scroll-smooth py-[50%] md:py-24 pr-4"
                                    >
                                        {lrcLines.map((line, idx) => {
                                            const syncTime = currentTime + LYRIC_SYNC_OFFSET;
                                            const isActive = line.time <= syncTime && (!lrcLines[idx+1] || lrcLines[idx+1].time > syncTime);
                                            return (
                                                <div 
                                                    key={idx} 
                                                    className={`
                                                        transition-all duration-500 ease-out origin-left mb-6
                                                        ${isActive 
                                                            ? 'text-yellow-400 scale-105 font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] opacity-100' 
                                                            : 'text-white/30 scale-100 blur-[0.5px] opacity-60'
                                                        }
                                                    `}
                                                >
                                                    {/* 歌词: 字号回调 text-3xl */}
                                                    <p className="text-lg md:text-xl lg:text-3xl leading-relaxed whitespace-pre-wrap break-words">
                                                        {line.text}
                                                    </p>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                           </div>
                       ) : (
                           <div className="h-full w-full flex items-center justify-start text-white/10 text-2xl font-light italic">
                               <p>Instrumental / No Lyrics Available</p>
                           </div>
                       )}
                    </div>
               </div>
           </div>

           {/* Footer Controls */}
           <div className="flex-none mt-2 mb-4 relative z-50 flex flex-col items-center group/controls">
                {/* Toggle Handle */}
                <button 
                    onClick={() => setShowControls(!showControls)}
                    className="mb-2 text-white/50 hover:text-white transition-colors p-2 rounded-full hover:bg-white/10"
                    title={showControls ? "收起控制栏" : "展开控制栏"}
                >
                     <IconChevronRight className={`w-5 h-5 transition-transform duration-300 ${showControls ? 'rotate-90' : '-rotate-90'}`} />
                </button>

                {/* Controls Container */}
                <div 
                    className={`
                        flex justify-between items-center w-full transition-all duration-500 ease-in-out overflow-hidden transform
                        ${showControls ? 'max-h-24 opacity-100 translate-y-0' : 'max-h-0 opacity-0 translate-y-8'}
                    `}
                >
                    {/* Left: Jump to Rank */}
                    <div className="hidden md:flex items-center gap-4 w-48">
                        <div className="text-sm text-white/30 font-mono whitespace-nowrap">
                             {currentSongIndex + 1} / {playlist.length}
                        </div>
                        <div className="flex items-center bg-white/10 rounded-lg px-2 py-1 transition-colors focus-within:bg-white/20">
                            <span className="text-xs text-white/40 mr-1 select-none">#</span>
                            <input 
                                type="number" 
                                className="w-12 bg-transparent border-none text-white text-xs focus:ring-0 p-0 placeholder-white/20 font-mono"
                                placeholder="Jump"
                                value={targetRank}
                                onChange={(e) => setTargetRank(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleJumpToRank()}
                                disabled={isTransitioning}
                            />
                        </div>
                    </div>

                    {/* Center: Playback Controls */}
                    <div className="flex items-center gap-4 bg-black/40 backdrop-blur-md rounded-full p-2 border border-white/10 shadow-xl transform hover:scale-105 transition-transform scale-90 md:scale-100 mx-auto">
                         <button onClick={handleReset} disabled={isTransitioning} className="p-3 rounded-full hover:bg-white/10 transition-colors text-white/50 hover:text-white disabled:opacity-50" title="Replay All">
                             <IconRefresh className="w-5 h-5" />
                         </button>
                         
                         <button 
                            onClick={handlePrev} 
                            disabled={currentSongIndex === 0 || isTransitioning}
                            className="p-3 rounded-full hover:bg-white/10 transition-colors text-white/50 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                         >
                            <IconChevronLeft className="w-5 h-5" />
                         </button>

                         <button 
                            onClick={() => setIsPlaying(!isPlaying)} 
                            disabled={isTransitioning}
                            className="p-4 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 transition-all active:scale-95 disabled:opacity-80 disabled:hover:bg-indigo-600"
                         >
                             {isPlaying ? <IconPause className="w-6 h-6 fill-current" /> : <IconPlay className="w-6 h-6 fill-current ml-0.5" />}
                         </button>

                         <button 
                            onClick={handleNext} 
                            disabled={currentSongIndex === playlist.length - 1 || isTransitioning}
                            className="p-3 rounded-full hover:bg-white/10 transition-colors text-white/50 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                         >
                            <IconChevronRight className="w-5 h-5" />
                         </button>

                         <button onClick={onExit} className="p-3 rounded-full hover:bg-white/10 transition-colors text-white/50 hover:text-red-400" title="Exit Presentation">
                             <IconX className="w-5 h-5" />
                         </button>
                    </div>
                    
                    <div className="w-48 hidden md:block"></div> 
                </div>
           </div>
       </div> 
    </div> 
  );
};