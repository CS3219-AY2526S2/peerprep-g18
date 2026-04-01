import { useState, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { UserProvider, useUser } from './contexts/UserContext';
import { LandingPage } from './components/LandingPage';
import { AuthPage } from './components/AuthPage';
import { Dashboard } from './components/Dashboard';
import { MatchingPage } from './components/MatchingPage';
import { CollaborationPage } from './components/CollaborationPage';
import { ProfilePage } from './components/ProfilePage';
import { AdminPage } from './components/AdminPage';
import { Toaster } from 'sonner';
import { GATEWAY_URL } from './constants';
import { auth } from './firebase';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useUser();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#2D2942] flex items-center justify-center text-white">
        Loading PeerPrep...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return <>{children}</>;
}

function ActiveSessionRedirect({ children }: { children: React.ReactNode }) {
  const { user, loading } = useUser();
  const navigate = useNavigate();
  const location = useLocation();
  const [checked, setChecked] = useState(false);
  const checkedForUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (location.pathname.startsWith('/session/')) {
      setChecked(true);
      return;
    }

    if (!user) {
      // Only allow children to render if auth is fully resolved (not loading)
      // and user is genuinely not logged in
      if (!loading) {
        setChecked(true);
      }
      return;
    }

    // When user becomes available (login or rehydration), block rendering
    // and check for active sessions before allowing navigation
    if (checkedForUserRef.current !== user.uid) {
      checkedForUserRef.current = user.uid;
      setChecked(false);
    }

    if (checked) return;

    let cancelled = false;

    const checkActiveSession = async () => {
      try {
        const firebaseUser = auth.currentUser;
        if (!firebaseUser) {
          if (!cancelled) setChecked(true);
          return;
        }
        const token = await firebaseUser.getIdToken();
        const res = await fetch(`${GATEWAY_URL}/collab/active-session`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (res.status === 401 && data.detail === 'ACCOUNT_DELETED') {
            window.dispatchEvent(new Event('auth:account_deleted'));
            return; // UserContext handles logout — don't setChecked
          }
          if (res.status === 403 && data.detail === 'TOKEN_STALE') {
            window.dispatchEvent(new Event('auth:token_stale'));
            // Fall through to setChecked — UserContext will refresh the token
          }
        } else {
          const data = await res.json();
          if (data.sessionId) {
            navigate(`/session/${data.sessionId}`, { replace: true });
            return;
          }
        }
      } catch {
        // Silently fail — don't block navigation
      }
      if (!cancelled) setChecked(true);
    };

    checkActiveSession();
    return () => { cancelled = true; };
  }, [user, loading, location.pathname, navigate, checked]);

  if (!checked) {
    return (
      <div className="min-h-screen bg-[#2D2942] flex items-center justify-center text-white">
        Loading PeerPrep...
      </div>
    );
  }

  return <>{children}</>;
}

function AppRoutes() {
  const { user, loading } = useUser();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#2D2942] flex items-center justify-center text-white">
        Loading PeerPrep...
      </div>
    );
  }

  return (
    <ActiveSessionRedirect>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/auth" element={user ? <Navigate to="/dashboard" replace /> : <AuthPage />} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
        <Route path="/matching" element={<ProtectedRoute><MatchingPage /></ProtectedRoute>} />
        <Route path="/session/:sessionId" element={<ProtectedRoute><CollaborationPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ActiveSessionRedirect>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <UserProvider>
        <div className="min-h-screen">
          <AppRoutes />
        </div>
        <Toaster position="bottom-right" richColors />
      </UserProvider>
    </BrowserRouter>
  );
}
