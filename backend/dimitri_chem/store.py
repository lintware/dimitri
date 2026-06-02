"""
Project store — the single source of truth for a Dimitri project.

A project is a SQLite file holding datasets (tables of rows) plus a simple
in-process event bus. The GUI panels, the pi assistant, and the CLI are all
clients that mutate this store and react to its events, so a change made by any
one of them shows up live everywhere (e.g. a docking-score column appearing in
the analogs table).

Rows are stored as JSON blobs keyed by dataset, which keeps the schema flexible
while we iterate on what columns each module produces. We can migrate hot
datasets to real columns later without changing the client contract.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import time
from pathlib import Path
from typing import Any, Iterable


def default_project_path() -> Path:
    """Per-user project file under Application Support (macOS) / data dir."""
    base = Path.home() / "Library" / "Application Support" / "Dimitri"
    base.mkdir(parents=True, exist_ok=True)
    return base / "project.db"


class EventBus:
    """Fan-out async event bus. Panels subscribe; kernels publish."""

    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[dict[str, Any]]) -> None:
        self._subscribers.discard(q)

    def publish(self, event: dict[str, Any]) -> None:
        event = {"ts": time.time(), **event}
        for q in list(self._subscribers):
            q.put_nowait(event)


class ProjectStore:
    def __init__(self, path: Path | str | None = None) -> None:
        self.path = Path(path) if path else default_project_path()
        self.bus = EventBus()
        self._db = sqlite3.connect(self.path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        self._db.executescript(
            """
            CREATE TABLE IF NOT EXISTS datasets (
                id        TEXT PRIMARY KEY,
                label     TEXT NOT NULL,
                kind      TEXT NOT NULL,          -- molecules | proteins | results
                meta      TEXT NOT NULL DEFAULT '{}',
                created   REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS rows (
                dataset_id TEXT NOT NULL,
                row_index  INTEGER NOT NULL,
                data       TEXT NOT NULL,
                PRIMARY KEY (dataset_id, row_index)
            );
            """
        )
        self._db.commit()

    # --- datasets -------------------------------------------------------
    def list_datasets(self) -> list[dict[str, Any]]:
        rows = self._db.execute("SELECT * FROM datasets ORDER BY created").fetchall()
        out = []
        for r in rows:
            count = self._db.execute(
                "SELECT COUNT(*) AS n FROM rows WHERE dataset_id = ?", (r["id"],)
            ).fetchone()["n"]
            out.append(
                {
                    "id": r["id"],
                    "label": r["label"],
                    "kind": r["kind"],
                    "meta": json.loads(r["meta"]),
                    "rows": count,
                }
            )
        return out

    def upsert_dataset(
        self,
        dataset_id: str,
        label: str,
        kind: str,
        rows: Iterable[dict[str, Any]],
        meta: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        rows = list(rows)
        self._db.execute(
            "INSERT INTO datasets (id, label, kind, meta, created) VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET label=excluded.label, kind=excluded.kind, meta=excluded.meta",
            (dataset_id, label, kind, json.dumps(meta or {}), time.time()),
        )
        self._db.execute("DELETE FROM rows WHERE dataset_id = ?", (dataset_id,))
        self._db.executemany(
            "INSERT INTO rows (dataset_id, row_index, data) VALUES (?, ?, ?)",
            [(dataset_id, i, json.dumps(row)) for i, row in enumerate(rows)],
        )
        self._db.commit()
        self.bus.publish({"type": "dataset_changed", "dataset_id": dataset_id, "rows": len(rows)})
        return {"id": dataset_id, "label": label, "kind": kind, "rows": len(rows)}

    def get_rows(self, dataset_id: str, limit: int = 2000, offset: int = 0) -> list[dict[str, Any]]:
        rows = self._db.execute(
            "SELECT data FROM rows WHERE dataset_id = ? ORDER BY row_index LIMIT ? OFFSET ?",
            (dataset_id, limit, offset),
        ).fetchall()
        return [json.loads(r["data"]) for r in rows]

    def add_column(self, dataset_id: str, column: str, values: dict[int, Any]) -> None:
        """Merge a new column into existing rows (e.g. docking scores)."""
        rows = self._db.execute(
            "SELECT row_index, data FROM rows WHERE dataset_id = ?", (dataset_id,)
        ).fetchall()
        for r in rows:
            data = json.loads(r["data"])
            if r["row_index"] in values:
                data[column] = values[r["row_index"]]
                self._db.execute(
                    "UPDATE rows SET data = ? WHERE dataset_id = ? AND row_index = ?",
                    (json.dumps(data), dataset_id, r["row_index"]),
                )
        self._db.commit()
        self.bus.publish(
            {"type": "column_added", "dataset_id": dataset_id, "column": column}
        )
