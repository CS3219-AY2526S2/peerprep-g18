import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { GATEWAY_URL } from '../constants';

interface UserContextType {
  user: any;
  setUser: (user: any) => void;
  loading: boolean;
  handleLoginSuccess: (uid: string, token: string) => Promise<void>;
  handleLogout: () => Promise<void>;
}

const UserContext = createContext<UserContextType>(null!);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const hasRehydrated = useRef(false);

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
          setUser({
            ...profileData,
            uid,
            avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${profileData.email}`
          });
          return;
        }

        if (res.status === 401 && attempt < maxRetries - 1) {
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
        setUser(null);
        return;
      }
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    localStorage.removeItem('peerprep_token');
    setUser(null);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser && !hasRehydrated.current) {
        hasRehydrated.current = true;
        try {
          const token = await firebaseUser.getIdToken(true);
          await handleLoginSuccess(firebaseUser.uid, token);
        } catch (err) {
          console.error("Session rehydration failed:", err);
        }
      } else if (!firebaseUser) {
        setUser(null);
        localStorage.removeItem('peerprep_token');
        hasRehydrated.current = false;
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  return (
    <UserContext.Provider value={{ user, setUser, loading, handleLoginSuccess, handleLogout }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
