import { useNavigate } from 'react-router-dom';
import { Code2, Users, MessageSquare, Zap } from 'lucide-react';

export function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <div className="max-w-6xl w-full">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <div className="inline-block bg-[#4A4563] rounded-full px-8 py-3 mb-8">
            <h1 className="text-white text-4xl font-bold">PeerPrep</h1>
          </div>
          <p className="text-2xl text-[#4A4563] mb-4 font-semibold">
            Practice Technical Interviews Together
          </p>
          <p className="text-lg text-gray-600 mb-8 max-w-2xl mx-auto">
            Connect with peers, solve coding problems in real-time, and ace your next technical interview
          </p>
          <button onClick={() => navigate('/auth')} className="btn-secondary text-xl px-12 py-4">
            Get Started
          </button>
        </div>

        {/* Features Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="card-purple text-white">
            <div className="bg-[#E8B995] w-16 h-16 rounded-full flex items-center justify-center mb-4">
              <Users className="w-8 h-8 text-[#4A4563]" />
            </div>
            <h3 className="font-bold mb-2">Peer Matching</h3>
            <p className="text-gray-300 text-sm">
              Get matched with peers based on difficulty and topic preferences
            </p>
          </div>

          <div className="card-purple text-white">
            <div className="bg-[#E8B995] w-16 h-16 rounded-full flex items-center justify-center mb-4">
              <Code2 className="w-8 h-8 text-[#4A4563]" />
            </div>
            <h3 className="font-bold mb-2">Real-time Coding</h3>
            <p className="text-gray-300 text-sm">
              Collaborate on code together in a shared editor with instant updates
            </p>
          </div>

          <div className="card-purple text-white">
            <div className="bg-[#E8B995] w-16 h-16 rounded-full flex items-center justify-center mb-4">
              <MessageSquare className="w-8 h-8 text-[#4A4563]" />
            </div>
            <h3 className="font-bold mb-2">Live Chat</h3>
            <p className="text-gray-300 text-sm">
              Discuss approaches and communicate with your partner in real-time
            </p>
          </div>

          <div className="card-purple text-white">
            <div className="bg-[#E8B995] w-16 h-16 rounded-full flex items-center justify-center mb-4">
              <Zap className="w-8 h-8 text-[#4A4563]" />
            </div>
            <h3 className="font-bold mb-2">Quick Match</h3>
            <p className="text-gray-300 text-sm">
              Find a coding partner in seconds and start practicing immediately
            </p>
          </div>
        </div>

        {/* How It Works */}
        <div className="mt-16 card-peach">
          <h2 className="text-[#4A4563] font-bold mb-6 text-center">How It Works</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="bg-[#4A4563] text-white w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 font-bold text-xl">
                1
              </div>
              <h3 className="font-semibold text-[#4A4563] mb-2">Select Preferences</h3>
              <p className="text-sm text-gray-700">
                Choose your question difficulty and topic category
              </p>
            </div>
            <div className="text-center">
              <div className="bg-[#4A4563] text-white w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 font-bold text-xl">
                2
              </div>
              <h3 className="font-semibold text-[#4A4563] mb-2">Get Matched</h3>
              <p className="text-sm text-gray-700">
                We'll pair you with a peer who has similar preferences
              </p>
            </div>
            <div className="text-center">
              <div className="bg-[#4A4563] text-white w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 font-bold text-xl">
                3
              </div>
              <h3 className="font-semibold text-[#4A4563] mb-2">Start Coding</h3>
              <p className="text-sm text-gray-700">
                Collaborate in real-time and practice together
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
