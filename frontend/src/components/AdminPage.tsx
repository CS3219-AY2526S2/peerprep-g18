/**
 * AI USE DECLARATION:
 * This page utilizes AI generated boilerplate for Tailwind CSS styling 
 * and React state update patterns. Core business logic, API integration 
 * sequences, and input validation rules were manually architected and 
 * verified to ensure system integrity.
 * All AI-generated snippets have been manually reviewed, refactored for 
 * PeerPrep's specific architecture, and verified.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Trash2, Loader2, Star, Users, BookOpen, Plus, X, Search, Save, LogOut, ChevronRight } from 'lucide-react';
import { GATEWAY_URL } from '../constants';
import { DynamicArrayInput } from './ui/DynamicArrayInput';
import { QuestionModal } from './ui/QuestionModal'
import { useUser } from '../contexts/UserContext';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { dracula } from '@uiw/codemirror-theme-dracula';
import { useRef } from 'react';

type AdminTab = 'users' | 'questions';

export function AdminPage() {
  const navigate = useNavigate();
  const { user: currentUser, handleLogout } = useUser();

  const onLogout = async () => {
    await handleLogout();
    navigate('/', { replace: true });
  };
  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  const [users, setUsers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  

  // Question State
  const [searchId, setSearchId] = useState('');
  const [managedQuestion, setManagedQuestion] = useState<any>(null);
  const [filterTopic, setFilterTopic] = useState('All');
  const [filterDifficulty, setFilterDifficulty] = useState('All');
  const [availableTopics, setAvailableTopics] = useState<string[]>([]);
  const [availableDifficulties, setAvailableDifficulties] = useState<string[]>([]);
  // const [isAddingQuestion, setIsAddingQuestion] = useState(false);

  const [questions, setQuestions] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const questionsPerPage = 10;
  const [activeSearchMode, setActiveSearchMode] = useState<'none' | 'id' | 'criteria'>('none');

  const isFiltered =
    activeSearchMode !== 'none' ||
    searchId.trim() !== '' ||
    filterTopic !== 'All' ||
    filterDifficulty !== 'All';

  // New Question Form State
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    mode: 'add' | 'edit';
    data?: any;
  }>({ isOpen: false, mode: 'add' });

  const fetchQuestions = async (page: number, topic = 'All', difficulty = 'All') => {
    setIsLoading(true);
    try {
      const token = localStorage.getItem('peerprep_token');

      let url = `${GATEWAY_URL}/question/all?page=${page}&limit=10`;
      if (topic !== 'All') url += `&topic=${encodeURIComponent(topic)}`;
      if (difficulty !== 'All') url += `&difficulty=${difficulty}`;

      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const data = await response.json();
      setQuestions(data.questions);
      setTotalPages(data.total_pages);
      setCurrentPage(data.current_page);
    } catch (err: any) {
      setError("Failed to filter questions");
    } finally {
      setIsLoading(false);
    }
  };

  // Refetch whenever the page changes
  useEffect(() => {
    if (activeTab === 'questions') {
      if (!searchId) {
        fetchQuestions(currentPage, filterTopic, filterDifficulty);
      }
    }
  }, [activeTab, currentPage]);

  useEffect(() => {
    if (activeTab === 'users') {
      fetchUsers();
    } else {
      setIsLoading(false);
    }
  }, [activeTab]);

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const token = localStorage.getItem('peerprep_token');
      const response = await fetch(`${GATEWAY_URL}/admin/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!response.ok) throw new Error('Failed to fetch users');
      const data = await response.json();
      setUsers(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleModalSuccess = async (updatedData?: any) => {
  if (!updatedData) return;

  if (modalConfig.mode === 'edit') {
    // For Edits, we keep the search criteria because the admin 
    // likely wants to stay in their filtered view. It may show some stale value 
    // (ie. the new update might be out of place from the current search, 
    // but it just brings more convinience for the admin to be in this way)
    setManagedQuestion(updatedData);
    setQuestions(prev =>
      prev.map(q =>
        q.question_id.toString() === updatedData.question_id.toString()
          ? { ...q, title: updatedData.title, topic: updatedData.topic, difficulty: updatedData.difficulty }
          : q
      )
    );
  } else {
    // For Adds, we reset the search state 
    setSearchId('');
    setFilterTopic('All');
    setFilterDifficulty('All');
    setActiveSearchMode('none'); 

    if (currentPage === totalPages) {
      await fetchQuestions(currentPage, 'All', 'All');
    } else {
      await fetchQuestions(1, 'All', 'All'); 
    }
    setManagedQuestion(updatedData);
  }
  await refreshMetadata();
};

  const fetchQuestionDetails = async (id: string) => {
    setActionLoading(`fetching-${id}`);
    try {
      const token = localStorage.getItem('peerprep_token');
      const response = await fetch(`${GATEWAY_URL}/question/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to fetch details');
      const data = await response.json();
      setManagedQuestion(data);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleLookupQuestion = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchId.trim()) return;

    // Clear Metadata Filters and previous managed question
    setFilterTopic('All');
    setFilterDifficulty('All');
    setManagedQuestion(null);

    setActionLoading('lookup-q');
    try {
      const token = localStorage.getItem('peerprep_token');
      const response = await fetch(`${GATEWAY_URL}/question/${searchId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Question not found');
      const data = await response.json();
      setManagedQuestion(data);
      setQuestions([data]);
      setTotalPages(1); 
      setCurrentPage(1);
      setActiveSearchMode('id');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleMetadataSearch = () => {
    // Clear ID Search and previous managed question
    setSearchId('');
    setManagedQuestion(null);

    // Perform the fetch
    fetchQuestions(1, filterTopic, filterDifficulty);
    if (filterTopic === 'All' && filterDifficulty === 'All') {
      setActiveSearchMode('none');
    } else {
      setActiveSearchMode('criteria');
    }
  };

  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Only scroll if a question was actually expanded (managedQuestion is not null)
    if (managedQuestion && scrollRef.current) {
      scrollRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'start' // Aligns the top of the card to the top of the screen
      });
    }
  }, [managedQuestion]);

  

  const fetchMetadata = async () => {
    try {
      const token = localStorage.getItem('peerprep_token');
      const headers = { 'Authorization': `Bearer ${token}` };

      const [topicsRes, diffRes] = await Promise.all([
        fetch(`${GATEWAY_URL}/question/topics`, { headers }),
        fetch(`${GATEWAY_URL}/question/difficulties`, { headers })
      ]);

      if (topicsRes.ok && diffRes.ok) {
        const topics = await topicsRes.json();
        const difficulties = await diffRes.json();
        setAvailableTopics(topics);
        setAvailableDifficulties(difficulties);
      }
    } catch (err) {
      console.error("Metadata fetch failed", err);
    }
  };


  useEffect(() => {
    fetchMetadata();
  }, []);

  const refreshMetadata = async () => {
    try {
      const token = localStorage.getItem('peerprep_token');
      const headers = { 'Authorization': `Bearer ${token}` };

      const [topicsRes, diffRes] = await Promise.all([
        fetch(`${GATEWAY_URL}/question/topics`, { headers }),
        fetch(`${GATEWAY_URL}/question/difficulties`, { headers })
      ]);

      if (topicsRes.ok && diffRes.ok) {
        setAvailableTopics(await topicsRes.json());
        setAvailableDifficulties(await diffRes.json());
      }
    } catch (err) {
      console.error("Metadata refresh failed", err);
    }
  };
  
  const handleTabChange = (tab: AdminTab) => {    
    setManagedQuestion(null); 
    setSearchId('');
    setActiveTab(tab);
  };

  // Update your fetchQuestions call inside useEffect
  useEffect(() => {
    if (activeTab === 'questions') {
      if (questions.length === 1 && totalPages === 1) return;
      fetchQuestions(currentPage, filterTopic, filterDifficulty);
    }
  }, [activeTab, currentPage]); 


  const handleDeleteQuestion = async (questionId: string) => {
    if (!window.confirm('Are you sure you want to delete this question?')) return;

    setActionLoading(`delete-q-${questionId}`);
    try {
      const token = localStorage.getItem('peerprep_token');
      const response = await fetch(`${GATEWAY_URL}/question/${questionId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Failed to delete question');

      const updatedQuestions = questions.filter(q => q.question_id.toString() !== questionId.toString());
      setQuestions(updatedQuestions);

      if (managedQuestion?.question_id.toString() === questionId.toString()) {
        setManagedQuestion(null);
      }

      // Logic for jumping back a page if the current one becomes empty
      if (updatedQuestions.length === 0 && currentPage > 1) {
        setCurrentPage(prev => prev - 1);
      } else if (updatedQuestions.length === 0 && currentPage === 1) {
        fetchQuestions(1);
      }

      alert('Question deleted successfully');
      await refreshMetadata(); // Refresh after successful delete
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handlePromote = async (targetUserId: string) => {
    if (!window.confirm('Are you sure you want to promote this user to Admin?')) return;
    
    setActionLoading(`promote-${targetUserId}`);
    try {
      const token = localStorage.getItem('peerprep_token');
      const response = await fetch(`${GATEWAY_URL}/admin/promote/${targetUserId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Failed to promote user');
      
      setUsers(users.map(u => u.user_id === targetUserId ? { ...u, role: 'Admin' } : u));
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteUser = async (targetUserId: string, targetUsername: string) => {
    if (!window.confirm(`Are you absolutely sure you want to permanently delete @${targetUsername}?`)) return;
    
    setActionLoading(`delete-user-${targetUserId}`);
    try {
      const token = localStorage.getItem('peerprep_token');
      const response = await fetch(`${GATEWAY_URL}/admin/users/${targetUserId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to delete user');
      }
      
      setUsers(users.filter(u => u.user_id !== targetUserId));
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="min-h-screen p-6 bg-[#2D2942]">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-end mb-8 gap-3">
          <div className="flex items-center gap-2 text-[#E8B995] bg-[#3A3552] px-4 py-2 rounded-full font-bold">
            <Shield className="w-5 h-5" />
            {currentUser.role === 'Root' ? 'Root' : 'Admin'} Panel (as {currentUser.username})
          </div>
          <button
            onClick={onLogout}
            className="bg-[#3A3552] p-2.5 rounded-full hover:bg-[#453F5C] transition-all"
          >
            <LogOut className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 mb-8">
          <button
            onClick={() => handleTabChange('users')}
            className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all ${
              activeTab === 'users' ? 'bg-[#E8B995] text-[#4A4563]' : 'bg-[#3A3552] text-white hover:bg-[#453F5C]'
            }`}
          >
            <Users className="w-5 h-5" />
            User Management
          </button>
          <button
            onClick={() => handleTabChange('questions')}
            className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all ${
              activeTab === 'questions' ? 'bg-[#E8B995] text-[#4A4563]' : 'bg-[#3A3552] text-white hover:bg-[#453F5C]'
            }`}
          >
            <BookOpen className="w-5 h-5" />
            Question Bank
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border-2 border-red-500 text-red-500 px-4 py-3 rounded-2xl mb-6">
            {error}
          </div>
        )}

        {/* Content Area */}
        <div className="card-purple">
          {activeTab === 'users' ? (
            <>
              <h2 className="text-white font-bold text-2xl mb-6">Users</h2>
              {isLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-8 h-8 text-[#E8B995] animate-spin" />
                </div>
              ) : (
                <div className="space-y-3">
                  {users.length === 0 ? (
                    <p className="text-gray-400 text-center py-8">No users found.</p>
                  ) : (
                    users.map((u) => (
                      <div key={u.user_id} className="bg-[#3A3552] rounded-2xl p-4 flex items-center justify-between flex-wrap gap-4">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-[#E8B995] flex items-center justify-center text-[#4A4563] font-bold">
                            {u.username.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-white font-bold">@{u.username}</span>
                              {u.role === 'Admin' && <Star className="w-4 h-4 text-[#E8B995] fill-current" />}
                            </div>
                            <p className="text-sm text-gray-400">{u.email}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {u.role === 'User' && (
                            <button 
                              onClick={() => handlePromote(u.user_id)}
                              disabled={actionLoading !== null}
                              className="btn-secondary py-2 px-4 text-sm flex items-center gap-2"
                            >
                              {actionLoading === `promote-${u.user_id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                              Promote
                            </button>
                          )}
                          
                          {u.username !== 'Root' && u.user_id !== currentUser.uid && (
                            <button 
                              onClick={() => handleDeleteUser(u.user_id, u.username)}
                              disabled={actionLoading !== null}
                              className="bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white p-2.5 rounded-full transition-colors"
                            >
                              {actionLoading === `delete-user-${u.user_id}` ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-white font-bold text-2xl">Question Bank</h2>
                <button 
                  onClick={() => setModalConfig({ isOpen: true, mode: 'add' })}
                  className="btn-secondary py-2 px-4 flex items-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  Add New
                </button>
              </div>
                <div className="space-y-3 mb-8">
                  {/* Choice 1: Search by ID */}
                  <div className="space-y-3">
                    <form onSubmit={handleLookupQuestion} className="flex gap-3">
                      <div className="relative flex-1">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                          type="text"
                          placeholder="Enter Question ID..."
                          value={searchId}
                          onChange={(e) => setSearchId(e.target.value)}
                          className="input-field w-full pl-12"
                        />
                      </div>
                      <button type="submit" className="btn-primary px-8">Search ID</button>
                    </form>
                  </div>

                  {/*  Separator */}
                  <div className="relative flex items-center py-1">
                    <div className="flex-grow h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
                    <span className="flex-none mx-4 text-gray-500 font-bold italic text-[12px] uppercase tracking-[0.3em]">
                      or
                    </span>
                    <div className="flex-grow h-px bg-gradient-to-r from-transparent via-white/10 to-transparent"></div>
                  </div>

                  {/* Choice 2: Search by Topic/Difficulty */}
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-3">
                      <select
                        value={filterTopic}
                        onChange={(e) => setFilterTopic(e.target.value)}
                        className="input-field flex-1 bg-[#3A3552] cursor-pointer"
                      >
                        <option value="All">Any Topic</option>
                        {availableTopics.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>

                      <select
                        value={filterDifficulty}
                        onChange={(e) => setFilterDifficulty(e.target.value)}
                        className="input-field flex-1 bg-[#3A3552] cursor-pointer"
                      >
                        <option value="All">Any Difficulty</option>
                        {availableDifficulties.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>

                      <button
                        onClick={handleMetadataSearch}
                        className="btn-secondary px-8 flex items-center gap-2"
                      >
                        <Search className="w-4 h-4" /> Search by Criteria
                      </button>

                      {/* Global Clear Search */}
                      
                        <button
                          disabled={!isFiltered}
                          onClick={() => {
                            setFilterTopic('All');
                            setFilterDifficulty('All');
                            setSearchId('');
                            setManagedQuestion(null);
                            setActiveSearchMode('none');
                            setCurrentPage(1);
                            fetchQuestions(1, 'All', 'All');
                          }}
                          className="text-gray-400 hover:text-white px-4 flex items-center gap-2 transition-colors border border-white/5 rounded-xl hover:bg-white/5"
                        >
                          <X className="w-4 h-4" /> Reset All
                        </button>
                      
                    </div>
                  </div>
                </div>


              {/* The Expandable List */}
              <div className="space-y-4">
                {isLoading ? (
                  <div className="flex justify-center py-12"><Loader2 className="animate-spin text-[#E8B995]" /></div>
                ) : questions.length === 0 ? (
                  <p className="text-gray-400 text-center py-8">No questions found on this page.</p>
                ) : (
                  questions.map((q) => {
                    const isExpanded = managedQuestion?.question_id?.toString() === q.question_id.toString();
                    
                    return (
                      <div
                        key={q.question_id}
                        className={`transition-all duration-300 rounded-[24px] overflow-hidden border-2 ${isExpanded ? 'bg-[#3A3552] border-[#E8B995] shadow-xl' : 'bg-[#3A3552]/40 border-transparent hover:border-white/10'
                          }`}
                      >
                        {/* The main clickable header area */}
                        
                        <div
                          ref={isExpanded ? scrollRef : null}
                          style={{ scrollMarginTop: '20px' }}
                          className="p-5 flex items-center justify-between cursor-pointer group"
                          onClick={() => {
                            // If we only have 1 question in the list, we are in "Search Mode"
                            // Prevent collapsing in this mode
                            const isSearchMode = questions.length === 1 && searchId !== '';

                            if (isExpanded) {
                              if (!isSearchMode) {
                                setManagedQuestion(null);
                              }
                              // If isSearchMode, we do nothing (keep it expanded)
                            } else {
                              fetchQuestionDetails(q.question_id.toString());
                            }
                          }}
                        >
                          {/* LEFT SIDE INFO (Now inside the clickable div) */}
                          <div className="flex items-center gap-4">
                            <span className="text-[#E8B995] font-mono font-bold">#{q.question_id}</span>
                            <div>
                              <h4 className="text-white font-bold group-hover:text-[#E8B995] transition-colors">{q.title}</h4>
                              <div className="flex gap-2 mt-1">
                                <span className="text-[10px] uppercase font-bold text-gray-400">{q.topic}</span>
                                <span className={`text-[10px] uppercase font-bold ${q.difficulty === 'Easy' ? 'text-green-400' :
                                    q.difficulty === 'Medium' ? 'text-yellow-400' : 'text-red-400'
                                  }`}>• {q.difficulty}</span>
                              </div>
                            </div>
                          </div>

                          {/* RIGHT SIDE ICONS */}
                          <div className="flex items-center gap-3">
                            {/* Update the loading check to use the specific ID */}
                            {actionLoading === `fetching-${q.question_id}` && (
                              <Loader2 className="w-4 h-4 animate-spin text-[#E8B995]" />
                            )}
                            <ChevronRight className={`... ${isExpanded ? 'rotate-90' : ''}`} />
                          </div>
                        </div>

                        {/* Expandable Content (The "Deep" View) */}
                        {isExpanded && (
                          <div className="p-8 pt-0 space-y-8 animate-in fade-in slide-in-from-top-4">
                            <div className="h-px bg-white/5 w-full mb-6" />
                            
                            {/* Reuse your existing Managed Question UI here */}
                            <div className="flex justify-end gap-2">
                              <button 
                                onClick={() => setModalConfig({ isOpen: true, mode: 'edit', data: managedQuestion })} 
                                className="btn-secondary py-1.5 px-4 text-sm flex items-center gap-2"
                              >
                                <Plus className="w-4 h-4 rotate-45" /> Edit Question
                              </button>
                              <button onClick={() => handleDeleteQuestion(managedQuestion.question_id)} className="text-red-500 hover:bg-red-500/10 p-2 rounded-full transition-colors">
                                <Trash2 className="w-5 h-5" />
                              </button>
                            </div>

                            <div className="space-y-2">
                              <label className="text-gray-400 text-xs font-bold uppercase tracking-wider">Problem Statement</label>
                              <div className="prose prose-invert max-w-none text-white bg-[#2D2942]/50 p-6 rounded-[20px] border border-white/5">
                                <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
                                  {managedQuestion.statement}
                                </ReactMarkdown>
                              </div>
                            </div>

                            <div className="space-y-6">
                              <DynamicArrayInput 
                                label="Examples" 
                                items={managedQuestion.examples?.filter((e: string) => e.trim() !== '') || []}
                                isEditing={false}
                                emptyMessage="No examples provided."
                              />
                              <DynamicArrayInput 
                                label="Constraints" 
                                items={managedQuestion.constraints?.filter((c: string) => c.trim() !== '') || []}
                                isEditing={false}
                                emptyMessage="No constraints defined."
                              />
                              <DynamicArrayInput 
                                label="Hints"
                                items={managedQuestion.hints?.filter((h: string) => h.trim() !== '') || []}
                                isEditing={false}
                                emptyMessage="No hints available for this question."
                              />
                            </div>

                            <div className="space-y-2">
                              <label className="text-gray-400 text-xs font-bold uppercase tracking-wider">Python Template</label>
                              <div className="rounded-[20px] overflow-hidden border border-white/5">
                                <CodeMirror value={managedQuestion.template} theme={dracula} extensions={[python()]} readOnly={true} />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Pagination Controls moved below the list */}
              <div className="flex items-center justify-center gap-4 mt-12 pb-8">
                <div className="flex items-center justify-center gap-4 mt-8">
                <button
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(prev => prev - 1)}
                  className="px-4 py-2 rounded-xl bg-[#3A3552] text-white disabled:opacity-30 hover:bg-[#453F5C] transition-all"
                >
                  Previous
                </button>

                <div className="flex gap-2">
                  {Array.from({ length: totalPages }).map((_, i) => {
                    const pageNum = i + 1;
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`w-10 h-10 rounded-xl font-bold transition-all ${
                          currentPage === pageNum 
                            ? 'bg-[#E8B995] text-[#4A4563] shadow-lg shadow-[#E8B995]/20' 
                            : 'bg-[#3A3552] text-white hover:bg-[#453F5C]'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>

                <button
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(prev => prev + 1)}
                  className="px-4 py-2 rounded-xl bg-[#3A3552] text-white disabled:opacity-30 hover:bg-[#453F5C] transition-all"
                >
                  Next
                </button>
              </div>
              </div>
            </>
          )}
        </div>
      </div>

      <QuestionModal 
        isOpen={modalConfig.isOpen}
        mode={modalConfig.mode}
        initialData={modalConfig.data}
        onClose={() => setModalConfig({ ...modalConfig, isOpen: false })}
        onSuccess={handleModalSuccess}
        topics={availableTopics}
        difficulties={availableDifficulties}
      />

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #3A3552;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #E8B995;
          border-radius: 10px;
        }
      `}</style>
    </div>
  );
}