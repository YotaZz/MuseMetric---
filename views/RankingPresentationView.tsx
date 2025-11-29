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

export const RankingPresentationView: React.FC<RankingPresentationViewProps> = ({ singer, onExit, durationMs }) => {
  const [playlist, setPlaylist] = useState<PresentationSong[]>([]);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  
  // 播放状态
  const [isPlaying, setIsPlaying] = useState(true);
  // 使用 Ref 来在事件回调中获取最新的 isPlaying 状态，避免闭包陷阱
  const isPlayingRef = useRef(true);

  const [currentTime, setCurrentTime] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0); // 无音频时的计时器
  const [permissionNeeded, setPermissionNeeded] = useState(false);
  const [permissionHandle, setPermissionHandle] = useState<FileSystemFileHandle | null>(null);
  const [lrcLines, setLrcLines] = useState<LrcLine[]>([]);
  
  // 核心修复：防跳锁。用来防止 timeUpdate 或 timer 在切歌间隙多次触发 handleNext
  const switchingRef = useRef(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lrcContainerRef = useRef<HTMLDivElement>(null);

  // 同步 Ref
  useEffect(() => {
      isPlayingRef.current = isPlaying;
      if (audioRef.current) {
          if (isPlaying) {
              // 如果变成播放状态，且音频已经就绪（currentTime > 0 或 src 有值），尝试播放
              // 这主要处理用户手动点击“播放”按钮的情况
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
    
    // 1. 重置状态
    setLrcLines([]);
    setCurrentTime(0);
    setElapsedTime(0);
    
    // 关键：当新歌开始加载时，解开防跳锁
    // 注意：我们将解锁放在这里，意味着React已经完成了索引更新和重新渲染
    switchingRef.current = false;
    
    // 2. 清理与初始化 Audio
    if (audioRef.current) {
        audioRef.current.pause();
        // 仅当确实需要切换源时才清空，避免闪烁，但为了安全起见先保留
        audioRef.current.src = ""; 
    }
    
    let isMounted = true;

    const loadMedia = async () => {
        // 无音频情况：不需要加载文件，Timer 会接管
        if (!currentSong.hasAudio) return;

        try {
            const handle = await getFileHandle(currentSong.id, 'audio');
            if (!handle) return;

            const hasPermission = await verifyPermission(handle, false);
            if (!hasPermission) {
                if (isMounted) {
                    setPermissionHandle(handle);
                    setPermissionNeeded(true);
                    setIsPlaying(false); // 强制暂停等待授权
                }
                return;
            }

            const file = await handle.getFile();
            const url = URL.createObjectURL(file);
            
            if (isMounted && audioRef.current) {
                audioRef.current.src = url;
                // 设置起始时间
                const start = currentSong.highlightStartTime || 0;
                audioRef.current.currentTime = start;
                // 不在这里直接 play()，而是依赖 onCanPlay 事件，更加稳健
                
                // 加载歌词
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
  }, [currentSong]); // 仅在 currentSong 变化时触发

  // 核心：处理自动播放
  // 当音频文件加载完毕，浏览器认为可以播放时触发
  const handleCanPlay = () => {
      // 只有在“播放模式”下，且当前歌曲确实有音频时，才自动播放
      if (isPlayingRef.current && currentSong?.hasAudio && audioRef.current) {
          const start = currentSong.highlightStartTime || 0;
          // 再次确保时间正确（有时 src 加载后 currentTime 会重置）
          if (Math.abs(audioRef.current.currentTime - start) > 0.5) {
               audioRef.current.currentTime = start;
          }
          
          const playPromise = audioRef.current.play();
          if (playPromise !== undefined) {
              playPromise.catch(error => {
                  console.log("Autoplay blocked or interrupted:", error);
                  // 如果被阻止，可能需要用户交互，这里可以考虑 setIsPlaying(false)
                  // 但通常在切歌场景下，如果之前已经交互过，是允许自动播放的
              });
          }
      }
  };

  // 定时器逻辑：仅针对【无音频】的歌曲
  useEffect(() => {
    let interval: number;
    // 只有在播放状态、无音频文件、且没有正在切换时运行
    if (isPlaying && currentSong && !currentSong.hasAudio && !switchingRef.current) {
      interval = window.setInterval(() => {
        setElapsedTime(prev => {
           const next = prev + UPDATE_INTERVAL_MS;
           const limit = durationMs > 0 ? durationMs : 15000;
           if (next >= limit) {
               handleNext();
               return prev; // 保持最后的值，等待切换
           }
           return next;
        });
      }, UPDATE_INTERVAL_MS);
    }
    return () => clearInterval(interval);
  }, [isPlaying, currentSong, durationMs]); // 依赖项里不需要 switchingRef，因为 Ref 变化不触发 Effect，但在回调里会读到

  // 音频播放进度处理
  const onAudioTimeUpdate = () => {
      if (audioRef.current && !switchingRef.current) { // 加锁检查
          const now = audioRef.current.currentTime;
          setCurrentTime(now);
          
          // 检查切歌条件
          const start = currentSong?.highlightStartTime || 0;
          const playedDuration = (now - start) * 1000;
          const limit = durationMs > 0 ? durationMs : 15000;

          // 缓冲 500ms 避免刚跳转时的误判
          if (playedDuration >= limit && playedDuration > 500) {
              handleNext();
              return; // 立即返回，后续逻辑不再执行
          }
          
          // 歌词滚动
          if (lrcContainerRef.current) {
             const activeIdx = lrcLines.findIndex((line, i) => {
                 const nextLine = lrcLines[i+1];
                 return line.time <= now && (!nextLine || nextLine.time > now);
             });
             
             if (activeIdx !== -1) {
                 const activeEl = lrcContainerRef.current.children[activeIdx] as HTMLElement;
                 if (activeEl) {
                     lrcContainerRef.current.scrollTo({
                         top: activeEl.offsetTop - lrcContainerRef.current.clientHeight / 2 + 30, // Offset a bit for visual balance
                         behavior: 'smooth'
                     });
                 }
             }
          }
      }
  };

  const handleNext = () => {
      // 关键：防抖锁
      if (switchingRef.current) return;
      switchingRef.current = true;

      if (currentSongIndex < playlist.length - 1) {
          // 切换下一首，状态保持播放
          setCurrentSongIndex(c => c + 1);
      } else {
          // 列表结束，停止播放
          setIsPlaying(false);
          switchingRef.current = false; // 手动解锁，因为不会触发 useEffect [currentSong]
      }
  };

  const handlePrev = () => {
      if (switchingRef.current) return;
      if (currentSongIndex > 0) {
          switchingRef.current = true;
          setCurrentSongIndex(c => c - 1);
      }
  };

  const handleReset = () => {
      setIsPlaying(false);
      switchingRef.current = false;
      setCurrentSongIndex(0);
      setElapsedTime(0);
      setCurrentTime(0);
  };
  
  const handleRequestPermission = async () => {
    if (permissionHandle) {
        await verifyPermission(permissionHandle, false);
        setPermissionNeeded(false);
        setPermissionHandle(null);
        // 授权后恢复播放状态，UI会重渲染，触发 useEffect 里的 play 逻辑 (如果音频已加载)
        // 或者此时用户需要手动点一下播放，这在安全策略上是合理的
        setIsPlaying(true); 
    }
  };

  const getScoreColorClass = (score: number) => {
      if (score > 8.5) return "text-amber-400 drop-shadow-[0_0_5px_rgba(251,191,36,0.5)]";
      if (score >= 7.5) return "text-cyan-400";
      return "text-slate-400";
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
       <style>{`
          .no-scrollbar::-webkit-scrollbar {
            display: none;
          }
          .no-scrollbar {
            -ms-overflow-style: none;
            scrollbar-width: none;
          }
       `}</style>
       <audio 
         ref={audioRef} 
         onTimeUpdate={onAudioTimeUpdate}
         onEnded={handleNext}
         onCanPlay={handleCanPlay} // 绑定就绪事件
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

       {/* Main Content */}
       <div className="relative z-10 flex flex-col h-full p-6 md:p-12 max-w-[1920px] mx-auto">
           {/* Header - Optimized Space */}
           <div className="flex-none mb-6 flex justify-end items-start h-8">
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
           <div className="flex-1 flex flex-col md:flex-row gap-12 lg:gap-24 items-stretch justify-center">
               
               {/* LEFT COLUMN: Visuals (Record & Rank) - Centered Vertically */}
               <div className="flex-1 flex flex-col items-center justify-center relative">
                   <div className="relative group perspective-1000 scale-90 md:scale-100 lg:scale-110 transition-transform duration-700">
                        <div 
                                className={`w-64 h-64 md:w-96 md:h-96 rounded-full border-4 border-white/10 shadow-2xl overflow-hidden relative flex items-center justify-center bg-black ${isPlaying ? 'animate-[spin_10s_linear_infinite]' : ''}`}
                                style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}
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
                            <div className="absolute w-8 h-8 bg-black rounded-full z-30 border border-white/20" />
                        </div>
                        
                        {/* Rank Badge - Enhanced */}
                        <div className="absolute -top-6 -left-6 md:-top-4 md:-left-4 z-40 transition-all hover:scale-105">
                             <div className="relative">
                                <div className="text-8xl md:text-9xl font-black text-transparent bg-clip-text bg-gradient-to-b from-yellow-200 via-amber-500 to-amber-700 drop-shadow-[0_10px_10px_rgba(0,0,0,0.8)] leading-none italic font-sans" style={{ WebkitTextStroke: '1px rgba(255,255,255,0.1)' }}>
                                    <span className="text-5xl md:text-7xl mr-1 opacity-90 align-top not-italic text-amber-500">#</span>{currentSong.rank}
                                </div>
                             </div>
                        </div>
                   </div>
               </div>

               {/* RIGHT COLUMN: Info & Lyrics - Full Height */}
               <div className="flex-1 flex flex-col min-w-0 max-w-3xl justify-center h-full">
                    {/* Top Section: Metadata & Scores */}
                    <div className="space-y-4 animate-in slide-in-from-right-10 fade-in duration-500" key={currentSong.id + 'info'}>
                        <div className="space-y-1">
                            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold leading-tight drop-shadow-lg line-clamp-2 text-white tracking-tight">
                                {currentSong.title}
                            </h1>
                            <p className="text-xl md:text-3xl text-indigo-200/80 font-light tracking-wide flex items-center gap-3">
                                {currentSong.albumName} <span className="text-white/30 text-lg px-2 py-0.5 border border-white/20 rounded-full font-mono">{currentSong.albumYear}</span>
                            </p>
                        </div>

                        {currentSong.comment && (
                            <div className="relative pl-6 border-l-4 border-indigo-500/50 py-1">
                                <p className="text-xl text-white/90 italic font-serif leading-relaxed">"{currentSong.comment}"</p>
                            </div>
                        )}

                        {/* Scores Row - Highlighted */}
                        <div className="flex items-center gap-8 pt-8 pb-4">
                             <div className="flex flex-col relative group cursor-default">
                                 <div className="absolute -top-4 left-0 text-sm font-bold uppercase tracking-[0.3em] text-indigo-300 opacity-70">Total Score</div>
                                 <div className="text-8xl md:text-9xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-indigo-100 to-indigo-300 tracking-tighter drop-shadow-[0_0_30px_rgba(99,102,241,0.6)] leading-none -ml-1">
                                     {currentSong.totalScore.toFixed(2)}
                                 </div>
                             </div>
                             
                             <div className="h-24 w-px bg-gradient-to-b from-transparent via-white/20 to-transparent mx-2 hidden sm:block"></div>

                             <div className="flex gap-8 hidden sm:flex">
                                 <div className="flex flex-col items-center gap-1">
                                     <div className="text-xs text-slate-400 uppercase tracking-wider">作词</div>
                                     <div className={`text-4xl font-bold font-mono ${getScoreColorClass(currentSong.scores.lyrics)}`}>{currentSong.scores.lyrics.toFixed(1)}</div>
                                 </div>
                                 <div className="flex flex-col items-center gap-1">
                                     <div className="text-xs text-slate-400 uppercase tracking-wider">作曲</div>
                                     <div className={`text-4xl font-bold font-mono ${getScoreColorClass(currentSong.scores.composition)}`}>{currentSong.scores.composition.toFixed(1)}</div>
                                 </div>
                                 <div className="flex flex-col items-center gap-1">
                                     <div className="text-xs text-slate-400 uppercase tracking-wider">编曲</div>
                                     <div className={`text-4xl font-bold font-mono ${getScoreColorClass(currentSong.scores.arrangement)}`}>{currentSong.scores.arrangement.toFixed(1)}</div>
                                 </div>
                             </div>
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="h-px w-full bg-gradient-to-r from-white/20 via-white/10 to-transparent my-6" />

                    {/* Bottom Section: Lyrics Area */}
                    <div className="relative w-full h-64 md:h-80 lg:h-96 flex-col justify-end">
                       {lrcLines.length > 0 ? (
                           <div className="absolute inset-0 w-full h-full">
                                {/* Gradient Mask for Fade Effect */}
                                <div 
                                    className="h-full w-full overflow-hidden"
                                    style={{ 
                                        maskImage: 'linear-gradient(180deg, transparent 0%, #000 15%, #000 85%, transparent 100%)',
                                        WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, #000 15%, #000 85%, transparent 100%)'
                                    }}
                                >
                                    <div 
                                        ref={lrcContainerRef} 
                                        className="h-full overflow-y-auto no-scrollbar scroll-smooth py-[50%] md:py-32 pr-4"
                                    >
                                        {lrcLines.map((line, idx) => {
                                            const isActive = line.time <= currentTime && (!lrcLines[idx+1] || lrcLines[idx+1].time > currentTime);
                                            return (
                                                <div 
                                                    key={idx} 
                                                    className={`
                                                        transition-all duration-500 ease-out origin-left mb-5
                                                        ${isActive 
                                                            ? 'text-yellow-400 scale-105 font-bold drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] opacity-100' 
                                                            : 'text-white/30 scale-100 blur-[0.5px] opacity-60'
                                                        }
                                                    `}
                                                >
                                                    <p className="text-xl md:text-2xl lg:text-3xl leading-relaxed whitespace-pre-wrap break-words">
                                                        {line.text}
                                                    </p>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                           </div>
                       ) : (
                           <div className="h-full w-full flex items-center justify-start text-white/10 text-xl font-light italic">
                               <p>Instrumental / No Lyrics Available</p>
                           </div>
                       )}
                    </div>
               </div>
           </div>

           {/* Footer Controls */}
           <div className="flex-none mt-4 mb-10 flex justify-between items-center relative z-50">
                <div className="text-sm text-white/30 font-mono hidden md:block">
                     Current: {currentSongIndex + 1} / {playlist.length}
                </div>

                <div className="flex items-center gap-4 bg-black/40 backdrop-blur-md rounded-full p-2 border border-white/10 shadow-xl transform hover:scale-105 transition-transform">
                     <button onClick={handleReset} className="p-3 rounded-full hover:bg-white/10 transition-colors text-white/50 hover:text-white" title="Replay All">
                         <IconRefresh className="w-5 h-5" />
                     </button>
                     
                     <button 
                        onClick={handlePrev} 
                        disabled={currentSongIndex === 0}
                        className="p-3 rounded-full hover:bg-white/10 transition-colors text-white/50 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                     >
                        <IconChevronLeft className="w-5 h-5" />
                     </button>

                     <button 
                        onClick={() => setIsPlaying(!isPlaying)} 
                        className="p-4 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 transition-all active:scale-95"
                     >
                         {isPlaying ? <IconPause className="w-6 h-6 fill-current" /> : <IconPlay className="w-6 h-6 fill-current ml-0.5" />}
                     </button>

                     <button 
                        onClick={handleNext} 
                        disabled={currentSongIndex === playlist.length - 1}
                        className="p-3 rounded-full hover:bg-white/10 transition-colors text-white/50 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                     >
                        <IconChevronRight className="w-5 h-5" />
                     </button>

                     <button onClick={onExit} className="p-3 rounded-full hover:bg-white/10 transition-colors text-white/50 hover:text-red-400" title="Exit Presentation">
                         <IconX className="w-5 h-5" />
                     </button>
                </div>
                
                <div className="w-20 hidden md:block"></div> {/* Spacer for center alignment */}
           </div>
       </div> 
    </div> 
  );
};