(function() {

  const PROFILE_TXT = `NAME:     Kotaro Yamasaki
ROLLE:    Junior System Engineer
STANDORT: Köln, Deutschland
E-MAIL:   mail@test.yamasaki.app
GITHUB:   github.com/kotaroooooooooo
LINKEDIN: linkedin.com/in/kotaro-yamasaki-22941b191

ÜBER MICH
-----
Hey, ich bin Kotaro Yamasaki, geboren 1998 in Kumamoto, Japan und interessiere mich schon seit meiner Kindheit für Computer und Technik.
Aus dieser Begeisterung entstand der Wunsch, meine Leidenschaft zum Beruf zu machen und mich in der IT weiterzuentwickeln.

Beruflich arbeite ich im Bereich IT-Support. Zu meinen Aufgaben gehören unter anderem die Administration von Firewalls, Domains, DNS, die Betreuung und Wartung von IT-Systemen, etc..

In meiner Freizeit beschäftige ich mich aber auch gerne mit der Entwicklung von Webseiten. Dabei arbeite ich hauptsächlich mit HTML und CSS und setze eigene Projekte um, um meine Kenntnisse kontinuierlich zu erweitern.`;

  const SKILLS_TXT = `LANGUAGES
---------
Go              [####################]  expert
Python          [################----]  advanced
TypeScript      [##############------]  advanced
Rust            [########------------]  intermediate
SQL             [##################--]  advanced

INFRASTRUCTURE
---------------
Kubernetes, Docker, Terraform, AWS (EC2/ECS/RDS/S3),
PostgreSQL, Redis, Kafka, Nginx, GitHub Actions

PRACTICES
---------
System design, API design, on-call/incident response,
performance profiling, mentoring, technical writing`;

  const CONTACT_TXT = `Meine Kontaktdaten:

E-MAIL:   mail@test.yamasaki.app
GITHUB:   github.com/kotaroooooooooo
LINKEDIN: linkedin.com/in/kotaro-yamasaki-22941b191`;

  const PROJECTS = [
    {
      name: "project 1",
      file: "project_1.txt",
      content: `something
-----------------------------------
aaa

Stack:  aa
Stars:  aa
Link:   aa`
    },
    {
      name: "irgendwas 2",
      file: "irgendwas_2.txt",
      content: `aa
----------------------------------
aaa

Stack:  aa
Stars:  1aa
Link:   a`
    }
  ];

  const HOSTNAME = "portfolio";
  const USERNAME = "kotaro";

  // Virtual filesystem
  const fs = {
    "~": {
      type: "dir",
      children: {
        "profile.txt": { type: "file", content: PROFILE_TXT },
        "skills.txt": { type: "file", content: SKILLS_TXT },
        "contact.txt": { type: "file", content: CONTACT_TXT },
        "projects": {
          type: "dir",
          children: {}
        }
      }
    }
  };
  PROJECTS.forEach(p => {
    fs["~"].children["projects"].children[p.file] = { type: "file", content: p.content };
  });

  let cwdPath = ["~"];
  let history = [];
  let historyIndex = -1;
  let currentInput = "";
  let pagerActive = false;
  let pagerLines = [];

  const output = document.getElementById("output");
  const termBody = document.getElementById("termBody");
  const typedText = document.getElementById("typedText");
  const psPath = document.getElementById("psPath");
  const hiddenInput = document.getElementById("hiddenInput");
  const pagerOverlay = document.getElementById("pagerOverlay");
  const pagerContent = document.getElementById("pagerContent");

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function resolveDir(path) {
    let node = fs["~"];
    for (let i = 1; i < path.length; i++) {
      node = node.children[path[i]];
    }
    return node;
  }

  function getNodeAt(targetPath) {
    // targetPath is an array like ["~","projects"]
    let node = fs["~"];
    for (let i = 1; i < targetPath.length; i++) {
      if (!node.children || !node.children[targetPath[i]]) return null;
      node = node.children[targetPath[i]];
    }
    return node;
  }

  function pathString(path) {
    if (path.length === 1) return "~";
    return "~/" + path.slice(1).join("/");
  }

  function printRaw(html) {
    const div = document.createElement("div");
    div.className = "line";
    div.innerHTML = html;
    output.appendChild(div);
  }

  function printText(text, cls) {
    const div = document.createElement("div");
    div.className = "line" + (cls ? " " + cls : "");
    div.textContent = text;
    output.appendChild(div);
  }

  function printEchoedPrompt(cmd) {
    const div = document.createElement("div");
    div.className = "line prompt-line";
    div.innerHTML = `<span class="ps-user">${USERNAME}</span><span class="ps-at">@</span><span class="ps-host">${HOSTNAME}</span><span class="ps-colon">:</span><span class="ps-path">${esc(pathString(cwdPath))}</span><span class="ps-dollar">$</span> ${esc(cmd)}`;
    output.appendChild(div);
  }

  function scrollToBottom() {
    termBody.scrollTop = termBody.scrollHeight;
  }

  function updatePrompt() {
    psPath.textContent = pathString(cwdPath);
  }

  // ---------- commands ----------

  const COMMANDS_LIST = ["help","ls","cat","less","cd","pwd","whoami","clear","neofetch","history","echo","date","open"];

  function cmdHelp() {
    printText("Available commands:");
    printRaw(`<span class="out-exec">help</span>      show this list`);
    printRaw(`<span class="out-exec">ls</span>        list files in current directory`);
    printRaw(`<span class="out-exec">cat</span>       &lt;file&gt;   print file contents`);
    printRaw(`<span class="out-exec">less</span>      &lt;file&gt;   open file in pager (q to quit)`);
    printRaw(`<span class="out-exec">cd</span>        &lt;dir&gt;    change directory`);
    printRaw(`<span class="out-exec">pwd</span>       print working directory`);
    printRaw(`<span class="out-exec">whoami</span>    print current user`);
    printRaw(`<span class="out-exec">neofetch</span>  show system / about info`);
    printRaw(`<span class="out-exec">history</span>   show command history`);
    printRaw(`<span class="out-exec">echo</span>      &lt;text&gt;   print text`);
    printRaw(`<span class="out-exec">date</span>      show current date/time`);
    printRaw(`<span class="out-exec">clear</span>     clear the screen`);
    printText("");
    printText("Tip: try 'cat profile.txt', 'less skills.txt', or 'ls projects/'");
  }

  function cmdLs(args) {
    let target = cwdPath;
    if (args.length > 0) {
      const argPath = resolvePath(args[0]);
      if (!argPath) {
        printRaw(`ls: cannot access '${esc(args[0])}': <span class="out-error">No such file or directory</span>`);
        return;
      }
      const node = getNodeAt(argPath);
      if (!node) {
        printRaw(`ls: cannot access '${esc(args[0])}': <span class="out-error">No such file or directory</span>`);
        return;
      }
      if (node.type === "file") {
        printText(args[0]);
        return;
      }
      target = argPath;
    }
    const dirNode = getNodeAt(target);
    const entries = Object.keys(dirNode.children).sort((a, b) => {
      const aIsDir = dirNode.children[a].type === "dir";
      const bIsDir = dirNode.children[b].type === "dir";
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return a.localeCompare(b);
    });
    if (entries.length === 0) {
      printText("(empty)");
      return;
    }
    const spans = entries.map(name => {
      const isDir = dirNode.children[name].type === "dir";
      const label = isDir ? name + "/" : name;
      const cls = isDir ? "out-dir" : "out-file";
      return `<span class="${cls}">${esc(label)}</span>`;
    });
    printRaw(`<div class="ls-grid">${spans.join("")}</div>`);
  }

  function resolvePath(arg) {
    // returns resolved path array or null
    if (!arg) return cwdPath.slice();
    let parts;
    let base;
    if (arg.startsWith("~")) {
      base = ["~"];
      parts = arg.slice(1).split("/").filter(p => p.length > 0);
    } else if (arg.startsWith("/")) {
      base = ["~"];
      parts = arg.split("/").filter(p => p.length > 0);
    } else {
      base = cwdPath.slice();
      parts = arg.split("/").filter(p => p.length > 0);
    }
    let path = base;
    for (const part of parts) {
      if (part === ".") continue;
      if (part === "..") {
        if (path.length > 1) path = path.slice(0, -1);
        continue;
      }
      path = path.concat([part]);
    }
    return path;
  }

  function cmdCd(args) {
    if (args.length === 0) {
      cwdPath = ["~"];
      updatePrompt();
      return;
    }
    const target = resolvePath(args[0]);
    const node = getNodeAt(target);
    if (!node) {
      printRaw(`bash: cd: ${esc(args[0])}: <span class="out-error">No such file or directory</span>`);
      return;
    }
    if (node.type !== "dir") {
      printRaw(`bash: cd: ${esc(args[0])}: <span class="out-error">Not a directory</span>`);
      return;
    }
    cwdPath = target;
    updatePrompt();
  }

  function findFile(arg) {
    const path = resolvePath(arg);
    const node = getNodeAt(path);
    return node;
  }

  function cmdCat(args) {
    if (args.length === 0) {
      printText("cat: missing file operand");
      return;
    }
    const node = findFile(args[0]);
    if (!node) {
      printRaw(`cat: ${esc(args[0])}: <span class="out-error">No such file or directory</span>`);
      return;
    }
    if (node.type === "dir") {
      printRaw(`cat: ${esc(args[0])}: <span class="out-error">Is a directory</span>`);
      return;
    }
    printText(node.content);
  }

  function cmdLess(args) {
    if (args.length === 0) {
      printText("less: missing file operand");
      return;
    }
    const node = findFile(args[0]);
    if (!node) {
      printRaw(`less: ${esc(args[0])}: <span class="out-error">No such file or directory</span>`);
      return;
    }
    if (node.type === "dir") {
      printRaw(`less: ${esc(args[0])}: <span class="out-error">Is a directory</span>`);
      return;
    }
    openPager(node.content);
  }

  function cmdPwd() {
    printText("/home/kotaro" + (cwdPath.length > 1 ? "/" + cwdPath.slice(1).join("/") : ""));
  }

  function cmdWhoami() {
    printText(USERNAME);
  }

  function cmdEcho(args) {
    printText(args.join(" "));
  }

  function cmdDate() {
    printText(new Date().toString());
  }

  function cmdHistory() {
    if (history.length === 0) {
      printText("(no history yet)");
      return;
    }
    history.forEach((h, i) => {
      printText(`  ${i + 1}  ${h}`);
    });
  }

  function cmdNeofetch() {
    const ascii = [
      "",
      "        /^\\\\               ",
      "      _(o_o)_              ",
      "       /| |\\\\             ",
      "      /_| |_\\\\            ",
      "        / \\\\              ",
      "       /___\\\\             ",
      "      /_/ \\_\\\\            "
    ];
    const info = [
      `${USERNAME}@${HOSTNAME}`,
      "-----------------",
      "OS: Human (JP Edition)",
      "Host: portfolio",
      "Kernel: portfolio",
      "Uptime: Since 1998",
      "Shell: bash 5.1.16",
      "Role: Junior System Enginner",
      "Status: Open to opportunities",
      "Contact: contact.txt"
    ];
    const lines = Math.max(ascii.length, info.length);
    let block = "";
    for (let i = 0; i < lines; i++) {
      const left = ascii[i] || "".padEnd(33, " ");
      const right = info[i] || "";
      block += left.padEnd(33, " ") + "  " + right + "\n";
    }
    printRaw(`<span class="out-info">${esc(block)}</span>`);
  }

  function cmdOpen(args) {
    if (args.length === 0) {
      printText("open: missing argument. try: open github | linkedin | email");
      return;
    }
    const target = args[0].toLowerCase();
    const map = {
      github: "https://github.com/alexrivera",
      linkedin: "https://linkedin.com/in/alexrivera",
      email: "mailto:alex@example.com"
    };
    if (map[target]) {
      printText(`Opening ${target}...`);
      window.open(map[target], "_blank");
    } else {
      printText(`open: unknown target '${args[0]}'. try: github, linkedin, email`);
    }
  }

  function runCommand(raw) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return;

    history.push(trimmed);
    historyIndex = history.length;

    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case "help":
        cmdHelp();
        break;
      case "ls":
        cmdLs(args);
        break;
      case "cat":
        cmdCat(args);
        break;
      case "less":
      case "more":
        cmdLess(args);
        break;
      case "cd":
        cmdCd(args);
        break;
      case "pwd":
        cmdPwd();
        break;
      case "whoami":
        cmdWhoami();
        break;
      case "clear":
        output.innerHTML = "";
        break;
      case "neofetch":
        cmdNeofetch();
        break;
      case "history":
        cmdHistory();
        break;
      case "echo":
        cmdEcho(args);
        break;
      case "date":
        cmdDate();
        break;
      case "open":
        cmdOpen(args);
        break;
      case "sudo":
        printRaw(`<span class="out-error">guest is not in the sudoers file. This incident will be reported.</span>`);
        break;
      case "exit":
      case "logout":
        printText("logout");
        printText("(there is no escape from the portfolio)");
        break;
      default:
        printRaw(`bash: ${esc(cmd)}: <span class="out-error">command not found</span>`);
        printText(`Type 'help' to see available commands.`);
    }
  }

  // ---------- pager (less) ----------

  function openPager(content) {
    pagerActive = true;
    pagerContent.textContent = content;
    pagerOverlay.classList.add("active");
    pagerContent.scrollTop = 0;
    pagerContent.focus();
  }

  function closePager() {
    pagerActive = false;
    pagerOverlay.classList.remove("active");
    focusInput();
  }

  // ---------- input handling ----------

  function renderTyped() {
    typedText.textContent = currentInput;
  }

  function focusInput() {
    hiddenInput.focus();
  }

  function submitLine() {
    const cmdStr = currentInput;
    printEchoedPrompt(cmdStr);
    currentInput = "";
    renderTyped();
    if (cmdStr.trim().length > 0) {
      runCommand(cmdStr);
    }
    scrollToBottom();
  }

  hiddenInput.addEventListener("keydown", function(e) {
    if (pagerActive) {
      if (e.key === "q" || e.key === "Escape") {
        closePager();
      } else if (e.key === "ArrowDown" || e.key === "j") {
        pagerContent.scrollTop += 24;
      } else if (e.key === "ArrowUp" || e.key === "k") {
        pagerContent.scrollTop -= 24;
      } else if (e.key === " " || e.key === "PageDown") {
        pagerContent.scrollTop += pagerContent.clientHeight * 0.9;
      } else if (e.key === "b" || e.key === "PageUp") {
        pagerContent.scrollTop -= pagerContent.clientHeight * 0.9;
      }
      e.preventDefault();
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      submitLine();
    } else if (e.key === "Backspace") {
      e.preventDefault();
      currentInput = currentInput.slice(0, -1);
      renderTyped();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length > 0) {
        historyIndex = Math.max(0, historyIndex - 1);
        currentInput = history[historyIndex] || "";
        renderTyped();
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (history.length > 0) {
        historyIndex = Math.min(history.length, historyIndex + 1);
        currentInput = history[historyIndex] || "";
        renderTyped();
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      // simple tab-complete on command names
      const matches = COMMANDS_LIST.filter(c => c.startsWith(currentInput));
      if (matches.length === 1) {
        currentInput = matches[0] + " ";
        renderTyped();
      }
    } else if (e.key === "l" && (e.ctrlKey)) {
      e.preventDefault();
      output.innerHTML = "";
    } else if (e.key === "c" && (e.ctrlKey)) {
      e.preventDefault();
      printRaw(`<span class="prompt-line"><span class="ps-user">${USERNAME}</span><span class="ps-at">@</span><span class="ps-host">${HOSTNAME}</span><span class="ps-colon">:</span><span class="ps-path">${esc(pathString(cwdPath))}</span><span class="ps-dollar">$</span> ${esc(currentInput)}^C</span>`);
      currentInput = "";
      renderTyped();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      currentInput += e.key;
      renderTyped();
    }
  });

  // catch paste
  hiddenInput.addEventListener("input", function() {
    // handled via keydown for most cases; this covers IME/paste edge cases
  });

  termBody.addEventListener("click", focusInput);
  pagerOverlay.addEventListener("click", () => pagerContent.focus());
  document.addEventListener("click", function(e) {
    if (!pagerActive) focusInput();
  });

  // ---------- boot sequence ----------

  function bootSequence() {
    const lines = [
      { text: "Welcome to Portfolio!", delay: 0 },
      { text: "", delay: 80 },
      { text: "Last login: " + new Date().toDateString() + " from 127.0.0.1", delay: 80 },
      { text: "", delay: 120 },
    ];
    let i = 0;
    function step() {
      if (i >= lines.length) {
        printText("Type 'help' to see available commands, or 'neofetch' for an overview.");
        printText("");
        focusInput();
        scrollToBottom();
        return;
      }
      printText(lines[i].text, "out-dim");
      i++;
      setTimeout(step, lines[i - 1] ? lines[i-1].delay : 0);
    }
    step();
  }

  updatePrompt();
  bootSequence();
})();