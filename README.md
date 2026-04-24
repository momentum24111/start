# Start

Lokale, extrem schnelle Single-User Startseite (Dashy-ähnlich) mit FastAPI und statischem Vanilla-JS Frontend.

## Start

```bash
pip install -r requirements.txt
python app.py
```

Danach erreichbar unter [http://127.0.0.1:8080](http://127.0.0.1:8080).

## Architektur

- **Backend:** FastAPI (`app.py`)
- **Frontend:** statisches HTML/CSS/Vanilla JS in `app/static`
- **Persistenz:** lokale JSON Dateien in `app/data`
- **Keine DB**, **keine externe Auth**, **keine externen CDNs**

## Features

- Kategorien und Services verwalten
- Bearbeitungsmodus mit Drag&Drop (Desktop + Mobile Long-Press)
- Session Undo (mehrstufig)
- Standardisierte Modale
- Theme-System aus Ordnern
- Sprachsystem aus JSON-Dateien
- Favicon-Download mit lokalem Cache
- Backup-Erstellung bei jeder Änderung von Config/Settings

## Git-Sicherheit

Lokale Dateien mit potenziell privaten Daten werden nicht versioniert:

- `app/data/config.json`
- `app/data/settings.json`
- `app/data/backups/`
- `app/static/assets/favicon-cache/`
