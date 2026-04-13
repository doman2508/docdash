const form = document.getElementById("login-form");
const statusEl = document.getElementById("login-status");
const usernameEl = document.getElementById("login-username");
const passwordEl = document.getElementById("login-password");

function getSafeNextUrl() {
  const next = new URLSearchParams(window.location.search).get("next") || "/";

  if (!next.startsWith("/") || next.startsWith("//")) {
    return "/";
  }

  return next;
}

function setStatus(message, type = "idle") {
  statusEl.textContent = message;
  statusEl.dataset.state = type;
}

async function redirectIfAuthenticated() {
  const response = await fetch("/api/session");

  if (!response.ok) {
    setStatus("Logowanie nie jest jeszcze skonfigurowane na serwerze.", "error");
    return;
  }

  const session = await response.json();
  if (session.authenticated) {
    window.location.href = getSafeNextUrl();
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Sprawdzam dane...", "pending");

  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: usernameEl.value.trim(),
      password: passwordEl.value
    })
  });

  if (!response.ok) {
    setStatus("Niepoprawny login albo haslo.", "error");
    passwordEl.value = "";
    passwordEl.focus();
    return;
  }

  setStatus("Zalogowano, przenosze do aplikacji...", "success");
  window.location.href = getSafeNextUrl();
});

redirectIfAuthenticated().catch(() => {
  setStatus("Nie udalo sie sprawdzic sesji.", "error");
});
