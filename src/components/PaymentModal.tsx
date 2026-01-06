// src/components/PaymentModal.tsx
'use client';
import { useState, useEffect } from 'react';
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

export default function PaymentModal({
  isOpen,
  onClose,
  onSubmit,
  onSkip,
  accountId,
}: PaymentModalProps) {
  const [amount, setAmount] = useState('10.00');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [faucetSuccess, setFaucetSuccess] = useState('');

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

  // Reset states when modal closes
  useEffect(() => {
    if (!isOpen) {
      setFaucetSuccess("");
      setError("");
      setIsLoading(false);
    }
  }, [isOpen]);

  // Initialize PingPay widget (mainnet only)
  const handleStartOnramp = () => {
    if (!accountId) {
      setError('No wallet address available');
      return;
    }

    setIsLoading(true);
    setError('');

    import('@pingpay/onramp-sdk')
      .then(({ PingpayOnramp }) => {
        console.log('Creating PingPay instance...');

        const targetAssetDetails = { chain: 'NEAR', asset: 'wNEAR' };

        const onramp = new PingpayOnramp({
          onPopupReady: () => console.log('PingPay: Popup is ready'),
          onProcessComplete: (result: unknown) => {
            console.log('PingPay: Process complete', result);
            const data = (result as { data?: { depositAddress?: string; amount?: string } })?.data;
            onSubmit(data?.depositAddress || 'pingpay-complete', data?.amount || amount);
            onClose();
          },
          onProcessFailed: (errorInfo: unknown) => {
            console.error('PingPay: Process failed', errorInfo);
            const errMsg = (errorInfo as { error?: string })?.error || 'Payment failed';
            setError(errMsg);
            setIsLoading(false);
          },
          onPopupClose: () => {
            console.log('PingPay: Popup was closed');
            setIsLoading(false);
          },
        } as any);

        console.log('Calling initiateOnramp with targetAsset...');
        onramp.initiateOnramp(targetAssetDetails);
      })
      .catch((err) => {
        console.error('Failed to load PingPay SDK:', err);
        setError('Failed to load payment SDK');
        setIsLoading(false);
      });
  };

  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalDialog}>
        <div className={`${styles.modalContent} ${styles.paymentModal}`}>
          <div className={styles.modalHeader}>
            <h5 className={styles.modalTitle}>Fund Your Wallet</h5>
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

            {/* MAINNET: PingPay onramp */}
            {!isTestnet && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  padding: "20px 0",
                }}
              >
                {/* Error message */}
                {error && (
                  <div className={styles.alertDanger} style={{ width: "100%", maxWidth: "540px", marginBottom: "16px" }}>
                    {error}
                  </div>
                )}

                <div style={{ width: "100%", maxWidth: "540px" }}>
                  <div className="mb-4 p-4 bg-purple-500/20 border border-purple-500/50 rounded-lg text-center">
                    <p className="text-purple-200 text-sm mb-2">
                      <strong>💳 Get NEAR coins with a card payment</strong>
                    </p>
                    <p className="text-gray-300 text-sm">
                      Click the button below to purchase NEAR credits with your
                      credit/debit card via PingPay. These tokens will be burned through your file sharing operations.
                    </p>
                  </div>

                  <Button
                    type="button"
                    onClick={handleStartOnramp}
                    disabled={isLoading}
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                    style={{
                      fontSize: "16px",
                      padding: "12px 24px",
                    }}
                  >
                    {isLoading ? (
                      <span className="flex items-center justify-center">
                        <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                        Processing...
                      </span>
                    ) : (
                      "Buy NEAR tokens"
                    )}
                  </Button>
                </div>

                <Button
                  type="button"
                  onClick={() => {
                    onSkip();
                    onClose();
                  }}
                  disabled={isLoading}
                  className={styles.buttonSecondary}
                  style={{
                    marginTop: "15px",
                    width: "100%",
                    maxWidth: "540px",
                  }}
                >
                  Skip Funding
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}