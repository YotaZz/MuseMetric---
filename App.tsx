import React, { useState, useEffect } from 'react';
import { ViewMode, Singer } from './types';
import { generateId } from './utils';
import { DataEntryView } from './views/DataEntryView';
import { DashboardView } from './views/DashboardView';
import { IconMusic, IconChart, IconPlus, IconDownload, IconUpload, IconChevronLeft, IconChevronRight, IconEdit } from './components/Icons';
import { Button, Modal, Input } from './components/UI';

const STORAGE_KEY = 'musemetric_data_v1';

const App: React.FC = () => {
  const [singers, setSingers] = useState<Singer[]>([]);
  const [currentSingerId, setCurrentSingerId] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<ViewMode>('entry');
  const [isNewSingerModalOpen, setIsNewSingerModalOpen] = useState(false);
  const [newSingerName, setNewSingerName] = useState('');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Rename State
  const [renameSingerModalOpen, setRenameSingerModalOpen] = useState(false);
  const [renamingSingerId, setRenamingSingerId] = useState<string | null>(null);
  const [renameSingerName, setRenameSingerName] = useState('');

  // Load from local storage
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setSingers(parsed);
        if (parsed.length > 0) {
          setCurrentSingerId(parsed[0].id);
        }
      } catch (e) {
        console.error("Failed to load data", e);
      }
    }
  }, []);

  // Save to local storage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(singers));
  }, [singers]);

  const handleAddSinger = () => {
    if (!newSingerName.trim()) return;
    const newSinger: Singer = {
      id: generateId(),
      name: newSingerName,
      albums: []
    };
    setSingers([...singers, newSinger]);
    setCurrentSingerId(newSinger.id);
    setNewSingerName('');
    setIsNewSingerModalOpen(false);
  };

  const updateCurrentSinger = (updatedSinger: Singer) => {
    setSingers(singers.map(s => s.id === updatedSinger.id ? updatedSinger : s));
  };

  const openRenameModal = (e: React.MouseEvent, singer: Singer) => {
      e.stopPropagation();
      setRenamingSingerId(singer.id);
      setRenameSingerName(singer.name);
      setRenameSingerModalOpen(true);
  };

  const handleRenameSinger = () => {
      if (!renameSingerName.trim() || !renamingSingerId) return;
      setSingers(singers.map(s => s.id === renamingSingerId ? { ...s, name: renameSingerName } : s));
      setRenameSingerModalOpen(false);
      setRenamingSingerId(null);
  };

  const handleExport = () => {
      const dataStr = JSON.stringify(singers);
      const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
      const exportFileDefaultName = 'musemetric_backup.json';
      const linkElement = document.createElement('a');
      linkElement.setAttribute('href', dataUri);
      linkElement.setAttribute('download', exportFileDefaultName);
      linkElement.click();
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if(!file) return;
      
      const reader = new FileReader();
      reader.onload = (event) => {
          try {
              const parsed = JSON.parse(event.target?.result as string);
              if(Array.isArray(parsed)){
                  setSingers(parsed);
                  if(parsed.length > 0) setCurrentSingerId(parsed[0].id);
                  alert('数据导入成功！');
              }
          } catch(err) {
              alert('文件格式错误或数据损坏');
          }
      };
      reader.readAsText(file);
      // Reset input value to allow re-importing the same file
      e.target.value = '';
  };

  const currentSinger = singers.find(s => s.id === currentSingerId);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Sidebar Navigation */}
      <aside 
        className={`${isSidebarCollapsed ? 'w-0 border-none' : 'w-64 border-r'} bg-slate-900 text-slate-300 flex flex-col flex-shrink-0 z-20 shadow-xl transition-all duration-300 ease-in-out relative overflow-hidden`}
      >
        <div className="p-6 border-b border-slate-800 flex items-center h-20">
          <h1 className="text-xl font-bold text-white flex items-center gap-2 overflow-hidden whitespace-nowrap">
             <span className="bg-indigo-600 text-white rounded p-1 flex-shrink-0"><IconMusic className="w-5 h-5"/></span>
             <span>MuseMetric</span>
          </h1>
        </div>

        {/* Singer Selection */}
        <div className="p-4 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="flex justify-between items-center mb-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <span>我的歌手</span>
            <button 
                onClick={() => setIsNewSingerModalOpen(true)} 
                className="hover:text-white p-1 rounded hover:bg-slate-800" 
                title="添加歌手"
            >
                <IconPlus className="w-4 h-4"/>
            </button>
          </div>
          <div className="space-y-1">
            {singers.map(singer => (
              <div
                key={singer.id}
                onClick={() => setCurrentSingerId(singer.id)}
                className={`group w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center justify-between cursor-pointer ${currentSingerId === singer.id ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800'}`}
                title={singer.name}
              >
                <div className="flex items-center gap-2 truncate">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${currentSingerId === singer.id ? 'bg-white' : 'bg-slate-600'}`}></span>
                    <span className="truncate">{singer.name}</span>
                </div>
                <button 
                    onClick={(e) => openRenameModal(e, singer)}
                    className={`p-1 hover:bg-white/20 rounded opacity-0 group-hover:opacity-100 transition-opacity ${currentSingerId === singer.id ? 'text-white' : 'text-slate-400'}`}
                    title="重命名"
                >
                    <IconEdit className="w-3 h-3" />
                </button>
              </div>
            ))}
            {singers.length === 0 && <div className="text-sm text-slate-600 italic px-3">暂无歌手，请添加</div>}
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="p-4 border-t border-slate-800 space-y-2">
            <label className="flex items-center gap-2 text-sm hover:text-white cursor-pointer" title="导入备份">
                <IconUpload className="w-4 h-4"/> 
                导入备份
                <input type="file" className="hidden" accept=".json" onChange={handleImport} />
            </label>
            <button onClick={handleExport} className="flex items-center gap-2 text-sm hover:text-white w-full" title="导出备份">
                <IconDownload className="w-4 h-4"/> 
                导出备份
            </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 relative">
        {/* Toggle Button Positioned in Main but relative to layout */}
        <button 
           onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
           className={`absolute top-6 z-30 bg-indigo-600 text-white rounded-full p-1.5 shadow-md hover:bg-indigo-500 transition-all duration-300 ${isSidebarCollapsed ? 'left-4' : '-left-3'}`}
           title={isSidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
        >
           {isSidebarCollapsed ? <IconChevronRight className="w-4 h-4" /> : <IconChevronLeft className="w-4 h-4" />}
        </button>

        {/* Top Header */}
        <header className={`bg-white border-b border-slate-200 h-16 flex items-center justify-between px-6 flex-shrink-0 z-10 transition-[padding] duration-300 ${isSidebarCollapsed ? 'pl-16' : 'pl-10'}`}>
          <div>
              {currentSinger ? (
                  <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    {currentSinger.name} 
                    <button 
                        onClick={(e) => openRenameModal(e, currentSinger)}
                        className="text-slate-400 hover:text-indigo-600 p-1"
                        title="重命名歌手"
                    >
                        <IconEdit className="w-4 h-4" />
                    </button>
                    <span className="text-slate-400 font-normal text-sm border-l border-slate-300 pl-2 ml-2 hidden sm:inline">作品评分管理</span>
                  </h2>
              ) : (
                  <h2 className="text-xl font-bold text-slate-800">欢迎使用</h2>
              )}
          </div>
          
          {/* View Switcher */}
          <div className="flex bg-slate-100 p-1 rounded-lg">
            <button
              onClick={() => setCurrentView('entry')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${currentView === 'entry' ? 'bg-white shadow text-indigo-600' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <IconMusic className="w-4 h-4" /> <span className="hidden sm:inline">数据录入</span>
            </button>
            <button
              onClick={() => setCurrentView('dashboard')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${currentView === 'dashboard' ? 'bg-white shadow text-indigo-600' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <IconChart className="w-4 h-4" /> <span className="hidden sm:inline">可视化看板</span>
            </button>
          </div>
        </header>

        {/* View Content */}
        <div className="flex-1 overflow-hidden p-6 relative">
          {currentSinger ? (
             currentView === 'entry' ? (
                <DataEntryView singer={currentSinger} onUpdateSinger={updateCurrentSinger} />
             ) : (
                <div className="h-full overflow-y-auto pr-2">
                    <DashboardView singer={currentSinger} onUpdateSinger={updateCurrentSinger} />
                </div>
             )
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-400">
               <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                  <IconMusic className="w-8 h-8 opacity-50"/>
               </div>
               <p className="text-lg">请先在左侧选择或创建一个歌手</p>
               <Button onClick={() => setIsNewSingerModalOpen(true)} className="mt-4">创建歌手</Button>
            </div>
          )}
        </div>
      </main>

      {/* Create Singer Modal */}
      <Modal isOpen={isNewSingerModalOpen} onClose={() => setIsNewSingerModalOpen(false)} title="创建新歌手">
         <div className="space-y-4">
            <Input 
                autoFocus
                placeholder="请输入歌手名字" 
                value={newSingerName} 
                onChange={(e) => setNewSingerName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddSinger()}
            />
            <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setIsNewSingerModalOpen(false)}>取消</Button>
                <Button onClick={handleAddSinger}>确认创建</Button>
            </div>
         </div>
      </Modal>

      {/* Rename Singer Modal */}
      <Modal isOpen={renameSingerModalOpen} onClose={() => setRenameSingerModalOpen(false)} title="重命名歌手">
         <div className="space-y-4">
            <Input 
                autoFocus
                placeholder="请输入新名字" 
                value={renameSingerName} 
                onChange={(e) => setRenameSingerName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleRenameSinger()}
            />
            <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setRenameSingerModalOpen(false)}>取消</Button>
                <Button onClick={handleRenameSinger}>保存</Button>
            </div>
         </div>
      </Modal>
    </div>
  );
};

export default App;