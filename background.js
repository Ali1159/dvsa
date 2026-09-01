/**
 * DVSA Slot Scanner v4 - Background Service Worker
 * 
 * Handles cross-tab communication for the Snipe feature:
 * - Receives snipe requests from Instructor tab
 * - Performs HTTP-only snipe (no DOM navigation needed)
 * - Redirects user to confirmation page when done
 */

// Track active tabs
let instructorTabId = null;
let studentTabId = null;

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Message received:', message.type, 'from tab:', sender.tab?.id);
  
  // Handle async operations
  (async () => {
    try {
      switch (message.type) {
        case 'REGISTER_TAB':
          handleTabRegistration(message, sender);
          sendResponse({ success: true });
          break;
          
        case 'SNIPE_REQUEST':
          await handleSnipeRequest(message, sender);
          sendResponse({ success: true });
          break;
          
        case 'SNIPE_REQUEST_HTTP_ONLY':
          // New: HTTP-only snipe without opening calendar tab
          await handleHttpOnlySnipe(message, sender);
          sendResponse({ success: true });
          break;
          
        case 'SNIPE_STATUS_UPDATE':
          await handleSnipeStatusUpdate(message, sender);
          sendResponse({ success: true });
          break;
          
        case 'GET_TAB_INFO':
          sendResponse({
            instructorTabId,
            studentTabId,
            thisTabId: sender.tab?.id
          });
          break;
          
        default:
          console.log('[Background] Unknown message type:', message.type);
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('[Background] Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  
  return true; // Keep channel open for async response
});

// Handle tab registration
function handleTabRegistration(message, sender) {
  const tabId = sender.tab?.id;
  const siteType = message.siteType;
  
  if (siteType === 'INSTRUCTOR') {
    instructorTabId = tabId;
    console.log('[Background] Instructor tab registered:', tabId);
  } else if (siteType === 'STUDENT') {
    studentTabId = tabId;
    console.log('[Background] Student tab registered:', tabId);
  }
  
  // Store in chrome.storage for persistence
  chrome.storage.local.set({
    instructorTabId,
    studentTabId
  });
}

/**
 * Calculate timestamp from date and time
 * Input: "2026-05-12", "08:47"
 * Output: 1778572020000 (milliseconds since epoch)
 */
function calculateTimestamp(dateStr, timeStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  
  let hours = 0;
  let minutes = 0;
  
  const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (timeMatch) {
    hours = parseInt(timeMatch[1], 10);
    minutes = parseInt(timeMatch[2], 10);
    const period = (timeMatch[3] || '').toLowerCase();
    
    if (period === 'pm' && hours < 12) hours += 12;
    if (period === 'am' && hours === 12) hours = 0;
  }
  
  const date = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return date.getTime();
}

/**
 * HTTP-only snipe - does everything via fetch without DOM navigation
 * This skips opening the calendar page entirely
 */
async function handleHttpOnlySnipe(message, sender) {
  const snipeData = message.snipeData;
  console.log('[Background] HTTP-only snipe starting:', snipeData);
  
  // Notify instructor of progress
  notifyInstructorTab({
    type: 'SNIPE_STATUS',
    status: 'processing',
    details: 'Starting HTTP-only snipe...'
  });
  
  try {
    // Step 1: Find student tab to get cookies/session
    const studentTabs = await chrome.tabs.query({
      url: ['https://driverpracticaltest.dvsa.gov.uk/*']
    });
    
    if (studentTabs.length === 0) {
      throw new Error('No student portal tab found. Please open the student portal first.');
    }
    
    const studentTab = studentTabs[0];
    studentTabId = studentTab.id;
    
    console.log('[Background] Using student tab:', studentTab.id, studentTab.url);
    
    // Step 2: Get current execution and CSRF from student tab
    const pageInfo = await chrome.tabs.sendMessage(studentTab.id, {
      type: 'GET_PAGE_INFO'
    });
    
    if (!pageInfo || !pageInfo.csrf || !pageInfo.execution) {
      throw new Error('Could not get CSRF/execution from student page. Please refresh the page.');
    }
    
    console.log('[Background] Got page info:', pageInfo.execution);
    
    // Step 3: Calculate timestamp
    const timestamp = calculateTimestamp(snipeData.date, snipeData.time);
    console.log('[Background] Calculated timestamp:', timestamp);
    
    // Step 4: Perform HTTP POST via content script (for cookie access)
    const result = await chrome.tabs.sendMessage(studentTab.id, {
      type: 'EXECUTE_HTTP_SNIPE',
      csrf: pageInfo.csrf,
      execution: pageInfo.execution,
      timestamp: timestamp,
      snipeData: snipeData
    });
    
    if (result.success) {
      console.log('[Background] HTTP snipe successful!');
      notifyInstructorTab({
        type: 'SNIPE_STATUS',
        status: 'completed',
        details: 'Slot reserved successfully!'
      });
      
      // Focus student tab and navigate to confirmation
      if (result.redirectUrl) {
        await chrome.tabs.update(studentTab.id, { 
          active: true,
          url: result.redirectUrl
        });
      } else {
        await chrome.tabs.update(studentTab.id, { active: true });
      }
    } else {
      throw new Error(result.error || 'HTTP snipe failed');
    }
    
  } catch (error) {
    console.error('[Background] HTTP-only snipe error:', error);
    notifyInstructorTab({
      type: 'SNIPE_FAILED',
      reason: error.message
    });
  }
}

// Handle snipe request from Instructor tab
async function handleSnipeRequest(message, sender) {
  const snipeData = message.snipeData;
  console.log('[Background] Snipe request received:', snipeData);
  
  // Store snipe request
  await chrome.storage.local.set({
    activeSnipeRequest: {
      ...snipeData,
      status: 'pending',
      createdAt: Date.now()
    }
  });
  
  // Find student tab
  const tabs = await chrome.tabs.query({
    url: ['https://driverpracticaltest.dvsa.gov.uk/*']
  });
  
  if (tabs.length === 0) {
    console.log('[Background] No student tab found!');
    // Notify instructor tab of failure
    notifyInstructorTab({
      type: 'SNIPE_FAILED',
      reason: 'No student portal tab found. Please open the student portal first.'
    });
    return;
  }
  
  const studentTab = tabs[0];
  studentTabId = studentTab.id;
  
  console.log('[Background] Forwarding snipe request to student tab:', studentTab.id);
  
  // Send snipe request to student tab
  try {
    await chrome.tabs.sendMessage(studentTab.id, {
      type: 'EXECUTE_SNIPE',
      snipeData
    });
    
    // Focus the student tab (loading overlay will hide the calendar)
    chrome.tabs.update(studentTab.id, { active: true });
    
  } catch (error) {
    console.error('[Background] Failed to send to student tab:', error);
    notifyInstructorTab({
      type: 'SNIPE_FAILED',
      reason: 'Failed to communicate with student tab. Please refresh the student portal page.'
    });
  }
}

// Handle snipe status updates
async function handleSnipeStatusUpdate(message, sender) {
  const { status, details } = message;
  console.log('[Background] Snipe status update:', status, details);
  
  // Update stored snipe request
  const data = await chrome.storage.local.get('activeSnipeRequest');
  if (data.activeSnipeRequest) {
    await chrome.storage.local.set({
      activeSnipeRequest: {
        ...data.activeSnipeRequest,
        status,
        lastUpdate: Date.now(),
        details
      }
    });
  }
  
  // Notify instructor tab of status
  notifyInstructorTab({
    type: 'SNIPE_STATUS',
    status,
    details
  });
  
  // If completed or failed, clear the active request after a delay
  if (status === 'completed' || status === 'failed') {
    setTimeout(async () => {
      await chrome.storage.local.remove('activeSnipeRequest');
    }, 10000);
  }
}

// Notify instructor tab
async function notifyInstructorTab(message) {
  // Find instructor tab
  const tabs = await chrome.tabs.query({
    url: ['https://*.dvsa.gov.uk/*']
  });
  
  // Filter to only instructor portal (not student portal)
  const instructorTabs = tabs.filter(t => 
    !t.url.includes('driverpracticaltest.dvsa.gov.uk')
  );
  
  for (const tab of instructorTabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, message);
    } catch (error) {
      console.log('[Background] Failed to notify instructor tab:', tab.id, error);
    }
  }
}

// Clean up when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === instructorTabId) {
    instructorTabId = null;
    chrome.storage.local.remove('instructorTabId');
  }
  if (tabId === studentTabId) {
    studentTabId = null;
    chrome.storage.local.remove('studentTabId');
  }
});

console.log('[Background] DVSA Slot Scanner v4 service worker started');
