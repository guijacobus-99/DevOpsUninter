"""Bot de reagendamento do IRP (Burgh Quay).

Uso:
  python -m bot.main                 # roda em loop até concluir
  python -m bot.main --uma-vez       # uma tentativa (para agendar no cron/Agendador de Tarefas)
  python -m bot.main --descobrir     # abre o portal + Inspector para calibrar seletores
  python -m bot.main --prazo         # só mostra o prazo de hoje
"""
from __future__ import annotations

import argparse
import json
import logging
import random
import sys
import time
import tomllib
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from .notificar import avisar
from .prazo import dias_uteis_entre, feriados_irlanda, prazo_maximo
from .selecao import escolher_data

log = logging.getLogger("irp")
RAIZ = Path(__file__).resolve().parent.parent


# ---------- config / estado ----------
def carregar_config(caminho: Path) -> dict:
    with open(caminho, "rb") as f:
        return tomllib.load(f)


class Estado:
    """Persistido em estado.json: data atual do agendamento e se o trabalho terminou."""

    def __init__(self, caminho: Path, data_config: str):
        self.caminho = caminho
        dados = json.loads(caminho.read_text()) if caminho.exists() else {}
        self.agendamento_atual = date.fromisoformat(dados.get("agendamento_atual", data_config))
        self.concluido = bool(dados.get("concluido", False))
        self.ultimo_aviso = dados.get("ultimo_aviso")
        self.historico = dados.get("historico", [])

    def salvar(self) -> None:
        self.caminho.write_text(json.dumps({
            "agendamento_atual": self.agendamento_atual.isoformat(),
            "concluido": self.concluido,
            "ultimo_aviso": self.ultimo_aviso,
            "historico": self.historico,
        }, indent=2, ensure_ascii=False))


# ---------- regra de prazo ----------
def calcular_prazo(cfg: dict, hoje: date) -> date:
    g = cfg["geral"]
    feriados = feriados_irlanda([hoje.year, hoje.year + 1]) if g.get("considerar_feriados_irlanda", True) else set()
    return prazo_maximo(hoje, int(g.get("dias_uteis", 10)), feriados)


def agora(cfg: dict) -> datetime:
    return datetime.now(ZoneInfo(cfg["geral"].get("fuso", "Europe/Dublin")))


# ---------- uma tentativa ----------
def tentativa(cfg: dict, estado: Estado, portal) -> bool:
    """Executa uma checagem. Retorna True quando o trabalho está concluído."""
    g = cfg["geral"]
    hoje = agora(cfg).date()
    limite = calcular_prazo(cfg, hoje)
    simulacao = bool(g.get("modo_simulacao", True))
    log.info("Hoje %s | prazo máximo %s | agendamento atual %s%s",
             hoje, limite, estado.agendamento_atual, " | SIMULAÇÃO" if simulacao else "")

    if estado.agendamento_atual <= limite:
        log.info("O agendamento atual já está dentro do prazo. Nada a fazer.")
        estado.concluido = True
        estado.salvar()
        return True

    portal.garantir_login()
    datas = portal.ler_datas(lambda d: hoje < d < estado.agendamento_atual)
    log.info("Datas disponíveis vistas: %s", ", ".join(d.strftime("%d/%m") for d in datas) or "nenhuma")

    escolhida, cumpre = escolher_data(
        datas, hoje, limite, estado.agendamento_atual, bool(g.get("aceitar_melhoria_parcial", True))
    )
    if not escolhida:
        log.info("Nenhuma data melhor que %s.", estado.agendamento_atual)
        return False

    resumo = (f"{escolhida:%d/%m/%Y} ({dias_uteis_entre(hoje, escolhida)} dias úteis a partir de hoje; "
              f"prazo {limite:%d/%m/%Y})")
    if simulacao:
        if estado.ultimo_aviso != escolhida.isoformat():
            avisar(f"👀 Bot IRP (simulação): vaga em {resumo}. Não reagendei porque modo_simulacao=true.")
            estado.ultimo_aviso = escolhida.isoformat()
            estado.salvar()
        return False

    log.info("Tentando reagendar para %s", resumo)
    if not portal.reservar(escolhida):
        avisar(f"⚠️ Bot IRP: tentei reagendar para {resumo}, mas não vi a confirmação. Confira o portal e a pasta logs/.")
        return False

    anterior = estado.agendamento_atual
    estado.agendamento_atual = escolhida
    estado.historico.append({"em": agora(cfg).isoformat(timespec="seconds"),
                             "de": anterior.isoformat(), "para": escolhida.isoformat()})
    estado.concluido = cumpre
    estado.salvar()
    if cumpre:
        avisar(f"✅ Bot IRP: REAGENDADO para {resumo}. Trabalho concluído!")
    else:
        avisar(f"📅 Bot IRP: melhorei de {anterior:%d/%m/%Y} para {resumo}. Continuo tentando chegar no prazo.")
    return cumpre


# ---------- agenda ----------
def dentro_da_janela(cfg: dict, momento: datetime) -> bool:
    g = cfg["geral"]
    ini = datetime.strptime(g.get("janela_inicio", "07:00"), "%H:%M").time()
    fim = datetime.strptime(g.get("janela_fim", "23:00"), "%H:%M").time()
    return ini <= momento.time() <= fim


def esperar_proxima(cfg: dict) -> None:
    g = cfg["geral"]
    intervalo = max(10, int(g.get("intervalo_minutos", 30)))  # piso de 10 min para não martelar o portal
    variacao = int(g.get("variacao_minutos", 10))
    minutos = intervalo + random.uniform(-variacao, variacao)
    proxima = agora(cfg) + timedelta(minutes=max(5, minutos))
    log.info("Próxima tentativa às %s", proxima.strftime("%d/%m %H:%M"))
    time.sleep((proxima - agora(cfg)).total_seconds())


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Bot de reagendamento do IRP Stamp 2")
    ap.add_argument("--config", default=str(RAIZ / "config.toml"))
    ap.add_argument("--uma-vez", action="store_true", help="faz uma única tentativa e sai")
    ap.add_argument("--descobrir", action="store_true", help="abre o portal com o Playwright Inspector")
    ap.add_argument("--prazo", action="store_true", help="mostra o prazo calculado para hoje e sai")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)

    pasta_logs = RAIZ / "logs"
    pasta_logs.mkdir(exist_ok=True)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(message)s",
        handlers=[logging.StreamHandler(sys.stdout),
                  logging.FileHandler(pasta_logs / "bot.log", encoding="utf-8")],
    )
    cfg = carregar_config(Path(args.config))

    if args.prazo:
        hoje = agora(cfg).date()
        print(f"Hoje {hoje:%a %d/%m/%Y} -> prazo máximo {calcular_prazo(cfg, hoje):%a %d/%m/%Y}")
        return 0

    estado = Estado(RAIZ / "estado.json", cfg["geral"]["data_agendamento_atual"])
    if estado.concluido and not args.descobrir:
        log.info("Trabalho já concluído (agendamento em %s). Apague estado.json para recomeçar.",
                 estado.agendamento_atual)
        return 0

    from .portal import LoginNecessario, Portal  # import tardio: --prazo funciona sem Playwright

    portal = Portal(cfg, pasta_logs, avisar)
    portal.abrir()
    try:
        if args.descobrir:
            portal.descobrir()
            return 0
        while True:
            if dentro_da_janela(cfg, agora(cfg)):
                try:
                    if tentativa(cfg, estado, portal):
                        return 0
                except LoginNecessario as e:
                    log.error("%s", e)
                except Exception:  # noqa: BLE001 - registra e tenta de novo no próximo ciclo
                    log.exception("Erro na tentativa")
                    portal.registrar("erro")
            else:
                log.info("Fora da janela de horário; aguardando.")
            if args.uma_vez:
                return 0
            esperar_proxima(cfg)
    except KeyboardInterrupt:
        log.info("Interrompido pelo usuário.")
        return 130
    finally:
        portal.fechar()


if __name__ == "__main__":
    sys.exit(main())
