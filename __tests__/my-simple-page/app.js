const nameEl = document.getElementById("name");
const statusEl = document.getElementById("status");
const yearEl = document.getElementById("year");

const inputEl = document.getElementById("nameInput");
const saveBtn = document.getElementById("saveBtn");
const toggleBtn = document.getElementById("toggleBtn");

const statuses = [
  "Bugün əla gündür ✨",
  "Kod yazmaq vaxtıdır 💻",
  "Kiçik addımlar böyük nəticə verir 🚀",
];

yearEl.textContent = new Date().getFullYear();

// əvvəlki adı yüklə
const savedName = localStorage.getItem("demo_name");
if (savedName) nameEl.textContent = savedName;

saveBtn.addEventListener("click", () => {
  const val = inputEl.value.trim();
  if (!val) return;

  nameEl.textContent = val;
  localStorage.setItem("demo_name", val);
  inputEl.value = "";
});

toggleBtn.addEventListener("click", () => {
  const current = statusEl.textContent;
  const next = statuses[(statuses.indexOf(current) + 1) % statuses.length];
  statusEl.textContent = next;
});
