// src/components/LoginModal.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@auth0/nextjs-auth0/client';
import { Button } from './ui/button';
import { Wallet } from 'lucide-react';
import Image from 'next/image';
import styles from '@/styles/modal.module.css';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess?: () => void;
  onOpenWallet?: () => void;
}

export default function LoginModal({ isOpen, onClose, onLoginSuccess, onOpenWallet }: LoginModalProps) {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  useUser();

  if (!isOpen) return null;

  const handleEmailLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setIsLoading(true);
    try {
      router.push(`/auth/login?connection=email&login_hint=${encodeURIComponent(email)}`);
      onLoginSuccess?.();
    } catch (error) {
      console.error('Email login failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSocialLogin = (connection: string) => {
    router.push(`/auth/login?connection=${connection}`);
    onLoginSuccess?.();
  };

  // Handle wallet connect
  const handleWalletConnect = () => {
    if (onOpenWallet) {
      onOpenWallet();  // Open NEAR selector modal
      onClose();  // Close login modal after
    } else {
      console.warn('Wallet modal not ready—falling back to Auth0');
      router.push('/auth/login');
    }
  };

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalDialog}>
        <div className={styles.modalContent}>
          <div className={styles.modalHeader}>
            <h5 className={styles.modalTitle}>Log in to NOVA</h5>
            <button type="button" className={styles.closeButton} onClick={onClose}>×</button>
          </div>
          <div className={styles.modalBody}>
            <div className={`${styles.formGroup} ${styles.centeredFormGroup}`}>
              
              {/* Connect wallet */}
              <Button 
                onClick={handleWalletConnect}
                disabled={isLoading} 
                className={styles.buttonSecondary}
              >
                <Wallet size={18} /> 
                Connect NEAR Wallet
              </Button>

              <div className={styles.divider}>
                <div className={styles.dividerLine}></div>
                <div className={styles.dividerText}>or</div>
                <div className={styles.dividerLine}></div>
              </div>

              {/* Email login */}
              <form onSubmit={handleEmailLogin}>
                <input
                  type="email"
                  className={styles.formControl}
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <Button 
                  type="submit" 
                  disabled={isLoading} 
                  className="w-full bg-purple-600 hover:bg-purple-700 text-white font-medium py-3 rounded-lg transition-all hover:scale-105 mt-4"
                >
                  {isLoading ? 'Sending...' : 'Login with Email'}
                </Button>
              </form>

              {/* Social login */}
              <div className={styles.buttonGroup}>
                <Button 
                  onClick={() => handleSocialLogin('google-oauth2')} 
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-medium py-3 rounded-lg transition-all hover:scale-105 flex items-center justify-center gap-2"
                >
                  <Image src="/google-icon.svg" alt="Google" width={20} height={20} />
                  Google
                </Button>
                <Button 
                  onClick={() => handleSocialLogin('github')} 
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-medium py-3 rounded-lg transition-all hover:scale-105 flex items-center justify-center gap-2"
                >
                  <Image src="/github-icon.svg" alt="GitHub" width={20} height={20} />
                  GitHub
                </Button>
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