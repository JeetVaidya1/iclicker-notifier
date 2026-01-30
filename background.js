// iClicker Poll Notifier - Background Service Worker

// ============================================
// SESSION TRACKING
// ============================================
let heartbeatInterval = null;
let currentSession = null;

// ============================================
// NOTIFICATION HANDLING
// ============================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'POLL_STARTED') {
    handlePollStarted(message.data, sender.tab);
  } else if (message.type === 'POLL_ENDED') {
    handlePollEnded(message.data);
  } else if (message.type === 'JOIN_CLASS') {
    // User visited a class page - register them with that class
    console.log('[iClicker Notifier] Received JOIN_CLASS message:', message.data);
    joinClass(message.data.courseId);
  } else if (message.type === 'SESSION_ACTIVE') {
    // Content script reports it's on an iClicker page
    handleSessionActive(message.data);
  } else if (message.type === 'SESSION_INACTIVE') {
    // Content script reports leaving iClicker page
    handleSessionInactive();
  } else if (message.type === 'TEST_PUSH') {
    sendPushNotification('🧪 Test notification', 'Push notifications are working!');
    sendResponse({ success: true });
  } else if (message.type === 'TEST_DESKTOP') {
    // Test desktop notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '🧪 Test Notification',
      message: 'Desktop notifications are working!',
      priority: 2
    });
    // Test sound
    playNotificationSound();
    sendResponse({ success: true });
  }
});

// Handle when user is actively on iClicker page
async function handleSessionActive(data) {
  const { courseId, activityId } = data;
  currentSession = { courseId, activityId };

  // Start heartbeat if not already running
  if (!heartbeatInterval) {
    console.log('[iClicker Notifier] Starting session heartbeat');
    sendHeartbeat(); // Send immediately
    heartbeatInterval = setInterval(sendHeartbeat, 5 * 60 * 1000); // Every 5 minutes
  }
}

// Handle when user leaves iClicker page
async function handleSessionInactive() {
  console.log('[iClicker Notifier] Session inactive, stopping heartbeat');

  // Stop heartbeat
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  // Notify backend that session ended
  const settings = await chrome.storage.sync.get(['userToken']);
  if (settings.userToken) {
    try {
      await fetch(`${BACKEND_URL}/leave-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userToken: settings.userToken })
      });
      console.log('[iClicker Notifier] Left session');
    } catch (error) {
      console.error('[iClicker Notifier] Failed to leave session:', error);
    }
  }

  currentSession = null;
}

// Send heartbeat to keep session alive
async function sendHeartbeat() {
  if (!currentSession) return;

  const settings = await chrome.storage.sync.get(['userToken']);
  if (!settings.userToken) return;

  try {
    await fetch(`${BACKEND_URL}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userToken: settings.userToken,
        courseId: currentSession.courseId,
        activityId: currentSession.activityId
      })
    });
    console.log('[iClicker Notifier] Heartbeat sent');
  } catch (error) {
    console.error('[iClicker Notifier] Heartbeat failed:', error);
  }
}

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  // Check if this was an iClicker tab
  try {
    // If we have an active session and the tab closed, leave session
    if (currentSession) {
      handleSessionInactive();
    }
  } catch (error) {
    // Tab might already be gone, that's fine
  }
});

async function handlePollStarted(data, tab) {
  console.log('[iClicker Notifier] Poll started:', data);

  // Get settings
  const settings = await chrome.storage.sync.get([
    'soundEnabled',
    'notificationEnabled',
    'pushEnabled',
    'userToken'
  ]);
  
  const soundEnabled = settings.soundEnabled !== false; // default true
  const notificationEnabled = settings.notificationEnabled !== false; // default true
  const pushEnabled = settings.pushEnabled || false;

  // Show desktop notification
  if (notificationEnabled) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '🔔 iClicker Poll Started!',
      message: 'A new question is live - time to answer!',
      priority: 2,
      requireInteraction: true
    }, (notificationId) => {
      // Store notification ID to clear it later
      chrome.storage.local.set({ lastNotificationId: notificationId });
    });
  }

  // Send push notification to phone (broadcast to all classmates)
  // Prefer activity ID (more specific), fall back to course ID
  if (pushEnabled && (data.activityId || data.courseId)) {
    broadcastNotification(
      '🔔 iClicker Poll Started!',
      'A new question is live - time to answer!',
      data.courseId,
      data.activityId,
      settings
    );
  } else if (pushEnabled) {
    // Fallback to individual notification if no IDs
    sendPushNotification(
      '🔔 iClicker Poll Started!',
      'A new question is live - time to answer!',
      settings
    );
  }

  // Play sound via offscreen document
  if (soundEnabled) {
    playNotificationSound();
  }

  // Update badge
  chrome.action.setBadgeText({ text: 'LIVE', tabId: tab?.id });
  chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
}

// ============================================
// PUSH NOTIFICATION SERVICES
// ============================================

// Backend URL - imported from config or hardcoded as fallback
const BACKEND_URL = 'https://iclicker-notifier.iclicker-notify.workers.dev';

// Join a class for broadcast notifications
async function joinClass(courseId) {
  console.log('[iClicker Notifier] joinClass called with courseId:', courseId);

  const settings = await chrome.storage.sync.get(['userToken']);
  const userToken = settings.userToken;

  console.log('[iClicker Notifier] userToken exists:', !!userToken);

  if (!userToken || !courseId) {
    console.log('[iClicker Notifier] Missing userToken or courseId, skipping join');
    return;
  }

  try {
    console.log('[iClicker Notifier] Calling /join-class API...');
    const response = await fetch(`${BACKEND_URL}/join-class`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userToken, courseId })
    });

    const data = await response.json();
    console.log('[iClicker Notifier] /join-class response:', data);

    if (data.success) {
      console.log('[iClicker Notifier] Joined class:', courseId, 'isNewJoin:', data.isNewJoin);
    } else {
      console.error('[iClicker Notifier] /join-class failed:', data.error);
    }
  } catch (error) {
    console.error('[iClicker Notifier] Failed to join class:', error);
  }
}

// Broadcast notification to all users in a class/activity
async function broadcastNotification(title, message, courseId, activityId, settings = null) {
  if (!settings) {
    settings = await chrome.storage.sync.get(['userToken']);
  }

  const userToken = settings.userToken;

  if (!userToken) {
    console.log('[iClicker Notifier] No user token - Telegram not configured');
    return;
  }

  try {
    console.log('[iClicker Notifier] Broadcasting - course:', courseId, 'activity:', activityId);
    const response = await fetch(`${BACKEND_URL}/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userToken,
        courseId,
        activityId,
        title,
        message
      })
    });

    const data = await response.json();

    if (data.success) {
      console.log('[iClicker Notifier] Broadcast sent to', data.notified, 'users');
    } else {
      console.error('[iClicker Notifier] Broadcast failed:', data.error);
    }
  } catch (error) {
    console.error('[iClicker Notifier] Broadcast failed:', error);
  }
}

// Send notification to just this user (for testing)
async function sendPushNotification(title, message, settings = null) {
  if (!settings) {
    settings = await chrome.storage.sync.get(['userToken']);
  }

  const userToken = settings.userToken;

  if (!userToken) {
    console.log('[iClicker Notifier] No user token - Telegram not configured');
    return;
  }

  try {
    const response = await fetch(`${BACKEND_URL}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userToken,
        title,
        message
      })
    });

    const data = await response.json();

    if (data.success) {
      console.log('[iClicker Notifier] Push notification sent successfully');
    } else {
      console.error('[iClicker Notifier] Push notification failed:', data.error);
    }
  } catch (error) {
    console.error('[iClicker Notifier] Push notification failed:', error);
  }
}

async function handlePollEnded(data) {
  console.log('[iClicker Notifier] Poll ended:', data);

  // Get settings
  const settings = await chrome.storage.sync.get([
    'soundEnabled',
    'notificationEnabled'
  ]);

  const soundEnabled = settings.soundEnabled !== false;
  const notificationEnabled = settings.notificationEnabled !== false;

  // Clear badge
  chrome.action.setBadgeText({ text: '' });

  // Clear the "poll started" notification
  const { lastNotificationId } = await chrome.storage.local.get('lastNotificationId');
  if (lastNotificationId) {
    chrome.notifications.clear(lastNotificationId);
  }

  // Show "poll ended" notification
  if (notificationEnabled) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '⏹️ Poll Ended',
      message: 'The question has closed.',
      priority: 1
    });
  }

  // Play end sound (softer/different tone)
  if (soundEnabled) {
    playEndSound();
  }
}

async function playEndSound() {
  try {
    await setupOffscreenDocument();
    chrome.runtime.sendMessage({ type: 'PLAY_SOUND_END' });
  } catch (e) {
    console.log('[iClicker Notifier] Could not play end sound:', e);
  }
}

// ============================================
// SOUND PLAYBACK (using offscreen document)
// ============================================
let creatingOffscreen = null;

async function playNotificationSound() {
  // For MV3, we need an offscreen document to play audio
  // Alternatively, we can use the Web Audio API in a different way
  // For simplicity, let's try creating a notification with a sound
  
  // Chrome notifications don't support custom sounds well in MV3
  // So we'll use an offscreen document approach
  
  try {
    await setupOffscreenDocument();
    chrome.runtime.sendMessage({ type: 'PLAY_SOUND' });
  } catch (e) {
    console.log('[iClicker Notifier] Could not play sound:', e);
  }
}

async function setupOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  if (existingContexts.length > 0) {
    return;
  }

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Playing notification sound for poll alerts'
  });

  await creatingOffscreen;
  creatingOffscreen = null;
}

// ============================================
// NOTIFICATION CLICK HANDLER
// ============================================
chrome.notifications.onClicked.addListener((notificationId) => {
  // Focus the iClicker tab when notification is clicked
  chrome.tabs.query({ url: ['*://*.iclicker.com/*', '*://*.macmillanlearning.com/*'] }, (tabs) => {
    if (tabs.length > 0) {
      chrome.tabs.update(tabs[0].id, { active: true });
      chrome.windows.update(tabs[0].windowId, { focused: true });
    }
  });
  
  chrome.notifications.clear(notificationId);
});

// ============================================
// INSTALLATION
// ============================================
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Set default settings
    chrome.storage.sync.set({
      enabled: true,
      soundEnabled: true,
      notificationEnabled: true,
      debugMode: false
    });
    
    console.log('[iClicker Notifier] Extension installed with default settings');
  }
});

console.log('[iClicker Notifier] Background service worker loaded');
