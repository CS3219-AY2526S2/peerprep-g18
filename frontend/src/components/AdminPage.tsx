import { useState, useEffect } from 'react';
import { Shield, Trash2, Loader2, Star, Users, BookOpen, Plus, X, Search, Save, LogOut } from 'lucide-react';
import { GATEWAY_URL } from '../constants';

interface AdminPageProps {
  currentUser: any;
  onLogout: () => void;
}

type AdminTab = 'users' | 'questions';

export function AdminPage({ currentUser, onLogout }: AdminPageProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  const [users, setUsers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState('');
  
  // Question State
  const [searchId, setSearchId] = useState('');
  const [managedQuestion, setManagedQuestion] = useState<any>(null);
  const [isAddingQuestion, setIsAddingQuestion] = useState(false);
  
  // New Question Form State
  const [newQuestion, setNewQuestion] = useState({
    title: '',
    topic: 'Arrays',
    difficulty: 'Easy',
    statement: '',
    template: '',
    examples: [''],
    constraints: [''],
    hints: ['']
  });

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

  const handleLookupQuestion = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchId.trim()) return;

    setActionLoading('lookup-q');
    setError('');
    setManagedQuestion(null);

    try {
      const token = localStorage.getItem('peerprep_token');
      const response = await fetch(`${GATEWAY_URL}/question/${searchId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!response.ok) {
        if (response.status === 404) throw new Error('Question not found');
        throw new Error('Failed to fetch question');
      }

      const data = await response.json();
      setManagedQuestion(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpdateQuestion = async () => {
    if (!managedQuestion) return;
    setActionLoading('update-q');
    try {
      const token = localStorage.getItem('peerprep_token');
      const response = await fetch(`${GATEWAY_URL}/question/${managedQuestion.question_id}`, {
        method: 'PUT',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(managedQuestion)
      });

      if (!response.ok) throw new Error('Failed to update question');
      
      alert('Question updated successfully!');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(null);
    }
  };

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
      
      if (managedQuestion?.question_id === questionId) {
        setManagedQuestion(null);
        setSearchId('');
      }
      alert('Question deleted successfully');
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

  const handleAddQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading('add-question');
    try {
      const token = localStorage.getItem('peerprep_token');
      const response = await fetch(`${GATEWAY_URL}/question`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(newQuestion)
      });

      if (!response.ok) throw new Error('Failed to add question');
      
      setIsAddingQuestion(false);
      setNewQuestion({
        title: '', topic: 'Arrays', difficulty: 'Easy',
        statement: '', template: '', examples: [''],
        constraints: [''], hints: ['']
      });
      alert('Question added successfully!');
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
            onClick={() => setActiveTab('users')}
            className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all ${
              activeTab === 'users' ? 'bg-[#E8B995] text-[#4A4563]' : 'bg-[#3A3552] text-white hover:bg-[#453F5C]'
            }`}
          >
            <Users className="w-5 h-5" />
            User Management
          </button>
          <button
            onClick={() => setActiveTab('questions')}
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
                <h2 className="text-white font-bold text-2xl">Question Management</h2>
                <button 
                  onClick={() => setIsAddingQuestion(true)}
                  className="btn-secondary py-2 px-4 flex items-center gap-2"
                >
                  <Plus className="w-5 h-5" />
                  Add New
                </button>
              </div>

              {/* Lookup Form */}
              <form onSubmit={handleLookupQuestion} className="flex gap-3 mb-8">
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Enter Question ID (e.g., 1)"
                    value={searchId}
                    onChange={(e) => setSearchId(e.target.value)}
                    className="input-field w-full pl-12"
                  />
                </div>
                <button 
                  type="submit" 
                  disabled={actionLoading === 'lookup-q'}
                  className="btn-primary flex items-center gap-2 whitespace-nowrap"
                >
                  {actionLoading === 'lookup-q' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                  Find Question
                </button>
              </form>

              {/* Managed Question Details */}
              {managedQuestion && (
                <div className="bg-[#3A3552] rounded-[32px] p-8 space-y-6 border-2 border-[#E8B995]/20 animate-in fade-in slide-in-from-bottom-4">
                  <div className="flex justify-between items-start">
                    <h3 className="text-white font-bold text-xl">Manage Question #{managedQuestion.question_id}</h3>
                    <button 
                      onClick={() => handleDeleteQuestion(managedQuestion.question_id)}
                      className="text-red-500 hover:bg-red-500/10 p-2 rounded-full transition-colors"
                    >
                      {actionLoading === `delete-q-${managedQuestion.question_id}` ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
                    </button>
                  </div>

                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-gray-400 text-sm ml-2">Title</label>
                      <input 
                        value={managedQuestion.title}
                        onChange={(e) => setManagedQuestion({...managedQuestion, title: e.target.value})}
                        className="input-field w-full bg-[#2D2942]"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-gray-400 text-sm ml-2">Topic</label>
                      <input 
                        value={managedQuestion.topic}
                        onChange={(e) => setManagedQuestion({...managedQuestion, topic: e.target.value})}
                        className="input-field w-full bg-[#2D2942]"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-gray-400 text-sm ml-2">Difficulty</label>
                    <div className="flex gap-3">
                      {['Easy', 'Medium', 'Hard'].map((diff) => (
                        <button
                          key={diff}
                          onClick={() => setManagedQuestion({...managedQuestion, difficulty: diff})}
                          className={`flex-1 py-2 rounded-xl font-bold transition-all ${
                            managedQuestion.difficulty === diff 
                            ? 'bg-[#E8B995] text-[#4A4563]' 
                            : 'bg-[#2D2942] text-white hover:bg-[#35304C]'
                          }`}
                        >
                          {diff}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-gray-400 text-sm ml-2">Statement</label>
                    <textarea 
                      rows={4}
                      value={managedQuestion.statement}
                      onChange={(e) => setManagedQuestion({...managedQuestion, statement: e.target.value})}
                      className="input-field w-full bg-[#2D2942] rounded-[20px] resize-none"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-gray-400 text-sm ml-2">Template</label>
                    <textarea 
                      rows={4}
                      value={managedQuestion.template}
                      onChange={(e) => setManagedQuestion({...managedQuestion, template: e.target.value})}
                      className="input-field w-full bg-[#2D2942] rounded-[20px] font-mono text-sm resize-none"
                    />
                  </div>

                  <button 
                    onClick={handleUpdateQuestion}
                    disabled={actionLoading === 'update-q'}
                    className="w-full btn-secondary flex items-center justify-center gap-2 py-4 text-lg"
                  >
                    {actionLoading === 'update-q' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                    Save Changes
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Add Question Modal (Remains similar but with direct creation) */}
      {isAddingQuestion && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
          <div className="bg-[#4A4563] rounded-[32px] w-full max-w-2xl max-h-[90vh] overflow-y-auto p-8 relative custom-scrollbar">
            <button 
              onClick={() => setIsAddingQuestion(false)}
              className="absolute top-6 right-6 text-gray-400 hover:text-white"
            >
              <X className="w-6 h-6" />
            </button>
            
            <h2 className="text-white font-bold text-2xl mb-6">New Question</h2>
            
            <form onSubmit={handleAddQuestion} className="space-y-6">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-gray-300 text-sm ml-2">Title</label>
                  <input 
                    required
                    value={newQuestion.title}
                    onChange={(e) => setNewQuestion({...newQuestion, title: e.target.value})}
                    placeholder="e.g. Two Sum"
                    className="input-field w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-gray-300 text-sm ml-2">Topic</label>
                  <select 
                    value={newQuestion.topic}
                    onChange={(e) => setNewQuestion({...newQuestion, topic: e.target.value})}
                    className="input-field w-full appearance-none"
                  >
                    <option>Arrays</option>
                    <option>Strings</option>
                    <option>Hash Tables</option>
                    <option>Linked Lists</option>
                    <option>Trees</option>
                    <option>Graphs</option>
                    <option>Dynamic Programming</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-gray-300 text-sm ml-2">Difficulty</label>
                <div className="flex gap-4">
                  {['Easy', 'Medium', 'Hard'].map((diff) => (
                    <button
                      key={diff}
                      type="button"
                      onClick={() => setNewQuestion({...newQuestion, difficulty: diff})}
                      className={`flex-1 py-3 rounded-2xl font-bold transition-all ${
                        newQuestion.difficulty === diff 
                        ? 'bg-[#E8B995] text-[#4A4563]' 
                        : 'bg-[#3A3552] text-white hover:bg-[#453F5C]'
                      }`}
                    >
                      {diff}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-gray-300 text-sm ml-2">Problem Statement</label>
                <textarea 
                  required
                  rows={4}
                  value={newQuestion.statement}
                  onChange={(e) => setNewQuestion({...newQuestion, statement: e.target.value})}
                  placeholder="Describe the problem..."
                  className="input-field w-full rounded-[24px] resize-none"
                />
              </div>

              <div className="space-y-2">
                <label className="text-gray-300 text-sm ml-2">Code Template</label>
                <textarea 
                  required
                  rows={4}
                  value={newQuestion.template}
                  onChange={(e) => setNewQuestion({...newQuestion, template: e.target.value})}
                  placeholder="Initial code for users..."
                  className="input-field w-full rounded-[24px] font-mono text-sm resize-none"
                />
              </div>

              <button 
                type="submit" 
                disabled={actionLoading === 'add-question'}
                className="w-full btn-secondary text-lg py-4 flex items-center justify-center gap-2"
              >
                {actionLoading === 'add-question' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                Create Question
              </button>
            </form>
          </div>
        </div>
      )}

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