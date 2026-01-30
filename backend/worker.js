/**
 * iClicker Notifier Backend - Cloudflare Worker
 *
 * Environment variables needed:
 * - TELEGRAM_BOT_TOKEN: Your bot token from @BotFather
 * - WEBHOOK_SECRET: A random string to verify webhook calls
 *
 * KV Namespace needed:
 * - USERS: Stores user registrations
 */

const TELEGRAM_API = 'https://api.telegram.org/bot';

// Rate limiting: max 1 notification per user per 60 seconds (KV minimum TTL)
const RATE_LIMIT_SECONDS = 60;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS headers for extension
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Route handling
      if (url.pathname === '/webhook' && request.method === 'POST') {
        return await handleWebhook(request, env);
      }

      if (url.pathname === '/register' && request.method === 'POST') {
        return await handleRegister(request, env, corsHeaders);
      }

      if (url.pathname === '/notify' && request.method === 'POST') {
        return await handleNotify(request, env, corsHeaders);
      }

      if (url.pathname === '/join-class' && request.method === 'POST') {
        return await handleJoinClass(request, env, corsHeaders);
      }

      if (url.pathname === '/join-session' && request.method === 'POST') {
        return await handleJoinSession(request, env, corsHeaders);
      }

      if (url.pathname === '/leave-session' && request.method === 'POST') {
        return await handleLeaveSession(request, env, corsHeaders);
      }

      if (url.pathname === '/heartbeat' && request.method === 'POST') {
        return await handleHeartbeat(request, env, corsHeaders);
      }

      if (url.pathname === '/broadcast' && request.method === 'POST') {
        return await handleBroadcast(request, env, corsHeaders);
      }

      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      return new Response('Not found', { status: 404, headers: corsHeaders });
    } catch (error) {
      console.error('Error:', error);
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};

/**
 * Validate GUID format
 */
function isValidGuid(str) {
  if (!str) return false;
  return /^[a-f0-9-]{8,}$/i.test(str);
}

/**
 * Handle Telegram webhook - when users message the bot
 */
async function handleWebhook(request, env) {
  // Verify webhook secret (optional but recommended)
  const secretHeader = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (env.WEBHOOK_SECRET && secretHeader !== env.WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  const update = await request.json();

  // Handle /start command or any message
  const message = update.message;
  if (!message) {
    return new Response('OK');
  }

  const chatId = message.chat.id;
  const text = (message.text || '').toLowerCase();

  // Check if user is already registered (using reverse lookup first)
  const existingUsers = await env.USERS.list({ prefix: 'user:' });
  let isAlreadyRegistered = false;
  let foundUserToken = null;

  // Try fast reverse lookup first
  foundUserToken = await env.USERS.get(`chat:${chatId}`);
  if (foundUserToken) {
    isAlreadyRegistered = true;
  } else {
    // Fallback to iterating through all users
    for (const key of existingUsers.keys) {
      const storedChatId = await env.USERS.get(key.name);
      if (storedChatId === chatId.toString()) {
        isAlreadyRegistered = true;
        foundUserToken = key.name.replace('user:', '');
        // Store reverse lookup for future
        await env.USERS.put(`chat:${chatId}`, foundUserToken);
        break;
      }
    }
  }

  // Handle /start command - welcome message with code
  if (text === '/start') {
    // Rate limit code generation
    const codeRateLimitKey = `codelimit:${chatId}`;
    const lastCodeRequest = await env.USERS.get(codeRateLimitKey);

    let codeSection = '';
    if (!lastCodeRequest) {
      const code = generateCode();
      await env.USERS.put(`code:${code}`, chatId.toString(), { expirationTtl: 600 });
      await env.USERS.put(codeRateLimitKey, '1', { expirationTtl: 120 });
      codeSection = `\n📝 *Your registration code:*\n\`${code}\`\n_Expires in 10 minutes_\n`;
    } else {
      codeSection = `\n_Use /code to get a registration code_\n`;
    }

    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      `👋 *Welcome to iClicker Poll Notifier!*\n\n` +
      `Never miss an iClicker poll again. Get instant notifications on your phone when polls start.\n\n` +
      `*Quick Setup (30 seconds):*\n` +
      `1️⃣ Install the Chrome extension\n` +
      `2️⃣ Visit your iClicker class page\n` +
      `3️⃣ Click extension → Enable Telegram\n` +
      `4️⃣ Enter your code to connect\n` +
      codeSection + `\n` +
      `*Commands:* /help\n` +
      `*FAQ:* /questions\n` +
      `*Feedback:* /feedback`
    );

    return new Response('OK');
  }

  // Handle /feedback command
  if (text === '/feedback' || text.startsWith('/feedback ')) {
    const feedbackText = text.replace('/feedback', '').trim();

    if (!feedbackText) {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
        `💬 *Send Feedback*\n\n` +
        `We'd love to hear from you! Send your feedback, suggestions, or bug reports.\n\n` +
        `*How to send:*\n` +
        `Type: /feedback [your message]\n\n` +
        `*Example:*\n` +
        `/feedback Love the app! Would be great to have Discord support too.`
      );
    } else {
      // Log feedback (in production, you might store this or forward to admin)
      console.log(`Feedback from ${chatId}: ${feedbackText}`);

      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
        `✅ *Thanks for your feedback!*\n\n` +
        `We've received your message:\n` +
        `"${feedbackText}"\n\n` +
        `We appreciate you helping us improve! 🙏`
      );
    }
    return new Response('OK');
  }

  // Handle /questions command - FAQ
  if (text === '/questions' || text === '/faq') {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      `❓ *Frequently Asked Questions*\n\n` +
      `*Q: How does it work?*\n` +
      `The Chrome extension monitors your iClicker page. When a poll starts, it sends a notification to everyone in your class.\n\n` +
      `*Q: Do I need to keep the tab open?*\n` +
      `Yes, keep your iClicker tab open (it can be in the background). The extension monitors it for polls.\n\n` +
      `*Q: Why should I share with classmates?*\n` +
      `More classmates = better detection! When ANYONE detects a poll, EVERYONE gets notified. It's like having multiple lookouts.\n\n` +
      `*Q: Is it free?*\n` +
      `Yes, completely free!\n\n` +
      `*Q: Is my data safe?*\n` +
      `Yes. We only store your Telegram chat ID and which classes you join. No personal info, no passwords.\n\n` +
      `*Q: It's not working!*\n` +
      `Try these steps:\n` +
      `1. Refresh the iClicker page\n` +
      `2. Run /sync to check token\n` +
      `3. Run /debug to see status\n` +
      `4. Reconnect: /code\n\n` +
      `*Still stuck?* Send /feedback with your issue!`
    );
    return new Response('OK');
  }

  // Handle /sync command - show token to verify extension matches
  if (text === '/sync') {
    if (foundUserToken) {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
        `🔄 *Token Sync Check*\n\n` +
        `Your bot token starts with:\n\`${foundUserToken.substring(0, 12)}...\`\n\n` +
        `Open the extension popup and check the console (F12) for the extension's token.\n\n` +
        `If they don't match, click "Disconnect" in the extension, then run /code here to get a new code and reconnect.`
      );
    } else {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
        `❌ No token found. Run /code to register.`
      );
    }
    return new Response('OK');
  }

  // Handle /debug command - show debug info
  if (text === '/debug') {
    let debugInfo = `🔧 *Debug Info*\n\n`;
    debugInfo += `Chat ID: \`${chatId}\`\n\n`;

    if (foundUserToken) {
      debugInfo += `User Token: \`${foundUserToken.substring(0, 8)}...\`\n`;
      debugInfo += `Registered: ✅\n\n`;

      // Check active session
      const activeSession = await env.USERS.get(`activesession:${foundUserToken}`);
      if (activeSession) {
        const session = JSON.parse(activeSession);
        debugInfo += `*Active Session:*\n`;
        debugInfo += `Activity: \`${session.activityId || 'none'}\`\n`;
        debugInfo += `Course: \`${session.courseId || 'none'}\`\n\n`;
      } else {
        debugInfo += `Active Session: ❌ None\n\n`;
      }

      // Check enrolled classes
      const userClasses = await env.USERS.list({ prefix: `userclass:${foundUserToken}:` });
      debugInfo += `*Enrolled Classes:* ${userClasses.keys.length}\n`;
      for (const key of userClasses.keys) {
        const courseId = key.name.replace(`userclass:${foundUserToken}:`, '');
        debugInfo += `• \`${courseId.substring(0, 8)}...\`\n`;
      }
    } else {
      debugInfo += `Registered: ❌\n`;
      debugInfo += `Send /start to register.`;
    }

    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, debugInfo);
    return new Response('OK');
  }

  // Handle /help command - show all available commands
  if (text === '/help' || text === 'help' || text === '?') {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      `🔔 *iClicker Notifier - Help*\n\n` +
      `*Available Commands:*\n\n` +
      `🚀 /start - Welcome message & setup\n` +
      `📍 /sessions - View your current active session\n` +
      `📚 /class - View your enrolled classes\n` +
      `🔑 /code - Get a new registration code\n` +
      `❓ /questions - Frequently asked questions\n` +
      `💬 /feedback - Send feedback or report issues\n` +
      `🔄 /sync - Verify extension token matches\n` +
      `🔧 /debug - Show detailed debug info\n` +
      `❓ /help - Show this help message\n\n` +
      `*How it works:*\n` +
      `1️⃣ Install the Chrome extension\n` +
      `2️⃣ Connect with /code\n` +
      `3️⃣ Visit your iClicker page & click the extension\n` +
      `4️⃣ When anyone detects a poll, everyone gets notified!\n\n` +
      `*Tips:*\n` +
      `• Keep your iClicker tab open for active session\n` +
      `• Classes are saved permanently\n` +
      `• Session auto-expires when you close the tab\n\n` +
      `_The extension works best when multiple classmates use it!_`
    );
    return new Response('OK');
  }

  // Handle /sessions command - show current active session
  if (text === '/sessions' || text === '/status' || text === 'sessions' || text === 'status') {
    // Find user's token by their chatId (using reverse lookup)
    let userToken = await env.USERS.get(`chat:${chatId}`);

    // Fallback to old method if reverse lookup not found
    if (!userToken) {
      for (const key of existingUsers.keys) {
        const storedChatId = await env.USERS.get(key.name);
        if (storedChatId === chatId.toString()) {
          userToken = key.name.replace('user:', '');
          // Store reverse lookup for next time
          await env.USERS.put(`chat:${chatId}`, userToken);
          break;
        }
      }
    }

    if (!userToken) {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
        `❌ *Not Connected*\n\n` +
        `You haven't connected the Chrome extension yet.\n\n` +
        `Send /start to get a registration code.`
      );
      return new Response('OK');
    }

    // Check for active session
    const activeSessionData = await env.USERS.get(`activesession:${userToken}`);

    if (!activeSessionData) {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
        `📍 *No Active Session*\n\n` +
        `You're not currently in any session.\n\n` +
        `Visit your iClicker page to join a session.\n\n` +
        `Use /class to see your enrolled courses.`
      );
      return new Response('OK');
    }

    const activeSession = JSON.parse(activeSessionData);
    let memberCount = 0;

    // Get member count from the active session
    // First try activity members (more specific), then fall back to course members
    if (activeSession.activityId) {
      const activityMembers = await env.USERS.list({ prefix: `activity:${activeSession.activityId}:user:` });
      memberCount = activityMembers.keys.length;
    }

    // If no activity members or no activity ID, count course members
    if (memberCount === 0 && activeSession.courseId) {
      const courseMembers = await env.USERS.list({ prefix: `class:${activeSession.courseId}:user:` });
      memberCount = courseMembers.keys.length;
    }

    const sessionInfo =
      `📍 *Active Session*\n\n` +
      `🟢 *Currently in session*\n\n` +
      (activeSession.activityId ? `Activity: \`${activeSession.activityId.substring(0, 8)}...\`\n` : '') +
      (activeSession.courseId ? `🎓 Course: \`${activeSession.courseId.substring(0, 8)}...\`\n` : '') +
      `\n👥 *${memberCount}* ${memberCount === 1 ? 'student' : 'students'} active\n\n` +
      `_When anyone detects a poll, you'll be notified!_\n\n` +
      `Use /class to see all your enrolled courses.`;

    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, sessionInfo);
    return new Response('OK');
  }

  // Handle /class command - show enrolled courses
  if (text === '/class' || text === '/classes' || text === 'class' || text === 'classes') {
    // Find user's token by their chatId (using reverse lookup)
    let userToken = await env.USERS.get(`chat:${chatId}`);

    // Fallback to old method if reverse lookup not found
    if (!userToken) {
      for (const key of existingUsers.keys) {
        const storedChatId = await env.USERS.get(key.name);
        if (storedChatId === chatId.toString()) {
          userToken = key.name.replace('user:', '');
          // Store reverse lookup for next time
          await env.USERS.put(`chat:${chatId}`, userToken);
          break;
        }
      }
    }

    if (!userToken) {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
        `❌ *Not Connected*\n\n` +
        `You haven't connected the Chrome extension yet.\n\n` +
        `Send /start to get a registration code.`
      );
      return new Response('OK');
    }

    // Find all classes this user is enrolled in
    const userClasses = await env.USERS.list({ prefix: `userclass:${userToken}:` });

    if (userClasses.keys.length === 0) {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
        `📚 *No Classes Yet*\n\n` +
        `You haven't joined any classes.\n\n` +
        `Visit your iClicker page and click the extension to enroll in a class.`
      );
      return new Response('OK');
    }

    // Build classes list
    let classInfo = `📚 *Your Classes*\n\n`;

    for (const key of userClasses.keys) {
      const courseId = key.name.replace(`userclass:${userToken}:`, '');
      const classMembers = await env.USERS.list({ prefix: `class:${courseId}:user:` });
      const memberCount = classMembers.keys.length;

      classInfo += `• \`${courseId.substring(0, 8)}...\`\n`;
      classInfo += `  👥 ${memberCount} ${memberCount === 1 ? 'student' : 'students'} enrolled\n\n`;
    }

    classInfo += `_These are saved permanently. Use /sessions to see your current active session._`;

    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, classInfo);
    return new Response('OK');
  }

  // If user wants a new code explicitly, or isn't registered
  if (text === '/start' || text === '/code' || text === 'code' || !isAlreadyRegistered) {
    // Rate limit code generation (1 code per 2 minutes per user)
    const codeRateLimitKey = `codelimit:${chatId}`;
    const lastCodeRequest = await env.USERS.get(codeRateLimitKey);
    if (lastCodeRequest) {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
        `⏳ *Please wait*\n\nYou can request a new code in 2 minutes.\n\n_This prevents spam._`
      );
      return new Response('OK');
    }

    // Set rate limit (2 minutes)
    await env.USERS.put(codeRateLimitKey, '1', { expirationTtl: 120 });

    // Generate a 6-digit registration code
    const code = generateCode();

    // Store the code -> chatId mapping (expires in 10 minutes)
    await env.USERS.put(`code:${code}`, chatId.toString(), { expirationTtl: 600 });

    // Send the code to the user
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      `🔔 *iClicker Notifier*\n\n` +
      `Your registration code is:\n\n` +
      `\`${code}\`\n\n` +
      `Enter this code in the Chrome extension to connect your account.\n\n` +
      `_This code expires in 10 minutes._`
    );
  } else {
    // User is already registered
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      `✅ *You're already connected!*\n\n` +
      `You'll receive notifications here when iClicker polls start.\n\n` +
      `Commands:\n` +
      `• /sessions - View your current active session\n` +
      `• /class - View your enrolled classes\n` +
      `• /code - Get a new registration code\n\n` +
      `_Keep your iClicker tab open for best results._`
    );
  }

  return new Response('OK');
}

/**
 * Handle registration - extension sends code, we verify and store
 */
async function handleRegister(request, env, corsHeaders) {
  const { code } = await request.json();

  if (!code || code.length !== 6) {
    return jsonResponse({ error: 'Invalid code format' }, 400, corsHeaders);
  }

  // Look up the code
  const chatId = await env.USERS.get(`code:${code}`);

  if (!chatId) {
    return jsonResponse({ error: 'Invalid or expired code. Please get a new code from the bot.' }, 400, corsHeaders);
  }

  // Delete the code so it can't be reused
  await env.USERS.delete(`code:${code}`);

  // Check if this chatId already has a token - if so, delete the old one
  const existingToken = await env.USERS.get(`chat:${chatId}`);
  if (existingToken) {
    // Clean up old token and its data
    await env.USERS.delete(`user:${existingToken}`);
    await env.USERS.delete(`activesession:${existingToken}`);
    // Note: We keep class enrollments as they're still valid
    console.log('Cleaned up old token for chatId:', chatId);
  }

  // Generate a unique user token for this registration
  const userToken = generateUserToken();

  // Store userToken -> chatId mapping (permanent)
  await env.USERS.put(`user:${userToken}`, chatId);

  // Store reverse lookup: chatId -> userToken (for faster command lookups)
  await env.USERS.put(`chat:${chatId}`, userToken);

  // Send confirmation message
  await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
    `✅ *Connected!*\n\n` +
    `You'll now receive Telegram notifications when an iClicker poll starts.\n\n` +
    `Keep the iClicker tab open in your browser for this to work.`
  );

  return jsonResponse({ success: true, userToken }, 200, corsHeaders);
}

/**
 * Handle notification - extension triggers this when poll starts
 */
async function handleNotify(request, env, corsHeaders) {
  const { userToken, title, message } = await request.json();

  if (!userToken) {
    return jsonResponse({ error: 'Missing userToken' }, 400, corsHeaders);
  }

  // Validate token format
  if (!/^[a-f0-9]{48}$/i.test(userToken)) {
    return jsonResponse({ error: 'Invalid userToken format' }, 400, corsHeaders);
  }

  // Look up the user
  const chatId = await env.USERS.get(`user:${userToken}`);

  if (!chatId) {
    return jsonResponse({ error: 'User not registered' }, 401, corsHeaders);
  }

  // Rate limiting - check last notification time
  const rateLimitKey = `ratelimit:${userToken}`;
  const lastNotify = await env.USERS.get(rateLimitKey);

  if (lastNotify) {
    const elapsed = Date.now() - parseInt(lastNotify);
    if (elapsed < RATE_LIMIT_SECONDS * 1000) {
      return jsonResponse({ error: 'Rate limited', retryAfter: RATE_LIMIT_SECONDS }, 429, corsHeaders);
    }
  }

  // Update rate limit
  await env.USERS.put(rateLimitKey, Date.now().toString(), { expirationTtl: RATE_LIMIT_SECONDS });

  // Send the notification
  const text = `*${title || '🔔 iClicker Poll Started!'}*\n\n${message || 'A new question is live - time to answer!'}`;

  const result = await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, text);

  if (!result.ok) {
    return jsonResponse({ error: 'Failed to send notification' }, 500, corsHeaders);
  }

  return jsonResponse({ success: true }, 200, corsHeaders);
}

/**
 * Handle join-class - user joins a class for broadcast notifications (legacy)
 */
async function handleJoinClass(request, env, corsHeaders) {
  const { userToken, courseId } = await request.json();

  if (!userToken || !courseId) {
    return jsonResponse({ error: 'Missing userToken or courseId' }, 400, corsHeaders);
  }

  // Validate input formats
  if (!isValidGuid(courseId)) {
    return jsonResponse({ error: 'Invalid courseId format' }, 400, corsHeaders);
  }
  if (!/^[a-f0-9]{48}$/i.test(userToken)) {
    return jsonResponse({ error: 'Invalid userToken format' }, 400, corsHeaders);
  }

  // Verify user exists
  const chatId = await env.USERS.get(`user:${userToken}`);
  if (!chatId) {
    return jsonResponse({ error: 'User not registered' }, 401, corsHeaders);
  }

  // Check if user is already in this class
  const existingMembership = await env.USERS.get(`class:${courseId}:user:${userToken}`);
  const isNewJoin = !existingMembership;

  // Add user to the class (store class membership)
  // Key format: class:{courseId}:user:{userToken} -> chatId
  await env.USERS.put(`class:${courseId}:user:${userToken}`, chatId);

  // Also store which classes this user is in (for potential cleanup)
  // Key format: userclass:{userToken}:{courseId} -> 1
  await env.USERS.put(`userclass:${userToken}:${courseId}`, '1');

  // Send welcome message only for new class joins
  if (isNewJoin) {
    // Get count of users in this class
    const classMembers = await env.USERS.list({ prefix: `class:${courseId}:user:` });
    const memberCount = classMembers.keys.length;

    const welcomeMessage =
      `📚 *Joined Class!*\n\n` +
      `You're now connected to:\n` +
      `\`${courseId}\`\n\n` +
      `👥 *${memberCount}* ${memberCount === 1 ? 'student' : 'students'} in this class\n\n` +
      `When anyone detects a poll, everyone gets notified! Keep your iClicker tab open for best results.`;

    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, welcomeMessage);
  }

  return jsonResponse({ success: true, courseId, isNewJoin }, 200, corsHeaders);
}

/**
 * Handle join-session - user joins a class AND/OR activity session
 * Activity ID is preferred for live sessions, course ID for persistent class membership
 */
async function handleJoinSession(request, env, corsHeaders) {
  const { userToken, courseId, activityId } = await request.json();

  if (!userToken || (!courseId && !activityId)) {
    return jsonResponse({ error: 'Missing userToken or both courseId and activityId' }, 400, corsHeaders);
  }

  // Validate input formats
  if (courseId && !isValidGuid(courseId)) {
    return jsonResponse({ error: 'Invalid courseId format' }, 400, corsHeaders);
  }
  if (activityId && !isValidGuid(activityId)) {
    return jsonResponse({ error: 'Invalid activityId format' }, 400, corsHeaders);
  }
  if (!/^[a-f0-9]{48}$/i.test(userToken)) {
    return jsonResponse({ error: 'Invalid userToken format' }, 400, corsHeaders);
  }

  // Verify user exists
  const chatId = await env.USERS.get(`user:${userToken}`);
  if (!chatId) {
    return jsonResponse({ error: 'User not registered' }, 401, corsHeaders);
  }

  let isNewJoin = false;
  let joinedCourse = false;
  let joinedActivity = false;
  let isNewSession = false;

  // Check if this is a different session than current
  const currentActiveSession = await env.USERS.get(`activesession:${userToken}`);
  let previousSession = null;
  if (currentActiveSession) {
    previousSession = JSON.parse(currentActiveSession);
    // It's a new session if the activity ID is different
    if (previousSession.activityId !== activityId) {
      isNewSession = true;
    }
  } else {
    isNewSession = true;
  }

  // Join the course (persistent membership)
  if (courseId) {
    const existingCourseMembership = await env.USERS.get(`class:${courseId}:user:${userToken}`);
    if (!existingCourseMembership) {
      await env.USERS.put(`class:${courseId}:user:${userToken}`, chatId);
      await env.USERS.put(`userclass:${userToken}:${courseId}`, '1');
      joinedCourse = true;
      isNewJoin = true;
    }
  }

  // Join the activity session (for live notifications)
  if (activityId) {
    const existingActivityMembership = await env.USERS.get(`activity:${activityId}:user:${userToken}`);
    if (!existingActivityMembership) {
      // Activity memberships expire after 6 hours (sessions don't last forever)
      await env.USERS.put(`activity:${activityId}:user:${userToken}`, chatId, { expirationTtl: 21600 });
      await env.USERS.put(`useractivity:${userToken}:${activityId}`, '1', { expirationTtl: 21600 });
      joinedActivity = true;
      isNewJoin = true;
    }
  }

  // Always update/refresh the active session (10 minute TTL - refreshed by heartbeat)
  const activeSessionData = JSON.stringify({
    activityId,
    courseId,
    joinedAt: Date.now()
  });
  await env.USERS.put(`activesession:${userToken}`, activeSessionData, { expirationTtl: 600 });

  // Send welcome message for new session joins
  if (isNewSession) {
    let memberCount = 0;

    // Get member count - prefer activity, fall back to course
    if (activityId) {
      const activityMembers = await env.USERS.list({ prefix: `activity:${activityId}:user:` });
      memberCount = activityMembers.keys.length;
    }
    if (memberCount === 0 && courseId) {
      const courseMembers = await env.USERS.list({ prefix: `class:${courseId}:user:` });
      memberCount = courseMembers.keys.length;
    }

    const welcomeMessage =
      `📍 *Joined Session!*\n\n` +
      `🟢 You're now active in:\n` +
      (activityId ? `Activity: \`${activityId.substring(0, 8)}...\`\n` : '') +
      (courseId ? `🎓 Course: \`${courseId.substring(0, 8)}...\`\n` : '') +
      `\n👥 *${memberCount}* ${memberCount === 1 ? 'student' : 'students'} in this session\n\n` +
      `When anyone detects a poll, everyone gets notified!\n\n` +
      `_Session auto-expires when you close the tab._`;

    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, welcomeMessage);
  }

  // Get member count for response - prefer activity, fall back to course
  let memberCount = 0;
  if (activityId) {
    const activityMembers = await env.USERS.list({ prefix: `activity:${activityId}:user:` });
    memberCount = activityMembers.keys.length;
  }
  if (memberCount === 0 && courseId) {
    const classMembers = await env.USERS.list({ prefix: `class:${courseId}:user:` });
    memberCount = classMembers.keys.length;
  }

  return jsonResponse({
    success: true,
    courseId,
    activityId,
    isNewJoin,
    isNewSession,
    joinedCourse,
    joinedActivity,
    memberCount
  }, 200, corsHeaders);
}

/**
 * Handle leave-session - user leaves their current active session
 */
async function handleLeaveSession(request, env, corsHeaders) {
  const { userToken } = await request.json();

  if (!userToken) {
    return jsonResponse({ error: 'Missing userToken' }, 400, corsHeaders);
  }

  // Validate token format
  if (!/^[a-f0-9]{48}$/i.test(userToken)) {
    return jsonResponse({ error: 'Invalid userToken format' }, 400, corsHeaders);
  }

  // Verify user exists
  const chatId = await env.USERS.get(`user:${userToken}`);
  if (!chatId) {
    return jsonResponse({ error: 'User not registered' }, 401, corsHeaders);
  }

  // Get current active session before deleting
  const activeSessionData = await env.USERS.get(`activesession:${userToken}`);

  // Delete the active session
  await env.USERS.delete(`activesession:${userToken}`);

  if (activeSessionData) {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId,
      `👋 *Left Session*\n\n` +
      `You've left the active session.\n\n` +
      `Your class enrollment is still saved - use /class to see your classes.`
    );
  }

  return jsonResponse({ success: true }, 200, corsHeaders);
}

/**
 * Handle heartbeat - keep the active session alive
 */
async function handleHeartbeat(request, env, corsHeaders) {
  const { userToken, courseId, activityId } = await request.json();

  if (!userToken) {
    return jsonResponse({ error: 'Missing userToken' }, 400, corsHeaders);
  }

  // Validate input formats
  if (!/^[a-f0-9]{48}$/i.test(userToken)) {
    return jsonResponse({ error: 'Invalid userToken format' }, 400, corsHeaders);
  }
  if (courseId && !isValidGuid(courseId)) {
    return jsonResponse({ error: 'Invalid courseId format' }, 400, corsHeaders);
  }
  if (activityId && !isValidGuid(activityId)) {
    return jsonResponse({ error: 'Invalid activityId format' }, 400, corsHeaders);
  }

  // Verify user exists
  const chatId = await env.USERS.get(`user:${userToken}`);
  if (!chatId) {
    return jsonResponse({ error: 'User not registered' }, 401, corsHeaders);
  }

  // Refresh the active session TTL (10 minutes)
  const activeSessionData = JSON.stringify({
    activityId,
    courseId,
    joinedAt: Date.now()
  });
  await env.USERS.put(`activesession:${userToken}`, activeSessionData, { expirationTtl: 600 });

  return jsonResponse({ success: true }, 200, corsHeaders);
}

/**
 * Handle broadcast - notify all users in an activity/class when poll starts
 * Prefers activity ID (more specific to live session), falls back to course ID
 */
async function handleBroadcast(request, env, corsHeaders) {
  const { userToken, courseId, activityId, title, message } = await request.json();

  if (!userToken || (!courseId && !activityId)) {
    return jsonResponse({ error: 'Missing userToken or both courseId and activityId' }, 400, corsHeaders);
  }

  // Validate input formats
  if (courseId && !isValidGuid(courseId)) {
    return jsonResponse({ error: 'Invalid courseId format' }, 400, corsHeaders);
  }
  if (activityId && !isValidGuid(activityId)) {
    return jsonResponse({ error: 'Invalid activityId format' }, 400, corsHeaders);
  }
  if (!/^[a-f0-9]{48}$/i.test(userToken)) {
    return jsonResponse({ error: 'Invalid userToken format' }, 400, corsHeaders);
  }

  // Verify sender is a registered user
  const senderChatId = await env.USERS.get(`user:${userToken}`);
  if (!senderChatId) {
    return jsonResponse({ error: 'User not registered' }, 401, corsHeaders);
  }

  // Rate limit key - prefer activity ID (more specific)
  const rateLimitKey = `broadcast:${activityId || courseId}`;

  // Rate limiting for broadcasts (per activity/class)
  const lastBroadcast = await env.USERS.get(rateLimitKey);

  if (lastBroadcast) {
    const elapsed = Date.now() - parseInt(lastBroadcast);
    if (elapsed < RATE_LIMIT_SECONDS * 1000) {
      return jsonResponse({
        success: true,
        notified: 0,
        message: 'Rate limited - broadcast already sent recently'
      }, 200, corsHeaders);
    }
  }

  // Update broadcast rate limit
  await env.USERS.put(rateLimitKey, Date.now().toString(), { expirationTtl: RATE_LIMIT_SECONDS });

  // Collect unique chat IDs to notify (from both activity and course if available)
  const chatIdsToNotify = new Set();

  // Get users from activity (if available)
  if (activityId) {
    const activityMembers = await env.USERS.list({ prefix: `activity:${activityId}:user:` });
    for (const key of activityMembers.keys) {
      const chatId = await env.USERS.get(key.name);
      if (chatId) chatIdsToNotify.add(chatId);
    }
  }

  // Also get users from course (for users who joined via course page)
  if (courseId) {
    const classMembers = await env.USERS.list({ prefix: `class:${courseId}:user:` });
    for (const key of classMembers.keys) {
      const chatId = await env.USERS.get(key.name);
      if (chatId) chatIdsToNotify.add(chatId);
    }
  }

  if (chatIdsToNotify.size === 0) {
    return jsonResponse({ success: true, notified: 0 }, 200, corsHeaders);
  }

  // Send notification to all unique users
  const notificationText = `*${title || '🔔 iClicker Poll Started!'}*\n\n${message || 'A new question is live - time to answer!'}`;

  let notifiedCount = 0;
  const notificationPromises = [];

  for (const chatId of chatIdsToNotify) {
    notificationPromises.push(
      sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, chatId, notificationText)
        .then(result => {
          if (result.ok) notifiedCount++;
        })
        .catch(() => {})
    );
  }

  // Wait for all notifications to be sent
  await Promise.all(notificationPromises);

  return jsonResponse({
    success: true,
    notified: notifiedCount,
    activityId,
    courseId
  }, 200, corsHeaders);
}

/**
 * Send a message via Telegram Bot API
 */
async function sendTelegramMessage(botToken, chatId, text) {
  const response = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    })
  });
  return response.json();
}

/**
 * Generate a 6-digit registration code
 */
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Generate a secure user token
 */
function generateUserToken() {
  const array = new Uint8Array(24);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Helper to send JSON response
 */
function jsonResponse(data, status, corsHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
