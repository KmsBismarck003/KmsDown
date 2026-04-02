import os
import re
import json
import threading
import time
import subprocess
from flask import Flask, render_template, request, jsonify
import requests
from bs4 import BeautifulSoup
from datetime import datetime

# ================= BACKGROUND LOGIC =================
app = Flask(__name__)

# State and settings
STATE = {
    "status": "Inactivo", 
    "message": "",
    "queue": [], 
    "files_tracking": [], 
    "global_pause": False,
    "current_index": 0,
    "total_files": 0,
    "progress_percent": 0.0,
    "history": [],
    "bookmarks": [],
    "config": {
        "destination": "Descargas_Automatas",
        "speed_limit": "0",  
        "language": "es"
    }
}

DATA_DIR = "app_data"
if not os.path.exists(DATA_DIR):
    os.makedirs(DATA_DIR)

HISTORY_FILE = os.path.join(DATA_DIR, "history.json")
CONFIG_FILE = os.path.join(DATA_DIR, "config.json")
BOOKMARKS_FILE = os.path.join(DATA_DIR, "bookmarks.json")

def load_data():
    if os.path.exists(HISTORY_FILE):
        with open(HISTORY_FILE, "r") as f: STATE["history"] = json.load(f)
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "r") as f: STATE["config"] = json.load(f)
    if os.path.exists(BOOKMARKS_FILE):
        with open(BOOKMARKS_FILE, "r") as f: STATE["bookmarks"] = json.load(f)
            
def save_data(key):
    file_map = {"history": HISTORY_FILE, "config": CONFIG_FILE, "bookmarks": BOOKMARKS_FILE}
    with open(file_map[key], "w") as f:
        json.dump(STATE[key], f, indent=4)

load_data()

class MediaFireDownloader:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })

    def get_direct_link(self, file_url):
        try:
            response = self.session.get(file_url, timeout=10)
            soup = BeautifulSoup(response.text, 'html.parser')
            download_btn = soup.find('a', id='downloadButton')
            if download_btn: return download_btn.get('href')
            return None
        except: return None


def process_download_queue(url, repair_mode=False, target_subfolder=None, pre_scanned_files=None):
    try:
        STATE["status"] = "Iniciador"
        STATE["message"] = "Iniciando secuencia de descarga..."
        STATE["progress_percent"] = 0
        STATE["global_pause"] = False
        
        base_dir = os.path.abspath(STATE["config"]["destination"])
        if not target_subfolder:
            target_subfolder = "Generic_Download"
        target_dir = os.path.join(base_dir, target_subfolder)
        
        if not os.path.exists(target_dir):
            os.makedirs(target_dir)

        if "mediafire.com/folder/" in url:
            downloader = MediaFireDownloader()
            STATE["status"] = "Descargando"
            files = pre_scanned_files if pre_scanned_files else []
            
            if not files:
                STATE["status"] = "Error"
                STATE["message"] = "No se recibieron archivos para procesar."
                return

            STATE["total_files"] = len(files)
            STATE["queue"] = files
            
            # Setup tracking
            STATE["files_tracking"] = []
            for f in files:
                filename = re.sub(r'[<>:"/\\|?*]', '_', f['filename'])
                STATE["files_tracking"].append({
                    "filename": filename,
                    "status": "Pendiente",
                    "progress": 0,
                    "speed": 0,
                    "cancel": False,
                    "pause": False
                })
            
            success = 0
            for i, file_obj in enumerate(files):
                if STATE["files_tracking"][i]["cancel"]:
                    STATE["files_tracking"][i]["status"] = "Cancelado"
                    continue

                filename = STATE["files_tracking"][i]["filename"]
                STATE["files_tracking"][i]["status"] = "Descargando..."
                STATE["current_index"] = i + 1
                STATE["message"] = f"Descargando: {filename}"
                STATE["progress_percent"] = 0
                
                file_page_url = f"https://www.mediafire.com/file/{file_obj['quickkey']}/{filename}/file"
                path = os.path.join(target_dir, filename)
                
                expected_size = int(file_obj.get('size') or file_obj.get('filesize', 0))
                
                need_download = True
                if os.path.exists(path):
                    actual_size = os.path.getsize(path)
                    if actual_size == expected_size:
                        need_download = False
                        STATE["files_tracking"][i]["status"] = "Omitido (Ya existe)"
                        STATE["files_tracking"][i]["progress"] = 100
                    else:
                        if repair_mode:
                            STATE["files_tracking"][i]["status"] = "Reparando"
                        else:
                            need_download = True
                            STATE["files_tracking"][i]["status"] = "Reintentando"
                            os.remove(path)

                if need_download:
                    direct_link = downloader.get_direct_link(file_page_url)
                    if direct_link:
                        try:
                            # Begin streaming
                            req = downloader.session.get(direct_link, stream=True)
                            total_s = int(req.headers.get('content-length', expected_size))
                            downloaded = 0
                            
                            last_time = time.time()
                            last_down = 0

                            with open(path, 'wb') as f:
                                for data_chunk in req.iter_content(chunk_size=32768):
                                    # Handle Global Pause & Individual Pause
                                    while STATE["global_pause"] or STATE["files_tracking"][i]["pause"]:
                                        STATE["status"] = "Pausado"
                                        STATE["files_tracking"][i]["speed"] = 0
                                        if STATE["files_tracking"][i]["pause"]:
                                            STATE["files_tracking"][i]["status"] = "Pausado individualmente"
                                        time.sleep(0.5)
                                        # break out if cancelled while paused
                                        if STATE["files_tracking"][i]["cancel"]:
                                            break
                                    
                                    STATE["status"] = "Descargando"
                                    if STATE["files_tracking"][i]["status"] == "Pausado individualmente":
                                        STATE["files_tracking"][i]["status"] = "Descargando..."

                                    # Handle Cancel (Skip)
                                    if STATE["files_tracking"][i]["cancel"]:
                                        STATE["files_tracking"][i]["status"] = "Cancelado"
                                        break
                                    
                                    if data_chunk:
                                        f.write(data_chunk)
                                        downloaded += len(data_chunk)
                                        
                                        if total_s > 0:
                                            p = (downloaded / total_s) * 100
                                            STATE["progress_percent"] = p
                                            STATE["files_tracking"][i]["progress"] = p
                                        
                                        now = time.time()
                                        if now - last_time >= 0.5:
                                            speed_bps = (downloaded - last_down) / (now - last_time)
                                            STATE["files_tracking"][i]["speed"] = speed_bps
                                            last_time = now
                                            last_down = downloaded

                            if STATE["files_tracking"][i]["cancel"]:
                                os.remove(path)
                            else:
                                success += 1
                                STATE["files_tracking"][i]["status"] = "Completado"
                                STATE["files_tracking"][i]["progress"] = 100
                                STATE["files_tracking"][i]["speed"] = 0

                        except Exception as e:
                            STATE["files_tracking"][i]["status"] = f"Error: {str(e)}"
                            STATE["files_tracking"][i]["speed"] = 0
                    else:
                        STATE["files_tracking"][i]["status"] = "Fallo de Enlace"
                else:
                    success += 1
                    STATE["progress_percent"] = 100
                    time.sleep(0.5)

            STATE["history"].append({
                "date": datetime.now().strftime("%Y-%m-%d %H:%M"),
                "name": target_subfolder,
                "url": url,
                "status": "Completado" if success == len(files) else "Parcial"
            })
            save_data("history")
                
            STATE["status"] = "Finalizado"
            STATE["message"] = f"{success}/{len(files)} completados exitosamente."

        else:
            STATE["status"] = "Descargando"
            STATE["message"] = f"Usando yt-dlp para link genérico..."
            STATE["files_tracking"] = [{
                "filename": "Descarga Genérica yt-dlp",
                "status": "Descargando", "progress": 0, "speed": 0, "cancel": False, "pause": False
            }]
            
            h_entry = {"date": datetime.now().strftime("%Y-%m-%d %H:%M"), "name": target_subfolder, "url": url, "status": "Pendiente"}
            STATE["history"].append(h_entry)
            save_data("history")

            try:
                cmd = ["yt-dlp", "-P", target_dir, url]
                subprocess.run(cmd, check=True)
                STATE["message"] = "¡Descarga de yt-dlp completada!"
                STATE["progress_percent"] = 100
                STATE["files_tracking"][0]["status"] = "Completado"
                STATE["files_tracking"][0]["progress"] = 100
                h_entry["status"] = "Completado"
                save_data("history")
                STATE["status"] = "Finalizado"
            except subprocess.CalledProcessError:
                STATE["message"] = "Error en la descarga de yt-dlp."
                STATE["files_tracking"][0]["status"] = "Error"
                h_entry["status"] = "Error"
                save_data("history")
                STATE["status"] = "Finalizado"

    except Exception as e:
        STATE["status"] = "Error"
        STATE["message"] = f"Fallo: {str(e)}"

# ================= FLASK ROUTES =================

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/status")
def get_status():
    return jsonify({
        "status": STATE["status"],
        "message": STATE["message"],
        "current_index": STATE["current_index"],
        "total_files": STATE["total_files"],
        "progress_percent": STATE["progress_percent"],
        "files_tracking": STATE["files_tracking"],
        "global_pause": STATE["global_pause"]
    })

@app.route("/api/action", methods=["POST"])
def perform_action():
    data = request.json
    action = data.get("action")
    idx = data.get("index")

    if action == "pause":
        STATE["global_pause"] = True
    elif action == "resume":
        STATE["global_pause"] = False
    elif action == "cancel_file" and idx is not None:
        if 0 <= idx < len(STATE["files_tracking"]):
            STATE["files_tracking"][idx]["cancel"] = True
            STATE["files_tracking"][idx]["status"] = "Cancelando..."
    elif action == "pause_file" and idx is not None:
        if 0 <= idx < len(STATE["files_tracking"]):
            STATE["files_tracking"][idx]["pause"] = True
    elif action == "resume_file" and idx is not None:
        if 0 <= idx < len(STATE["files_tracking"]):
            STATE["files_tracking"][idx]["pause"] = False

    return jsonify({"success": True})

@app.route("/api/scan", methods=["POST"])
def scan_url():
    data = request.json
    url = data.get("url")
    if not url: return jsonify({"error": "Falta URL."}), 400

    if "mediafire.com/folder/" in url:
        downloader = MediaFireDownloader()
        match = re.search(r'folder/([a-z0-9]+)', url)
        if not match: return jsonify({"error": "URL MediaFire inválida"}), 400
        folder_key = match.group(1)
        
        folder_name = "MediaFire_Folder"
        n_match = re.search(r'folder/[a-z0-9]+/([^?/]+)', url)
        if n_match:
            import urllib.parse
            folder_name = urllib.parse.unquote(n_match.group(1).replace('+', ' ')).strip()
            folder_name = re.sub(r'[<>:"/\\|?*]', '_', folder_name)

        files = []
        chunk = 1
        while True:
            api_url = f"https://www.mediafire.com/api/1.5/folder/get_content.php?folder_key={folder_key}&response_format=json&content_type=files&chunk={chunk}"
            try:
                resp = downloader.session.get(api_url).json()
                chunk_files = resp.get('response', {}).get('folder_content', {}).get('files', [])
                files.extend(chunk_files)
                if resp.get('response', {}).get('folder_content', {}).get('more_chunks') == 'no': break
                chunk += 1
            except Exception as e:
                return jsonify({"error": f"Error API: {str(e)}"}), 500
        
        return jsonify({"is_mediafire": True, "folder_name": folder_name, "files": files, "count": len(files)})
    else:
        return jsonify({"is_mediafire": False, "folder_name": "Descarga_Generica", "files": [], "count": 1})

@app.route("/api/start", methods=["POST"])
def start_download():
    data = request.json
    url = data.get("url")
    repair = data.get("repair_mode", False)
    target_folder = data.get("target_folder")
    files_list = data.get("files", [])
    
    if STATE["status"] in ["Descargando", "Escaneando", "Iniciador", "Pausado"]:
        return jsonify({"error": "Ya hay una descarga en progreso."}), 400

    if not url: return jsonify({"error": "Falta URL."}), 400

    t = threading.Thread(target=process_download_queue, args=(url, repair, target_folder, files_list))
    t.start()
    return jsonify({"success": True})

@app.route("/api/history", methods=["GET"])
def get_history(): return jsonify(STATE["history"])

@app.route("/api/bookmarks", methods=["GET", "POST", "DELETE"])
def manage_bookmarks():
    if request.method == "POST":
        STATE["bookmarks"].append(request.json)
        save_data("bookmarks")
        return jsonify({"success": True})
    if request.method == "DELETE":
        idx = int(request.args.get("index"))
        if 0 <= idx < len(STATE["bookmarks"]):
            STATE["bookmarks"].pop(idx)
            save_data("bookmarks")
        return jsonify({"success": True})
    return jsonify(STATE["bookmarks"])

@app.route("/api/config", methods=["GET", "POST"])
def manage_config():
    if request.method == "POST":
        STATE["config"].update(request.json)
        save_data("config")
        return jsonify({"success": True})
    return jsonify(STATE["config"])

@app.route("/api/folders", methods=["GET"])
def get_folders():
    target = os.path.abspath(STATE["config"]["destination"])
    if not os.path.exists(target):
        return jsonify([])
    folders = [{"name": d, "path": os.path.join(target, d)} for d in os.listdir(target) if os.path.isdir(os.path.join(target, d))]
    return jsonify(folders)

@app.route("/api/open-folder", methods=["POST"])
def open_folder():
    path = request.json.get("path")
    if path and os.path.exists(path):
        os.startfile(path)
        return jsonify({"success": True})
    return jsonify({"error": "Ruta inválida"}), 400

if __name__ == "__main__":
    app.run(port=5000, debug=False)
