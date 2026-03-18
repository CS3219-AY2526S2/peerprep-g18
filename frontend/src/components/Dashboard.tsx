import { useState } from 'react';
import { LogOut, User, Users as UsersIcon, Check } from 'lucide-react';

interface DashboardProps {
  user: any;
  onStartMatching: (criteria: any) => void;
  onProfileClick: () => void;
  onLogout: () => void;
}

const difficulties = [
  { id: 'easy', label: 'Easy', color: 'bg-green-500' },
  { id: 'medium', label: 'Medium', color: 'bg-yellow-500' },
  { id: 'hard', label: 'Hard', color: 'bg-red-500' }
];

const topics = [
  'Arrays',
  'Strings',
  'Hash Tables',
  'Linked Lists',
  'Trees',
  'Graphs',
  'Dynamic Programming',
  'Recursion',
  'Sorting',
  'Searching',
  'Binary Search',
  'Greedy Algorithms'
];

export function Dashboard({ user, onStartMatching, onProfileClick, onLogout }: DashboardProps) {
  const [selectedDifficulties, setSelectedDifficulties] = useState<string[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [activeUsersCount] = useState(Math.floor(Math.random() * 20) + 5); // Simulate active users

  const isAdmin = user.role?.toLowerCase() === 'admin' || user.username === 'Root';

  const toggleDifficulty = (diffId: string) => {
    setSelectedDifficulties(prev => 
      prev.includes(diffId) 
        ? prev.filter(d => d !== diffId)
        : [...prev, diffId]
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
      onStartMatching({
        difficulties: selectedDifficulties,
        topics: selectedTopics
      });
    }
  };

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-4">
            <img
              src={user.avatar}
              alt={user.username}
              className="avatar-circle"
            />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[#4A4563] font-bold text-xl">@{user.username}</h2>
                {isAdmin && (
                  <span className="bg-[#E8B995] text-[#4A4563] text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                    Admin
                  </span>
                )}
              </div>
              <p className="text-gray-600 text-sm">{user.email}</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={onProfileClick}
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

        {/* Welcome Card with Active Users */}
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
            <div className="bg-[#4A4563] rounded-2xl px-5 py-3 flex items-center gap-3">
              <UsersIcon className="w-6 h-6 text-[#E8B995]" />
              <div>
                <p className="text-white font-bold text-xl">{activeUsersCount}</p>
                <p className="text-gray-300 text-xs">Users Online</p>
              </div>
            </div>
          </div>
        </div>

        {/* Selection Cards */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Difficulty Selection */}
          <div className="card-purple">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold">Select Difficulty</h3>
              {selectedDifficulties.length > 0 && (
                <span className="bg-[#E8B995] text-[#4A4563] text-xs font-semibold px-3 py-1 rounded-full">
                  {selectedDifficulties.length} selected
                </span>
              )}
            </div>
            <div className="space-y-3">
              {difficulties.map((diff) => {
                const isSelected = selectedDifficulties.includes(diff.id);
                return (
                  <button
                    key={diff.id}
                    onClick={() => toggleDifficulty(diff.id)}
                    className={`w-full text-left p-4 rounded-2xl transition-all flex items-center justify-between ${
                      isSelected
                        ? 'bg-[#E8B995] text-[#4A4563]'
                        : 'bg-[#3A3552] text-white hover:bg-[#453F5C]'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${diff.color}`}></div>
                      <span className="font-semibold">{diff.label}</span>
                    </div>
                    {isSelected && (
                      <Check className="w-5 h-5" />
                    )}
                  </button>
                );
              })}
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
              {topics.map((topic) => {
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
              })}
            </div>
          </div>
        </div>

        {/* Start Button */}
        <button
          onClick={handleStartMatching}
          disabled={selectedDifficulties.length === 0 || selectedTopics.length === 0}
          className={`w-full btn-secondary text-xl py-5 ${
            selectedDifficulties.length === 0 || selectedTopics.length === 0
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
                ? `Matching with: ${selectedDifficulties.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(', ')} difficulty • ${selectedTopics.join(', ')}`
                : selectedDifficulties.length > 0
                ? `Selected difficulties: ${selectedDifficulties.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(', ')}`
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