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

let data = [];

fetch("data.json")
  .then(response => response.json())
  .then(json => {
    data = json;
    document.getElementById("searchInput").addEventListener("input", searchCharacters);
  });

function searchCharacters() {
  const input = document.getElementById("searchInput").value.toLowerCase();
  const resultsContainer = document.getElementById("results");
  resultsContainer.innerHTML = "";

  const filtered = data.filter(char => char.name.toLowerCase().includes(input));

  if (filtered.length === 0) {
    resultsContainer.innerHTML = "<li>Keine Ergebnisse gefunden</li>";
    return;
  }

  filtered.forEach(char => {
    const li = document.createElement("li");
    li.textContent = `${char.name} – Serien: ${char.shows.join(", ")}`;
    resultsContainer.appendChild(li);
  });
}
