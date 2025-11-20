// src/components/PaymentModal.tsx
'use client';
import { useState, useEffect, useRef } from 'react';
import { Button } from './ui/button';
import styles from '@/styles/modal.module.css';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (sessionId: string, amount: string) => void;
  onSkip: () => void;
  accountId: string;
  email: string;
}

interface OnrampSessionEvent {
  payload: {
    session: {
      status: string;
      [key: string]: unknown;
    };
  };
}

interface OnrampSession {
  mount: (el: HTMLElement) => void;
  addEventListener: (event: 'onramp_session_updated', cb: (e: OnrampSessionEvent) => void) => void;
  removeEventListener: (event: 'onramp_session_updated', cb: (e: OnrampSessionEvent) => void) => void;
  setAppearance: (opts: { theme: 'dark' | 'light' }) => void;
  unmount: () => void;
}

interface OnrampSessionRef {
  session?: OnrampSession;
  mounted?: boolean;
  sessionId?: string;
  amount?: number;
}

export default function PaymentModal({
  isOpen,
  onClose,
  onSubmit,
  onSkip,
  accountId,
  email,
}: PaymentModalProps) {
  const [amount, setAmount] = useState('10.00');
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const onrampRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<OnrampSessionRef>({});

  // Detect testnet
  const isTestnet = process.env.NEXT_PUBLIC_NEAR_NETWORK !== 'mainnet';

  // Load Stripe Crypto script
  useEffect(() => {
    if (scriptLoaded || !isOpen || isTestnet) return;

    const script = document.createElement('script');
    script.src = 'https://crypto-js.stripe.com/crypto-onramp-outer.js';
    script.async = true;
    script.onload = () => {
      console.log('Stripe Crypto script loaded');
      setScriptLoaded(true);
    };
    script.onerror = () => {
      console.error('Failed to load Stripe Crypto script');
      setError('Failed to load payment interface');
    };
    document.head.appendChild(script);

    return () => {
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, [scriptLoaded, isOpen, isTestnet]);

  // Create session when modal opens
  useEffect(() => {
    if (!isOpen || !amount || isTestnet) return;

    const createSession = async () => {
      setIsLoading(true);
      setError('');
      
      try {
        console.log('Creating onramp session...', { accountId, email, amount });
        
        const response = await fetch('/api/payments/create-onramp-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId, email, amount }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Server error: ${response.status}`);
        }

        const data = await response.json();
        console.log('Session created:', data.sessionId);
        
        setClientSecret(data.clientSecret);
        sessionRef.current = { 
          sessionId: data.sessionId, 
          amount: parseFloat(amount) 
        };
        
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error('Session creation error:', errMsg);
        setError(`Failed to initialize: ${errMsg}`);
      } finally {
        setIsLoading(false);
      }
    };

    createSession();
  }, [isOpen, amount, accountId, email, isTestnet]);

  // Mount Stripe Onramp element
  useEffect(() => {
    if (!clientSecret || !onrampRef.current || !scriptLoaded || sessionRef.current.mounted || isTestnet) {
      return;
    }

    if (!window.StripeOnramp) {
      console.error('StripeOnramp not available');
      setError('Payment interface not loaded');
      return;
    }

    // Define handler inside effect to capture current closure
    const handleSessionUpdate = (e: OnrampSessionEvent) => {
      console.log('Onramp session updated:', e.payload.session.status);
    
      if (e.payload.session.status === 'fulfillment_complete') {
        const { sessionId, amount: sessionAmount } = sessionRef.current;
        if (sessionId && sessionAmount) {
          console.log('Payment complete, submitting...');
          onSubmit(sessionId, sessionAmount.toString());
          onClose();
        }
      }
    };

    try {
      console.log('Mounting Stripe Onramp...');
      
      const session = window.StripeOnramp.createSession({
        clientSecret,
        appearance: { theme: 'dark' },
      });

      session.mount(onrampRef.current);
      session.addEventListener('onramp_session_updated', handleSessionUpdate);
      
      sessionRef.current = {
        ...sessionRef.current,
        session,
        mounted: true,
      };

      console.log('Stripe Onramp mounted successfully');
      
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error('Mount error:', errMsg);
      setError(`Failed to load payment: ${errMsg}`);
    }

    return () => {
      if (sessionRef.current.session) {
        try {
          sessionRef.current.session.removeEventListener(
            'onramp_session_updated', 
            handleSessionUpdate
          );
          sessionRef.current.session.unmount();
        } catch (err) {
          console.warn('Unmount error:', err);
        }
      }
    };
  }, [clientSecret, scriptLoaded, isTestnet, onSubmit, onClose]);

  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalDialog}>
        <div className={`${styles.modalContent} ${styles.paymentModal}`}>
          <div className={styles.modalHeader}>
            <h5 className={styles.modalTitle}>Fund Your Wallet (Optional)</h5>
            <button type="button" className={styles.closeButton} onClick={onClose}>
              ×
            </button>
          </div>
          <div className={styles.modalBody}>
            {/* ADD TESTNET WARNING */}
            {isTestnet && (
              <div className="mb-4 p-4 bg-yellow-500/20 border border-yellow-500/50 rounded-lg">
                <p className="text-yellow-200 text-sm">
                  <strong>🧪 Testnet Mode:</strong> You&apos;re on testnet. 
                  Real payments don&apos;t work here. Click &quot;Skip Funding&quot; below to create 
                  your account with free testnet tokens.
                </p>
              </div>
            )}

            {/* AMOUNT SELECTOR - Hidden on testnet since payment not available */}
            {!isTestnet && (
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Amount (USD)</label>
                <select
                  className={styles.formControl}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={isLoading || !!error}
                >
                  <option value="5.00">$5.00</option>
                  <option value="10.00">$10.00</option>
                  <option value="20.00">$20.00</option>
                </select>
              </div>
            )}
            
            {/* ERROR MESSAGE - Only show non-testnet errors */}
            {error && !isTestnet && (
              <div className={styles.alertDanger}>
                {error}
              </div>
            )}
            
            {/* MAINNET: Loading state */}
            {!isTestnet && isLoading && (
              <div className="text-center py-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500 mx-auto mb-2" />
                <p>Initializing payment...</p>
              </div>
            )}
            
            {/* MAINNET: Stripe payment widget */}
            {!isTestnet && clientSecret && scriptLoaded && !isLoading && (
              <div style={{ 
                position: 'relative', 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center' 
              }}>
                <div
                  ref={onrampRef}
                  style={{ maxWidth: '540px', height: '500px', width: '100%' }}
                />
                <Button
                  type="button"
                  onClick={() => {
                    onSkip();
                    onClose();
                  }}
                  disabled={isLoading}
                  className={styles.buttonSecondary}
                  style={{ 
                    marginTop: '15px', 
                    width: '100%', 
                    maxWidth: '540px' 
                  }}
                >
                  Skip Funding (Create Free Account)
                </Button>
              </div>
            )}
            
            {/* MAINNET: Preparing message */}
            {!isTestnet && !clientSecret && !isLoading && !error && (
              <div className="text-center py-4">
                Preparing secure payment...
              </div>
            )}
            
            {/* TESTNET: Skip button prominently displayed */}
            {isTestnet && (
              <div className="text-center py-8">
                <p className="text-gray-400 mb-6 text-sm">
                  Testnet accounts are free and will be funded automatically with test tokens.
                </p>
                <Button
                  type="button"
                  onClick={() => {
                    onSkip();
                    onClose();
                  }}
                  className={styles.buttonPrimary}
                  style={{ 
                    width: '100%', 
                    maxWidth: '540px',
                    margin: '0 auto',
                    fontSize: '16px',
                    padding: '12px 24px'
                  }}
                >
                  Skip Funding & Create Account
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}