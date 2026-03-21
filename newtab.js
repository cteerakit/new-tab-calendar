import { getStoredToken, signInWithGoogle, signOut } from "./auth.js";
import { fetchUpcomingPrimaryEvents } from "./calendar.js";

const timeEl = document.getElementById("time");
const dateEl = document.getElementById("date");
const statusEl = document.getElementById("statusText");
const eventsListEl = document.getElementById("eventsList");
const signInButton = document.getElementById("signInButton");
const refreshButton = document.getElementById("refreshButton");
const signOutButton = document.getElementById("signOutButton");

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

function setSignedInUi(isSignedIn) {
  signInButton.hidden = isSignedIn;
  refreshButton.hidden = !isSignedIn;
  signOutButton.hidden = !isSignedIn;
}

function formatEventTime(date) {
  return date.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function renderEvents(events) {
  eventsListEl.replaceChildren();
  if (!events.length) {
    statusEl.textContent = "No upcoming events found.";
    return;
  }

  statusEl.textContent = "";
  const nodes = events.map((event) => {
    const li = document.createElement("li");
    li.className = "event-item";

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
    const parts = [];
    if (event.start) {
      parts.push(formatEventTime(event.start));
    }
    if (event.location) {
      parts.push(event.location);
    }
    meta.textContent = parts.join(" - ");

    li.appendChild(title);
    li.appendChild(meta);
    return li;
  });

  eventsListEl.replaceChildren(...nodes);
}

async function loadEvents() {
  const token = await getStoredToken();
  if (!token) {
    setSignedInUi(false);
    statusEl.textContent = "Sign in to load events.";
    eventsListEl.replaceChildren();
    return;
  }

  setSignedInUi(true);
  statusEl.textContent = "Loading events...";
  try {
    const events = await fetchUpcomingPrimaryEvents(token, 10);
    renderEvents(events);
  } catch (error) {
    if (error instanceof Error && error.message === "unauthorized") {
      setSignedInUi(false);
      statusEl.textContent = "Session expired. Sign in again.";
      eventsListEl.replaceChildren();
      await signOut();
      return;
    }
    statusEl.textContent = "Could not load events. Try refreshing.";
  }
}

async function onSignInClick() {
  signInButton.disabled = true;
  statusEl.textContent = "Starting Google sign-in...";
  try {
    await signInWithGoogle();
    await loadEvents();
  } catch (error) {
    statusEl.textContent =
      error instanceof Error ? `Sign-in failed: ${error.message}` : "Sign-in failed.";
  } finally {
    signInButton.disabled = false;
  }
}

async function onSignOutClick() {
  await signOut();
  setSignedInUi(false);
  eventsListEl.replaceChildren();
  statusEl.textContent = "Signed out.";
}

function setupHandlers() {
  signInButton.addEventListener("click", onSignInClick);
  refreshButton.addEventListener("click", () => {
    void loadEvents();
  });
  signOutButton.addEventListener("click", () => {
    void onSignOutClick();
  });
}

function startClock() {
  renderClock();
  setInterval(renderClock, 1000);
}

async function init() {
  startClock();
  setupHandlers();
  await loadEvents();
}

void init();
