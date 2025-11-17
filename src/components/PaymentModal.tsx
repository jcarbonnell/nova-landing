// src/components/PaymentModal.tsx
'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
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

interface OnrampSessionPayload {
  session: {
    status: string;
    [key: string]: unknown;
  };
}

interface OnrampSessionEvent {
  payload: OnrampSessionPayload;
}

interface OnrampSession {
  mount: (el: HTMLElement) => void;
  addEventListener: (event: 'onramp_session_updated', cb: (e: OnrampSessionEvent) => void) => void;
  setAppearance: (opts: { theme: 'dark' | 'light' }) => void;  // Align with stripe.d.ts union
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
  const sessionRef = useRef<OnrampSessionRef>(null);

  // Load script dynamically (once)
  useEffect(() => {
    if (scriptLoaded || !isOpen) return;

    const script = document.createElement('script');
    script.src = 'https://js.stripe.com/v3/crypto/embedded.js';
    script.async = true;
    script.onload = () => {
      setScriptLoaded(true);
      console.log('StripeCrypto script loaded');
    };
    script.onerror = () => setError('Failed to load payment script');
    document.head.appendChild(script);

    return () => {
      if (script.parentNode) script.parentNode.removeChild(script);
    };
  }, [scriptLoaded, isOpen]);

  useEffect(() => {
    if (isOpen && amount) {
      const createSession = async () => {
        setIsLoading(true);
        setError('');
        try {
          const response = await fetch('/api/payments/create-onramp-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountId, email, amount }),
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Failed to create session');
          }

          const data = await response.json();
          setClientSecret(data.clientSecret);
          sessionRef.current = { sessionId: data.sessionId, amount: parseFloat(amount) };
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : 'Unknown error';
          setError(`Failed to initialize: ${errMsg}`);
        } finally {
          setIsLoading(false);
        }
      };
      createSession();
    }
  }, [isOpen, amount, accountId, email]);

  const handleSessionUpdate = useCallback((e: OnrampSessionEvent) => {
    console.log('Onramp updated:', e.payload.session.status);
    if (e.payload.session.status === 'fulfillment_complete') {
      onSubmit(sessionRef.current!.sessionId!, sessionRef.current!.amount!.toString());
      onClose();
    }
  }, [onSubmit, onClose]);

  useEffect(() => {
    if (clientSecret && onrampRef.current && scriptLoaded && !sessionRef.current?.mounted && window.StripeCrypto) {
      try {
        const session: OnrampSession = window.StripeCrypto.createOnrampSession({ clientSecret });
        sessionRef.current!.session = session;
        session.mount(onrampRef.current);
        sessionRef.current = { ...sessionRef.current, session, mounted: true };
        if (sessionRef.current!.session) {
          sessionRef.current!.session.addEventListener('onramp_session_updated', handleSessionUpdate);
          sessionRef.current!.session.setAppearance({ theme: 'dark' });
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        setError(`Mount failed: ${errMsg}`);
      }
    }

    return () => {
      if (sessionRef.current?.session) {
        sessionRef.current.session.unmount();
      }
    };
  }, [clientSecret, scriptLoaded, handleSessionUpdate]);

  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalDialog}>
        <div className={`${styles.modalContent} ${styles.paymentModal}`}>
          <div className={styles.modalHeader}>
            <h5 className={styles.modalTitle}>Fund Your Wallet (Optional)</h5>
            <button type="button" className={styles.closeButton} onClick={onClose}>x</button>
          </div>
          <div className={styles.modalBody}>
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
            {error && <div className={styles.alertDanger}>{error}</div>}
            {isLoading ? (
              <div className="text-center py-4">Initializing payment...</div>
            ) : clientSecret ? (
              <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div
                  ref={onrampRef}
                  style={{ maxWidth: '540px', height: '500px' }}
                />
                <Button
                  type="button"
                  onClick={onSkip}
                  disabled={isLoading}
                  className={styles.buttonSecondary}
                  style={{ marginTop: '15px', width: '100%', maxWidth: '540px' }}
                >
                  Skip Funding (Create Free Account)
                </Button>
              </div>
            ) : (
              !error && <div className="text-center py-4">Preparing secure payment...</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}