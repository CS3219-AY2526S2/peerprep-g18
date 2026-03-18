import { useState } from 'react';
import { ArrowLeft, Mail, Lock, User, Eye, EyeOff, CheckCircle, Loader2 } from 'lucide-react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';
import { GATEWAY_URL } from '../constants';

interface AuthPageProps {
  onBack: () => void;
  onLoginSuccess: (uid: string, token: string) => void;
}

export function AuthPage({ onBack, onLoginSuccess }: AuthPageProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);

  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: ''
  });
  const [errors, setErrors] = useState<any>({});

  const validateEmail = (email: string) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  };

  const validateUsername = (username: string) => {
    const re = /^[a-zA-Z0-9_-]{1,25}$/;
    return re.test(username);
  };

  const validatePassword = (password: string) => {
    const hasAlpha = /[a-zA-Z]/.test(password);
    const hasNumber = /\d/.test(password);
    return password.length >= 8 && password.length <= 25 && hasAlpha && hasNumber;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: any = {};

    if (!isLogin) {
      if (!validateUsername(formData.username)) {
        newErrors.username = 'Username must be 1-25 characters (letters, numbers, _, -)';
      }
      if (!validatePassword(formData.password)) {
        newErrors.password = 'Password must be 8-25 characters and contain both letters and numbers';
      }
      if (formData.password !== formData.confirmPassword) {
        newErrors.confirmPassword = 'Passwords do not match';
      }
    }

    if (!isLogin && !validateEmail(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    } else if (isLogin && !formData.email) {
      newErrors.email = 'Email or Username is required';
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      setIsLoading(true);
      try {
        if (isLogin) {
          // --- 1. LOGIN FLOW ---
          let loginEmail = formData.email;

          if (!loginEmail.includes('@')) {
            const lookupRes = await fetch(`${GATEWAY_URL}/users/lookup/${loginEmail}`);
            if (!lookupRes.ok) throw new Error('Username not found');
            const data = await lookupRes.json();

            loginEmail = data.email;
          }

          const userCredential = await signInWithEmailAndPassword(auth, loginEmail, formData.password);
          const firebaseUser = userCredential.user;

          // EMAIL VERIFICATION CHECK
          if (!firebaseUser.emailVerified) {
            await auth.signOut();
            throw new Error('Please verify your email before logging in. Check your inbox!');
          }

          // Force a fresh token so custom claims (role) are included and gateway verification succeeds
          const token = await firebaseUser.getIdToken(true);
          onLoginSuccess(firebaseUser.uid, token);

        } else {
          // --- 2. REGISTRATION FLOW ---
          const response = await fetch(`${GATEWAY_URL}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: formData.username,
              email: formData.email,
              password: formData.password,
              confirm_password: formData.confirmPassword,
              avatar_id: 1,
              role: "User"
            })
          });

          if (!response.ok) {
            const errorData = await response.json();
            const detail = errorData.detail;
            throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
          }

          setRegistrationSuccess(true);
        }
      } catch (err: any) {
        setErrors({ email: err.message });
      } finally {
        setIsLoading(false);
      }
    }
  };

  // --- SUCCESS SCREEN FOR REGISTRATION ---
  if (registrationSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full">
          <button
            onClick={() => {
              setRegistrationSuccess(false);
              setIsLogin(true);
            }}
            className="mb-8 flex items-center gap-2 text-[#4A4563] hover:text-[#5A5573]"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Back to Login</span>
          </button>

          <div className="card-purple text-center p-8">
            <div className="bg-[#E8B995] w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-10 h-10 text-[#4A4563]" />
            </div>
            <h2 className="text-white text-3xl font-bold mb-4">Account Created!</h2>
            <p className="text-gray-300 mb-6">
              We've sent a verification link to<br />
              <span className="text-[#E8B995] font-semibold">{formData.email}</span>
            </p>
            <p className="text-sm text-gray-400">
              Please check your inbox and click the link to verify your account before logging in.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // --- MAIN FORM SCREEN ---
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <button
          onClick={onBack}
          className="mb-8 flex items-center gap-2 text-[#4A4563] hover:text-[#5A5573]"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Back</span>
        </button>

        <div className="card-purple">
          <div className="text-center mb-8">
            <h2 className="text-white text-3xl font-bold mb-2">
              {isLogin ? 'Welcome Back' : 'Create Account'}
            </h2>
            <p className="text-gray-300">
              {isLogin ? 'Login to continue your journey' : 'Join PeerPrep today'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Username"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    className="input-field w-full pl-12"
                    disabled={isLoading}
                  />
                </div>
                {errors.username && <p className="text-[#E8B995] text-sm mt-1 ml-4">{errors.username}</p>}
              </div>
            )}

            <div>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder={isLogin ? 'Email or Username' : 'Email'}
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="input-field w-full pl-12"
                  disabled={isLoading}
                />
              </div>
              {errors.email && <p className="text-[#E8B995] text-sm mt-1 ml-4">{errors.email}</p>}
            </div>

            <div>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="input-field w-full pl-12 pr-12"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-300"
                  disabled={isLoading}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {errors.password && <p className="text-[#E8B995] text-sm mt-1 ml-4">{errors.password}</p>}
            </div>

            {!isLogin && (
              <div>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Confirm Password"
                    value={formData.confirmPassword}
                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                    className="input-field w-full pl-12"
                    disabled={isLoading}
                  />
                </div>
                {errors.confirmPassword && <p className="text-[#E8B995] text-sm mt-1 ml-4">{errors.confirmPassword}</p>}
              </div>
            )}

            <button
              type="submit"
              className="btn-secondary w-full mt-6 flex justify-center items-center gap-2"
              disabled={isLoading}
            >
              {isLoading && <Loader2 className="w-5 h-5 animate-spin" />}
              {isLogin ? 'Login' : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => {
                setIsLogin(!isLogin);
                setErrors({});
                setFormData({ username: '', email: '', password: '', confirmPassword: '' });
              }}
              className="text-[#E8B995] hover:text-[#F0C5A5]"
              disabled={isLoading}
            >
              {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Login'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}