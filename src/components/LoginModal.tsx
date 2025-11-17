// src/components/LoginModal.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@auth0/nextjs-auth0/client';
import { Button } from './ui/button';
import { Wallet } from 'lucide-react';
import styles from '@/styles/modal.module.css';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess?: () => void;  // optional prop
}

export default function LoginModal({ isOpen, onClose, onLoginSuccess }: LoginModalProps) {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { user: _, isLoading: __ } = useUser();  // Separate aliases (_ and __) to avoid redeclaration

  if (!isOpen) return null;

  const handleEmailLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setIsLoading(true);
    try {
      router.push(`/api/auth/login?connection=email-passwordless&login_hint=${encodeURIComponent(email)}`);
      onLoginSuccess?.();  // Fix: Optional call (TS-safe)
    } catch (error) {
      console.error('Email login failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSocialLogin = (connection: string) => {
    router.push(`/api/auth/login?connection=${connection}`);
    onLoginSuccess?.();  // Optional call
  };

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalDialog}>
        <div className={styles.modalContent}>
          <div className={styles.modalHeader}>
            <h5 className={styles.modalTitle}>Log in to NOVA</h5>
            <button type="button" className={styles.closeButton} onClick={onClose}>x</button>
          </div>
          <div className={styles.modalBody}>
            <div className={`${styles.formGroup} ${styles.centeredFormGroup}`}>
              <Button onClick={() => router.push('/api/auth/login')} disabled={isLoading} className={styles.buttonSecondary}>
                <Wallet size={18} /> Connect Wallet
              </Button>
              <div className={styles.divider}>
                <div className={styles.dividerLine}></div>
                <div className={styles.dividerText}>or</div>
                <div className={styles.dividerLine}></div>
              </div>
              <form onSubmit={handleEmailLogin}>
                <input
                  type="email"
                  className={styles.formControl}
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <Button type="submit" disabled={isLoading} className={styles.buttonPrimary}>
                  {isLoading ? 'Sending...' : 'Login with Email'}
                </Button>
              </form>
              <div className={styles.buttonGroup}>
                <Button onClick={() => handleSocialLogin('google-oauth2')} className={styles.socialButton}>Google</Button>
                <Button onClick={() => handleSocialLogin('github')} className={styles.socialButton}>GitHub</Button>
              </div>
            </div>
          </div>
          <div className={styles.modalFooter}>
            <Button type="button" onClick={onClose} className={styles.buttonSecondary}>Close</Button>
          </div>
        </div>
      </div>
    </div>
  );
}