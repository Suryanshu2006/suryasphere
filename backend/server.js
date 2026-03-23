require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('./models/User');
const Message = require('./models/Message');

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
    /^http:\/\/localhost:\d+$/,
    /^http:\/\/127\.0\.0\.1:\d+$/
];

const corsOptions = {
    origin(origin, callback) {
        if (!origin || allowedOrigins.some((pattern) => pattern.test(origin))) {
            return callback(null, true);
        }

        return callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    methods: ['GET', 'POST', 'DELETE']
};

const io = new Server(server, { cors: corsOptions });

app.use(cors(corsOptions));
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB connected for Suryasphere'))
    .catch((error) => console.log(error));

const waitingUsers = [];
const activeSessions = new Map();

const createToken = (user) => jwt.sign(
    { id: user._id.toString(), username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
);

const normalizeUser = (user) => ({
    id: user._id.toString(),
    username: user.username
});

const removeFromWaitingQueue = (userId) => {
    const index = waitingUsers.indexOf(userId);
    if (index !== -1) {
        waitingUsers.splice(index, 1);
    }
};

const isUserOnline = (userId) => io.sockets.adapter.rooms.has(userId);

const getFriendState = (userDoc, otherUserId) => {
    const id = otherUserId.toString();

    if (userDoc.friends.some((friendId) => friendId.toString() === id)) {
        return 'friends';
    }

    if (userDoc.outgoingFriendRequests.some((friendId) => friendId.toString() === id)) {
        return 'requested';
    }

    if (userDoc.incomingFriendRequests.some((friendId) => friendId.toString() === id)) {
        return 'incoming';
    }

    return 'none';
};

const areFriends = async (userId, otherUserId) => {
    const match = await User.exists({ _id: userId, friends: otherUserId });
    return Boolean(match);
};

const canUsersMessage = async (userId, otherUserId) => {
    if (activeSessions.get(userId) === otherUserId.toString()) {
        return true;
    }

    return areFriends(userId, otherUserId);
};

const emitUsersUpdated = () => {
    io.emit('users_updated');
};

const emitMessageStatus = (message) => {
    io.to(message.sender.toString()).emit('message_status_update', {
        messageId: message._id.toString(),
        delivered: Boolean(message.delivered),
        read: Boolean(message.read)
    });
};

const endRandomSession = (userId, reason) => {
    const partnerId = activeSessions.get(userId);

    if (!partnerId) {
        return;
    }

    activeSessions.delete(userId);
    activeSessions.delete(partnerId);

    io.to(userId).emit('random_chat_ended', { reason });
    io.to(partnerId).emit('random_chat_ended', { reason });
};

const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

        if (!token) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id)
            .select('_id username friends outgoingFriendRequests incomingFriendRequests');

        if (!user) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        req.user = user;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

app.post('/api/signup', async (req, res) => {
    try {
        const username = req.body.username?.trim();
        const password = req.body.password;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({ username, password: hashedPassword });
        const token = createToken(user);

        res.status(201).json({
            msg: 'User Created',
            token,
            user: normalizeUser(user)
        });
    } catch (error) {
        res.status(400).json({ error: 'Username exists' });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });

    if (user && await bcrypt.compare(password, user.password)) {
        const token = createToken(user);
        return res.json({
            token,
            user: normalizeUser(user)
        });
    }

    res.status(401).json({ error: 'Invalid Credentials' });
});

app.get('/api/users', authMiddleware, async (req, res) => {
    const friends = await User.find({ _id: { $in: req.user.friends } })
        .select('_id username')
        .sort({ username: 1 });

    const conversations = await Promise.all(friends.map(async (friend) => {
        const [latestMessage, unreadCount] = await Promise.all([
            Message.findOne({
                $or: [
                    { sender: req.user._id, receiver: friend._id },
                    { sender: friend._id, receiver: req.user._id }
                ]
            })
                .sort({ timestamp: -1 })
                .populate('sender', 'username'),
            Message.countDocuments({
                sender: friend._id,
                receiver: req.user._id,
                read: false
            })
        ]);

        return {
            id: friend._id.toString(),
            username: friend.username,
            online: isUserOnline(friend._id.toString()),
            unreadCount,
            lastMessage: latestMessage ? {
                id: latestMessage._id.toString(),
                content: latestMessage.content,
                timestamp: latestMessage.timestamp,
                senderId: latestMessage.sender._id.toString(),
                senderName: latestMessage.sender.username
            } : null
        };
    }));

    conversations.sort((a, b) => {
        const aTime = a.lastMessage ? new Date(a.lastMessage.timestamp).getTime() : 0;
        const bTime = b.lastMessage ? new Date(b.lastMessage.timestamp).getTime() : 0;

        if (bTime !== aTime) {
            return bTime - aTime;
        }

        return a.username.localeCompare(b.username);
    });

    res.json(conversations);
});

app.delete('/api/friends/:friendId', authMiddleware, async (req, res) => {
    const { friendId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(friendId)) {
        return res.status(400).json({ error: 'Invalid friend id' });
    }

    if (!(await areFriends(req.user._id, friendId))) {
        return res.status(404).json({ error: 'Friend not found' });
    }

    await Promise.all([
        User.updateOne(
            { _id: req.user._id },
            {
                $pull: {
                    friends: friendId,
                    outgoingFriendRequests: friendId,
                    incomingFriendRequests: friendId
                }
            }
        ),
        User.updateOne(
            { _id: friendId },
            {
                $pull: {
                    friends: req.user._id,
                    outgoingFriendRequests: req.user._id,
                    incomingFriendRequests: req.user._id
                }
            }
        )
    ]);

    io.to(req.user._id.toString()).to(friendId).emit('friend_removed', {
        userA: req.user._id.toString(),
        userB: friendId
    });
    emitUsersUpdated();

    res.json({ success: true });
});

app.get('/api/messages/:otherUserId', authMiddleware, async (req, res) => {
    const { otherUserId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(otherUserId)) {
        return res.status(400).json({ error: 'Invalid user id' });
    }

    if (!(await areFriends(req.user._id, otherUserId))) {
        return res.status(403).json({ error: 'Only friends can open saved chats' });
    }

    const unreadMessages = await Message.find({
        sender: otherUserId,
        receiver: req.user._id,
        read: false
    });

    if (unreadMessages.length) {
        await Message.updateMany(
            { _id: { $in: unreadMessages.map((message) => message._id) } },
            { $set: { read: true, delivered: true } }
        );

        unreadMessages.forEach((message) => {
            emitMessageStatus({
                ...message.toObject(),
                read: true,
                delivered: true
            });
        });
    }

    const messages = await Message.find({
        $or: [
            { sender: req.user._id, receiver: otherUserId },
            { sender: otherUserId, receiver: req.user._id }
        ]
    })
        .sort({ timestamp: 1 })
        .populate('sender', 'username')
        .populate('receiver', 'username');

    res.json(messages.map((message) => ({
        id: message._id.toString(),
        content: message.content,
        timestamp: message.timestamp,
        delivered: Boolean(message.delivered),
        read: Boolean(message.read),
        sender: {
            id: message.sender._id.toString(),
            username: message.sender.username
        },
        receiver: {
            id: message.receiver._id.toString(),
            username: message.receiver.username
        }
    })));
});

app.delete('/api/messages/:messageId', authMiddleware, async (req, res) => {
    const { messageId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
        return res.status(400).json({ error: 'Invalid message id' });
    }

    const message = await Message.findById(messageId);

    if (!message) {
        return res.status(404).json({ error: 'Message not found' });
    }

    const allowed = await canUsersMessage(req.user._id.toString(), message.receiver.toString());
    if (!allowed || message.sender.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: 'You can only delete your own messages' });
    }

    await Message.deleteOne({ _id: messageId });

    io.to(message.sender.toString()).to(message.receiver.toString()).emit('message_deleted', {
        messageId: messageId.toString(),
        senderId: message.sender.toString(),
        receiverId: message.receiver.toString()
    });
    emitUsersUpdated();

    res.json({ success: true });
});

app.delete('/api/messages/conversation/:otherUserId', authMiddleware, async (req, res) => {
    const { otherUserId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(otherUserId)) {
        return res.status(400).json({ error: 'Invalid user id' });
    }

    if (!(await canUsersMessage(req.user._id.toString(), otherUserId))) {
        return res.status(403).json({ error: 'Conversation not available' });
    }

    await Message.deleteMany({
        $or: [
            { sender: req.user._id, receiver: otherUserId },
            { sender: otherUserId, receiver: req.user._id }
        ]
    });

    io.to(req.user._id.toString()).to(otherUserId).emit('conversation_cleared', {
        userA: req.user._id.toString(),
        userB: otherUserId
    });
    emitUsersUpdated();

    res.json({ success: true });
});

io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth?.token;

        if (!token) {
            return next(new Error('Authentication required'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id)
            .select('_id username friends outgoingFriendRequests incomingFriendRequests');

        if (!user) {
            return next(new Error('Invalid token'));
        }

        socket.user = normalizeUser(user);
        next();
    } catch (error) {
        next(new Error('Invalid token'));
    }
});

io.on('connection', async (socket) => {
    socket.join(socket.user.id);
    emitUsersUpdated();

    const pendingMessages = await Message.find({
        receiver: socket.user.id,
        delivered: false
    });

    if (pendingMessages.length) {
        await Message.updateMany(
            { _id: { $in: pendingMessages.map((message) => message._id) } },
            { $set: { delivered: true } }
        );

        pendingMessages.forEach((message) => {
            emitMessageStatus({
                ...message.toObject(),
                delivered: true
            });
        });
    }

    socket.on('join_random_chat', async () => {
        const userId = socket.user.id;

        if (activeSessions.has(userId)) {
            return;
        }

        removeFromWaitingQueue(userId);

        const partnerId = waitingUsers.find((candidateId) => candidateId !== userId && isUserOnline(candidateId));

        if (!partnerId) {
            waitingUsers.push(userId);
            socket.emit('random_waiting');
            return;
        }

        removeFromWaitingQueue(partnerId);

        activeSessions.set(userId, partnerId);
        activeSessions.set(partnerId, userId);

        const [currentUser, partnerUser] = await Promise.all([
            User.findById(userId).select('_id username friends outgoingFriendRequests incomingFriendRequests'),
            User.findById(partnerId).select('_id username friends outgoingFriendRequests incomingFriendRequests')
        ]);

        if (!currentUser || !partnerUser) {
            activeSessions.delete(userId);
            activeSessions.delete(partnerId);
            return;
        }

        io.to(userId).emit('random_chat_started', {
            partner: normalizeUser(partnerUser),
            friendState: getFriendState(currentUser, partnerId)
        });

        io.to(partnerId).emit('random_chat_started', {
            partner: normalizeUser(currentUser),
            friendState: getFriendState(partnerUser, userId)
        });
    });

    socket.on('leave_random_chat', () => {
        const userId = socket.user.id;

        if (activeSessions.has(userId)) {
            endRandomSession(userId, 'ended');
        } else {
            removeFromWaitingQueue(userId);
            socket.emit('random_chat_ended', { reason: 'ended' });
        }
    });

    socket.on('add_friend', async ({ targetUserId }) => {
        if (!mongoose.Types.ObjectId.isValid(targetUserId || '')) {
            return;
        }

        const userId = socket.user.id;
        const allowedTarget = activeSessions.get(userId) === targetUserId || await areFriends(userId, targetUserId);
        if (!allowedTarget) {
            return;
        }

        const [currentUser, targetUser] = await Promise.all([
            User.findById(userId).select('_id username friends outgoingFriendRequests incomingFriendRequests'),
            User.findById(targetUserId).select('_id username friends outgoingFriendRequests incomingFriendRequests')
        ]);

        if (!currentUser || !targetUser) {
            return;
        }

        const currentAlreadyFriend = currentUser.friends.some((friendId) => friendId.toString() === targetUserId);
        if (currentAlreadyFriend) {
            io.to(userId).emit('friendship_confirmed', {
                friend: normalizeUser(targetUser)
            });
            return;
        }

        const targetAlreadyRequested = targetUser.outgoingFriendRequests
            .some((friendId) => friendId.toString() === userId);

        if (targetAlreadyRequested) {
            await Promise.all([
                User.updateOne(
                    { _id: userId },
                    {
                        $addToSet: { friends: targetUserId },
                        $pull: {
                            outgoingFriendRequests: targetUserId,
                            incomingFriendRequests: targetUserId
                        }
                    }
                ),
                User.updateOne(
                    { _id: targetUserId },
                    {
                        $addToSet: { friends: userId },
                        $pull: {
                            outgoingFriendRequests: userId,
                            incomingFriendRequests: userId
                        }
                    }
                )
            ]);

            io.to(userId).emit('friendship_confirmed', { friend: normalizeUser(targetUser) });
            io.to(targetUserId).emit('friendship_confirmed', { friend: normalizeUser(currentUser) });
            emitUsersUpdated();
            return;
        }

        await Promise.all([
            User.updateOne(
                { _id: userId },
                { $addToSet: { outgoingFriendRequests: targetUserId } }
            ),
            User.updateOne(
                { _id: targetUserId },
                { $addToSet: { incomingFriendRequests: userId } }
            )
        ]);

        io.to(userId).emit('friend_request_update', {
            targetUserId,
            status: 'requested'
        });
        io.to(targetUserId).emit('friend_request_update', {
            targetUserId: userId,
            status: 'incoming'
        });
    });

    socket.on('send_message', async (data) => {
        const receiverId = data?.receiverId;
        const content = data?.content?.trim();

        if (!receiverId || !content || !mongoose.Types.ObjectId.isValid(receiverId)) {
            return;
        }

        if (!(await canUsersMessage(socket.user.id, receiverId))) {
            socket.emit('chat_error', { error: 'You can only message current random matches or mutual friends.' });
            return;
        }

        const receiver = await User.findById(receiverId).select('_id username');
        if (!receiver) {
            return;
        }

        const delivered = isUserOnline(receiverId);
        const newMessage = await Message.create({
            sender: socket.user.id,
            receiver: receiverId,
            content,
            delivered
        });

        const payload = {
            id: newMessage._id.toString(),
            content: newMessage.content,
            read: newMessage.read,
            delivered: newMessage.delivered,
            timestamp: newMessage.timestamp,
            sender: {
                id: socket.user.id,
                username: socket.user.username
            },
            receiver: {
                id: receiver._id.toString(),
                username: receiver.username
            }
        };

        io.to(socket.user.id).to(receiverId).emit('receive_message', payload);
        emitMessageStatus(newMessage);
        emitUsersUpdated();
    });

    socket.on('disconnect', () => {
        const userId = socket.user.id;

        removeFromWaitingQueue(userId);

        if (activeSessions.has(userId)) {
            endRandomSession(userId, 'partner_left');
        }

        emitUsersUpdated();
    });
});

server.listen(5000, () => console.log('Server running on port 5000'));
