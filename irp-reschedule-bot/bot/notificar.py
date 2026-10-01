"""Avisos: sempre no log; opcionalmente no Telegram (IRP_TELEGRAM_TOKEN / IRP_TELEGRAM_CHAT_ID)."""
from __future__ import annotations

import json
import logging
import os
import urllib.request

log = logging.getLogger("irp.aviso")


def avisar(msg: str) -> None:
    log.warning(msg)
    print("\a", end="", flush=True)  # bipe no terminal
    token, chat = os.getenv("IRP_TELEGRAM_TOKEN"), os.getenv("IRP_TELEGRAM_CHAT_ID")
    if not (token and chat):
        return
    try:
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data=json.dumps({"chat_id": chat, "text": msg}).encode(),
            headers={"Content-Type": "application/json"},
        )
        urllib.request.urlopen(req, timeout=15).read()
    except Exception as e:  # noqa: BLE001 - aviso não pode derrubar o bot
        log.error("Falha ao enviar Telegram: %s", e)
