import { useState, useEffect } from 'react';
import { Loader2, X, Users } from 'lucide-react';

interface MatchingPageProps {
  criteria: any;
  onMatchFound: (session: any) => void;
  onTimeout: () => void;
  onCancel: () => void;
}

export function MatchingPage({ criteria, onMatchFound, onTimeout, onCancel }: MatchingPageProps) {
  const [elapsedTime, setElapsedTime] = useState(0);
  const [dots, setDots] = useState('');

  useEffect(() => {
    // Simulate matching process
    const matchTimer = setTimeout(() => {
      // Simulate successful match after 3-5 seconds
      const mockPartner = {
        username: ['alexchen', 'sarahj', 'mikebrown', 'emmawilson'][Math.floor(Math.random() * 4)],
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${Math.random()}`
      };

      // Pick a random difficulty and topic from the selected ones
      const randomDifficulty = criteria.difficulties[Math.floor(Math.random() * criteria.difficulties.length)];
      const randomTopic = criteria.topics[Math.floor(Math.random() * criteria.topics.length)];

      onMatchFound({
        id: 'test-session-123',
        partner: mockPartner,
        question: {
          title: `${randomDifficulty.charAt(0).toUpperCase() + randomDifficulty.slice(1)} ${randomTopic} Problem`,
          description: `Solve a challenging ${randomTopic.toLowerCase()} problem that tests your understanding of core concepts.`,
          difficulty: randomDifficulty,
          topic: randomTopic
        }
      });
    }, 3000 + Math.random() * 2000);

    // Timeout after 60 seconds (updated from 30)
    const timeoutTimer = setTimeout(() => {
      onTimeout();
    }, 60000);

    return () => {
      clearTimeout(matchTimer);
      clearTimeout(timeoutTimer);
    };
  }, [criteria, onMatchFound, onTimeout]);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const dotsTimer = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'));
    }, 500);

    return () => clearInterval(dotsTimer);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <div className="card-purple text-center relative">
          <button
            onClick={onCancel}
            className="absolute top-6 right-6 text-gray-400 hover:text-white transition-all"
          >
            <X className="w-6 h-6" />
          </button>

          <div className="mb-8">
            <div className="relative inline-block">
              <div className="bg-[#E8B995] w-24 h-24 rounded-full flex items-center justify-center mb-4 mx-auto">
                <Users className="w-12 h-12 text-[#4A4563]" />
              </div>
              <Loader2 className="w-8 h-8 text-[#E8B995] absolute -bottom-2 -right-2 animate-spin" />
            </div>
          </div>

          <h2 className="text-white text-2xl font-bold mb-4">
            Finding Your Peer{dots}
          </h2>

          <div className="bg-[#3A3552] rounded-2xl p-6 mb-6">
            <div className="space-y-3">
              <div className="flex justify-between items-start">
                <span className="text-gray-300">Difficulty:</span>
                <div className="text-right">
                  {criteria.difficulties.map((diff: string, index: number) => (
                    <span key={diff} className="text-white font-semibold capitalize">
                      {diff}{index < criteria.difficulties.length - 1 ? ', ' : ''}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex justify-between items-start">
                <span className="text-gray-300">Topics:</span>
                <div className="text-right max-w-[200px]">
                  <span className="text-white font-semibold">{criteria.topics.join(', ')}</span>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-300">Time Elapsed:</span>
                <span className="text-[#E8B995] font-semibold">{elapsedTime}s</span>
              </div>
            </div>
          </div>

          <p className="text-gray-300 text-sm mb-6">
            We're searching for a peer with matching preferences. This usually takes less than 60 seconds.
          </p>

          <button onClick={onCancel} className="btn-secondary w-full">
            Cancel Search
          </button>
        </div>

        {/* Animated dots indicator */}
        <div className="flex justify-center gap-2 mt-6">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-3 h-3 bg-[#4A4563] rounded-full animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            ></div>
          ))}
        </div>
      </div>
    </div>
  );
}