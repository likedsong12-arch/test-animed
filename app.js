/* ========================================
   WatchTogether - Main Application Logic
   Firebase Auth + YouTube API + Realtime Sync
   ======================================== */

// ========================================
// Global State
// ========================================
let currentUser = {
    uid: '',
    name: '',
    email: '',
    photoURL: '',
    isHost: false
};

let currentRoom = {
    id: '',
    hostId: '',
    videoId: '',
    videoTitle: '',
    isPlaying: false,
    currentTime: 0
};

let player = null;
let isPlayerReady = false;
let isSyncing = false;
let lastSyncTime = 0;
let syncThreshold = 0.5; // Reduced from 2 seconds for tighter sync

// Firebase references
let roomRef = null;
let videoStateRef = null;
let messagesRef = null;
let usersRef = null;
let typingRef = null;

// Typing indicator
let typingTimeout = null;

// ========================================
// Initialization
// ========================================
document.addEventListener('DOMContentLoaded', () => {
    initFloatingHearts();
    initAuthListeners();
    loadYouTubeAPI();
});

// ========================================
// Authentication
// ========================================
function initAuthListeners() {
    // Auth state observer - this runs on page load and detects if user is remembered
    window.firebaseOnAuthStateChanged(window.firebaseAuth, (user) => {
        if (user) {
            // User is signed in (either just now or remembered from previous session)
            currentUser.uid = user.uid;
            currentUser.email = user.email;
            currentUser.name = user.displayName || user.email.split('@')[0];
            currentUser.photoURL = user.photoURL || '';

            showLandingScreen();
        } else {
            // User is signed out, show auth screen
            showAuthScreen();
        }
    });

    // Auth tab switching
    document.getElementById('signInTab').addEventListener('click', () => switchAuthTab('signin'));
    document.getElementById('signUpTab').addEventListener('click', () => switchAuthTab('signup'));

    // Sign In Form
    document.getElementById('signInForm').addEventListener('submit', handleSignIn);

    // Sign Up Form
    document.getElementById('signUpForm').addEventListener('submit', handleSignUp);

    // Sign Out
    document.getElementById('signOutBtn').addEventListener('click', handleSignOut);
}

function switchAuthTab(tab) {
    const signInTab = document.getElementById('signInTab');
    const signUpTab = document.getElementById('signUpTab');
    const signInForm = document.getElementById('signInForm');
    const signUpForm = document.getElementById('signUpForm');

    if (tab === 'signin') {
        signInTab.classList.add('active');
        signUpTab.classList.remove('active');
        signInForm.classList.remove('hidden');
        signUpForm.classList.add('hidden');
    } else {
        signUpTab.classList.add('active');
        signInTab.classList.remove('active');
        signUpForm.classList.remove('hidden');
        signInForm.classList.add('hidden');
    }
}

async function handleSignIn(e) {
    e.preventDefault();

    const email = document.getElementById('signInEmail').value.trim();
    const password = document.getElementById('signInPassword').value;
    const errorEl = document.getElementById('signInError');

    errorEl.classList.add('hidden');

    try {
        await window.firebaseSignIn(window.firebaseAuth, email, password);
        // onAuthStateChanged will handle the redirect
    } catch (error) {
        errorEl.textContent = getAuthErrorMessage(error.code);
        errorEl.classList.remove('hidden');
    }
}

async function handleSignUp(e) {
    e.preventDefault();

    const name = document.getElementById('signUpName').value.trim();
    const email = document.getElementById('signUpEmail').value.trim();
    const password = document.getElementById('signUpPassword').value;
    const confirmPassword = document.getElementById('signUpConfirmPassword').value;
    const errorEl = document.getElementById('signUpError');

    errorEl.classList.add('hidden');

    // Validate passwords match
    if (password !== confirmPassword) {
        errorEl.textContent = 'Passwords do not match';
        errorEl.classList.remove('hidden');
        return;
    }

    try {
        const userCredential = await window.firebaseSignUp(window.firebaseAuth, email, password);

        // Update profile with display name
        await window.firebaseUpdateProfile(userCredential.user, {
            displayName: name
        });

        // Store user profile in database
        const userProfileRef = window.firebaseRef(window.firebaseDB, `users/${userCredential.user.uid}`);
        await window.firebaseSet(userProfileRef, {
            name: name,
            email: email,
            createdAt: Date.now()
        });

        currentUser.name = name;
        // onAuthStateChanged will handle the redirect

    } catch (error) {
        errorEl.textContent = getAuthErrorMessage(error.code);
        errorEl.classList.remove('hidden');
    }
}

async function handleSignOut() {
    try {
        // Leave room if in one
        if (currentRoom.id) {
            await leaveRoom();
        }
        await window.firebaseSignOut(window.firebaseAuth);
    } catch (error) {
        console.error('Sign out error:', error);
        showToast('Failed to sign out', 'error');
    }
}

function getAuthErrorMessage(code) {
    switch (code) {
        case 'auth/email-already-in-use':
            return 'This email is already registered. Try signing in.';
        case 'auth/invalid-email':
            return 'Please enter a valid email address.';
        case 'auth/weak-password':
            return 'Password must be at least 6 characters.';
        case 'auth/user-not-found':
            return 'No account found with this email.';
        case 'auth/wrong-password':
            return 'Incorrect password.';
        case 'auth/invalid-credential':
            return 'Invalid email or password.';
        case 'auth/too-many-requests':
            return 'Too many attempts. Please try again later.';
        default:
            return 'An error occurred. Please try again.';
    }
}

// ========================================
// Screen Management
// ========================================
function showAuthScreen() {
    document.getElementById('authScreen').classList.remove('hidden');
    document.getElementById('landingScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.add('hidden');
}

function showLandingScreen() {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('landingScreen').classList.remove('hidden');
    document.getElementById('appScreen').classList.add('hidden');

    // Update user info display
    document.getElementById('userName').textContent = currentUser.name;
    const avatarEl = document.getElementById('userAvatar');
    if (currentUser.photoURL) {
        avatarEl.src = currentUser.photoURL;
    } else {
        avatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.name)}&background=ff6b9d&color=fff`;
    }

    // Initialize room event listeners
    initRoomListeners();
}

function showAppScreen() {
    document.getElementById('authScreen').classList.add('hidden');
    document.getElementById('landingScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');

    document.getElementById('displayRoomCode').textContent = currentRoom.id;

    // Initialize all app event listeners
    initAppListeners();
}

// ========================================
// Event Listeners
// ========================================
function initRoomListeners() {
    // Create Room
    const createBtn = document.getElementById('createRoomBtn');
    createBtn.replaceWith(createBtn.cloneNode(true)); // Remove old listeners
    document.getElementById('createRoomBtn').addEventListener('click', createRoom);

    // Join Room
    const joinBtn = document.getElementById('joinRoomBtn');
    joinBtn.replaceWith(joinBtn.cloneNode(true));
    document.getElementById('joinRoomBtn').addEventListener('click', joinRoom);

    // Enter key on room code
    const roomCodeInput = document.getElementById('roomCode');
    roomCodeInput.replaceWith(roomCodeInput.cloneNode(true));
    document.getElementById('roomCode').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinRoom();
    });
}

function initAppListeners() {
    // Copy Room Code
    document.getElementById('copyRoomBtn').addEventListener('click', copyRoomCode);

    // Leave Room
    document.getElementById('leaveRoomBtn').addEventListener('click', leaveRoom);

    // Search
    document.getElementById('searchBtn').addEventListener('click', searchVideos);
    document.getElementById('searchInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchVideos();
    });

    // Close Search Results
    document.getElementById('closeResults').addEventListener('click', () => {
        document.getElementById('searchResults').classList.add('hidden');
    });

    // Video Controls
    document.getElementById('playPauseBtn').addEventListener('click', togglePlayPause);
    document.getElementById('muteBtn').addEventListener('click', toggleMute);
    document.getElementById('volumeSlider').addEventListener('input', changeVolume);
    document.getElementById('progressBar').addEventListener('input', seekVideo);

    // Chat
    document.getElementById('sendBtn').addEventListener('click', sendMessage);
    document.getElementById('chatInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    // Typing indicator
    document.getElementById('chatInput').addEventListener('input', handleTyping);

    // Members Panel
    document.getElementById('membersBtn').addEventListener('click', openMembersModal);
    document.getElementById('closeMembersBtn').addEventListener('click', closeMembersModal);
    document.getElementById('copyInviteBtn').addEventListener('click', copyInviteLink);

    // Close modal on backdrop click
    document.getElementById('membersModal').addEventListener('click', (e) => {
        if (e.target.id === 'membersModal') closeMembersModal();
    });
}

// ========================================
// Floating Hearts Animation
// ========================================
function initFloatingHearts() {
    const container = document.getElementById('heartsBg');
    const hearts = ['💕', '💖', '💗', '💓', '💝', '❤️', '💘'];

    function createHeart() {
        const heart = document.createElement('span');
        heart.className = 'floating-heart';
        heart.textContent = hearts[Math.floor(Math.random() * hearts.length)];
        heart.style.left = Math.random() * 100 + '%';
        heart.style.animationDuration = (Math.random() * 4 + 6) + 's';
        heart.style.fontSize = (Math.random() * 15 + 15) + 'px';
        container.appendChild(heart);

        setTimeout(() => heart.remove(), 10000);
    }

    for (let i = 0; i < 5; i++) {
        setTimeout(() => createHeart(), i * 500);
    }

    setInterval(createHeart, 2000);
}

// ========================================
// Room Management
// ========================================
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

async function createRoom() {
    currentUser.isHost = true;
    currentRoom.id = generateRoomCode();
    currentRoom.hostId = currentUser.uid;

    try {
        roomRef = window.firebaseRef(window.firebaseDB, `rooms/${currentRoom.id}`);
        videoStateRef = window.firebaseRef(window.firebaseDB, `rooms/${currentRoom.id}/videoState`);
        messagesRef = window.firebaseRef(window.firebaseDB, `rooms/${currentRoom.id}/messages`);
        usersRef = window.firebaseRef(window.firebaseDB, `rooms/${currentRoom.id}/users`);
        typingRef = window.firebaseRef(window.firebaseDB, `rooms/${currentRoom.id}/typing`);

        await window.firebaseSet(roomRef, {
            createdAt: Date.now(),
            hostId: currentUser.uid,
            users: {
                [currentUser.uid]: {
                    name: currentUser.name,
                    photoURL: currentUser.photoURL,
                    online: true,
                    isHost: true,
                    joinedAt: Date.now()
                }
            },
            videoState: {
                videoId: '',
                videoTitle: '',
                isPlaying: false,
                currentTime: 0,
                lastUpdated: Date.now(),
                updatedBy: currentUser.uid
            }
        });

        // Disconnect cleanup
        const userRef = window.firebaseRef(window.firebaseDB, `rooms/${currentRoom.id}/users/${currentUser.uid}`);
        window.firebaseOnDisconnect(userRef).update({ online: false });

        showAppScreen();
        setupFirebaseListeners();
        showToast('Room created! Share the code with your group 💕', 'success');

    } catch (error) {
        console.error('Error creating room:', error);
        showToast('Failed to create room. Please try again.', 'error');
    }
}

async function joinRoom() {
    const roomCode = document.getElementById('roomCode').value.trim().toUpperCase();

    if (!roomCode) {
        showToast('Please enter a room code', 'error');
        return;
    }

    currentUser.isHost = false;
    currentRoom.id = roomCode;

    try {
        roomRef = window.firebaseRef(window.firebaseDB, `rooms/${currentRoom.id}`);
        const snapshot = await window.firebaseGet(roomRef);

        if (!snapshot.exists()) {
            showToast('Room not found. Please check the code.', 'error');
            return;
        }

        const roomData = snapshot.val();
        currentRoom.hostId = roomData.hostId;

        videoStateRef = window.firebaseRef(window.firebaseDB, `rooms/${currentRoom.id}/videoState`);
        messagesRef = window.firebaseRef(window.firebaseDB, `rooms/${currentRoom.id}/messages`);
        usersRef = window.firebaseRef(window.firebaseDB, `rooms/${currentRoom.id}/users`);
        typingRef = window.firebaseRef(window.firebaseDB, `rooms/${currentRoom.id}/typing`);

        const userRef = window.firebaseRef(window.firebaseDB, `rooms/${currentRoom.id}/users/${currentUser.uid}`);
        await window.firebaseSet(userRef, {
            name: currentUser.name,
            photoURL: currentUser.photoURL,
            online: true,
            isHost: false,
            joinedAt: Date.now()
        });

        window.firebaseOnDisconnect(userRef).update({ online: false });

        showAppScreen();
        setupFirebaseListeners();
        showToast('Joined room! Say hi to everyone 💕', 'success');
        sendSystemMessage(`${currentUser.name} joined the room`);

    } catch (error) {
        console.error('Error joining room:', error);
        showToast('Failed to join room. Please try again.', 'error');
    }
}

async function leaveRoom() {
    if (!currentRoom.id) return;

    try {
        const userRef = window.firebaseRef(window.firebaseDB, `rooms/${currentRoom.id}/users/${currentUser.uid}`);
        await window.firebaseUpdate(userRef, { online: false });

        sendSystemMessage(`${currentUser.name} left the room`);

        // Reset state
        currentRoom = { id: '', hostId: '', videoId: '', videoTitle: '', isPlaying: false, currentTime: 0 };
        roomRef = null;
        videoStateRef = null;
        messagesRef = null;
        usersRef = null;

        showLandingScreen();
        showToast('Left the room', 'info');

    } catch (error) {
        console.error('Error leaving room:', error);
    }
}

function copyRoomCode() {
    navigator.clipboard.writeText(currentRoom.id)
        .then(() => showToast('Room code copied!', 'success'))
        .catch(() => showToast('Failed to copy', 'error'));
}

// ========================================
// Kick User (Host Only)
// ========================================
async function kickUser(userId, userName) {
    if (!currentUser.isHost || userId === currentUser.uid) return;

    try {
        const kickedUserRef = window.firebaseRef(window.firebaseDB, `rooms/${currentRoom.id}/users/${userId}`);
        await window.firebaseUpdate(kickedUserRef, {
            online: false,
            kicked: true
        });

        sendSystemMessage(`${userName} was removed from the room`);
        showToast(`${userName} has been kicked`, 'info');

    } catch (error) {
        console.error('Error kicking user:', error);
        showToast('Failed to kick user', 'error');
    }
}

// ========================================
// Firebase Listeners
// ========================================
function setupFirebaseListeners() {
    // Video state changes - IMMEDIATE sync
    window.firebaseOnValue(videoStateRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;

        // Skip if we triggered this update
        if (isSyncing) return;

        // New video selected
        if (data.videoId && data.videoId !== currentRoom.videoId) {
            currentRoom.videoId = data.videoId;
            currentRoom.videoTitle = data.videoTitle || '';
            document.getElementById('nowPlayingTitle').textContent = data.videoTitle || 'Playing...';

            if (player && isPlayerReady) {
                player.loadVideoById(data.videoId);
                document.getElementById('videoOverlay').classList.add('hidden');
            }
        }

        // Sync play/pause state IMMEDIATELY
        if (player && isPlayerReady && currentRoom.videoId) {
            const playerState = player.getPlayerState();

            if (data.isPlaying && playerState !== YT.PlayerState.PLAYING) {
                player.playVideo();
                updatePlayPauseButton(true);
            } else if (!data.isPlaying && playerState === YT.PlayerState.PLAYING) {
                player.pauseVideo();
                updatePlayPauseButton(false);
            }

            // Sync time if difference is significant
            const currentTime = player.getCurrentTime();
            if (Math.abs(currentTime - data.currentTime) > syncThreshold) {
                player.seekTo(data.currentTime, true);
            }
        }

        currentRoom.isPlaying = data.isPlaying;
        currentRoom.currentTime = data.currentTime;
    });

    // Chat messages
    window.firebaseOnValue(messagesRef, (snapshot) => {
        const messages = snapshot.val();
        if (!messages) return;

        const chatContainer = document.getElementById('chatMessages');
        chatContainer.innerHTML = '<div class="system-message"><span>Welcome! Start chatting with your group 💕</span></div>';

        Object.entries(messages).sort((a, b) => a[1].timestamp - b[1].timestamp).forEach(([key, msg]) => {
            addMessageToUI(msg);
        });

        chatContainer.scrollTop = chatContainer.scrollHeight;
    });

    // User changes
    window.firebaseOnValue(usersRef, (snapshot) => {
        const users = snapshot.val();
        if (!users) return;

        // Store members for panel
        currentMembers = users;

        // Check if current user was kicked
        if (users[currentUser.uid]?.kicked) {
            showToast('You have been removed from the room', 'error');
            leaveRoom();
            return;
        }

        const userList = Object.entries(users);
        const onlineUsers = userList.filter(([id, u]) => u.online && !u.kicked);

        // Update members count
        updateMembersCount(onlineUsers.length);

        // Update header avatars
        updateHeaderAvatars(onlineUsers);
    });

    // Typing indicators
    window.firebaseOnValue(typingRef, (snapshot) => {
        const typing = snapshot.val();
        updateTypingIndicator(typing);
    });
}

function updateHeaderAvatars(onlineUsers) {
    const user1Img = document.getElementById('user1Img');
    const user1Initial = document.getElementById('user1Initial');
    const user2Img = document.getElementById('user2Img');
    const user2Initial = document.getElementById('user2Initial');

    if (onlineUsers.length >= 1) {
        const [, user1] = onlineUsers[0];
        if (user1.photoURL) {
            user1Img.src = user1.photoURL;
            user1Img.style.display = 'block';
            user1Initial.style.display = 'none';
        } else {
            user1Img.style.display = 'none';
            user1Initial.style.display = 'block';
            user1Initial.textContent = user1.name.charAt(0).toUpperCase();
        }
        document.querySelector('#user1Avatar .online-dot').classList.remove('offline');
    }

    if (onlineUsers.length >= 2) {
        const [, user2] = onlineUsers[1];
        if (user2.photoURL) {
            user2Img.src = user2.photoURL;
            user2Img.style.display = 'block';
            user2Initial.style.display = 'none';
        } else {
            user2Img.style.display = 'none';
            user2Initial.style.display = 'block';
            user2Initial.textContent = user2.name.charAt(0).toUpperCase();
        }
        document.querySelector('#user2Avatar .online-dot').classList.remove('offline');
    } else {
        user2Img.style.display = 'none';
        user2Initial.style.display = 'block';
        user2Initial.textContent = '?';
        document.querySelector('#user2Avatar .online-dot').classList.add('offline');
    }
}

// ========================================
// YouTube API
// ========================================
function loadYouTubeAPI() {
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
}

window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player('youtubePlayer', {
        height: '100%',
        width: '100%',
        playerVars: {
            'playsinline': 1,
            'controls': 0,
            'rel': 0,
            'modestbranding': 1
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });
};

function onPlayerReady(event) {
    isPlayerReady = true;
    console.log('YouTube player ready');
    setInterval(updateProgressBar, 1000);
}

function onPlayerStateChange(event) {
    if (!roomRef || isSyncing) return;

    const state = event.data;

    if (state === YT.PlayerState.PLAYING) {
        updatePlayPauseButton(true);
        syncVideoState(true);
    } else if (state === YT.PlayerState.PAUSED) {
        updatePlayPauseButton(false);
        syncVideoState(false);
    }
}

async function syncVideoState(isPlaying) {
    if (!videoStateRef) return;

    // Minimal throttle for near-instant sync
    const now = Date.now();
    if (now - lastSyncTime < 100) return;
    lastSyncTime = now;

    isSyncing = true;

    try {
        await window.firebaseUpdate(videoStateRef, {
            isPlaying: isPlaying,
            currentTime: player ? player.getCurrentTime() : 0,
            lastUpdated: Date.now(),
            updatedBy: currentUser.uid
        });
    } catch (error) {
        console.error('Error syncing video state:', error);
    }

    setTimeout(() => { isSyncing = false; }, 200);
}

// ========================================
// Video Controls
// ========================================
function togglePlayPause() {
    if (!player || !isPlayerReady) return;

    const state = player.getPlayerState();
    if (state === YT.PlayerState.PLAYING) {
        player.pauseVideo();
    } else {
        player.playVideo();
    }
}

function updatePlayPauseButton(isPlaying) {
    const btn = document.getElementById('playPauseBtn');
    btn.innerHTML = isPlaying ? '<span class="pause-icon">⏸</span>' : '<span class="play-icon">▶</span>';
}

function toggleMute() {
    if (!player || !isPlayerReady) return;

    if (player.isMuted()) {
        player.unMute();
        document.getElementById('muteBtn').textContent = '🔊';
    } else {
        player.mute();
        document.getElementById('muteBtn').textContent = '🔇';
    }
}

function changeVolume() {
    if (!player || !isPlayerReady) return;

    const volume = document.getElementById('volumeSlider').value;
    player.setVolume(volume);

    if (volume == 0) {
        player.mute();
        document.getElementById('muteBtn').textContent = '🔇';
    } else {
        player.unMute();
        document.getElementById('muteBtn').textContent = '🔊';
    }
}

async function seekVideo() {
    if (!player || !isPlayerReady) return;

    const progressBar = document.getElementById('progressBar');
    const duration = player.getDuration();
    const seekTime = (progressBar.value / 100) * duration;

    player.seekTo(seekTime, true);

    // Sync seek position immediately
    if (videoStateRef) {
        isSyncing = true;
        await window.firebaseUpdate(videoStateRef, {
            currentTime: seekTime,
            lastUpdated: Date.now(),
            updatedBy: currentUser.uid
        });
        setTimeout(() => { isSyncing = false; }, 200);
    }
}

function updateProgressBar() {
    if (!player || !isPlayerReady) return;

    const currentTime = player.getCurrentTime();
    const duration = player.getDuration();

    if (duration > 0) {
        const progress = (currentTime / duration) * 100;
        document.getElementById('progressBar').value = progress;
        document.getElementById('currentTime').textContent = formatTime(currentTime);
        document.getElementById('totalTime').textContent = formatTime(duration);
    }
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ========================================
// YouTube Search
// ========================================
async function searchVideos() {
    const query = document.getElementById('searchInput').value.trim();

    if (!query) {
        showToast('Please enter a search term', 'error');
        return;
    }

    const resultsContainer = document.getElementById('searchResults');
    const resultsGrid = document.getElementById('resultsGrid');

    resultsContainer.classList.remove('hidden');
    resultsGrid.innerHTML = '<div class="loading"><div class="loading-dots"><span></span><span></span><span></span></div><span>Searching...</span></div>';

    try {
        const response = await fetch(
            `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=12&q=${encodeURIComponent(query)}&type=video&key=${window.YOUTUBE_API_KEY}`
        );

        if (!response.ok) throw new Error('Search failed');

        const data = await response.json();

        if (!data.items || data.items.length === 0) {
            resultsGrid.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 2rem;">No videos found</p>';
            return;
        }

        resultsGrid.innerHTML = '';

        data.items.forEach(item => {
            const videoId = item.id.videoId;
            const title = item.snippet.title;
            const thumbnail = item.snippet.thumbnails.medium.url;
            const channel = item.snippet.channelTitle;

            const resultItem = document.createElement('div');
            resultItem.className = 'result-item';
            resultItem.innerHTML = `
                <div class="result-thumb">
                    <img src="${thumbnail}" alt="${title}">
                </div>
                <div class="result-info">
                    <div class="result-title">${title}</div>
                    <div class="result-channel">${channel}</div>
                </div>
            `;

            resultItem.addEventListener('click', () => selectVideo(videoId, title));
            resultsGrid.appendChild(resultItem);
        });

    } catch (error) {
        console.error('Search error:', error);
        resultsGrid.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 2rem;">Search failed. Please try again.</p>';
    }
}

async function selectVideo(videoId, title) {
    if (!player || !isPlayerReady) {
        showToast('Player not ready. Please wait...', 'error');
        return;
    }

    player.loadVideoById(videoId);
    currentRoom.videoId = videoId;
    currentRoom.videoTitle = title;

    document.getElementById('videoOverlay').classList.add('hidden');
    document.getElementById('nowPlayingTitle').textContent = title;
    document.getElementById('searchResults').classList.add('hidden');

    if (videoStateRef) {
        isSyncing = true;
        await window.firebaseUpdate(videoStateRef, {
            videoId: videoId,
            videoTitle: title,
            isPlaying: true,
            currentTime: 0,
            lastUpdated: Date.now(),
            updatedBy: currentUser.uid
        });
        setTimeout(() => { isSyncing = false; }, 200);
    }

    showToast('Video selected! Enjoy watching together 💕', 'success');
    sendSystemMessage(`Now playing: ${title}`);
}

// ========================================
// Chat System
// ========================================
async function sendMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();

    if (!text || !messagesRef) return;

    input.value = '';
    clearTypingIndicator();

    try {
        await window.firebasePush(messagesRef, {
            senderId: currentUser.uid,
            senderName: currentUser.name,
            senderPhoto: currentUser.photoURL,
            text: text,
            timestamp: Date.now(),
            type: 'user'
        });
    } catch (error) {
        console.error('Error sending message:', error);
        showToast('Failed to send message', 'error');
    }
}

async function sendSystemMessage(text) {
    if (!messagesRef) return;

    try {
        await window.firebasePush(messagesRef, {
            senderId: 'system',
            senderName: 'System',
            text: text,
            timestamp: Date.now(),
            type: 'system'
        });
    } catch (error) {
        console.error('Error sending system message:', error);
    }
}

function addMessageToUI(msg) {
    const chatContainer = document.getElementById('chatMessages');

    if (msg.type === 'system') {
        const systemMsg = document.createElement('div');
        systemMsg.className = 'system-message';
        systemMsg.innerHTML = `<span>${msg.text}</span>`;
        chatContainer.appendChild(systemMsg);
        return;
    }

    const isSent = msg.senderId === currentUser.uid;
    const msgElement = document.createElement('div');
    msgElement.className = `message ${isSent ? 'sent' : 'received'}`;

    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    msgElement.innerHTML = `
        <div class="message-content">${escapeHtml(msg.text)}</div>
        <div class="message-meta">
            <span class="message-sender">${isSent ? 'You' : msg.senderName}</span>
            <span class="message-time">${time}</span>
        </div>
    `;

    chatContainer.appendChild(msgElement);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========================================
// Typing Indicator
// ========================================
async function handleTyping() {
    if (!typingRef) return;

    const myTypingRef = window.firebaseRef(window.firebaseDB, `rooms/${currentRoom.id}/typing/${currentUser.uid}`);

    await window.firebaseSet(myTypingRef, {
        name: currentUser.name,
        timestamp: Date.now()
    });

    // Clear after 3 seconds of no typing
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        clearTypingIndicator();
    }, 3000);
}

async function clearTypingIndicator() {
    if (!currentRoom.id) return;

    const myTypingRef = window.firebaseRef(window.firebaseDB, `rooms/${currentRoom.id}/typing/${currentUser.uid}`);
    await window.firebaseRemove(myTypingRef);
}

function updateTypingIndicator(typing) {
    const indicator = document.getElementById('typingIndicator');

    if (!typing) {
        if (indicator) indicator.classList.add('hidden');
        return;
    }

    const typingUsers = Object.entries(typing)
        .filter(([uid]) => uid !== currentUser.uid)
        .map(([, data]) => data.name);

    if (typingUsers.length === 0) {
        if (indicator) indicator.classList.add('hidden');
        return;
    }

    let text = '';
    if (typingUsers.length === 1) {
        text = `${typingUsers[0]} is typing...`;
    } else if (typingUsers.length === 2) {
        text = `${typingUsers[0]} and ${typingUsers[1]} are typing...`;
    } else {
        text = 'Several people are typing...';
    }

    if (indicator) {
        indicator.textContent = text;
        indicator.classList.remove('hidden');
    }
}

// ========================================
// Toast Notifications
// ========================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ========================================
// Members Panel
// ========================================
let currentMembers = {};

function openMembersModal() {
    const modal = document.getElementById('membersModal');
    modal.classList.remove('hidden');

    // Set invite link
    document.getElementById('inviteLink').value = currentRoom.id;

    // Populate members list
    populateMembersList();
}

function closeMembersModal() {
    document.getElementById('membersModal').classList.add('hidden');
}

function populateMembersList() {
    const membersList = document.getElementById('membersList');
    membersList.innerHTML = '';

    Object.entries(currentMembers).forEach(([uid, member]) => {
        if (!member.online && !member.kicked) return; // Only show online members
        if (member.kicked) return; // Don't show kicked members

        const isHost = uid === currentRoom.hostId;
        const isCurrentUser = uid === currentUser.uid;
        const canKick = currentUser.isHost && !isCurrentUser;

        const memberEl = document.createElement('div');
        memberEl.className = 'member-item';
        memberEl.innerHTML = `
            <div class="member-avatar">
                ${member.photoURL ? `<img src="${member.photoURL}" alt="">` : member.name.charAt(0).toUpperCase()}
            </div>
            <div class="member-info">
                <div class="member-name">
                    ${member.name}${isCurrentUser ? ' (You)' : ''}
                    ${isHost ? '<span class="host-badge">HOST</span>' : ''}
                </div>
                <div class="member-status ${member.online ? 'online' : ''}">
                    ${member.online ? 'Online' : 'Offline'}
                </div>
            </div>
            ${canKick ? `<button class="kick-btn" data-uid="${uid}" data-name="${member.name}">Kick</button>` : ''}
        `;

        membersList.appendChild(memberEl);
    });

    // Add kick button listeners
    membersList.querySelectorAll('.kick-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const uid = e.target.dataset.uid;
            const name = e.target.dataset.name;
            kickUser(uid, name);
        });
    });
}

function updateMembersCount(count) {
    document.getElementById('membersCount').textContent = count;
}

function copyInviteLink() {
    const inviteLink = document.getElementById('inviteLink').value;
    navigator.clipboard.writeText(inviteLink)
        .then(() => showToast('Room code copied!', 'success'))
        .catch(() => showToast('Failed to copy', 'error'));
}
