import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, User, Check, Loader2, History } from 'lucide-react';
import { useUser } from '../contexts/UserContext';
import { GATEWAY_URL } from '../constants';

export function Dashboard() {
  const navigate = useNavigate();
  const { user, handleLogout } = useUser();
  const [selectedDifficulties, setSelectedDifficulties] = useState<string[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);

  const [availableTopics, setAvailableTopics] = useState<string[]>([]);
  const [availableDifficulties, setAvailableDifficulties] = useState<string[]>([]);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(true);

  const isAdmin = user?.role?.toLowerCase() === 'admin' || user?.role?.toLowerCase() === 'root' || user?.username === 'Root';

  // Admins should not see the user dashboard — redirect to admin panel.
  // This covers: admin login, mid-session promotion (via visibilitychange or
  // auth:token_stale), and direct /dashboard URL access by an admin.
  useEffect(() => {
    if (isAdmin) {
      navigate('/admin', { replace: true });
    }
  }, [isAdmin, navigate]);

  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const token = localStorage.getItem('peerprep_token');
        const headers = { 'Authorization': `Bearer ${token}` };

        const [topicsRes, diffRes] = await Promise.all([
          fetch(`${GATEWAY_URL}/question/topics`, { headers }),
          fetch(`${GATEWAY_URL}/question/difficulties`, { headers })
        ]);

        if (topicsRes.status === 401 || diffRes.status === 401) {
          const data = await (topicsRes.status === 401 ? topicsRes : diffRes).clone().json().catch(() => ({}));
          if (data.detail === 'ACCOUNT_DELETED') {
            window.dispatchEvent(new Event('auth:account_deleted'));
            return;
          }
        }

        if (topicsRes.ok && diffRes.ok) {
          setAvailableTopics(await topicsRes.json());
          setAvailableDifficulties(await diffRes.json());
        }
      } catch (err) {
        console.error("Metadata fetch failed", err);
      } finally {
        setIsLoadingMetadata(false);
      }
    };

    if (user && !isAdmin) {
      fetchMetadata();
    }
  }, [user, isAdmin]);

  if (!user || isAdmin) return null; // prevent flash of user dashboard while redirecting

  const toggleDifficulty = (diff: string) => {
    setSelectedDifficulties(prev =>
      prev.includes(diff)
        ? prev.filter(d => d !== diff)
        : [...prev, diff]
    );
  };

  const toggleTopic = (topic: string) => {
    setSelectedTopics(prev =>
      prev.includes(topic)
        ? prev.filter(t => t !== topic)
        : [...prev, topic]
    );
  };

  const handleStartMatching = () => {
    if (selectedDifficulties.length > 0 && selectedTopics.length > 0) {
      navigate('/matching', {
        state: {
          difficulties: selectedDifficulties,
          topics: selectedTopics
        }
      });
    }
  };

  const onLogout = async () => {
    await handleLogout();
    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
          <div className="flex items-center gap-4 order-2 sm:order-1">
            <img
              src={user.avatar}
              alt={user.username}
              className="avatar-circle flex-shrink-0"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-[#4A4563] font-bold text-xl truncate">@{user.username}</h2>
                {isAdmin && (
                  <span className="bg-[#E8B995] text-[#4A4563] text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                    Admin
                  </span>
                )}
              </div>
              <p className="text-gray-600 text-sm break-all">{user.email}</p>
            </div>
          </div>
          <div className="flex gap-3 order-1 sm:order-2 self-end sm:self-auto">
            {/* Button for attempt history */}
            <button
              onClick={() => navigate('/history')}
              title="Attempt History"
              className="bg-[#3A3552] p-3 rounded-full hover:bg-[#453F5C] transition-all group relative"
            >
              <History className="w-5 h-5 text-white group-hover:text-[#E8B995]" />
              
            </button>

            <button
              onClick={() => navigate('/profile')}
              className="bg-[#E8B995] p-3 rounded-full hover:bg-[#F0C5A5] transition-all"
            >
              <User className="w-5 h-5 text-[#4A4563]" />
            </button>
            <button
              onClick={onLogout}
              className="bg-[#4A4563] p-3 rounded-full hover:bg-[#5A5573] transition-all"
            >
              <LogOut className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>
        {/* Welcome Card */}
        <div className="card-peach mb-8">
          <div className="flex justify-between items-start gap-4">
            <div className="flex-1">
              <h1 className="text-[#4A4563] font-bold text-2xl mb-2">
                Ready to Practice?
              </h1>
              <p className="text-gray-700">
                Select one or more preferences below to find a peer and start coding together
              </p>
            </div>
          </div>
        </div>

        {/* Selection Cards */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Difficulty Selection */}
          <div className="card-purple">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold">Select Difficulties</h3>
              {selectedDifficulties.length > 0 && (
                <span className="bg-[#E8B995] text-[#4A4563] text-xs font-semibold px-3 py-1 rounded-full">
                  {selectedDifficulties.length} selected
                </span>
              )}
            </div>
            <div className="space-y-3">
              {isLoadingMetadata ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 text-[#E8B995] animate-spin" />
                </div>
              ) : (
                availableDifficulties.map((diff) => {
                  const isSelected = selectedDifficulties.includes(diff);
                  return (
                    <button
                      key={diff}
                      onClick={() => toggleDifficulty(diff)}
                      className={`w-full text-left p-4 rounded-2xl transition-all flex items-center justify-between ${
                        isSelected
                          ? 'bg-[#E8B995] text-[#4A4563]'
                          : 'bg-[#3A3552] text-white hover:bg-[#453F5C]'
                      }`}
                    >
                      <span className="font-semibold">{diff}</span>
                      {isSelected && (
                        <Check className="w-5 h-5" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Topic Selection */}
          <div className="card-purple">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold">Select Topics</h3>
              {selectedTopics.length > 0 && (
                <span className="bg-[#E8B995] text-[#4A4563] text-xs font-semibold px-3 py-1 rounded-full">
                  {selectedTopics.length} selected
                </span>
              )}
            </div>
            <div className="space-y-3 max-h-[320px] overflow-y-auto pr-2 custom-scrollbar">
              {isLoadingMetadata ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 text-[#E8B995] animate-spin" />
                </div>
              ) : (
                availableTopics.map((topic) => {
                  const isSelected = selectedTopics.includes(topic);
                  return (
                    <button
                      key={topic}
                      onClick={() => toggleTopic(topic)}
                      className={`w-full text-left p-4 rounded-2xl transition-all flex items-center justify-between ${
                        isSelected
                          ? 'bg-[#E8B995] text-[#4A4563]'
                          : 'bg-[#3A3552] text-white hover:bg-[#453F5C]'
                      }`}
                    >
                      <span className="font-semibold">{topic}</span>
                      {isSelected && (
                        <Check className="w-5 h-5" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Start Button */}
        <button
          onClick={handleStartMatching}
          disabled={selectedDifficulties.length === 0 || selectedTopics.length === 0 || isLoadingMetadata}
          className={`w-full btn-secondary text-xl py-5 ${
            selectedDifficulties.length === 0 || selectedTopics.length === 0 || isLoadingMetadata
              ? 'opacity-50 cursor-not-allowed'
              : ''
          }`}
        >
          Find a Peer
        </button>

        {/* Selected Info */}
        {(selectedDifficulties.length > 0 || selectedTopics.length > 0) && (
          <div className="mt-6 text-center">
            <p className="text-gray-600">
              {selectedDifficulties.length > 0 && selectedTopics.length > 0
                ? `Matching with: ${selectedDifficulties.join(', ')} difficulty • ${selectedTopics.join(', ')}`
                : selectedDifficulties.length > 0
                ? `Selected difficulties: ${selectedDifficulties.join(', ')}`
                : `Selected topics: ${selectedTopics.join(', ')}`}
            </p>
          </div>
        )}
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
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
