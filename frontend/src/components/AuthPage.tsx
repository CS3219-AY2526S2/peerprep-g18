import { useState } from 'react';
import { ArrowLeft, Mail, Lock, User, Eye, EyeOff, CheckCircle } from 'lucide-react';

interface AuthPageProps {
  onLogin: (user: any) => void;
  onBack: () => void;
}

export function AuthPage({ onLogin, onBack }: AuthPageProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [otp, setOtp] = useState('');
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: any = {};

    // Validate email or username for login
    if (isLogin) {
      if (!formData.email.trim()) {
        newErrors.email = 'Email or username is required';
      }
    } else {
      // Registration validations
      if (!validateUsername(formData.username)) {
        newErrors.username = 'Username: 1-25 chars, alphanumeric, underscore, or dash only';
      }

      if (!validateEmail(formData.email)) {
        newErrors.email = 'Please enter a valid email address';
      }

      if (formData.password !== formData.confirmPassword) {
        newErrors.confirmPassword = 'Passwords do not match';
      }
    }

    if (!validatePassword(formData.password)) {
      newErrors.password = 'Password: 8-25 chars, must contain letters and at least 1 number';
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      if (isLogin) {
        // Simulate successful login
        onLogin({
          username: formData.username || formData.email.split('@')[0],
          email: formData.email.includes('@') ? formData.email : `${formData.email}@example.com`,
          avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${formData.email}`
        });
      } else {
        // For registration, show OTP verification
        setShowOtpInput(true);
      }
    }
  };

  const handleVerifyOtp = () => {
    // Simulate OTP verification (in real app, verify with backend)
    if (otp === '123456' || otp.length === 6) {
      setEmailVerified(true);
      setTimeout(() => {
        onLogin({
          username: formData.username,
          email: formData.email,
          avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${formData.email}`
        });
      }, 1000);
    } else {
      setErrors({ otp: 'Invalid OTP. Try 123456 for demo' });
    }
  };

  if (showOtpInput) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full">
          <button
            onClick={() => setShowOtpInput(false)}
            className="mb-8 flex items-center gap-2 text-[#4A4563] hover:text-[#5A5573]"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Back</span>
          </button>

          <div className="card-purple">
            <div className="text-center mb-8">
              <div className="bg-[#E8B995] w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
                <Mail className="w-10 h-10 text-[#4A4563]" />
              </div>
              <h2 className="text-white text-3xl font-bold mb-2">Verify Your Email</h2>
              <p className="text-gray-300">
                We've sent a verification code to<br />
                <span className="text-[#E8B995]">{formData.email}</span>
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <input
                  type="text"
                  placeholder="Enter 6-digit OTP"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="input-field w-full text-center text-2xl tracking-widest"
                  maxLength={6}
                />
                {errors.otp && (
                  <p className="text-[#E8B995] text-sm mt-1 text-center">{errors.otp}</p>
                )}
                <p className="text-gray-400 text-xs mt-2 text-center">Demo: Use 123456</p>
              </div>

              <button onClick={handleVerifyOtp} className="btn-secondary w-full mt-6">
                Verify Email
              </button>
            </div>

            {emailVerified && (
              <div className="mt-4 bg-green-500 text-white px-4 py-3 rounded-2xl flex items-center gap-2 justify-center">
                <CheckCircle className="w-5 h-5" />
                <span>Email verified! Redirecting...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

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
                  />
                </div>
                {errors.username && (
                  <p className="text-[#E8B995] text-sm mt-1 ml-4">{errors.username}</p>
                )}
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
                />
              </div>
              {errors.email && (
                <p className="text-[#E8B995] text-sm mt-1 ml-4">{errors.email}</p>
              )}
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
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-300"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {errors.password && (
                <p className="text-[#E8B995] text-sm mt-1 ml-4">{errors.password}</p>
              )}
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
                  />
                </div>
                {errors.confirmPassword && (
                  <p className="text-[#E8B995] text-sm mt-1 ml-4">{errors.confirmPassword}</p>
                )}
              </div>
            )}

            <button type="submit" className="btn-secondary w-full mt-6">
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
            >
              {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Login'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}