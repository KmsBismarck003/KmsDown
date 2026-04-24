document.addEventListener("DOMContentLoaded", () => {
    // ---- THEME LOGIC ----
    const themeBtn = document.getElementById("theme-btn");
    let themes = ["", "theme-light", "theme-dark"];
    let currentThemeIdx = parseInt(localStorage.getItem('themeIdx') || "0");
    document.body.className = themes[currentThemeIdx];
    
    themeBtn.addEventListener("click", () => {
        currentThemeIdx = (currentThemeIdx + 1) % themes.length;
        document.body.className = themes[currentThemeIdx];
        localStorage.setItem('themeIdx', currentThemeIdx);
        showToast("TEMA CAMBIADO // " + (currentThemeIdx===0?"ORIGINAL":currentThemeIdx===1?"CLARO":"OSCURO"));
    });

    // ---- TOASTS & MODALS ----
    const toastContainer = document.getElementById("toast-container");
    function showToast(msg, duration=3000) {
        const t = document.createElement("div");
        t.className = "toast";
        t.innerText = msg;
        t.onclick = () => t.remove();
        toastContainer.appendChild(t);
        setTimeout(() => { if(t.parentElement) t.remove(); }, duration);
    }

    const modalWelcome = document.getElementById("modal-welcome");
    const modalTutorial = document.getElementById("modal-tutorial");
    document.querySelectorAll(".close-modal").forEach(btn => {
        btn.addEventListener("click", (e) => e.target.closest(".modal-overlay").style.display = "none");
    });
    document.getElementById("help-btn").addEventListener("click", () => modalTutorial.style.display = "flex");

    if (!localStorage.getItem("welcomed")) {
        modalWelcome.style.display = "flex";
        localStorage.setItem("welcomed", "true");
    }

    // ---- NAVIGATION ----
    const menuItems = document.querySelectorAll(".menu-item");
    const modules = document.querySelectorAll(".module");

    menuItems.forEach(item => {
        item.addEventListener("click", () => {
            menuItems.forEach(m => m.classList.remove("active"));
            item.classList.add("active");
            const targetId = item.getAttribute("data-target");
            modules.forEach(mod => mod.classList.toggle("active-module", mod.id === targetId));

            if (targetId === "m-historial") loadHistory();
            if (targetId === "m-carpetas") loadFolders();
            if (targetId === "m-config") loadConfig();
            if (targetId === "m-favoritos") loadBookmarks();
        });
    });

    // ---- MODULE: DOWNLOAD ----
    const btnScan = document.getElementById("btn-scan");
    const scanPanel = document.getElementById("scan-results-panel");
    const scanInfo = document.getElementById("scan-info");
    const folderInput = document.getElementById("target-folder-input");
    const btnStart = document.getElementById("btn-start");
    const btnRepair = document.getElementById("btn-repair");
    const urlInput = document.getElementById("url-input");
    const btnSaveLink = document.getElementById("btn-save-link");

    const sStatus = document.getElementById("s-status");
    const sMessage = document.getElementById("s-message");
    const sCount = document.getElementById("s-count");
    const sProgress = document.getElementById("s-progress");
    const btnPauseGlob = document.getElementById("btn-pause");
    const btnCancelGlob = document.getElementById("btn-cancel-all");
    const queueList = document.getElementById("queue-list");

    let currentScannedFiles = [];
    let isPausedGlob = false;

    btnSaveLink.addEventListener("click", () => {
        const url = urlInput.value.trim();
        const name = prompt("Ingrese un nombre para guardar este enlace:");
        if (url && name) {
            fetch("/api/bookmarks", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({name, url})})
            .then(() => showToast("ENLACE GUARDADO LOCAMENTE."));
        }
    });

    btnPauseGlob.addEventListener("click", () => {
        const action = isPausedGlob ? "resume" : "pause";
        fetch("/api/action", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ action }) })
        .then(() => {
            isPausedGlob = !isPausedGlob;
            btnPauseGlob.innerText = isPausedGlob ? "REANUDAR_TODO" : "PAUSAR_TODO";
        });
    });

    btnCancelGlob.addEventListener("click", () => {
        if(confirm("¿Estás seguro de que quieres omitir todas las descargas pendientes?")) {
            const checkboxes = document.querySelectorAll(".cancel-file-btn");
            checkboxes.forEach(btn => {
                const idx = parseInt(btn.getAttribute("data-idx"));
                fetch("/api/action", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ action: "cancel_file", index: idx }) });
            });
            showToast("SISTEMA: Omitiendo descargas pendientes...");
        }
    });

    btnScan.addEventListener("click", () => {
        const url = urlInput.value.trim();
        if(!url) return showToast("REQUERIDO: Ingrese una URL.");
        btnScan.innerText = "ESCANEANDO...";
        fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url }) })
        .then(res => res.json())
        .then(data => {
            btnScan.innerText = "ESCANEAR_ENLACE";
            if(data.error) return showToast(data.error);

            scanPanel.style.display = "block";
            folderInput.value = data.folder_name;
            currentScannedFiles = data.files;
            
            const filesContainer = document.getElementById("scan-files-container");
            if (data.is_mediafire) {
                scanInfo.innerHTML = `Archivos: ${data.count}. <button id="btn-select-all" class="btn btn-alt" style="padding: 2px 5px; font-size: 0.7rem;">SEL. TODO</button>`;
                let checkHtml = "";
                data.files.forEach((f, idx) => {
                    let sizeMB = ((f.size || f.filesize || 0) / 1024 / 1024).toFixed(2);
                    checkHtml += `
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 5px;">
                        <input type="checkbox" id="chk-${idx}" value="${idx}" class="file-chk" checked>
                        <label for="chk-${idx}" style="cursor: pointer;">${f.filename} <span style="opacity:0.7">(${sizeMB} MB)</span></label>
                    </div>`;
                });
                filesContainer.innerHTML = checkHtml;
                filesContainer.style.display = "block";
                document.getElementById("btn-select-all").addEventListener("click", () => {
                    const checkboxes = document.querySelectorAll(".file-chk");
                    let allChecked = Array.from(checkboxes).every(c => c.checked);
                    checkboxes.forEach(c => c.checked = !allChecked);
                });
            } else {
                scanInfo.innerText = `Modo Genérico activado.`;
                filesContainer.innerHTML = ""; filesContainer.style.display = "none";
            }
        });
    });

    function startSequence(repairMode) {
        const url = urlInput.value.trim();
        const targetFolder = folderInput.value.trim();
        if(!url) return showToast("REQUERIDO: Ingrese una URL.");

        let filesToDownload = [];
        if (currentScannedFiles.length > 0) {
            const checkboxes = document.querySelectorAll(".file-chk");
            if(checkboxes.length > 0) checkboxes.forEach(c => { if(c.checked) filesToDownload.push(currentScannedFiles[c.value]); });
            else filesToDownload = currentScannedFiles;
        }

        if (filesToDownload.length === 0 && currentScannedFiles.length > 0) return showToast("Seleccione al menos un archivo.");
        scanPanel.style.display = "none";
        
        fetch("/api/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, repair_mode: repairMode, target_folder: targetFolder, files: filesToDownload }) })
        .then(res => res.json()).then(data => {
            if(data.error) showToast(data.error);
            else if(data.queued) showToast(`SISTEMA: ENLACE AÑADIDO A LA COLA. (${data.queue_length} en espera)`);
            else showToast("SECUENCIA INICIADA.");
        });
    }

    btnStart.addEventListener("click", () => startSequence(false));
    btnRepair.addEventListener("click", () => startSequence(true));

    // Queue List Delegation
    queueList.addEventListener("click", (e) => {
        const idx = parseInt(e.target.getAttribute("data-idx"));
        if (isNaN(idx)) return;
        if(e.target.classList.contains("cancel-file-btn")) {
            fetch("/api/action", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ action: "cancel_file", index: idx }) });
        } else if (e.target.classList.contains("pause-file-btn")) {
            let isItemPaused = e.target.getAttribute("data-paused") === "true";
            fetch("/api/action", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ action: isItemPaused ? "resume_file" : "pause_file", index: idx }) });
        }
    });

    // Formatting speed
    function formatSpeed(bps) {
        if (bps < 1024) return bps.toFixed(1) + " B/s";
        let kbps = bps / 1024;
        if (kbps < 1024) return kbps.toFixed(1) + " KB/s";
        return (kbps / 1024).toFixed(2) + " MB/s";
    }

    let completionNotified = false;

    // Polling Status
    setInterval(() => {
        fetch("/api/status").then(res => res.json()).then(data => {
            if (data.status === "Finalizado" && !completionNotified) {
                showToast("¡SISTEMA: TODAS LAS DESCARGAS COMPLETADAS EXITOSAMENTE!");
                completionNotified = true;
            } else if (data.status === "Descargando" || data.status === "Iniciador") {
                completionNotified = false;
            }

            sStatus.innerText = data.status.toUpperCase();
            sMessage.innerText = data.message;
            isPausedGlob = data.global_pause;
            btnPauseGlob.innerText = isPausedGlob ? "REANUDAR_TODO" : "PAUSAR_TODO";
            
            let isDownloading = (data.status === "Descargando" || data.status === "Pausado" || data.status === "Iniciador");
            btnPauseGlob.style.display = isDownloading ? "inline-block" : "none";
            btnCancelGlob.style.display = isDownloading ? "inline-block" : "none";
            
            sCount.innerText = `[${data.current_index} / ${data.total_files}] Archivos`;
            sProgress.style.width = `${data.progress_percent || 0}%`;

            if (!data.files_tracking || !data.files_tracking.length) {
                queueList.innerHTML = "<p style='opacity: 0.6;'>Sin elementos en cola.</p>";
                return;
            }

            let html = "";
            data.files_tracking.forEach((f, idx) => {
                let speedText = f.speed > 0 ? `<span style='color: var(--glitch-color); margin-left:10px;'>[${formatSpeed(f.speed)}]</span>` : "";
                let isActive = f.status === "Descargando..." || f.status === "Pendiente" || f.status === "Reparando" || f.status === "Pausado individualmente";
                let op = isActive ? "1" : "0.5";
                
                let btnHtml = "";
                if (isActive) {
                    let isIndivPaused = f.pause === true || f.status === "Pausado individualmente";
                    btnHtml = `
                        <button class="btn btn-alt pause-file-btn" data-idx="${idx}" data-paused="${isIndivPaused}" style="padding:2px 8px; font-size:0.7rem;">${isIndivPaused ? 'REANU.' : 'PAUS.'}</button>
                        <button class="btn btn-alt cancel-file-btn" data-idx="${idx}" style="padding:2px 8px; font-size:0.7rem;">OMITIR</button>
                    `;
                }

                html += `
                <div style="border: 1px solid var(--accent); padding: 8px; background: var(--highlight); opacity: ${op}; display: flex; flex-direction: column; gap: 4px;">
                    <div style="display: flex; justify-content: space-between; font-weight: 600; font-size: 0.85rem;">
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%;">${f.filename}</span>
                        <span>${(f.progress || 0).toFixed(1)}%</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.8rem; align-items: center;">
                        <span>ESTADO: ${f.status} ${speedText}</span>
                        <div>${btnHtml}</div>
                    </div>
                    <div style="height: 4px; background: rgba(0,0,0,0.1); width: 100%;">
                        <div style="height: 100%; background: var(--accent); width: ${f.progress}%;"></div>
                    </div>
                </div>`;
            });
            queueList.innerHTML = html;
        }).catch(err => {
            sStatus.innerText = "DESCONECTADO";
            sMessage.innerText = "Conexión perdida con el servidor local. Reinicia app.py.";
            btnPauseGlob.style.display = "none";
            btnCancelGlob.style.display = "none";
        });
    }, 1000);

    // ---- MODULE: DIRECTORIES ----
    const folderList = document.getElementById("folder-list");
    document.getElementById("btn-refresh-folders").addEventListener("click", loadFolders);
    function loadFolders() {
        folderList.innerHTML = "<li>ESCANENANDO...</li>";
        fetch("/api/folders").then(res => res.json()).then(data => {
            folderList.innerHTML = "";
            if (data.length === 0) folderList.innerHTML = "<li>NO SE ENCONTRARON DIRECTORIOS</li>";
            else data.forEach(f => {
                let li = document.createElement("li");
                li.innerHTML = `<span>${f.name}</span> <button class="btn btn-alt fldr-btn" data-path="${f.path}" style="padding:2px 10px; font-size:0.75rem;">VER RUTA</button>`;
                folderList.appendChild(li);
            });
            document.querySelectorAll(".fldr-btn").forEach(btn => btn.addEventListener("click", (e) => {
                fetch("/api/open-folder", { method: "POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({path: e.target.getAttribute("data-path")}) });
            }));
        });
    }

    // ---- MODULE: FAVORITES ----
    const bmList = document.getElementById("bm-list");
    function loadBookmarks() {
        fetch("/api/bookmarks").then(res => res.json()).then(data => {
            bmList.innerHTML = "";
            if(data.length === 0) bmList.innerHTML = "<li>No hay enlaces guardados.</li>";
            data.forEach((item, idx) => {
                let li = document.createElement("li");
                li.innerHTML = `
                    <div style="display:flex; flex-direction:column; gap:5px;">
                        <strong>${item.name}</strong> <span style="font-size:0.8rem; opacity:0.8;">${item.url}</span>
                    </div>
                    <div>
                        <button class="btn btn-alt js-load-bm" data-url="${item.url}" style="padding:5px">CARGAR</button>
                        <button class="btn btn-alt js-del-bm" data-idx="${idx}" style="padding:5px">X</button>
                    </div>`;
                bmList.appendChild(li);
            });
            document.querySelectorAll(".js-load-bm").forEach(b => b.addEventListener("click", (e) => {
                urlInput.value = e.target.getAttribute("data-url");
                menuItems[0].click();
            }));
            document.querySelectorAll(".js-del-bm").forEach(b => b.addEventListener("click", (e) => {
                fetch("/api/bookmarks?index=" + e.target.getAttribute("data-idx"), {method:"DELETE"}).then(loadBookmarks);
            }));
        });
    }

    // ---- HISTORY & CONFIG (Same as before) ----
    const historyTable = document.querySelector("#history-table tbody");
    document.getElementById("btn-refresh-history").addEventListener("click", loadHistory);
    function loadHistory() {
        historyTable.innerHTML = "<tr><td colspan='4'>CARGANDO...</td></tr>";
        fetch("/api/history").then(res => res.json()).then(data => {
            historyTable.innerHTML = "";
            data.reverse().forEach(item => {
                let tr = document.createElement("tr");
                tr.innerHTML = `<td>${item.date}</td><td>${item.name}</td><td>${item.status}</td><td><button class="btn btn-alt js-redownload" data-url="${item.url}" style="padding:2px 10px;">REPETIR</button></td>`;
                historyTable.appendChild(tr);
            });
            document.querySelectorAll(".js-redownload").forEach(btn => btn.addEventListener("click", (e) => {
                urlInput.value = e.target.getAttribute("data-url"); menuItems[0].click();
            }));
        });
    }

    const cfgDest = document.getElementById("cfg-dest");
    const cfgLang = document.getElementById("cfg-lang");
    function loadConfig() {
        fetch("/api/config").then(res => res.json()).then(d => { cfgDest.value = d.destination; cfgLang.value = d.language; });
    }
    document.getElementById("btn-save-cfg").addEventListener("click", () => {
        fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destination: cfgDest.value, language: cfgLang.value }) })
        .then(() => showToast("PARÁMETROS GUARDADOS."));
    });
    loadConfig();
});
