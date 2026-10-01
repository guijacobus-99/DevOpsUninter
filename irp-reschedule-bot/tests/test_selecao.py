from datetime import date

from bot.selecao import escolher_data, interpretar_data

HOJE = date(2026, 10, 2)
LIMITE = date(2026, 10, 16)
ATUAL = date(2026, 12, 10)


def test_interpretar_formatos():
    assert interpretar_data("2026-10-12") == date(2026, 10, 12)
    assert interpretar_data("12/10/2026") == date(2026, 10, 12)
    assert interpretar_data("Monday, 12 October 2026") == date(2026, 10, 12)
    assert interpretar_data("October 12th, 2026") == date(2026, 10, 12)
    assert interpretar_data("12", mes_referencia=date(2026, 10, 1)) == date(2026, 10, 12)
    assert interpretar_data("12.10.26", formato="%d.%m.%y") == date(2026, 10, 12)
    assert interpretar_data("sem data") is None


def test_dentro_do_prazo_conclui():
    d, ok = escolher_data([date(2026, 11, 3), date(2026, 10, 9)], HOJE, LIMITE, ATUAL, False)
    assert (d, ok) == (date(2026, 10, 9), True)


def test_limite_inclusivo():
    assert escolher_data([LIMITE], HOJE, LIMITE, ATUAL, False) == (LIMITE, True)


def test_fora_do_prazo_sem_melhoria_parcial():
    assert escolher_data([date(2026, 11, 3)], HOJE, LIMITE, ATUAL, False) == (None, False)


def test_fora_do_prazo_com_melhoria_parcial():
    assert escolher_data([date(2026, 11, 3)], HOJE, LIMITE, ATUAL, True) == (date(2026, 11, 3), False)


def test_ignora_hoje_passado_e_posteriores_ao_atual():
    datas = [HOJE, date(2026, 9, 30), date(2026, 12, 10), date(2026, 12, 20)]
    assert escolher_data(datas, HOJE, LIMITE, ATUAL, True) == (None, False)
