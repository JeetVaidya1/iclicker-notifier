// iClicker Poll Notifier - Content Script
// This runs on iClicker pages and watches for poll elements

(function() {
  'use strict';

  // ============================================
  // CONFIGURATION - Selectors and text patterns for poll detection
  // ============================================
  
  // These selectors are TOO BROAD and cause false positives:
  // '[class*="question"]', '[class*="activity"]', '[class*="poll"]'
  
  // Instead, we look for SPECIFIC indicators of an ACTIVE poll:
  const POLL_SELECTORS = [
    // Active/live state indicators
    '[class*="poll-active"]',
    '[class*="poll-open"]',
    '[class*="question-active"]',
    '[class*="question-open"]',
    '[class*="answering"]',
    '[class*="live-poll"]',
    '[class*="live-question"]',
    
    // Timer/countdown (usually only shows during active poll)
    '[class*="timer"]:not([class*="timer-hidden"])',
    '[class*="countdown"]',
    '[class*="time-remaining"]',
    
    // Submit/answer buttons that are enabled
    'button[class*="submit"]:not([disabled])',
    'button[class*="answer"]:not([disabled])',
    
    // Answer option containers (radio buttons, multiple choice)
    '[class*="answer-option"]',
    '[class*="response-option"]',
    '[class*="choice-container"]',
  ];

  // Text patterns that indicate a poll is active
  const ACTIVE_POLL_TEXT_PATTERNS = [
    /answer now/i,
    /submit your answer/i,
    /poll is open/i,
    /question is open/i,
    /time remaining/i,
    /seconds? left/i,
    /respond now/i,
    /select your answer/i,
  ];

  // Selectors to CHECK for active poll text
  const TEXT_CHECK_SELECTORS = [
    '.join-title-box',
    '.join-title',
    '[role="alert"]',
    '[class*="status"]',
    '[class*="notification"]',
    '[class*="banner"]',
    '[class*="message"]',
  ];

  // Selectors that indicate we're in "waiting" state (NOT active)
  const WAITING_INDICATORS = [
    // Text content patterns
    /your instructor started class/i,
    /waiting for/i,
    /no active/i,
    /class has ended/i,
  ];

  // ============================================
  // STATE
  // ============================================
  let isPollActive = false;
  let lastNotificationTime = 0;
  const NOTIFICATION_COOLDOWN = 5000; // 5 seconds between notifications
  let debugMode = false;
  let currentCourseId = null;
  let currentActivityId = null;
  let sessionNotified = false; // Track if we've notified background about this session
  let lastAutoJoinTime = 0;
  let lastAutoJoinKey = null; // Track last joined course+activity combo
  const AUTO_JOIN_COOLDOWN = 30000; // 30 seconds between auto-join attempts for same session
  let lastNotifiedQuestionId = null; // Track which question ID we last notified about
  let currentQuestionIdFromUrl = null; // Track current question ID from URL

  // ============================================
  // COURSE ID EXTRACTION
  // ============================================
  function extractCourseIdFromHash() {
    const hash = window.location.hash;

    // Check if we're on a class page WITH an active poll - /#/class/GUID/poll
    // This is the most specific pattern and should be checked FIRST
    const classPollMatch = hash.match(/#\/class\/([a-f0-9-]+)\/poll/i);
    if (classPollMatch) {
      return { type: 'class_poll', classId: classPollMatch[1] };
    }

    // Also check for question URL pattern - /#/class/GUID/question/GUID
    const classQuestionMatch = hash.match(/#\/class\/([a-f0-9-]+)\/question\/([a-f0-9-]+)/i);
    if (classQuestionMatch) {
      return { type: 'class_question', classId: classQuestionMatch[1], questionId: classQuestionMatch[2] };
    }

    // Check if we're on a course page - /#/course/GUID or /#/course/GUID/overview
    const courseMatch = hash.match(/#\/course\/([a-f0-9-]+)/i);
    if (courseMatch) {
      return { type: 'course', id: courseMatch[1] };
    }

    // Check if we're on a class page (waiting for activity) - /#/class/GUID
    const classMatch = hash.match(/#\/class\/([a-f0-9-]+)/i);
    if (classMatch) {
      return { type: 'class', id: classMatch[1] };
    }

    // Check if we're on an activity page - /#/activity/GUID
    const activityMatch = hash.match(/#\/activity\/([a-f0-9-]+)/i);
    if (activityMatch) {
      return { type: 'activity', id: activityMatch[1] };
    }

    // Check if we're on a question page - /#/question/GUID
    const questionMatch = hash.match(/#\/question\/([a-f0-9-]+)/i);
    if (questionMatch) {
      return { type: 'question', id: questionMatch[1] };
    }

    return { type: 'unknown', id: null };
  }

  // Get the current course ID (from URL or storage)
  async function getCurrentCourseId() {
    const parsed = extractCourseIdFromHash();

    // Handle class page with active poll - /#/class/GUID/poll
    if (parsed.type === 'class_poll') {
      currentCourseId = parsed.classId;
      await chrome.storage.local.set({ lastCourseId: parsed.classId });
      console.log('[iClicker Notifier] On class_poll page, stored course ID:', parsed.classId);
      return parsed.classId;
    }

    // Handle class page with question - /#/class/GUID/question/GUID
    if (parsed.type === 'class_question') {
      currentCourseId = parsed.classId;
      await chrome.storage.local.set({ lastCourseId: parsed.classId });
      console.log('[iClicker Notifier] On class_question page, stored course ID:', parsed.classId);
      return parsed.classId;
    }

    if (parsed.type === 'course' || parsed.type === 'class') {
      // We're on a course or class page - store and return the course ID
      currentCourseId = parsed.id;
      await chrome.storage.local.set({ lastCourseId: parsed.id });
      console.log('[iClicker Notifier] On', parsed.type, 'page, stored course ID:', parsed.id);
      return parsed.id;
    }

    if (parsed.type === 'activity' || parsed.type === 'question') {
      // We're on activity/question page - use stored course ID
      if (currentCourseId) {
        return currentCourseId;
      }
      const stored = await chrome.storage.local.get('lastCourseId');
      if (stored.lastCourseId) {
        currentCourseId = stored.lastCourseId;
        console.log('[iClicker Notifier] On', parsed.type, 'page, using stored course:', stored.lastCourseId);
        return stored.lastCourseId;
      }
      console.log('[iClicker Notifier] On', parsed.type, 'page but no stored course ID');
    }

    return currentCourseId || null;
  }

  // Get the current activity ID (from URL or storage)
  async function getCurrentActivityId() {
    const parsed = extractCourseIdFromHash();

    if (parsed.type === 'activity') {
      // We're on an activity page - store and return the activity ID
      currentActivityId = parsed.id;
      await chrome.storage.local.set({ lastActivityId: parsed.id });
      console.log('[iClicker Notifier] On activity page, stored activity ID:', parsed.id);
      return parsed.id;
    }

    if (parsed.type === 'question') {
      // We're on question page - use stored activity ID
      if (currentActivityId) {
        return currentActivityId;
      }
      const stored = await chrome.storage.local.get('lastActivityId');
      if (stored.lastActivityId) {
        currentActivityId = stored.lastActivityId;
        console.log('[iClicker Notifier] On question page, using stored activity:', stored.lastActivityId);
        return stored.lastActivityId;
      }
      console.log('[iClicker Notifier] On question page but no stored activity ID');
    }

    return currentActivityId || null;
  }

  // Extract IDs from WebSocket JSON message (recursive search)
  function extractIdsFromWebSocketMessage(obj, depth = 0) {
    if (depth > 5 || !obj || typeof obj !== 'object') return;

    // Look for activity ID in various field names
    const activityFields = ['activityId', 'activity_id', 'activityGuid', 'activity'];
    const courseFields = ['courseId', 'course_id', 'courseGuid', 'course'];

    for (const field of activityFields) {
      if (obj[field] && typeof obj[field] === 'string' && obj[field].match(/^[a-f0-9-]+$/i)) {
        if (!currentActivityId) {
          currentActivityId = obj[field];
          chrome.storage.local.set({ lastActivityId: obj[field] });
          console.log('[iClicker Notifier] Found activity ID in WebSocket:', obj[field]);
        }
      }
    }

    for (const field of courseFields) {
      if (obj[field] && typeof obj[field] === 'string' && obj[field].match(/^[a-f0-9-]+$/i)) {
        if (!currentCourseId) {
          currentCourseId = obj[field];
          chrome.storage.local.set({ lastCourseId: obj[field] });
          console.log('[iClicker Notifier] Found course ID in WebSocket:', obj[field]);
        }
      }
    }

    // Recurse into nested objects/arrays
    for (const key in obj) {
      if (typeof obj[key] === 'object') {
        extractIdsFromWebSocketMessage(obj[key], depth + 1);
      }
    }
  }

  // Extract question ID from WebSocket JSON message (recursive search)
  function extractQuestionIdFromObject(obj, depth = 0) {
    if (depth > 5 || !obj || typeof obj !== 'object') return null;

    // Look for question ID in various field names
    const questionFields = ['questionId', 'question_id', 'questionGuid', 'pollId', 'poll_id'];

    for (const field of questionFields) {
      if (obj[field] && typeof obj[field] === 'string' && obj[field].match(/^[a-f0-9-]+$/i)) {
        console.log('[iClicker Notifier] Found question ID in WebSocket field', field + ':', obj[field]);
        return obj[field];
      }
    }

    // Also check 'id' field if the object seems to be a question/poll
    if (obj.id && typeof obj.id === 'string' && obj.id.match(/^[a-f0-9-]+$/i)) {
      const objType = (obj.type || obj.__typename || '').toLowerCase();
      if (objType.includes('question') || objType.includes('poll')) {
        console.log('[iClicker Notifier] Found question ID in id field:', obj.id);
        return obj.id;
      }
    }

    // Recurse into nested objects/arrays
    for (const key in obj) {
      if (typeof obj[key] === 'object') {
        const found = extractQuestionIdFromObject(obj[key], depth + 1);
        if (found) return found;
      }
    }

    return null;
  }

  // Notify background script that session is active
  function notifySessionActive() {
    if (currentActivityId || currentCourseId) {
      console.log('[iClicker Notifier] Notifying session active - course:', currentCourseId, 'activity:', currentActivityId);
      chrome.runtime.sendMessage({
        type: 'SESSION_ACTIVE',
        data: {
          courseId: currentCourseId,
          activityId: currentActivityId
        }
      });
      sessionNotified = true;
    }
  }

  // Notify background script that session is inactive (leaving page)
  function notifySessionInactive() {
    if (sessionNotified) {
      console.log('[iClicker Notifier] Notifying session inactive');
      chrome.runtime.sendMessage({
        type: 'SESSION_INACTIVE',
        data: {}
      });
      sessionNotified = false;
    }
  }

  // Check if URL indicates an active poll/question
  let lastPollUrl = null;

  function checkUrlForQuestion() {
    const hash = window.location.hash;
    const fullUrl = window.location.href;

    // SIMPLE CHECK: Does URL contain /poll or /question?
    const hasPoll = hash.includes('/poll');
    const hasQuestion = hash.includes('/question/');

    console.log('[iClicker Notifier] URL check - hash:', hash, 'hasPoll:', hasPoll, 'hasQuestion:', hasQuestion);

    // If URL contains /poll and we haven't notified for this URL yet
    if (hasPoll && fullUrl !== lastPollUrl) {
      // Extract class ID from the URL
      const classMatch = hash.match(/#\/class\/([a-f0-9-]+)/i);
      const classId = classMatch ? classMatch[1] : null;

      lastPollUrl = fullUrl;
      console.log('[iClicker Notifier] 🔔 POLL DETECTED via URL! /poll');
      console.log('[iClicker Notifier] Class ID:', classId);

      handlePollDetected({
        found: true,
        type: 'url_poll',
        classId: classId,
        url: fullUrl
      });
      return true;
    }

    // If URL contains /question/ and we haven't notified for this URL yet
    if (hasQuestion && fullUrl !== lastPollUrl) {
      const questionMatch = hash.match(/\/question\/([a-f0-9-]+)/i);
      const classMatch = hash.match(/#\/class\/([a-f0-9-]+)/i);
      const questionId = questionMatch ? questionMatch[1] : null;
      const classId = classMatch ? classMatch[1] : null;

      // Track the current question ID from URL
      currentQuestionIdFromUrl = questionId;

      lastPollUrl = fullUrl;
      console.log('[iClicker Notifier] 🔔 QUESTION DETECTED via URL!', questionId);
      console.log('[iClicker Notifier] Class ID:', classId);

      handlePollDetected({
        found: true,
        type: 'url_question',
        questionId: questionId,
        classId: classId,
        url: fullUrl
      });
      return true;
    }

    // No poll/question in URL - if we had one before, poll ended
    if (lastPollUrl !== null && !hasPoll && !hasQuestion) {
      console.log('[iClicker Notifier] Poll/question no longer in URL - poll ended');
      lastPollUrl = null;
      currentQuestionIdFromUrl = null;
      handlePollEnded();
    }

    return false;
  }

  // Check if a new question started via WebSocket (works even when viewing old question results)
  function handleNewQuestionFromWebSocket(newQuestionId) {
    // If we're viewing an old question and a NEW one starts, notify!
    if (newQuestionId && newQuestionId !== lastNotifiedQuestionId) {
      console.log('[iClicker Notifier] 🔔 NEW QUESTION via WebSocket!', newQuestionId);
      console.log('[iClicker Notifier] Previous question:', lastNotifiedQuestionId);
      console.log('[iClicker Notifier] Current URL question:', currentQuestionIdFromUrl);

      // Reset poll state so we can notify again
      isPollActive = false;

      handlePollDetected({
        found: true,
        type: 'websocket_new_question',
        questionId: newQuestionId,
        classId: currentCourseId
      });
    }
  }

  // Track course and activity when navigating (hash changes in SPA)
  function setupCourseTracking() {
    // Initial check
    getCurrentCourseId();
    getCurrentActivityId();

    // Check URL for active question on load
    setTimeout(() => {
      console.log('[iClicker Notifier] Initial URL check for question...');
      checkUrlForQuestion();
    }, 1000);

    // Listen for hash changes (SPA navigation)
    window.addEventListener('hashchange', async () => {
      console.log('[iClicker Notifier] Hash changed:', window.location.hash);
      await getCurrentCourseId();
      await getCurrentActivityId();

      // Check if URL now contains a question (poll is live!)
      checkUrlForQuestion();

      // Auto-join when navigating to new pages
      setTimeout(autoJoinSession, 500);
    });

    // Notify when leaving the page
    window.addEventListener('beforeunload', () => {
      notifySessionInactive();
    });

    // Also handle visibility changes (tab hidden = user left)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        // Don't immediately leave - user might just be switching tabs briefly
        // The heartbeat in background.js will handle the timeout
      } else if (document.visibilityState === 'visible') {
        // User came back - refresh the session
        autoJoinSession();
      }
    });
  }

  // Legacy function for compatibility
  function extractCourseId() {
    // Synchronous version - returns currentCourseId or tries to extract
    const parsed = extractCourseIdFromHash();
    if (parsed.type === 'course') {
      return parsed.id;
    }
    return currentCourseId || 'unknown_course';
  }

  // Try to extract IDs from the page DOM (for when we land directly on a question page)
  async function extractIdsFromPage() {
    // Look in script tags for embedded data
    const scripts = document.querySelectorAll('script:not([src])');
    for (const script of scripts) {
      const content = script.textContent || '';

      // Look for activity ID patterns
      const activityMatch = content.match(/["']activityId["']\s*:\s*["']([a-f0-9-]+)["']/i) ||
                            content.match(/activityId\s*=\s*["']([a-f0-9-]+)["']/i);
      if (activityMatch && !currentActivityId) {
        currentActivityId = activityMatch[1];
        await chrome.storage.local.set({ lastActivityId: activityMatch[1] });
        console.log('[iClicker Notifier] Found activity ID in page script:', activityMatch[1]);
      }

      // Look for course ID patterns
      const courseMatch = content.match(/["']courseId["']\s*:\s*["']([a-f0-9-]+)["']/i) ||
                          content.match(/courseId\s*=\s*["']([a-f0-9-]+)["']/i);
      if (courseMatch && !currentCourseId) {
        currentCourseId = courseMatch[1];
        await chrome.storage.local.set({ lastCourseId: courseMatch[1] });
        console.log('[iClicker Notifier] Found course ID in page script:', courseMatch[1]);
      }
    }

    // Look in data attributes
    const elementsWithData = document.querySelectorAll('[data-activity-id], [data-course-id], [data-activityid], [data-courseid]');
    for (const el of elementsWithData) {
      const activityId = el.dataset.activityId || el.dataset.activityid;
      const courseId = el.dataset.courseId || el.dataset.courseid;

      if (activityId && !currentActivityId) {
        currentActivityId = activityId;
        await chrome.storage.local.set({ lastActivityId: activityId });
        console.log('[iClicker Notifier] Found activity ID in data attribute:', activityId);
      }
      if (courseId && !currentCourseId) {
        currentCourseId = courseId;
        await chrome.storage.local.set({ lastCourseId: courseId });
        console.log('[iClicker Notifier] Found course ID in data attribute:', courseId);
      }
    }

    // Also check localStorage/sessionStorage that the app might use
    try {
      const storageKeys = ['activityId', 'courseId', 'currentActivity', 'currentCourse'];
      for (const key of storageKeys) {
        const localValue = localStorage.getItem(key);
        const sessionValue = sessionStorage.getItem(key);
        const value = localValue || sessionValue;

        if (value && value.match(/^[a-f0-9-]+$/i)) {
          if (key.toLowerCase().includes('activity') && !currentActivityId) {
            currentActivityId = value;
            await chrome.storage.local.set({ lastActivityId: value });
            console.log('[iClicker Notifier] Found activity ID in app storage:', value);
          } else if (key.toLowerCase().includes('course') && !currentCourseId) {
            currentCourseId = value;
            await chrome.storage.local.set({ lastCourseId: value });
            console.log('[iClicker Notifier] Found course ID in app storage:', value);
          }
        }
      }
    } catch (e) {
      // Storage access might be restricted
    }
  }

  // Auto-join session when on iClicker page (no popup needed)
  async function autoJoinSession() {
    try {
      const settings = await chrome.storage.sync.get(['userToken', 'pushEnabled']);
      if (!settings.userToken || !settings.pushEnabled) {
        console.log('[iClicker Notifier] Auto-join skipped - not connected to Telegram');
        return;
      }

      const courseId = currentCourseId;
      const activityId = currentActivityId;

      if (!courseId && !activityId) {
        console.log('[iClicker Notifier] Auto-join skipped - no IDs found');
        return;
      }

      // Debounce: don't re-join the same session within cooldown period
      // But ALWAYS join if activity ID changed (instructor started new activity)
      const joinKey = `${courseId || 'none'}-${activityId || 'none'}`;
      const now = Date.now();
      const activityChanged = lastAutoJoinKey && activityId && !lastAutoJoinKey.endsWith(`-${activityId}`);

      if (joinKey === lastAutoJoinKey && (now - lastAutoJoinTime) < AUTO_JOIN_COOLDOWN) {
        // Silent skip - don't spam console
        return;
      }

      if (activityChanged) {
        console.log('[iClicker Notifier] New activity detected, joining immediately');
      }

      lastAutoJoinKey = joinKey;
      lastAutoJoinTime = now;

      console.log('[iClicker Notifier] Auto-joining session - course:', courseId, 'activity:', activityId);
      console.log('[iClicker Notifier] Using token:', settings.userToken.substring(0, 12) + '...');

      // Get backend URL from config or use default
      const backendUrl = 'https://iclicker-notifier.iclicker-notify.workers.dev';

      const response = await fetch(`${backendUrl}/join-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userToken: settings.userToken,
          courseId,
          activityId
        })
      });

      const data = await response.json();
      console.log('[iClicker Notifier] Auto-join response:', data);

      if (data.success) {
        // Notify background to start heartbeat
        notifySessionActive();
      }
    } catch (error) {
      console.error('[iClicker Notifier] Auto-join failed:', error);
    }
  }

  // Extract and store course/activity ID when visiting a class page
  function registerWithClass() {
    Promise.all([getCurrentCourseId(), getCurrentActivityId()]).then(([courseId, activityId]) => {
      console.log('[iClicker Notifier] Current course:', courseId, 'Activity:', activityId);

      const parsed = extractCourseIdFromHash();
      console.log('[iClicker Notifier] Page type:', parsed.type, 'ID:', parsed.id);

      // If we're on a question page and don't have IDs, try to extract from page
      if (parsed.type === 'question' && (!courseId || !activityId)) {
        console.log('[iClicker Notifier] On question page without full IDs, scanning page...');
        extractIdsFromPage().then(() => {
          // Auto-join after extracting IDs
          autoJoinSession();
        });
      } else if (courseId || activityId) {
        // Auto-join session (works for course, class, activity pages)
        autoJoinSession();
      }
    });
  }

  // ============================================
  // DETECTION LOGIC
  // ============================================
  
  // Check if any text on page matches active poll patterns
  function checkForActivePollText() {
    for (const selector of TEXT_CHECK_SELECTORS) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        const text = el.textContent || '';
        for (const pattern of ACTIVE_POLL_TEXT_PATTERNS) {
          if (pattern.test(text)) {
            if (debugMode) {
              console.log('[iClicker Notifier] Found active poll text:', text.trim(), 'in', selector);
            }
            return { found: true, type: 'text', pattern: pattern.toString(), text: text.trim() };
          }
        }
      }
    }
    return { found: false };
  }

  // Check if current state is "waiting" (not active)
  function isInWaitingState() {
    const alertElements = document.querySelectorAll('[role="alert"], .join-title-box, [class*="status"]');
    for (const el of alertElements) {
      const text = el.textContent || '';
      for (const pattern of WAITING_INDICATORS) {
        if (pattern.test(text)) {
          if (debugMode) {
            console.log('[iClicker Notifier] In waiting state:', text.trim());
          }
          return true;
        }
      }
    }
    return false;
  }

  function checkForActivePoll() {
    // First check if we're in a waiting state - if so, definitely no active poll
    if (isInWaitingState()) {
      return { found: false, reason: 'waiting_state' };
    }

    // Check for active poll text patterns
    const textResult = checkForActivePollText();
    if (textResult.found) {
      return textResult;
    }

    // Check for DOM element selectors
    for (const selector of POLL_SELECTORS) {
      try {
        const element = document.querySelector(selector);
        if (element && isVisible(element)) {
          if (debugMode) {
            console.log('[iClicker Notifier] Found poll element:', selector, element);
          }
          return { found: true, type: 'selector', selector, element };
        }
      } catch (e) {
        // Invalid selector, skip
      }
    }
    
    return { found: false };
  }

  function isVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' 
      && style.visibility !== 'hidden' 
      && style.opacity !== '0'
      && element.offsetParent !== null;
  }

  function handlePollDetected(result) {
    const now = Date.now();

    // Prevent spam notifications
    if (now - lastNotificationTime < NOTIFICATION_COOLDOWN) {
      return;
    }

    const courseId = result.classId || currentCourseId || extractCourseId();
    const activityId = currentActivityId;
    const questionId = result.questionId || null;

    // Check if this is actually a NEW question (not one we already notified about)
    // This is especially important for WebSocket-detected questions
    if (questionId && questionId === lastNotifiedQuestionId) {
      console.log('[iClicker Notifier] Skipping - already notified for question:', questionId);
      return;
    }

    if (!isPollActive) {
      isPollActive = true;
      lastNotificationTime = now;

      // Track which question we notified about
      if (questionId) {
        lastNotifiedQuestionId = questionId;
      }

      console.log('[iClicker Notifier] 🔔 Poll detected!');
      console.log('[iClicker Notifier] Detection type:', result.type);
      console.log('[iClicker Notifier] Course ID:', courseId);
      console.log('[iClicker Notifier] Activity ID:', activityId);
      console.log('[iClicker Notifier] Question ID:', questionId);

      // Send message to background script for notification
      chrome.runtime.sendMessage({
        type: 'POLL_STARTED',
        data: {
          url: window.location.href,
          timestamp: now,
          detectionType: result.type,
          details: result.selector || result.pattern || result.text || result.questionId,
          courseId: courseId,
          activityId: activityId,
          questionId: questionId
        }
      });
    }
  }

  function handlePollEnded() {
    if (isPollActive) {
      isPollActive = false;
      console.log('[iClicker Notifier] Poll ended');
      
      chrome.runtime.sendMessage({
        type: 'POLL_ENDED',
        data: {
          timestamp: Date.now()
        }
      });
    }
  }

  // ============================================
  // WEBSOCKET MONITORING
  // ============================================
  function setupWebSocketMonitoring() {
    // Intercept WebSocket to catch poll events directly from server
    const originalWebSocket = window.WebSocket;
    
    window.WebSocket = function(url, protocols) {
      const ws = protocols 
        ? new originalWebSocket(url, protocols) 
        : new originalWebSocket(url);
      
      if (debugMode) {
        console.log('[iClicker Notifier] WebSocket connection:', url);
      }

      ws.addEventListener('message', function(event) {
        try {
          const data = typeof event.data === 'string' ? event.data : '';

          // Look for poll-related messages
          const lowerData = data.toLowerCase();
          const isPollMessage =
            lowerData.includes('"poll"') ||
            lowerData.includes('"question"') ||
            lowerData.includes('"activity"') ||
            lowerData.includes('startpoll') ||
            lowerData.includes('start_poll') ||
            lowerData.includes('pollstarted') ||
            lowerData.includes('poll_started') ||
            lowerData.includes('questionopen') ||
            lowerData.includes('question_open');

          if (isPollMessage && debugMode) {
            console.log('[iClicker Notifier] WebSocket poll message:', data.substring(0, 500));
          }

          // Try to extract question ID from WebSocket messages
          // This is KEY for detecting new questions while viewing old question results
          let extractedQuestionId = null;
          try {
            const jsonData = JSON.parse(data);
            extractIdsFromWebSocketMessage(jsonData);
            // Also look for question ID specifically
            extractedQuestionId = extractQuestionIdFromObject(jsonData);
          } catch (e) {
            // Not JSON, try regex extraction
            const activityMatch = data.match(/"activityId"\s*:\s*"([a-f0-9-]+)"/i) ||
                                  data.match(/"activity_id"\s*:\s*"([a-f0-9-]+)"/i) ||
                                  data.match(/"activity"\s*:\s*"([a-f0-9-]+)"/i);
            if (activityMatch && !currentActivityId) {
              currentActivityId = activityMatch[1];
              chrome.storage.local.set({ lastActivityId: activityMatch[1] });
              console.log('[iClicker Notifier] Extracted activity ID from WebSocket:', activityMatch[1]);
            }

            // Try to extract question ID via regex
            const questionMatch = data.match(/"questionId"\s*:\s*"([a-f0-9-]+)"/i) ||
                                  data.match(/"question_id"\s*:\s*"([a-f0-9-]+)"/i) ||
                                  data.match(/"questionGuid"\s*:\s*"([a-f0-9-]+)"/i) ||
                                  data.match(/"id"\s*:\s*"([a-f0-9-]+)"/i);
            if (questionMatch) {
              extractedQuestionId = questionMatch[1];
            }
          }

          // Check for specific poll start indicators
          const isPollStart =
            (lowerData.includes('start') && (lowerData.includes('poll') || lowerData.includes('question'))) ||
            (lowerData.includes('open') && (lowerData.includes('poll') || lowerData.includes('question'))) ||
            lowerData.includes('"status":"active"') ||
            lowerData.includes('"status":"open"') ||
            lowerData.includes('"state":"active"') ||
            lowerData.includes('"state":"open"');

          if (isPollStart) {
            console.log('[iClicker Notifier] Poll start detected via WebSocket!');
            console.log('[iClicker Notifier] Extracted question ID:', extractedQuestionId);

            // If we found a question ID and it's different from what we're viewing,
            // this is a NEW question - notify even if we're on an old question page!
            if (extractedQuestionId && extractedQuestionId !== currentQuestionIdFromUrl) {
              handleNewQuestionFromWebSocket(extractedQuestionId);
            } else {
              handlePollDetected({ found: true, type: 'websocket', questionId: extractedQuestionId, data: data.substring(0, 200) });
            }
          }

          // Check for poll end indicators
          if (
            (lowerData.includes('stop') && (lowerData.includes('poll') || lowerData.includes('question'))) ||
            (lowerData.includes('close') && (lowerData.includes('poll') || lowerData.includes('question'))) ||
            (lowerData.includes('end') && (lowerData.includes('poll') || lowerData.includes('question'))) ||
            lowerData.includes('"status":"closed"') ||
            lowerData.includes('"state":"closed"')
          ) {
            if (debugMode) {
              console.log('[iClicker Notifier] Poll end detected via WebSocket');
            }
            handlePollEnded();
          }
        } catch (e) {
          // Ignore parsing errors
        }
      });

      return ws;
    };

    // Copy static properties
    window.WebSocket.prototype = originalWebSocket.prototype;
    window.WebSocket.CONNECTING = originalWebSocket.CONNECTING;
    window.WebSocket.OPEN = originalWebSocket.OPEN;
    window.WebSocket.CLOSING = originalWebSocket.CLOSING;
    window.WebSocket.CLOSED = originalWebSocket.CLOSED;

    console.log('[iClicker Notifier] WebSocket monitoring enabled');
  }

  // ============================================
  // MUTATION OBSERVER
  // ============================================
  function startObserver() {
    const observer = new MutationObserver((mutations) => {
      const result = checkForActivePoll();
      
      if (result.found) {
        handlePollDetected(result);
      } else if (isPollActive) {
        // Poll element disappeared
        handlePollEnded();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden'],
      characterData: true  // Also watch for text changes
    });

    console.log('[iClicker Notifier] Observer started');

    // Initial check
    const result = checkForActivePoll();
    if (result.found) {
      handlePollDetected(result);
    }

    return observer;
  }

  // ============================================
  // DEBUG MODE - Helps identify selectors
  // ============================================
  function enableDebugMode() {
    debugMode = true;
    console.log('[iClicker Notifier] Debug mode enabled');

    // Log current IDs (critical for notifications)
    console.log('[iClicker Notifier] === CURRENT IDs ===');
    console.log('[iClicker Notifier] Course ID (memory):', currentCourseId);
    console.log('[iClicker Notifier] Activity ID (memory):', currentActivityId);
    console.log('[iClicker Notifier] URL hash:', window.location.hash);

    // Log question tracking state (for new question detection)
    console.log('[iClicker Notifier] === QUESTION TRACKING ===');
    console.log('[iClicker Notifier] Last notified question ID:', lastNotifiedQuestionId);
    console.log('[iClicker Notifier] Current question ID from URL:', currentQuestionIdFromUrl);
    console.log('[iClicker Notifier] Is poll active:', isPollActive);

    // Also check storage
    chrome.storage.local.get(['lastCourseId', 'lastActivityId']).then(stored => {
      console.log('[iClicker Notifier] Course ID (storage):', stored.lastCourseId);
      console.log('[iClicker Notifier] Activity ID (storage):', stored.lastActivityId);
    });

    // Try to extract IDs from page if missing
    if (!currentActivityId || !currentCourseId) {
      console.log('[iClicker Notifier] Missing IDs, scanning page...');
      extractIdsFromPage();
    }

    // Log current state
    console.log('[iClicker Notifier] Current waiting state:', isInWaitingState());

    // Check for active poll text
    const textResult = checkForActivePollText();
    console.log('[iClicker Notifier] Active poll text found:', textResult);

    // Log all elements with interesting class names
    const allElements = document.querySelectorAll('*');
    const interestingClasses = [];

    allElements.forEach(el => {
      const className = el.className;
      if (typeof className === 'string' && className.length > 0) {
        const lower = className.toLowerCase();
        if (lower.includes('question') ||
            lower.includes('poll') ||
            lower.includes('activity') ||
            lower.includes('active') ||
            lower.includes('live') ||
            lower.includes('timer') ||
            lower.includes('answer') ||
            lower.includes('submit') ||
            lower.includes('response')) {
          interestingClasses.push({
            element: el.tagName,
            class: className,
            visible: isVisible(el),
            text: (el.textContent || '').substring(0, 50).trim()
          });
        }
      }
    });

    console.log('[iClicker Notifier] Interesting elements found:', interestingClasses);

    // Log alert/notification elements specifically
    const alertElements = document.querySelectorAll('[role="alert"], .join-title-box, [class*="notification"], [class*="banner"], [class*="status"]');
    console.log('[iClicker Notifier] Alert/status elements:',
      Array.from(alertElements).map(el => ({
        class: el.className,
        text: (el.textContent || '').substring(0, 100).trim()
      }))
    );

    return {
      interestingClasses,
      isWaiting: isInWaitingState(),
      textResult,
      courseId: currentCourseId,
      activityId: currentActivityId,
      lastNotifiedQuestionId,
      currentQuestionIdFromUrl,
      isPollActive
    };
  }

  // Expose debug function globally
  window.iClickerNotifierDebug = enableDebugMode;

  // ============================================
  // INITIALIZE
  // ============================================
  // Setup WebSocket monitoring early (before Angular creates connections)
  setupWebSocketMonitoring();

  // Setup course tracking for SPA navigation
  setupCourseTracking();

  // Periodic URL check (backup for cases where hashchange doesn't fire)
  let lastUrlCheck = window.location.href;
  setInterval(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrlCheck) {
      console.log('[iClicker Notifier] URL changed (interval check):', currentUrl);
      lastUrlCheck = currentUrl;
      checkUrlForQuestion();
    }
  }, 2000); // Check every 2 seconds

  // Load settings
  chrome.storage.sync.get(['enabled', 'debugMode'], (settings) => {
    if (settings.enabled === false) {
      console.log('[iClicker Notifier] Extension disabled');
      return;
    }

    debugMode = settings.debugMode || false;
    startObserver();

    // Register with this class for broadcast notifications
    registerWithClass();
  });

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_STATUS') {
      sendResponse({ isPollActive, debugMode });
    } else if (message.type === 'ENABLE_DEBUG') {
      const results = enableDebugMode();
      sendResponse({ results });
    } else if (message.type === 'CHECK_NOW') {
      const result = checkForActivePoll();
      sendResponse(result);
    }
  });

  console.log('[iClicker Notifier] Content script loaded on', window.location.hostname);
  console.log('[iClicker Notifier] Run window.iClickerNotifierDebug() in console to find selectors');
})();
