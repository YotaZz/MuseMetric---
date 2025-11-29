import React, { useState, useEffect, useRef } from 'react';
import { Singer } from '../types';
import { getPresentationSongs, PresentationSong } from '../utils';
import { IconPlay, IconPause, IconRefresh, IconX, IconMusic, IconMessage } from '../components/Icons';
import { Button } from '../components/UI';

interface RankingPresentationViewProps {
  singer: Singer;
  onExit: () => void;
  durationMs: number;
}

const UPDATE_INTERVAL_MS = 100; // Update timer every 100ms

export const RankingPresentationView: React.FC<RankingPresentationViewProps> = ({ singer, onExit, durationMs }) => {
  const [playlist, setPlaylist] = useState<PresentationSong[]>([]);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  
  // Initialize playlist
  useEffect(() => {
    const songs = getPresentationSongs(singer);
    setPlaylist(songs);
  }, [singer]);

  // Timer Logic
  useEffect(() => {
    let interval: number;
    if (isPlaying) {
      interval = window.setInterval(() => {
        setElapsedTime(prev => {
           const next = prev + UPDATE_INTERVAL_MS;
           if (next >= durationMs) {
               // Next song
               if (currentSongIndex < playlist.length - 1) {
                   setCurrentSongIndex(c => c + 1);
                   return 0; // Reset time for next song
               } else {
                   setIsPlaying(false); // End of playlist
                   return durationMs;
               }
           }
           return next;
        });
      }, UPDATE_INTERVAL_MS);
    }
    return () => clearInterval(interval);
  }, [isPlaying, currentSongIndex, playlist.length, durationMs]);

  const handleReset = () => {
      setIsPlaying(false);
      setCurrentSongIndex(0);
      setElapsedTime(0);
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

  const currentSong = playlist[currentSongIndex];

  return (
    <div className="fixed inset-0 z-50 bg-black text-white font-sans overflow-hidden select-none">
       {/* Background Layer with Blur */}
       <div className="absolute inset-0 z-0">
           {currentSong.albumCover ? (
                <img 
                    src={currentSong.albumCover} 
                    className="w-full h-full object-cover blur-xl opacity-40 scale-110 transition-all duration-1000" 
                    key={currentSong.id + 'bg'} // Key change forces animation reset
                />
           ) : (
                <div className="w-full h-full bg-gradient-to-br from-indigo-900 to-black opacity-50" />
           )}
           <div className="absolute inset-0 bg-black/40" /> {/* Dark Overlay */}
       </div>

       {/* Main Content Container */}
       <div className="relative z-10 flex flex-col h-full p-8 md:p-16">
           
           {/* Header: Rank Indicator */}
           <div className="flex-none mb-4">
                <div className="inline-block px-4 py-1 bg-white/10 backdrop-blur-md rounded-full border border-white/20 text-sm font-medium tracking-wider text-indigo-200 uppercase">
                    Ranking Countdown
                </div>
           </div>

           {/* Central Stage */}
           <div className="flex-1 flex flex-col md:flex-row items-center gap-12 md:gap-24 justify-center">
               
               {/* Left: Rotating Vinyl */}
               <div className="relative group perspective-1000">
                   <div 
                        className={`w-64 h-64 md:w-96 md:h-96 rounded-full border-4 border-white/10 shadow-2xl overflow-hidden relative flex items-center justify-center bg-black ${isPlaying ? 'animate-[spin_10s_linear_infinite]' : ''}`}
                        style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}
                   >
                       {/* Vinyl Texture */}
                       <div className="absolute inset-0 rounded-full border-[20px] border-black/80 z-20" />
                       <div className="absolute inset-0 rounded-full bg-[conic-gradient(transparent_0deg,rgba(255,255,255,0.1)_45deg,transparent_90deg)] z-20 pointer-events-none" />
                       
                       {currentSong.albumCover ? (
                           <img src={currentSong.albumCover} className="w-full h-full object-cover z-10" />
                       ) : (
                           <div className="w-full h-full flex items-center justify-center bg-slate-800 z-10">
                               <IconMusic className="w-24 h-24 text-slate-600" />
                           </div>
                       )}
                       
                       {/* Center Hole */}
                       <div className="absolute w-6 h-6 bg-black rounded-full z-30 border border-white/20" />
                   </div>
                   
                   {/* Rank Badge Floating */}
                   <div className="absolute -top-4 -left-4 md:top-0 md:left-0 z-40">
                        <div className="text-6xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-br from-yellow-300 to-yellow-600 drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)] font-mono italic">
                            #{currentSong.rank}
                        </div>
                   </div>
               </div>

               {/* Right: Info & Scores */}
               <div className="flex-1 text-center md:text-left space-y-6 max-w-2xl">
                    <div className="space-y-2 animate-in slide-in-from-right-10 fade-in duration-500" key={currentSong.id + 'title'}>
                        <h1 className="text-4xl md:text-6xl font-bold leading-tight drop-shadow-lg line-clamp-2">
                            {currentSong.title}
                        </h1>
                        <p className="text-xl md:text-2xl text-white/70 font-light">
                            {currentSong.albumName} <span className="text-white/40 text-lg">({currentSong.albumYear})</span>
                        </p>
                    </div>

                    {/* Comment Display */}
                    {currentSong.comment && (
                        <div className="bg-white/5 backdrop-blur-sm border-l-4 border-indigo-500 px-4 py-3 rounded-r-lg max-w-xl mx-auto md:mx-0">
                            <p className="text-lg text-indigo-100 italic font-serif leading-relaxed">
                                "{currentSong.comment}"
                            </p>
                        </div>
                    )}

                    <div className="space-y-6 pt-4">
                        {/* Main Score */}
                        <div className="inline-flex flex-col items-center md:items-start">
                             <span className="text-xs uppercase tracking-[0.2em] text-indigo-300 mb-1">Total Score</span>
                             <div className="text-7xl md:text-8xl font-black text-white tracking-tighter drop-shadow-[0_0_15px_rgba(99,102,241,0.6)]">
                                 {currentSong.totalScore.toFixed(2)}
                             </div>
                        </div>

                        {/* Sub Scores with Colored Logic */}
                        <div className="grid grid-cols-3 gap-6 pt-6 border-t border-white/10">
                             <div className="text-center md:text-left">
                                 <div className="text-xs text-white/50 mb-1">作词</div>
                                 <div className={`text-3xl font-bold font-mono ${getScoreColorClass(currentSong.scores.lyrics)}`}>
                                     {currentSong.scores.lyrics.toFixed(1)}
                                 </div>
                             </div>
                             <div className="text-center md:text-left">
                                 <div className="text-xs text-white/50 mb-1">作曲</div>
                                 <div className={`text-3xl font-bold font-mono ${getScoreColorClass(currentSong.scores.composition)}`}>
                                     {currentSong.scores.composition.toFixed(1)}
                                 </div>
                             </div>
                             <div className="text-center md:text-left">
                                 <div className="text-xs text-white/50 mb-1">编曲</div>
                                 <div className={`text-3xl font-bold font-mono ${getScoreColorClass(currentSong.scores.arrangement)}`}>
                                     {currentSong.scores.arrangement.toFixed(1)}
                                 </div>
                             </div>
                        </div>
                    </div>
               </div>
           </div>

           {/* Bottom: Controls (No Progress Bar) */}
           <div className="flex-none mt-8 flex justify-center md:justify-end relative z-50">
                {/* Control Bar */}
                <div className="flex items-center gap-6 p-3 bg-black/50 backdrop-blur-md rounded-full border border-white/10 shadow-2xl">
                     <div className="text-sm text-white/50 font-mono ml-3 border-r border-white/10 pr-4 mr-2">
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