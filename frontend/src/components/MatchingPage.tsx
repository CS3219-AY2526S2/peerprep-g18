import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2, X, Users } from 'lucide-react';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { toast } from 'sonner';
import { GATEWAY_URL } from '../constants';
import { auth } from '../firebase';

export function MatchingPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const criteria = location.state as { difficulties: string[]; topics: string[] } | null;

  const [elapsedTime, setElapsedTime] = useState(0);
  const [dots, setDots] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const matchedRef = useRef(false);

  useEffect(() => {
    if (!criteria) {
      navigate('/dashboard', { replace: true });
      return;
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const startMatching = async () => {
      try {
        const firebaseUser = auth.currentUser;
        if (!firebaseUser) {
          navigate('/auth', { replace: true });
          return;
        }
        const token = await firebaseUser.getIdToken();

        // Open SSE stream first
        fetchEventSource(`${GATEWAY_URL}/matching/events`, {
          headers: { 'Authorization': `Bearer ${token}` },
          signal: ctrl.signal,
          openWhenHidden: true,
          onopen: async (response) => {
            if (!response.ok) {
              throw new Error(`SSE open failed: ${response.status}`);
            }
          },
          onmessage: (event) => {
            if (matchedRef.current) return;

            if (event.event === 'match_found') {
              matchedRef.current = true;
              const data = JSON.parse(event.data);
              navigate(`/session/${data.sessionId}`, { replace: true });
            } else if (event.event === 'timeout') {
              matchedRef.current = true;
              toast.info('No match found. Try again!');
              navigate('/dashboard', { replace: true });
            } else if (event.event === 'connected') {
              console.log('SSE connected');
            }
          },
          onerror: (err) => {
            if (ctrl.signal.aborted) return;
            console.error('SSE error:', err);
            toast.error('Connection lost. Retrying...');
          }
        });

        // Then call find-pair
        const res = await fetch(`${GATEWAY_URL}/matching/find-pair`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            topic_options: criteria.topics,
            difficulty_options: criteria.difficulties
          }),
          signal: ctrl.signal
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || `Matching failed: ${res.status}`);
        }
      } catch (err: any) {
        if (ctrl.signal.aborted) return;
        console.error('Matching error:', err);
        toast.error(err.message || 'Failed to start matching');
        navigate('/dashboard', { replace: true });
      }
    };

    startMatching();

    return () => {
      ctrl.abort();
    };
  }, [criteria, navigate]);

  // Cancel handler
  const handleCancel = async () => {
    try {
      abortRef.current?.abort();
      const firebaseUser = auth.currentUser;
      if (firebaseUser) {
        const token = await firebaseUser.getIdToken();
        await fetch(`${GATEWAY_URL}/matching/cancel-pair`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      }
    } catch {
      // ignore cancel errors
    }
    navigate('/dashboard', { replace: true });
  };

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

  if (!criteria) return null;

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <div className="card-purple text-center relative">
          <button
            onClick={handleCancel}
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

          <button onClick={handleCancel} className="btn-secondary w-full">
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
