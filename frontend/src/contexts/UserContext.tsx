import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { toast } from 'sonner';
import { auth } from '../firebase';
import { GATEWAY_URL } from '../constants';
import { avatarUrl } from '../utils/avatar';

export interface UserProfile {
  uid: string;
  user_id: string;
  username: string;
  email: string;
  role: 'User' | 'Admin' | 'Root';
  avatar_id: number;
  avatar: string;
}

interface UserContextType {
  user: UserProfile | null;
  setUser: React.Dispatch<React.SetStateAction<UserProfile | null>>;
  loading: boolean;
  handleLoginSuccess: (uid: string, token: string) => Promise<void>;
  handleLogout: () => Promise<void>;
  updateAvatar: (avatarId: number) => void;
}

const UserContext = createContext<UserContextType>(null!);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const hasRehydrated = useRef(false);

  // Patches the in-memory user state after a successful avatar update,
  // avoiding a full profile re-fetch.
  const updateAvatar = (avatarId: number) => {
    setUser((prev) => prev ? ({
      ...prev,
      avatar_id: avatarId,
      avatar: avatarUrl(avatarId)
    }) : null);
  };

  const handleLogout = useCallback(async () => {
    await signOut(auth);
    localStorage.removeItem('peerprep_token');
    setUser(null);
  }, []);

  // handleLoginSuccess fetches the user profile from the gateway.
  //
  // isRetryAfterRefresh guards against infinite recursion: when TOKEN_STALE is
  // detected we force-refresh the Firebase token and call this function once
  // more. The flag prevents a second refresh attempt if the fresh token still
  // somehow triggers TOKEN_STALE (should not happen in practice).
  const handleLoginSuccess = useCallback(async (uid: string, token: string, isRetryAfterRefresh = false) => {
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
            avatar: avatarUrl(profileData.avatar_id)
          });
          return;
        }

        // --- Gateway-specific error codes ---

        // The account was deleted by an admin. Stop retrying and force logout.
        if (res.status === 401) {
          const data = await res.json().catch(() => ({}));
          if (data.detail === 'ACCOUNT_DELETED') {
            await handleLogout();
            return;
          }
          // Transient 401 (e.g. token not yet propagated after registration) — retry.
          if (attempt < maxRetries - 1) {
            await new Promise(r => setTimeout(r, 3000));
            attempt++;
            continue;
          }
          throw new Error(`Profile fetch failed: ${res.status}`);
        }

        // The user was promoted and their token carries stale claims (role=User).
        // Force-refresh the Firebase token to pick up the new role, then retry once.
        if (res.status === 403) {
          const data = await res.json().catch(() => ({}));
          if (data.detail === 'TOKEN_STALE' && !isRetryAfterRefresh) {
            const firebaseUser = auth.currentUser;
            if (firebaseUser) {
              const freshToken = await firebaseUser.getIdToken(true);
              await handleLoginSuccess(uid, freshToken, true);
            }
            return;
          }
        }

        throw new Error(`Profile fetch failed: ${res.status}`);
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
  }, [handleLogout]);

  // Visibility-based token refresh.
  //
  // Firebase custom claims (e.g. role) only take effect in a new token. When an
  // admin promotes a user, the user's cached token still carries role=User. This
  // listener fires every time the user switches back to this tab and runs the
  // profile fetch with the cached token. If the gateway returns TOKEN_STALE,
  // handleLoginSuccess's existing logic calls getIdToken(true) and retries —
  // the user's role in context updates and the Dashboard re-renders automatically.
  useEffect(() => {
    const onVisibilityChange = async () => {
      if (document.visibilityState !== 'visible') return;
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) return;
      try {
        const token = await firebaseUser.getIdToken(); // cached — avoids an unnecessary server hit
        await handleLoginSuccess(firebaseUser.uid, token);
      } catch {
        // silent — don't interrupt the session on transient errors
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [handleLoginSuccess]);

  // Mid-session auth event handlers.
  //
  // Any component that makes its own API call can trigger these by dispatching
  // a window event — no prop drilling required:
  //
  //   window.dispatchEvent(new Event('auth:token_stale'))
  //     → silently refreshes the Firebase token and re-fetches the profile
  //       (used when the user was promoted and their JWT carries a stale role)
  //
  //   window.dispatchEvent(new Event('auth:account_deleted'))
  //     → forces logout immediately with an explanatory toast
  //       (used when an admin deleted this account while the user was in session)
  useEffect(() => {
    const onTokenStale = async () => {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) return;
      try {
        const freshToken = await firebaseUser.getIdToken(true);
        await handleLoginSuccess(firebaseUser.uid, freshToken, true);
      } catch {
        await handleLogout();
      }
    };

    const onAccountDeleted = async () => {
      toast.error('Your account has been deleted. You have been signed out.');
      await handleLogout();
    };

    window.addEventListener('auth:token_stale', onTokenStale);
    window.addEventListener('auth:account_deleted', onAccountDeleted);
    return () => {
      window.removeEventListener('auth:token_stale', onTokenStale);
      window.removeEventListener('auth:account_deleted', onAccountDeleted);
    };
  }, [handleLoginSuccess, handleLogout]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser && !hasRehydrated.current) {
        hasRehydrated.current = true;
        try {
          // getIdToken(true) forces a server-side refresh. If the account was
          // deleted and Firebase refresh tokens were revoked, this throws —
          // caught below and treated as a forced logout.
          const token = await firebaseUser.getIdToken(true);
          await handleLoginSuccess(firebaseUser.uid, token);
        } catch (err) {
          console.error('Session rehydration failed:', err);
          await handleLogout();
        }
      } else if (!firebaseUser) {
        setUser(null);
        localStorage.removeItem('peerprep_token');
        hasRehydrated.current = false;
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [handleLoginSuccess, handleLogout]);

  return (
    <UserContext.Provider value={{ user, setUser, loading, handleLoginSuccess, handleLogout, updateAvatar }}>
      {children}
    </UserContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useUser() {
  return useContext(UserContext);
}

