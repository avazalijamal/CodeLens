(() => {
  const elSetup = document.getElementById("setup");
  const elIDE = document.getElementById("ide");

  const inHtml = document.getElementById("inHtml");
  const inCss = document.getElementById("inCss");
  const inJs = document.getElementById("inJs");
  const timeIn = document.getElementById("time");
  const startBtn = document.getElementById("startBtn");

  const filesEls = Array.from(document.querySelectorAll("#codeFiles .file"));
  const codeView = document.getElementById("codeView");
  const editorArea = document.getElementById("editorArea");
  const activeFileName = document.getElementById("activeFileName");
  const activeLangPill = document.getElementById("activeLangPill");
  const progressText = document.getElementById("progressText");

  const frames = document.getElementById("frames");
  const previewStatus = document.getElementById("previewStatus");

  const assetInput = document.getElementById("assetInput");
  const assetDrop = document.getElementById("assetDrop");
  const assetCount = document.getElementById("assetCount");
  const assetsList = document.getElementById("assetsList");

  const toast = document.getElementById("toast");

  // Camera
  const cameraBtn = document.getElementById("cameraBtn");
  const camBubble = document.getElementById("camBubble");
  const camVideo = document.getElementById("camVideo");
  let camStream = null;
  let camEnabled = false;

  // Virtual files
  const full = { html: "", css: "", js: "" };
  const current = { html: "", css: "", js: "" };

  // Assets: name -> dataURL
  const assets = Object.create(null);

  let activeFile = "html";
  let typingPlan = [];
  let totalChars = 0;
  let typedChars = 0;

  // Preview throttle + transition
  const previewIntervalMs = 450;
  const transitionMs = 240;
  let lastPreviewUpdate = 0;
  let pendingTimer = null;
  let activeFrame = null;

  // Highlight throttle
  const highlightIntervalMs = 45;
  let lastHighlight = 0;

  // IMPORTANT: literal "</script>" yazmırıq
  const SCRIPT_END = "</scr" + "ipt>";

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1200);
  }

  // -------- CAMERA ----------
  async function enableCamera() {
    if (camStream) return true;
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      camVideo.srcObject = camStream;
      camBubble.classList.add("show");
      camEnabled = true;

      cameraBtn.classList.add("btnOn");
      cameraBtn.innerHTML = `<i class="fa-solid fa-video"></i> Kamera aktivdir`;
      showToast("Kamera aktiv oldu");
      return true;
    } catch (e) {
      camStream = null;
      camEnabled = false;
      camBubble.classList.remove("show");
      cameraBtn.classList.remove("btnOn");
      cameraBtn.innerHTML = `<i class="fa-solid fa-camera"></i> Kameranı aktiv et`;
      showToast("Kamera icazəsi verilmədi");
      return false;
    }
  }

  function disableCamera() {
    if (camStream) {
      camStream.getTracks().forEach((t) => t.stop());
      camStream = null;
    }
    camEnabled = false;
    camBubble.classList.remove("show");
    cameraBtn.classList.remove("btnOn");
    cameraBtn.innerHTML = `<i class="fa-solid fa-camera"></i> Kameranı aktiv et`;
    showToast("Kamera söndürüldü");
  }

  cameraBtn.addEventListener("click", async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showToast("Bu brauzer kamera dəstəkləmir");
      return;
    }
    if (camEnabled) disableCamera();
    else await enableCamera();
  });

  // Prism
  function prismReady() {
    return !!(window.Prism && window.Prism.languages);
  }

  function getLang(key) {
    if (!prismReady()) return null;
    if (key === "html") return { id: "markup", cls: "language-html" };
    if (key === "css") return { id: "css", cls: "language-css" };
    return { id: "javascript", cls: "language-javascript" };
  }

  function setActiveFile(fileKey) {
    activeFile = fileKey;
    filesEls.forEach((f) =>
      f.classList.toggle("active", f.dataset.file === fileKey)
    );

    if (fileKey === "html") {
      activeFileName.textContent = "index.html";
      activeLangPill.textContent = "HTML";
      codeView.className = "language-html";
    } else if (fileKey === "css") {
      activeFileName.textContent = "style.css";
      activeLangPill.textContent = "CSS";
      codeView.className = "language-css";
    } else {
      activeFileName.textContent = "app.js";
      activeLangPill.textContent = "JS";
      codeView.className = "language-javascript";
    }
    renderEditor(true);
  }

  filesEls.forEach((f) =>
    f.addEventListener("click", () => setActiveFile(f.dataset.file))
  );

  function renderEditor(force) {
    const text = current[activeFile] || "";

    if (!prismReady()) {
      codeView.textContent = text;
      editorArea.scrollTop = editorArea.scrollHeight;
      return;
    }

    const now = Date.now();
    if (!force && now - lastHighlight < highlightIntervalMs) return;
    lastHighlight = now;

    const lang = getLang(activeFile);
    const grammar = Prism.languages[lang.id] || Prism.languages.markup;

    codeView.innerHTML = Prism.highlight(text, grammar, lang.id);
    editorArea.scrollTop = editorArea.scrollHeight;
  }

  function escapeScriptClose(js) {
    return (js || "").replace(/<\/script>/gi, "<\\/script>");
  }

  function replaceAssetUrlsInCss(cssText) {
    return (cssText || "").replace(
      /url\(\s*(['"]?)(assets\/[^'")]+)\1\s*\)/gi,
      (m, q, path) => {
        const name = path.replace(/^assets\//, "");
        const data = assets[name];
        if (!data) return m;
        return `url("${data}")`;
      }
    );
  }

  // HTML daxilində script tag-ləri preview-də heç vaxt göstərməmək üçün
  function stripScriptsFromHtml(html) {
    if (!html) return "";
    let out = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
    out = out.replace(/<script\b[^>]*>/gi, "");
    return out;
  }

  // ✅ Base64 helper (HTML-i iframe-ə raw yazmırıq!)
  function toB64(str) {
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch {
      return btoa(str);
    }
  }

  // ✅ JS-i DOM hazır olanda işə sal (HTML/CSS yazılarkən də JS “text” kimi görünməsin)
  function wrapOnReady(code) {
    const safe = code || "";
    return `
(function(){
  function run(){
    try{
      ${safe}
    }catch(e){
      console.error(e);
    }
  }
  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();`.trim();
  }

  // ✅ Əsas FIX: HTML base64 + script-lər HEAD-də + JS DOM ready-də işləyir
  function buildSrcdoc() {
    const htmlRaw = stripScriptsFromHtml(current.html || "");
    const htmlB64 = toB64(htmlRaw);

    const css = replaceAssetUrlsInCss(current.css || "");
    const js = current.js || "";
    const assetsJson = JSON.stringify(assets);

    const runtime = `
(function(){
  const MAP = ${assetsJson};

  function fromB64(b64){
    try{
      return decodeURIComponent(escape(atob(b64)));
    }catch(e){
      try { return atob(b64); } catch(_) { return ""; }
    }
  }

  // HTML-i parserə raw vermirik, DOM hazır olanda #app-ə yerləşdiririk
  function mountHtml(){
    const app = document.getElementById("app");
    if(app) app.innerHTML = fromB64("${htmlB64}");
  }

  function resolve(path){
    if(!path) return null;
    if(path.startsWith("assets/")){
      const name = path.slice("assets/".length);
      return MAP[name] || null;
    }
    return null;
  }

  function patchEl(el){
    if(!el || !el.getAttribute) return;
    const attrs = ["src","href","poster"];
    for(const a of attrs){
      if(!el.hasAttribute(a)) continue;
      const v = el.getAttribute(a);
      const r = resolve(v);
      if(r) el.setAttribute(a, r);
    }
  }

  function patchTree(root){
    patchEl(root);
    if(root && root.querySelectorAll){
      root.querySelectorAll("[src],[href],[poster]").forEach(patchEl);
    }
  }

  function boot(){
    mountHtml();
    patchTree(document);

    const mo = new MutationObserver((muts)=>{
      for(const m of muts){
        if(m.type === "attributes"){
          patchEl(m.target);
        } else if(m.type === "childList"){
          m.addedNodes.forEach(n => patchTree(n));
        }
      }
    });

    mo.observe(document.documentElement, {
      subtree:true,
      childList:true,
      attributes:true,
      attributeFilter:["src","href","poster"]
    });

    const origFetch = window.fetch;
    window.fetch = function(input, init){
      try{
        const url = (typeof input === "string") ? input : (input && input.url);
        if(typeof url === "string" && url.startsWith("assets/")){
          const name = url.slice("assets/".length);
          const data = MAP[name];
          if(data) return origFetch(data, init);
        }
      } catch(e){}
      return origFetch(input, init);
    };

    window.assetUrl = function(path){
      return resolve(path) || path;
    };
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();`;

    const jsWrapped = wrapOnReady(js);

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>${css}</style>
<script>${escapeScriptClose(runtime)}${SCRIPT_END}
<script>${escapeScriptClose(jsWrapped)}${SCRIPT_END}
</head>
<body>
<div id="app"></div>
</body>
</html>`;
  }

  function createFrame() {
    const f = document.createElement("iframe");
    f.className = "previewFrame fadeIn";
    return f;
  }

  function swapPreview(srcdoc) {
    const next = createFrame();
    frames.appendChild(next);

    const fallback = setTimeout(() => {
      if (activeFrame && activeFrame !== next) activeFrame.remove();
      activeFrame = next;
    }, 1200);

    next.addEventListener(
      "load",
      () => {
        clearTimeout(fallback);
        if (activeFrame && activeFrame !== next) {
          const old = activeFrame;
          setTimeout(() => old.remove(), transitionMs);
        }
        activeFrame = next;
        previewStatus.textContent = new Date().toLocaleTimeString();
      },
      { once: true }
    );

    next.srcdoc = srcdoc;
  }

  function updatePreview(force = false) {
    const now = Date.now();
    if (force || now - lastPreviewUpdate >= previewIntervalMs) {
      swapPreview(buildSrcdoc());
      lastPreviewUpdate = now;
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
    } else if (!pendingTimer) {
      pendingTimer = setTimeout(() => {
        swapPreview(buildSrcdoc());
        lastPreviewUpdate = Date.now();
        pendingTimer = null;
      }, previewIntervalMs - (now - lastPreviewUpdate));
    }
  }

  function waitForPrismThenRender() {
    if (!prismReady()) {
      requestAnimationFrame(waitForPrismThenRender);
      return;
    }
    renderEditor(true);
  }

  // -------- ASSETS UI ----------
  function updateAssetCount() {
    const n = Object.keys(assets).length;
    assetCount.textContent = `${n} fayl`;
  }

  function iconForAsset(name) {
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (
      ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext)
    )
      return "fa-regular fa-image";
    if (["mp3", "wav", "ogg", "m4a", "aac", "flac"].includes(ext))
      return "fa-solid fa-music";
    if (["mp4", "webm", "mov", "mkv"].includes(ext)) return "fa-solid fa-film";
    if (["ttf", "otf", "woff", "woff2"].includes(ext))
      return "fa-solid fa-font";
    if (["json", "txt", "csv", "xml"].includes(ext))
      return "fa-solid fa-file-lines";
    return "fa-solid fa-file";
  }

  function renderAssetsSidebar() {
    const names = Object.keys(assets).sort((a, b) => a.localeCompare(b));

    // assets yoxdursa sidebar bölməsini gizlət
    if (names.length === 0) {
      assetsList.style.display = "none";
      return;
    }
    assetsList.style.display = "";

    const keep = assetsList.querySelector(".sectionLabel");
    assetsList.innerHTML = "";
    assetsList.appendChild(keep);

    for (const name of names) {
      const row = document.createElement("div");
      row.className = "file";
      row.dataset.asset = name;
      row.innerHTML = `
        <div class="ico ico-asset"><i class="${iconForAsset(name)}"></i></div>
        <div class="meta">
          <div class="fname">${name}</div>
          <div class="hint">copy: assets/${name}</div>
        </div>
      `;
      row.addEventListener("click", async () => {
        const path = `assets/${name}`;
        try {
          await navigator.clipboard.writeText(path);
          showToast(`Kopyalandı: ${path}`);
        } catch {
          showToast(`Path: ${path}`);
        }
      });
      assetsList.appendChild(row);
    }
  }

  function addAssetsFromFileList(fileList) {
    const arr = Array.from(fileList || []);
    if (!arr.length) return;

    let pending = arr.length;
    for (const f of arr) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        assets[f.name] = ev.target.result;
        pending--;
        if (pending === 0) {
          updateAssetCount();
          renderAssetsSidebar();
        }
      };
      reader.readAsDataURL(f);
    }
  }

  assetInput.addEventListener("change", (e) =>
    addAssetsFromFileList(e.target.files)
  );

  assetDrop.addEventListener("dragover", (e) => {
    e.preventDefault();
    assetDrop.style.borderColor = "rgba(94,234,212,.40)";
    assetDrop.style.background = "rgba(94,234,212,.06)";
  });
  assetDrop.addEventListener("dragleave", () => {
    assetDrop.style.borderColor = "rgba(255,255,255,.12)";
    assetDrop.style.background = "rgba(255,255,255,.02)";
  });
  assetDrop.addEventListener("drop", (e) => {
    e.preventDefault();
    assetDrop.style.borderColor = "rgba(255,255,255,.12)";
    assetDrop.style.background = "rgba(255,255,255,.02)";
    if (e.dataTransfer && e.dataTransfer.files)
      addAssetsFromFileList(e.dataTransfer.files);
  });

  // -------- START ----------
  function start() {
    full.html = inHtml.value || "";
    full.css = inCss.value || "";
    full.js = inJs.value || "";

    current.html = "";
    current.css = "";
    current.js = "";

    typingPlan = [
      { file: "html", text: full.html },
      { file: "css", text: full.css },
      { file: "js", text: full.js },
    ];

    totalChars = Math.max(
      1,
      typingPlan.reduce((s, p) => s + (p.text?.length || 0), 0)
    );
    typedChars = 0;

    const durationMs = Math.max(
      1000,
      (parseInt(timeIn.value, 10) || 30) * 1000
    );
    const charDelay = durationMs / totalChars;

    elSetup.style.display = "none";
    elIDE.style.display = "block";

    if (camEnabled) camBubble.classList.add("show");

    renderAssetsSidebar();

    frames.innerHTML = "";
    activeFrame = null;
    swapPreview(buildSrcdoc());
    previewStatus.textContent = "—";

    setActiveFile("html");
    waitForPrismThenRender();

    let planIndex = 0;
    let charIndex = 0;

    function tick() {
      const plan = typingPlan[planIndex];
      if (!plan) {
        updatePreview(true);
        swapPreview(buildSrcdoc());
        progressText.textContent = "100%";
        renderEditor(true);
        return;
      }

      const text = plan.text || "";
      if (charIndex < text.length) {
        current[plan.file] += text[charIndex];
        charIndex++;
        typedChars++;

        const pct = Math.floor((typedChars / totalChars) * 100);
        progressText.textContent = `${pct}%`;

        if (plan.file === activeFile) renderEditor(false);
        updatePreview(false);

        setTimeout(tick, charDelay);
      } else {
        planIndex++;
        charIndex = 0;
        const next = typingPlan[planIndex];
        if (next) setActiveFile(next.file);
        setTimeout(tick, 220);
      }
    }

    tick();
  }

  startBtn.addEventListener("click", start);

  // init
  updateAssetCount();
  renderAssetsSidebar(); // başlanğıcda assets yoxdursa gizli qalsın
})();
