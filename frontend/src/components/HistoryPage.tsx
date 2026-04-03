/**
 * AI USE DECLARATION:
 * This page utilizes AI generated boilerplate for Tailwind CSS styling 
 * and React state patterns. Core logic for snapshot retrieval and 
 * detail expansion was manually architected to align with PeerPrep's 
 * History Service API.
 */

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Loader2, ChevronRight, Calendar, Clock, Tag, Code2, Search, X, Users } from 'lucide-react';
import { GATEWAY_URL } from '../constants';
import { useUser } from '../contexts/UserContext';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { dracula } from '@uiw/codemirror-theme-dracula';


interface HistoryMetadata {
    sessionId: string;
    questionId: number;
    title: string;
    topic: string;
    difficulty: string;
    endedAt: string;
    submittedBy: string;
}

interface HistoryDetail extends HistoryMetadata {
    statement: string;
    finalCode: string;
    examples: string[];
    constraints: string[];
    hints: string[];
    user1_id: string;
    user2_id: string;
    startedAt?: string;
}

export function HistoryPage() {
    const navigate = useNavigate();
    const { user: currentUser, handleLogout } = useUser();
    const scrollRef = useRef<HTMLDivElement | null>(null);


    const [history, setHistory] = useState<HistoryMetadata[]>([]);
    const [selectedAttempt, setSelectedAttempt] = useState<HistoryDetail | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [fetchingDetail, setFetchingDetail] = useState<string | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [error, setError] = useState('');

    const [filterTopic, setFilterTopic] = useState('All');
    const [filterDifficulty, setFilterDifficulty] = useState('All');
    const [availableTopics, setAvailableTopics] = useState<string[]>([]);
    const [availableDifficulties, setAvailableDifficulties] = useState<string[]>([]);
    const [isFiltered, setIsFiltered] = useState(false);

    // fetch the metadata info for the filters (topics and difficulties) on initial load - unique to the user who is accessing this page
    const fetchMetadata = async () => {
        try {
            const token = localStorage.getItem('peerprep_token');
            const response = await fetch(`${GATEWAY_URL}/history/filters`, {
                headers: { 'Authorization': `Bearer ${token}` } // This carries the uid info as well
            });

            if (response.ok) {
                const data = await response.json();
                setAvailableTopics(data.topics || []);
                setAvailableDifficulties(data.difficulties || []);
            }
        } catch (err) {
            console.error("Failed to fetch history filters:", err);
        }
    };

    // Fetch paginated list 
    const fetchHistory = async (page: number, topic = 'All', difficulty = 'All') => {
        setIsLoading(true);
        setError('');
        try {
            const token = localStorage.getItem('peerprep_token');
            let url = `${GATEWAY_URL}/history/user?page=${page}&page_size=10`;

            if (topic !== 'All') url += `&topic=${encodeURIComponent(topic)}`;
            if (difficulty !== 'All') url += `&difficulty=${difficulty}`;

            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!response.ok) throw new Error('Failed to fetch history');

            const data = await response.json();
            setHistory(data.attempts);
            setTotalPages(data.total_pages);
            setCurrentPage(data.current_page);
            setIsFiltered(topic !== 'All' || difficulty !== 'All');
        } catch (err: any) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    // Initial loads
    useEffect(() => {
        fetchMetadata();
    }, []);

    useEffect(() => {
        if (currentUser?.uid) {
            fetchHistory(currentPage, filterTopic, filterDifficulty);
        }
    }, [currentPage, currentUser]);

    const handleSearch = () => {
        setSelectedAttempt(null); // Close any expanded item
        setCurrentPage(1); // Reset to first page of results
        fetchHistory(1, filterTopic, filterDifficulty);
    };

    const resetFilters = () => {
        setFilterTopic('All');
        setFilterDifficulty('All');
        setCurrentPage(1);
        fetchHistory(1, 'All', 'All');
    };

    // Fetch full attempt details
    const fetchAttemptDetail = async (sessionId: string) => {
        if (selectedAttempt?.sessionId === sessionId) {
            setSelectedAttempt(null);
            return;
        }

        setFetchingDetail(sessionId);
        try {
            const token = localStorage.getItem('peerprep_token');
            const response = await fetch(
                `${GATEWAY_URL}/history/detail/${sessionId}/${currentUser?.uid}`,
                { headers: { 'Authorization': `Bearer ${token}` } }
            );

            if (!response.ok) throw new Error('Failed to load attempt details');

            const data = await response.json();
            setSelectedAttempt(data);
        } catch (err: any) {
            alert(err.message);
        } finally {
            setFetchingDetail(null);
        }
    };

    // The scrolling to adjust to top of expanded qn
    useEffect(() => {
        if (selectedAttempt && scrollRef.current) {
            scrollRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, [selectedAttempt]);

    return (
        <div className="min-h-screen p-6 bg-[#2D2942]">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                        <div className="bg-[#E8B995] p-3 rounded-2xl">
                            <BookOpen className="w-6 h-6 text-[#4A4563]" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-white">Attempt History</h1>

                        </div>
                    </div>

                </div>
                <div className="card-purple mb-6 p-6">
                    <div className="flex flex-wrap gap-3">
                        <div className="flex-1 min-w-[200px]">
                            <select
                                value={filterTopic}
                                onChange={(e) => setFilterTopic(e.target.value)}
                                className="input-field w-full bg-[#3A3552] cursor-pointer text-white"
                            >
                                <option value="All">Any Topic</option>
                                {availableTopics.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>

                        <div className="flex-1 min-w-[200px]">
                            <select
                                value={filterDifficulty}
                                onChange={(e) => setFilterDifficulty(e.target.value)}
                                className="input-field w-full bg-[#3A3552] cursor-pointer text-white"
                            >
                                <option value="All">Any Difficulty</option>
                                {availableDifficulties.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>

                        <button
                            onClick={handleSearch}
                            className="btn-secondary px-6 flex items-center gap-2"
                        >
                            <Search className="w-4 h-4" /> Filter
                        </button>

                        <button
                            disabled={!isFiltered}
                            onClick={resetFilters}
                            className="text-gray-400 hover:text-white px-4 flex items-center gap-2 transition-colors border border-white/5 rounded-xl hover:bg-white/5 disabled:opacity-30"
                        >
                            <X className="w-4 h-4" /> Reset
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="bg-red-500/10 border-2 border-red-500 text-red-500 px-4 py-3 rounded-2xl mb-6">
                        {error}
                    </div>
                )}

                <div className="card-purple">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-4">
                            <Loader2 className="w-10 h-10 text-[#E8B995] animate-spin" />
                            <p className="text-gray-400 font-medium">Retrieving Histroy...</p>
                        </div>
                    ) : history.length === 0 ? (
                        <div className="text-center py-20">
                            <div className="bg-[#3A3552] w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                                <Code2 className="w-8 h-8 text-gray-500" />
                            </div>
                            <p className="text-gray-400">
                                {isFiltered
                                    ? "No attempts match your selected filters."
                                    : "No attempts found yet. Start matching to build your history!"}
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {history.map((attempt) => {
                                const isExpanded = selectedAttempt?.sessionId === attempt.sessionId;

                                return (
                                    <div
                                        key={attempt.sessionId}
                                        className={`transition-all duration-300 rounded-[24px] overflow-hidden border-2 ${isExpanded ? 'bg-[#3A3552] border-[#E8B995] shadow-xl' : 'bg-[#3A3552]/40 border-transparent hover:border-white/10'
                                            }`}
                                    >
                                        {/* Expandable Header */}
                                        <div
                                            ref={isExpanded ? scrollRef : null}
                                            style={{ scrollMarginTop: '20px' }}
                                            className="p-5 flex items-center justify-between cursor-pointer group"
                                            onClick={() => fetchAttemptDetail(attempt.sessionId)}
                                        >
                                            <div className="flex items-center gap-4">

                                                <div>
                                                    <h4 className="text-white font-bold group-hover:text-[#E8B995] transition-colors">
                                                        {attempt.title}
                                                    </h4>
                                                    <div className="flex items-center gap-3 mt-1 text-[11px] font-bold uppercase tracking-wider">
                                                        <span className="text-gray-400">{attempt.topic}</span>
                                                        <span className="text-gray-600">•</span>
                                                        <span className={`text-[10px] uppercase font-bold ${attempt.difficulty === 'Easy' ? 'text-green-400' :
                                                            attempt.difficulty === 'Medium' ? 'text-yellow-400' : 'text-red-400'
                                                            }`}> {attempt.difficulty}</span>
                                                        <span className="text-gray-600">•</span>
                                                        <span className="text-gray-400 flex items-center gap-1">
                                                            <Calendar className="w-3 h-3" />
                                                            {new Date(attempt.endedAt).toLocaleDateString()}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-3">
                                                {fetchingDetail === attempt.sessionId && (
                                                    <Loader2 className="w-4 h-4 animate-spin text-[#E8B995]" />
                                                )}
                                                <ChevronRight className={`text-gray-500 transition-transform duration-300 ${isExpanded ? 'rotate-90' : ''}`} />
                                            </div>
                                        </div>

                                        {/* Detailed Snapshot Content */}
                                        {isExpanded && selectedAttempt && (
                                            <div className="p-8 pt-0 space-y-8 animate-in fade-in slide-in-from-top-4">
                                                <div className="h-px bg-white/5 w-full mb-6" />

                                                {/* 1. Collaboration & Time Metadata */}
                                                <div className="flex flex-wrap gap-3">
                                                    <div className="bg-[#2D2942]/50 px-4 py-2 rounded-xl border border-white/5 flex items-center gap-2">
                                                        <Users className="w-4 h-4 text-[#E8B995]" />
                                                        <span className="text-xs text-gray-300">
                                                            Collaborated with: <span className="text-white font-bold">{selectedAttempt.user1_id === currentUser?.username ? selectedAttempt.user2_id : selectedAttempt.user1_id}</span>
                                                        </span>
                                                    </div>
                                                    <div className="bg-[#2D2942]/50 px-4 py-2 rounded-xl border border-white/5 flex items-center gap-2">
                                                        <Clock className="w-4 h-4 text-[#E8B995]" />
                                                        <span className="text-xs text-gray-300">
                                                            {new Date(selectedAttempt.startedAt || '').toLocaleTimeString()} - {new Date(selectedAttempt.endedAt).toLocaleTimeString()}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* 2. Problem Snapshot (Markdown) */}
                                                <div className="space-y-3">
                                                    <label className="text-gray-400 text-xs font-bold uppercase tracking-wider">Problem Statement</label>
                                                    <div className="prose prose-invert max-w-none text-white bg-[#2D2942]/50 p-6 rounded-[20px] border border-white/5">
                                                        <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                                                            {selectedAttempt.statement}
                                                        </ReactMarkdown>
                                                    </div>
                                                </div>

                                                {/* 3. Examples (Each on separate line, Markdown) */}
                                                <div className="space-y-3">
                                                    <label className="text-gray-400 text-xs font-bold uppercase tracking-wider">Examples</label>
                                                    <div className="space-y-3">
                                                        {selectedAttempt.examples?.map((ex, i) => (
                                                            <div key={i} className="prose prose-invert max-w-none text-xs bg-[#3A3552] p-4 rounded-xl border border-white/5 text-gray-300">
                                                                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                                                                    {ex}
                                                                </ReactMarkdown>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>

                                                {/* 4. Constraints (Markdown - Card Style) */}
                                                <div className="space-y-3">
                                                    <label className="text-gray-400 text-xs font-bold uppercase tracking-wider">
                                                        Constraints
                                                    </label>
                                                    <div className="space-y-2">
                                                        {selectedAttempt.constraints?.map((c, i) => (
                                                            <div key={i} className="prose prose-invert max-w-none text-xs bg-[#3A3552] p-4 rounded-xl border border-white/5 text-gray-300">
                                                                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                                                                    {c}
                                                                </ReactMarkdown>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>

                                                {/* 5. Hints (Markdown - Card Style) */}
                                                {selectedAttempt.hints && selectedAttempt.hints.length > 0 && (
                                                    <div className="space-y-3">
                                                        <label className="text-gray-400 text-xs font-bold uppercase tracking-wider">
                                                            Hints
                                                        </label>
                                                        <div className="space-y-2">
                                                            {selectedAttempt.hints.map((h, i) => (
                                                                <div key={i} className="prose prose-invert max-w-none text-xs bg-[#3A3552] p-4 rounded-xl border border-white/5 text-gray-300 italic">
                                                                    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                                                                        {h}
                                                                    </ReactMarkdown>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* 6. Code Snapshot */}
                                                <div className="space-y-3">
                                                    <div className="flex items-center justify-between">
                                                        <label className="text-gray-400 text-xs font-bold uppercase tracking-wider">Final Code Submission</label>
                                                        <span className="text-[10px] bg-[#E8B995]/10 text-[#E8B995] px-2 py-0.5 rounded-md font-mono">python3</span>
                                                    </div>
                                                    <div className="rounded-[20px] overflow-hidden border border-white/5 shadow-2xl">
                                                        <CodeMirror
                                                            value={selectedAttempt.finalCode || "# No code was recorded."}
                                                            theme={dracula}
                                                            extensions={[python()]}
                                                            readOnly={true}
                                                            basicSetup={{ lineNumbers: true, foldGutter: true }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}

                            {/* Pagination */}
                            {(
                                <div className="flex items-center justify-center gap-4 mt-12 pb-4">
                                    <button
                                        disabled={currentPage === 1}
                                        onClick={() => setCurrentPage(prev => prev - 1)}
                                        className="px-4 py-2 rounded-xl bg-[#3A3552] text-white disabled:opacity-30 hover:bg-[#453F5C] transition-all"
                                    >
                                        Previous
                                    </button>

                                    <div className="flex gap-2">
                                        {Array.from({ length: totalPages }).map((_, i) => (
                                            <button
                                                key={i + 1}
                                                onClick={() => setCurrentPage(i + 1)}
                                                className={`w-10 h-10 rounded-xl font-bold transition-all ${currentPage === i + 1
                                                        ? 'bg-[#E8B995] text-[#4A4563] shadow-lg shadow-[#E8B995]/20'
                                                        : 'bg-[#3A3552] text-white hover:bg-[#453F5C]'
                                                    }`}
                                            >
                                                {i + 1}
                                            </button>
                                        ))}
                                    </div>

                                    <button
                                        disabled={currentPage === totalPages}
                                        onClick={() => setCurrentPage(prev => prev + 1)}
                                        className="px-4 py-2 rounded-xl bg-[#3A3552] text-white disabled:opacity-30 hover:bg-[#453F5C] transition-all"
                                    >
                                        Next
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}