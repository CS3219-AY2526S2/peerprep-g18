import { useState, useEffect } from 'react';
import { ArrowLeft, Shield, Trash2, Check, Loader2, Star } from 'lucide-react';

interface AdminPageProps {
  currentUser: any;
  onBack: () => void;
}

const GATEWAY_URL = 'http://localhost/api';

export function AdminPage({ currentUser, onBack }: AdminPageProps) {
  const [users, setUsers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const token = localStorage.getItem('peerprep_token');
      const response = await fetch(`${GATEWAY_URL}/users`, {
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

  const handlePromote = async (targetUserId: string) => {
    if (!window.confirm('Are you sure you want to promote this user to Admin?')) return;
    
    setActionLoading(`promote-${targetUserId}`);
    try {
      const token = localStorage.getItem('peerprep_token');
      const response = await fetch(`${GATEWAY_URL}/users/${targetUserId}/promote`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Failed to promote user');
      
      // Update local state to reflect the promotion
      setUsers(users.map(u => u.user_id === targetUserId ? { ...u, role: 'Admin' } : u));
    } catch (err: any) {
      alert(err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (targetUserId: string, targetUsername: string) => {
    if (!window.confirm(`Are you absolutely sure you want to permanently delete @${targetUsername}?`)) return;
    
    setActionLoading(`delete-${targetUserId}`);
    try {
      const token = localStorage.getItem('peerprep_token');
      const response = await fetch(`${GATEWAY_URL}/users/${targetUserId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to delete user');
      }
      
      // Remove user from local state
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
        <div className="flex items-center justify-between mb-8">
          <button onClick={onBack} className="flex items-center gap-2 text-gray-300 hover:text-white">
            <ArrowLeft className="w-5 h-5" />
            <span>Back to Dashboard</span>
          </button>
          
          <div className="flex items-center gap-2 text-[#E8B995] bg-[#3A3552] px-4 py-2 rounded-full font-bold">
            <Shield className="w-5 h-5" />
            Admin Panel
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border-2 border-red-500 text-red-500 px-4 py-3 rounded-2xl mb-6">
            {error}
          </div>
        )}

        <div className="card-purple overflow-hidden">
          <h2 className="text-white font-bold text-2xl mb-6">User Management</h2>
          
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-8 h-8 text-[#E8B995] animate-spin" />
            </div>
          ) : (
            <div className="space-y-3">
              {users.map((u) => (
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
                    {/* Only show promote button if they are a standard User */}
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
                    
                    {/* Allow deleting anyone except Root, and prevent the current admin from deleting themselves here (they use profile for that) */}
                    {u.username !== 'Root' && u.user_id !== currentUser.uid && (
                      <button 
                        onClick={() => handleDelete(u.user_id, u.username)}
                        disabled={actionLoading !== null}
                        className="bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white p-2.5 rounded-full transition-colors"
                        title="Delete User"
                      >
                        {actionLoading === `delete-${u.user_id}` ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}