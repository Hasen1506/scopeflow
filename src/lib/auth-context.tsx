'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { firebaseAuth, googleAuthProvider } from './firebase';
import { rememberSession } from '@/lib/theme';

export interface AuthUserView {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
}

interface AuthContextValue {
  user: AuthUserView | null;
  loading: boolean;
  getFreshToken: () => Promise<string | null>;
  signInWithGoogle: () => Promise<AuthUserView>;
  signInWithEmail: (email: string, password: string) => Promise<AuthUserView>;
  signUpWithEmail: (name: string, email: string, password: string) => Promise<AuthUserView>;
  requestPasswordReset: (email: string) => Promise<void>;
  signOutUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function toView(u: User | null): AuthUserView | null {
  if (!u) return null;
  const email = u.email || '';
  return {
    uid: u.uid,
    email,
    displayName: u.displayName || email.split('@')[0] || 'Account',
    photoURL: u.photoURL || null,
  };
}

export function formatFirebaseAuthError(err: unknown): string {
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code?: unknown }).code) : '';
  switch (code) {
    case 'auth/popup-closed-by-user':
      return 'Google sign-in window was closed before finishing. Click Continue with Google to try again.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in popup. Please allow popups for this site and click Continue with Google again.';
    case 'auth/operation-not-allowed':
      return 'Email & password sign-in is not enabled in your Firebase project yet. Use Continue with Google now, or enable Email/Password in Firebase Console → Authentication → Sign-in method.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password. Please check your details or use Continue with Google.';
    case 'auth/email-already-in-use':
      return 'An account already exists with this email. Sign in instead or use Continue with Google.';
    case 'auth/weak-password':
      return 'Choose a stronger password with at least 8 characters.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a minute and try again.';
    case 'auth/network-request-failed':
      return 'Network error while contacting sign-in. Check your connection and try again.';
    default:
      return err instanceof Error && err.message ? err.message : 'Sign-in failed. Please try again.';
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(firebaseAuth, (next) => {
      setFirebaseUser(next);
      rememberSession(Boolean(next));
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const getFreshToken = useCallback(async () => {
    const current = firebaseAuth.currentUser;
    if (!current) return null;
    try {
      return await current.getIdToken();
    } catch {
      return null;
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const cred = await signInWithPopup(firebaseAuth, googleAuthProvider);
    const view = toView(cred.user);
    if (!view) throw new Error('Could not complete Google sign-in.');
    return view;
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const cred = await signInWithEmailAndPassword(firebaseAuth, email, password);
    const view = toView(cred.user);
    if (!view) throw new Error('Could not complete email sign-in.');
    return view;
  }, []);

  const signUpWithEmail = useCallback(async (name: string, email: string, password: string) => {
    const cred = await createUserWithEmailAndPassword(firebaseAuth, email, password);
    if (name.trim()) {
      await updateProfile(cred.user, { displayName: name.trim() }).catch(() => {});
    }
    const view = toView(cred.user);
    if (!view) throw new Error('Could not create your account.');
    return { ...view, displayName: name.trim() || view.displayName };
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    await sendPasswordResetEmail(firebaseAuth, email);
  }, []);

  const signOutUser = useCallback(async () => {
    await signOut(firebaseAuth);
  }, []);

  const user = useMemo(() => toView(firebaseUser), [firebaseUser]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      getFreshToken,
      signInWithGoogle,
      signInWithEmail,
      signUpWithEmail,
      requestPasswordReset,
      signOutUser,
    }),
    [user, loading, getFreshToken, signInWithGoogle, signInWithEmail, signUpWithEmail, requestPasswordReset, signOutUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    return {
      user: null,
      loading: false,
      getFreshToken: async () => null,
      signInWithGoogle: async () => {
        throw new Error('Auth provider unavailable');
      },
      signInWithEmail: async () => {
        throw new Error('Auth provider unavailable');
      },
      signUpWithEmail: async () => {
        throw new Error('Auth provider unavailable');
      },
      requestPasswordReset: async () => {
        throw new Error('Auth provider unavailable');
      },
      signOutUser: async () => {},
    };
  }
  return ctx;
}
