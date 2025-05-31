const toggleButton = document.getElementById("themeToggle");
const body = document.body;

// Initialzustand prüfen (z. B. aus localStorage)
if (localStorage.getItem("theme") === "dark") {
  body.classList.add("dark");
  toggleButton.textContent = "Light";
}

toggleButton.addEventListener("click", () => {
  body.classList.toggle("dark");
  const isDark = body.classList.contains("dark");

  toggleButton.textContent = isDark ? "Light" : "Dark";
  localStorage.setItem("theme", isDark ? "dark" : "light");
});
