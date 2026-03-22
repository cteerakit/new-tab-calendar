import {
  getStoredToken,
  recoverSessionAfterUnauthorized,
  signInWithGoogle,
  signOut
} from "./auth.js";
import { fetchCalendars, fetchUpcomingEventsForCalendars } from "./calendar.js";

const timeEl = document.getElementById("time");
const dateEl = document.getElementById("date");
const statusEl = document.getElementById("statusText");
const eventsLoadWarningEl = document.getElementById("eventsLoadWarning");
const eventsListEl = document.getElementById("eventsList");
const signInButton = document.getElementById("signInButton");
const refreshButton = document.getElementById("refreshButton");
const settingsButton = document.getElementById("settingsButton");
const settingsPanel = document.getElementById("settingsPanel");
const calendarStatusEl = document.getElementById("calendarStatusText");
const calendarsListEl = document.getElementById("calendarsList");
const syncRangeSelectEl = document.getElementById("syncRangeSelect");
const themeToggleButton = document.getElementById("themeToggleButton");
const themeToggleIcon = document.getElementById("themeToggleIcon");

const THEME_KEY = "theme_preference";
const SELECTED_CALENDAR_IDS_KEY = "selected_calendar_ids_v1";
const SYNC_RANGE_DAYS_KEY = "sync_range_days_v1";
const EVENTS_CACHE_KEY = "cached_events_v3";
const EVENTS_CACHE_TS_KEY = "cached_events_ts_v3";
const EVENTS_CACHE_SELECTION_KEY = "cached_events_selected_ids_v3";
const EVENTS_CACHE_RANGE_KEY = "cached_events_sync_range_v1";
const EVENTS_CACHE_TTL_MS = 60 * 1000;
const LOADING_SPINNER_DELAY_MS = 250;
const PER_CALENDAR_LIMIT = 10;
const TOTAL_EVENTS_LIMIT = 25;
const SYNC_RANGE_DAY_OPTIONS = [7, 14, 30];
const DEFAULT_SYNC_RANGE_DAYS = 14;

let cachedCalendars = [];

function setRefreshLoading(isLoading) {
  refreshButton.classList.toggle("is-loading", isLoading);
  refreshButton.disabled = isLoading;
  refreshButton.setAttribute("aria-busy", String(isLoading));
}

function renderClock() {
  const now = new Date();
  timeEl.textContent = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
  dateEl.textContent = now.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

function setSettingsEnabled(isEnabled) {
  settingsButton.hidden = !isEnabled;
  if (!isEnabled) {
    settingsPanel.hidden = true;
    settingsButton.setAttribute("aria-expanded", "false");
  }
}

function setSignedInUi(isSignedIn) {
  signInButton.hidden = isSignedIn;
  refreshButton.hidden = !isSignedIn;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeToggleIcon.textContent = theme === "dark" ? "dark_mode" : "light_mode";
  themeToggleButton.setAttribute(
    "aria-label",
    theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
  );
}

async function getStoredTheme() {
  const data = await chrome.storage.local.get([THEME_KEY]);
  return data[THEME_KEY] === "light" ? "light" : "dark";
}

async function toggleTheme() {
  const currentTheme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const nextTheme = currentTheme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  await chrome.storage.local.set({ [THEME_KEY]: nextTheme });
}

function formatDayDate(date) {
  return {
    day: date.toLocaleDateString([], { day: "numeric" }),
    monthWeekday: date
      .toLocaleDateString([], { month: "short", weekday: "short" })
      .toUpperCase()
      .replace(" ", ", ")
  };
}

function formatTimeRange(date) {
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatEventTimeLabel(event) {
  if (!event.start) {
    return "Time TBD";
  }
  if (event.allDay) {
    return "All day";
  }
  return formatTimeRange(event.start);
}

function formatLoadFailureMessage(loadFailures, calendars) {
  const idToName = new Map(calendars.map((c) => [c.id, c.summary]));
  const names = loadFailures.map((f) => idToName.get(f.calendarId) || f.calendarId);
  if (names.length === 1) {
    return `Could not load calendar: ${names[0]}.`;
  }
  return `Could not load some calendars: ${names.join(", ")}.`;
}

function getEventDayKey(event) {
  if (!(event.start instanceof Date) || Number.isNaN(event.start.getTime())) {
    return "unknown";
  }
  const year = event.start.getFullYear();
  const month = String(event.start.getMonth() + 1).padStart(2, "0");
  const day = String(event.start.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function groupEventsByDay(events) {
  const groups = [];
  for (const event of events) {
    const key = getEventDayKey(event);
    const lastGroup = groups[groups.length - 1];
    if (!lastGroup || lastGroup.key !== key) {
      groups.push({ key, events: [event] });
      continue;
    }
    lastGroup.events.push(event);
  }
  return groups;
}

function buildCalendarColorMap(calendars) {
  return new Map(
    calendars
      .filter((calendar) => calendar.id)
      .map((calendar) => [calendar.id, calendar.backgroundColor || ""])
  );
}

function attachCalendarColors(events, calendarColorMap) {
  return events.map((event) => ({
    ...event,
    calendarColor: calendarColorMap.get(event.calendarId) || ""
  }));
}

function normalizeIdList(ids) {
  return [...ids].sort((a, b) => a.localeCompare(b));
}

function sameIdList(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => value === b[index]);
}

function getDefaultSelectedCalendarIds(calendars) {
  const primaryCalendar = calendars.find((calendar) => calendar.primary);
  if (primaryCalendar) {
    return [primaryCalendar.id];
  }
  const firstVisible = calendars.find((calendar) => calendar.selected !== false);
  if (firstVisible) {
    return [firstVisible.id];
  }
  return calendars[0] ? [calendars[0].id] : [];
}

async function getStoredSelectedCalendarIds() {
  const data = await chrome.storage.local.get([SELECTED_CALENDAR_IDS_KEY]);
  const value = data[SELECTED_CALENDAR_IDS_KEY];
  return Array.isArray(value) ? value.filter((id) => typeof id === "string" && id) : [];
}

async function setStoredSelectedCalendarIds(calendarIds) {
  await chrome.storage.local.set({ [SELECTED_CALENDAR_IDS_KEY]: normalizeIdList(calendarIds) });
}

function normalizeSyncRangeDays(value) {
  const parsed = Number(value);
  return SYNC_RANGE_DAY_OPTIONS.includes(parsed) ? parsed : DEFAULT_SYNC_RANGE_DAYS;
}

async function getStoredSyncRangeDays() {
  const data = await chrome.storage.local.get([SYNC_RANGE_DAYS_KEY]);
  return normalizeSyncRangeDays(data[SYNC_RANGE_DAYS_KEY]);
}

async function setStoredSyncRangeDays(days) {
  const normalizedDays = normalizeSyncRangeDays(days);
  await chrome.storage.local.set({ [SYNC_RANGE_DAYS_KEY]: normalizedDays });
  return normalizedDays;
}

function renderSyncRangeControl(days) {
  const normalizedDays = normalizeSyncRangeDays(days);
  syncRangeSelectEl.value = String(normalizedDays);
}

async function resolveSelectedCalendarIds(calendars) {
  const availableIds = new Set(calendars.map((calendar) => calendar.id));
  const storedIds = await getStoredSelectedCalendarIds();
  const validStoredIds = storedIds.filter((id) => availableIds.has(id));
  if (validStoredIds.length) {
    const normalized = normalizeIdList(validStoredIds);
    if (!sameIdList(normalized, normalizeIdList(storedIds))) {
      await setStoredSelectedCalendarIds(normalized);
    }
    return normalized;
  }

  const defaults = getDefaultSelectedCalendarIds(calendars);
  if (defaults.length) {
    await setStoredSelectedCalendarIds(defaults);
  }
  return normalizeIdList(defaults);
}

function serializeEventsForCache(events) {
  return events.map((event) => ({
    ...event,
    start: event.start instanceof Date ? event.start.toISOString() : null
  }));
}

function readCachedEvents() {
  try {
    const rawEvents = localStorage.getItem(EVENTS_CACHE_KEY);
    const rawTimestamp = localStorage.getItem(EVENTS_CACHE_TS_KEY);
    const rawSelection = localStorage.getItem(EVENTS_CACHE_SELECTION_KEY);
    const rawSyncRange = localStorage.getItem(EVENTS_CACHE_RANGE_KEY);
    if (!rawEvents || !rawTimestamp || !rawSelection || !rawSyncRange) {
      return { events: [], fetchedAt: 0, selectedIds: [], syncRangeDays: DEFAULT_SYNC_RANGE_DAYS };
    }

    const parsedEvents = JSON.parse(rawEvents);
    const parsedSelection = JSON.parse(rawSelection);
    if (!Array.isArray(parsedEvents) || !Array.isArray(parsedSelection)) {
      return { events: [], fetchedAt: 0, selectedIds: [], syncRangeDays: DEFAULT_SYNC_RANGE_DAYS };
    }

    const events = parsedEvents.map((event) => ({
      ...event,
      start: event.start ? new Date(event.start) : null,
      allDay: Boolean(event.allDay)
    }));
    const fetchedAt = Number(rawTimestamp) || 0;
    const selectedIds = parsedSelection.filter((id) => typeof id === "string" && id);
    const syncRangeDays = normalizeSyncRangeDays(rawSyncRange);
    return { events, fetchedAt, selectedIds: normalizeIdList(selectedIds), syncRangeDays };
  } catch {
    return { events: [], fetchedAt: 0, selectedIds: [], syncRangeDays: DEFAULT_SYNC_RANGE_DAYS };
  }
}

function writeCachedEvents(events, selectedIds, syncRangeDays) {
  localStorage.setItem(EVENTS_CACHE_KEY, JSON.stringify(serializeEventsForCache(events)));
  localStorage.setItem(EVENTS_CACHE_TS_KEY, String(Date.now()));
  localStorage.setItem(EVENTS_CACHE_SELECTION_KEY, JSON.stringify(normalizeIdList(selectedIds)));
  localStorage.setItem(EVENTS_CACHE_RANGE_KEY, String(normalizeSyncRangeDays(syncRangeDays)));
}

function clearCachedEvents() {
  localStorage.removeItem(EVENTS_CACHE_KEY);
  localStorage.removeItem(EVENTS_CACHE_TS_KEY);
  localStorage.removeItem(EVENTS_CACHE_SELECTION_KEY);
  localStorage.removeItem(EVENTS_CACHE_RANGE_KEY);
}

function renderEvents(events, loadFailures = [], calendars = []) {
  eventsListEl.replaceChildren();
  if (!events.length) {
    if (loadFailures.length) {
      statusEl.textContent = "";
      eventsLoadWarningEl.hidden = false;
      eventsLoadWarningEl.textContent = formatLoadFailureMessage(loadFailures, calendars);
    } else {
      statusEl.textContent = "No upcoming events found.";
      eventsLoadWarningEl.hidden = true;
      eventsLoadWarningEl.textContent = "";
    }
    return;
  }

  statusEl.textContent = "";
  if (loadFailures.length && calendars.length) {
    eventsLoadWarningEl.hidden = false;
    eventsLoadWarningEl.textContent = formatLoadFailureMessage(loadFailures, calendars);
  } else {
    eventsLoadWarningEl.hidden = true;
    eventsLoadWarningEl.textContent = "";
  }
  const dayGroups = groupEventsByDay(events);
  const nodes = dayGroups.map((group) => {
    const dayItem = document.createElement("li");
    dayItem.className = "event-day";

    const rows = document.createElement("div");
    rows.className = "event-day-rows";

    group.events.forEach((event, index) => {
      const row = document.createElement("article");
      row.className = "event-row";

      const dateCol = document.createElement("div");
      dateCol.className = "event-date-col";
      if (index === 0 && event.start) {
        const { day, monthWeekday } = formatDayDate(event.start);
        const dayNum = document.createElement("div");
        dayNum.className = "event-date-day";
        dayNum.textContent = day;
        const dayLabel = document.createElement("div");
        dayLabel.className = "event-date-label";
        dayLabel.textContent = monthWeekday;
        dateCol.appendChild(dayNum);
        dateCol.appendChild(dayLabel);
      }

      const timeCol = document.createElement("div");
      timeCol.className = "event-time-col";
      const dot = document.createElement("span");
      dot.className = "event-dot";
      dot.setAttribute("aria-hidden", "true");
      if (event.calendarColor) {
        dot.style.backgroundColor = event.calendarColor;
      }
      const time = document.createElement("span");
      time.className = "event-time";
      time.textContent = formatEventTimeLabel(event);
      timeCol.appendChild(dot);
      timeCol.appendChild(time);

      const detailsCol = document.createElement("div");
      detailsCol.className = "event-details-col";
      const title = document.createElement("div");
      title.className = "event-title";
      if (event.htmlLink) {
        const link = document.createElement("a");
        link.href = event.htmlLink;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = event.summary;
        title.appendChild(link);
      } else {
        title.textContent = event.summary;
      }

      const meta = document.createElement("div");
      meta.className = "event-meta";
      if (event.location) {
        meta.textContent = event.location;
      }

      detailsCol.appendChild(title);
      if (meta.textContent) {
        detailsCol.appendChild(meta);
      }
      if (event.meetLink) {
        const meetLink = document.createElement("a");
        meetLink.className = "event-meet-link";
        meetLink.href = event.meetLink;
        meetLink.target = "_blank";
        meetLink.rel = "noopener noreferrer";
        meetLink.textContent = "Join Meet";
        detailsCol.appendChild(meetLink);
      }

      row.appendChild(dateCol);
      row.appendChild(timeCol);
      row.appendChild(detailsCol);
      rows.appendChild(row);
    });

    dayItem.appendChild(rows);
    return dayItem;
  });

  eventsListEl.replaceChildren(...nodes);
}

function createCalendarRow(calendar, selectedIds) {
  const label = document.createElement("label");
  label.className = "calendar-option";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.value = calendar.id;
  input.checked = selectedIds.includes(calendar.id);

  const color = document.createElement("span");
  color.className = "calendar-color";
  color.style.backgroundColor = calendar.backgroundColor || "transparent";
  color.setAttribute("aria-hidden", "true");

  const text = document.createElement("span");
  text.className = "calendar-label";
  text.textContent = calendar.summary;

  label.appendChild(input);
  label.appendChild(color);
  label.appendChild(text);
  return label;
}

function renderCalendarOptions(calendars, selectedIds) {
  calendarsListEl.replaceChildren();
  if (!calendars.length) {
    calendarStatusEl.textContent = "No calendars available.";
    return;
  }

  calendarStatusEl.textContent = "";
  const rows = calendars.map((calendar) => createCalendarRow(calendar, selectedIds));
  calendarsListEl.replaceChildren(...rows);
}

async function ensureCalendars(accessToken, force) {
  if (!force && cachedCalendars.length) {
    return cachedCalendars;
  }
  cachedCalendars = await fetchCalendars(accessToken);
  return cachedCalendars;
}

function renderCachedEventsImmediately() {
  const { events } = readCachedEvents();
  if (events.length) {
    setSignedInUi(true);
    renderEvents(events);
    return true;
  }
  return false;
}

async function loadEvents({ force = false, allowUnauthorizedRecovery = true } = {}) {
  const token = await getStoredToken();
  if (!token) {
    cachedCalendars = [];
    setSignedInUi(false);
    setSettingsEnabled(false);
    setRefreshLoading(false);
    statusEl.textContent = "Sign in to load events.";
    calendarStatusEl.textContent = "";
    calendarsListEl.replaceChildren();
    eventsListEl.replaceChildren();
    eventsLoadWarningEl.hidden = true;
    eventsLoadWarningEl.textContent = "";
    clearCachedEvents();
    return;
  }

  setSignedInUi(true);

  let didShowLoading = false;
  const loadingTimer = setTimeout(() => {
    didShowLoading = true;
    setRefreshLoading(true);
  }, LOADING_SPINNER_DELAY_MS);
  try {
    const calendars = await ensureCalendars(token, force);
    const selectedIds = await resolveSelectedCalendarIds(calendars);
    const syncRangeDays = await getStoredSyncRangeDays();
    renderSyncRangeControl(syncRangeDays);
    renderCalendarOptions(calendars, selectedIds);
    setSettingsEnabled(calendars.length > 0);

    if (!selectedIds.length) {
      statusEl.textContent = "Select at least one calendar in settings.";
      eventsListEl.replaceChildren();
      eventsLoadWarningEl.hidden = true;
      eventsLoadWarningEl.textContent = "";
      return;
    }

    const {
      events: cachedEvents,
      fetchedAt,
      selectedIds: cachedSelectionIds,
      syncRangeDays: cachedSyncRangeDays
    } = readCachedEvents();
    const isCacheFresh = Date.now() - fetchedAt < EVENTS_CACHE_TTL_MS;
    if (
      !force &&
      cachedEvents.length &&
      isCacheFresh &&
      sameIdList(cachedSelectionIds, selectedIds) &&
      cachedSyncRangeDays === syncRangeDays
    ) {
      renderEvents(cachedEvents);
      return;
    }

    const { events: mergedEvents, loadFailures } = await fetchUpcomingEventsForCalendars(
      token,
      selectedIds,
      PER_CALENDAR_LIMIT,
      syncRangeDays
    );
    const calendarColorMap = buildCalendarColorMap(calendars);
    const coloredEvents = attachCalendarColors(mergedEvents, calendarColorMap);
    const nextEvents = coloredEvents.slice(0, TOTAL_EVENTS_LIMIT);
    renderEvents(nextEvents, loadFailures, calendars);
    writeCachedEvents(nextEvents, selectedIds, syncRangeDays);
  } catch (error) {
    if (error instanceof Error && error.message === "unauthorized") {
      if (allowUnauthorizedRecovery) {
        const recovered = await recoverSessionAfterUnauthorized();
        if (recovered) {
          await loadEvents({ force: true, allowUnauthorizedRecovery: false });
          return;
        }
      }
      setSignedInUi(false);
      setSettingsEnabled(false);
      statusEl.textContent = "Session expired. Sign in again.";
      calendarStatusEl.textContent = "";
      calendarsListEl.replaceChildren();
      eventsListEl.replaceChildren();
      eventsLoadWarningEl.hidden = true;
      eventsLoadWarningEl.textContent = "";
      clearCachedEvents();
      await signOut();
      return;
    }
    statusEl.textContent = "Could not load events. Try refreshing.";
    calendarStatusEl.textContent = "Could not load calendars.";
    eventsLoadWarningEl.hidden = true;
    eventsLoadWarningEl.textContent = "";
  } finally {
    clearTimeout(loadingTimer);
    if (!didShowLoading) {
      refreshButton.classList.remove("is-loading");
    }
    setRefreshLoading(false);
  }
}

async function onSignInClick() {
  signInButton.disabled = true;
  statusEl.textContent = "Starting Google sign-in...";
  try {
    await signInWithGoogle();
    cachedCalendars = [];
    await loadEvents({ force: true });
  } catch (error) {
    statusEl.textContent =
      error instanceof Error ? `Sign-in failed: ${error.message}` : "Sign-in failed.";
  } finally {
    signInButton.disabled = false;
  }
}

function toggleSettingsPanel() {
  const willBeOpen = settingsPanel.hidden;
  settingsPanel.hidden = !willBeOpen;
  settingsButton.setAttribute("aria-expanded", String(willBeOpen));
}

async function onCalendarSelectionChange() {
  const checked = Array.from(calendarsListEl.querySelectorAll("input[type='checkbox']:checked"))
    .map((input) => input.value)
    .filter(Boolean);
  await setStoredSelectedCalendarIds(checked);
  await loadEvents({ force: true });
}

async function onSyncRangeChange() {
  const days = normalizeSyncRangeDays(syncRangeSelectEl.value);
  renderSyncRangeControl(days);
  await setStoredSyncRangeDays(days);
  await loadEvents({ force: true });
}

function setupHandlers() {
  signInButton.addEventListener("click", onSignInClick);
  themeToggleButton.addEventListener("click", () => {
    void toggleTheme();
  });
  refreshButton.addEventListener("click", () => {
    void loadEvents({ force: true });
  });
  settingsButton.addEventListener("click", () => {
    toggleSettingsPanel();
  });
  calendarsListEl.addEventListener("change", () => {
    void onCalendarSelectionChange();
  });
  syncRangeSelectEl.addEventListener("change", () => {
    void onSyncRangeChange();
  });
}

function startClock() {
  renderClock();
  setInterval(renderClock, 1000);
}

async function init() {
  renderCachedEventsImmediately();
  const theme = await getStoredTheme();
  applyTheme(theme);
  startClock();
  setupHandlers();
  setSettingsEnabled(false);
  await loadEvents();
}

void init();
