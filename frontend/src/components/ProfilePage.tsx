import { useState } from 'react';
import { ArrowLeft, Edit2, Check, X, Eye, EyeOff } from 'lucide-react';

interface ProfilePageProps {
  user: any;
  onBack: () => void;
  onLogout: () => void;
}

export function ProfilePage({ user, onBack, onLogout }: ProfilePageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  const [profileData, setProfileData] = useState({
    username: user.username,
    email: user.email
  });
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [errors, setErrors] = useState<any>({});
  const [successMessage, setSuccessMessage] = useState('');

  const validateUsername = (username: string) => {
    const re = /^[a-zA-Z0-9_-]{1,25}$/;
    return re.test(username);
  };

  const validatePassword = (password: string) => {
    const hasAlpha = /[a-zA-Z]/.test(password);
    const hasNumber = /\d/.test(password);
    return password.length >= 8 && password.length <= 25 && hasAlpha && hasNumber;
  };

  const handleSaveProfile = () => {
    const newErrors: any = {};

    if (!validateUsername(profileData.username)) {
      newErrors.username = 'Username: 1-25 chars, alphanumeric, underscore, or dash only';
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      setIsEditing(false);
      setSuccessMessage('Profile updated successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);
    }
  };

  const handleChangePassword = () => {
    const newErrors: any = {};

    if (!passwordData.currentPassword) {
      newErrors.currentPassword = 'Current password is required';
    }

    if (!validatePassword(passwordData.newPassword)) {
      newErrors.newPassword = 'Password: 8-25 chars, must contain letters and at least 1 number';
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    setErrors(newErrors);

    if (Object.keys(newErrors).length === 0) {
      setIsChangingPassword(false);
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setSuccessMessage('Password changed successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);
    }
  };

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-2xl mx-auto">
        <button
          onClick={onBack}
          className="mb-8 flex items-center gap-2 text-[#4A4563] hover:text-[#5A5573]"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Back to Dashboard</span>
        </button>

        <div className="card-purple mb-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-white font-bold text-2xl">Profile</h2>
            {!isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="bg-[#E8B995] p-3 rounded-full hover:bg-[#F0C5A5] transition-all"
              >
                <Edit2 className="w-5 h-5 text-[#4A4563]" />
              </button>
            )}
          </div>

          {successMessage && (
            <div className="bg-green-500 text-white px-4 py-3 rounded-2xl mb-4 flex items-center gap-2">
              <Check className="w-5 h-5" />
              <span>{successMessage}</span>
            </div>
          )}

          <div className="flex items-center gap-6 mb-8">
            <img
              src={user.avatar}
              alt={user.username}
              className="w-24 h-24 rounded-full border-4 border-[#E8B995]"
            />
            <div>
              <h3 className="text-white font-bold text-xl">@{profileData.username}</h3>
              <p className="text-gray-300">{profileData.email}</p>
            </div>
          </div>

          {isEditing ? (
            <div className="space-y-4">
              <div>
                <label className="text-gray-300 text-sm mb-2 block">Username</label>
                <input
                  type="text"
                  value={profileData.username}
                  onChange={(e) => setProfileData({ ...profileData, username: e.target.value })}
                  className="input-field w-full"
                  placeholder="Enter username"
                />
                {errors.username && (
                  <p className="text-[#E8B995] text-sm mt-1">{errors.username}</p>
                )}
                <p className="text-gray-400 text-xs mt-1">1-25 characters, alphanumeric, underscore, or dash</p>
              </div>

              <div>
                <label className="text-gray-300 text-sm mb-2 block">Email</label>
                <input
                  type="email"
                  value={profileData.email}
                  disabled
                  className="input-field w-full opacity-50 cursor-not-allowed"
                />
                <p className="text-gray-400 text-xs mt-1">Email cannot be changed (used as unique identifier)</p>
              </div>

              <div className="flex gap-3 pt-4">
                <button onClick={handleSaveProfile} className="btn-secondary flex-1">
                  Save Changes
                </button>
                <button
                  onClick={() => {
                    setIsEditing(false);
                    setProfileData({ username: user.username, email: user.email });
                    setErrors({});
                  }}
                  className="btn-primary flex-1"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-[#3A3552] rounded-2xl p-6">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">Username</span>
                  <span className="text-white font-semibold">@{profileData.username}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-300">Email</span>
                  <span className="text-white font-semibold">{profileData.email}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Change Password Section */}
        <div className="card-peach mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[#4A4563] font-bold text-xl">Security</h3>
          </div>

          {!isChangingPassword ? (
            <button
              onClick={() => setIsChangingPassword(true)}
              className="btn-primary w-full"
            >
              Change Password
            </button>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-[#4A4563] text-sm mb-2 block">Current Password</label>
                <div className="relative">
                  <input
                    type={showPasswords ? 'text' : 'password'}
                    value={passwordData.currentPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                    className="w-full bg-white border-2 border-[#4A4563] rounded-full px-5 py-3 pr-12 text-[#4A4563] focus:outline-none focus:ring-2 focus:ring-[#4A4563]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPasswords(!showPasswords)}
                    className="absolute right-4 top-1/2 transform -translate-y-1/2 text-[#4A4563]"
                  >
                    {showPasswords ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                {errors.currentPassword && (
                  <p className="text-red-600 text-sm mt-1">{errors.currentPassword}</p>
                )}
              </div>

              <div>
                <label className="text-[#4A4563] text-sm mb-2 block">New Password</label>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  value={passwordData.newPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                  className="w-full bg-white border-2 border-[#4A4563] rounded-full px-5 py-3 text-[#4A4563] focus:outline-none focus:ring-2 focus:ring-[#4A4563]"
                />
                {errors.newPassword && (
                  <p className="text-red-600 text-sm mt-1">{errors.newPassword}</p>
                )}
                <p className="text-gray-600 text-xs mt-1">8-25 characters, must contain letters and at least 1 number</p>
              </div>

              <div>
                <label className="text-[#4A4563] text-sm mb-2 block">Confirm New Password</label>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  value={passwordData.confirmPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                  className="w-full bg-white border-2 border-[#4A4563] rounded-full px-5 py-3 text-[#4A4563] focus:outline-none focus:ring-2 focus:ring-[#4A4563]"
                />
                {errors.confirmPassword && (
                  <p className="text-red-600 text-sm mt-1">{errors.confirmPassword}</p>
                )}
              </div>

              <div className="flex gap-3 pt-4">
                <button onClick={handleChangePassword} className="btn-primary flex-1">
                  Update Password
                </button>
                <button
                  onClick={() => {
                    setIsChangingPassword(false);
                    setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
                    setErrors({});
                  }}
                  className="bg-gray-500 text-white px-6 py-3 rounded-full font-semibold hover:bg-gray-600 transition-all flex-1"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Logout Section */}
        <div className="card-purple text-center">
          <p className="text-gray-300 mb-4">Ready to leave?</p>
          <button
            onClick={onLogout}
            className="bg-red-500 hover:bg-red-600 text-white px-8 py-3 rounded-full font-semibold transition-all"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  );
}