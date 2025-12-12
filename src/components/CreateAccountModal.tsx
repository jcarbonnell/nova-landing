// src/components/CreateAccountModal.tsx
'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from './ui/button';
import { AlertCircle } from 'lucide-react';
import styles from '@/styles/modal.module.css';

interface CreateAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAccountCreated: (accountId: string) => void;
  userData?: { email: string; publicKey?: string; wallet_id?: string } | null;
}

export default function CreateAccountModal({
  isOpen,
  onClose,
  onAccountCreated,
  userData,
}: CreateAccountModalProps) {
  const [username, setUsername] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [checkLoading, setCheckLoading] = useState(false);
  const [error, setError] = useState('');
  const [isAccountCreated, setIsAccountCreated] = useState(false);
  const [existingAccount, setExistingAccount] = useState<string | null>(null);
  const router = useRouter();

  const isWalletUser = !!userData?.wallet_id;

  // Wrap checkExistingAccount in useCallback to stabilize deps
  const checkExistingAccount = useCallback(async () => {
    // Skip for wallet users (already checked in HomeClient)
    if (isWalletUser) {
      return;
    }

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
      if (exists && accountId) {
        setExistingAccount(accountId);
        setIsAccountCreated(true);
        onAccountCreated(accountId);
        
        // Auto-close after showing message
        setTimeout(() => onClose(), 1500);
      }
    } catch (err: unknown) {
      console.error('Error checking existing account:', err);
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to check account: ${errMsg}`);
    } finally {
      setCheckLoading(false);
    }
  }, [userData?.email, isWalletUser, onAccountCreated, onClose]);

  useEffect(() => {
    if (isOpen && userData) {
      setIsAccountCreated(false);
      setError('');
      setUsername('');
      setExistingAccount(null);
      checkExistingAccount();
    }
  }, [isOpen, userData, checkExistingAccount]);

  const handleClose = () => {
    // For wallet users, just close without logout redirect
    if (isWalletUser) {
      onClose();
      return;
    }

    if (!isAccountCreated && !username) {
      router.push('/api/auth/logout?returnTo=/');
    }
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    // Validate username (just the prefix part)
    if (!/^[a-z0-9_-]{2,64}$/.test(username)) {
      setError('Invalid username: Use lowercase letters, numbers, _, - (2-64 characters)');
      setIsLoading(false);
      return;
    }

    // Construct full account ID
    const parentDomain = process.env.NEXT_PUBLIC_PARENT_DOMAIN || 'nova-sdk-5.testnet';
    const fullAccountId = `${username}.${parentDomain}`;

    console.log('Checking account:', { username, fullAccountId, isWalletUser });

    try {
      // Build payload with wallet_id if this is a wallet user
      const payload: any = {
        username,
        email: userData?.email,
      };

      // Include wallet_id for wallet users
      if (isWalletUser && userData?.wallet_id) {
        payload.wallet_id = userData.wallet_id;
      }

      // Check if username is available
      const checkRes = await fetch('/api/auth/check-for-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),

      });

      if (!checkRes.ok) {
        const errorData = await checkRes.json().catch(() => ({}));
        throw new Error(errorData.error || 'Check failed');
      }

      const { exists } = await checkRes.json();

      if (exists) {
        setError(`Username "${username}" is already taken. Please choose another.`);
        setIsLoading(false);
        return;
      }

      // Username is available, proceed to create account
      console.log('Username available, creating account...');
      const createRes = await fetch('/api/auth/create-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), // Send the same payload for creation
      });

      if (!createRes.ok) {
        const errorData = await createRes.json().catch(() => ({}));
        throw new Error(errorData.error || 'Account creation failed');
      }

      const { accountId: newAccountId } = await createRes.json();
      console.log('Account created successfully:', newAccountId);

      setIsAccountCreated(true);
      onAccountCreated(newAccountId); // This should log in the user client-side
      onClose(); // Close the modal

    } catch (err: unknown) {
      console.error('Error during account creation:', err);
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to create account: ${errMsg}`);
    } finally {
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
                  {isWalletUser && (
                    <div className={styles.formText} style={{ marginBottom: '1rem' }}>
                      Connected wallet: <strong>{userData.wallet_id}</strong>
                    </div>
                  )}
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
                      NOVA account: <strong>
                        {username ? `${username}.${process.env.NEXT_PUBLIC_PARENT_DOMAIN || 'nova-sdk-5.testnet'}` : '<username>.nova-sdk-5.testnet'}
                      </strong>
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