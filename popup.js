// Popup script for iClicker Notifier

document.addEventListener('DOMContentLoaded', async () => {
  // Toast helper
  function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }

  // Elements
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const notificationsToggle = document.getElementById('notifications-toggle');
  const soundToggle = document.getElementById('sound-toggle');
  const telegramToggle = document.getElementById('telegram-toggle');
  const telegramConfig = document.getElementById('telegram-config');
  const setupStepsContainer = document.getElementById('setup-steps-container');
  const openBotBtn = document.getElementById('open-bot-btn');
  const registrationCode = document.getElementById('registration-code');
  const verifyBtn = document.getElementById('verify-btn');
  const testTelegramBtn = document.getElementById('test-telegram');
  const disconnectBtn = document.getElementById('disconnect-btn');
  const testResult = document.getElementById('test-result');
  const connectedStatus = document.getElementById('connected-status');
  const scanBtn = document.getElementById('scan-btn');
  const testDesktopBtn = document.getElementById('test-desktop-btn');

  // Load settings
  const settings = await chrome.storage.sync.get([
    'notificationEnabled',
    'soundEnabled',
    'pushEnabled',
    'userToken'
  ]);

  notificationsToggle.checked = settings.notificationEnabled !== false;
  soundToggle.checked = settings.soundEnabled !== false;
  telegramToggle.checked = settings.pushEnabled || false;

  // Show/hide Telegram config and connected status
  if (telegramToggle.checked) {
    telegramConfig.classList.remove('hidden');
    if (settings.userToken) {
      showConnectedState();
      document.getElementById('share-section').style.display = 'block';
    }
  }

  // Session info elements
  const sessionInfo = document.getElementById('session-info');
  const sessionCourse = document.getElementById('session-course');
  const sessionActivity = document.getElementById('session-activity');

  // Check if we're on an iClicker page
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isIClickerPage = tab?.url?.includes('iclicker.com') || tab?.url?.includes('macmillanlearning.com');

  if (isIClickerPage) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_STATUS' });
      if (response?.isPollActive) {
        statusDot.classList.add('poll-active');
        statusText.textContent = '🔴 Poll is LIVE!';
      } else {
        statusDot.classList.add('active');
        statusText.textContent = 'Monitoring for polls...';
      }
    } catch (e) {
      statusDot.classList.add('active');
      statusText.textContent = 'Monitoring for polls...';
    }

    // Auto-join class/activity when popup is opened on iClicker page
    console.log('[Popup] userToken exists:', !!settings.userToken);
    console.log('[Popup] Tab URL:', tab.url);

    if (settings.userToken) {
      const { courseId, activityId } = await extractIdsFromUrl(tab.url);
      console.log('[Popup] Extracted courseId:', courseId, 'activityId:', activityId);

      // Show session info
      if (courseId || activityId) {
        sessionInfo.classList.remove('hidden');
        if (courseId) {
          sessionCourse.textContent = `📚 Course: ${courseId.substring(0, 8)}...`;
        }
        if (activityId) {
          sessionActivity.textContent = `📍 Activity: ${activityId.substring(0, 8)}...`;
        }
      }

      // Activity ID is preferred (more specific), course ID as fallback
      if (activityId || courseId) {
        joinSessionFromPopup(settings.userToken, courseId, activityId);
      } else {
        statusText.textContent = 'Visit activity or course page';
      }
    } else {
      console.log('[Popup] No userToken - Telegram not connected');
    }
  } else {
    statusText.textContent = 'Not on iClicker page';
    statusDot.style.background = '#9ca3af';

    // Still show share section if Telegram is connected
    if (settings.userToken) {
      document.getElementById('share-section').style.display = 'block';
    }
  }

  // Extract course ID and activity ID from URL or storage
  async function extractIdsFromUrl(url) {
    if (!url) return { courseId: null, activityId: null };

    console.log('[Popup] Extracting IDs from URL:', url);

    let courseId = null;
    let activityId = null;

    // Check for course page - /#/course/GUID
    let match = url.match(/#\/course\/([a-f0-9-]+)/i);
    if (match) {
      courseId = match[1];
      console.log('[Popup] Matched course page:', courseId);
      await chrome.storage.local.set({ lastCourseId: courseId });
    }

    // Check for class page (waiting room) - /#/class/GUID
    match = url.match(/#\/class\/([a-f0-9-]+)/i);
    if (match) {
      courseId = match[1];
      console.log('[Popup] Matched class page (waiting room):', courseId);
      await chrome.storage.local.set({ lastCourseId: courseId });
    }

    // Check for activity page - /#/activity/GUID
    match = url.match(/#\/activity\/([a-f0-9-]+)/i);
    if (match) {
      activityId = match[1];
      console.log('[Popup] Matched activity page:', activityId);
      await chrome.storage.local.set({ lastActivityId: activityId });
    }

    // Check for question page - use stored activity ID
    if (url.includes('#/question/')) {
      const stored = await chrome.storage.local.get(['lastActivityId', 'lastCourseId']);
      if (stored.lastActivityId) {
        activityId = stored.lastActivityId;
        console.log('[Popup] On question page, using stored activity:', activityId);
      }
      if (stored.lastCourseId && !courseId) {
        courseId = stored.lastCourseId;
        console.log('[Popup] On question page, using stored course:', courseId);
      }
    }

    // If on activity page but no course ID yet, try to get from storage
    if (activityId && !courseId) {
      const stored = await chrome.storage.local.get('lastCourseId');
      if (stored.lastCourseId) {
        courseId = stored.lastCourseId;
        console.log('[Popup] Using stored course ID:', courseId);
      }
    }

    console.log('[Popup] Final IDs - course:', courseId, 'activity:', activityId);
    return { courseId, activityId };
  }

  // Join class/activity session from popup
  async function joinSessionFromPopup(userToken, courseId, activityId) {
    try {
      console.log('[Popup] Joining session - course:', courseId, 'activity:', activityId);
      const response = await fetch(`${CONFIG.BACKEND_URL}/join-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userToken, courseId, activityId })
      });

      const data = await response.json();
      console.log('[Popup] Join session response:', data);

      if (data.success) {
        if (data.isNewSession) {
          statusText.textContent = '🟢 Joined session!';
          showToast('✓ Joined session - you\'ll get notified!', 'success');
        } else if (data.isNewJoin) {
          statusText.textContent = '🟢 Enrolled in class!';
          showToast('✓ Enrolled in class!', 'success');
        } else {
          statusText.textContent = '🟢 Monitoring...';
        }

        // Show member count
        if (data.memberCount) {
          const memberSpan = document.createElement('span');
          memberSpan.className = 'member-count';
          memberSpan.textContent = `👥 ${data.memberCount}`;
          statusText.appendChild(memberSpan);
        }

        // Show share section if connected
        document.getElementById('share-section').style.display = 'block';
      } else {
        showToast('Failed to join: ' + (data.error || 'Unknown error'), 'error');
      }
    } catch (error) {
      console.error('[Popup] Failed to join session:', error);
      showToast('Network error - check connection', 'error');
    }
  }

  // Toggle handlers
  notificationsToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ notificationEnabled: notificationsToggle.checked });
  });

  soundToggle.addEventListener('change', () => {
    chrome.storage.sync.set({ soundEnabled: soundToggle.checked });
  });

  // Test desktop notification and sound
  testDesktopBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'TEST_DESKTOP' });
    testDesktopBtn.textContent = 'Sent!';
    setTimeout(() => {
      testDesktopBtn.textContent = 'Test notification & sound';
    }, 2000);
  });

  telegramToggle.addEventListener('change', async () => {
    chrome.storage.sync.set({ pushEnabled: telegramToggle.checked });
    if (telegramToggle.checked) {
      telegramConfig.classList.remove('hidden');
      const { userToken } = await chrome.storage.sync.get('userToken');
      if (userToken) {
        showConnectedState();
      }
    } else {
      telegramConfig.classList.add('hidden');
    }
  });

  // Open bot in Telegram
  openBotBtn.addEventListener('click', () => {
    window.open(`https://t.me/${CONFIG.TELEGRAM_BOT_USERNAME}`, '_blank');
  });

  // Verify registration code
  verifyBtn.addEventListener('click', async () => {
    const code = registrationCode.value.trim();

    if (!code || code.length !== 6) {
      showToast('Enter the 6-digit code from Telegram', 'error');
      return;
    }

    verifyBtn.disabled = true;
    verifyBtn.textContent = 'Connecting...';

    try {
      const response = await fetch(`${CONFIG.BACKEND_URL}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });

      const data = await response.json();

      if (data.success && data.userToken) {
        // Save the user token
        await chrome.storage.sync.set({
          userToken: data.userToken,
          pushService: 'telegram'
        });

        showConnectedState();
        showToast('🎉 Connected to Telegram!', 'success');

        // Show share section
        document.getElementById('share-section').style.display = 'block';
      } else {
        showToast(data.error || 'Failed to connect. Get a new code.', 'error');
      }
    } catch (error) {
      showToast('Network error. Try again.', 'error');
    }

    verifyBtn.disabled = false;
    verifyBtn.textContent = 'Connect';
  });

  // Allow Enter key to submit code
  registrationCode.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      verifyBtn.click();
    }
  });

  async function showConnectedState() {
    connectedStatus.classList.remove('hidden');
    setupStepsContainer.style.display = 'none';

    // Show token for debugging/verification
    const { userToken } = await chrome.storage.sync.get('userToken');
    const tokenDisplay = document.getElementById('token-display');
    if (userToken && tokenDisplay) {
      const shortToken = userToken.substring(0, 12) + '...';
      tokenDisplay.textContent = `Token: ${shortToken}`;
      console.log('[iClicker Notifier] Extension token:', shortToken);
    }
  }

  function showDisconnectedState() {
    connectedStatus.classList.add('hidden');
    setupStepsContainer.style.display = 'block';
    registrationCode.value = '';
  }

  // Disconnect
  disconnectBtn.addEventListener('click', async () => {
    await chrome.storage.sync.remove(['userToken']);
    showDisconnectedState();
    showToast('Disconnected from Telegram', 'info');
    document.getElementById('share-section').style.display = 'none';
  });

  // Test Telegram notification
  testTelegramBtn.addEventListener('click', async () => {
    const { userToken } = await chrome.storage.sync.get('userToken');

    if (!userToken) {
      showToast('Not connected to Telegram yet', 'error');
      return;
    }

    testTelegramBtn.textContent = 'Sending...';

    try {
      const response = await fetch(`${CONFIG.BACKEND_URL}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userToken,
          title: '🧪 Test Notification',
          message: 'If you see this, notifications are working!'
        })
      });

      const data = await response.json();

      if (data.success) {
        showToast('✓ Test sent! Check Telegram', 'success');
      } else {
        showToast(data.error || 'Failed to send test', 'error');
      }
    } catch (error) {
      showToast('Network error', 'error');
    }

    testTelegramBtn.textContent = 'Send test';
  });

  function showTestResult(message, success) {
    testResult.textContent = message;
    testResult.className = 'test-result ' + (success ? 'success' : 'error');

    setTimeout(() => {
      testResult.className = 'test-result';
    }, 5000);
  }

  // Scan button
  scanBtn.addEventListener('click', async () => {
    if (!isIClickerPage) {
      alert('Navigate to an iClicker page first');
      return;
    }

    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'ENABLE_DEBUG' });
      console.log('Debug scan results:', response);
      alert('Check the DevTools console on the iClicker page for detailed results.');
    } catch (e) {
      alert('Error: Refresh the iClicker page and try again');
    }
  });

  // Share button
  const shareBtn = document.getElementById('share-btn');
  shareBtn.addEventListener('click', async () => {
    const shareText = `📱 Get notified when iClicker polls start!\n\nInstall the iClicker Notifier extension and connect to Telegram. When anyone in class detects a poll, everyone gets notified!\n\n🔗 https://t.me/${CONFIG.TELEGRAM_BOT_USERNAME}`;

    try {
      await navigator.clipboard.writeText(shareText);
      showToast('📋 Copied to clipboard!', 'success');
      shareBtn.textContent = 'Copied!';
      setTimeout(() => {
        shareBtn.textContent = 'Share with Classmates';
      }, 2000);
    } catch (e) {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = shareText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showToast('📋 Copied to clipboard!', 'success');
    }
  });
});
