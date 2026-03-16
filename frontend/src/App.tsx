import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './firebase';
import { LandingPage } from './components/LandingPage';
import { AuthPage } from './components/AuthPage';
import { Dashboard } from './components/Dashboard';
import { MatchingPage } from './components/MatchingPage';
import { CollaborationPage } from './components/CollaborationPage';
import { ProfilePage } from './components/ProfilePage';

type Page = 'landing' | 'auth' | 'dashboard' | 'matching' | 'collaboration' | 'profile';
const GATEWAY_URL = 'http://localhost/api';

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('landing');
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [matchingCriteria, setMatchingCriteria] = useState<any>(null);
  const [session, setSession] = useState<any>(null);

  // --- SESSION REHYDRATION ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const token = await firebaseUser.getIdToken();
          localStorage.setItem('peerprep_token', token);

          const res = await fetch(`${GATEWAY_URL}/users/${firebaseUser.uid}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          
          if (res.ok) {
            const profileData = await res.json();
            setUser({
              ...profileData,
              uid: firebaseUser.uid,
              avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${profileData.email}`
            });
            setCurrentPage('dashboard');
          }
        } catch (err) {
          console.error("Session restore failed:", err);
        }
      } else {
        setUser(null);
        localStorage.removeItem('peerprep_token');
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = (userData: any) => {
    setUser(userData);
    setCurrentPage('dashboard');
  };

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
        <AuthPage onLogin={handleLogin} onBack={() => setCurrentPage('landing')} />
      )}
      
      {currentPage === 'dashboard' && (
        <Dashboard 
          user={user}
          onStartMatching={handleStartMatching}
          onProfileClick={() => setCurrentPage('profile')}
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