/**
 * DVSA Slot Scanner v4.5 - ULTRA OPTIMIZED with Auto-Refresh & Bypass
 * 
 * Features:
 * - Dual portal support (Instructor & Student)
 * - Fully customizable timing controls (ALL SLIDERS PRESERVED)
 * - Aggressive mode with warnings
 * - Real click counter with logging
 * - Mouse simulation anti-detection
 * - State-aware page detection (OPTIMIZED - NO UNNECESSARY DELAYS)
 * - AUTOMATIC scanning with direction toggle (NO KEY HOLDING)
 * - AUTO-REFRESH on request limit (44 default)
 * - AUTO-RESUME after refresh
 * - Warning popup suppression
 * - Live RPS/CPS stats
 * - BURST MODE for temporary speed boost
 * - 0ms RESERVATION DELAY = INSTANT SUBMIT
 */

(function () {
  if (window.__dvsaV4Loaded) return;
  window.__dvsaV4Loaded = true;

  // ============== SITE DETECTION ==============
  const SITE_TYPE = detectSiteType();
  
  function detectSiteType() {
    const host = location.hostname;
    if (host.includes('driverpracticaltest.dvsa.gov.uk')) {
      return 'STUDENT';
    }
    if (host.includes('dvsa.gov.uk')) {
      return 'INSTRUCTOR';
    }
    return 'UNKNOWN';
  }
  
  if (SITE_TYPE === 'UNKNOWN') {
    console.log('[DVSA Scanner] Unknown site, not loading');
    return;
  }
  
  console.log(`[DVSA Scanner v4.5] Loaded for ${SITE_TYPE} portal`);

  // ============== SITE-SPECIFIC CONFIG ==============
  const SITE_CONFIG = {
    INSTRUCTOR: {
      name: 'Instructor Portal',
      color: '#22c55e',
      navNextSelector: '#searchForWeeklySlotsNextAvailable',
      navPrevSelector: '#searchForWeeklySlotsPreviousAvailable',
      navNextAlt: 'a[href*="searchForWeeklySlotsNextAvailable"]',
      navPrevAlt: 'a[href*="searchForWeeklySlotsPreviousAvailable"]',
      slotCellSelector: 'td.day.slotsavailable',
      slotLinkSelector: 'a[href*="_eventId=searchForDaySlots"]',
      reserveSelector: 'a[id^="reserve_"], a[href*="_eventId=reserveSlot"]',
      dateRangeSelector: 'p.centre.bold',
      calendarType: 'weekly',
      useFetchForSlot: true,
      fetchHeaders: {
        "Accept": "text/html;type=ajax",
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest"
      }
    },
    STUDENT: {
      name: 'Student Portal',
      color: '#3b82f6',
      navNextSelector: '.BookingCalendar-nav--next.is-active',
      navPrevSelector: '.BookingCalendar-nav--prev.is-active',
      navNextAlt: 'a.BookingCalendar-nav--next',
      navPrevAlt: 'a.BookingCalendar-nav--prev',
      slotCellSelector: '.SlotPicker-slot-label',
      slotLinkSelector: 'input.SlotPicker-slot[type="radio"]',
      slotListSelector: '.SlotPicker-timeSlots',
      reserveSelector: '#slot-picker-form button[type="submit"], #slot-picker-form input[type="submit"], .continue-button',
      submitFormSelector: '#slot-picker-form',
      dateRangeSelector: '.BookingCalendar-currentMonth, .BookingCalendar-currentYear',
      calendarType: 'monthly',
      useFetchForSlot: false,
      fetchHeaders: {}
    }
  };
  
  const CONFIG = SITE_CONFIG[SITE_TYPE];

  // ============== GLOBAL CONFIG ==============
  const STATE_KEY = "__dvsa4Scanning";
  const DIR_KEY = "__dvsa4Dir";
  const SETTINGS_KEY = "__dvsa4Settings";
  const NONCE_KEY = "__dvsa4Nonce";
  const REQ_COUNT_KEY = "__dvsa4ReqCount";
  const CLICK_COUNT_KEY = "__dvsa4ClickCount";
  const AUTO_RESUME_KEY = "__dvsa4AutoResume";
  
  const MAX_LOG_ITEMS = 50;

  // ============== DEFAULT SETTINGS ==============
  const DEFAULT_SETTINGS = {
    startDate: "",
    endDate: "",
    maxReserves: 1,
    
    // Timing Controls - MAX SPEED DEFAULTS
    aggressive: false,
    domScanInterval: 30,
    reservationDelay: 0,        // 0ms = INSTANT SUBMIT
    holdSpeedMs: 400,
    
    // Aggressive Mode defaults - EXTREME SPEED
    aggressiveDomScan: 15,
    aggressiveReservationDelay: 0,  // 0ms = INSTANT SUBMIT
    aggressiveHoldSpeed: 200,
    
    // Safety
    burstMode: false,
    burstDuration: 5,
    
    // Auto-refresh settings
    autoRefresh: true,
    requestLimit: 44,
  };

  // ============== STATE ==============
  let scanning = false;
  let scanDirection = "next";
  let settings = loadSettings();
  let counters = { 
    slots: 0, 
    reserves: 0, 
    requests: 0, 
    errors: 0,
    clicks: parseInt(localStorage.getItem(CLICK_COUNT_KEY) || "0", 10),
    todayClicks: 0,
    sessionClicks: 0
  };
  let ui = null;
  let logItems = [];
  
  // Click tracking
  let clickStartTime = Date.now();
  let clicksPerMinute = 0;
  let lastClickTime = 0;
  
  // Nonce and referer
  let latestNonce = localStorage.getItem(NONCE_KEY) || extractNonceFromPage();
  let lastReferer = location.href;
  let requestCount = parseInt(localStorage.getItem(REQ_COUNT_KEY) || "0", 10);
  
  // Mouse simulator
  let mouseSimulatorInterval = null;

  // FETCH SCAN STATE
  let fetchScanActive = false;
  let fetchScanDirection = 'next';
  let fetchPageCount = 0;
  let fetchScanStartTime = 0;
  let processingSlot = false;
  
  // PER-SESSION REQUEST COUNTER (for auto-refresh)
  let sessionRequestCount = 0;
  
  // AUTO-REFRESH STATE
  let autoRefreshEnabled = settings.autoRefresh;
  
  // STATS TRACKING
  let statsInterval = null;
  let lastStats = { requests: 0, clicks: 0, time: 0 };
  let currentRps = 0;
  let currentCps = 0;

  // ============== AUTO-REFRESH LOGIC ==============
  function checkAndHandleAutoRefresh() {
    if (!autoRefreshEnabled) return false;
    
    if (sessionRequestCount >= settings.requestLimit) {
      log(`🔄 Request limit reached: ${sessionRequestCount}/${settings.requestLimit}`, true);
      setStatus(`🔄 Refreshing...`);
      
      localStorage.setItem(AUTO_RESUME_KEY, JSON.stringify({
        direction: fetchScanDirection,
        timestamp: Date.now()
      }));
      
      stopFetchScan();
      
      setTimeout(() => {
        location.reload();
      }, 0);
      
      return true;
    }
    
    return false;
  }
  
  function tryAutoResume() {
    try {
      const saved = localStorage.getItem(AUTO_RESUME_KEY);
      if (!saved) return false;
      
      const data = JSON.parse(saved);
      
      if (Date.now() - data.timestamp > 10000) {
        localStorage.removeItem(AUTO_RESUME_KEY);
        return false;
      }
      
      localStorage.removeItem(AUTO_RESUME_KEY);
      
      setTimeout(() => {
        log(`↪️ Auto-resuming ${data.direction} scan...`, true);
        startFetchScan(data.direction);
      }, 50);
      
      return true;
    } catch (e) {
      return false;
    }
  }

  // ============== STATS MONITORING ==============
  function startStatsInterval() {
    if (statsInterval) return;
    
    lastStats = { 
      requests: counters.requests, 
      clicks: counters.clicks, 
      time: Date.now() 
    };
    
    statsInterval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastStats.time) / 1000;
      
      if (elapsed > 0) {
        currentRps = ((counters.requests - lastStats.requests) / elapsed).toFixed(1);
        currentCps = ((counters.clicks - lastStats.clicks) / elapsed).toFixed(1);
      }
      
      updateStatsDisplay();
      
      lastStats = { 
        requests: counters.requests, 
        clicks: counters.clicks, 
        time: now 
      };
    }, 1000);
  }

  function stopStatsInterval() {
    if (statsInterval) {
      clearInterval(statsInterval);
      statsInterval = null;
    }
    currentRps = 0;
    currentCps = 0;
  }

  function updateStatsDisplay() {
    const el = document.getElementById("v4-stats-live");
    if (!el) return;
    
    const elapsed = fetchScanActive ? Math.round((Date.now() - fetchScanStartTime) / 1000) : 0;
    const pages = fetchPageCount;
    
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px;">
        <div style="color:${CONFIG.color};font-weight:600;">⚡ LIVE STATS</div>
        <div style="text-align:right;color:#64748b;">${elapsed}s</div>
        
        <div>Req: ${sessionRequestCount}/${settings.requestLimit}</div>
        <div style="text-align:right;color:#22c55e;">${currentRps}/s</div>
        
        <div>Clicks: ${counters.clicks}</div>
        <div style="text-align:right;color:#22c55e;">${currentCps}/s</div>
        
        <div>Pages: ${pages}</div>
        <div style="text-align:right;color:${fetchScanActive ? '#22c55e' : '#64748b'};">
          ${fetchScanActive ? '🔥 SCAN' : '⏸️ IDLE'}
        </div>
      </div>
    `;
  }

  // ============== UTILITY FUNCTIONS ==============
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // ============== TIMING GETTERS ==============
  function getCurrentHoldSpeed() {
    return settings.aggressive ? settings.aggressiveHoldSpeed : settings.holdSpeedMs;
  }

  function getCurrentDomScanInterval() {
    return settings.aggressive ? settings.aggressiveDomScan : settings.domScanInterval;
  }

  function getCurrentReservationDelay() {
    return settings.aggressive ? settings.aggressiveReservationDelay : settings.reservationDelay;
  }

  // ============== CLICK COUNTER ==============
  function trackClick(type = 'manual') {
    const now = Date.now();
    
    counters.clicks++;
    counters.todayClicks++;
    counters.sessionClicks++;
    
    localStorage.setItem(CLICK_COUNT_KEY, counters.clicks.toString());
    
    const minutesElapsed = (now - clickStartTime) / (1000 * 60);
    if (minutesElapsed > 0) {
      clicksPerMinute = Math.round(counters.sessionClicks / minutesElapsed);
    }
    
    lastClickTime = now;
    
    if (counters.sessionClicks % 10 === 0) {
      log(`🖱️ Click #${counters.clicks} (${clicksPerMinute}/min)`, true);
    }
    
    updateCounters();
  }

  // ============== MOUSE SIMULATOR ==============
  function startMouseSimulator() {
    if (mouseSimulatorInterval) return;
    
    mouseSimulatorInterval = setInterval(() => {
      if (!fetchScanActive) return;
      
      const event = new MouseEvent('mousemove', {
        bubbles: true,
        cancelable: true,
        clientX: randomBetween(100, window.innerWidth - 100),
        clientY: randomBetween(100, window.innerHeight - 100)
      });
      document.dispatchEvent(event);
    }, randomBetween(3000, 7000));
  }

  // ============== AUTO-DISMISS WARNING POPUP ==============
  function setupAutoWarningDismiss() {
    const style = document.createElement('style');
    style.id = 'dvsa-hide-warning';
    style.textContent = `
      .ui-dialog[aria-describedby="back-button-warning-dialog"],
      #back-button-warning-dialog,
      #back-button-warning,
      div[role="dialog"][aria-describedby="back-button-warning-dialog"] {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
        width: 0 !important;
        height: 0 !important;
        position: fixed !important;
        left: -99999px !important;
        top: -99999px !important;
      }
      
      .ui-widget-overlay.ui-front,
      .ui-widget-overlay {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        background: transparent !important;
        pointer-events: none !important;
        width: 0 !important;
        height: 0 !important;
      }
    `;
    document.head.appendChild(style);
    
    setInterval(() => {
      try {
        const closeBtn = document.getElementById('backButtonCloseDialog');
        if (closeBtn) closeBtn.click();
        
        const dialog = document.querySelector('.ui-dialog[aria-describedby="back-button-warning-dialog"]');
        if (dialog) dialog.remove();
        
        const overlay = document.querySelector('.ui-widget-overlay');
        if (overlay) overlay.remove();
      } catch (e) {}
    }, 500);
    
    log('🛡️ Warning popup suppression active', false);
  }

  // ============== NAVIGATION URL EXTRACTION ==============
  function getNavigationUrl(direction) {
    const selector = direction === 'next' 
      ? CONFIG.navNextSelector + ', ' + CONFIG.navNextAlt
      : CONFIG.navPrevSelector + ', ' + CONFIG.navPrevAlt;
    
    const link = document.querySelector(selector);
    if (!link) return null;
    
    const href = link.getAttribute('href');
    if (!href) return null;
    
    return buildUrl(href);
  }

  function extractNavUrlFromDoc(doc, direction) {
    const selector = direction === 'next'
      ? CONFIG.navNextSelector + ', ' + CONFIG.navNextAlt
      : CONFIG.navPrevSelector + ', ' + CONFIG.navPrevAlt;
    
    const link = doc.querySelector(selector);
    if (!link) return null;
    
    const href = link.getAttribute('href');
    if (!href) return null;
    
    return buildUrl(href);
  }

  // ============== SLOT DETECTION ==============
  function checkSlotsInDoc(doc) {
    if (SITE_TYPE === 'INSTRUCTOR') {
      return checkInstructorSlotsInDoc(doc);
    } else {
      return checkStudentSlotsInDoc(doc);
    }
  }

  function checkInstructorSlotsInDoc(doc) {
    const slotCells = doc.querySelectorAll(CONFIG.slotCellSelector);
    if (slotCells.length === 0) return null;

    for (const cell of slotCells) {
      const slotLink = cell.querySelector(CONFIG.slotLinkSelector) || cell.querySelector('a');
      if (slotLink) {
        const slotUrl = slotLink.getAttribute('href');
        if (slotUrl) {
          const dateInfo = extractDateFromCell(cell, doc);
          return {
            found: true,
            slotUrl: buildUrl(slotUrl),
            dateInfo: dateInfo
          };
        }
      }
    }
    return null;
  }

  function checkStudentSlotsInDoc(doc) {
    const slotList = doc.querySelector(CONFIG.slotListSelector);
    if (!slotList) return null;
    
    const slots = slotList.querySelectorAll(CONFIG.slotLinkSelector);
    if (slots.length === 0) return null;
    
    const firstSlot = slots[0];
    const slotId = firstSlot.id || firstSlot.value;
    const dateLabel = firstSlot.getAttribute('data-datetime-label') || '';
    
    return {
      found: true,
      slotId: slotId,
      slotElement: firstSlot,
      dateLabel: dateLabel
    };
  }

  // ============== DATE EXTRACTION ==============
  function extractDateFromCell(cell, doc) {
    if (!cell || typeof cell.cellIndex !== "number") return null;
    
    const rangeEl = doc.querySelector(CONFIG.dateRangeSelector);
    if (!rangeEl) return null;
    
    const text = rangeEl.textContent.replace(/\s+/g, " ").trim();
    const matches = [...text.matchAll(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/g)];
    
    if (!matches.length) return null;
    
    const [d1, m1, y1] = matches[0].slice(1);
    const start = new Date(`${m1} ${d1}, ${y1}`);
    
    const offset = cell.cellIndex - 1;
    if (offset < 0) return null;
    
    const d = new Date(start);
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  }

  // ============== FETCH CORE ==============
  async function fetchPage(url) {
    bump("requests");
    sessionRequestCount++;
    trackClick('fetch');
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        redirect: 'follow',
        headers: {
          ...CONFIG.fetchHeaders,
          'Referer': lastReferer
        }
      });
      
      lastReferer = url;
      
      const nonce = response.headers.get('csrf-nonce');
      if (nonce) updateNonce(nonce);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      return doc;
      
    } catch (error) {
      bump("errors");
      throw error;
    }
  }

  // ============== MAIN FETCH SCAN LOOP ==============
  async function startFetchScan(direction) {
    if (fetchScanActive) return;
    
    sessionRequestCount = 0;
    
    fetchScanActive = true;
    fetchScanDirection = direction;
    fetchPageCount = 0;
    fetchScanStartTime = Date.now();
    processingSlot = false;
    
    startStatsInterval();
    updateButtons();
    
    log(`🚀 SCAN: ${direction === 'next' ? 'Forward →' : '← Backward'}`, true);
    log(`⚡ Speed: ${getCurrentHoldSpeed()}ms | DOM: ${getCurrentDomScanInterval()}ms | Reserve: ${getCurrentReservationDelay()}ms`, true);
    setStatus(`🔍 Scanning ${direction}...`);
    
    let currentUrl = getNavigationUrl(direction);
    
    if (!currentUrl) {
      log('⚠️ No navigation link found', true);
      setStatus('⚠️ No nav link');
      fetchScanActive = false;
      stopStatsInterval();
      updateButtons();
      return;
    }
    
    while (fetchScanActive && !processingSlot) {
      if (checkAndHandleAutoRefresh()) {
        stopFetchScan();
        return;
      }
      
      try {
        fetchPageCount++;
        
        setStatus(`🔍 Page ${fetchPageCount} | Req: ${sessionRequestCount}/${settings.requestLimit}`);
        
        const t0 = performance.now();
        const doc = await fetchPage(currentUrl);
        
        const slotResult = checkSlotsInDoc(doc);
        
        if (slotResult && slotResult.found) {
          processingSlot = true;
          bump("slots");
          
          const dateStr = slotResult.dateInfo || 'unknown';
          fetchScanActive = false;
          stopStatsInterval();
          updateButtons();
          
          log(`🎯 SLOT FOUND! ${dateStr}`, true);
          setStatus(`✅ Slot found! Processing...`);
          
          if (SITE_TYPE === 'INSTRUCTOR') {
            await processInstructorSlot(slotResult.slotUrl);
          } else {
            await processStudentSlot(slotResult);
          }
          
          processingSlot = false;
          return;
        }
        
        const nextUrl = extractNavUrlFromDoc(doc, direction);
        
        if (!nextUrl) {
          log(`⏹️ End of calendar`, true);
          setStatus(`⏹️ End of calendar`);
          break;
        }
        
        currentUrl = nextUrl;
        
        const fetchElapsed = performance.now() - t0;
        const holdSpeed = getCurrentHoldSpeed();
        const spare = Math.max(0, holdSpeed - fetchElapsed);
        if (spare > 5) {
          if (settings.aggressive || settings.burstMode) {
            await sleep(Math.min(spare, 30));
          } else {
            await sleep(spare);
          }
        }
        
      } catch (error) {
        log(`❌ Error: ${error.message}`, true);
        
        if (error.message.includes('403') || error.message.includes('429')) {
          log('⚠️ Rate limited - pause 1.5s', true);
          setStatus('⚠️ Rate limited');
          await sleep(1500);
        } else if (error.message.includes('401')) {
          log('🔒 Session expired', true);
          setStatus('🔒 Session expired');
          break;
        } else {
          await sleep(150);
        }
      }
    }
    
    stopFetchScan();
  }

  function stopFetchScan() {
    if (!fetchScanActive) return;
    fetchScanActive = false;
    stopStatsInterval();
    updateButtons();
    setStatus('Ready');
    log(`⏹️ Scan stopped (${fetchPageCount} pages, ${sessionRequestCount} requests)`, true);
    updateCounters();
  }

  // ============== PROCESS SLOTS ==============
  async function processInstructorSlot(slotUrl) {
    try {
      const dayDoc = await fetchPage(slotUrl);
      
      let reserveLink = dayDoc.querySelector("a[id^='reserve_']") 
        || dayDoc.querySelector("a[href*='_eventId=reserveSlot']")
        || dayDoc.querySelector("a[href*='reserve']");
      
      if (!reserveLink) {
        log("⚠️ No reserve link", true);
        return;
      }
      
      const reserveUrl = buildUrl(reserveLink.getAttribute('href'));
      await executeReserve(reserveUrl);
      
    } catch (err) {
      log(`❌ Reserve error: ${err.message}`, true);
      bump("errors");
    }
  }

  async function processStudentSlot(slotResult) {
    try {
      const slotElement = slotResult.slotElement;
      slotElement.click();
      trackClick('slot');
      
      const delay = getCurrentReservationDelay();
      if (delay > 0) {
        setTimeout(() => {
          submitStudentForm();
        }, delay);
      } else {
        submitStudentForm();
      }
      
    } catch (err) {
      log(`❌ Slot error: ${err.message}`, true);
      bump("errors");
      processingSlot = false;
    }
  }

  async function executeReserve(reserveUrl) {
    try {
      const reserveDoc = await fetchPage(reserveUrl);
      
      const errorIndicator = reserveDoc.querySelector('.error, .warning, [class*="error"]');
      
      if (errorIndicator) {
        log(`⚠️ Reserve issue: ${errorIndicator.textContent?.substring(0, 100)}`, true);
        setStatus(`⚠️ Check manually`);
      } else {
        log(`✅ RESERVED!`, true);
        bump("reserves");
        setStatus(`✅ Reserved!`);
        showReserveAlert("🎉 SLOT RESERVED!\nCheck your booking.");
      }
      
    } catch (err) {
      log(`❌ Reserve failed: ${err.message}`, true);
      setStatus(`❌ Reserve failed`);
      bump("errors");
    }
  }

  function submitStudentForm() {
    const form = document.querySelector(CONFIG.submitFormSelector);
    if (form) {
      const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
      if (submitBtn) {
        submitBtn.click();
        trackClick('submit');
        bump("requests");
        log("📤 Form submitted!", true);
        
        bump("reserves");
        log("🎉 SLOT SELECTED!", true);
        setStatus("✅ Slot selected!");
        showReserveAlert("🎉 SLOT SELECTED!\nContinue to complete booking.");
        processingSlot = false;
        return;
      }
    }
    
    const continueBtn = document.querySelector('.continue-button, input[value="Continue"]');
    if (continueBtn) {
      continueBtn.click();
      trackClick('continue');
      bump("requests");
      log("📤 Continue clicked!", true);
    }
    
    processingSlot = false;
  }

  // ============== NONCE & URL HELPERS ==============
  function extractNonceFromPage() {
    const urlParams = new URLSearchParams(location.search);
    let nonce = urlParams.get('org.apache.catalina.filters.CSRF_NONCE');
    if (nonce) return nonce;
    
    const input = document.querySelector('input[name="org.apache.catalina.filters.CSRF_NONCE"]');
    if (input) return input.value;
    
    const link = document.querySelector('a[href*="CSRF_NONCE="]');
    if (link) {
      const match = link.href.match(/CSRF_NONCE=([A-F0-9]+)/i);
      if (match) return match[1];
    }
    return null;
  }

  function updateNonce(newNonce) {
    if (newNonce && newNonce !== latestNonce) {
      latestNonce = newNonce;
      localStorage.setItem(NONCE_KEY, newNonce);
    }
  }

  function buildUrl(url) {
    try {
      const u = new URL(url, location.href);
      
      if (!u.searchParams.has("js")) {
        u.searchParams.set("js", "true");
      }
      
      if (latestNonce && !u.searchParams.has("org.apache.catalina.filters.CSRF_NONCE")) {
        u.searchParams.set("org.apache.catalina.filters.CSRF_NONCE", latestNonce);
      }
      
      const eventId = u.searchParams.get("_eventId") || "";
      if (eventId && !u.searchParams.has("fragments")) {
        if (eventId.includes("searchForWeeklySlots") || 
            eventId.includes("searchForDaySlots") ||
            eventId.includes("reserveSlot")) {
          u.searchParams.set("fragments", "body,cancelButton");
        }
      }
      
      return u.toString();
    } catch {
      return url;
    }
  }

  // ============== SETTINGS ==============
  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      const settings = {
        startDate: saved.startDate || DEFAULT_SETTINGS.startDate,
        endDate: saved.endDate || DEFAULT_SETTINGS.endDate,
        maxReserves: Number(saved.maxReserves) || DEFAULT_SETTINGS.maxReserves,
        
        aggressive: Boolean(saved.aggressive),
        domScanInterval: Number(saved.domScanInterval) || DEFAULT_SETTINGS.domScanInterval,
        reservationDelay: saved.reservationDelay !== undefined ? Number(saved.reservationDelay) : DEFAULT_SETTINGS.reservationDelay,
        holdSpeedMs: Number(saved.holdSpeedMs) || DEFAULT_SETTINGS.holdSpeedMs,
        
        aggressiveDomScan: Number(saved.aggressiveDomScan) || DEFAULT_SETTINGS.aggressiveDomScan,
        aggressiveReservationDelay: saved.aggressiveReservationDelay !== undefined ? Number(saved.aggressiveReservationDelay) : DEFAULT_SETTINGS.aggressiveReservationDelay,
        aggressiveHoldSpeed: Number(saved.aggressiveHoldSpeed) || DEFAULT_SETTINGS.aggressiveHoldSpeed,
        
        burstMode: Boolean(saved.burstMode),
        burstDuration: Number(saved.burstDuration) || DEFAULT_SETTINGS.burstDuration,
        
        autoRefresh: saved.autoRefresh !== undefined ? Boolean(saved.autoRefresh) : DEFAULT_SETTINGS.autoRefresh,
        requestLimit: Number(saved.requestLimit) || DEFAULT_SETTINGS.requestLimit
      };
      
      localStorage.setItem('__dvsa4LastAggressive', settings.aggressive.toString());
      
      return settings;
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    localStorage.setItem('__dvsa4LastAggressive', settings.aggressive.toString());
  }

  // ============== KEYBOARD CONTROLS ==============
  function setupKeyboardControls() {
    document.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" && !e.repeat) {
        e.preventDefault();
        if (!fetchScanActive) startFetchScan("prev");
      }
      else if (e.key === "ArrowUp" && !e.repeat) {
        e.preventDefault();
        if (!fetchScanActive) startFetchScan("next");
      }
      else if (e.key === "Escape") {
        processingSlot = false;
        stopFetchScan();
        setStatus("Stopped");
        log("⏹️ Stopped by Escape", true);
      }
      else if (e.key === "b" && e.ctrlKey) {
        e.preventDefault();
        toggleBurstMode();
      }
    });
    
    log(`⌨️ ↑ = Forward | ↓ = Backward | Esc = Stop | Ctrl+B = Burst`, true);
  }

  // ============== BURST MODE ==============
  function toggleBurstMode() {
    if (settings.burstMode) {
      settings.burstMode = false;
      settings.aggressive = false;
      log(`🛡️ Burst mode OFF`, true);
    } else {
      settings.burstMode = true;
      settings.aggressive = true;
      log(`🚀 Burst mode ON - ${settings.burstDuration}min`, true);
      
      setTimeout(() => {
        if (settings.burstMode) {
          settings.burstMode = false;
          settings.aggressive = false;
          log(`🛡️ Burst mode ended`, true);
          if (ui.aggressiveToggle) ui.aggressiveToggle.checked = false;
          updateTimingControls();
        }
      }, settings.burstDuration * 60 * 1000);
    }
    
    if (ui.aggressiveToggle) ui.aggressiveToggle.checked = settings.aggressive;
    updateTimingControls();
    updateAggressiveWarning();
  }

  // ============== UI ==============
  function initUI() {
    ui = createPanel();
    fillSettings();
    updateButtons();
    updateCounters();
    updateTimingControls();
    updateAggressiveWarning();
    renderLog();
  }

  function createPanel() {
    const existing = document.getElementById("dvsa-v4-panel");
    if (existing) return bindPanel(existing);

    const root = document.createElement("div");
    root.id = "dvsa-v4-panel";
    root.style.cssText = `
      position: fixed;
      bottom: 18px;
      left: 18px;
      z-index: 2147483647;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #e2e8f0;
      padding: 14px;
      border-radius: 12px;
      min-width: 380px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 10px 40px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.1);
      font-size: 13px;
      line-height: 1.4;
    `;

    const title = document.createElement("div");
    title.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span style="font-weight:700;">DVSA Scanner v4.5</span>
        <div style="display: flex; gap: 6px; align-items: center;">
          <span style="font-size:11px;background:${CONFIG.color}40;color:${CONFIG.color};padding:2px 8px;border-radius:4px;font-weight:600;">
            ${SITE_TYPE}
          </span>
          <span style="font-size:10px;opacity:0.6;background:rgba(34,197,94,0.2);padding:2px 6px;border-radius:4px;" id="holdSpeedDisplay">
            ${getCurrentHoldSpeed()}ms
          </span>
          <span style="font-size:10px;opacity:0.6;background:rgba(239,68,68,0.2);padding:2px 6px;border-radius:4px;display:none;" id="burstTimer">
            5:00
          </span>
        </div>
      </div>
      <div style="font-size:10px;opacity:0.6;margin-bottom:8px;">
        ↑ = Forward | ↓ = Backward | Esc = Stop | Ctrl+B = Burst | 🔄 Auto-Refresh | 0ms = INSTANT
      </div>
    `;

    const status = document.createElement("div");
    status.id = "v4-status";
    status.dataset.status = "true";
    status.textContent = "Ready - Press ↑/↓ to scan";
    status.style.cssText = `margin-bottom:10px;padding:6px 10px;background:${CONFIG.color}20;border-radius:6px;font-size:12px;`;

    const statsLive = document.createElement("div");
    statsLive.id = "v4-stats-live";
    statsLive.style.cssText = `
      margin-bottom: 10px;
      padding: 10px;
      background: rgba(0,0,0,0.4);
      border-radius: 8px;
      border: 1px solid ${CONFIG.color}30;
    `;
    statsLive.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:11px;opacity:0.6;">
        <div>⚡ LIVE STATS</div>
        <div style="text-align:right;">0s</div>
        <div>Req: 0/44</div>
        <div style="text-align:right;">0.0/s</div>
        <div>Clicks: 0</div>
        <div style="text-align:right;">0.0/s</div>
        <div>Pages: 0</div>
        <div style="text-align:right;">⏸️ IDLE</div>
      </div>
    `;

    const controls = document.createElement("div");
    controls.style.cssText = "display:flex;gap:6px;margin-bottom:8px;align-items:stretch;";
    
    const startPrev = button("← Backward", "#3b82f6");
    startPrev.dataset.startPrev = "true";
    startPrev.style.flex = "1";
    
    const stop = button("⏹", "#ef4444");
    stop.dataset.stop = "true";
    stop.style.flex = "0 0 50px";
    stop.style.opacity = "0.5";
    
    const startNext = button("Forward →", CONFIG.color);
    startNext.dataset.startNext = "true";
    startNext.style.flex = "1";
    
    controls.append(startPrev, stop, startNext);

    const settingsBtn = button("⚙", "#64748b");
    settingsBtn.dataset.settings = "true";
    settingsBtn.style.flex = "0 0 40px";
    controls.appendChild(settingsBtn);

    const counts = document.createElement("div");
    counts.dataset.counts = "true";
    counts.style.cssText = "font-size:11px;opacity:0.8;margin-bottom:8px;display:grid;grid-template-columns:1fr 1fr;gap:4px;";

    const settingsPane = document.createElement("div");
    settingsPane.dataset.settingsPane = "true";
    settingsPane.style.cssText = "display:none;border-top:1px solid rgba(255,255,255,0.1);padding-top:10px;margin-top:8px;";

    const form = document.createElement("div");
    form.style.cssText = "display:grid;gap:8px;";

    const aggressiveWrap = document.createElement("div");
    aggressiveWrap.style.cssText = "font-size:11px;opacity:0.8;display:flex;justify-content:space-between;align-items:center;background:rgba(239,68,68,0.1);padding:8px;border-radius:6px;";
    
    const aggressiveLabel = document.createElement("span");
    aggressiveLabel.textContent = "⚡ Aggressive Mode";
    aggressiveLabel.style.cssText = "color:#fbbf24;font-weight:600;";
    
    const aggressiveToggle = document.createElement("input");
    aggressiveToggle.type = "checkbox";
    aggressiveToggle.dataset.aggressiveToggle = "true";
    aggressiveToggle.checked = settings.aggressive;
    aggressiveToggle.style.cssText = "transform:scale(1.2);";
    
    aggressiveWrap.appendChild(aggressiveLabel);
    aggressiveWrap.appendChild(aggressiveToggle);
    
    const aggressiveWarning = document.createElement("div");
    aggressiveWarning.id = "aggressiveWarning";
    aggressiveWarning.style.cssText = "font-size:10px;color:#f87171;margin-top:-4px;margin-bottom:8px;display:none;";
    aggressiveWarning.textContent = "⚠️ Higher risk of detection! Use with caution.";

    const refreshWrap = document.createElement("div");
    refreshWrap.style.cssText = "font-size:11px;opacity:0.8;display:flex;justify-content:space-between;align-items:center;background:rgba(34,197,94,0.1);padding:8px;border-radius:6px;margin-bottom:4px;";
    
    const refreshLabel = document.createElement("span");
    refreshLabel.textContent = "🔄 Auto-Refresh";
    refreshLabel.style.cssText = "color:#22c55e;font-weight:600;";
    
    const refreshToggle = document.createElement("input");
    refreshToggle.type = "checkbox";
    refreshToggle.dataset.refreshToggle = "true";
    refreshToggle.checked = settings.autoRefresh;
    refreshToggle.style.cssText = "transform:scale(1.2);";
    
    refreshWrap.appendChild(refreshLabel);
    refreshWrap.appendChild(refreshToggle);

    const limitWrap = labeledInput("Request Limit (auto-refresh)", "number");
    limitWrap.input.min = "10";
    limitWrap.input.max = "200";
    limitWrap.input.step = "1";
    limitWrap.input.dataset.requestLimit = "true";
    limitWrap.input.value = settings.requestLimit;

    const burstButton = button(`🚀 Burst Mode (${settings.burstDuration}min)`, "#8b5cf6");
    burstButton.style.fontSize = "11px";
    burstButton.dataset.burstButton = "true";
    
    const timingTitle = document.createElement("div");
    timingTitle.textContent = "⏱️ Timing Controls";
    timingTitle.style.cssText = "font-size:11px;font-weight:600;margin-top:8px;color:#8b5cf6;";

    const domScanWrap = labeledInput("DOM Scan Interval (ms)", "number");
    domScanWrap.input.min = "10";
    domScanWrap.input.max = "200";
    domScanWrap.input.step = "5";
    domScanWrap.input.dataset.domScan = "true";
    domScanWrap.input.title = "How often to scan page for slots";

    const reservationWrap = labeledInput("Reservation Delay (ms) - 0 = INSTANT", "number");
    reservationWrap.input.min = "0";
    reservationWrap.input.max = "1000";
    reservationWrap.input.step = "10";
    reservationWrap.input.dataset.reservationDelay = "true";
    reservationWrap.input.title = "0ms = Submit immediately with zero delay";
    reservationWrap.input.value = getCurrentReservationDelay();

    const holdSpeedWrap = document.createElement("div");
    holdSpeedWrap.style.cssText = "font-size:11px;opacity:0.8;display:flex;flex-direction:column;gap:4px;";
    holdSpeedWrap.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span>Hold Speed (ms)</span>
        <span style="font-family: monospace; background: rgba(34,197,94,0.2); padding: 2px 6px; border-radius: 4px;" id="holdSpeedValue">
          ${getCurrentHoldSpeed()}ms
        </span>
      </div>
    `;
    
    const holdSpeedInput = document.createElement("input");
    holdSpeedInput.type = "range";
    holdSpeedInput.min = "100";
    holdSpeedInput.max = "2000";
    holdSpeedInput.step = "50";
    holdSpeedInput.value = getCurrentHoldSpeed();
    holdSpeedInput.dataset.holdSpeed = "true";
    holdSpeedInput.style.cssText = "width:100%;height:6px;border-radius:3px;background:#334155;outline:none;";
    
    holdSpeedWrap.appendChild(holdSpeedInput);

    const speedPresets = document.createElement("div");
    speedPresets.style.cssText = "display:flex;gap:4px;margin-top:4px;";
    speedPresets.id = "speedPresets";
    holdSpeedWrap.appendChild(speedPresets);

    const presetTitle = document.createElement("div");
    presetTitle.textContent = "🎚️ Quick Presets";
    presetTitle.style.cssText = "font-size:11px;font-weight:600;margin-top:8px;color:#3b82f6;";

    const presetButtons = document.createElement("div");
    presetButtons.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;";

    const safePreset = button("🛡️ Safe", "#10b981");
    safePreset.style.fontSize = "11px";
    safePreset.addEventListener("click", () => {
      settings.aggressive = false;
      settings.domScanInterval = 50;
      settings.reservationDelay = 200;
      settings.holdSpeedMs = 600;
      aggressiveToggle.checked = false;
      updateTimingControls();
      updateAggressiveWarning();
      log("Applied SAFE preset", true);
    });

    const balancedPreset = button("⚖️ Balanced", "#f59e0b");
    balancedPreset.style.fontSize = "11px";
    balancedPreset.addEventListener("click", () => {
      settings.aggressive = false;
      settings.domScanInterval = 30;
      settings.reservationDelay = 0;
      settings.holdSpeedMs = 400;
      aggressiveToggle.checked = false;
      updateTimingControls();
      updateAggressiveWarning();
      log("Applied BALANCED preset (0ms reserve)", true);
    });

    const fastPreset = button("⚡ Fast", "#f97316");
    fastPreset.style.fontSize = "11px";
    fastPreset.addEventListener("click", () => {
      settings.aggressive = true;
      settings.domScanInterval = 20;
      settings.aggressiveReservationDelay = 0;
      settings.aggressiveHoldSpeed = 250;
      aggressiveToggle.checked = true;
      updateTimingControls();
      updateAggressiveWarning();
      log("Applied FAST preset (0ms reserve)", true);
    });

    const turboPreset = button("🚀 Turbo", "#ef4444");
    turboPreset.style.fontSize = "11px";
    turboPreset.addEventListener("click", () => {
      settings.aggressive = true;
      settings.domScanInterval = 15;
      settings.aggressiveReservationDelay = 0;
      settings.aggressiveHoldSpeed = 200;
      aggressiveToggle.checked = true;
      updateTimingControls();
      updateAggressiveWarning();
      log("Applied TURBO preset (0ms reserve)", true);
    });

    presetButtons.append(safePreset, balancedPreset, fastPreset, turboPreset);

    const startDate = labeledInput("Start Date", "date");
    startDate.input.dataset.startDate = "true";
    const endDate = labeledInput("End Date", "date");
    endDate.input.dataset.endDate = "true";
    const maxRes = labeledInput("Max Reserves", "number");
    maxRes.input.min = "1";
    maxRes.input.dataset.maxReserves = "true";

    const burstWrap = labeledInput("Burst Duration (min)", "number");
    burstWrap.input.min = "1";
    burstWrap.input.max = "30";
    burstWrap.input.dataset.burstDuration = "true";

    const saveBtn = button("💾 Save Settings", "#8b5cf6");
    saveBtn.dataset.save = "true";

    form.append(
      aggressiveWrap,
      aggressiveWarning,
      refreshWrap,
      limitWrap.wrap,
      burstButton,
      timingTitle,
      domScanWrap.wrap,
      reservationWrap.wrap,
      holdSpeedWrap,
      presetTitle,
      presetButtons,
      startDate.wrap,
      endDate.wrap,
      maxRes.wrap,
      burstWrap.wrap,
      saveBtn
    );
    settingsPane.append(form);

    const logWrap = document.createElement("div");
    logWrap.dataset.logWrap = "true";
    logWrap.style.cssText = "margin-top:10px;padding:8px;background:rgba(0,0,0,0.3);border-radius:8px;max-height:150px;overflow-y:auto;";

    const logTitle = document.createElement("div");
    logTitle.textContent = "📋 Activity Log";
    logTitle.style.cssText = "font-weight:600;margin-bottom:6px;font-size:11px;opacity:0.7;";

    const logList = document.createElement("div");
    logList.dataset.logList = "true";
    logList.style.cssText = "font-size:11px;line-height:1.4;opacity:0.9;font-family:monospace;";

    logWrap.append(logTitle, logList);
    root.append(title, status, statsLive, controls, counts, settingsPane, logWrap);
    
    document.body.appendChild(root);

    aggressiveToggle.addEventListener("change", function() {
      settings.aggressive = this.checked;
      updateTimingControls();
      updateAggressiveWarning();
      log(`Aggressive mode: ${this.checked ? 'ON ⚡' : 'OFF'}`, true);
    });
    
    refreshToggle.addEventListener("change", function() {
      settings.autoRefresh = this.checked;
      autoRefreshEnabled = this.checked;
      saveSettings();
      log(`🔄 Auto-refresh: ${this.checked ? 'ENABLED' : 'DISABLED'}`, true);
    });
    
    burstButton.addEventListener("click", toggleBurstMode);
    
    holdSpeedInput.addEventListener("input", () => {
      if (settings.aggressive) {
        settings.aggressiveHoldSpeed = parseInt(holdSpeedInput.value, 10);
      } else {
        settings.holdSpeedMs = parseInt(holdSpeedInput.value, 10);
      }
      updateHoldSpeedDisplay();
    });
    
    startNext.addEventListener("click", () => {
      if (!fetchScanActive) startFetchScan("next");
    });
    
    startPrev.addEventListener("click", () => {
      if (!fetchScanActive) startFetchScan("prev");
    });
    
    stop.addEventListener("click", () => {
      processingSlot = false;
      stopFetchScan();
      setStatus("Stopped by user");
    });
    
    settingsBtn.addEventListener("click", toggleSettings);
    saveBtn.addEventListener("click", saveSettingsFromUI);

    return bindPanel(root);
  }

  function bindPanel(root) {
    return {
      root,
      status: document.getElementById("v4-status"),
      startNext: root.querySelector("[data-start-next]"),
      startPrev: root.querySelector("[data-start-prev]"),
      stop: root.querySelector("[data-stop]"),
      counts: root.querySelector("[data-counts]"),
      settingsBtn: root.querySelector("[data-settings]"),
      settingsPane: root.querySelector("[data-settings-pane]"),
      startDate: root.querySelector("[data-start-date]"),
      endDate: root.querySelector("[data-end-date]"),
      maxRes: root.querySelector("[data-max-reserves]"),
      aggressiveToggle: root.querySelector("[data-aggressive-toggle]"),
      refreshToggle: root.querySelector("[data-refresh-toggle]"),
      requestLimit: root.querySelector("[data-request-limit]"),
      domScan: root.querySelector("[data-dom-scan]"),
      reservationDelay: root.querySelector("[data-reservation-delay]"),
      holdSpeedInput: root.querySelector("[data-hold-speed]"),
      burstDuration: root.querySelector("[data-burst-duration]"),
      burstButton: root.querySelector("[data-burst-button]"),
      saveBtn: root.querySelector("[data-save]"),
      logList: root.querySelector("[data-log-list]")
    };
  }

  function button(text, color) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.style.cssText = `
      flex: 1;
      border: none;
      padding: 8px 12px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 12px;
      background: ${color};
      color: white;
      transition: all 150ms ease;
    `;
    b.onmouseenter = () => b.style.filter = "brightness(1.1)";
    b.onmouseleave = () => b.style.filter = "";
    return b;
  }

  function labeledInput(label, type) {
    const wrap = document.createElement("label");
    wrap.style.cssText = "font-size:11px;opacity:0.8;display:flex;flex-direction:column;gap:4px;";
    wrap.textContent = label;
    const input = document.createElement("input");
    input.type = type;
    input.style.cssText = "padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:#0f172a;color:#e2e8f0;font-size:12px;";
    wrap.appendChild(input);
    return { wrap, input };
  }

  function toggleSettings() {
    const open = ui.settingsPane.style.display !== "none";
    ui.settingsPane.style.display = open ? "none" : "block";
  }

  function fillSettings() {
    if (ui.startDate) ui.startDate.value = settings.startDate || "";
    if (ui.endDate) ui.endDate.value = settings.endDate || "";
    if (ui.maxRes) ui.maxRes.value = settings.maxReserves;
    if (ui.domScan) ui.domScan.value = getCurrentDomScanInterval();
    if (ui.reservationDelay) ui.reservationDelay.value = getCurrentReservationDelay();
    if (ui.holdSpeedInput) ui.holdSpeedInput.value = getCurrentHoldSpeed();
    if (ui.burstDuration) ui.burstDuration.value = settings.burstDuration;
    if (ui.aggressiveToggle) ui.aggressiveToggle.checked = settings.aggressive;
    if (ui.refreshToggle) ui.refreshToggle.checked = settings.autoRefresh;
    if (ui.requestLimit) ui.requestLimit.value = settings.requestLimit;
  }

  function updateTimingControls() {
    if (ui.domScan) ui.domScan.value = getCurrentDomScanInterval();
    if (ui.reservationDelay) ui.reservationDelay.value = getCurrentReservationDelay();
    if (ui.holdSpeedInput) ui.holdSpeedInput.value = getCurrentHoldSpeed();
    updateHoldSpeedDisplay();
    updateSpeedPresets();
  }

  function updateSpeedPresets() {
    const presetsContainer = document.getElementById("speedPresets");
    if (!presetsContainer) return;
    
    const presets = settings.aggressive
      ? [
          { label: "Turbo", value: 200 },
          { label: "Fast", value: 250 },
          { label: "Quick", value: 300 }
        ]
      : [
          { label: "Fast", value: 400 },
          { label: "Normal", value: 600 },
          { label: "Slow", value: 1000 }
        ];
    
    presetsContainer.innerHTML = "";
    
    presets.forEach(preset => {
      const presetBtn = document.createElement("button");
      presetBtn.type = "button";
      presetBtn.textContent = preset.label;
      presetBtn.style.cssText = `
        flex: 1;
        border: none;
        padding: 4px 8px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 10px;
        background: ${preset.value === getCurrentHoldSpeed() ? CONFIG.color : '#334155'};
        color: white;
      `;
      presetBtn.addEventListener("click", () => {
        if (settings.aggressive) {
          settings.aggressiveHoldSpeed = preset.value;
        } else {
          settings.holdSpeedMs = preset.value;
        }
        if (ui.holdSpeedInput) ui.holdSpeedInput.value = preset.value;
        updateHoldSpeedDisplay();
        log(`Hold speed: ${preset.label} (${preset.value}ms)`, true);
      });
      presetsContainer.appendChild(presetBtn);
    });
  }

  function updateAggressiveWarning() {
    const warning = document.getElementById("aggressiveWarning");
    if (warning) {
      warning.style.display = settings.aggressive ? "block" : "none";
    }
  }

  function updateHoldSpeedDisplay() {
    const display = document.getElementById("holdSpeedDisplay");
    if (display) display.textContent = `${getCurrentHoldSpeed()}ms`;
    
    const value = document.getElementById("holdSpeedValue");
    if (value) value.textContent = `${getCurrentHoldSpeed()}ms`;
  }

  function saveSettingsFromUI() {
    const resDelay = Math.max(0, parseInt(ui.reservationDelay?.value, 10)) || 0;
    settings = {
      startDate: ui.startDate?.value || "",
      endDate: ui.endDate?.value || "",
      maxReserves: Math.max(1, parseInt(ui.maxRes?.value || "1", 10)),
      
      aggressive: Boolean(ui.aggressiveToggle?.checked),
      domScanInterval: parseInt(ui.domScan?.value || "30", 10),
      reservationDelay: resDelay,
      holdSpeedMs: parseInt(ui.holdSpeedInput?.value || "400", 10),
      
      aggressiveDomScan: parseInt(ui.domScan?.value || "15", 10) || settings.aggressiveDomScan,
      aggressiveReservationDelay: resDelay,
      aggressiveHoldSpeed: parseInt(ui.holdSpeedInput?.value || "200", 10) || settings.aggressiveHoldSpeed,
      
      burstMode: settings.burstMode || false,
      burstDuration: parseInt(ui.burstDuration?.value || "5", 10),
      
      autoRefresh: Boolean(ui.refreshToggle?.checked),
      requestLimit: parseInt(ui.requestLimit?.value || "44", 10)
    };
    
    autoRefreshEnabled = settings.autoRefresh;
    saveSettings();
    updateTimingControls();
    setStatus(`Settings saved ✓`);
    toggleSettings();
    log("Settings saved", true);
  }

  function setStatus(text) {
    const el = document.getElementById("v4-status");
    if (el) el.textContent = text;
  }

  function renderLog() {
    if (!ui?.logList) return;
    ui.logList.innerHTML = logItems.map(item => {
      const time = item.ts.toLocaleTimeString();
      const color = item.important ? "#fbbf24" : "#94a3b8";
      return `<div style="color:${color};margin-bottom:2px;"><span style="opacity:0.5;">[${time}]</span> ${item.text}</div>`;
    }).join("");
  }

  function log(text, important = false) {
    logItems.unshift({ ts: new Date(), text, important });
    if (logItems.length > MAX_LOG_ITEMS) logItems.pop();
    renderLog();
    if (important) console.log(`[DVSA v4.5] ${text}`);
  }

  function updateButtons() {
    const active = fetchScanActive;
    if (ui?.startNext) ui.startNext.style.opacity = active ? "0.5" : "1";
    if (ui?.startPrev) ui.startPrev.style.opacity = active ? "0.5" : "1";
    if (ui?.stop) ui.stop.style.opacity = active ? "1" : "0.5";
  }

  function updateCounters() {
    if (ui?.counts) {
      ui.counts.innerHTML = `
        <div>Req: ${counters.requests}</div>
        <div>Slots: ${counters.slots}</div>
        <div>Reserves: ${counters.reserves}</div>
        <div>Errors: ${counters.errors}</div>
        <div>Clicks: ${counters.clicks}</div>
        <div>Req/s: ${currentRps}</div>
      `;
    }
  }

  function bump(type) {
    counters[type] = (counters[type] || 0) + 1;
    updateCounters();
  }

  function showReserveAlert(message) {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    
    const box = document.createElement("div");
    box.style.cssText = `
      background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
      color: white;
      padding: 40px 60px;
      border-radius: 20px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.4);
      animation: dvsa-pulse 0.5s ease-in-out;
    `;
    
    box.innerHTML = `
      <div style="font-size: 48px; margin-bottom: 16px;">🎉</div>
      <div style="font-size: 24px; font-weight: bold; margin-bottom: 12px; white-space: pre-line;">${message}</div>
      <div style="font-size: 14px; opacity: 0.8;">Click anywhere to close</div>
    `;
    
    const style = document.createElement("style");
    style.textContent = `
      @keyframes dvsa-pulse {
        0% { transform: scale(0.8); opacity: 0; }
        50% { transform: scale(1.05); }
        100% { transform: scale(1); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
    
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    
    try {
      const audio = new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdX9/gXd0dnJ1e36BgoSDgH1+f4CBf39/f4GBgYGAgH9/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/");
      audio.volume = 0.3;
      audio.play().catch(() => {});
    } catch {}
    
    overlay.addEventListener("click", () => {
      overlay.remove();
      style.remove();
    });
    
    setTimeout(() => {
      if (overlay.parentNode) overlay.remove();
    }, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
  function init() {
    initUI();
    startMouseSimulator();
    setupKeyboardControls();
    setupAutoWarningDismiss();
    
    log(`🚀 DVSA Scanner v4.5 ULTRA OPTIMIZED ready`, true);
    log(`⚡ DOM: ${getCurrentDomScanInterval()}ms | Reserve: ${getCurrentReservationDelay()}ms (0 = INSTANT) | Hold: ${getCurrentHoldSpeed()}ms`, true);
    log(`🔄 Auto-refresh: ${settings.autoRefresh ? 'ON' : 'OFF'} (${settings.requestLimit} reqs)`, true);
    
    if (tryAutoResume()) {
      setStatus("↪️ Auto-resuming...");
    }
  }

})();