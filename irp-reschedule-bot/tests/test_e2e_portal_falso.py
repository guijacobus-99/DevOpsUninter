"""Teste ponta a ponta contra um portal falso local (tests/portal_falso/index.html)."""
import functools
import http.server
import threading
import tomllib
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

pytest.importorskip("playwright")

from bot import main as bot_main  # noqa: E402
from bot.portal import Portal  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
PASTA_FALSO = Path(__file__).resolve().parent / "portal_falso"


@pytest.fixture(scope="module")
def servidor():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(PASTA_FALSO))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}/index.html"
    srv.shutdown()


def montar(tmp_path, url, slots, simulacao=False, melhoria=True):
    with open(RAIZ / "config.example.toml", "rb") as f:
        cfg = tomllib.load(f)
    cfg["geral"].update(modo_simulacao=simulacao, aceitar_melhoria_parcial=melhoria)
    cfg["portal"].update(
        url_inicial=f"{url}?slots={','.join(slots)}",
        perfil_navegador=str(tmp_path / "perfil"),
        headless=True,
        tempo_login_manual_min=0,
        executavel_navegador=_chromium(),
    )
    cfg["calendario"].update(seletor_dias_disponiveis="button.day:not([disabled])", pausa_render_ms=100,
                             seletor_horarios="button.slot")
    cfg["confirmacao"]["seletor_sucesso"] = "#sucesso"
    estado = bot_main.Estado(tmp_path / "estado.json", "2026-12-10")
    portal = Portal(cfg, tmp_path, lambda m: avisos.append(m))
    return cfg, estado, portal


def _chromium():
    candidatos = sorted(Path("/opt/pw-browsers").glob("chromium-*/chrome-linux/chrome"))
    return str(candidatos[-1]) if candidatos else None


avisos: list[str] = []


@pytest.fixture(autouse=True)
def hoje_fixo(monkeypatch):
    avisos.clear()
    monkeypatch.setenv("IRP_EMAIL", "eu@example.com")
    monkeypatch.setenv("IRP_SENHA", "x")
    monkeypatch.setattr(bot_main, "agora", lambda cfg: datetime(2026, 10, 2, 9, 0, tzinfo=ZoneInfo("Europe/Dublin")))
    monkeypatch.setattr(bot_main, "avisar", lambda m: avisos.append(m))


def rodar(cfg, estado, portal):
    portal.abrir()
    try:
        return bot_main.tentativa(cfg, estado, portal), portal.page.evaluate("localStorage.getItem('reservado')")
    finally:
        portal.fechar()


def test_reagenda_dentro_do_prazo_em_outro_mes(tmp_path, servidor):
    # Prazo a partir de 02/10 = 16/10. Há 15/10 e 29/10; também testa login automático.
    cfg, estado, portal = montar(tmp_path, servidor, ["2026-10-29", "2026-10-15", "2026-11-20"])
    concluido, reservado = rodar(cfg, estado, portal)
    assert concluido is True
    assert reservado == "2026-10-15"
    assert estado.concluido and estado.agendamento_atual.isoformat() == "2026-10-15"


def test_navega_para_proximo_mes_e_faz_melhoria_parcial(tmp_path, servidor):
    cfg, estado, portal = montar(tmp_path, servidor, ["2026-11-20", "2026-11-05"])
    concluido, reservado = rodar(cfg, estado, portal)
    assert concluido is False
    assert reservado == "2026-11-05"
    assert estado.agendamento_atual.isoformat() == "2026-11-05" and not estado.concluido


def test_simulacao_nao_reserva(tmp_path, servidor):
    cfg, estado, portal = montar(tmp_path, servidor, ["2026-10-15"], simulacao=True)
    concluido, reservado = rodar(cfg, estado, portal)
    assert concluido is False and reservado is None
    assert any("simulação" in a for a in avisos)


def test_sem_melhoria_parcial_nao_reserva_fora_do_prazo(tmp_path, servidor):
    cfg, estado, portal = montar(tmp_path, servidor, ["2026-11-05"], melhoria=False)
    concluido, reservado = rodar(cfg, estado, portal)
    assert concluido is False and reservado is None
