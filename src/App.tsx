import React, { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { Send, User, MessageSquare, LogIn, Check, Smile, Trash2, X, AlertTriangle, Image as ImageIcon, Lock, Plus, Paperclip, MoreVertical, Search, CheckCheck } from "lucide-react";

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
  const [showEmojiPicker, setShowEmojiPicker] = useState<(string | number) | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

  useEffect(() => {
    const newSocket = io({
      transports: ["websocket", "polling"],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
    setSocket(newSocket);

    newSocket.on("connect", () => {
      console.log("Connected to server");
      setErrorMessage(null);
    });

    newSocket.on("connect_error", (err) => {
      console.error("Socket connection error:", err);
      setErrorMessage("Connection lost. Reconnecting...");
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

  // Client-side cleanup fallback
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date().getTime();
      setMessages(prev => prev.filter(msg => {
        const msgTime = new Date(msg.timestamp).getTime();
        return (now - msgTime) < 125000;
      }));
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim() && room.trim()) {
      setIsLoggedIn(true);
      socket?.emit("join-room", { room, pin });
    }
  };

  const switchRoom = (newRoom: string, roomPin: string = "") => {
    if (room === newRoom) return;
    if (socket) {
      socket.emit("leave-room", { room });
      setMessages([]);
      setTypingUsers([]);
      setRoom(newRoom);
      setPin(roomPin);
      socket.emit("join-room", { room: newRoom, pin: roomPin });
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
    if (!socket?.connected) {
      setErrorMessage("Not connected to server. Please wait...");
      return;
    }
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

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-[#111b21] flex flex-col font-sans">
        {/* WhatsApp-style top green bar */}
        <div className="h-56 bg-[#00a884] w-full absolute top-0 left-0 z-0 hidden md:block" />

        <div className="flex-1 flex items-center justify-center p-4 z-10">
          <div className="w-full max-w-4xl bg-[#202c33] rounded shadow-xl flex flex-col md:flex-row overflow-hidden min-h-[500px]">
            {/* Left Info Side */}
            <div className="flex-1 p-10 flex flex-col justify-center bg-[#202c33] border-b md:border-b-0 md:border-r border-[#2a3942]">
               <div className="flex items-center gap-3 mb-8">
                  <div className="w-10 h-10 bg-[#00a884] rounded-full flex items-center justify-center">
                    <MessageSquare className="text-white w-5 h-5" />
                  </div>
                  <h1 className="text-2xl font-normal text-[#e9edef]">WhatsApp Web Clone</h1>
               </div>
               <p className="text-[#8696a0] text-lg mb-6 leading-relaxed">
                 Send and receive messages without keeping your phone online.<br/>
                 Join a room to start ephemeral chatting.
               </p>
            </div>

            {/* Right Login Form */}
            <div className="flex-1 p-10 flex flex-col justify-center bg-[#111b21]">
              <form onSubmit={handleLogin} className="space-y-6">
                {errorMessage && (
                  <div className="bg-[#ef5350]/10 text-[#ef5350] p-3 rounded text-sm flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    {errorMessage}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-[#8696a0] mb-2">Display Name</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Your name"
                    className="w-full bg-[#202c33] text-[#e9edef] border-none rounded py-3 px-4 focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-[#8696a0] mb-2">Room Name</label>
                    <input
                      type="text"
                      value={room}
                      onChange={(e) => setRoom(e.target.value.toLowerCase().replace(/\\s+/g, '-'))}
                      placeholder="e.g. general"
                      className="w-full bg-[#202c33] text-[#e9edef] border-none rounded py-3 px-4 focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#8696a0] mb-2">PIN (Optional)</label>
                    <input
                      type="password"
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      placeholder="Room PIN"
                      className="w-full bg-[#202c33] text-[#e9edef] border-none rounded py-3 px-4 focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full bg-[#00a884] hover:bg-[#008f6f] text-[#111b21] font-medium py-3 rounded transition-colors flex items-center justify-center gap-2 mt-4"
                >
                  <LogIn className="w-5 h-5" />
                  Join Room
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const filteredRooms = activeRooms.filter(r => r.name.includes(searchQuery.toLowerCase()));

  return (
    <div className="h-screen w-full bg-[#111b21] flex overflow-hidden font-sans text-[#e9edef]">

      {/* Left Sidebar */}
      <div className="w-full md:w-[30%] lg:w-[400px] border-r border-[#2a3942] flex flex-col bg-[#111b21]">
        {/* Sidebar Header */}
        <div className="h-[60px] bg-[#202c33] flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 rounded-full bg-[#6a7175] flex items-center justify-center">
               <User className="text-[#d1d7db] w-6 h-6" />
             </div>
             <span className="font-medium">{username}</span>
          </div>
          <div className="flex gap-4 text-[#aebac1]">
            <button className="hover:text-[#e9edef]"><MessageSquare className="w-5 h-5" /></button>
            <button className="hover:text-[#e9edef]"><MoreVertical className="w-5 h-5" /></button>
          </div>
        </div>

        {/* Search */}
        <div className="p-2 border-b border-[#202c33] bg-[#111b21]">
          <div className="bg-[#202c33] rounded-lg flex items-center px-3 py-1.5 gap-3">
            <Search className="w-4 h-4 text-[#8696a0]" />
            <input
              type="text"
              placeholder="Search or start new chat"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-transparent border-none focus:outline-none text-sm w-full text-[#e9edef] placeholder-[#8696a0]"
            />
          </div>
        </div>

        {/* Room List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar bg-[#111b21]">
          {filteredRooms.length === 0 ? (
            <div className="text-center py-10 text-[#8696a0] text-sm">No active rooms found.</div>
          ) : (
            filteredRooms.map(r => (
              <div
                key={r.name}
                onClick={() => switchRoom(r.name)}
                className={`flex items-center px-3 py-3 hover:bg-[#202c33] cursor-pointer ${room === r.name ? 'bg-[#2a3942]' : ''}`}
              >
                <div className="w-12 h-12 rounded-full bg-[#00a884] flex items-center justify-center shrink-0 mr-3 text-xl font-medium">
                  {r.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0 border-b border-[#202c33] pb-3">
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="text-[17px] truncate">{r.name}</span>
                    {r.has_pin && <Lock className="w-3 h-3 text-[#8696a0]" />}
                  </div>
                  <div className="text-sm text-[#8696a0] truncate flex items-center gap-1">
                    {r.name === room ? "Active now" : "Click to join"}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right Chat Area */}
      <div className="flex-1 flex flex-col bg-[#0b141a] relative chat-bg">

        {/* Chat Header */}
        <div className="h-[60px] bg-[#202c33] flex items-center justify-between px-4 shrink-0 z-10">
          <div className="flex items-center gap-3 cursor-pointer">
            <div className="w-10 h-10 rounded-full bg-[#00a884] flex items-center justify-center text-xl font-medium">
               {room.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="font-medium text-[16px]">{room}</div>
              <div className="text-xs text-[#8696a0]">
                {typingUsers.length > 0
                  ? `${typingUsers.join(", ")} typing...`
                  : "tap here for group info"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4 text-[#aebac1]">
            <Search className="w-5 h-5 hover:text-[#e9edef] cursor-pointer" />
            {isAdmin && (
              <button
                onClick={() => setShowClearConfirm(true)}
                title="Clear Chat"
                className="hover:text-[#ef5350] transition-colors"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            )}
            <MoreVertical className="w-5 h-5 hover:text-[#e9edef] cursor-pointer" />
          </div>
        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-2 custom-scrollbar z-0">
          {messages.length === 0 ? (
            <div className="flex justify-center mt-10">
              <div className="bg-[#182229] text-[#8696a0] text-xs py-1.5 px-3 rounded-lg shadow-sm">
                Messages to this group are ephemeral and disappear after a few minutes.
              </div>
            </div>
          ) : (
            messages.map((msg, index) => {
              const isMe = msg.sender === username;
              const showTail = index === 0 || messages[index - 1].sender !== msg.sender;
              const colors = ['#34b7f1', '#ff7a79', '#25d366', '#f0b330', '#a695e7', '#e17055'];
              const senderColor = colors[msg.sender.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length];

              return (
                <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'} group`}>
                  <div
                    className={`relative max-w-[85%] md:max-w-[65%] rounded-lg shadow-sm px-2 pt-1 pb-2 text-[15px] ${
                      isMe ? 'bg-[#005c4b]' : 'bg-[#202c33]'
                    } ${showTail && isMe ? 'rounded-tr-none' : ''} ${showTail && !isMe ? 'rounded-tl-none' : ''}`}
                  >
                    {/* Tail SVG */}
                    {showTail && (
                      <span className={`absolute top-0 w-2 h-3 ${isMe ? '-right-2 text-[#005c4b]' : '-left-2 text-[#202c33]'}`}>
                        <svg viewBox="0 0 8 13" width="8" height="13" className="fill-current">
                          {isMe ? (
                            <path d="M5.188 1H0v11.193l6.467-8.625C7.526 2.156 6.958 1 5.188 1z" />
                          ) : (
                            <path d="M1.533 3.568L8 12.193V1H2.812C1.042 1 .474 2.156 1.533 3.568z" />
                          )}
                        </svg>
                      </span>
                    )}

                    {!isMe && showTail && (
                      <div className="text-[13px] font-medium mb-0.5" style={{ color: senderColor }}>
                        {msg.sender}
                      </div>
                    )}

                    {msg.image_url && (
                      <div className="mt-1 mb-1">
                        <img
                          src={msg.image_url}
                          alt="Shared"
                          className="max-w-full rounded cursor-pointer hover:opacity-95"
                          onClick={() => window.open(msg.image_url, '_blank')}
                        />
                      </div>
                    )}

                    <div className="flex flex-wrap items-end gap-2">
                       <span className="leading-snug break-words">{msg.text}</span>
                       <div className="flex items-center gap-1 ml-auto shrink-0 float-right pt-2 -mb-1">
                         <span className="text-[11px] text-white/60">
                           {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                         </span>
                         {isMe && <CheckCheck className="w-3.5 h-3.5 text-[#53bdeb]" />}
                       </div>
                    </div>

                    {/* Emoji Reaction Button (Hidden until hover) */}
                    <button
                      onClick={() => setShowEmojiPicker(showEmojiPicker === msg.id ? null : msg.id)}
                      className={`absolute top-1 opacity-0 group-hover:opacity-100 p-1 bg-black/20 rounded-full hover:bg-black/40 z-20 transition-opacity ${isMe ? '-left-8' : '-right-8'}`}
                    >
                      <Smile className="w-4 h-4 text-[#aebac1]" />
                    </button>

                    {/* Reactions Display */}
                    {msg.reactions.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1 bg-black/20 rounded-full px-1.5 py-0.5 inline-flex shadow-sm absolute -bottom-3 left-2 border border-[#202c33]">
                        {Object.entries(
                          msg.reactions.reduce((acc, r) => ({ ...acc, [r.emoji]: (acc[r.emoji] || 0) + 1 }), {} as Record<string, number>)
                        ).map(([emoji, count]) => (
                          <div key={emoji} className="flex items-center gap-0.5 text-[11px]" onClick={() => handleReaction(msg.id, emoji)}>
                            <span>{emoji}</span>
                            {(count as number) > 1 && <span className="text-white/80">{String(count)}</span>}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Emoji Picker Dropdown */}
                    {showEmojiPicker === msg.id && (
                      <div className={`absolute bottom-full mb-1 bg-[#202c33] border border-[#2a3942] rounded-full shadow-lg flex px-2 py-1 z-30 ${isMe ? 'right-0' : 'left-0'}`}>
                        {EMOJIS.map(emoji => (
                          <button key={emoji} onClick={() => handleReaction(msg.id, emoji)} className="w-8 h-8 text-xl hover:bg-[#2a3942] rounded-full flex items-center justify-center">
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}

                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} className="h-4" />
        </div>

        {/* Input Area */}
        <div className="min-h-[62px] bg-[#202c33] px-4 py-2 flex items-center gap-3 shrink-0 z-10">
          <div className="flex items-center gap-2 text-[#aebac1]">
             <button className="p-2 hover:bg-[#2a3942] rounded-full transition-colors" onClick={() => setShowEmojiPicker(showEmojiPicker === 'input' ? null : 'input')}>
               <Smile className="w-6 h-6" />
             </button>
             <button className="p-2 hover:bg-[#2a3942] rounded-full transition-colors" onClick={() => fileInputRef.current?.click()}>
               <Plus className="w-6 h-6" />
             </button>
             <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
          </div>

          <form onSubmit={handleSendMessage} className="flex-1 flex items-end">
            <div className="flex-1 bg-[#2a3942] rounded-lg relative">
              <input
                type="text"
                value={message}
                onChange={handleTyping}
                placeholder="Type a message"
                className="w-full bg-transparent text-[#e9edef] px-4 py-3 focus:outline-none text-[15px]"
              />

              {/* Input Emoji Picker */}
              {showEmojiPicker === 'input' && (
                <div className="absolute bottom-full left-0 mb-4 bg-[#202c33] rounded-lg shadow-xl border border-[#2a3942] p-2 flex gap-1 z-50">
                  {EMOJIS.map(emoji => (
                    <button type="button" key={emoji} onClick={() => { setMessage(p => p + emoji); setShowEmojiPicker(null); }} className="w-10 h-10 text-2xl hover:bg-[#2a3942] rounded flex items-center justify-center">
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {message.trim() || isUploading ? (
              <button type="submit" disabled={isUploading} className="ml-3 p-3 bg-[#00a884] text-[#111b21] rounded-full hover:bg-[#008f6f] transition-colors shadow-sm shrink-0">
                <Send className="w-5 h-5 ml-0.5" />
              </button>
            ) : (
               <button type="button" className="ml-3 p-3 text-[#aebac1] hover:bg-[#2a3942] rounded-full transition-colors shrink-0">
                 <svg viewBox="0 0 24 24" width="24" height="24" className="fill-current"><path d="M11.999 14.942c2.005 0 3.625-1.62 3.625-3.625V4.318c0-2.005-1.62-3.625-3.625-3.625S8.374 2.313 8.374 4.318v6.999c0 2.005 1.62 3.625 3.625 3.625zM19.499 11.317c0 4.14-3.36 7.5-7.5 7.5s-7.5-3.36-7.5-7.5h-1.5c0 4.708 3.593 8.591 8.125 9.296v4.385h1.75v-4.385c4.532-.705 8.125-4.588 8.125-9.296h-1.5z"></path></svg>
               </button>
            )}
          </form>
        </div>

      </div>

      {/* Clear Chat Confirm Dialog */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[#3b4a54] p-6 rounded shadow-xl max-w-sm w-full mx-4">
            <h3 className="text-[#e9edef] text-xl mb-4">Clear this chat?</h3>
            <p className="text-[#8696a0] mb-6">Messages will be deleted for everyone in this room.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowClearConfirm(false)} className="px-5 py-2 text-[#00a884] hover:bg-[#2a3942] rounded font-medium transition-colors">Cancel</button>
              <button onClick={handleClearChat} className="px-5 py-2 bg-[#00a884] text-[#111b21] hover:bg-[#008f6f] rounded font-medium transition-colors">Clear chat</button>
            </div>
          </div>
        </div>
      )}

      {/* Image Preview Dialog */}
      {previewImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-[#202c33] rounded-xl max-w-2xl w-full flex flex-col overflow-hidden shadow-2xl">
            <div className="flex justify-between items-center p-4 bg-[#202c33]">
              <div className="flex items-center gap-4">
                <button onClick={() => setPreviewImage(null)} className="text-[#e9edef] hover:text-white"><X className="w-6 h-6" /></button>
                <span className="text-[#e9edef] font-medium text-lg">Send photo</span>
              </div>
            </div>
            <div className="bg-[#111b21] p-4 flex-1 flex items-center justify-center min-h-[300px]">
              <img src={previewImage} alt="Preview" className="max-h-[60vh] max-w-full object-contain" />
            </div>
            <div className="p-4 bg-[#202c33] flex justify-end">
               <button onClick={handleConfirmSendImage} className="w-14 h-14 bg-[#00a884] text-[#111b21] rounded-full flex items-center justify-center hover:bg-[#008f6f] transition-colors shadow-lg">
                 <Send className="w-6 h-6 ml-1" />
               </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
