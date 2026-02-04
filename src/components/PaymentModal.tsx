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
  const [copied, setCopied] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyLoading, setApiKeyLoading] = useState(false);
  const [apiKeyError, setApiKeyError] = useState('');
  const [apiKeyCopied, setApiKeyCopied] = useState(false);

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
      setApiKey(null);
      setApiKeyError('');
      setApiKeyCopied(false);
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

        const targetAssetDetails = { chain: 'NEAR', asset: 'NEAR' };

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

  // copy account ID to clipboard for simplified funding
  const copyToClipboard = async () => {
    if (!accountId) return;
    try {
      await navigator.clipboard.writeText(accountId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  // Generate API key
  const generateApiKey = async () => {
    if (!accountId) {
      setApiKeyError('No account connected');
      return;
    }

    setApiKeyLoading(true);
    setApiKeyError('');
    setApiKey(null);

    try {
      const response = await fetch('/api/auth/generate-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: accountId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate API key');
      }

      setApiKey(data.api_key);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error('API key generation failed:', errMsg);
      setApiKeyError(errMsg);
    } finally {
      setApiKeyLoading(false);
    }
  };

  // Copy API key to clipboard
  const copyApiKey = async () => {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setApiKeyCopied(true);
      setTimeout(() => setApiKeyCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy API key:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalDialog}>
        <div className={`${styles.modalContent} ${styles.paymentModal}`}>
          <div className={styles.modalHeader}>
            <h5 className={styles.modalTitle}>Manage Account</h5>
            <button type="button" className={styles.closeButton} onClick={onClose}>
              ×
            </button>
          </div>
          <div className={styles.modalBody}>
            {/* TESTNET: Faucet + API Key section */}
            {isTestnet && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  padding: "20px 0",
                }}
              >
                <div style={{ width: "100%", maxWidth: "540px" }}>
                  <div className="mb-4 p-4 bg-purple-500/20 border border-purple-500/50 rounded-lg text-center">
                    <p className="text-purple-200 text-sm mb-2">
                      <strong>🧪 Testnet Mode</strong>
                    </p>
                    <p className="text-gray-300 text-sm">
                      Testnet accounts are free and can be funded automatically by clicking the &quot;Request Tokens&quot; button below.
                    </p>
                  </div>

                  {/* Connected Account Display */}
                  {accountId && (
                    <div className="mb-4 p-3 bg-gray-800/50 rounded-lg">
                      <p className="text-gray-400 text-xs mb-1">Connected Account</p>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-purple-200 text-sm font-mono truncate flex-1">
                          {accountId}
                        </p>
                        <button
                          type="button"
                          onClick={copyToClipboard}
                          className="text-gray-400 hover:text-purple-300 transition-colors p-1 rounded hover:bg-gray-700/50"
                          title="Copy to clipboard"
                        >
                          {copied ? (
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          )}
                        </button>
                      </div>
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

                  <Button
                    type="button"
                    onClick={requestFaucetTokens}
                    disabled={faucetLoading || !accountId}
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                    style={{ 
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

                  {/* API Key Section */}
                  <div className="mt-6 pt-6 border-t border-purple-500/30">
                    <div className="mb-4 p-4 bg-blue-500/20 border border-blue-500/50 rounded-lg text-center">
                      <p className="text-blue-200 text-sm mb-2">
                        <strong>🔑 SDK API Key</strong>
                      </p>
                      <p className="text-gray-300 text-sm">
                        Generate an API key to use with the NOVA SDK in your applications.
                        One key per account — generating a new key will invalidate the old one.
                      </p>
                    </div>

                    {apiKeyError && (
                      <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
                        <p className="text-red-200 text-sm">❌ {apiKeyError}</p>
                      </div>
                    )}

                    {apiKey ? (
                      <div className="mb-4">
                        <div className="p-3 bg-green-500/20 border border-green-500/50 rounded-lg mb-3">
                          <p className="text-green-200 text-sm mb-2">✅ API Key Generated</p>
                          <p className="text-yellow-200 text-xs">⚠️ Save this key now — you won't see it again!</p>
                        </div>
                        <div className="flex items-center gap-2 p-3 bg-gray-800/50 rounded-lg">
                          <code className="text-purple-200 text-xs font-mono flex-1 truncate">
                            {apiKey}
                          </code>
                          <button
                            type="button"
                            onClick={copyApiKey}
                            className="text-gray-400 hover:text-purple-300 transition-colors p-1 rounded hover:bg-gray-700/50"
                            title="Copy API key"
                          >
                            {apiKeyCopied ? (
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                              </svg>
                            )}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        onClick={generateApiKey}
                        disabled={apiKeyLoading || !accountId}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                        style={{ fontSize: '16px', padding: '12px 24px' }}
                      >
                        {apiKeyLoading ? (
                          <span className="flex items-center justify-center">
                            <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                            Generating...
                          </span>
                        ) : (
                          '🔑 Generate API Key'
                        )}
                      </Button>
                    )}
                  </div>
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

                  {/* Connected Account Display */}
                  {accountId && (
                    <div
                      className="mb-4 p-3 bg-gray-800/50 rounded-lg"
                      style={{ width: "100%", maxWidth: "540px" }}
                    >
                      <p className="text-gray-400 text-xs mb-1">Connected Account</p>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-purple-200 text-sm font-mono truncate flex-1">
                          {accountId}
                        </p>
                        <button
                          type="button"
                          onClick={copyToClipboard}
                          className="text-gray-400 hover:text-purple-300 transition-colors p-1 rounded hover:bg-gray-700/50"
                          title="Copy to clipboard"
                        >
                          {copied ? (
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="text-green-400"
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : (
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                  
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

                  {/* API Key Section */}
                  <div className="mt-6 pt-6 border-t border-purple-500/30">
                    <div className="mb-4 p-4 bg-blue-500/20 border border-blue-500/50 rounded-lg text-center">
                      <p className="text-blue-200 text-sm mb-2">
                        <strong>🔑 SDK API Key</strong>
                      </p>
                      <p className="text-gray-300 text-sm">
                        Generate an API key to use with the NOVA SDK in your applications.
                        One key per account — generating a new key will invalidate the old one.
                      </p>
                    </div>

                    {apiKeyError && (
                      <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
                        <p className="text-red-200 text-sm">❌ {apiKeyError}</p>
                      </div>
                    )}

                    {apiKey ? (
                      <div className="mb-4">
                        <div className="p-3 bg-green-500/20 border border-green-500/50 rounded-lg mb-3">
                          <p className="text-green-200 text-sm mb-2">✅ API Key Generated</p>
                          <p className="text-yellow-200 text-xs">⚠️ Save this key now — you won't see it again!</p>
                        </div>
                        <div className="flex items-center gap-2 p-3 bg-gray-800/50 rounded-lg">
                          <code className="text-purple-200 text-xs font-mono flex-1 truncate">
                            {apiKey}
                          </code>
                          <button
                            type="button"
                            onClick={copyApiKey}
                            className="text-gray-400 hover:text-purple-300 transition-colors p-1 rounded hover:bg-gray-700/50"
                            title="Copy API key"
                          >
                            {apiKeyCopied ? (
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                              </svg>
                            )}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        onClick={generateApiKey}
                        disabled={apiKeyLoading || !accountId}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                        style={{ fontSize: '16px', padding: '12px 24px' }}
                      >
                        {apiKeyLoading ? (
                          <span className="flex items-center justify-center">
                            <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                            Generating...
                          </span>
                        ) : (
                          '🔑 Generate API Key'
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}