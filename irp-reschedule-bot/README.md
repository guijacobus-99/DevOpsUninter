# Bot de reagendamento do IRP (Stamp 2, Burgh Quay)

O bot entra no portal do ISD (`portal.irishimmigration.ie`) e olha as datas livres do agendamento. Quando acha uma data mais próxima, ele **reagenda sozinho**. O trabalho termina quando o agendamento fica a **no máximo 10 dias úteis** do dia em que o bot está rodando.

## Regra do prazo

1. Se hoje for fim de semana ou feriado, a contagem começa no próximo dia útil.
2. Somam-se 10 dias úteis. A data obtida é o prazo máximo, e o próprio dia do prazo vale.

| Dia em que rodou | Prazo máximo |
|---|---|
| sex 02/10/2026 | sex 16/10/2026 |
| sáb 03/10/2026 | seg 19/10/2026 |
| sex 16/10/2026 | seg 02/11/2026 (o feriado irlandês de 26/10 não conta) |

Uma data com 5 dias úteis, por exemplo, também está dentro do prazo e encerra o serviço. Se não houver data dentro do prazo, o bot tenta de novo mais tarde e recalcula o prazo a cada novo dia.

Com `aceitar_melhoria_parcial = true` (o padrão), ele também pega uma data **melhor que a atual**, mesmo fora do prazo. Por exemplo, troca dezembro por novembro e continua tentando até chegar no prazo. Com `false`, ele só reagenda quando a data está dentro do prazo.

## Instalação (na sua máquina)

```bash
cd irp-reschedule-bot
python -m venv .venv
# Windows: .venv\Scripts\activate    |   Mac/Linux: source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
cp config.example.toml config.toml      # Windows: copy config.example.toml config.toml
```

Para conferir o prazo de hoje:

```bash
python -m bot.main --prazo
```

## Calibrando os seletores (obrigatório, uma vez)

O portal exige login e muda o HTML de vez em quando. Por isso, os botões e o calendário ficam configurados em `config.toml`. Todo valor marcado com `<<CALIBRAR>>` precisa ser conferido:

1. Rode `python -m bot.main --descobrir`. O Chromium abre junto com o **Playwright Inspector**.
2. Faça login normalmente. O navegador guarda a sessão na pasta `perfil_navegador/`.
3. Vá até a tela de reagendamento. No Inspector, use **Pick locator** e clique em cada elemento:
   - algo que só aparece quando você está logado → `seletor_logado`;
   - cada botão ou link do painel até o calendário → `passos_ate_calendario`;
   - um dia **disponível** do calendário → `seletor_dias_disponiveis`. Veja também onde está a data: no texto, em `aria-label` ou em `data-date` → `atributo_data`;
   - o botão de próximo mês → `seletor_proximo_mes`;
   - os horários, se houver → `seletor_horarios`;
   - o botão de confirmar → `[confirmacao].passos`;
   - a mensagem de sucesso → `seletor_sucesso`.
4. Rode **em simulação** (`modo_simulacao = true`, o padrão): `python -m bot.main --uma-vez -v`.
   O log precisa listar as datas disponíveis corretamente. A pasta `logs/` guarda screenshot e HTML de cada tentativa.
5. Se as datas estiverem certas, mude para `modo_simulacao = false` e deixe o bot rodando.

> ⚠️ Não use o botão de confirmar enquanto testa no portal real. O passo de confirmação só roda com `modo_simulacao = false`.

## Rodando

```bash
python -m bot.main          # loop: tenta a cada ~30 min (±10), das 07:00 às 23:30 (horário de Dublin)
python -m bot.main --uma-vez  # uma tentativa e sai (para cron ou Agendador de Tarefas do Windows)
```

- Na primeira execução, faça o login no navegador que abrir. Depois disso, a sessão fica salva.
- O login também pode ser preenchido sozinho. Para isso, defina `IRP_EMAIL` e `IRP_SENHA`. Captcha e código por e-mail continuam sendo com você: o bot avisa e espera até `tempo_login_manual_min`.
- O estado fica salvo em `estado.json`: data atual, histórico de trocas e se terminou. Para recomeçar, apague esse arquivo.

### Avisos no celular (Telegram, opcional)

1. Fale com o `@BotFather` no Telegram, crie um bot e copie o token.
2. Mande qualquer mensagem para o seu bot. Depois, abra `https://api.telegram.org/bot<TOKEN>/getUpdates` e copie o `chat.id`.
3. Defina as variáveis `IRP_TELEGRAM_TOKEN` e `IRP_TELEGRAM_CHAT_ID`.

O bot avisa quando precisa de login, quando acha uma vaga (em simulação), quando melhora a data e quando conclui.

## Boas práticas

- O intervalo mínimo entre tentativas é de 10 minutos. Vagas de cancelamento aparecem a qualquer hora, mas checar o portal sem parar pode bloquear sua conta.
- O bot só mexe no **seu** agendamento, com o **seu** login. Ele não resolve captcha.
- Confira sempre o e-mail de confirmação do ISD depois de um reagendamento.

## Testes

```bash
pip install pytest
python -m pytest -q
```

Os testes cobrem a regra do prazo, a escolha da data e um fluxo completo contra um **portal falso** local (`tests/portal_falso/`): login, troca de mês, horário e confirmação.
