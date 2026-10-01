"""Interação com o portal do ISD (portal.irishimmigration.ie) via Playwright.

Os seletores ficam todos no config.toml, porque o HTML do portal muda e precisa
ser calibrado na sua máquina (veja "Calibrando os seletores" no README).
"""
from __future__ import annotations

import logging
import os
from datetime import date, datetime
from pathlib import Path
from typing import Callable

from playwright.sync_api import BrowserContext, Locator, Page, sync_playwright
from playwright.sync_api import TimeoutError as PWTimeout

from .selecao import interpretar_data

log = logging.getLogger("irp.portal")


class LoginNecessario(Exception):
    """O login não foi concluído dentro do tempo configurado."""


class Portal:
    def __init__(self, cfg: dict, pasta_logs: Path, avisar: Callable[[str], None]):
        self.cfg = cfg
        self.p = cfg["portal"]
        self.cal = cfg["calendario"]
        self.conf = cfg.get("confirmacao", {})
        self.pasta_logs = pasta_logs
        self.avisar = avisar
        self._pw = None
        self.ctx: BrowserContext | None = None
        self.page: Page | None = None
        self._elementos: dict[date, Locator] = {}

    # ---------- ciclo de vida ----------
    def abrir(self) -> None:
        self._pw = sync_playwright().start()
        self.ctx = self._pw.chromium.launch_persistent_context(
            user_data_dir=str(Path(self.p.get("perfil_navegador", "perfil_navegador")).resolve()),
            headless=bool(self.p.get("headless", False)),
            executable_path=self.p.get("executavel_navegador") or None,
            locale="en-IE",
            timezone_id=self.cfg["geral"].get("fuso", "Europe/Dublin"),
            viewport={"width": 1280, "height": 900},
        )
        self.ctx.set_default_timeout(int(self.p.get("timeout_ms", 20000)))
        self.page = self.ctx.pages[0] if self.ctx.pages else self.ctx.new_page()

    def fechar(self) -> None:
        try:
            if self.ctx:
                self.ctx.close()
        finally:
            if self._pw:
                self._pw.stop()
            self.ctx = self.page = self._pw = None

    def descobrir(self) -> None:
        """Abre o portal e o Playwright Inspector para você capturar seletores."""
        self.page.goto(self.p["url_inicial"])
        print("\nUse o botão 'Pick locator' do Playwright Inspector para copiar seletores.")
        print("Feche o Inspector (ou clique em Resume) para encerrar.\n")
        self.page.pause()

    def registrar(self, nome: str) -> None:
        """Salva screenshot + HTML da página atual em logs/ (para depuração)."""
        if not self.page:
            return
        carimbo = datetime.now().strftime("%Y%m%d-%H%M%S")
        base = self.pasta_logs / f"{carimbo}-{nome}"
        try:
            self.page.screenshot(path=f"{base}.png", full_page=True)
            Path(f"{base}.html").write_text(self.page.content(), encoding="utf-8")
        except Exception as e:  # noqa: BLE001 - depuração não pode derrubar o bot
            log.debug("Falha ao salvar registro %s: %s", nome, e)

    # ---------- login ----------
    def _visivel(self, seletor: str, timeout_ms: int) -> bool:
        if not seletor:
            return False
        try:
            self.page.locator(seletor).first.wait_for(state="visible", timeout=timeout_ms)
            return True
        except PWTimeout:
            return False

    def garantir_login(self) -> None:
        self.page.goto(self.p["url_inicial"])
        seletor_logado = self.p["seletor_logado"]
        if self._visivel(seletor_logado, 8000):
            return

        email, senha = os.getenv("IRP_EMAIL"), os.getenv("IRP_SENHA")
        if email and senha and self.p.get("seletor_email"):
            log.info("Preenchendo login automaticamente.")
            self._executar_passos(self.p.get("passos_ate_login", []))
            self.page.locator(self.p["seletor_email"]).first.fill(email)
            if self.p.get("seletor_senha"):
                self.page.locator(self.p["seletor_senha"]).first.fill(senha)
            if self.p.get("seletor_botao_entrar"):
                self.page.locator(self.p["seletor_botao_entrar"]).first.click()
            if self._visivel(seletor_logado, 15000):
                return

        minutos = max(1, int(self.p.get("tempo_login_manual_min", 10)))  # 0 no Playwright = esperar para sempre
        self.avisar(
            f"🔐 Bot IRP: faça login no navegador aberto (captcha/código por e-mail). "
            f"Aguardando até {minutos} min."
        )
        if not self._visivel(seletor_logado, minutos * 60_000):
            self.registrar("login-falhou")
            raise LoginNecessario("Login não concluído a tempo.")
        log.info("Login detectado.")

    # ---------- navegação genérica ----------
    def _executar_passos(self, passos: list[dict]) -> None:
        for passo in passos:
            acao, alvo = passo.get("acao", "clicar"), passo.get("alvo", "")
            log.debug("Passo: %s %s", acao, alvo)
            if acao == "clicar":
                self.page.locator(alvo).first.click()
            elif acao == "ir":
                self.page.goto(alvo)
            elif acao == "esperar":
                self.page.locator(alvo).first.wait_for(state="visible")
            elif acao == "aguardar_ms":
                self.page.wait_for_timeout(int(alvo))
            elif acao == "preencher":
                self.page.locator(alvo).first.fill(str(passo.get("valor", "")))
            elif acao == "selecionar":
                self.page.locator(alvo).first.select_option(str(passo.get("valor", "")))
            else:
                raise ValueError(f"Ação desconhecida no config: {acao!r}")
            self.page.wait_for_load_state("domcontentloaded")

    # ---------- leitura do calendário ----------
    def _mes_exibido(self) -> date | None:
        sel = self.cal.get("seletor_cabecalho_mes")
        if not sel:
            return None
        texto = self.page.locator(sel).first.inner_text().strip()
        fmt = self.cal.get("formato_cabecalho_mes", "%B %Y")
        try:
            return datetime.strptime(" ".join(texto.split()), fmt).date().replace(day=1)
        except ValueError:
            log.warning("Não consegui ler o mês do cabeçalho: %r (formato %s)", texto, fmt)
            return None

    def _datas_da_pagina(self) -> dict[date, Locator]:
        mes = self._mes_exibido()
        atributo = self.cal.get("atributo_data", "")
        formato = self.cal.get("formato_data") or None
        achadas: dict[date, Locator] = {}
        dias = self.page.locator(self.cal["seletor_dias_disponiveis"])
        for i in range(dias.count()):
            el = dias.nth(i)
            bruto = (el.get_attribute(atributo) if atributo else el.inner_text()) or ""
            d = interpretar_data(bruto, formato, mes)
            if d:
                achadas.setdefault(d, el)
            else:
                log.debug("Ignorando dia sem data reconhecível: %r", bruto)
        return achadas

    def ler_datas(self, interessa: Callable[[date], bool]) -> list[date]:
        """Abre o calendário de reagendamento e devolve as datas disponíveis.

        Percorre os meses em ordem e para no primeiro mês que tiver alguma data
        que `interessa` (a mais próxima sempre estará nele), deixando a página
        nesse mês para `reservar` clicar.
        """
        self._executar_passos(self.p.get("passos_ate_calendario", []))
        if self.cal.get("esperar_seletor"):
            self.page.locator(self.cal["esperar_seletor"]).first.wait_for(state="visible")
        self.page.wait_for_timeout(int(self.cal.get("pausa_render_ms", 1500)))

        vistas: list[date] = []
        for mes in range(int(self.cal.get("max_meses", 4))):
            self._elementos = self._datas_da_pagina()
            vistas.extend(self._elementos)
            if any(interessa(d) for d in self._elementos):
                break
            prox = self.cal.get("seletor_proximo_mes")
            if not prox or mes == int(self.cal.get("max_meses", 4)) - 1:
                break
            botao = self.page.locator(prox).first
            if not botao.is_visible() or not botao.is_enabled():
                break
            botao.click()
            self.page.wait_for_timeout(int(self.cal.get("pausa_render_ms", 1500)))
        self.registrar("calendario")
        return sorted(set(vistas))

    # ---------- reserva ----------
    def reservar(self, d: date) -> bool:
        el = self._elementos.get(d)
        if el is None:
            raise RuntimeError(f"Data {d} não está na página atual do calendário.")
        el.click()
        self.page.wait_for_timeout(int(self.cal.get("pausa_render_ms", 1500)))

        sel_horarios = self.cal.get("seletor_horarios")
        if sel_horarios:
            horarios = self.page.locator(sel_horarios)
            horarios.first.wait_for(state="visible")
            horarios.first.click()

        self._executar_passos(self.conf.get("passos", []))
        sucesso = self.conf.get("seletor_sucesso")
        ok = self._visivel(sucesso, int(self.conf.get("timeout_sucesso_ms", 20000))) if sucesso else True
        self.registrar("reserva-ok" if ok else "reserva-falhou")
        return ok
