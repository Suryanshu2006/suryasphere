import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import io from 'socket.io-client';

export default function Chat({ user, setUser }) {
    const [friends, setFriends] = useState([]);
    const [activeChat, setActiveChat] = useState(null);
    const [messages, setMessages] = useState([]);
    const [messageInput, setMessageInput] = useState('');
    const [loadingFriends, setLoadingFriends] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [randomState, setRandomState] = useState({
        status: 'idle',
        partner: null,
        friendState: 'none'
    });
    const [chatError, setChatError] = useState('');

    const socketRef = useRef(null);
    const activeChatRef = useRef(null);
    const scrollRef = useRef(null);

    const authHeaders = {
        headers: {
            Authorization: `Bearer ${user.token}`
        }
    };

    const loadFriends = async () => {
        try {
            setLoadingFriends(true);
            const res = await axios.get('http://localhost:5000/api/users', authHeaders);
            const friendList = res.data.map((friend) => ({ ...friend, mode: 'friend' }));

            setFriends(friendList);
            setActiveChat((current) => {
                if (!current || current.mode !== 'friend') {
                    return current;
                }

                return friendList.find((friend) => friend.id === current.id) || null;
            });
        } catch (error) {
            handleLogout();
        } finally {
            setLoadingFriends(false);
        }
    };

    useEffect(() => {
        activeChatRef.current = activeChat;
    }, [activeChat]);

    useEffect(() => {
        loadFriends();

        const socket = io('http://localhost:5000', {
            auth: { token: user.token }
        });

        socketRef.current = socket;

        socket.on('random_waiting', () => {
            setChatError('');
            setMessages([]);
            setActiveChat(null);
            setRandomState({
                status: 'waiting',
                partner: null,
                friendState: 'none'
            });
        });

        socket.on('random_chat_started', ({ partner, friendState }) => {
            const nextChat = {
                ...partner,
                mode: 'random',
                online: true
            };

            setChatError('');
            setMessages([]);
            setActiveChat(nextChat);
            setRandomState({
                status: 'matched',
                partner: nextChat,
                friendState
            });
        });

        socket.on('random_chat_ended', () => {
            setRandomState({
                status: 'idle',
                partner: null,
                friendState: 'none'
            });

            setActiveChat((current) => (current?.mode === 'random' ? null : current));
            setMessages((current) => (activeChatRef.current?.mode === 'random' ? [] : current));
        });

        socket.on('receive_message', (message) => {
            const currentChat = activeChatRef.current;
            const isCurrentConversation =
                currentChat &&
                (
                    (message.sender.id === currentChat.id && message.receiver.id === user.id) ||
                    (message.sender.id === user.id && message.receiver.id === currentChat.id)
                );

            if (isCurrentConversation) {
                setMessages((prev) => [...prev, message]);
            }

            loadFriends();
        });

        socket.on('message_status_update', ({ messageId, delivered, read }) => {
            setMessages((prev) => prev.map((message) => (
                message.id === messageId
                    ? { ...message, delivered, read }
                    : message
            )));
            loadFriends();
        });

        socket.on('message_deleted', ({ messageId, senderId, receiverId }) => {
            const currentChat = activeChatRef.current;
            const isCurrentConversation =
                currentChat &&
                (
                    (senderId === currentChat.id && receiverId === user.id) ||
                    (senderId === user.id && receiverId === currentChat.id)
                );

            if (isCurrentConversation) {
                setMessages((prev) => prev.filter((message) => message.id !== messageId));
            }

            loadFriends();
        });

        socket.on('conversation_cleared', ({ userA, userB }) => {
            const currentChat = activeChatRef.current;
            const isCurrentConversation =
                currentChat &&
                (
                    (userA === user.id && userB === currentChat.id) ||
                    (userB === user.id && userA === currentChat.id)
                );

            if (isCurrentConversation) {
                setMessages([]);
            }

            loadFriends();
        });

        socket.on('friend_request_update', ({ targetUserId, status }) => {
            setRandomState((prev) => (
                prev.partner?.id === targetUserId
                    ? { ...prev, friendState: status }
                    : prev
            ));
        });

        socket.on('friendship_confirmed', ({ friend }) => {
            setRandomState((prev) => (
                prev.partner?.id === friend.id
                    ? { ...prev, friendState: 'friends' }
                    : prev
            ));
            loadFriends();
        });

        socket.on('friend_removed', ({ userA, userB }) => {
            const currentChat = activeChatRef.current;
            const removedCurrentChat =
                currentChat?.mode === 'friend' &&
                (
                    (userA === user.id && userB === currentChat.id) ||
                    (userB === user.id && userA === currentChat.id)
                );

            if (removedCurrentChat) {
                setActiveChat(null);
                setMessages([]);
            }

            setRandomState((prev) => {
                if (
                    prev.partner &&
                    (
                        (userA === user.id && userB === prev.partner.id) ||
                        (userB === user.id && userA === prev.partner.id)
                    )
                ) {
                    return { ...prev, friendState: 'none' };
                }

                return prev;
            });

            loadFriends();
        });

        socket.on('chat_error', ({ error }) => {
            setChatError(error);
        });

        socket.on('users_updated', loadFriends);
        socket.on('connect_error', handleLogout);

        return () => {
            socket.disconnect();
        };
    }, [user.token, user.id]);

    useEffect(() => {
        if (!activeChat || activeChat.mode !== 'friend') {
            if (activeChat?.mode !== 'random') {
                setMessages([]);
            }
            return;
        }

        const loadMessages = async () => {
            try {
                setLoadingMessages(true);
                const res = await axios.get(
                    `http://localhost:5000/api/messages/${activeChat.id}`,
                    authHeaders
                );
                setMessages(res.data);
                loadFriends();
            } catch (error) {
                setMessages([]);
            } finally {
                setLoadingMessages(false);
            }
        };

        loadMessages();
    }, [activeChat?.id, activeChat?.mode]);

    useEffect(() => {
        scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleLogout = () => {
        localStorage.clear();
        setUser(null);
    };

    const startRandomChat = () => {
        setChatError('');
        setMessages([]);
        setActiveChat(null);
        setRandomState({
            status: 'waiting',
            partner: null,
            friendState: 'none'
        });
        socketRef.current?.emit('join_random_chat');
    };

    const endRandomChat = () => {
        socketRef.current?.emit('leave_random_chat');
    };

    const sendFriendRequest = () => {
        if (!activeChat) {
            return;
        }

        socketRef.current?.emit('add_friend', { targetUserId: activeChat.id });
    };

    const sendMessage = (e) => {
        e.preventDefault();

        if (!messageInput.trim() || !activeChat || !socketRef.current) {
            return;
        }

        socketRef.current.emit('send_message', {
            receiverId: activeChat.id,
            content: messageInput.trim()
        });
        setMessageInput('');
        setChatError('');
    };

    const deleteMessage = async (messageId) => {
        try {
            await axios.delete(`http://localhost:5000/api/messages/${messageId}`, authHeaders);
            setMessages((prev) => prev.filter((message) => message.id !== messageId));
            loadFriends();
        } catch (error) {
            alert(error.response?.data?.error || 'Could not delete message');
        }
    };

    const clearConversation = async () => {
        if (!activeChat || activeChat.mode !== 'friend') {
            return;
        }

        const confirmed = window.confirm(`Clear all messages with ${activeChat.username}?`);
        if (!confirmed) {
            return;
        }

        try {
            await axios.delete(
                `http://localhost:5000/api/messages/conversation/${activeChat.id}`,
                authHeaders
            );
            setMessages([]);
            loadFriends();
        } catch (error) {
            alert(error.response?.data?.error || 'Could not clear this chat');
        }
    };

    const removeFriend = async () => {
        if (!activeChat || activeChat.mode !== 'friend') {
            return;
        }

        const confirmed = window.confirm(`Remove ${activeChat.username} from your friends?`);
        if (!confirmed) {
            return;
        }

        try {
            await axios.delete(`http://localhost:5000/api/friends/${activeChat.id}`, authHeaders);
            setActiveChat(null);
            setMessages([]);
            loadFriends();
        } catch (error) {
            alert(error.response?.data?.error || 'Could not remove friend');
        }
    };

    const getInitials = (name) =>
        name
            .split(' ')
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase())
            .join('');

    const formatMessageTime = (timestamp) =>
        new Date(timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });

    const formatMessageTimestamp = (timestamp) => {
        const date = new Date(timestamp);
        const now = new Date();

        if (date.toDateString() === now.toDateString()) {
            return `Today ${date.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            })}`;
        }

        return date.toLocaleString([], {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    };

    const formatDateDivider = (timestamp) => {
        const date = new Date(timestamp);
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(today.getDate() - 1);

        if (date.toDateString() === today.toDateString()) {
            return 'Today';
        }

        if (date.toDateString() === yesterday.toDateString()) {
            return 'Yesterday';
        }

        return date.toLocaleDateString([], {
            weekday: 'long',
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
    };

    const formatSidebarTime = (timestamp) => {
        if (!timestamp) {
            return '';
        }

        const date = new Date(timestamp);
        const today = new Date();

        if (date.toDateString() === today.toDateString()) {
            return formatMessageTime(timestamp);
        }

        return date.toLocaleDateString([], {
            day: '2-digit',
            month: 'short'
        });
    };

    const getStatusClass = (message) => {
        if (message.read) {
            return 'read';
        }

        if (message.delivered) {
            return 'delivered';
        }

        return 'sent';
    };

    const getFriendButtonLabel = () => {
        if (randomState.friendState === 'friends') {
            return 'Friends';
        }

        if (randomState.friendState === 'requested') {
            return 'Requested';
        }

        if (randomState.friendState === 'incoming') {
            return 'Add Back';
        }

        return 'Add Friend';
    };

    const canRequestFriend = activeChat?.mode === 'random' && randomState.friendState !== 'friends';

    return (
        <div className="chat-page">
            <aside className="sidebar">
                <div className="sidebar-top">
                    <div className="profile-block">
                        <div className="avatar self-avatar">{getInitials(user.username)}</div>
                        <div>
                            <p className="eyebrow">My Account</p>
                            <h2>{user.username}</h2>
                        </div>
                    </div>
                    <button className="ghost-btn" onClick={handleLogout}>Logout</button>
                </div>

                <div className="sidebar-section">
                    <div className="list-header">
                        <p className="section-title">Friends</p>
                        <span className="chat-count">{friends.length}</span>
                    </div>

                    <div className="random-match-box">
                        <button className="match-btn" type="button" onClick={startRandomChat}>
                            {randomState.status === 'waiting' ? 'Finding Stranger...' : 'Start Random Chat'}
                        </button>
                        <p className="random-copy">
                            Match with one random user. After the chat ends, only mutual friends can keep messaging.
                        </p>
                    </div>

                    <div className="user-list-scroll">
                        {loadingFriends ? (
                            <p className="empty-state sidebar-empty">Loading friends...</p>
                        ) : friends.length ? (
                            friends.map((friend) => (
                                <button
                                    key={friend.id}
                                    className={`user-card ${activeChat?.mode === 'friend' && activeChat.id === friend.id ? 'active' : ''}`}
                                    onClick={() => setActiveChat(friend)}
                                >
                                    <div className="user-main">
                                        <div className="avatar">{getInitials(friend.username)}</div>
                                        <div className="user-copy">
                                            <div className="user-row">
                                                <strong>{friend.username}</strong>
                                                <span className="user-time">
                                                    {formatSidebarTime(friend.lastMessage?.timestamp) || (friend.online ? 'Online' : 'Offline')}
                                                </span>
                                            </div>
                                            <div className="user-row secondary">
                                                <span className="message-preview">
                                                    {friend.lastMessage
                                                        ? `${friend.lastMessage.senderId === user.id ? 'You: ' : ''}${friend.lastMessage.content}`
                                                        : 'No saved messages yet'}
                                                </span>
                                                {friend.unreadCount > 0 ? (
                                                    <span className="unread-badge">{friend.unreadCount}</span>
                                                ) : null}
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            ))
                        ) : (
                            <p className="empty-state sidebar-empty">No friends yet. Start a random chat and add each other.</p>
                        )}
                    </div>
                </div>
            </aside>

            <section className="conversation-panel">
                {activeChat ? (
                    <>
                        <header className="conversation-header">
                            <div className="profile-block">
                                <div className="avatar">{getInitials(activeChat.username)}</div>
                                <div>
                                    <p className="eyebrow">{activeChat.mode === 'random' ? 'Random Chat' : 'Friend Chat'}</p>
                                    <h3>{activeChat.username}</h3>
                                </div>
                            </div>

                            <div className="conversation-actions">
                                {activeChat.mode === 'random' ? (
                                    <>
                                        <span className="status-pill online">Temporary Match</span>
                                        <button
                                            className="ghost-btn"
                                            type="button"
                                            onClick={sendFriendRequest}
                                            disabled={!canRequestFriend}
                                        >
                                            {getFriendButtonLabel()}
                                        </button>
                                        <button className="danger-btn" type="button" onClick={endRandomChat}>
                                            End Chat
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <span className={`status-pill ${activeChat.online ? 'online' : ''}`}>
                                            {activeChat.online ? 'Online now' : 'Offline'}
                                        </span>
                                        <button className="ghost-btn" type="button" onClick={removeFriend}>
                                            Remove Friend
                                        </button>
                                        <button className="danger-btn" type="button" onClick={clearConversation}>
                                            Clear Chat
                                        </button>
                                    </>
                                )}
                            </div>
                        </header>

                        <div className="msg-area">
                            {chatError ? <p className="chat-error">{chatError}</p> : null}
                            {loadingMessages ? (
                                <p className="empty-state">Loading messages...</p>
                            ) : messages.length ? (
                                messages.map((message, index) => {
                                    const mine = message.sender.id === user.id;
                                    const currentDate = new Date(message.timestamp).toDateString();
                                    const previousDate = index > 0
                                        ? new Date(messages[index - 1].timestamp).toDateString()
                                        : null;
                                    const showDateDivider = index === 0 || currentDate !== previousDate;

                                    return (
                                        <React.Fragment key={message.id}>
                                            {showDateDivider ? (
                                                <div className="date-divider">
                                                    <span>{formatDateDivider(message.timestamp)}</span>
                                                </div>
                                            ) : null}
                                            <div className={`message-row ${mine ? 'mine' : 'theirs'}`}>
                                                <div
                                                    className={`message-bubble ${mine ? 'mine' : 'theirs'}`}
                                                    title={formatMessageTimestamp(message.timestamp)}
                                                >
                                                    <p>{message.content}</p>
                                                    <div className="message-meta">
                                                        <span>{formatMessageTimestamp(message.timestamp)}</span>
                                                        {mine ? (
                                                            <>
                                                                <span
                                                                    className={`message-status-dot ${getStatusClass(message)}`}
                                                                    title={message.read ? 'Read' : message.delivered ? 'Delivered' : 'Sent'}
                                                                />
                                                                <button
                                                                    type="button"
                                                                    className="message-delete-btn"
                                                                    onClick={() => deleteMessage(message.id)}
                                                                >
                                                                    Delete
                                                                </button>
                                                            </>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            </div>
                                        </React.Fragment>
                                    );
                                })
                            ) : (
                                <p className="empty-state">
                                    {activeChat.mode === 'random'
                                        ? 'Say hi to your random match.'
                                        : `Start the conversation with ${activeChat.username}.`}
                                </p>
                            )}
                            <div ref={scrollRef} />
                        </div>

                        <form className="composer" onSubmit={sendMessage}>
                            <input
                                value={messageInput}
                                onChange={(e) => setMessageInput(e.target.value)}
                                placeholder={`Message ${activeChat.username}`}
                            />
                            <button type="submit">Send</button>
                        </form>
                    </>
                ) : (
                    <div className="blank-chat">
                        <p className="eyebrow">Welcome</p>
                        <h3>Welcome to Suryasphere</h3>
                        {randomState.status === 'waiting' ? (
                            <p className="empty-state">Looking for a random user to match with...</p>
                        ) : (
                            <p className="empty-state">Start a random chat or open a conversation with one of your mutual friends.</p>
                        )}
                    </div>
                )}
            </section>
        </div>
    );
}
