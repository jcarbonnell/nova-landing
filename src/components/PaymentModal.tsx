// src/components/PaymentModal.tsx
'use client';
import { useState, useEffect, useRef } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import type { Stripe } from '@stripe/stripe-js';
import { Button } from './ui/button';
import styles from '@/styles/modal.module.css';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (sessionId: string, amount: string) => void;
  onSkip: () => void;
  accountId: string;
  email: string;
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
  const onrampRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<any>(null);

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
        } catch (err: any) {
          setError(`Failed to initialize: ${err.message}`);
        } finally {
          setIsLoading(false);
        }
      };
      createSession();
    }
  }, [isOpen, amount, accountId, email]);

  useEffect(() => {
    if (clientSecret && onrampRef.current && !sessionRef.current?.mounted) {
      stripePromise.then((stripe: Stripe | null) => {
        if (!stripe || !onrampRef.current) return;
        try {
          const session: any = (stripe as any).createOnrampSession({ clientSecret });
          session.mount(onrampRef.current);  // 2025 mount (NEAR via backend dest)
          sessionRef.current = { ...sessionRef.current, session, mounted: true };
          session.addEventListener('onramp_session_updated', ({ payload }: { payload: any }) => {
            console.log('Onramp updated:', payload.session.status);
            if (payload.session.status === 'fulfillment_complete') {
              onSubmit(sessionRef.current!.sessionId, sessionRef.current!.amount.toString());
              onClose();
            }
          });
          session.setAppearance({ theme: 'dark' });
        } catch (err: any) {
          setError(`Mount failed: ${err.message}`);
        }
      });
    }

    return () => {
      if (sessionRef.current?.session) {
        sessionRef.current.session.unmount();
      }
    };
  }, [clientSecret]);

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
                  ref={onrampRef}  // Mount point
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