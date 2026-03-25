import { useState, useEffect, useRef, useMemo } from 'react';
import { 
  FileUp, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Plus, 
  Trash2, 
  History, 
  ChevronRight, 
  ChevronLeft, 
  Settings, 
  FileText,
  FileDown,
  Loader2,
  Info,
  BookOpen,
  LayoutDashboard,
  Save,
  Send,
  UploadCloud,
  Pencil,
  X,
  AlertTriangle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Markdown from 'react-markdown';
import * as XLSX from 'xlsx';
import { Toaster, toast } from 'sonner';

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
  const [evaluationProgress, setEvaluationProgress] = useState(0);
  const [isIngesting, setIsIngesting] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCriteriaModalOpen, setIsCriteriaModalOpen] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [comparisonCaseId, setComparisonCaseId] = useState<string | null>(null);
  const [aiConfig, setAiConfig] = useState<AIConfig>(() => {
    const saved = localStorage.getItem('reviewer-ai-config');
    return saved ? JSON.parse(saved) : {
      baseUrl: '',
      apiKey: '',
      modelId: 'gemini-3-flash-preview',
      similarityThreshold: 80
    };
  });
  const [selectedEval, setSelectedEval] = useState<EvaluationResult | null>(null);
  const [newCriterionText, setNewCriterionText] = useState('');
  const [isMandatory, setIsMandatory] = useState(true);
  const [dragActive, setDragActive] = useState(false);
  const [librarySearchQuery, setLibrarySearchQuery] = useState('');
  const [librarySearchResults, setLibrarySearchResults] = useState<ReferenceExample[]>([]);
  
  // Library Filter States
  const [filterType, setFilterType] = useState<'ALL' | 'PASS' | 'FAIL'>('ALL');
  const [filterTeam, setFilterTeam] = useState<string>('ALL');
  const [filterPeriod, setFilterPeriod] = useState<'ALL' | 'TODAY' | 'WEEK' | 'MONTH'>('ALL');
  const [filterReason, setFilterReason] = useState<string>('ALL');

  // Custom Confirm Modal State
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const showConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmModal({ isOpen: true, title, message, onConfirm });
  };

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
      const { chatWithAI } = await import('./services/geminiService');
      const assistantMessage = await chatWithAI([...chatMessages, userMessage], aiConfig, evaluations, examples);
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
  const libraryFileInputRef = useRef<HTMLInputElement>(null);

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

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 4;

  useEffect(() => {
    setCurrentPage(1);
  }, [filterType, filterTeam, filterPeriod, filterReason, librarySearchQuery]);

  const [editingExampleId, setEditingExampleId] = useState<string | null>(null);
  const [editingReasoning, setEditingReasoning] = useState<string>('');

  const handleStartEdit = (ex: ReferenceExample) => {
    setEditingExampleId(ex.id);
    setEditingReasoning(ex.reasoning);
  };

  const handleSaveEdit = (id: string) => {
    setExamples(prev => prev.map(ex => 
      ex.id === id ? { ...ex, reasoning: editingReasoning } : ex
    ));
    setEditingExampleId(null);
    toast.success('Reasoning updated.');
  };

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
    setCriteria(prev => prev.filter(c => c.id !== id));
  };

  const handleUpdateCriterion = (id: string, updates: Partial<Criterion>) => {
    setCriteria(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  };

  const [selectedExampleIds, setSelectedExampleIds] = useState<string[]>([]);
  const [manualFile, setManualFile] = useState<File | null>(null);
  const manualFileInputRef = useRef<HTMLInputElement>(null);

  const handleAddExample = async () => {
    if (!newExample.type || !newExample.reasoning) {
      toast.error('판정 유형과 근거를 입력해 주세요.');
      return;
    }

    setIsIngesting(true);
    try {
      let title = newExample.title || 'Untitled Case';
      let content = newExample.content || '';

      if (manualFile) {
        const response = await ingestReferenceFile(
          manualFile,
          newExample.type as 'PASS' | 'FAIL',
          aiConfig
        );
        title = response.title;
        content = response.content;
      } else if (!title || !content) {
        toast.error('파일을 업로드하거나 제목과 내용을 직접 입력해 주세요.');
        setIsIngesting(false);
        return;
      }

      const example: ReferenceExample = {
        id: crypto.randomUUID(),
        type: newExample.type as 'PASS' | 'FAIL',
        title,
        content,
        reasoning: newExample.reasoning,
        timestamp: Date.now(),
      };
      setExamples(prev => [example, ...prev]);
      setNewExample({ type: 'PASS', title: '', content: '', reasoning: '' });
      setManualFile(null);
      setCurrentPage(1);
      toast.success('라이브러리에 저장되었습니다.');
    } catch (error) {
      console.error('Error adding manual case:', error);
      toast.error('사례 등록 중 오류가 발생했습니다.');
    } finally {
      setIsIngesting(false);
    }
  };

  const handleDeleteSelected = () => {
    if (selectedExampleIds.length === 0) return;
    showConfirm(
      '사례 삭제',
      `${selectedExampleIds.length}개의 사례를 삭제하시겠습니까?`,
      () => {
        setExamples(prev => prev.filter(ex => !selectedExampleIds.includes(ex.id)));
        setSelectedExampleIds([]);
        toast.success('선택한 사례가 삭제되었습니다.');
      }
    );
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
    let failCount = 0;

    for (const file of Array.from(files)) {
      try {
        const response = await ingestReferenceFile(
          file,
          type,
          aiConfig
        );

        const example: ReferenceExample = {
          id: crypto.randomUUID(),
          type,
          title: response.title,
          content: response.content,
          reasoning: response.reasoning,
          timestamp: Date.now(),
        };
        newExamples.push(example);
      } catch (error) {
        console.error(`Error ingesting ${file.name}:`, error);
        failCount++;
      }
    }

    setExamples(prev => [...newExamples, ...prev]);
    setIsIngesting(false);
    setCurrentPage(1);
    
    if (newExamples.length > 0) {
      toast.success(`${newExamples.length}개의 사례가 라이브러리에 추가되었습니다.${failCount > 0 ? ` (${failCount}개 실패)` : ''}`);
    } else if (failCount > 0) {
      toast.error(`모든 사례(${failCount}개) 분석에 실패했습니다. 파일 형식이나 API 설정을 확인해 주세요.`);
    }
  };

  const handleSaveToLibrary = (evalResult: EvaluationResult) => {
    const decision = evalResult.userDecision || evalResult.aiDecision;
    const example: ReferenceExample = {
      id: crypto.randomUUID(),
      type: decision as 'PASS' | 'FAIL',
      title: evalResult.fileName,
      teamName: evalResult.teamName,
      proposerName: evalResult.proposerName,
      content: evalResult.tableSummary.substring(0, 300) + '...',
      reasoning: evalResult.userReasoning || '',
      timestamp: evalResult.timestamp || Date.now(),
    };
    setExamples(prev => [example, ...prev]);
    
    // Find next item to select
    const currentIndex = evaluations.findIndex(ev => ev.id === evalResult.id);
    const nextEval = evaluations[currentIndex + 1] || evaluations[currentIndex - 1] || null;

    // Remove from history after saving
    setEvaluations(prev => prev.filter(ev => ev.id !== evalResult.id));
    
    if (selectedEval?.id === evalResult.id) {
      setSelectedEval(nextEval);
    }

    setCurrentPage(1);
    toast.success('라이브러리에 저장되고 목록에서 제거되었습니다.');
  };

  const handleRemoveExample = (id: string) => {
    setExamples(prev => prev.filter(e => e.id !== id));
    setSelectedExampleIds(prev => prev.filter(i => i !== id));
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    
    setIsEvaluating(true);
    setEvaluationProgress(0);
    const newEvaluations: EvaluationResult[] = [];
    const fileArray = Array.from(files);
    const totalFiles = fileArray.length;

    for (let i = 0; i < totalFiles; i++) {
      const file = fileArray[i];
      try {
        const response = await evaluateProposal(
          file,
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
          proposerName: response.proposer_name,
          teamName: response.team_name,
          timestamp: Date.now(),
          mimeType: file.type,
          similarityScore: response.similarity_score,
          similarCaseId: response.similar_case_id,
        };
        newEvaluations.push(result);
      } catch (error) {
        console.error(`Error evaluating ${file.name}:`, error);
        toast.error(`${file.name} 평가 중 오류가 발생했습니다.`);
      } finally {
        setEvaluationProgress(Math.round(((i + 1) / totalFiles) * 100));
      }
    }

    setEvaluations(prev => [...newEvaluations, ...prev]);
    setIsEvaluating(false);
    setEvaluationProgress(0);
    if (newEvaluations.length > 0) {
      setSelectedEval(newEvaluations[0]);
    }
  };

  const handleBulkSaveToLibrary = () => {
    if (evaluations.length === 0) return;

    const newExamples: ReferenceExample[] = evaluations.map(ev => ({
      id: crypto.randomUUID(),
      type: ev.aiDecision as 'PASS' | 'FAIL',
      title: ev.fileName,
      teamName: ev.teamName,
      proposerName: ev.proposerName,
      content: ev.tableSummary.substring(0, 300) + '...',
      reasoning: ev.userReasoning || '',
      timestamp: ev.timestamp || Date.now(),
    }));

    setExamples(prev => {
      // Filter out duplicates by title if necessary, or just append
      const existingTitles = new Set(prev.map(ex => ex.title));
      const uniqueNewExamples = newExamples.filter(ex => !existingTitles.has(ex.title));
      return [...uniqueNewExamples, ...prev];
    });

    setEvaluations([]);
    setSelectedEval(null);
    toast.success(`${newExamples.length}개의 평가 결과가 라이브러리에 저장되었습니다.`);
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  const handleUserReasoningChange = (id: string, text: string) => {
    setEvaluations(prev => prev.map(ev => 
      ev.id === id ? { ...ev, userReasoning: text } : ev
    ));
    if (selectedEval?.id === id) {
      setSelectedEval(prev => prev ? { ...prev, userReasoning: text } : null);
    }
  };

  const handleOverride = (id: string, decision: Decision) => {
    const targetEval = evaluations.find(ev => ev.id === id);
    if (!targetEval) return;

    // Save to library
    const example: ReferenceExample = {
      id: crypto.randomUUID(),
      type: decision as 'PASS' | 'FAIL',
      title: targetEval.fileName,
      teamName: targetEval.teamName,
      proposerName: targetEval.proposerName,
      content: targetEval.tableSummary.substring(0, 300) + '...',
      reasoning: targetEval.userReasoning || '',
    };
    
    setExamples(prev => {
      if (prev.some(ex => ex.title === example.title)) return prev;
      return [example, ...prev];
    });

    // Find next item to select
    const currentIndex = evaluations.findIndex(ev => ev.id === id);
    const nextEval = evaluations[currentIndex + 1] || evaluations[currentIndex - 1] || null;

    // Remove from history
    setEvaluations(prev => prev.filter(ev => ev.id !== id));

    if (selectedEval?.id === id) {
      setSelectedEval(nextEval);
    }
    
    toast.success(`${targetEval.fileName}가 라이브러리에 저장되고 목록에서 제거되었습니다.`);
  };

  const handleDownloadExcel = () => {
    if (evaluations.length === 0) return;

    const data = evaluations.map(ev => ({
      '파일명': ev.fileName,
      '제안자': ev.proposerName || '미인식',
      'AI 판정': ev.aiDecision,
      '최종 판정': ev.userDecision || ev.aiDecision,
      '평가 일시': new Date(ev.timestamp).toLocaleString(),
      '평가 근거': ev.reasoning.substring(0, 1000) // 엑셀 셀 제한 고려
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Evaluation Results");
    
    // Generate buffer and download
    XLSX.writeFile(workbook, `evaluation_results_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleDownloadLibraryExcel = () => {
    if (examples.length === 0) return;

    const data = examples.map(ex => ({
      '유형': ex.type,
      '제목': ex.title,
      '팀/부서': ex.teamName || '미인식',
      '제안자': ex.proposerName || '미인식',
      '내용 요약': ex.content,
      '판정 근거': ex.reasoning,
      '평가 일시': ex.timestamp ? new Date(ex.timestamp).toLocaleString() : ''
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Stored Cases");
    
    XLSX.writeFile(workbook, `stored_cases_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleImportLibraryExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        const newExamples: ReferenceExample[] = data.map(row => ({
          id: crypto.randomUUID(),
          type: (row['유형'] === 'PASS' || row['유형'] === 'FAIL') ? row['유형'] : 'PASS',
          title: row['제목'] || 'Untitled',
          teamName: row['팀/부서'] || '',
          proposerName: row['제안자'] || '',
          content: row['내용 요약'] || '',
          reasoning: row['판정 근거'] || '',
          timestamp: row['평가 일시'] ? new Date(row['평가 일시']).getTime() : Date.now(),
        }));

        setExamples(prev => {
          const existingTitles = new Set(prev.map(ex => ex.title));
          const uniqueNewExamples = newExamples.filter(ex => !existingTitles.has(ex.title));
          return [...uniqueNewExamples, ...prev];
        });

        toast.success(`${newExamples.length}개의 사례가 라이브러리에 추가되었습니다.`);
      } catch (error) {
        console.error('Error importing Excel:', error);
        toast.error('엑셀 파일을 읽는 중 오류가 발생했습니다.');
      }
      // Reset input
      if (libraryFileInputRef.current) libraryFileInputRef.current.value = '';
    };
    reader.readAsBinaryString(file);
  };

  // Library Analysis Calculations
  const totalCount = examples.length;
  const passCount = examples.filter(ex => ex.type === 'PASS').length;
  const failCount = examples.filter(ex => ex.type === 'FAIL').length;
  const passRatio = totalCount > 0 ? Math.round((passCount / totalCount) * 100) : 0;
  const failRatio = totalCount > 0 ? Math.round((failCount / totalCount) * 100) : 0;

  // Extract common failure reasons (top 5)
  const failureReasons = useMemo(() => {
    const reasons: { [key: string]: number } = {};
    examples
      .filter(e => e.type === 'FAIL')
      .forEach(e => {
        // Simple heuristic: take first sentence or first 60 chars
        const reason = e.reasoning.split(/[.\n]/)[0].trim().substring(0, 60);
        if (reason && reason.length > 5) {
          reasons[reason] = (reasons[reason] || 0) + 1;
        }
      });
    
    return Object.entries(reasons)
      .map(([text, count]) => ({ text, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [examples]);

  // Library Search & Filter Logic
  const filteredExamples = useMemo(() => {
    let results = [...examples];

    // Apply Search Query
    if (librarySearchQuery.trim()) {
      const query = librarySearchQuery.toLowerCase();
      results = results.filter(e => 
        e.title.toLowerCase().includes(query) || 
        (e.teamName && e.teamName.toLowerCase().includes(query)) ||
        (e.proposerName && e.proposerName.toLowerCase().includes(query))
      );
    }

    // Apply PASS/FAIL Filter
    if (filterType !== 'ALL') {
      results = results.filter(e => e.type === filterType);
    }

    // Apply Team Filter
    if (filterTeam !== 'ALL') {
      results = results.filter(e => e.teamName === filterTeam);
    }

    // Apply Period Filter
    if (filterPeriod !== 'ALL') {
      const now = Date.now();
      const day = 24 * 60 * 60 * 1000;
      results = results.filter(e => {
        if (!e.timestamp) return false;
        const diff = now - e.timestamp;
        if (filterPeriod === 'TODAY') return diff < day;
        if (filterPeriod === 'WEEK') return diff < 7 * day;
        if (filterPeriod === 'MONTH') return diff < 30 * day;
        return true;
      });
    }

    // Apply Reason Filter
    if (filterReason !== 'ALL') {
      results = results.filter(e => e.reasoning.includes(filterReason));
    }

    return results;
  }, [examples, librarySearchQuery, filterType, filterTeam, filterPeriod, filterReason]);

  useEffect(() => {
    setLibrarySearchResults(filteredExamples);
  }, [filteredExamples]);

  // Extract unique teams for filter
  const uniqueTeams = useMemo(() => {
    const teams = new Set(examples.map(ex => ex.teamName).filter(Boolean));
    return Array.from(teams).sort();
  }, [examples]);

  const handleSearchResultClick = (id: string) => {
    const element = document.getElementById(`example-${id}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.classList.add('ring-2', 'ring-blue-500', 'ring-offset-2');
      setTimeout(() => {
        element.classList.remove('ring-2', 'ring-blue-500', 'ring-offset-2');
      }, 2000);
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

        <div className="p-6 border-b border-[#141414]/10">
          <div className="flex items-center justify-between">
            <h2 className="font-serif italic text-sm opacity-60">Evaluation Criteria</h2>
            <button 
              onClick={() => setIsCriteriaModalOpen(true)}
              className="p-1 hover:bg-[#141414]/5 rounded-full transition-colors"
            >
              <Settings className="w-4 h-4 opacity-40" />
            </button>
          </div>
        </div>

        {/* AI Chat Window */}
        <div className="flex-1 p-4 bg-white flex flex-col overflow-hidden">
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
              className="w-full p-2 pr-8 text-[11px] bg-[#F5F5F3] border border-[#141414] focus:outline-none"
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
          <div className="flex-1 flex overflow-hidden">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.pptx,.docx,.txt"
              onChange={(e) => handleFileUpload(e.target.files)}
              className="hidden"
            />
            
            {/* List of Evaluations (Sidebar) */}
            <div className="w-1/3 border-r border-[#141414] overflow-y-auto bg-[#F5F5F3] flex flex-col">
              <div className="sticky top-0 h-14 p-4 border-b border-[#141414] bg-[#D6D5D2] flex items-center justify-between z-20">
                <h3 className="font-serif italic text-sm">Evaluation History</h3>
                <div className="flex items-center gap-2">
                  {evaluations.length > 0 && (
                    <button 
                      onClick={() => {
                        showConfirm(
                          'AI 전체 저장',
                          '모든 평가 결과를 AI 판정대로 라이브러리에 저장하시겠습니까?',
                          handleBulkSaveToLibrary
                        );
                      }}
                      className="p-1 px-2 hover:bg-[#141414] hover:text-white border border-[#141414] text-[#141414] rounded-sm transition-all flex items-center gap-1.5"
                      title="Bulk Save to Library (AI Decision)"
                    >
                      <Send className="w-3 h-3" />
                      <span className="text-[9px] font-bold uppercase tracking-widest">Bulk Save</span>
                    </button>
                  )}
                  {evaluations.length > 0 && (
                    <button 
                      onClick={handleDownloadExcel}
                      className="p-1 hover:bg-[#141414]/10 text-[#141414] rounded-sm transition-colors"
                      title="Download Excel"
                    >
                      <FileDown className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {evaluations.length > 0 && (
                    <button 
                      onClick={() => {
                        showConfirm(
                          '전체 이력 삭제',
                          '모든 평가 이력을 삭제하시겠습니까?',
                          () => {
                            setEvaluations([]);
                            setSelectedEval(null);
                            toast.success('모든 평가 이력이 삭제되었습니다.');
                          }
                        );
                      }}
                      className="p-1 hover:bg-red-500/10 text-red-600 rounded-sm transition-colors"
                      title="Clear All History"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <History className="w-4 h-4 opacity-40" />
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto">
                {evaluations.length === 0 ? (
                  <div className="p-12 text-center opacity-30">
                    <FileText className="w-12 h-12 mx-auto mb-4" />
                    <p className="text-xs uppercase tracking-widest">No evaluations yet</p>
                  </div>
                ) : (
                  <div className="divide-y divide-[#141414]">
                    {evaluations.map((ev) => (
                      <div
                        key={ev.id}
                        onClick={() => setSelectedEval(ev)}
                        className={cn(
                          "w-full p-4 text-left transition-all hover:bg-[#141414] hover:text-[#E4E3E0] group cursor-pointer",
                          selectedEval?.id === ev.id ? "bg-[#141414] text-[#E4E3E0]" : "bg-transparent"
                        )}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono opacity-50">
                              {new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {selectedEval?.id === ev.id && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  showConfirm(
                                    '이력 삭제',
                                    `'${ev.fileName}' 평가 이력을 삭제하시겠습니까?`,
                                    () => {
                                      setEvaluations(prev => prev.filter(item => item.id !== ev.id));
                                      if (selectedEval?.id === ev.id) setSelectedEval(null);
                                      toast.success('평가 이력이 삭제되었습니다.');
                                    }
                                  );
                                }}
                                className="p-0.5 hover:bg-white/20 rounded-full transition-colors"
                                title="Delete this entry"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            )}
                          </div>
                          <div className={cn(
                            "px-2 py-0.5 text-[9px] font-bold uppercase tracking-tighter rounded-full border",
                            (ev.userDecision || ev.aiDecision) === 'PASS' 
                              ? "bg-[#dcfce7] text-[#15803d] border-[#bbf7d0] group-hover:bg-[#16a34a] group-hover:text-white group-hover:border-[#16a34a]" 
                              : "bg-[#fee2e2] text-[#b91c1c] border-[#fecaca] group-hover:bg-[#dc2626] group-hover:text-white group-hover:border-[#dc2626]"
                          )}>
                            {ev.userDecision || ev.aiDecision}
                          </div>
                        </div>
                        <h4 className="text-xs font-medium truncate mb-0.5">{ev.fileName}</h4>
                        {(ev.teamName || ev.proposerName) && (
                          <p className="text-[10px] font-bold uppercase tracking-widest text-[#141414] mb-1 flex items-center gap-1">
                            <BookOpen className="w-2.5 h-2.5 opacity-40" /> 
                            {ev.teamName && <span>[{ev.teamName}] </span>}
                            {ev.proposerName}
                          </p>
                        )}
                        <p className="text-[10px] opacity-60 line-clamp-2 italic font-serif">
                          {ev.reasoning}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Content Area (Upload + Detail) */}
            <div 
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={cn(
                "flex-1 flex flex-col overflow-hidden bg-[#F5F5F3] transition-all relative",
                dragActive && "bg-[#141414]/5"
              )}
            >
              {/* Upload Header */}
              <div className="h-14 p-4 border-b border-[#141414] bg-[#D6D5D2] flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                  <h3 className="font-serif italic text-sm">Upload Proposals</h3>
                  {isEvaluating && (
                    <div className="flex flex-col gap-1 min-w-[200px]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-[#141414] text-[9px] font-bold uppercase tracking-widest">
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          <span>Analyzing {evaluationProgress}%</span>
                        </div>
                      </div>
                      <div className="h-1 w-full bg-[#141414]/10 rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${evaluationProgress}%` }}
                          className="h-full bg-[#141414]"
                        />
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  {!isEvaluating && (
                    <>
                      <p className="text-[10px] opacity-60 uppercase tracking-widest hidden lg:block">
                        Drag & Drop or <button onClick={() => fileInputRef.current?.click()} className="underline font-bold">Browse</button>
                      </p>
                      <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="p-1.5 border border-[#141414] hover:bg-[#141414] hover:text-[#E4E3E0] transition-all flex items-center gap-2"
                        title="Upload Files"
                      >
                        <UploadCloud className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">New Upload</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Detail View */}
              <div className="flex-1 overflow-y-auto p-12">
                {dragActive && (
                  <div className="absolute inset-0 z-50 bg-[#141414]/90 flex flex-col items-center justify-center text-[#E4E3E0] pointer-events-none">
                    <UploadCloud className="w-16 h-16 mb-4 animate-bounce" />
                    <h3 className="font-serif italic text-3xl mb-2">Drop to Upload</h3>
                    <p className="text-xs uppercase tracking-widest opacity-60">PDF, PPTX, DOCX & TXT (Max 80 files)</p>
                  </div>
                )}
                
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
                        <div className="flex-1">
                          <h2 className="font-serif italic text-4xl mb-2">{selectedEval.fileName}</h2>
                          {(selectedEval.teamName || selectedEval.proposerName) && (
                            <p className="text-sm font-bold text-[#141414]/70 mb-6 uppercase tracking-widest flex items-center gap-2">
                              <BookOpen className="w-4 h-4" /> 
                              {selectedEval.teamName && <span>[{selectedEval.teamName}] </span>}
                              {selectedEval.proposerName}
                            </p>
                          )}
                          
                          <div className="flex items-center gap-8">
                            {/* User Decision Buttons moved to the left */}
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
                            </div>

                            <div className="flex items-center gap-4 border-l border-[#141414]/10 pl-8">
                              <div className="flex flex-col">
                                <span className="text-[10px] uppercase tracking-widest font-bold">AI Decision</span>
                                <span className={cn(
                                  "text-xl font-bold tracking-tighter",
                                  selectedEval.aiDecision === 'PASS' ? "text-[#16a34a]" : "text-[#dc2626]"
                                )}>
                                  {selectedEval.aiDecision}
                                </span>
                              </div>
                              {selectedEval.userDecision && (
                                <div className="flex flex-col border-l border-[#141414]/10 pl-4">
                                  <span className="text-[10px] uppercase tracking-widest font-bold">User Override</span>
                                  <span className={cn(
                                    "text-xl font-bold tracking-tighter",
                                    selectedEval.userDecision === 'PASS' ? "text-[#16a34a]" : "text-[#dc2626]"
                                  )}>
                                    {selectedEval.userDecision}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Reasoning Section */}
                      <section className="space-y-4">
                        <div className="flex items-center justify-between border-b border-[#141414]/10 pb-2">
                          <h3 className="font-serif italic text-xl">Analysis Reasoning</h3>
                          {selectedEval.similarityScore && selectedEval.similarityScore >= 80 && selectedEval.similarCaseId && (
                            <button 
                              onClick={() => {
                                setComparisonCaseId(selectedEval.similarCaseId || null);
                                setIsComparing(true);
                              }}
                              className="flex items-center gap-2 px-3 py-1 bg-[#dc2626] text-white text-[9px] font-bold uppercase tracking-widest rounded-full hover:bg-[#b91c1c] transition-all animate-pulse"
                            >
                              <AlertTriangle className="w-3 h-3" />
                              중복 의심: 유사도 {selectedEval.similarityScore}% (대조하기)
                            </button>
                          )}
                        </div>
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

                      {/* User Decision Reasoning */}
                      <section className="space-y-4">
                        <div className="flex items-center justify-between border-b border-[#141414]/10 pb-2">
                          <h3 className="font-serif italic text-xl">Decision Reasoning</h3>
                          <span className="text-[10px] uppercase tracking-widest opacity-50 italic">Optional: Overrides AI reasoning in library</span>
                        </div>
                        <textarea
                          value={selectedEval.userReasoning || ''}
                          onChange={(e) => handleUserReasoningChange(selectedEval.id, e.target.value)}
                          placeholder="Enter your reasoning for this decision here... (If left blank, it will be stored as empty in the library)"
                          className="w-full p-6 bg-white border border-[#141414]/10 rounded-sm font-sans text-sm leading-relaxed min-h-[150px] focus:outline-none focus:border-[#141414]/30 transition-all"
                        />
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
          </div>
        ) : (
          /* Reference Library View - Split Layout */
          <div className="flex-1 flex overflow-hidden bg-white">
            {/* Left: Controls & Add Form */}
            <div className="w-[400px] border-r border-[#141414] overflow-y-auto bg-[#F5F5F3] flex flex-col">
              <header className="px-6 py-8 border-b border-[#141414] bg-[#D6D5D2] flex flex-col justify-center min-h-[116px]">
                <h2 className="font-serif italic text-2xl">Reference Library</h2>
              </header>

              <div className="flex-1 overflow-y-auto p-8 space-y-10">
                {/* Library Analysis Section */}
                <section className="space-y-8">
                  <div className="flex items-center justify-between">
                    <h3 className="font-serif italic text-xl">Library Analysis</h3>
                    <span className="text-[10px] uppercase tracking-widest opacity-40">Total {totalCount} Cases</span>
                  </div>

                  {/* Pass/Fail Ratio */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-[10px] uppercase tracking-widest font-bold">
                      <span>Pass Ratio</span>
                      <span>{passRatio}%</span>
                    </div>
                    <div className="h-2 w-full bg-[#141414]/5 rounded-full overflow-hidden flex">
                      <div 
                        className="h-full bg-[#16a34a] transition-all duration-1000" 
                        style={{ width: `${passRatio}%` }}
                      />
                      <div 
                        className="h-full bg-[#dc2626] transition-all duration-1000" 
                        style={{ width: `${failRatio}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[9px] opacity-50 italic">
                      <span>{passCount} Passed</span>
                      <span>{failCount} Failed</span>
                    </div>
                  </div>

                  {/* Top Failure Reasons */}
                  <div className="space-y-4">
                    <h4 className="text-[10px] uppercase tracking-widest font-bold opacity-50">Top Failure Reasons</h4>
                    {failureReasons.length > 0 ? (
                      <div className="space-y-2">
                        {failureReasons.map((reason, i) => (
                          <div key={i} className="flex items-center gap-3 p-3 bg-white border border-[#141414]/5 rounded-sm">
                            <span className="text-xs font-serif italic opacity-30">0{i+1}</span>
                            <p className="text-[10px] leading-tight flex-1 line-clamp-2">{reason.text}</p>
                            <span className="text-[10px] font-bold opacity-50">{reason.count}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] opacity-40 italic">No failure data available yet.</p>
                    )}
                  </div>

                  {/* Search Section */}
                  <div className="space-y-4 pt-4 border-t border-[#141414]/10">
                    <h4 className="text-[10px] uppercase tracking-widest font-bold opacity-50">Search Library</h4>
                    <div className="relative">
                      <input 
                        type="text"
                        value={librarySearchQuery}
                        onChange={(e) => setLibrarySearchQuery(e.target.value)}
                        placeholder="Search by Team or Title..."
                        className="w-full p-3 pl-10 text-xs border border-[#141414] focus:outline-none bg-white"
                      />
                      <BookOpen className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-30" />
                    </div>

                    {/* Search Results */}
                    {librarySearchQuery && (
                      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                        {librarySearchResults.length > 0 ? (
                          librarySearchResults.map(res => (
                            <button
                              key={res.id}
                              onClick={() => handleSearchResultClick(res.id)}
                              className="w-full text-left p-3 bg-white border border-[#141414]/10 hover:border-[#141414] transition-all group"
                            >
                              <div className="flex items-center justify-between mb-1">
                                <span className={cn(
                                  "text-[8px] uppercase tracking-widest px-1.5 py-0.5 rounded-sm",
                                  res.type === 'PASS' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                                )}>
                                  {res.type}
                                </span>
                                <span className="text-[9px] opacity-40">{res.teamName || 'No Team'}</span>
                              </div>
                              <p className="text-[10px] font-bold truncate group-hover:text-blue-600">{res.title}</p>
                            </button>
                          ))
                        ) : (
                          <p className="text-[10px] opacity-40 italic text-center py-4">No results found.</p>
                        )}
                      </div>
                    )}

                    {/* Filters Section */}
                    <div className="space-y-4 pt-4 border-t border-[#141414]/10">
                      <h4 className="text-[10px] uppercase tracking-widest font-bold opacity-50">Filters</h4>
                      
                      {/* PASS/FAIL Filter */}
                      <div className="space-y-1.5">
                        <label className="text-[9px] uppercase tracking-widest opacity-40">Decision Type</label>
                        <div className="flex gap-1">
                          {['ALL', 'PASS', 'FAIL'].map((type) => (
                            <button
                              key={type}
                              onClick={() => setFilterType(type as any)}
                              className={cn(
                                "flex-1 py-1.5 text-[9px] uppercase tracking-widest border transition-all",
                                filterType === type 
                                  ? "bg-[#141414] text-white border-[#141414]" 
                                  : "bg-white text-[#141414] border-[#141414]/10 hover:border-[#141414]/30"
                              )}
                            >
                              {type}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Team Filter */}
                      <div className="space-y-1.5">
                        <label className="text-[9px] uppercase tracking-widest opacity-40">Team/Department</label>
                        <select
                          value={filterTeam}
                          onChange={(e) => setFilterTeam(e.target.value)}
                          className="w-full p-2 text-[10px] border border-[#141414]/10 bg-white focus:outline-none focus:border-[#141414]"
                        >
                          <option value="ALL">All Teams</option>
                          {uniqueTeams.map(team => (
                            <option key={team} value={team}>{team}</option>
                          ))}
                        </select>
                      </div>

                      {/* Period Filter */}
                      <div className="space-y-1.5">
                        <label className="text-[9px] uppercase tracking-widest opacity-40">Time Period</label>
                        <select
                          value={filterPeriod}
                          onChange={(e) => setFilterPeriod(e.target.value as any)}
                          className="w-full p-2 text-[10px] border border-[#141414]/10 bg-white focus:outline-none focus:border-[#141414]"
                        >
                          <option value="ALL">All Time</option>
                          <option value="TODAY">Today</option>
                          <option value="WEEK">Last 7 Days</option>
                          <option value="MONTH">Last 30 Days</option>
                        </select>
                      </div>

                      {/* Failure Reason Filter */}
                      <div className="space-y-1.5">
                        <label className="text-[9px] uppercase tracking-widest opacity-40">Failure Reason</label>
                        <select
                          value={filterReason}
                          onChange={(e) => setFilterReason(e.target.value)}
                          className="w-full p-2 text-[10px] border border-[#141414]/10 bg-white focus:outline-none focus:border-[#141414]"
                        >
                          <option value="ALL">All Reasons</option>
                          {failureReasons.map(reason => (
                            <option key={reason.text} value={reason.text}>{reason.text}</option>
                          ))}
                        </select>
                      </div>

                      {/* Reset Filters */}
                      <button
                        onClick={() => {
                          setFilterType('ALL');
                          setFilterTeam('ALL');
                          setFilterPeriod('ALL');
                          setFilterReason('ALL');
                          setLibrarySearchQuery('');
                        }}
                        className="w-full py-2 text-[9px] uppercase tracking-widest text-red-600 hover:bg-red-50 transition-all border border-transparent hover:border-red-100"
                      >
                        Reset All Filters
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            </div>

            {/* Right: Stored Cases List */}
            <div className="flex-1 overflow-hidden bg-[#F5F5F3] flex flex-col">
              <header className="px-6 py-8 border-b border-[#141414] bg-[#D6D5D2] flex items-center justify-between min-h-[116px]">
                <h3 className="font-serif italic text-2xl">Stored Cases</h3>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] uppercase tracking-widest font-bold bg-[#141414] text-white px-2 py-1">
                    Total {filteredExamples.length}
                  </span>
                  <input 
                    type="file" 
                    ref={libraryFileInputRef}
                    onChange={handleImportLibraryExcel}
                    accept=".xlsx, .xls"
                    className="hidden"
                  />
                  <button 
                    onClick={() => libraryFileInputRef.current?.click()}
                    className="flex items-center gap-2 px-3 py-1.5 border border-[#141414] text-[10px] uppercase tracking-widest hover:bg-[#141414] hover:text-white transition-all"
                    title="Import Excel"
                  >
                    <FileUp className="w-3 h-3" /> Import Excel
                  </button>
                  <button 
                    onClick={handleDownloadLibraryExcel}
                    disabled={filteredExamples.length === 0}
                    className="flex items-center gap-2 px-3 py-1.5 border border-[#141414] text-[10px] uppercase tracking-widest hover:bg-[#141414] hover:text-white transition-all disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#141414]"
                  >
                    <FileText className="w-3 h-3" /> Export Excel
                  </button>
                  {selectedExampleIds.length > 0 && (
                    <button 
                      onClick={handleDeleteSelected}
                      className="text-[10px] uppercase tracking-widest text-red-600 flex items-center gap-1 hover:underline"
                    >
                      <Trash2 className="w-3 h-3" /> Delete Selected ({selectedExampleIds.length})
                    </button>
                  )}
                </div>
              </header>

              <div className="flex-1 overflow-y-auto p-10">
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 content-start">
                  {filteredExamples.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((ex) => (
                    <div 
                      key={ex.id} 
                      id={`example-${ex.id}`}
                      onClick={() => toggleExampleSelection(ex.id)}
                      className={cn(
                        "p-3 border transition-all relative group bg-white cursor-pointer h-fit",
                        selectedExampleIds.includes(ex.id) ? "border-[#141414] ring-1 ring-[#141414]" : "border-[#141414]/10 hover:border-[#141414]/30",
                        editingExampleId === ex.id && "ring-2 ring-blue-500 border-blue-500"
                      )}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <div className={cn(
                            "w-2.5 h-2.5 border border-[#141414] flex items-center justify-center",
                            selectedExampleIds.includes(ex.id) ? "bg-[#141414]" : "bg-white"
                          )}>
                            {selectedExampleIds.includes(ex.id) && <div className="w-1 h-1 bg-white" />}
                          </div>
                          <span className={cn(
                            "px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-tighter rounded-full border",
                            ex.type === 'PASS' ? "bg-[#dcfce7] text-[#15803d] border-[#bbf7d0]" : "bg-[#fee2e2] text-[#b91c1c] border-[#fecaca]"
                          )}>
                            {ex.type}
                          </span>
                          {(ex.teamName || ex.proposerName) && (
                            <span className="text-[7px] uppercase tracking-widest opacity-40 italic">
                              [{ex.teamName || '미인식'}] {ex.proposerName}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {editingExampleId !== ex.id && (
                            <button 
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartEdit(ex);
                              }}
                              className="p-1 hover:bg-blue-50 rounded-full transition-all text-blue-500 opacity-40 group-hover:opacity-100"
                              title="Edit Reasoning"
                            >
                              <Pencil className="w-2.5 h-2.5" />
                            </button>
                          )}
                          <button 
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveExample(ex.id);
                            }}
                            className="p-1 hover:bg-red-50 rounded-full transition-all text-red-500 opacity-40 group-hover:opacity-100"
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      </div>
                      <h4 className="font-serif italic text-base mb-1 truncate">{ex.title}</h4>
                      <div className="space-y-1.5">
                        <div>
                          <p className="text-[9px] leading-relaxed line-clamp-2 text-[#141414]/80">{ex.content}</p>
                        </div>
                        <div className="pt-1.5 border-t border-[#141414]/5">
                          {editingExampleId === ex.id ? (
                            <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                              <textarea
                                value={editingReasoning}
                                onChange={(e) => setEditingReasoning(e.target.value)}
                                className="w-full p-2 text-[9px] border border-[#141414] focus:outline-none min-h-[80px] bg-white"
                                autoFocus
                              />
                              <div className="flex justify-end gap-1">
                                <button
                                  onClick={() => setEditingExampleId(null)}
                                  className="px-2 py-1 text-[8px] uppercase tracking-widest border border-[#141414] hover:bg-[#141414]/5"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={() => handleSaveEdit(ex.id)}
                                  className="px-2 py-1 text-[8px] uppercase tracking-widest bg-[#141414] text-white"
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-[9px] leading-relaxed italic line-clamp-2 text-[#141414]">{ex.reasoning}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {filteredExamples.length === 0 && (
                    <div className="col-span-full py-20 text-center border border-dashed border-[#141414]/20 opacity-30">
                      <BookOpen className="w-16 h-16 mx-auto mb-4" />
                      <p className="text-xs uppercase tracking-widest">No cases match your filters.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Pagination Controls - Fixed at bottom to align with chat input */}
              {filteredExamples.length > itemsPerPage && (
                <div className="p-4 bg-[#F5F5F3] flex items-center justify-center gap-2">
                  <button 
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="p-1.5 hover:bg-[#141414]/5 disabled:opacity-20 transition-all"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.ceil(filteredExamples.length / itemsPerPage) }, (_, i) => i + 1).map((page) => (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={cn(
                          "w-7 h-7 text-[10px] font-bold transition-all border",
                          currentPage === page 
                            ? "bg-[#141414] text-white border-[#141414]" 
                            : "border-transparent hover:border-[#141414]/20"
                        )}
                      >
                        {page}
                      </button>
                    ))}
                  </div>

                  <button 
                    onClick={() => setCurrentPage(prev => Math.min(Math.ceil(filteredExamples.length / itemsPerPage), prev + 1))}
                    disabled={currentPage === Math.ceil(filteredExamples.length / itemsPerPage)}
                    className="p-1.5 hover:bg-[#141414]/5 disabled:opacity-20 transition-all"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
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
                  <label className="text-[10px] uppercase tracking-widest opacity-60 block">AI Model ID</label>
                  <input 
                    type="text"
                    value={aiConfig.modelId}
                    onChange={(e) => setAiConfig(prev => ({ ...prev, modelId: e.target.value }))}
                    placeholder="gemini-3-flash-preview"
                    className="w-full p-3 text-xs bg-white border border-[#141414] focus:outline-none"
                  />
                  <p className="text-[9px] opacity-40 italic">Default: gemini-3-flash-preview</p>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest opacity-60 block">Custom API Key (Optional)</label>
                  <input 
                    type="password"
                    value={aiConfig.apiKey}
                    onChange={(e) => setAiConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                    placeholder="Enter your own API key if needed"
                    className="w-full p-3 text-xs bg-white border border-[#141414] focus:outline-none"
                  />
                  <p className="text-[9px] opacity-40 italic">비워두면 시스템 기본 Gemini API 키를 사용합니다.</p>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest opacity-60 block">Base URL (For OpenAI Compatible APIs)</label>
                  <input 
                    type="text"
                    value={aiConfig.baseUrl}
                    onChange={(e) => setAiConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                    placeholder="https://api.openai.com/v1"
                    className="w-full p-3 text-xs bg-white border border-[#141414] focus:outline-none"
                  />
                  <p className="text-[9px] opacity-40 italic">OpenAI 호환 API를 사용할 때만 입력하세요.</p>
                </div>
                <div className="space-y-2 pt-2 border-t border-[#141414]/10">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] uppercase tracking-widest opacity-60 block">Similarity Threshold (중복 판정 기준)</label>
                    <span className="text-xs font-bold">{aiConfig.similarityThreshold}%</span>
                  </div>
                  <input 
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={aiConfig.similarityThreshold}
                    onChange={(e) => setAiConfig(prev => ({ ...prev, similarityThreshold: parseInt(e.target.value) }))}
                    className="w-full h-1 bg-[#141414]/10 rounded-lg appearance-none cursor-pointer accent-[#141414]"
                  />
                  <p className="text-[9px] opacity-40 italic">유사도가 이 수치 이상일 경우 중복 과제로 판정하여 FAIL 처리합니다.</p>
                </div>
                <div className="pt-4 flex items-center gap-2 text-[10px] text-blue-600 bg-blue-50 p-3 border border-blue-200">
                  <Info className="w-4 h-4 flex-shrink-0" />
                  <p>Gemini 모델을 사용하면 별도의 설정 없이 바로 이용 가능합니다.</p>
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
                  <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-[#141414]/20">
                    {criteria.map((c) => (
                      <div key={c.id} className="group relative p-4 border border-[#141414] bg-white space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={c.isMandatory}
                              onChange={(e) => handleUpdateCriterion(c.id, { isMandatory: e.target.checked })}
                              className="w-3 h-3 accent-[#141414]"
                            />
                            <span className={cn(
                              "text-[9px] uppercase tracking-widest font-bold",
                              c.isMandatory ? "text-red-600" : "text-blue-600"
                            )}>
                              {c.isMandatory ? 'Mandatory' : 'Optional'}
                            </span>
                          </label>
                          <button 
                            onClick={() => handleRemoveCriterion(c.id)}
                            className="p-1 hover:bg-red-50 rounded-full transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-red-500" />
                          </button>
                        </div>
                        <textarea
                          value={c.text}
                          onChange={(e) => handleUpdateCriterion(c.id, { text: e.target.value })}
                          className="w-full p-2 text-xs bg-[#F5F5F3] border border-transparent focus:border-[#141414] focus:outline-none min-h-[60px] resize-none transition-all"
                        />
                      </div>
                    ))}
                    {criteria.length === 0 && (
                      <div className="py-12 text-center border border-dashed border-[#141414]/20 opacity-30">
                        <p className="text-[10px] uppercase tracking-widest">No criteria defined.</p>
                      </div>
                    )}
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

      {/* Custom Confirm Modal */}
      <AnimatePresence>
        {confirmModal.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-[#E4E3E0] border border-[#141414] shadow-2xl p-6 space-y-6"
            >
              <div className="space-y-2">
                <h3 className="font-serif italic text-xl">{confirmModal.title}</h3>
                <p className="text-xs opacity-70 leading-relaxed">{confirmModal.message}</p>
              </div>
              <div className="flex justify-end gap-2">
                <button 
                  onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                  className="px-4 py-2 border border-[#141414] text-[10px] uppercase tracking-widest hover:bg-[#141414]/5 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    confirmModal.onConfirm();
                    setConfirmModal(prev => ({ ...prev, isOpen: false }));
                  }}
                  className="px-4 py-2 bg-red-600 text-white text-[10px] uppercase tracking-widest hover:bg-red-700 transition-all"
                >
                  Confirm
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Comparison Modal */}
      <AnimatePresence>
        {isComparing && comparisonCaseId && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 md:p-8">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsComparing(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-7xl h-full max-h-[90vh] bg-[#E4E3E0] border border-[#141414] shadow-2xl flex flex-col overflow-hidden"
            >
              <header className="p-6 border-b border-[#141414] bg-[#D6D5D2] flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <h3 className="font-serif italic text-2xl">Side-by-Side Comparison</h3>
                  <div className="px-3 py-1 bg-red-600 text-white text-[10px] font-bold uppercase tracking-widest rounded-full">
                    유사도 {selectedEval?.similarityScore}%
                  </div>
                </div>
                <button 
                  onClick={() => setIsComparing(false)}
                  className="p-2 hover:bg-[#141414]/5 rounded-full transition-all"
                >
                  <X className="w-6 h-6" />
                </button>
              </header>

              <div className="flex-1 overflow-hidden flex divide-x divide-[#141414]">
                {/* Current Proposal */}
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="p-4 bg-[#141414] text-white text-[10px] uppercase tracking-widest font-bold">
                    Current Proposal: {selectedEval?.fileName}
                  </div>
                  <div className="flex-1 overflow-y-auto p-8 space-y-8 bg-white">
                    <section className="space-y-3">
                      <h4 className="font-serif italic text-lg border-b border-[#141414]/10 pb-1">Analysis Reasoning</h4>
                      <div className="text-xs leading-relaxed prose prose-sm max-w-none">
                        <Markdown>{selectedEval?.reasoning}</Markdown>
                      </div>
                    </section>
                    <section className="space-y-3">
                      <h4 className="font-serif italic text-lg border-b border-[#141414]/10 pb-1">Extracted Content</h4>
                      <div className="p-4 bg-[#F5F5F3] border border-[#141414]/5 rounded-sm font-mono text-[10px] leading-relaxed whitespace-pre-wrap">
                        {selectedEval?.tableSummary}
                      </div>
                    </section>
                  </div>
                </div>

                {/* Similar Case */}
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="p-4 bg-blue-900 text-white text-[10px] uppercase tracking-widest font-bold flex justify-between items-center">
                    <span>Reference Case: {examples.find(ex => ex.id === comparisonCaseId)?.title}</span>
                    <span className={cn(
                      "px-2 py-0.5 rounded-sm text-[8px]",
                      examples.find(ex => ex.id === comparisonCaseId)?.type === 'PASS' ? "bg-green-500" : "bg-red-500"
                    )}>
                      {examples.find(ex => ex.id === comparisonCaseId)?.type}
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-8 space-y-8 bg-[#F5F5F3]">
                    {examples.find(ex => ex.id === comparisonCaseId) ? (
                      <>
                        <section className="space-y-3">
                          <h4 className="font-serif italic text-lg border-b border-[#141414]/10 pb-1">Original Reasoning</h4>
                          <div className="text-xs leading-relaxed prose prose-sm max-w-none">
                            <Markdown>{examples.find(ex => ex.id === comparisonCaseId)?.reasoning}</Markdown>
                          </div>
                        </section>
                        <section className="space-y-3">
                          <h4 className="font-serif italic text-lg border-b border-[#141414]/10 pb-1">Case Content</h4>
                          <div className="p-4 bg-white border border-[#141414]/5 rounded-sm font-mono text-[10px] leading-relaxed whitespace-pre-wrap">
                            {examples.find(ex => ex.id === comparisonCaseId)?.content}
                          </div>
                        </section>
                      </>
                    ) : (
                      <div className="h-full flex items-center justify-center italic opacity-40">
                        Case not found or has been deleted.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <footer className="p-6 border-t border-[#141414] bg-[#D6D5D2] flex justify-between items-center">
                <p className="text-[10px] opacity-60 italic">
                  * 유사도가 80% 이상인 경우 중복 과제일 가능성이 높으므로 면밀한 검토가 필요합니다.
                </p>
                <button 
                  onClick={() => setIsComparing(false)}
                  className="px-8 py-2 bg-[#141414] text-white text-[10px] uppercase tracking-widest hover:bg-[#141414]/90 transition-all"
                >
                  Close Comparison
                </button>
              </footer>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <Toaster position="top-right" richColors closeButton />
    </div>
  );
}
