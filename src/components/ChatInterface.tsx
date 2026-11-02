// src/components/ChatInterface.tsx
'use client';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { Button } from '@/components/ui/button';
import { Send, Paperclip, X, FileIcon, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRef, useState, useCallback, useEffect } from 'react';
import { hashData } from '@/lib/crypto';
import { decodeFile, type FileFormat } from '@/lib/nova-decode';
import { encodeFile } from '@/lib/nova-encode';

interface ChatInterfaceProps {
  accountId: string;
  email: string;
}

interface PrepareUploadResult {
  upload_id: string;
  key: string;
  group_id: string;
  filename: string;
  location?: string;
}

interface PrepareRetrieveResult {
  key: string;
  encrypted_b64: string;
  ipfs_hash: string;
  group_id: string;
  location?: string;
  format?: unknown;
}

export default function ChatInterface({ accountId, email }: ChatInterfaceProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const processingRef = useRef<Set<string>>(new Set()); // toolCallIds already run (W0)
  // Wallet sign-in (no email, same rule as DashboardChrome): self-custodial, so the
  // chat is read-only (writes need the user's wallet signature; see api/chat).
  const walletMode = !email;
  
  const [uploadProgress, setUploadProgress] = useState<{
    status: 'idle' | 'encrypting' | 'uploading' | 'complete' | 'error';
    filename?: string;
    error?: string;
    result?: { cid: string; trans_id: string };
  } | null>(null);

  const [downloadProgress, setDownloadProgress] = useState<{
    status: 'idle' | 'fetching' | 'decrypting' | 'complete' | 'error';
    ipfsHash?: string;
    error?: string;
    result?: { data: ArrayBuffer; mimeType: string; filename: string };
  } | null>(null);

  const { 
    messages, 
    sendMessage,
    status,
    error,
    stop,
    regenerate,
    addToolOutput,
  } = useChat({
    id: `nova-chat-${accountId}`,
    
    transport: new DefaultChatTransport({
      api: '/api/chat',
      fetch: async (url, options = {}) => {
        const headers = new Headers(options.headers);
        headers.set('x-account-id', accountId);
        if (email) headers.set('x-user-email', email);

        const response = await fetch(url, {
          ...options,
          headers,
        });

        return response;
      },
    }),
    
    // Auto-submit when all tool results are available
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    
    // Handle client-side tool execution
    async onToolCall({ toolCall }) {
      if (toolCall.dynamic) {
        console.log('Dynamic tool call:', toolCall.toolName, toolCall.input);
      }
    },
    
    onError: (error) => {
      console.error('Chat error:', error);
    },
    
    onFinish: ({ message }) => {
      console.log('Message finished:', message.id);
      console.log('Message object:', message);
      console.log('Message parts:', message.parts);
      scrollToBottom();
    },
  });

  const readFileAsArrayBuffer = (file: File): Promise<ArrayBuffer> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  };

    // ── W0: client-side file tools ──────────────────────────────────────────────
  // prepare_upload / prepare_retrieve have no server execute (src/lib/chat-tools.ts).
  // The browser fetches the key through /api/nova/prepare-*, encrypts or decrypts
  // locally, and answers the tool call with addToolOutput. The output carries no key
  // and no bytes, so nothing secret enters the chat history or reaches the model.

  type ToolAnswer =
    | { ok: true; output: Record<string, unknown> }
    | { ok: false; errorText: string };

  const answerTool = useCallback(
    (tool: 'prepare_upload' | 'prepare_retrieve', toolCallId: string, a: ToolAnswer) => {
      if (a.ok) {
        void addToolOutput({ tool, toolCallId, output: a.output as never });
      } else {
        void addToolOutput({ tool, toolCallId, state: 'output-error', errorText: a.errorText });
      }
    },
    [addToolOutput],
  );

  const errorFrom = async (res: Response, fallback: string) => {
    const body = await res.json().catch(() => ({}));
    return (body && (body.error || body.detail || body.message)) || `${fallback} (${res.status})`;
  };

  // Upload: prepare (key) → encode v1 + hash plaintext → finalize (bytes + format).
  const runPrepareUpload = useCallback(
    async (input: { group_id?: string; filename?: string }): Promise<ToolAnswer> => {
      if (walletMode) {
        // Wallet uploads are signed by the user's wallet (W3); refuse before any request.
        return { ok: false, errorText: 'Uploads from a wallet account are signed by your wallet and are not available in the chat yet.' };
      }
      const { group_id, filename } = input;
      const file = pendingFiles.find((f) => f.name === filename);
      if (!group_id || !file) {
        return { ok: false, errorText: `File "${filename ?? ''}" is not attached. Attach it and ask again.` };
      }

      setUploadProgress({ status: 'encrypting', filename: file.name });
      try {
        const prepRes = await fetch('/api/nova/prepare-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ group_id, filename: file.name }),
        });
        if (!prepRes.ok) throw new Error(await errorFrom(prepRes, 'Prepare upload failed'));
        const prep = (await prepRes.json()) as PrepareUploadResult;

        const plaintext = await readFileAsArrayBuffer(file);
        const fileHash = await hashData(plaintext);
        const { bytes_b64, format } = await encodeFile(plaintext, prep.key);

        setUploadProgress({ status: 'uploading', filename: file.name });
        const finRes = await fetch('/api/nova/finalize-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ upload_id: prep.upload_id, encrypted_data: bytes_b64, file_hash: fileHash, format }),
        });
        if (!finRes.ok) throw new Error(await errorFrom(finRes, 'Upload failed'));
        const done = (await finRes.json()) as { cid?: string; location?: string; trans_id?: string };

        setUploadProgress({ status: 'complete', filename: file.name });
        setTimeout(() => setUploadProgress(null), 3000);
        setPendingFiles((prev) => prev.filter((f) => f !== file));
        return {
          ok: true,
          output: { status: 'uploaded', filename: file.name, group_id, cid: done.location ?? done.cid, trans_id: done.trans_id, file_hash: fileHash },
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Upload failed';
        setUploadProgress({ status: 'error', filename: file.name, error: message });
        setTimeout(() => setUploadProgress(null), 5000);
        return { ok: false, errorText: message };
      }
    },
    [walletMode, pendingFiles],
  );

  // Retrieve: prepare (key + ciphertext + format) → decodeFile → download.
  const runPrepareRetrieve = useCallback(
    async (input: { group_id?: string; ipfs_hash?: string }): Promise<ToolAnswer> => {
      const { group_id, ipfs_hash } = input;
      if (!group_id || !ipfs_hash) return { ok: false, errorText: 'group_id and ipfs_hash are required' };

      setDownloadProgress({ status: 'fetching', ipfsHash: ipfs_hash });
      try {
        const qs = new URLSearchParams({ group_id, ipfs_hash });
        const res = await fetch(`/api/nova/prepare-retrieve?${qs}`);
        if (!res.ok) throw new Error(await errorFrom(res, 'Retrieve failed'));
        const r = (await res.json()) as PrepareRetrieveResult;

        setDownloadProgress({ status: 'decrypting', ipfsHash: ipfs_hash });
        const plaintext = await decodeFile(r.encrypted_b64, r.key, (r.format ?? null) as FileFormat | null);
        const bytes = new Uint8Array(plaintext);
        const mimeType = detectMimeType(bytes);
        const filename = `file-${ipfs_hash.split('/').pop()!.slice(0, 8)}`;

        const blob = new Blob([bytes], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setDownloadProgress({ status: 'complete', ipfsHash: ipfs_hash });
        setTimeout(() => setDownloadProgress(null), 3000);
        return { ok: true, output: { status: 'downloaded', filename, mime_type: mimeType, size: bytes.length } };
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Decryption failed';
        setDownloadProgress({ status: 'error', ipfsHash: ipfs_hash, error: message });
        setTimeout(() => setDownloadProgress(null), 5000);
        return { ok: false, errorText: message };
      }
    },
    [],
  );

  // Detect MIME type from magic bytes
  const detectMimeType = (data: Uint8Array): string => {
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) return 'image/png';
    if (data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) return 'image/jpeg';
    if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return 'image/gif';
    if (data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) return 'application/pdf';
    if (data[0] === 0x50 && data[1] === 0x4B) return 'application/zip';
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(data.slice(0, 1000));
      return 'text/plain';
    } catch {
      return 'application/octet-stream';
    }
  };

  // Run each client-side tool call exactly once, keyed by its toolCallId. Only
  // static parts (`tool-prepare_*`) in state input-available: a call the server
  // refused (not in activeTools) arrives as a dynamic, errored part and is ignored.
  // Wait until the response stream has ended, so addToolOutput's automatic
  // re-send (sendAutomaticallyWhen) is not skipped.
  useEffect(() => {
    if (status === 'streaming' || status === 'submitted') return;
    for (const message of messages) {
      if (message.role !== 'assistant') continue;
      for (const part of message.parts) {
        const p = part as { type: string; state?: string; toolCallId?: string; input?: unknown };
        if (p.state !== 'input-available' || !p.toolCallId) continue;
        if (p.type !== 'tool-prepare_upload' && p.type !== 'tool-prepare_retrieve') continue;
        if (processingRef.current.has(p.toolCallId)) continue;
        processingRef.current.add(p.toolCallId);

        const toolCallId = p.toolCallId;
        const input = (p.input ?? {}) as Record<string, string>;
        if (p.type === 'tool-prepare_upload') {
          void runPrepareUpload(input).then((a) => answerTool('prepare_upload', toolCallId, a));
        } else {
          void runPrepareRetrieve(input).then((a) => answerTool('prepare_retrieve', toolCallId, a));
        }
      }
    }
  }, [messages, status, runPrepareUpload, runPrepareRetrieve, answerTool]);

  // Auto-scroll to bottom
  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Handle file selection
  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files) return;
    const fileArray = Array.from(files);
    setPendingFiles(prev => [...prev, ...fileArray]);
  }, []);

  // Remove pending file
  const removePendingFile = useCallback((index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Submit message - send file metadata only, not content
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!input.trim() && pendingFiles.length === 0) return;
    if (status !== 'ready') return;

    // Build message text
    let messageText = input.trim();
    
    // Include file metadata (not content)
    if (pendingFiles.length > 0) {
      const fileInfo = pendingFiles.map(f => `${f.name} (${(f.size / 1024).toFixed(1)}KB)`).join(', ');
      messageText = messageText 
        ? `${messageText}\n\n📎 Files to upload: ${fileInfo}`
        : `📎 Please upload: ${fileInfo}`;
    }

    sendMessage({ text: messageText });
    setInput('');
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [input, pendingFiles, sendMessage, status]);

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  // Render message content
  const renderMessageContent = (message: typeof messages[0]) => {
    return message.parts.map((part, index) => {
      switch (part.type) {
        case 'text':
          return (
            <div key={index} className="prose prose-invert prose-sm max-w-none">
              <div className="whitespace-pre-wrap">{part.text}</div>
            </div>
          );

        case 'file':
          if (part.mediaType?.startsWith('image/')) {
            return (
              <div key={index} className="mt-2">
                <img 
                  src={part.url} 
                  alt={part.filename || 'Image'} 
                  className="max-w-xs rounded-lg border border-purple-600/30"
                />
                {part.filename && (
                  <p className="text-xs text-purple-300 mt-1">{part.filename}</p>
                )}
              </div>
            );
          }
          return (
            <div key={index} className="flex items-center gap-2 mt-2 p-2 bg-purple-800/30 rounded-lg">
              <FileIcon size={16} className="text-purple-300" />
              <span className="text-sm text-purple-200">{part.filename || 'File'}</span>
            </div>
          );

        case 'reasoning':
          return (
            <details key={index} className="mt-2 text-xs">
              <summary className="cursor-pointer text-purple-400 hover:text-purple-300">
                💭 Reasoning
              </summary>
              <pre className="mt-1 p-2 bg-purple-950/50 rounded text-purple-300 overflow-x-auto">
                {part.text}
              </pre>
            </details>
          );

        case 'step-start':
          return index > 0 ? (
            <hr key={index} className="my-2 border-purple-700/50" />
          ) : null;

        default: {
          // AI SDK v6 tool parts: `dynamic-tool` or `tool-${name}`.
          const isToolPart =
            part.type === 'dynamic-tool' ||
            (typeof part.type === 'string' && part.type.startsWith('tool-'));
          if (!isToolPart) return null;

          const tp = part as {
            type: string;
            state?: string;
            output?: unknown;
            errorText?: string;
            toolName?: string;
          };
          const toolName =
            tp.toolName ??
            (tp.type.startsWith('tool-') ? tp.type.slice('tool-'.length) : 'tool');

          return (
            <div key={index} className="mt-2 p-3 bg-purple-900/40 rounded-lg border border-purple-700/50">
              <div className="flex items-center gap-2 text-sm font-medium text-purple-200">
                {tp.state === 'input-streaming' || tp.state === 'input-available' ? (
                  <Loader2 size={14} className="animate-spin text-purple-400" />
                ) : tp.state === 'output-available' ? (
                  <CheckCircle size={14} className="text-green-400" />
                ) : tp.state === 'output-error' ? (
                  <AlertCircle size={14} className="text-red-400" />
                ) : null}
                <span>Tool: {toolName}</span>
              </div>

              {tp.state === 'output-available' && toolName !== 'prepare_upload' && toolName !== 'prepare_retrieve' && (
                <div className="mt-2 text-sm text-green-300 overflow-x-auto">
                  <pre className="whitespace-pre-wrap">
                    {typeof tp.output === 'string' ? tp.output : JSON.stringify(tp.output, null, 2)}
                  </pre>
                </div>
              )}

              {tp.state === 'output-error' && (
                <div className="mt-2 text-sm text-red-300">
                  Error: {tp.errorText}
                </div>
              )}
            </div>
          );
        }
      }
    });
  };

  // Get display name from accountId
  const displayName = accountId.split('.')[0];

  return (
    <div 
      className={cn(
        "flex flex-col h-full bg-[#280449]/80 rounded-lg border transition-all duration-200",
        isDragging ? "border-purple-400 border-2 bg-purple-900/30" : "border-purple-600/50"
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-purple-700/50 bg-purple-900/30">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-purple-200">NOVA Chat</h3>
            <p className="text-xs text-purple-400">Logged in as {displayName}</p>
          </div>
          {status === 'streaming' && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => stop()}
              className="text-purple-300 hover:text-white hover:bg-purple-800/50"
            >
              Stop
            </Button>
          )}
        </div>
      </div>

      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <h4 className="text-lg font-medium text-purple-200 mb-2">
              Welcome, {displayName}! 👋
            </h4>
            <p className="text-sm text-purple-400 mb-4">
              I&apos;m NOVA — your secure file-sharing assistant.
            </p>
            <div className="text-left max-w-md mx-auto text-sm text-purple-300 space-y-2">
              <p><strong>What I can do:</strong></p>
              {walletMode ? (
                <>
                  <ul className="list-disc list-inside space-y-1 text-purple-400">
                    <li>👥 List your groups and their members</li>
                    <li>📂 List a group&apos;s files</li>
                    <li>📥 Retrieve and decrypt a file</li>
                  </ul>
                  <p className="mt-3 text-purple-400">
                    You signed in with your own wallet, so NOVA never holds your key. Changes
                    (groups, members, uploads) are signed by your wallet and aren&apos;t available
                    in the chat yet.
                  </p>
                  <p className="mt-4"><strong>Try:</strong></p>
                  <ul className="list-disc list-inside space-y-1 text-purple-400">
                    <li>&quot;What groups am I in?&quot;</li>
                    <li>&quot;Who has access to my group?&quot;</li>
                    <li>&quot;Show the files in that group&quot;</li>
                  </ul>
                </>
              ) : (
                <>
                  <ul className="list-disc list-inside space-y-1 text-purple-400">
                    <li>📤 Upload data with end-to-end encryption</li>
                    <li>👥 Create secure sharing groups</li>
                    <li>🔐 Add/Revoke access permissions</li>
                  </ul>
                  <p className="mt-4"><strong>Try:</strong></p>
                  <ul className="list-disc list-inside space-y-1 text-purple-400">
                    <li>&quot;Create a group called &apos;Team Files&apos;&quot;</li>
                    <li>&quot;Upload this document in that group&quot;</li>
                    <li>&quot;Add user Y as an authorized member&quot;</li>
                  </ul>
                </>
              )}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              'flex',
              message.role === 'user' ? 'justify-end' : 'justify-start'
            )}
          >
            <div
              className={cn(
                'max-w-[85%] px-4 py-3 rounded-2xl shadow-md',
                message.role === 'user'
                  ? 'bg-purple-600 text-white'
                  : 'bg-purple-900/60 text-purple-100 border border-purple-700/50'
              )}
            >
              {renderMessageContent(message)}
            </div>
          </div>
        ))}

        {/* Loading Indicator */}
        {status === 'submitted' && (
          <div className="flex justify-start">
            <div className="bg-purple-900/60 text-purple-200 px-4 py-3 rounded-2xl border border-purple-700/50">
              <div className="flex items-center space-x-2">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-sm">Thinking...</span>
              </div>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="flex justify-center">
            <div className="bg-red-900/60 text-red-200 px-4 py-3 rounded-2xl border border-red-700/50 max-w-md">
              <div className="flex items-start gap-2">
                <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm">{error.message}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => regenerate()}
                    className="mt-2 text-red-300 hover:text-white hover:bg-red-800/50"
                  >
                    Retry
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Drag & Drop Overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-purple-900/80 flex items-center justify-center rounded-lg z-10 pointer-events-none">
          <div className="text-center">
            <FileIcon size={48} className="mx-auto text-purple-300 mb-2" />
            <p className="text-purple-200 font-medium">Drop files to attach</p>
          </div>
        </div>
      )}

      {/* Upload Progress */}
      {uploadProgress && uploadProgress.status !== 'idle' && (
        <div className="mx-4 mb-3 p-3 bg-purple-900/50 rounded-lg border border-purple-600/50">
          <div className="flex items-center gap-2">
            {uploadProgress.status === 'encrypting' && (
              <>
                <Loader2 size={16} className="animate-spin text-purple-400" />
                <span className="text-sm text-purple-200">🔐 Encrypting {uploadProgress.filename}...</span>
              </>
            )}
            {uploadProgress.status === 'uploading' && (
              <>
                <Loader2 size={16} className="animate-spin text-purple-400" />
                <span className="text-sm text-purple-200">📤 Uploading encrypted data...</span>
              </>
            )}
            {uploadProgress.status === 'complete' && (
              <>
                <CheckCircle size={16} className="text-green-400" />
                <span className="text-sm text-green-300">✅ Upload complete!</span>
              </>
            )}
            {uploadProgress.status === 'error' && (
              <>
                <AlertCircle size={16} className="text-red-400" />
                <span className="text-sm text-red-300">❌ {uploadProgress.error}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Download Progress */}
      {downloadProgress && downloadProgress.status !== 'idle' && (
        <div className="mx-4 mb-3 p-3 bg-purple-900/50 rounded-lg border border-purple-600/50">
          <div className="flex items-center gap-2">
            {downloadProgress.status === 'fetching' && (
              <>
                <Loader2 size={16} className="animate-spin text-purple-400" />
                <span className="text-sm text-purple-200">📥 Fetching encrypted data...</span>
              </>
            )}
            {downloadProgress.status === 'decrypting' && (
              <>
                <Loader2 size={16} className="animate-spin text-purple-400" />
                <span className="text-sm text-purple-200">🔓 Decrypting file...</span>
              </>
            )}
            {downloadProgress.status === 'complete' && (
              <>
                <CheckCircle size={16} className="text-green-400" />
                <span className="text-sm text-green-300">✅ File decrypted!</span>
              </>
            )}
            {downloadProgress.status === 'error' && (
              <>
                <AlertCircle size={16} className="text-red-400" />
                <span className="text-sm text-red-300">❌ {downloadProgress.error}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Pending Files Preview */}
      {pendingFiles.length > 0 && (
        <div className="flex-shrink-0 border-t border-purple-700/50 p-3 bg-purple-900/50">
          <div className="flex flex-wrap gap-2">
            {pendingFiles.map((file, i) => (
              <div 
                key={i} 
                className="flex items-center gap-2 bg-purple-800/50 px-3 py-2 rounded-lg text-sm"
              >
                <FileIcon size={14} className="text-purple-300" />
                <span className="text-purple-100 max-w-[150px] truncate">{file.name}</span>
                <span className="text-purple-400 text-xs">
                  ({(file.size / 1024).toFixed(1)}KB)
                </span>
                <button
                  type="button"
                  onClick={() => removePendingFile(i)}
                  className="text-purple-300 hover:text-white transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input Form */}
      <form 
        onSubmit={handleSubmit} 
        className="flex-shrink-0 border-t border-purple-700/50 p-4 bg-purple-900/30"
      >
        <div className="flex items-center gap-3">
          {/* File Attachment Button */}
          <label>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(e) => handleFileSelect(e.target.files)}
              className="hidden"
              accept="*/*"
            />
            <Button 
              type="button" 
              size="icon" 
              variant="ghost" 
              className="text-purple-300 hover:text-white hover:bg-purple-800/50"
              onClick={() => fileInputRef.current?.click()}
              disabled={status !== 'ready' || walletMode}
              title={walletMode ? 'Uploads are signed by your wallet; not available in the chat yet' : undefined}
            >
              <Paperclip size={20} />
            </Button>
          </label>

          {/* Text Input */}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask NOVA to share files securely..."
            className="flex-1 bg-transparent text-white placeholder-purple-400 border border-purple-600/50 rounded-xl px-4 py-3 focus:outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-400/30 transition-all"
            disabled={status !== 'ready'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
          />

          {/* Send Button */}
          <Button
            type="submit"
            size="icon"
            disabled={status !== 'ready' || (!input.trim() && pendingFiles.length === 0)}
            className="bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {status === 'submitted' || status === 'streaming' ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <Send size={20} />
            )}
          </Button>
        </div>
        
        {/* Help Text */}
        <p className="text-xs text-purple-400 mt-2 text-center">
          {isDragging 
            ? '📂 Drop files to attach' 
            : pendingFiles.length > 0 
              ? `${pendingFiles.length} file(s) ready to send`
              : '💡 Drag & drop files or click 📎 to attach'
          }
        </p>
      </form>
    </div>
  );
}