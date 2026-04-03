import React, { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { Send, User, Hash, MessageSquare, LogIn, Copy, Check, Smile, Trash2, X, AlertTriangle, Image as ImageIcon, Lock, ShieldCheck, Plus } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface Reaction {
  emoji: string;
  username: string;
}

interface Message {
  id: string | number;
  text?: string;
  image_url?: string;
  sender: string;
  timestamp: string;
  reactions: Reaction[];
}

interface ActiveRoom {
  name: string;
  has_pin: boolean;
}

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [username, setUsername] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [room, setRoom] = useState("");
  const [pin, setPin] = useState("");
  const [activeRooms, setActiveRooms] = useState<ActiveRoom[]>([]);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState<(string | number) | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

    newSocket.on("active-rooms", (rooms: ActiveRoom[]) => {
      setActiveRooms(rooms);
    });

    newSocket.on("room-created", (newRoom: ActiveRoom) => {
      setActiveRooms(prev => [newRoom, ...prev.filter(r => r.name !== newRoom.name)]);
    });

    newSocket.on("error", (err: { message: string }) => {
      setErrorMessage(err.message);
      setTimeout(() => setErrorMessage(null), 5000);
    });

    newSocket.on("admin-status", (status: boolean) => {
      setIsAdmin(status);
    });

    newSocket.on("chat-cleared", () => {
      setMessages([]);
    });

    newSocket.on("image-compressed", (data: { image_url: string }) => {
      setPreviewImage(data.image_url);
      setIsCompressing(false);
    });

    newSocket.on("messages-deleted", (ids: (string | number)[]) => {
      setMessages((prev) => prev.filter((msg) => !ids.includes(msg.id)));
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

  // Client-side cleanup fallback: remove messages older than 2m 5s
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date().getTime();
      setMessages(prev => prev.filter(msg => {
        const msgTime = new Date(msg.timestamp).getTime();
        return (now - msgTime) < 125000; // 2 minutes + 5 seconds buffer
      }));
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim() && room.trim()) {
      setIsLoggedIn(true);
      socket?.emit("join-room", { room, pin });
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
    if ((message.trim() || isUploading) && socket) {
      socket.emit("send-message", {
        text: message,
        sender: username,
        room: room,
      });
      setMessage("");
      socket.emit("stop-typing", { username, room });
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage("Image size must be less than 10MB");
      return;
    }

    setIsCompressing(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      socket?.emit("compress-image", { image_url: base64 });
    };
    reader.readAsDataURL(file);
  };

  const handleConfirmSendImage = () => {
    if (previewImage && socket) {
      setIsUploading(true);
      socket.emit("send-message", {
        image_url: previewImage,
        sender: username,
        room: room,
      });
      setPreviewImage(null);
      setIsUploading(false);
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
          className="w-full max-w-2xl bg-neutral-900 border border-neutral-800 rounded-3xl p-6 sm:p-10 shadow-2xl flex flex-col md:flex-row gap-10"
        >
          <div className="flex-1">
            <div className="flex flex-col items-center md:items-start mb-8">
              <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-blue-900/20">
                <MessageSquare className="text-white w-8 h-8" />
              </div>
              <h1 className="text-3xl font-bold text-white tracking-tight">JogaJog</h1>
              <p className="text-neutral-400 text-sm mt-1">Ephemeral real-time chat.</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              <AnimatePresence>
                {errorMessage && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="bg-red-500/10 border border-red-500/30 text-red-500 p-3 rounded-xl text-xs font-medium flex items-center gap-2"
                  >
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    {errorMessage}
                  </motion.div>
                )}
              </AnimatePresence>

              <div>
                <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2 ml-1">
                  Your Name
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Display name"
                    className="w-full bg-neutral-800 border border-neutral-700 text-white rounded-2xl py-3.5 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2 ml-1">
                    Room Name
                  </label>
                  <div className="relative">
                    <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                    <input
                      type="text"
                      value={room}
                      onChange={(e) => setRoom(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                      placeholder="e.g. secret-base"
                      className="w-full bg-neutral-800 border border-neutral-700 text-white rounded-2xl py-3.5 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-2 ml-1">
                    PIN (Optional)
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
                    <input
                      type="password"
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      placeholder="Room PIN"
                      className="w-full bg-neutral-800 border border-neutral-700 text-white rounded-2xl py-3.5 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all"
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-2xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20 active:scale-[0.98] text-lg"
              >
                <LogIn className="w-5 h-5" />
                Join or Create Room
              </button>
            </form>
          </div>

          <div className="flex flex-col w-full md:w-64 md:border-l border-neutral-800 md:pl-8 mt-6 md:mt-0 pt-6 md:pt-0 border-t md:border-t-0">
            <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-widest mb-4 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-green-500" />
              Active Rooms
            </h3>
            <div className="flex-1 max-h-48 md:max-h-none overflow-y-auto space-y-2 pr-2 custom-scrollbar">
              {activeRooms.length === 0 ? (
                <p className="text-xs text-neutral-600 italic">No active rooms yet.</p>
              ) : (
                activeRooms.map(r => (
                  <button
                    key={r.name}
                    onClick={() => setRoom(r.name)}
                    className="w-full text-left p-3 rounded-xl bg-neutral-800/50 hover:bg-neutral-800 border border-neutral-700/50 hover:border-neutral-600 transition-all group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-neutral-300 group-hover:text-white truncate">#{r.name}</span>
                      {r.has_pin && <Lock className="w-3 h-3 text-neutral-600" />}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col font-sans">
      {/* Header */}
      <header className="h-16 border-b border-neutral-800 bg-neutral-900/50 backdrop-blur-md flex items-center justify-between px-4 sm:px-6 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <MessageSquare className="text-white w-4 h-4" />
          </div>
          <div>
            <h2 className="text-white font-semibold leading-none">JogaJog</h2>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                <span className="text-[10px] text-neutral-400 uppercase tracking-widest font-medium">#{room}</span>
              </div>
              <button 
                onClick={copyRoomCode}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 transition-colors group"
              >
                {copied ? (
                  <Check className="w-2.5 h-2.5 text-green-500" />
                ) : (
                  <Copy className="w-2.5 h-2.5 text-neutral-500 group-hover:text-neutral-300" />
                )}
                <span className="text-[9px] text-neutral-500 group-hover:text-neutral-300 font-medium">
                  {copied ? "Copied!" : "Copy"}
                </span>
              </button>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          {isAdmin && (
            <button
              onClick={() => setShowClearConfirm(true)}
              className="hidden xs:flex items-center gap-2 px-2.5 py-1.5 bg-red-600/10 hover:bg-red-600/20 border border-red-600/30 text-red-500 rounded-lg text-xs font-semibold transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          )}
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="text-right hidden xs:block">
              <p className="text-sm text-white font-medium truncate max-w-[80px]">{username}</p>
              {isAdmin && <p className="text-[9px] text-blue-400 font-bold uppercase tracking-tighter">Admin</p>}
            </div>
            <div className="w-9 h-9 bg-neutral-800 rounded-full flex items-center justify-center border border-neutral-700">
              <User className="text-neutral-400 w-4 h-4" />
            </div>
          </div>
        </div>
      </header>

      {/* Messages Area */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 max-w-4xl mx-auto w-full pb-32 sm:pb-32">
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
              const colors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-yellow-500', 'bg-purple-500', 'bg-pink-500', 'bg-indigo-500', 'bg-cyan-500'];
              const colorIndex = msg.sender.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
              const avatarColor = colors[colorIndex];
              const reactionGroups = msg.reactions.reduce((acc, r) => {
                acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                return acc;
              }, {} as Record<string, number>);

              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  className={`flex items-end gap-2 sm:gap-3 ${isMe ? "flex-row-reverse" : "flex-row"}`}
                >
                  <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex-shrink-0 flex items-center justify-center text-[9px] sm:text-[10px] font-bold text-white shadow-sm border border-white/10 ${isMe ? 'bg-blue-600' : avatarColor}`}>
                    {msg.sender.substring(0, 2).toUpperCase()}
                  </div>

                  <div className={`flex flex-col max-w-[85%] sm:max-w-[65%] ${isMe ? "items-end" : "items-start"}`}>
                    <div className={`flex items-center gap-2 mb-1 px-1 ${isMe ? "flex-row-reverse" : "flex-row"}`}>
                      <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-tight">{isMe ? "You" : msg.sender}</span>
                      <span className="text-[10px] text-neutral-600 font-medium">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>

                    <div className="relative group">
                      <div
                        className={`relative px-3 py-2 sm:px-4 sm:py-2.5 rounded-2xl text-sm shadow-md transition-all hover:shadow-lg overflow-hidden ${
                          isMe
                            ? "bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-tr-none border border-blue-500/30"
                            : "bg-neutral-800 text-neutral-200 rounded-tl-none border border-neutral-700/50"
                        }`}
                      >
                        {msg.image_url ? (
                          <div className="flex flex-col gap-2">
                            <img 
                              src={msg.image_url} 
                              alt="Shared" 
                              className="max-w-full rounded-lg shadow-sm cursor-pointer hover:opacity-90 transition-opacity"
                              referrerPolicy="no-referrer"
                              onClick={() => window.open(msg.image_url, '_blank')}
                            />
                            {msg.text && <p>{msg.text}</p>}
                          </div>
                        ) : (
                          <p>{msg.text}</p>
                        )}
                        <div className={`absolute top-0 w-2 h-2 ${isMe ? "-right-1 bg-blue-600" : "-left-1 bg-neutral-800"}`} 
                             style={{ clipPath: isMe ? 'polygon(0 0, 0 100%, 100% 0)' : 'polygon(0 0, 100% 100%, 100% 0)' }} />
                      </div>

                      <button 
                        onClick={() => setShowEmojiPicker(showEmojiPicker === msg.id ? null : msg.id)}
                        className={`absolute top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 bg-neutral-800 border border-neutral-700 rounded-full hover:bg-neutral-700 z-20 ${isMe ? "-left-10" : "-right-10"}`}
                      >
                        <Smile className="w-3.5 h-3.5 text-neutral-400" />
                      </button>

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

                    {Object.keys(reactionGroups).length > 0 && (
                      <div className={`flex flex-wrap gap-1 mt-1.5 ${isMe ? "justify-end" : "justify-start"}`}>
                        {Object.entries(reactionGroups).map(([emoji, count]) => {
                          const hasReacted = msg.reactions.some(r => r.emoji === emoji && r.username === username);
                          return (
                            <button
                              key={emoji}
                              onClick={() => handleReaction(msg.id, emoji)}
                              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] border transition-all ${
                                hasReacted ? "bg-blue-600/20 border-blue-500/50 text-blue-400" : "bg-neutral-900 border-neutral-800 text-neutral-400 hover:border-neutral-700"
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

      {/* Image Preview / Compression Dialog */}
      <AnimatePresence>
        {previewImage && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="w-full max-w-lg bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white">Preview & Send</h3>
                <button onClick={() => setPreviewImage(null)} className="text-neutral-500 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="relative aspect-video bg-black rounded-xl overflow-hidden mb-6 border border-neutral-800">
                <img 
                  src={previewImage} 
                  alt="Compressed Preview" 
                  className="w-full h-full object-contain"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute top-2 right-2 px-2 py-1 bg-black/50 backdrop-blur-md rounded text-[10px] text-white font-bold uppercase tracking-widest">
                  Compressed (~500KB)
                </div>
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => setPreviewImage(null)} 
                  className="flex-1 px-4 py-3 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-semibold rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleConfirmSendImage} 
                  className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-900/20"
                >
                  Send Image
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
                <button onClick={() => setShowClearConfirm(false)} className="flex-1 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-semibold rounded-xl transition-colors text-sm">Cancel</button>
                <button onClick={handleClearChat} className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white font-semibold rounded-xl transition-colors text-sm">Clear All</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Input Area */}
      <footer className="fixed bottom-0 left-0 right-0 p-3 sm:p-6 border-t border-neutral-800 bg-neutral-900/80 backdrop-blur-lg z-40">
        <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto flex gap-2 sm:gap-3 relative">
          <div className="relative flex-1 flex items-center">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="absolute left-3 text-neutral-500 hover:text-blue-500 transition-colors"
              title="Send Image"
            >
              {isCompressing || isUploading ? (
                <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              ) : (
                <ImageIcon className="w-5 h-5" />
              )}
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageUpload}
              accept="image/*"
              className="hidden"
            />
            <input
              type="text"
              value={message}
              onChange={handleTyping}
              placeholder="Type a message..."
              className="w-full bg-neutral-800 border border-neutral-700 text-white rounded-xl py-3 pl-10 pr-12 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all text-sm"
            />
            <button
              type="button"
              onClick={() => setShowEmojiPicker(showEmojiPicker === 'input' ? null : 'input')}
              className="absolute right-3 text-neutral-500 hover:text-neutral-300 transition-colors"
            >
              <Smile className="w-5 h-5" />
            </button>
            
            <AnimatePresence>
              {showEmojiPicker === 'input' && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8, y: -10 }}
                  animate={{ opacity: 1, scale: 1, y: -20 }}
                  exit={{ opacity: 0, scale: 0.8, y: -10 }}
                  className="absolute bottom-full right-0 mb-4 p-2 bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl flex gap-2 z-50"
                >
                  {EMOJIS.map(emoji => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        setMessage(prev => prev + emoji);
                        setShowEmojiPicker(null);
                      }}
                      className="w-10 h-10 flex items-center justify-center hover:bg-neutral-800 rounded-xl transition-colors text-xl"
                    >
                      {emoji}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <button
            type="submit"
            disabled={!message.trim() && !isUploading}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white w-12 h-12 rounded-xl flex items-center justify-center transition-all shadow-lg shadow-blue-900/20 active:scale-95 flex-shrink-0"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </footer>
    </div>
  );
}
