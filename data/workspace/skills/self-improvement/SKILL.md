---
name: self-improvement
description: Улучшает Monster Agent когда есть backlog, failures или повторяемый workflow.
version: 1.0.0
metadata:
  requires:
    env: []
    bins: [git, npm]
  security: L2
---

# Self Improvement

## Когда использовать
- Autopilot выбирает следующую задачу самоулучшения.
- Есть pending item в `data/memory/backlog.json`.
- Одна и та же ошибка или ручной workflow повторились больше одного раза.

## Workflow
1. Сначала проверь `data/memory/backlog.json`; бери pending задачу с `priority=high`.
2. Если backlog пуст, изучи failed задачи и выбери повторяемый паттерн ошибки.
3. Сформулируй один маленький gap: один модуль, один тест, один измеримый результат.
4. Сделай минимальное изменение, не трогай `.env` и не меняй unrelated modules.
5. Измерь результат: зелёные проверки, новый тест, снижение failure pattern или новый skill.
6. Запиши решение в `data/memory/decisions.json`.
7. Если workflow пригодится снова, создай или обнови skill.

## Выходной формат
В Telegram напиши:

- gap: что улучшал
- changed: файлы
- measured_by: тест/проверка/метрика
- result: получилось или нет
- memory: запись в `data/memory/decisions.json`

## Стоп-условия
- Нужно менять production credentials, `.env`, systemd, PM2 startup или firewall: остановись и запроси approval.
- Нет понятного измерения успеха: не начинай, предложи owner уточнить критерий.
- Проверки не проходят после 3 попыток: остановись и напиши failing command.
