from datetime import date

from bot.prazo import feriados_irlanda, prazo_maximo


def test_exemplo_sexta():
    assert prazo_maximo(date(2026, 10, 2)) == date(2026, 10, 16)


def test_exemplo_sabado():
    assert prazo_maximo(date(2026, 10, 3)) == date(2026, 10, 19)


def test_domingo_igual_sabado():
    assert prazo_maximo(date(2026, 10, 4)) == date(2026, 10, 19)


def test_segunda():
    assert prazo_maximo(date(2026, 10, 5)) == date(2026, 10, 19)


def test_feriado_irlanda_empurra_prazo():
    # 26/10/2026 é o October Bank Holiday na Irlanda.
    fer = feriados_irlanda([2026])
    assert prazo_maximo(date(2026, 10, 16)) == date(2026, 10, 30)
    assert prazo_maximo(date(2026, 10, 16), feriados=fer) == date(2026, 11, 2)


def test_natal():
    fer = feriados_irlanda([2026, 2027])
    # 25/12 e 01/01 são feriados (26/12/2026 cai num sábado).
    assert prazo_maximo(date(2026, 12, 18), feriados=fer) == date(2027, 1, 5)
