const form = document.getElementById("gi-login-form");
const errorEl = document.getElementById("gi-login-error");
const btn = document.getElementById("gi-login-btn");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";
  btn.disabled = true;
  btn.textContent = "Memeriksa...";

  const username = document.getElementById("gi-username").value.trim();
  const password = document.getElementById("gi-password").value;

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (res.ok) {
      window.location.href = "/";
      return;
    }

    if (res.status === 429) {
      errorEl.textContent = "Terlalu banyak percobaan. Coba lagi nanti.";
    } else {
      errorEl.textContent = "Username atau password salah.";
    }
  } catch (err) {
    errorEl.textContent = "Gagal terhubung ke server. Coba lagi.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Masuk";
  }
});
