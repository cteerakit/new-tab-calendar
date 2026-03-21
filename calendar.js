function toCalendarQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    query.set(key, String(value));
  });
  return query.toString();
}

function isGoogleMeetUrl(value) {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    return url.hostname === "meet.google.com";
  } catch {
    return false;
  }
}

function getGoogleMeetLink(event) {
  if (isGoogleMeetUrl(event.hangoutLink)) {
    return event.hangoutLink;
  }
  const entryPoints = event.conferenceData?.entryPoints;
  if (!Array.isArray(entryPoints)) {
    return "";
  }
  const videoEntry = entryPoints.find((entry) => isGoogleMeetUrl(entry?.uri));
  return videoEntry?.uri || "";
}

function parseEventStart(event) {
  if (event.start?.dateTime) {
    return { start: new Date(event.start.dateTime), allDay: false };
  }
  if (event.start?.date) {
    const parts = event.start.date.split("-").map(Number);
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      const [y, m, d] = parts;
      return { start: new Date(y, m - 1, d), allDay: true };
    }
  }
  return { start: null, allDay: false };
}

function normalizeEvent(event, calendarMeta = {}) {
  const { start, allDay } = parseEventStart(event);
  return {
    id: event.id,
    summary: event.summary || "(No title)",
    location: event.location || "",
    htmlLink: event.htmlLink || "",
    meetLink: getGoogleMeetLink(event),
    start,
    allDay,
    calendarId: calendarMeta.id || "",
    calendarSummary: calendarMeta.summary || ""
  };
}

function normalizeCalendar(calendar) {
  return {
    id: calendar.id,
    summary: calendar.summary || "(Unnamed calendar)",
    primary: Boolean(calendar.primary),
    backgroundColor: calendar.backgroundColor || "",
    selected: calendar.selected !== false
  };
}

async function fetchJsonWithAuth(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (response.status === 401) {
    throw new Error("unauthorized");
  }
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Calendar API request failed (${response.status}): ${message}`);
  }

  return response.json();
}

export async function fetchCalendars(accessToken) {
  const query = toCalendarQuery({
    minAccessRole: "reader",
    showHidden: false
  });
  const url = `https://www.googleapis.com/calendar/v3/users/me/calendarList?${query}`;
  const json = await fetchJsonWithAuth(url, accessToken);
  return Array.isArray(json.items) ? json.items.map(normalizeCalendar) : [];
}

export async function fetchUpcomingEventsForCalendars(
  accessToken,
  calendarIds,
  perCalendarLimit = 10,
  syncRangeDays = 14
) {
  if (!Array.isArray(calendarIds) || !calendarIds.length) {
    return { events: [], loadFailures: [] };
  }

  const normalizedDays = Number.isFinite(syncRangeDays) ? Math.max(1, Math.floor(syncRangeDays)) : 14;
  const now = new Date();
  const timeMax = new Date(now.getTime() + normalizedDays * 24 * 60 * 60 * 1000);

  const query = toCalendarQuery({
    singleEvents: true,
    orderBy: "startTime",
    timeMin: now.toISOString(),
    timeMax: timeMax.toISOString(),
    maxResults: perCalendarLimit
  });

  const requests = calendarIds.map(async (calendarId) => {
    const encodedId = encodeURIComponent(calendarId);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodedId}/events?${query}`;
    const json = await fetchJsonWithAuth(url, accessToken);
    const calendarSummary = json.summary || "";
    const items = Array.isArray(json.items) ? json.items : [];
    return items.map((event) => normalizeEvent(event, { id: calendarId, summary: calendarSummary }));
  });

  const settled = await Promise.allSettled(requests);
  const merged = [];
  const loadFailures = [];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    const calendarId = calendarIds[i];
    if (result.status === "rejected") {
      if (result.reason instanceof Error && result.reason.message === "unauthorized") {
        throw result.reason;
      }
      const message =
        result.reason instanceof Error ? result.reason.message : String(result.reason);
      loadFailures.push({ calendarId, message });
      continue;
    }
    merged.push(...result.value);
  }

  merged.sort((a, b) => {
    if (!a.start && !b.start) return 0;
    if (!a.start) return 1;
    if (!b.start) return -1;
    return a.start.getTime() - b.start.getTime();
  });

  return { events: merged, loadFailures };
}
