"""Regra de prazo: até quando uma nova data de agendamento é aceitável.

Regra (a partir do dia em que o bot está rodando):
  1. Se hoje não é dia útil (fim de semana/feriado), começa a contar do próximo dia útil.
  2. Soma N dias úteis (padrão 10). A data obtida é o prazo máximo (inclusive).

Exemplos (N=10, sem feriados no meio):
  sex 02/10/2026 -> sex 16/10/2026
  sáb 03/10/2026 -> seg 19/10/2026
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Iterable


def feriados_irlanda(anos: Iterable[int]) -> set[date]:
    """Feriados públicos da Irlanda (o escritório de Burgh Quay fecha nesses dias)."""
    import holidays

    return set(holidays.Ireland(years=list(anos)).keys())


def eh_dia_util(d: date, feriados: set[date] = frozenset()) -> bool:
    return d.weekday() < 5 and d not in feriados


def prazo_maximo(hoje: date, dias_uteis: int = 10, feriados: set[date] = frozenset()) -> date:
    d = hoje
    while not eh_dia_util(d, feriados):
        d += timedelta(days=1)
    contados = 0
    while contados < dias_uteis:
        d += timedelta(days=1)
        if eh_dia_util(d, feriados):
            contados += 1
    return d


def dias_uteis_entre(inicio: date, fim: date, feriados: set[date] = frozenset()) -> int:
    """Quantidade de dias úteis em (inicio, fim]. Útil para logs."""
    n, d = 0, inicio
    while d < fim:
        d += timedelta(days=1)
        if eh_dia_util(d, feriados):
            n += 1
    return n
