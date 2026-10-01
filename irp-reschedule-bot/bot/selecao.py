"""Leitura de datas exibidas no portal e escolha da melhor data."""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Iterable

FORMATOS_COMUNS = [
    "%Y-%m-%d",
    "%d/%m/%Y",
    "%d-%m-%Y",
    "%A, %d %B %Y",
    "%A %d %B %Y",
    "%d %B %Y",
    "%B %d, %Y",
    "%A, %B %d, %Y",
    "%d %b %Y",
    "%b %d, %Y",
]


def interpretar_data(texto: str, formato: str | None = None, mes_referencia: date | None = None) -> date | None:
    """Converte o texto/atributo de um dia do calendário em `date`.

    - `formato`: formato strptime configurado (tem prioridade).
    - Sem formato, tenta ISO, dd/mm/aaaa e formatos em inglês.
    - Se o texto for só o número do dia ("12"), usa `mes_referencia` (mês exibido no calendário).
    """
    t = " ".join((texto or "").split())
    if not t:
        return None
    if formato:
        try:
            return datetime.strptime(t, formato).date()
        except ValueError:
            pass
    m = re.search(r"\d{4}-\d{2}-\d{2}", t)
    if m:
        return date.fromisoformat(m.group())
    m = re.search(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b", t)
    if m:
        return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    limpo = re.sub(r"(\d)(st|nd|rd|th)\b", r"\1", t)
    for fmt in FORMATOS_COMUNS:
        try:
            return datetime.strptime(limpo, fmt).date()
        except ValueError:
            continue
    if t.isdigit() and mes_referencia:
        try:
            return mes_referencia.replace(day=int(t))
        except ValueError:
            return None
    return None


def escolher_data(
    disponiveis: Iterable[date],
    hoje: date,
    limite: date,
    agendamento_atual: date | None,
    aceitar_melhoria_parcial: bool,
) -> tuple[date | None, bool]:
    """Retorna (data_escolhida, cumpre_prazo).

    - Só considera datas futuras (> hoje) e anteriores ao agendamento atual.
    - Se existir data <= limite: escolhe a mais próxima e cumpre_prazo=True (trabalho concluído).
    - Senão, se `aceitar_melhoria_parcial`, escolhe a mais próxima mesmo fora do prazo
      (melhora o agendamento enquanto continua tentando).
    """
    candidatas = sorted(
        d for d in set(disponiveis)
        if d > hoje and (agendamento_atual is None or d < agendamento_atual)
    )
    if not candidatas:
        return None, False
    melhor = candidatas[0]
    if melhor <= limite:
        return melhor, True
    if aceitar_melhoria_parcial:
        return melhor, False
    return None, False
