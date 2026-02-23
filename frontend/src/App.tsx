import { useState } from 'react';
import { LandingPage } from './components/LandingPage';
import { AuthPage } from './components/AuthPage';
import { Dashboard } from './components/Dashboard';
import { MatchingPage } from './components/MatchingPage';
import { CollaborationPage } from './components/CollaborationPage';
import { ProfilePage } from './components/ProfilePage';

type Page = 'landing' | 'auth' | 'dashboard' | 'matching' | 'collaboration' | 'profile';

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('landing');
  const [user, setUser] = useState<any>(null);
  const [matchingCriteria, setMatchingCriteria] = useState<any>(null);
  const [session, setSession] = useState<any>(null);

  const handleLogin = (userData: any) => {
    setUser(userData);
    setCurrentPage('dashboard');
  };

  const handleLogout = () => {
    setUser(null);
    setSession(null);
    setCurrentPage('landing');
  };

  const handleStartMatching = (criteria: any) => {
    setMatchingCriteria(criteria);
    setCurrentPage('matching');
  };

  const handleMatchFound = (sessionData: any) => {
    setSession(sessionData);
    setCurrentPage('collaboration');
  };

  const handleMatchTimeout = () => {
    setCurrentPage('dashboard');
  };

  const handleEndSession = () => {
    setSession(null);
    setCurrentPage('dashboard');
  };

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
          onTimeout={handleMatchTimeout}
          onCancel={() => setCurrentPage('dashboard')}
        />
      )}
      
      {currentPage === 'collaboration' && (
        <CollaborationPage
          user={user}
          session={session}
          onEndSession={handleEndSession}
        />
      )}
      
      {currentPage === 'profile' && (
        <ProfilePage
          user={user}
          onBack={() => setCurrentPage('dashboard')}
          onLogout={handleLogout}
        />
      )}
    </div>
  );
}
