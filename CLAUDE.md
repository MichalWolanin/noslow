# noslow

Open-source middleware do monitorowania wydajności zapytań SQL z AI rekomendacjami.
Model: open core — darmowe core na GitHubie, płatny SaaS w przyszłości.

## Co budujemy

Paczka npm która wchodzi między aplikację a bazę danych, mierzy czas zapytań SQL,
wykrywa problemy (wolne query, N+1, brak indeksów) i wysyła alert z gotowym fixem
na Slack/Discord/Teams/Telegram. Opcjonalnie używa Claude API do inteligentnej analizy.
Instalacja przez interaktywny CLI — zero ręcznej konfiguracji.

## Stack techniczny

- Język: TypeScript
- Runtime: Node.js (MVP), później .NET i Java
- Dystrybucja: paczka npm + npx noslow init
- Bazy danych: PostgreSQL (pg), MySQL (mysql2)
- AI: Claude Haiku API (opcjonalnie), tryb rules (bez AI), tryb local (Ollama)
- Notifiery: konsola, Slack, Discord, Microsoft Teams, Telegram

## Struktura projektu

noslow/
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── cli/
│   │   └── init.ts            ← npx noslow init
│   ├── middleware/
│   │   ├── pg.ts
│   │   └── mysql.ts
│   ├── analyzers/
│   │   ├── rules.ts
│   │   ├── claude.ts
│   │   └── ollama.ts
│   ├── notifiers/
│   │   ├── console.ts
│   │   ├── slack.ts
│   │   ├── discord.ts
│   │   ├── teams.ts
│   │   └── telegram.ts
│   └── privacy/
│       └── sanitizer.ts
├── examples/
│   └── nestjs-postgres/
├── CLAUDE.md
├── README.md
└── package.json

## Bezpieczeństwo danych — zasada nadrzędna

Narzędzie NIGDY nie wysyła surowych wartości z bazy danych.
Sanitizer uruchamia się ZAWSZE jako pierwszy — przed logowaniem i przed wysyłaniem.

Przykład:
- oryginał: SELECT * FROM users WHERE email = 'jan@firma.pl' AND age > 30
- co wysyłamy: SELECT * FROM users WHERE email = ? AND age > ?

Trzy tryby prywatności:
- safe — domyślny, wycina wartości
- paranoid — wycina wartości i nazwy tabel: SELECT * FROM [table] WHERE [col] = ?
- local — zero połączeń sieciowych, tylko konsola

## CLI Installer

Developer odpala: npx noslow init

Pyta interaktywnie o:
1. Baza danych: PostgreSQL / MySQL / Obie
2. Tryb analizy: rules / cloud (Claude API) / local (Ollama)
3. Notifiery: konsola / Slack / Discord / Teams / Telegram (multi-select)
4. Próg alertu w ms (domyślnie 500)
5. Tryb prywatności: safe / paranoid / local

Generuje .sentinelrc.json i instaluje tylko wybrane zależności.

## Tryby analizy

rules (domyślny, zero zależności):
- wolne zapytanie — czas > threshold
- N+1 — to samo zapytanie > 5 razy w jednym cyklu requestu
- full table scan — brak WHERE w SELECT
- sugestia indeksu na podstawie struktury WHERE

cloud (Claude Haiku API):
- wysyła zanonimizowane zapytanie
- zwraca: opis problemu + gotowy fix SQL + szacowany efekt

local (Ollama):
- identyczny jak cloud ale model lokalnie
- zero zewnętrznych połączeń

## Format alertu (każdy notifier)

- endpoint gdzie wystąpiło zapytanie
- czas wykonania w ms
- zanonimizowane zapytanie SQL
- wykryty problem
- gotowy fix w SQL
- szacowany efekt naprawy

## Konfiguracja API

import { sqlSentinel } from 'noslow'

sqlSentinel()  // minimalna — działa od razu

sqlSentinel({
  threshold: 500,
  mode: 'rules',
  privacy: 'safe',
  anthropicKey: process.env.ANTHROPIC_KEY,
  notifiers: {
    console: true,
    slack: process.env.SLACK_WEBHOOK,
    discord: process.env.DISCORD_WEBHOOK,
    teams: process.env.TEAMS_WEBHOOK,
    telegram: {
      token: process.env.TELEGRAM_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID
    }
  },
  rateLimit: 300,
})

## Kolejność budowania — ścisłe priorytety

Buduj dokładnie w tej kolejności. Nie przechodź dalej dopóki poprzedni krok nie działa i nie ma testów.

1.  types.ts — interfejsy: Config, Alert, QueryEvent, PrivacyMode, AnalyzerResult
2.  privacy/sanitizer.ts — anonimizacja wartości SQL
3.  middleware/pg.ts — monkey-patch dla PostgreSQL
4.  middleware/mysql.ts — monkey-patch dla MySQL
5.  analyzers/rules.ts — N+1, wolne query, full table scan
6.  notifiers/console.ts — kolorowy log w terminalu
7.  index.ts — główny export, składa wszystko razem
8.  cli/init.ts — npx noslow init, interaktywny installer
9.  examples/nestjs-postgres — działający projekt testowy
10. Testy: sanitizer + wykrywanie N+1
11. notifiers/slack.ts
12. notifiers/discord.ts
13. notifiers/teams.ts
14. notifiers/telegram.ts
15. analyzers/claude.ts — Claude Haiku API
16. analyzers/ollama.ts — lokalny LLM
17. README.md — GIF demo, instrukcja instalacji, przykłady

## Zasady których nie łam

- Sanitizer uruchamia się ZAWSZE przed logowaniem i wysyłaniem — bez wyjątków
- Każda funkcja robi jedną rzecz
- Zero zewnętrznych zależności dla trybu rules
- Błąd w naszym kodzie NIE MOŻE crashować aplikacji developera — try/catch wszędzie
- Rate limiting — ten sam alert max raz na 5 minut
- Instaluj tylko zależności które developer wybrał w CLI