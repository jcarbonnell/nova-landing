// src/components/AccountControls.tsx
//
// §8 step 2c-ii — account operations, restructured into §4.1 subsections.
//
// Was a top-level isTestnet split with the API-key block DUPLICATED in each
// branch (and the mainnet copy missing rotate — both warts). Now: three
// presentational subsections — Identity, Funding (the ONLY network-dependent
// part, switching internally), API keys (ONE definition, always with rotate) —
// with all state + handlers owned by AccountControls and passed down as props.
// De-dup is structural: one ApiKeySection can't drift from a twin or lose a
// control.
//
// Behaviour is byte-identical to 2c-i: every handler and every piece of state is
// unchanged; only the JSX arrangement moved. Mainnet GAINS the rotate control by
// construction (it now renders the same ApiKeySection as testnet).
//
// Theming crumbs left for 2c-iii (do NOT fix here — this slice is pure
// structure): the bg-gray-800/50 key-reveal box, the copy buttons, the
// bg-blue-600 generate button, the border-purple-500/30 dividers. Semantic
// green/red/yellow states stay as-is (they read on both themes).

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from './ui/button';

// ── Identity ──────────────────────────────────────────────────────────────
// The connected-account display (account id + copy). Network-independent, so it
// renders once. 2d turns this into the full identity subsection (+ NEAR balance).

// Below this NEAR balance, the low-balance hint appears — group registration is
// the priciest common op (~0.65 NEAR), so that's the threshold.
const LOW_BALANCE_THRESHOLD = 0.65;

function Identity({
  accountId,
  copied,
  onCopy,
  balanceNear,
  balanceLoading,
  balanceError,
  onRetryBalance,
}: {
  accountId: string;
  copied: boolean;
  onCopy: () => void;
  balanceNear: string | null;
  balanceLoading: boolean;
  balanceError: boolean;
  onRetryBalance: () => void;
}) {
  if (!accountId) return null;

  const isLow = balanceNear !== null && parseFloat(balanceNear) < LOW_BALANCE_THRESHOLD;

  return (
    <div className="mb-4 p-3 bg-nova-surface-2 border border-nova-border rounded-lg">
      <p className="text-nova-text-dim text-xs mb-1">Connected Account</p>
      <div className="flex items-center justify-between gap-2">
        <p className="text-nova-text text-sm font-mono truncate flex-1">{accountId}</p>
        <button type="button" onClick={onCopy} className="text-gray-400 hover:text-purple-300 transition-colors p-1 rounded hover:bg-gray-700/50" title="Copy to clipboard">
          {copied ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400"><polyline points="20 6 9 17 4 12" /></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          )}
        </button>
      </div>

      {/* Balance line */}
      <div className="mt-3 pt-3 border-t border-nova-border flex items-center justify-between gap-2">
        <span className="text-nova-text-dim text-xs">Balance</span>
        {balanceLoading ? (
          <span className="flex items-center gap-1.5 text-nova-text-dim text-sm">
            <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-nova-text-dim" />
          </span>
        ) : balanceError ? (
          <button type="button" onClick={onRetryBalance} className="text-xs text-red-700 hover:underline">
            Couldn&apos;t load — retry
          </button>
        ) : (
          <span className="text-nova-text text-sm font-mono">{balanceNear} NEAR</span>
        )}
      </div>

      {/* Low-balance hint */}
      {isLow && !balanceLoading && !balanceError && (
        <p className="mt-2 text-xs text-red-700">
          Low balance — registering a group costs ~0.65 NEAR. Add credits below.
        </p>
      )}
    </div>
  );
}

// ── Funding ───────────────────────────────────────────────────────────────
// The ONLY network-dependent subsection. Testnet → faucet (free tokens);
// mainnet → PingPay purchase (credits are required to pay for operations).

function FundingSection({
  isTestnet,
  accountId,
  error,
  faucetLoading,
  faucetSuccess,
  onRequestFaucet,
  isLoading,
  fundedAmount,
  onStartOnramp,
}: {
  isTestnet: boolean;
  accountId: string;
  error: string;
  faucetLoading: boolean;
  faucetSuccess: string;
  onRequestFaucet: () => void;
  isLoading: boolean;
  fundedAmount: string | null;
  onStartOnramp: () => void;
}) {
  if (isTestnet) {
    return (
      <div>
        <div className="mb-4 p-4 bg-nova-surface-2 border border-nova-border rounded-lg text-center">
          <p className="text-nova-text text-sm mb-2"><strong>🧪 Testnet Mode</strong></p>
          <p className="text-nova-text-dim text-sm">
            Testnet accounts are free — click below to fund yours with test tokens and try NOVA out.
          </p>
        </div>

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

        <Button type="button" onClick={onRequestFaucet} disabled={faucetLoading || !accountId} className="w-full bg-purple-600 hover:bg-purple-700 text-white" style={{ fontSize: '16px', padding: '12px 24px' }}>
          {faucetLoading ? (
            <span className="flex items-center justify-center"><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />Requesting Tokens...</span>
          ) : ('🚰 Request Testnet Tokens')}
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 p-4 bg-nova-surface-2 border border-nova-border rounded-lg text-center">
        <p className="text-nova-text text-sm mb-2"><strong>💳 NEAR credits</strong></p>
        <p className="text-nova-text-dim text-sm">
          Purchase NEAR coins with PingPay — you need credits to pay for your file-sharing operations.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
          <p className="text-red-200 text-sm">❌ {error}</p>
        </div>
      )}

      {fundedAmount && (
        <div className="mb-4 p-3 bg-green-500/20 border border-green-500/50 rounded-lg">
          <p className="text-green-200 text-sm">✅ Payment complete{fundedAmount ? ` — ${fundedAmount} NEAR on its way to your account` : ''}.</p>
        </div>
      )}

      <Button type="button" onClick={onStartOnramp} disabled={isLoading} className="w-full bg-purple-600 hover:bg-purple-700 text-white" style={{ fontSize: '16px', padding: '12px 24px' }}>
        {isLoading ? (
          <span className="flex items-center justify-center"><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />Processing...</span>
        ) : (fundedAmount ? 'Buy more NEAR' : 'Buy NEAR tokens')}
      </Button>
    </div>
  );
}

// ── ApiKeySection ─────────────────────────────────────────────────────────
// ONE definition, network-independent, ALWAYS includes rotate. Mainnet gains
// rotate by construction here (previously only testnet rendered it).

function ApiKeySection({
  accountId,
  apiKey,
  apiKeyLoading,
  apiKeyError,
  apiKeyCopied,
  rotateLoading,
  rotateConfirm,
  apiKeyIsRotated,
  onGenerate,
  onRotate,
  onCopy,
  setRotateConfirm,
}: {
  accountId: string;
  apiKey: string | null;
  apiKeyLoading: boolean;
  apiKeyError: string;
  apiKeyCopied: boolean;
  rotateLoading: boolean;
  rotateConfirm: boolean;
  apiKeyIsRotated: boolean;
  onGenerate: () => void;
  onRotate: () => void;
  onCopy: () => void;
  setRotateConfirm: (v: boolean) => void;
}) {
  return (
    <div className="mt-6 pt-6 border-t border-nova-border">
      <div className="mb-4 p-4 bg-nova-surface-2 border border-nova-border rounded-lg text-center">
        <p className="text-nova-text text-sm mb-2"><strong>🔑 SDK API Key</strong></p>
        <p className="text-nova-text-dim text-sm">
          Your API key lets you use NOVA from your own apps or an external chat like Claude. Generate to reveal it, then rotate any time to issue a fresh key and permanently invalidate the old one.
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
            <p className="text-green-700 text-sm mb-2 font-medium">{apiKeyIsRotated ? '✅ API Key Rotated — previous key is now invalid' : '✅ API Key'}</p>
            <p className="text-red-700 text-xs font-medium">⚠️ Save this key now — you won&apos;t see it again!</p>
          </div>
          <div className="flex items-center gap-2 p-3 bg-nova-surface-2 border border-nova-border rounded-lg">
            <code className="text-nova-text text-xs font-mono flex-1 truncate">{apiKey}</code>
            <button type="button" onClick={onCopy} className="text-gray-400 hover:text-purple-300 transition-colors p-1 rounded hover:bg-gray-700/50" title="Copy API key">
              {apiKeyCopied ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400"><polyline points="20 6 9 17 4 12" /></svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              )}
            </button>
          </div>
          <div className="mt-3">
            {rotateConfirm ? (
              <div className="p-3 bg-red-500/10 border border-red-500/40 rounded-lg">
                <p className="text-red-200 text-xs mb-2">
                  Rotating invalidates the key above. Any agent using it will stop working until you give it the new key. Continue?
                </p>
                <div className="flex gap-2">
                  <Button type="button" onClick={onRotate} disabled={rotateLoading} className="flex-1 bg-red-600 hover:bg-red-700 text-white" style={{ fontSize: '14px', padding: '8px 16px' }}>
                    {rotateLoading ? 'Rotating…' : 'Yes, rotate key'}
                  </Button>
                  <Button type="button" onClick={() => setRotateConfirm(false)} disabled={rotateLoading} className="flex-1 bg-gray-600 hover:bg-gray-700 text-white" style={{ fontSize: '14px', padding: '8px 16px' }}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setRotateConfirm(true)} className="text-xs text-gray-400 hover:text-red-300 underline">
                Rotate this key
              </button>
            )}
          </div>
        </div>
      ) : (
        <Button type="button" onClick={onGenerate} disabled={apiKeyLoading || !accountId} className="w-full bg-blue-600 hover:bg-blue-700 text-white" style={{ fontSize: '16px', padding: '12px 24px' }}>
          {apiKeyLoading ? (
            <span className="flex items-center justify-center"><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />Generating...</span>
          ) : ('🔑 Generate API Key')}
        </Button>
      )}
    </div>
  );
}

// ── AccountControls ─────────────────────────────────────────────────────────

interface AccountControlsProps {
  accountId: string;
}

export default function AccountControls({ accountId }: AccountControlsProps) {
  const [amount] = useState('10.00');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // Standalone PingPay completion - inline confirmation instead.
  const [fundedAmount, setFundedAmount] = useState<string | null>(null);
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [faucetSuccess, setFaucetSuccess] = useState('');
  const [copied, setCopied] = useState(false);
  const [balanceNear, setBalanceNear] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [balanceError, setBalanceError] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyLoading, setApiKeyLoading] = useState(false);
  const [apiKeyError, setApiKeyError] = useState('');
  const [apiKeyCopied, setApiKeyCopied] = useState(false);
  const [rotateLoading, setRotateLoading] = useState(false);
  const [rotateConfirm, setRotateConfirm] = useState(false);
  const [apiKeyIsRotated, setApiKeyIsRotated] = useState(false);

  const isTestnet = process.env.NEXT_PUBLIC_NEAR_NETWORK !== 'mainnet';

  const loadBalance = useCallback(() => {
    setBalanceLoading(true);
    setBalanceError(false);
    fetch('/api/nova/balance', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => { setBalanceNear(d.balance_near ?? null); setBalanceLoading(false); })
      .catch(() => { setBalanceError(true); setBalanceLoading(false); });
  }, []);

  useEffect(() => { loadBalance(); }, [loadBalance]);

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
          appFees: {
            feePercentage: 0,
            feeAddress: accountId,
          },
          onPopupReady: () => console.log('PingPay: Popup is ready'),
          onProcessComplete: (result: unknown) => {
            console.log('PingPay: Process complete', result);
            const data = (result as { data?: { depositAddress?: string; amount?: string } })?.data;
            setFundedAmount(data?.amount || amount);
            setIsLoading(false);
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

  const copyToClipboard = async () => {
    if (!accountId) return;
    try {
      await navigator.clipboard.writeText(accountId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

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
        body: JSON.stringify({}),
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

  const rotateApiKey = async () => {
    if (!accountId) {
      setApiKeyError('No account connected');
      return;
    }
    setRotateLoading(true);
    setApiKeyError('');
    try {
      const response = await fetch('/api/auth/rotate-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to rotate API key');
      }
      setApiKey(data.api_key);
      setApiKeyIsRotated(true);
      setRotateConfirm(false);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error('API key rotation failed:', errMsg);
      setApiKeyError(errMsg);
    } finally {
      setRotateLoading(false);
    }
  };

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 0' }}>
      <div style={{ width: '100%', maxWidth: '540px' }}>
        <Identity
          accountId={accountId}
          copied={copied}
          onCopy={copyToClipboard}
          balanceNear={balanceNear}
          balanceLoading={balanceLoading}
          balanceError={balanceError}
          onRetryBalance={loadBalance}
        />

        <FundingSection
          isTestnet={isTestnet}
          accountId={accountId}
          error={error}
          faucetLoading={faucetLoading}
          faucetSuccess={faucetSuccess}
          onRequestFaucet={requestFaucetTokens}
          isLoading={isLoading}
          fundedAmount={fundedAmount}
          onStartOnramp={handleStartOnramp}
        />

        <ApiKeySection
          accountId={accountId}
          apiKey={apiKey}
          apiKeyLoading={apiKeyLoading}
          apiKeyError={apiKeyError}
          apiKeyCopied={apiKeyCopied}
          rotateLoading={rotateLoading}
          rotateConfirm={rotateConfirm}
          apiKeyIsRotated={apiKeyIsRotated}
          onGenerate={generateApiKey}
          onRotate={rotateApiKey}
          onCopy={copyApiKey}
          setRotateConfirm={setRotateConfirm}
        />
      </div>
    </div>
  );
}