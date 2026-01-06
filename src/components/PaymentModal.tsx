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
  payload: { session: { status: string; [key: string]: unknown } };
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
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [faucetSuccess, setFaucetSuccess] = useState('');
  const onrampRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<OnrampSessionRef>({});

  // Detect testnet
  const isTestnet = process.env.NEXT_PUBLIC_NEAR_NETWORK !== 'mainnet';

  // Request tokens from faucet via smart contract call
  const requestFaucetTokens = async () => {
    if (!accountId) {
      setError('No account connected. Please connect your wallet first.');
      return;
    }

    setFaucetLoading(true);
    setError('');
    setFaucetSuccess('');

    try {
      const response = await fetch('/api/faucet/request-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Faucet request failed');
      }

      console.log('Faucet response:', data);
      setFaucetSuccess('Successfully received testnet tokens! Your account has been funded.');
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error('Faucet request failed:', errMsg);
      setError(errMsg);
    } finally {
      setFaucetLoading(false);
    }
  };

  // Load Stripe script
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
      if (script.parentNode) script.parentNode.removeChild(script);
    };
  }, [scriptLoaded, isOpen, isTestnet]);

  // Create session when modal opens
  useEffect(() => {
    if (!isOpen || !amount || isTestnet) return;

    const createSession = async () => {
      setIsLoading(true);
      setError('');
      
      try {
        console.log('Creating Stripe onramp session...');
        
        const response = await fetch('/api/payments/create-onramp-session', {
          method: 'POST',
          credentials: 'include',
          headers: { 
            'Content-Type': 'application/json',
            // Add wallet ID if available (passed as prop or from accountId)
            ...(accountId && !email.includes('@') && { 'x-wallet-id': accountId }),
          },
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
        console.error('Stripe session creation failed');
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
          console.log('Payment completed, submitting...');
          onSubmit(sessionId, sessionAmount.toString());
          onClose();
        }
      }
    };

    try {
      console.log('Mounting Stripe Onramp widget...');
      
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

      console.log('Stripe Onramp mounted');
      
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error('Stripe Onramp mount failed');
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

  // Reset faucet states when modal closes
  useEffect(() => {
    if (!isOpen) {
      setFaucetSuccess('');
      setError('');
    }
  }, [isOpen]);

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
            {/* TESTNET: Faucet section */}
            {isTestnet && (
              <div className="text-center py-4">
                <div className="mb-4 p-4 bg-purple-500/20 border border-purple-500/50 rounded-lg">
                  <p className="text-purple-200 text-sm mb-2">
                    <strong>🧪 Testnet Mode</strong>
                  </p>
                  <p className="text-gray-300 text-sm">
                    Testnet accounts are free and can be funded automatically by clicking the &quot;Request Tokens&quot; button below.
                  </p>
                </div>

                {accountId && (
                  <div className="mb-4 p-3 bg-gray-800/50 rounded-lg">
                    <p className="text-gray-400 text-xs mb-1">Connected Account</p>
                    <p className="text-purple-200 text-sm font-mono truncate">{accountId}</p>
                  </div>
                )}

                {faucetSuccess && (
                  <div className="mb-4 p-3 bg-green-500/20 border border-green-500/50 rounded-lg">
                    <p className="text-green-200 text-sm">✅ {faucetSuccess}</p>
                  </div>
                )}

                {error && (
                  <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
                    <p className="text-red-200 text-sm">❌ {error}</p>
                  </div>
                )}

                <div className="space-y-3">
                  <Button
                    type="button"
                    onClick={requestFaucetTokens}
                    disabled={faucetLoading || !accountId}
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                    style={{ 
                      maxWidth: '540px',
                      fontSize: '16px',
                      padding: '12px 24px'
                    }}
                  >
                    {faucetLoading ? (
                      <span className="flex items-center justify-center">
                        <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                        Requesting Tokens...
                      </span>
                    ) : (
                      '🚰 Request Testnet Tokens'
                    )}
                  </Button>

                  <Button
                    type="button"
                    onClick={onClose}
                    variant="outline"
                    className="w-full border-purple-500/50 text-purple-200 hover:bg-purple-900/30"
                    style={{ 
                      maxWidth: '540px',
                      fontSize: '14px',
                      padding: '10px 20px'
                    }}
                  >
                    Close
                  </Button>
                </div>
              </div>
            )}

            {/* MAINNET: Amount selector */}
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
            
            {/* MAINNET: Error message */}
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
          </div>
        </div>
      </div>
    </div>
  );
}