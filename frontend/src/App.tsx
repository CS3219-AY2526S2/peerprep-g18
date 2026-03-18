import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './firebase';
import { LandingPage } from './components/LandingPage';
import { AuthPage } from './components/AuthPage';
import { Dashboard } from './components/Dashboard';
import { MatchingPage } from './components/MatchingPage';
import { CollaborationPage } from './components/CollaborationPage';
import { ProfilePage } from './components/ProfilePage';
import { AdminPage } from './components/AdminPage';
import { GATEWAY_URL } from './constants';

type Page = 'landing' | 'auth' | 'dashboard' | 'matching' | 'collaboration' | 'profile' | 'admin';

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('landing');
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [matchingCriteria, setMatchingCriteria] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const currentPageRef = useRef<Page>('landing');

  // Keep ref in sync so the onAuthStateChanged closure always reads the current page
  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  // --- POST-LOGIN HANDLER (called directly by AuthPage after verified sign-in) ---
  // App.tsx
  const handleLoginSuccess = async (uid: string, token: string) => {
    const maxRetries = 5;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        localStorage.setItem('peerprep_token', token);
        const res = await fetch(`${GATEWAY_URL}/users/${uid}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
          const profileData = await res.json();
          const isAdmin = profileData.role?.toLowerCase() === 'admin' || profileData.username === 'Root';
          setUser({
            ...profileData,
            uid,
            avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${profileData.email}`
          });
          setCurrentPage(isAdmin ? 'admin' : 'dashboard');
          return;
        }

        if (res.status === 401 && attempt < maxRetries - 1) {
          console.warn(`Attempt ${attempt + 1} failed (401). Retrying in 3s for clock sync...`);
          await new Promise(r => setTimeout(r, 3000));
          attempt++;
        } else {
          throw new Error(`Profile fetch failed: ${res.status}`);
        }
      } catch (err) {
        if (attempt < maxRetries - 1) {
          attempt++;
          continue;
        }
        console.error('Login failed:', err);
        await signOut(auth);
        setCurrentPage('landing');
        return;
      }
    }
  };

  // --- SESSION REHYDRATION ON REFRESH (observer handles page reload only) ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      // Only rehydrate if there is a user AND we don't already have their profile loaded
      if (firebaseUser && currentPageRef.current !== 'auth' && !user) {
        try {
          const token = await firebaseUser.getIdToken(true);
          await handleLoginSuccess(firebaseUser.uid, token);
        } catch (err) {
          console.error("Session rehydration failed:", err);
        }
      } else if (!firebaseUser) {
        setUser(null);
        localStorage.removeItem('peerprep_token');
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
    localStorage.removeItem('peerprep_token');
    setUser(null);
    setSession(null);
    setCurrentPage('landing');
  };

  // --- PAGE HANDLERS ---
  const handleStartMatching = (criteria: any) => {
    setMatchingCriteria(criteria);
    setCurrentPage('matching');
  };

  const handleMatchFound = (sessionData: any) => {
    setSession(sessionData);
    setCurrentPage('collaboration');
  };

  if (loading) return (
    <div className="min-h-screen bg-[#2D2942] flex items-center justify-center text-white">
      Loading PeerPrep...
    </div>
  );

  return (
    <div className="min-h-screen">
      {currentPage === 'landing' && (
        <LandingPage onGetStarted={() => setCurrentPage('auth')} />
      )}

      {currentPage === 'auth' && (
        <AuthPage onBack={() => setCurrentPage('landing')} onLoginSuccess={handleLoginSuccess} />
      )}

      {currentPage === 'dashboard' && (
        <Dashboard
          user={user}
          onStartMatching={handleStartMatching}
          onProfileClick={() => setCurrentPage('profile')}
          onLogout={handleLogout}
        />
      )}

      {currentPage === 'admin' && (
        <AdminPage
          currentUser={user}
          onLogout={handleLogout}
        />
      )}

      {currentPage === 'matching' && (
        <MatchingPage
          criteria={matchingCriteria}
          onMatchFound={handleMatchFound}
          onTimeout={() => setCurrentPage('dashboard')}
          onCancel={() => setCurrentPage('dashboard')}
        />
      )}

      {currentPage === 'collaboration' && (
        <CollaborationPage
          user={user}
          session={session}
          onEndSession={() => { setSession(null); setCurrentPage('dashboard'); }}
        />
      )}

      {currentPage === 'profile' && (
        <ProfilePage
          user={user}
          onBack={() => setCurrentPage('dashboard')}
          onLogout={handleLogout}
          onUpdate={(updatedUser) => setUser({ ...user, ...updatedUser })}
        />
      )}
    </div>
  );
}