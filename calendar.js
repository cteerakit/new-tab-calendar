function toCalendarQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    query.set(key, String(value));
  });
  return query.toString();
}

function normalizeEvent(event) {
  const startValue = event.start?.dateTime ?? event.start?.date;
  return {
    id: event.id,
    summary: event.summary || "(No title)",
    location: event.location || "",
    htmlLink: event.htmlLink || "",
    start: startValue ? new Date(startValue) : null
  };
}

export async function fetchUpcomingPrimaryEvents(accessToken, maxResults = 10) {
  const query = toCalendarQuery({
    singleEvents: true,
    orderBy: "startTime",
    timeMin: new Date().toISOString(),
    maxResults
  });
  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?${query}`;

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

  const json = await response.json();
  return Array.isArray(json.items) ? json.items.map(normalizeEvent) : [];
}
