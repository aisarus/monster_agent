---
name: git-workflow
description: Делает git-ветку, коммит и PR когда задача меняет проект.
version: 1.0.0
metadata:
  requires:
    env: []
    bins: [git]
  security: L2
---

# Git Workflow

## Когда использовать
- Нужно сохранить изменения в git.
- Нужно подготовить ветку или PR для изменения кода, документации или тестов.
- Нужно понять, можно ли коммитить текущий diff.

## Workflow
1. Проверь `git status --short --branch` и не смешивай чужие изменения со своими.
2. Если изменения не тривиальные и workspace чистый, создай ветку: `feat/<short-topic>`, `fix/<short-topic>` или `chore/<short-topic>`.
3. Перед commit посмотри `git diff` и убедись, что в diff нет `.env`, токенов, runtime state и лишнего форматирования.
4. Запусти обязательные проверки: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
5. Коммить только нужные файлы сообщением `feat: ...`, `fix: ...`, `chore: ...` или `docs: ...`.
6. Открывай PR, если изменения должны пройти review или затрагивают runtime, tools, безопасность, GitHub/API или PM2.
7. Просто commit без PR допустим только для локальной документации или явно разрешённой owner-правки.

## Выходной формат
В Telegram напиши:

- branch: имя ветки или `main`
- commit: hash или `not created`
- PR: URL или `not opened`
- checks: список четырёх проверок и их статус
- next: одно конкретное действие

## Стоп-условия
- Workspace содержит чужие незакоммиченные изменения в тех же файлах: остановись и попроси owner решить конфликт.
- Любая проверка падает после 3 попыток исправления: остановись, напиши failing command и последний короткий error.
- В diff найден секрет или `.env`: не коммить, напиши warning в Telegram.
