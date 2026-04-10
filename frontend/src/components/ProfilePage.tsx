import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Edit2, Check, Loader2, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { GATEWAY_URL } from '../constants';
import { useUser } from '../contexts/UserContext';
import { auth } from '../firebase';
import { AvatarPickerModal } from './ui/AvatarPickerModal';

export function ProfilePage() {
  const navigate = useNavigate();
  const { user, setUser, handleLogout, updateAvatar } = useUser();
  const [isEditing, setIsEditing] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);

  const isAdmin = user?.role?.toLowerCase() === 'admin' || user?.role?.toLowerCase() === 'root';

  useEffect(() => {
    if (isAdmin) navigate('/admin', { replace: true });
  }, [isAdmin, navigate]);

  const [profileData, setProfileData] = useState({
    username: user.Username || user.username,
    email: user.Email || user.email
  });

  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [errors, setErrors] = useState<any>({});
  const [successMessage, setSuccessMessage] = useState('');

  const handleAvatarConfirm = async (avatarId: number) => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) return;
    const token = await firebaseUser.getIdToken();
    const res = await fetch(`${GATEWAY_URL}/users/${user.uid || user.UserID}/avatar`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ avatar_id: avatarId })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && data.detail === 'ACCOUNT_DELETED') { window.dispatchEvent(new Event('auth:account_deleted')); return; }
      if (res.status === 403 && data.detail === 'TOKEN_STALE') { window.dispatchEvent(new Event('auth:token_stale')); return; }
      toast.error('Failed to save avatar.');
      throw new Error('Avatar update failed');
    }
    updateAvatar(avatarId);
    setShowAvatarPicker(false);
    setSuccessMessage('Avatar updated successfully!');
    setTimeout(() => setSuccessMessage(''), 3000);
  };

  const handleSaveProfile = async () => {
    setIsLoading(true);
    setErrors({});

    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) { navigate('/', { replace: true }); return; }
      const token = await firebaseUser.getIdToken();
      const response = await fetch(`${GATEWAY_URL}/users/${user.UserID || user.uid}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ username: profileData.username })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (response.status === 401 && data.detail === 'ACCOUNT_DELETED') {
          window.dispatchEvent(new Event('auth:account_deleted'));
          return;
        }
        if (response.status === 403 && data.detail === 'TOKEN_STALE') {
          window.dispatchEvent(new Event('auth:token_stale'));
          return;
        }
        throw new Error(data.detail || 'Failed to update profile');
      }

      setUser({ ...user, username: profileData.username });
      setIsEditing(false);
      setSuccessMessage('Profile updated successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err: any) {
      setErrors({ username: err.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleChangePassword = async () => {
    setIsLoading(true);
    setErrors({});

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setErrors({ confirmPassword: 'Passwords do not match' });
      setIsLoading(false);
      return;
    }

    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) { navigate('/', { replace: true }); return; }
      const token = await firebaseUser.getIdToken();
      const response = await fetch(`${GATEWAY_URL}/users/${user.UserID || user.uid}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          password: passwordData.newPassword,
          confirm_password: passwordData.confirmPassword
        })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (response.status === 401 && data.detail === 'ACCOUNT_DELETED') {
          window.dispatchEvent(new Event('auth:account_deleted'));
          return;
        }
        if (response.status === 403 && data.detail === 'TOKEN_STALE') {
          window.dispatchEvent(new Event('auth:token_stale'));
          return;
        }
        throw new Error('Failed to change password');
      }

      setIsChangingPassword(false);
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setSuccessMessage('Password changed successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err: any) {
      setErrors({ currentPassword: err.message });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    setErrors({});
    if (deleteConfirmText !== profileData.username) {
      setErrors({ delete: 'Username does not match. Please try again.' });
      return;
    }

    setIsLoading(true);
    try {
      const firebaseUser = auth.currentUser;
      if (!firebaseUser) { navigate('/', { replace: true }); return; }
      const token = await firebaseUser.getIdToken();
      const response = await fetch(`${GATEWAY_URL}/users/${user.uid || user.UserID}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (response.status === 401 && data.detail === 'ACCOUNT_DELETED') {
          window.dispatchEvent(new Event('auth:account_deleted'));
          return;
        }
        if (response.status === 403 && data.detail === 'TOKEN_STALE') {
          window.dispatchEvent(new Event('auth:token_stale'));
          return;
        }
        throw new Error('Failed to delete account');
      }

      await handleLogout();
      navigate('/', { replace: true });
    } catch (err: any) {
      setErrors({ delete: err.message });
      setIsLoading(false);
    }
  };

  const onLogout = async () => {
    await handleLogout();
    navigate('/', { replace: true });
  };

  return (
    <div className="min-h-screen p-6 bg-[#2D2942]">
      <div className="max-w-2xl mx-auto">
        <button onClick={() => navigate('/dashboard')} className="mb-8 flex items-center gap-2 text-gray-300 hover:text-white">
          <ArrowLeft className="w-5 h-5" />
          <span>Back to Dashboard</span>
        </button>

        <div className="card-purple mb-6 p-8 rounded-3xl bg-[#3A3552]">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-white font-bold text-2xl">Profile Settings</h2>
            {!isEditing && (
              <button onClick={() => setIsEditing(true)} className="bg-[#E8B995] p-3 rounded-full">
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
            <button
              onClick={() => setShowAvatarPicker(true)}
              className="relative group focus:outline-none flex-shrink-0"
              aria-label="Change avatar"
            >
              <img src={user.avatar} alt="Avatar" className="w-24 h-24 rounded-full border-4 border-[#E8B995]" />
              <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <Edit2 className="w-6 h-6 text-white" />
              </div>
            </button>
            <div>
              <h3 className="text-white font-bold text-xl">@{profileData.username}</h3>
              <p className="text-gray-400">{profileData.email}</p>
            </div>
          </div>

          {isEditing ? (
            <div className="space-y-4">
              <input
                type="text"
                value={profileData.username}
                onChange={(e) => setProfileData({ ...profileData, username: e.target.value })}
                className="input-field w-full"
                disabled={isLoading}
              />
              {errors.username && <p className="text-[#E8B995] text-sm">{errors.username}</p>}
              <div className="flex gap-3">
                <button onClick={handleSaveProfile} disabled={isLoading} className="btn-secondary flex-1 flex justify-center items-center gap-2">
                  {isLoading && <Loader2 className="animate-spin w-4 h-4" />} Save
                </button>
                <button onClick={() => setIsEditing(false)} className="btn-primary flex-1">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="bg-[#2D2942] rounded-2xl p-6 space-y-4">
               <div className="flex justify-between"><span className="text-gray-400">Username</span><span className="text-white font-mono">@{profileData.username}</span></div>
               <div className="flex justify-between"><span className="text-gray-400">Email</span><span className="text-white">{profileData.email}</span></div>
            </div>
          )}
        </div>

        {/* Password Section */}
        <div className="card-peach mb-6 p-8 rounded-3xl bg-[#E8B995]">
          <h3 className="text-[#4A4563] font-bold text-xl mb-4">Security</h3>
          {!isChangingPassword ? (
            <button onClick={() => setIsChangingPassword(true)} className="w-full py-3 rounded-full border-2 border-[#4A4563] text-[#4A4563] font-bold">Change Password</button>
          ) : (
            <div className="space-y-4">
              <div className="relative">
                <input
                  type={showPasswords ? 'text' : 'password'}
                  placeholder="New Password"
                  value={passwordData.newPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                  className="w-full bg-white border-2 border-[#4A4563] rounded-full px-5 py-3 text-[#4A4563] pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPasswords(!showPasswords)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-[#4A4563] hover:text-[#E8B995] transition-colors"
                >
                  {showPasswords ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              <div className="relative">
                <input
                  type={showPasswords ? 'text' : 'password'}
                  placeholder="Confirm New Password"
                  value={passwordData.confirmPassword}
                  onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                  className="w-full bg-white border-2 border-[#4A4563] rounded-full px-5 py-3 text-[#4A4563] pr-12"
                />
              </div>
              {errors.confirmPassword && (
                <p className="text-red-600 text-sm mt-1 ml-4">{errors.confirmPassword}</p>
              )}
              <div className="flex gap-3">
                <button onClick={handleChangePassword} disabled={isLoading} className="bg-[#4A4563] text-white flex-1 py-3 rounded-full font-bold">Update</button>
                <button onClick={() => setIsChangingPassword(false)} className="bg-white text-[#4A4563] flex-1 py-3 rounded-full font-bold border-2 border-[#4A4563]">Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* --- DANGER ZONE --- */}
        <div className="bg-[#3A3552] border-2 border-red-500/30 rounded-[32px] p-8 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="w-6 h-6 text-red-500" />
            <h3 className="text-white font-bold text-xl">Danger Zone</h3>
          </div>

          {!isDeleting ? (
            <div>
              <p className="text-gray-400 mb-6">Once you delete your account, there is no going back. Please be certain.</p>
              <button onClick={() => setIsDeleting(true)} className="w-full bg-red-500/10 text-red-500 py-3 rounded-full font-bold border-2 border-red-500 hover:bg-red-500 hover:text-white transition-colors">
                Delete Account
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-gray-300">
                To confirm deletion, type your username <span className="font-bold text-white">({profileData.username})</span> below:
              </p>
              <input
                type="text"
                placeholder={profileData.username}
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                className="input-field w-full bg-[#2D2942]"
                disabled={isLoading}
              />
              {errors.delete && <p className="text-red-500 text-sm">{errors.delete}</p>}
              <div className="flex gap-3 mt-4">
                <button
                  onClick={handleDeleteAccount}
                  disabled={isLoading || deleteConfirmText !== profileData.username}
                  className="bg-red-500 text-white flex-1 py-3 rounded-full font-bold disabled:opacity-50 flex justify-center items-center gap-2"
                >
                  {isLoading && <Loader2 className="animate-spin w-4 h-4" />} Delete Forever
                </button>
                <button onClick={() => { setIsDeleting(false); setDeleteConfirmText(''); setErrors({}); }} className="bg-white text-[#4A4563] flex-1 py-3 rounded-full font-bold">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <button onClick={onLogout} className="w-full bg-red-500 text-white py-4 rounded-3xl font-bold hover:bg-red-600 transition-colors">Logout of PeerPrep</button>
      </div>

      {showAvatarPicker && (
        <AvatarPickerModal
          open={showAvatarPicker}
          forced={false}
          currentAvatarId={user.avatar_id ?? 1}
          onConfirm={handleAvatarConfirm}
          onCancel={() => setShowAvatarPicker(false)}
        />
      )}
    </div>
  );
}
