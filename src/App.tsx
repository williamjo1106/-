import { useState, useEffect, useRef } from 'react';
import { 
  FileUp, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Plus, 
  Trash2, 
  History, 
  ChevronRight, 
  Settings, 
  FileText,
  Loader2,
  Info,
  BookOpen,
  LayoutDashboard,
  Save,
  UploadCloud
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Markdown from 'react-markdown';

import { Criterion, EvaluationResult, Decision, ReferenceExample, AIConfig } from './types';
import { DEFAULT_CRITERIA } from './constants';
import { evaluateProposal, ingestReferenceFile } from './services/geminiService';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [view, setView] = useState<'dashboard' | 'library'>('dashboard');
  const [criteria, setCriteria] = useState<Criterion[]>(() => {
    const saved = localStorage.getItem('reviewer-criteria');
    return saved ? JSON.parse(saved) : DEFAULT_CRITERIA;
  });
  
  const [evaluations, setEvaluations] = useState<EvaluationResult[]>(() => {
    const saved = localStorage.getItem('reviewer-evaluations');
    return saved ? JSON.parse(saved) : [];
  });

  const [examples, setExamples] = useState<ReferenceExample[]>(() => {
    const saved = localStorage.getItem('reviewer-examples');
    return saved ? JSON.parse(saved) : [];
  });

  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCriteriaModalOpen, setIsCriteriaModalOpen] = useState(false);
  const [aiConfig, setAiConfig] = useState<AIConfig>(() => {
    const saved = localStorage.getItem('reviewer-ai-config');
    return saved ? JSON.parse(saved) : {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      modelId: 'gpt-4o'
    };
  });
  const [selectedEval, setSelectedEval] = useState<EvaluationResult | null>(null);
  const [newCriterionText, setNewCriterionText] = useState('');
  const [isMandatory, setIsMandatory] = useState(true);
  const [dragActive, setDragActive] = useState(false);

  // Chat state
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleSendMessage = async () => {
    if (!chatInput.trim() || isChatLoading) return;

    const userMessage = { role: 'user' as const, content: chatInput.trim() };
    setChatMessages(prev => [...prev, userMessage]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...chatMessages, userMessage],
          config: aiConfig
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'AI 응답 중 오류가 발생했습니다.');
      }

      const assistantMessage = await response.json();
      setChatMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Chat error:', error);
      setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }]);
    } finally {
      setIsChatLoading(false);
    }
  };
  
  // Example form state
  const [newExample, setNewExample] = useState<Partial<ReferenceExample>>({
    type: 'PASS',
    title: '',
    content: '',
    reasoning: ''
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem('reviewer-criteria', JSON.stringify(criteria));
  }, [criteria]);

  useEffect(() => {
    localStorage.setItem('reviewer-evaluations', JSON.stringify(evaluations));
  }, [evaluations]);

  useEffect(() => {
    localStorage.setItem('reviewer-examples', JSON.stringify(examples));
  }, [examples]);

  useEffect(() => {
    localStorage.setItem('reviewer-ai-config', JSON.stringify(aiConfig));
  }, [aiConfig]);

  const handleAddCriterion = () => {
    if (!newCriterionText.trim()) return;
    const newCriterion: Criterion = {
      id: crypto.randomUUID(),
      text: newCriterionText.trim(),
      isMandatory,
    };
    setCriteria([...criteria, newCriterion]);
    setNewCriterionText('');
  };

  const handleRemoveCriterion = (id: string) => {
    setCriteria(criteria.filter(c => c.id !== id));
  };

  const [selectedExampleIds, setSelectedExampleIds] = useState<string[]>([]);
  const [manualFile, setManualFile] = useState<File | null>(null);
  const manualFileInputRef = useRef<HTMLInputElement>(null);

  const handleAddExample = async () => {
    if (!newExample.type || !newExample.reasoning) {
      alert('판정 유형과 근거를 입력해 주세요.');
      return;
    }

    setIsIngesting(true);
    try {
      let title = newExample.title || 'Untitled Case';
      let content = newExample.content || '';

      if (manualFile) {
        const base64Data = await fileToBase64(manualFile);
        const response = await ingestReferenceFile(
          base64Data.split(',')[1],
          manualFile.name,
          manualFile.type,
          newExample.type as 'PASS' | 'FAIL',
          aiConfig
        );
        title = response.title;
        content = response.content;
      } else if (!title || !content) {
        alert('파일을 업로드하거나 제목과 내용을 직접 입력해 주세요.');
        setIsIngesting(false);
        return;
      }

      const example: ReferenceExample = {
        id: crypto.randomUUID(),
        type: newExample.type as 'PASS' | 'FAIL',
        title,
        content,
        reasoning: newExample.reasoning,
      };
      setExamples(prev => [example, ...prev]);
      setNewExample({ type: 'PASS', title: '', content: '', reasoning: '' });
      setManualFile(null);
      alert('라이브러리에 저장되었습니다.');
    } catch (error) {
      console.error('Error adding manual case:', error);
      alert('사례 등록 중 오류가 발생했습니다.');
    } finally {
      setIsIngesting(false);
    }
  };

  const handleDeleteSelected = () => {
    if (selectedExampleIds.length === 0) return;
    if (confirm(`${selectedExampleIds.length}개의 사례를 삭제하시겠습니까?`)) {
      setExamples(prev => prev.filter(ex => !selectedExampleIds.includes(ex.id)));
      setSelectedExampleIds([]);
    }
  };

  const toggleExampleSelection = (id: string) => {
    setSelectedExampleIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const [ingestType, setIngestType] = useState<'PASS' | 'FAIL' | null>(null);

  const handleBulkIngest = async (files: FileList | null, type: 'PASS' | 'FAIL') => {
    if (!files || files.length === 0) return;
    
    setIsIngesting(true);
    const newExamples: ReferenceExample[] = [];

    for (const file of Array.from(files)) {
      try {
        const base64Data = await fileToBase64(file);
        const response = await ingestReferenceFile(
          base64Data.split(',')[1],
          file.name,
          file.type,
          type,
          aiConfig
        );

        const example: ReferenceExample = {
          id: crypto.randomUUID(),
          type,
          title: response.title,
          content: response.content,
          reasoning: response.reasoning,
        };
        newExamples.push(example);
      } catch (error) {
        console.error(`Error ingesting ${file.name}:`, error);
      }
    }

    setExamples(prev => [...newExamples, ...prev]);
    setIsIngesting(false);
    alert(`${newExamples.length}개의 사례가 라이브러리에 추가되었습니다.`);
  };

  const handleSaveToLibrary = (evalResult: EvaluationResult) => {
    const decision = evalResult.userDecision || evalResult.aiDecision;
    const example: ReferenceExample = {
      id: crypto.randomUUID(),
      type: decision as 'PASS' | 'FAIL',
      title: evalResult.fileName,
      content: evalResult.reasoning.substring(0, 300) + '...',
      reasoning: evalResult.reasoning,
    };
    setExamples(prev => [example, ...prev]);
    alert('라이브러리에 저장되었습니다. 이제 이 사례는 다음 평가의 참조 데이터로 사용됩니다.');
  };

  const handleRemoveExample = (id: string) => {
    setExamples(examples.filter(e => e.id !== id));
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    setIsEvaluating(true);
    const newEvaluations: EvaluationResult[] = [];

    for (const file of Array.from(files)) {
      try {
        const base64Data = await fileToBase64(file);
        const response = await evaluateProposal(
          base64Data.split(',')[1],
          file.name,
          file.type,
          criteria,
          examples,
          aiConfig
        );

        const result: EvaluationResult = {
          id: crypto.randomUUID(),
          fileName: file.name,
          aiDecision: response.ai_decision as Decision,
          reasoning: response.reasoning,
          missingCriteria: response.missing_criteria,
          tableSummary: response.table_summary,
          timestamp: Date.now(),
          mimeType: file.type,
        };
        newEvaluations.push(result);
      } catch (error) {
        console.error(`Error evaluating ${file.name}:`, error);
        alert(`${file.name} 평가 중 오류가 발생했습니다.`);
      }
    }

    setEvaluations(prev => [...newEvaluations, ...prev]);
    setIsEvaluating(false);
    if (newEvaluations.length > 0) {
      setSelectedEval(newEvaluations[0]);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  const handleOverride = (id: string, decision: Decision) => {
    setEvaluations(prev => prev.map(ev => 
      ev.id === id ? { ...ev, userDecision: decision } : ev
    ));
    
    // Auto-save to library when user makes a decision
    const targetEval = evaluations.find(ev => ev.id === id);
    if (targetEval) {
      const example: ReferenceExample = {
        id: crypto.randomUUID(),
        type: decision as 'PASS' | 'FAIL',
        title: targetEval.fileName,
        content: targetEval.reasoning.substring(0, 300) + '...',
        reasoning: targetEval.reasoning,
      };
      
      // Check for duplicates (by title/filename)
      setExamples(prev => {
        if (prev.some(ex => ex.title === example.title)) return prev;
        return [example, ...prev];
      });
    }

    if (selectedEval?.id === id) {
      setSelectedEval(prev => prev ? { ...prev, userDecision: decision } : null);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files);
    }
  };

  return (
    <div className="flex h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0]">
      {/* Sidebar: Navigation & Criteria */}
      <aside className="w-80 border-r border-[#141414] flex flex-col bg-[#E4E3E0]">
        <div className="p-6 border-b border-[#141414]">
          <h1 className="font-serif italic text-2xl mb-1">Lead Reviewer</h1>
          <p className="text-[11px] opacity-50 uppercase tracking-wider">AI Assignment Evaluation System</p>
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="mt-4 flex items-center gap-2 px-3 py-1.5 border border-[#141414] text-[10px] uppercase tracking-widest hover:bg-[#141414] hover:text-white transition-all w-full justify-center"
          >
            <Settings className="w-3 h-3" /> AI Configuration
          </button>
        </div>

        {/* Navigation */}
        <nav className="p-4 border-b border-[#141414] flex gap-2">
          <button 
            onClick={() => setView('dashboard')}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 text-[10px] uppercase tracking-widest border border-[#141414] transition-all",
              view === 'dashboard' ? "bg-[#141414] text-[#E4E3E0]" : "hover:bg-[#141414]/5"
            )}
          >
            <LayoutDashboard className="w-3 h-3" /> Dashboard
          </button>
          <button 
            onClick={() => setView('library')}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 text-[10px] uppercase tracking-widest border border-[#141414] transition-all",
              view === 'library' ? "bg-[#141414] text-[#E4E3E0]" : "hover:bg-[#141414]/5"
            )}
          >
            <BookOpen className="w-3 h-3" /> Library
          </button>
        </nav>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-serif italic text-sm opacity-60">Evaluation Criteria</h2>
              <button 
                onClick={() => setIsCriteriaModalOpen(true)}
                className="p-1 hover:bg-[#141414]/5 rounded-full transition-colors"
              >
                <Settings className="w-4 h-4 opacity-40" />
              </button>
            </div>
            
            <div className="space-y-3">
              {criteria.map((c) => (
                <div key={c.id} className="group relative p-3 border border-[#141414]/10 bg-white/50 rounded-sm">
                  <div className="flex items-start gap-2">
                    <div className={cn(
                      "mt-1 w-2 h-2 rounded-full flex-shrink-0",
                      c.isMandatory ? "bg-red-500" : "bg-blue-500"
                    )} />
                    <p className="text-xs leading-relaxed pr-6">{c.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* AI Chat Window */}
        <div className="p-4 border-t border-[#141414] bg-[#D6D5D2] flex flex-col h-[300px]">
          <div className="flex items-center gap-2 mb-2 text-[10px] uppercase tracking-widest opacity-60">
            <Info className="w-3 h-3" />
            <span>AI Chat</span>
          </div>
          <div className="flex-1 overflow-y-auto space-y-3 mb-3 pr-2 scrollbar-thin scrollbar-thumb-[#141414]/20">
            {chatMessages.length === 0 && (
              <p className="text-[10px] opacity-40 italic text-center py-4">AI와 대화를 시작해보세요.</p>
            )}
            {chatMessages.map((msg, i) => (
              <div key={i} className={cn(
                "p-2 text-[11px] leading-relaxed",
                msg.role === 'user' ? "bg-[#141414] text-[#E4E3E0] ml-4" : "bg-white/50 mr-4"
              )}>
                {msg.content}
              </div>
            ))}
            {isChatLoading && (
              <div className="flex items-center gap-2 text-[10px] opacity-40">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>AI가 생각 중...</span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <div className="relative">
            <input 
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="메시지를 입력하세요..."
              className="w-full p-2 pr-8 text-[11px] bg-white border border-[#141414] focus:outline-none"
            />
            <button 
              onClick={handleSendMessage}
              disabled={isChatLoading || !chatInput.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-100 disabled:opacity-10"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {view === 'dashboard' ? (
          <>
            {/* Header / Upload Area */}
            <header className="p-8 border-b border-[#141414] bg-[#E4E3E0] z-10">
              <div 
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                className={cn(
                  "relative border-2 border-dashed border-[#141414] p-12 flex flex-col items-center justify-center transition-all",
                  dragActive ? "bg-[#141414] text-[#E4E3E0]" : "bg-white/30 hover:bg-white/50",
                  isEvaluating && "pointer-events-none opacity-50"
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.pptx"
                  onChange={(e) => handleFileUpload(e.target.files)}
                  className="hidden"
                />
                
                {isEvaluating ? (
                  <div className="flex flex-col items-center gap-4">
                    <Loader2 className="w-12 h-12 animate-spin" />
                    <p className="font-serif italic text-xl">Analyzing Documents...</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-16 h-16 rounded-full border border-current flex items-center justify-center">
                      <FileUp className="w-8 h-8" />
                    </div>
                    <div className="text-center">
                      <h3 className="font-serif italic text-2xl mb-2">Upload Proposals</h3>
                      <p className="text-xs opacity-60 uppercase tracking-widest">Drag & Drop or <button onClick={() => fileInputRef.current?.click()} className="underline font-bold">Browse Files</button></p>
                      <p className="text-[10px] opacity-40 mt-2 uppercase tracking-tighter">Supports PDF & PPTX (Max 80 files)</p>
                    </div>
                  </div>
                )}
              </div>
            </header>

            {/* Results Area */}
            <div className="flex-1 flex overflow-hidden">
              {/* List of Evaluations */}
              <div className="w-1/3 border-r border-[#141414] overflow-y-auto bg-[#D6D5D2]">
                <div className="sticky top-0 p-4 border-b border-[#141414] bg-[#D6D5D2] flex items-center justify-between">
                  <h3 className="font-serif italic text-sm">Evaluation History</h3>
                  <History className="w-4 h-4 opacity-40" />
                </div>
                
                {evaluations.length === 0 ? (
                  <div className="p-12 text-center opacity-30">
                    <FileText className="w-12 h-12 mx-auto mb-4" />
                    <p className="text-xs uppercase tracking-widest">No evaluations yet</p>
                  </div>
                ) : (
                  <div className="divide-y divide-[#141414]">
                    {evaluations.map((ev) => (
                      <button
                        key={ev.id}
                        onClick={() => setSelectedEval(ev)}
                        className={cn(
                          "w-full p-4 text-left transition-all hover:bg-[#141414] hover:text-[#E4E3E0] group",
                          selectedEval?.id === ev.id ? "bg-[#141414] text-[#E4E3E0]" : "bg-transparent"
                        )}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <span className="text-[10px] font-mono opacity-50">
                            {new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <div className={cn(
                            "px-2 py-0.5 text-[9px] font-bold uppercase tracking-tighter rounded-full",
                            (ev.userDecision || ev.aiDecision) === 'PASS' 
                              ? "bg-green-500/20 text-green-700 group-hover:bg-green-500 group-hover:text-white" 
                              : "bg-red-500/20 text-red-700 group-hover:bg-red-500 group-hover:text-white"
                          )}>
                            {ev.userDecision || ev.aiDecision}
                          </div>
                        </div>
                        <h4 className="text-xs font-medium truncate mb-1">{ev.fileName}</h4>
                        <p className="text-[10px] opacity-60 line-clamp-2 italic font-serif">
                          {ev.reasoning}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Detail View */}
              <div className="flex-1 overflow-y-auto bg-white p-12">
                <AnimatePresence mode="wait">
                  {selectedEval ? (
                    <motion.div
                      key={selectedEval.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="max-w-3xl mx-auto space-y-12"
                    >
                      {/* Result Header */}
                      <div className="flex items-start justify-between border-b border-[#141414] pb-8">
                        <div>
                          <h2 className="font-serif italic text-4xl mb-4">{selectedEval.fileName}</h2>
                          <div className="flex items-center gap-4">
                            <div className="flex flex-col">
                              <span className="text-[10px] uppercase tracking-widest opacity-40">AI Decision</span>
                              <span className={cn(
                                "text-xl font-bold tracking-tighter",
                                selectedEval.aiDecision === 'PASS' ? "text-green-600" : "text-red-600"
                              )}>
                                {selectedEval.aiDecision}
                              </span>
                            </div>
                            {selectedEval.userDecision && (
                              <div className="flex flex-col border-l border-[#141414]/10 pl-4">
                                <span className="text-[10px] uppercase tracking-widest opacity-40">User Override</span>
                                <span className={cn(
                                  "text-xl font-bold tracking-tighter",
                                  selectedEval.userDecision === 'PASS' ? "text-green-600" : "text-red-600"
                                )}>
                                  {selectedEval.userDecision}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex flex-col gap-2">
                          <span className="text-[10px] uppercase tracking-widest opacity-40 text-right">Human Control</span>
                          <div className="flex gap-1">
                            <button 
                              onClick={() => handleOverride(selectedEval.id, 'PASS')}
                              className={cn(
                                "px-4 py-2 text-[10px] uppercase tracking-widest border border-[#141414] transition-all",
                                selectedEval.userDecision === 'PASS' ? "bg-[#141414] text-[#E4E3E0]" : "hover:bg-[#141414]/5"
                              )}
                            >
                              Pass
                            </button>
                            <button 
                              onClick={() => handleOverride(selectedEval.id, 'FAIL')}
                              className={cn(
                                "px-4 py-2 text-[10px] uppercase tracking-widest border border-[#141414] transition-all",
                                selectedEval.userDecision === 'FAIL' ? "bg-[#141414] text-[#E4E3E0]" : "hover:bg-[#141414]/5"
                              )}
                            >
                              Fail
                            </button>
                            <button 
                              onClick={() => handleSaveToLibrary(selectedEval)}
                              className="ml-2 px-4 py-2 text-[10px] uppercase tracking-widest border border-[#141414] bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-2"
                            >
                              <Save className="w-3 h-3" /> Save to Library
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Reasoning Section */}
                      <section className="space-y-4">
                        <h3 className="font-serif italic text-xl border-b border-[#141414]/10 pb-2">Analysis Reasoning</h3>
                        <div className="prose prose-sm max-w-none text-[#141414] leading-relaxed">
                          <Markdown>{selectedEval.reasoning}</Markdown>
                        </div>
                      </section>

                      {/* Missing Criteria */}
                      {selectedEval.missingCriteria.length > 0 && (
                        <section className="space-y-4 p-6 bg-red-50 border border-red-200 rounded-sm">
                          <div className="flex items-center gap-2 text-red-700">
                            <AlertCircle className="w-5 h-5" />
                            <h3 className="font-serif italic text-lg">Missing Criteria</h3>
                          </div>
                          <ul className="space-y-2">
                            {selectedEval.missingCriteria.map((item, i) => (
                              <li key={i} className="flex items-start gap-2 text-xs text-red-800">
                                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                                {item}
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}

                      {/* Table Summary */}
                      <section className="space-y-4">
                        <h3 className="font-serif italic text-xl border-b border-[#141414]/10 pb-2">Extracted Table Data</h3>
                        <div className="p-6 bg-[#F5F5F3] border border-[#141414]/5 rounded-sm font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                          {selectedEval.tableSummary}
                        </div>
                      </section>
                    </motion.div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center opacity-20 text-center">
                      <FileText className="w-24 h-24 mb-6" />
                      <h2 className="font-serif italic text-3xl mb-2">Select an Evaluation</h2>
                      <p className="text-xs uppercase tracking-widest">Choose a document from the history to view details</p>
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </>
        ) : (
          /* Reference Library View */
          <div className="flex-1 overflow-y-auto bg-white p-12">
            <div className="max-w-4xl mx-auto space-y-12">
              <header className="border-b border-[#141414] pb-8 flex items-end justify-between">
                <div>
                  <h2 className="font-serif italic text-4xl mb-2">Reference Library</h2>
                  <p className="text-xs uppercase tracking-widest opacity-60">Manage PASS/FAIL examples for AI learning</p>
                </div>
                <div className="flex gap-2">
                  <input 
                    ref={libraryInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.pptx"
                    className="hidden"
                    onChange={(e) => {
                      if (ingestType) {
                        handleBulkIngest(e.target.files, ingestType);
                        setIngestType(null);
                      }
                    }}
                  />
                  <button 
                    onClick={() => {
                      setIngestType('PASS');
                      libraryInputRef.current?.click();
                    }}
                    disabled={isIngesting}
                    className="px-4 py-3 bg-green-600 text-white text-[10px] uppercase tracking-widest flex items-center gap-2 hover:bg-green-700 disabled:opacity-50"
                  >
                    {isIngesting && ingestType === 'PASS' ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                    Bulk PASS
                  </button>
                  <button 
                    onClick={() => {
                      setIngestType('FAIL');
                      libraryInputRef.current?.click();
                    }}
                    disabled={isIngesting}
                    className="px-4 py-3 bg-red-600 text-white text-[10px] uppercase tracking-widest flex items-center gap-2 hover:bg-red-700 disabled:opacity-50"
                  >
                    {isIngesting && ingestType === 'FAIL' ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                    Bulk FAIL
                  </button>
                  {selectedExampleIds.length > 0 && (
                    <button 
                      onClick={handleDeleteSelected}
                      className="px-4 py-3 bg-red-500 text-white text-[10px] uppercase tracking-widest flex items-center gap-2 hover:bg-red-600 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete Selected ({selectedExampleIds.length})
                    </button>
                  )}
                </div>
              </header>

              {/* Add Example Form */}
              <section className="p-8 bg-[#F5F5F3] border border-[#141414]/10 space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="font-serif italic text-xl">Add Manual Case</h3>
                  <div className="flex items-center gap-4">
                    <input 
                      ref={manualFileInputRef}
                      type="file"
                      accept=".pdf,.pptx"
                      className="hidden"
                      onChange={(e) => setManualFile(e.target.files?.[0] || null)}
                    />
                    <button 
                      onClick={() => manualFileInputRef.current?.click()}
                      className="text-[10px] uppercase tracking-widest flex items-center gap-2 px-3 py-1.5 border border-[#141414] hover:bg-[#141414] hover:text-white transition-all"
                    >
                      <UploadCloud className="w-3.5 h-3.5" />
                      {manualFile ? manualFile.name : 'Upload File (Optional)'}
                    </button>
                    {manualFile && (
                      <button onClick={() => setManualFile(null)} className="text-red-500">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-4">
                    {!manualFile && (
                      <>
                        <div>
                          <label className="text-[10px] uppercase tracking-widest opacity-50 block mb-1">Case Title</label>
                          <input 
                            type="text"
                            value={newExample.title}
                            onChange={(e) => setNewExample({...newExample, title: e.target.value})}
                            placeholder="e.g., 2023 AI R&D Proposal"
                            className="w-full p-3 text-xs border border-[#141414] focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-widest opacity-50 block mb-1">Content Summary</label>
                          <textarea 
                            value={newExample.content}
                            onChange={(e) => setNewExample({...newExample, content: e.target.value})}
                            placeholder="Summarize the key features of this proposal..."
                            className="w-full p-3 text-xs border border-[#141414] focus:outline-none h-24 resize-none"
                          />
                        </div>
                      </>
                    )}
                    <div>
                      <label className="text-[10px] uppercase tracking-widest opacity-50 block mb-1">Decision Type</label>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => setNewExample({...newExample, type: 'PASS'})}
                          className={cn(
                            "flex-1 py-2 text-[10px] uppercase tracking-widest border border-[#141414]",
                            newExample.type === 'PASS' ? "bg-green-600 text-white border-green-600" : "opacity-40"
                          )}
                        >
                          Pass Case
                        </button>
                        <button 
                          onClick={() => setNewExample({...newExample, type: 'FAIL'})}
                          className={cn(
                            "flex-1 py-2 text-[10px] uppercase tracking-widest border border-[#141414]",
                            newExample.type === 'FAIL' ? "bg-red-600 text-white border-red-600" : "opacity-40"
                          )}
                        >
                          Fail Case
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="text-[10px] uppercase tracking-widest opacity-50 block mb-1">Decision Reasoning</label>
                      <textarea 
                        value={newExample.reasoning}
                        onChange={(e) => setNewExample({...newExample, reasoning: e.target.value})}
                        placeholder="Explain why this was passed or failed..."
                        className="w-full p-3 text-xs border border-[#141414] focus:outline-none h-48 resize-none"
                      />
                    </div>
                  </div>
                </div>
                <button 
                  onClick={handleAddExample}
                  disabled={isIngesting}
                  className="w-full py-3 bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-[0.2em] font-bold hover:bg-[#141414]/90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isIngesting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save to Library
                </button>
              </section>

              {/* Examples List */}
              <section className="space-y-6">
                <h3 className="font-serif italic text-xl border-b border-[#141414]/10 pb-2">Stored Cases ({examples.length})</h3>
                <div className="grid grid-cols-2 gap-4">
                  {examples.map((ex) => (
                    <div 
                      key={ex.id} 
                      className={cn(
                        "p-6 border transition-all relative group cursor-pointer",
                        selectedExampleIds.includes(ex.id) ? "border-[#141414] bg-[#F5F5F3]" : "border-[#141414]/20 hover:border-[#141414]/40"
                      )}
                      onClick={() => toggleExampleSelection(ex.id)}
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <input 
                            type="checkbox"
                            checked={selectedExampleIds.includes(ex.id)}
                            onChange={() => {}} // Handled by parent div onClick
                            className="w-4 h-4 accent-[#141414]"
                          />
                          <span className={cn(
                            "px-2 py-0.5 text-[9px] font-bold uppercase tracking-tighter rounded-full",
                            ex.type === 'PASS' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                          )}>
                            {ex.type}
                          </span>
                        </div>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveExample(ex.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-3 h-3 text-red-500" />
                        </button>
                      </div>
                      <h4 className="font-serif italic text-lg mb-2">{ex.title}</h4>
                      <div className="space-y-3">
                        <div>
                          <span className="text-[9px] uppercase tracking-widest opacity-40 block">Content</span>
                          <p className="text-[11px] leading-relaxed line-clamp-3">{ex.content}</p>
                        </div>
                        <div>
                          <span className="text-[9px] uppercase tracking-widest opacity-40 block">Reasoning</span>
                          <p className="text-[11px] leading-relaxed italic line-clamp-3">{ex.reasoning}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                  {examples.length === 0 && (
                    <div className="col-span-2 p-12 text-center border border-dashed border-[#141414]/20 opacity-30">
                      <BookOpen className="w-12 h-12 mx-auto mb-4" />
                      <p className="text-xs uppercase tracking-widest">Library is empty</p>
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        )}
      </main>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-[#E4E3E0] border border-[#141414] shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-[#141414] flex items-center justify-between bg-[#D6D5D2]">
                <h2 className="font-serif italic text-xl">AI Configuration</h2>
                <button onClick={() => setIsSettingsOpen(false)} className="hover:rotate-90 transition-transform">
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest opacity-60 block">Base URL (OpenAI Compatible)</label>
                  <input 
                    type="text"
                    value={aiConfig.baseUrl}
                    onChange={(e) => setAiConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                    placeholder="https://api.openai.com/v1"
                    className="w-full p-3 text-xs bg-white border border-[#141414] focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest opacity-60 block">API Key</label>
                  <input 
                    type="password"
                    value={aiConfig.apiKey}
                    onChange={(e) => setAiConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                    placeholder="sk-..."
                    className="w-full p-3 text-xs bg-white border border-[#141414] focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest opacity-60 block">Model ID</label>
                  <input 
                    type="text"
                    value={aiConfig.modelId}
                    onChange={(e) => setAiConfig(prev => ({ ...prev, modelId: e.target.value }))}
                    placeholder="gpt-4o"
                    className="w-full p-3 text-xs bg-white border border-[#141414] focus:outline-none"
                  />
                </div>
                <div className="pt-4 flex items-center gap-2 text-[10px] text-blue-600 bg-blue-50 p-3 border border-blue-200">
                  <Info className="w-4 h-4 flex-shrink-0" />
                  <p>설정된 정보는 브라우저의 로컬 스토리지에 안전하게 저장됩니다.</p>
                </div>
              </div>
              <div className="p-6 border-t border-[#141414] bg-[#D6D5D2] flex justify-end">
                <button 
                  onClick={() => setIsSettingsOpen(false)}
                  className="px-6 py-2 bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest hover:bg-[#141414]/90 transition-all"
                >
                  Save & Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Criteria Settings Modal */}
      <AnimatePresence>
        {isCriteriaModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCriteriaModalOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-[#E4E3E0] border border-[#141414] shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-[#141414] flex items-center justify-between bg-[#D6D5D2]">
                <h2 className="font-serif italic text-xl">Manage Evaluation Criteria</h2>
                <button onClick={() => setIsCriteriaModalOpen(false)} className="hover:rotate-90 transition-transform">
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 grid grid-cols-2 gap-8">
                <div className="space-y-4">
                  <h3 className="text-[10px] uppercase tracking-widest opacity-60 font-bold">Add New Criterion</h3>
                  <div className="space-y-2">
                    <textarea
                      value={newCriterionText}
                      onChange={(e) => setNewCriterionText(e.target.value)}
                      placeholder="Enter criterion text..."
                      className="w-full p-3 text-xs bg-white border border-[#141414] focus:outline-none min-h-[120px] resize-none"
                    />
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isMandatory}
                          onChange={(e) => setIsMandatory(e.target.checked)}
                          className="w-3 h-3 accent-[#141414]"
                        />
                        <span className="text-[10px] uppercase tracking-wider opacity-60">Mandatory</span>
                      </label>
                      <button
                        onClick={handleAddCriterion}
                        className="flex items-center gap-1 px-4 py-2 bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest hover:bg-[#141414]/90 transition-colors"
                      >
                        <Plus className="w-3 h-3" /> Add Criterion
                      </button>
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <h3 className="text-[10px] uppercase tracking-widest opacity-60 font-bold">Current Criteria</h3>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-[#141414]/20">
                    {criteria.map((c) => (
                      <div key={c.id} className="group relative p-3 border border-[#141414]/10 bg-white/50 rounded-sm">
                        <div className="flex items-start gap-2">
                          <div className={cn(
                            "mt-1 w-2 h-2 rounded-full flex-shrink-0",
                            c.isMandatory ? "bg-red-500" : "bg-blue-500"
                          )} />
                          <p className="text-xs leading-relaxed pr-6">{c.text}</p>
                        </div>
                        <button 
                          onClick={() => handleRemoveCriterion(c.id)}
                          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-3 h-3 text-red-500" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="p-6 border-t border-[#141414] bg-[#D6D5D2] flex justify-end">
                <button 
                  onClick={() => setIsCriteriaModalOpen(false)}
                  className="px-6 py-2 bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest hover:bg-[#141414]/90 transition-all"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
