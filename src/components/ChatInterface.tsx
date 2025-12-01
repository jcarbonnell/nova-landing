// src/components/ChatInterface.tsx
'use client';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { Button } from '@/components/ui/button';
import { Send, Paperclip, X, FileIcon, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRef, useState, useCallback, useEffect } from 'react';

interface ChatInterfaceProps {
  accountId: string;
  email: string;
  walletId?: string;
}

export default function ChatInterface({ accountId, email, walletId }: ChatInterfaceProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const { 
    messages, 
    sendMessage, 
    addToolOutput,
    status,
    error,
    stop,
    regenerate,
  } = useChat({
    id: `nova-chat-${accountId}`,
    
    transport: new DefaultChatTransport({
      api: '/api/chat',
      // Custom fetch to inject headers
      fetch: async (url, options = {}) => {
        const headers = new Headers(options.headers);
        headers.set('x-account-id', accountId);

        if (email) headers.set('x-user-email', email);
        if (walletId) headers.set('x-wallet-id', walletId);

        return fetch(url, {
          ...options,
          headers,
        });
      },
    }),
    
    // Auto-submit when all tool results are available
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    
    // Handle client-side tool execution
    async onToolCall({ toolCall }) {
      // Check for dynamic tools first (MCP tools are dynamic)
      if (toolCall.dynamic) {
        console.log('Dynamic tool call:', toolCall.toolName, toolCall.input);
        // MCP tools are server-executed, no client action needed
        return;
      }
      
      // Handle any client-side tools here if needed
      // For NOVA, most tools are server-side MCP tools
    },
    
    onError: (error) => {
      console.error('Chat error:', error);
    },
    
    onFinish: ({ message }) => {
      console.log('Message finished:', message.id);
      scrollToBottom();
    },
  });

  // Auto-scroll to bottom when messages change
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

  // Submit message with files
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!input.trim() && pendingFiles.length === 0) return;
    if (status !== 'ready') return;

    const messageText = input.trim() || `Uploading ${pendingFiles.length} file(s)`;
    
    // Send message with files if any
    if (pendingFiles.length > 0 && fileInputRef.current?.files) {
      // Use the FileList directly from the input element
      sendMessage({
        text: messageText,
        files: fileInputRef.current.files,
      });
    } else if (pendingFiles.length > 0) {
      // Convert File[] to FileUIPart[] format
      const filePromises = pendingFiles.map(async (file): Promise<{
        type: 'file';
        mediaType: string;
        filename: string;
        url: string;
      }> => {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            resolve({
              type: 'file',
              mediaType: file.type || 'application/octet-stream',
              filename: file.name,
              url: reader.result as string,
            });
          };
          reader.readAsDataURL(file);
        });
      });
      
      const fileUIParts = await Promise.all(filePromises);
      sendMessage({
        text: messageText,
        files: fileUIParts,
      });
    } else {
      sendMessage({
        text: messageText,
      });
    }

    // Clear state
    setInput('');
    setPendingFiles([]);
    
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

  // Render message content based on parts
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
          // Render file attachments
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

        // Handle dynamic tools (MCP tools)
        case 'dynamic-tool':
          return (
            <div key={index} className="mt-2 p-3 bg-purple-900/40 rounded-lg border border-purple-700/50">
              <div className="flex items-center gap-2 text-sm font-medium text-purple-200">
                {part.state === 'input-streaming' || part.state === 'input-available' ? (
                  <Loader2 size={14} className="animate-spin text-purple-400" />
                ) : part.state === 'output-available' ? (
                  <CheckCircle size={14} className="text-green-400" />
                ) : part.state === 'output-error' ? (
                  <AlertCircle size={14} className="text-red-400" />
                ) : null}
                <span>Tool: {part.toolName}</span>
              </div>
              
              {part.state === 'input-streaming' && (
                <pre className="mt-2 text-xs text-purple-300 overflow-x-auto">
                  {JSON.stringify(part.input, null, 2)}
                </pre>
              )}
              
              {part.state === 'input-available' && (
                <div className="mt-1 text-xs text-purple-400">
                  Processing...
                </div>
              )}
              
              {part.state === 'output-available' && (
                <div className="mt-2 text-sm text-green-300">
                  {typeof part.output === 'string' 
                    ? part.output 
                    : JSON.stringify(part.output, null, 2)
                  }
                </div>
              )}
              
              {part.state === 'output-error' && (
                <div className="mt-2 text-sm text-red-300">
                  Error: {part.errorText}
                </div>
              )}
            </div>
          );

        default:
          // Handle other tool types generically
          if (part.type.startsWith('tool-')) {
            // Cast to access common tool properties
            const toolPart = part as {
              type: string;
              state?: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
              output?: string | number | boolean | object | null;
              errorText?: string;
            };

            // Safely convert output to string for display
            const outputDisplay = toolPart.output != null
              ? (typeof toolPart.output === 'string' 
                  ? toolPart.output 
                  : JSON.stringify(toolPart.output, null, 2))
              : null;

            return (
              <div key={index} className="mt-2 p-3 bg-purple-900/40 rounded-lg border border-purple-700/50">
                <div className="flex items-center gap-2 text-sm font-medium text-purple-200">
                  {toolPart.state === 'output-available' ? (
                    <CheckCircle size={14} className="text-green-400" />
                  ) : toolPart.state === 'output-error' ? (
                    <AlertCircle size={14} className="text-red-400" />
                  ) : (
                    <Loader2 size={14} className="animate-spin text-purple-400" />
                  )}
                  <span>{part.type.replace('tool-', '')}</span>
                </div>
                {toolPart.state === 'output-available' && outputDisplay && (
                  <div className="mt-2 text-sm text-green-300">
                    {outputDisplay}
                  </div>
                )}
                {toolPart.state === 'output-error' && toolPart.errorText && (
                  <div className="mt-2 text-sm text-red-300">
                    Error: {toolPart.errorText}
                  </div>
                )}
              </div>
            );
          }
          return null;
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
              <ul className="list-disc list-inside space-y-1 text-purple-400">
                <li>📤 Upload files with end-to-end encryption</li>
                <li>👥 Create secure sharing groups</li>
                <li>🔐 Manage access permissions</li>
                <li>📊 Track file analytics</li>
              </ul>
              <p className="mt-4"><strong>Try:</strong></p>
              <ul className="list-disc list-inside space-y-1 text-purple-400">
                <li>&quot;Upload my document securely&quot;</li>
                <li>&quot;Create a group called &apos;Team Files&apos;&quot;</li>
                <li>&quot;Share file X with user Y&quot;</li>
              </ul>
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

        {/* Streaming Indicator */}
        {status === 'streaming' && (
          <div className="flex justify-start">
            <div className="bg-purple-900/40 text-purple-300 px-3 py-1.5 rounded-full text-xs">
              <div className="flex items-center space-x-1.5">
                <div className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-pulse" />
                <span>Streaming...</span>
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
              disabled={status !== 'ready'}
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