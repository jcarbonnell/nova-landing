// src/components/CreateAccountModal.tsx
'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from './ui/button';
import { AlertCircle } from 'lucide-react';
import styles from '@/styles/modal.module.css';  // Assumes copied from 1000fans

interface CreateAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAccountCreated: (accountId: string) => void;
  userData?: { email: string; publicKey?: string } | null;
  onPaymentOpen: (fullId: string) => void;  // Triggers payment modal
}

export default function CreateAccountModal({
  isOpen,
  onClose,
  onAccountCreated,
  userData,
  onPaymentOpen,
}: CreateAccountModalProps) {
  const [username, setUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [checkLoading, setCheckLoading] = useState(false);
  const [error, setError] = useState('');
  const [isAccountCreated, setIsAccountCreated] = useState(false);
  const [existingAccount, setExistingAccount] = useState<string | null>(null);
  const router = useRouter();

  // Wrap checkExistingAccount in useCallback to stabilize deps
  const checkExistingAccount = useCallback(async () => {
    if (!userData?.email) {
      setError('Cannot check account: Missing user data.');
      return;
    }

    setCheckLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/check-for-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userData.email }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to check account');
      }

      const { exists, accountId } = await response.json();
      if (exists) {
        setExistingAccount(accountId);
        setIsAccountCreated(true);
        onAccountCreated(accountId);  // Update parent
      }
    } catch (err: unknown) {
      console.error('Error checking existing account:', err);
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to check account: ${errMsg}`);
    } finally {
      setCheckLoading(false);
    }
  }, [userData?.email, onAccountCreated]);  // Deps: email stable, callback prop

  useEffect(() => {
    if (isOpen && userData) {
      setIsAccountCreated(false);
      setError('');
      setUsername('');
      setExistingAccount(null);
      checkExistingAccount();
    }
  }, [isOpen, userData, checkExistingAccount]);  // Now includes stable callback

  const handleClose = () => {
    if (!isAccountCreated && !username) {
      router.push('/api/auth/logout');  // Logout if no progress
    }
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    const accountId = username.includes('.') ? username : `${username}.nova-sdk.near`;
    if (!/^[a-z0-9_-]{2,64}\.nova-sdk\.near$/.test(accountId)) {
      setError('Invalid format: Use lowercase letters, numbers, _, - (e.g., myname.nova-sdk.near)');
      setIsLoading(false);
      return;
    }

    try {
      // Check uniqueness
      const checkRes = await fetch('/api/auth/check-for-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: accountId, email: userData?.email }),
      });

      if (!checkRes.ok) {
        const errorData = await checkRes.json().catch(() => ({}));
        throw new Error(errorData.error || 'Check failed');
      }

      const { exists } = await checkRes.json();
      if (exists) {
        setError(`Account ${accountId} already exists. Choose another username.`);
        setIsLoading(false);
        return;
      }

      // Proceed to payment (optional)
      onPaymentOpen(accountId);  // Parent opens payment modal
    } catch (err: unknown) {
      console.error('Error checking account:', err);
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to check: ${errMsg}`);
      setIsLoading(false);
    }
  };

  if (!isOpen || !userData) return null;

  return (
    <>
      <div className={styles.modalOverlay}>
        <div className={styles.modalDialog}>
          <div className={`${styles.modalContent} ${styles.accountModal}`}>
            <div className={styles.modalHeader}>
              <h5 className={styles.modalTitle}>
                {existingAccount ? 'Welcome Back!' : 'Create Your NOVA Account'}
              </h5>
              <button type="button" className={styles.closeButton} onClick={handleClose}>x</button>
            </div>
            <div className={styles.modalBody}>
              {checkLoading ? (
                <div className="text-center py-4">Checking account...</div>
              ) : existingAccount ? (
                <div className="text-center py-4">
                  <p>Account <strong>{existingAccount}</strong> already exists!</p>
                  <p>You&apos;re ready to use NOVA.</p>
                </div>
              ) : !isAccountCreated ? (
                <form onSubmit={handleSubmit} className={styles.fullWidthForm}>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Choose your username</label>
                    <input
                      type="text"
                      className={styles.formControl}
                      value={username}
                      onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                      placeholder="e.g., myname"
                      required
                      minLength={2}
                      maxLength={64}
                    />
                    <div className={styles.formText}>
                      Full account: <strong>{username ? `${username}.nova-sdk.near` : '&lt;username&gt;.nova-sdk.near'}</strong>
                    </div>
                  </div>
                  {error && (
                    <div className={styles.alertDanger}>
                      <AlertCircle size={16} className="inline mr-1" />
                      {error}
                    </div>
                  )}
                  <Button type="submit" disabled={isLoading || !username} className={styles.buttonPrimary}>
                    {isLoading ? 'Creating...' : 'Create Account'}
                  </Button>
                </form>
              ) : (
                <div className="text-center py-4">
                  <p>Account created successfully!</p>
                  <p>Share your data securely with NOVA.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}