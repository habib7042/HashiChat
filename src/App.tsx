import React, { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { Send, User, Hash, MessageSquare, LogIn, Copy, Check, Smile, Trash2, X, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface Reaction {
  emoji: string;
  username: string;
}

interface Message {
  id: string | number;
  text: string;
  sender: string;
  timestamp: string;
  reactions: Reaction[];
}

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [username, setUsername] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [room, setRoom] = useState("general");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState<(string | number) | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

  useEffect(() => {
    const newSocket = io({
      transports: ["polling", "websocket"],
      reconnectionAttempts: 5,
    });
    setSocket(newSocket);

    newSocket.on("connect", () => {
      console.log("Connected to server");
    });

    newSocket.on("connect_error", (err) => {
      console.error("Connection error:", err.message);
    });

    newSocket.on("error", (err: { message: string }) => {
      console.error("Server error:", err.message);
    });

    newSocket.on("admin-status", (status: boolean) => {
      setIsAdmin(status);
    });

    newSocket.on("chat-cleared", () => {
      setMessages([]);
    });

    newSocket.on("message-history", (history: Message[]) => {
      setMessages(history);
    });

    newSocket.on("receive-message", (data: Message) => {
      setMessages((prev) => [...prev, data]);
    });

    newSocket.on("receive-reaction", (data: { messageId: string | number; emoji: string; username: string }) => {
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id === data.messageId) {
            const alreadyReacted = msg.reactions.some(r => r.emoji === data.emoji && r.username === data.username);
            if (alreadyReacted) return msg;
            return { ...msg, reactions: [...msg.reactions, { emoji: data.emoji, username: data.username }] };
          }
          return msg;
        })
      );
    });

    newSocket.on("receive-remove-reaction", (data: { messageId: string | number; emoji: string; username: string }) => {
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id === data.messageId) {
            return { ...msg, reactions: msg.reactions.filter(r => !(r.emoji === data.emoji && r.username === data.username)) };
          }
          return msg;
        })
      );
    });

    newSocket.on("user-typing", (data: { username: string; isTyping: boolean }) => {
      setTypingUsers((prev) => {
        if (data.isTyping) {
          if (prev.includes(data.username)) return prev;
          return [...prev, data.username];
        } else {
          return prev.filter((u) => u !== data.username);
        }
      });
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, typingUsers]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim()) {
      setIsLoggedIn(true);
      socket?.emit("join-room", room);
    }
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessage(e.target.value);

    if (socket) {
      socket.emit("typing", { username, room });

      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit("stop-typing", { username, room });
      }, 2000);
    }
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && socket) {
      socket.emit("send-message", {
        text: message,
        sender: username,
        room: room,
      });
      setMessage("");
      socket.emit("stop-typing", { username, room });
    }
  };

  const handleClearChat = () => {
    if (socket && isAdmin) {
      socket.emit("clear-chat", { room });
      setShowClearConfirm(false);
    }
  };

  const handleReaction = (messageId: string | number, emoji: string) => {
    const msg = messages.find(m => m.id === messageId);
    const hasReacted = msg?.reactions.some(r => r.emoji === emoji && r.username === username);

    if (hasReacted) {
      socket?.emit("remove-reaction", { messageId, emoji, username, room });
    } else {
      socket?.emit("add-reaction", { messageId, emoji, username, room });
    }
    setShowEmojiPicker(null);
  };

  const copyRoomCode = () => {
    navigator.clipboard.writeText(room);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl p-8 shadow-2xl"
        >
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-blue-900/20">
              <MessageSquare className="text-white w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">LiveStream Chat</h1>
            <p className="text-neutral-400 text-sm mt-1">Real-time communication, simplified.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5 ml-1">
                Display Name
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your name..."
                  className="w-full bg-neutral-800 border border-neutral-700 text-white rounded-xl py-3 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1.5 ml-1">
                Chat Code
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                  <input
                    type="text"
                    value={room}
                    onChange={(e) => setRoom(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                    placeholder="e.g. alpha-123"
                    className="w-full bg-neutral-800 border border-neutral-700 text-white rounded-xl py-3 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                    required
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
                    setRoom(code);
                  }}
                  className="bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 px-4 rounded-xl text-xs font-medium transition-colors"
                  title="Generate random code"
                >
                  Generate
                </button>
              </div>
              <p className="text-[10px] text-neutral-600 mt-1.5 ml-1">
                Share this code with others to have them join your private chat.
              </p>
            </div>

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20 active:scale-[0.98]"
            >
              <LogIn className="w-4 h-4" />
              Join Chat
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col font-sans">
      {/* Header */}
      <header className="h-16 border-b border-neutral-800 bg-neutral-900/50 backdrop-blur-md flex items-center justify-between px-6 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <MessageSquare className="text-white w-4 h-4" />
          </div>
          <div>
            <h2 className="text-white font-semibold leading-none">LiveStream Chat</h2>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                <span className="text-[10px] text-neutral-400 uppercase tracking-widest font-medium">#{room}</span>
              </div>
              <button 
                onClick={copyRoomCode}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 transition-colors group"
                title="Copy Chat Code"
              >
                {copied ? (
                  <Check className="w-2.5 h-2.5 text-green-500" />
                ) : (
                  <Copy className="w-2.5 h-2.5 text-neutral-500 group-hover:text-neutral-300" />
                )}
                <span className="text-[9px] text-neutral-500 group-hover:text-neutral-300 font-medium">
                  {copied ? "Copied!" : "Copy Code"}
                </span>
              </button>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {isAdmin && (
            <button
              onClick={() => setShowClearConfirm(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-red-600/10 hover:bg-red-600/20 border border-red-600/30 text-red-500 rounded-lg text-xs font-semibold transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Clear Chat</span>
            </button>
          )}
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-xs text-neutral-400">Logged in as</p>
              <p className="text-sm text-white font-medium">{username} {isAdmin && <span className="text-[10px] text-blue-400 font-bold ml-1">(Admin)</span>}</p>
            </div>
            <div className="w-10 h-10 bg-neutral-800 rounded-full flex items-center justify-center border border-neutral-700">
              <User className="text-neutral-400 w-5 h-5" />
            </div>
          </div>
        </div>
      </header>

      {/* Messages Area */}
      <main className="flex-1 overflow-y-auto p-6 space-y-4 max-w-4xl mx-auto w-full">
        <AnimatePresence initial={false}>
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-neutral-500 py-20">
              <div className="w-16 h-16 bg-neutral-900 rounded-full flex items-center justify-center mb-4 border border-neutral-800">
                <Hash className="w-8 h-8 opacity-20" />
              </div>
              <p className="text-sm">No messages yet. Start the conversation!</p>
            </div>
          ) : (
            messages.map((msg) => {
              const isMe = msg.sender === username;
              // Simple color hash for avatars based on sender name
              const colors = [
                'bg-red-500', 'bg-blue-500', 'bg-green-500', 
                'bg-yellow-500', 'bg-purple-500', 'bg-pink-500', 
                'bg-indigo-500', 'bg-cyan-500'
              ];
              const colorIndex = msg.sender.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
              const avatarColor = colors[colorIndex];

              // Group reactions by emoji
              const reactionGroups = msg.reactions.reduce((acc, r) => {
                acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                return acc;
              }, {} as Record<string, number>);

              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  className={`flex items-end gap-3 ${isMe ? "flex-row-reverse" : "flex-row"}`}
                >
                  {/* Avatar */}
                  <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white shadow-sm border border-white/10 ${isMe ? 'bg-blue-600' : avatarColor}`}>
                    {msg.sender.substring(0, 2).toUpperCase()}
                  </div>

                  <div className={`flex flex-col max-w-[75%] sm:max-w-[65%] ${isMe ? "items-end" : "items-start"}`}>
                    {/* Sender Name & Time */}
                    <div className={`flex items-center gap-2 mb-1 px-1 ${isMe ? "flex-row-reverse" : "flex-row"}`}>
                      <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-tight">
                        {isMe ? "You" : msg.sender}
                      </span>
                      <span className="text-[10px] text-neutral-600 font-medium">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    {/* Message Bubble */}
                    <div className="relative group">
                      <div
                        className={`relative px-4 py-2.5 rounded-2xl text-sm shadow-md transition-all hover:shadow-lg ${
                          isMe
                            ? "bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-tr-none border border-blue-500/30"
                            : "bg-neutral-800 text-neutral-200 rounded-tl-none border border-neutral-700/50"
                        }`}
                      >
                        {msg.text}
                        
                        {/* Tail decoration for bubbles */}
                        <div className={`absolute top-0 w-2 h-2 ${isMe ? "-right-1 bg-blue-600" : "-left-1 bg-neutral-800"}`} 
                             style={{ clipPath: isMe ? 'polygon(0 0, 0 100%, 100% 0)' : 'polygon(0 0, 100% 100%, 100% 0)' }} />
                      </div>

                      {/* Reaction Trigger */}
                      <button 
                        onClick={() => setShowEmojiPicker(showEmojiPicker === msg.id ? null : msg.id)}
                        className={`absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 bg-neutral-800 border border-neutral-700 rounded-full hover:bg-neutral-700 z-20 ${isMe ? "-left-10" : "-right-10"}`}
                      >
                        <Smile className="w-3.5 h-3.5 text-neutral-400" />
                      </button>

                      {/* Emoji Picker */}
                      <AnimatePresence>
                        {showEmojiPicker === msg.id && (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.8, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.8, y: 10 }}
                            className={`absolute bottom-full mb-2 p-1 bg-neutral-900 border border-neutral-800 rounded-full shadow-xl flex gap-1 z-30 ${isMe ? "right-0" : "left-0"}`}
                          >
                            {EMOJIS.map(emoji => (
                              <button
                                key={emoji}
                                onClick={() => handleReaction(msg.id, emoji)}
                                className="w-8 h-8 flex items-center justify-center hover:bg-neutral-800 rounded-full transition-colors text-lg"
                              >
                                {emoji}
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Reactions Display */}
                    {Object.keys(reactionGroups).length > 0 && (
                      <div className={`flex flex-wrap gap-1 mt-1.5 ${isMe ? "justify-end" : "justify-start"}`}>
                        {Object.entries(reactionGroups).map(([emoji, count]) => {
                          const hasReacted = msg.reactions.some(r => r.emoji === emoji && r.username === username);
                          return (
                            <button
                              key={emoji}
                              onClick={() => handleReaction(msg.id, emoji)}
                              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] border transition-all ${
                                hasReacted 
                                  ? "bg-blue-600/20 border-blue-500/50 text-blue-400" 
                                  : "bg-neutral-900 border-neutral-800 text-neutral-400 hover:border-neutral-700"
                              }`}
                            >
                              <span>{emoji}</span>
                              <span className="font-bold">{count}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
        
        {/* Typing Indicator */}
        <AnimatePresence>
          {typingUsers.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 5 }}
              className="flex items-center gap-2 text-neutral-500 text-[10px] font-medium ml-12"
            >
              <div className="flex gap-1">
                <span className="w-1 h-1 bg-neutral-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1 h-1 bg-neutral-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1 h-1 bg-neutral-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span>{typingUsers.join(", ")} {typingUsers.length === 1 ? "is" : "are"} typing...</span>
            </motion.div>
          )}
        </AnimatePresence>
        
        <div ref={messagesEndRef} />
      </main>

      {/* Confirmation Dialog */}
      <AnimatePresence>
        {showClearConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="w-full max-w-sm bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-2xl"
            >
              <div className="flex items-center gap-3 mb-4 text-red-500">
                <div className="w-10 h-10 bg-red-500/10 rounded-full flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-white">Clear Chat History?</h3>
              </div>
              <p className="text-neutral-400 text-sm mb-6 leading-relaxed">
                This will permanently delete all messages in <span className="text-white font-bold">#{room}</span> for everyone. This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="flex-1 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-semibold rounded-xl transition-colors text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleClearChat}
                  className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-xl transition-colors text-sm"
                >
                  Clear All
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Input Area */}
      <footer className="p-4 sm:p-6 border-t border-neutral-800 bg-neutral-900/50 backdrop-blur-md">
        <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto flex gap-3">
          <input
            type="text"
            value={message}
            onChange={handleTyping}
            placeholder="Type a message..."
            className="flex-1 bg-neutral-800 border border-neutral-700 text-white rounded-xl py-3 px-4 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all text-sm"
          />
          <button
            type="submit"
            disabled={!message.trim()}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white w-12 h-12 rounded-xl flex items-center justify-center transition-all shadow-lg shadow-blue-900/20 active:scale-95"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </footer>
    </div>
  );
}
