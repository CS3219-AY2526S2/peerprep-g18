import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2, X, Users } from 'lucide-react';
import { toast } from 'sonner';
import { GATEWAY_URL } from '../constants';
import { auth } from '../firebase';


export function MatchingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const criteria = location.state as { difficulties: string[]; topics: string[] } | null;

  const [elapsedTime, setElapsedTime] = useState(0);
  const [dots, setDots] = useState('');
  
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasRequestedRef = useRef(false);
  const isTransitioningRef = useRef(false);

  useEffect(() => {
    
    if (!criteria) {
      navigate('/dashboard', { replace: true });
      return;
    }

    if (hasRequestedRef.current) return;
    hasRequestedRef.current = true;

    const startMatchmaking = async () => {
      try {
        const firebaseUser = auth.currentUser;
        if (!firebaseUser) throw new Error("Not authenticated");
        const token = await firebaseUser.getIdToken();

        // Join Queue
        const response = await fetch(`${GATEWAY_URL}/matching/find-pair`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            topic_options: criteria.topics,
            difficulty_options: criteria.difficulties
          })
        });

        if (response.status === 202) {
          const data = await response.json();
          startPolling(data.ticket_id, token);
        } else if (response.status === 400) {
          alert("You are already in the queue!");
          handleCancelClick();
        } else {
          throw new Error("Failed to join queue");
        }
      } catch (err) {
        console.error("Matchmaking error:", err);
        toast.error("Failed to start matchmaking.");
        handleCancelClick();
      }
    };

    const startPolling = (ticketId: string, token: string) => {
      // Poll the Status Endpoint every 1 second
      pollingIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch(`${GATEWAY_URL}/matching/find-pair/status/${ticketId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });

          if (res.status === 200) {
            // match found
            clearInterval(pollingIntervalRef.current!);
            isTransitioningRef.current = true;
            const matchData = await res.json();

            toast.success("Match found! Setting up your room...");

            // Setup Room
            const initRes = await fetch(`${GATEWAY_URL}/session/init`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({
                peer_id: matchData.peer_id,
                topic: matchData.topic,
                difficulty: matchData.difficulty
              })
            });

            if (!initRes.ok) throw new Error("Failed to initialize session");

            const initData = await initRes.json();

            navigate(`/session/${initData.room_id}`, { replace: true });
            
          } else if (res.status === 408) {
            // User timeout
            clearInterval(pollingIntervalRef.current!);
            toast.info("No match found. Please try again!");
            navigate('/dashboard', { replace: true });
          }
          // If 202, still waiting, let the loop run again
        } catch (err) {
          console.error("Polling error:", err);
        }
      }, 1000);
    };

    startMatchmaking();

    // Cleanup function when component unmounts
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [criteria, navigate]);

  // Manual cancellation
  const handleCancelClick = async () => {
    // Stop polling
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }
    
    // Tell backend to delete the ticket
    try {
      const firebaseUser = auth.currentUser;
      if (firebaseUser) {
          const token = await firebaseUser.getIdToken();
          await fetch(`${GATEWAY_URL}/matching/cancel-pair`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          });
      }
    } catch (err) {
      console.error("Failed to cancel on backend", err);
    }

    navigate('/dashboard', { replace: true });
  };
  
  // --- Visual Timers ---
  useEffect(() => {
    const timer = setInterval(() => setElapsedTime((prev) => prev + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const dotsTimer = setInterval(() => setDots((prev) => (prev.length >= 3 ? '' : prev + '.')), 500);
    return () => clearInterval(dotsTimer);
  }, []);

  if (!criteria) return null;

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <div className="card-purple text-center relative">
          <button
            onClick={handleCancelClick}
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

          <button onClick={handleCancelClick} className="btn-secondary w-full">
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