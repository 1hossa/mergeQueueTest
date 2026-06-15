# Merge Queue Performance Lab

Тестовый проект для сравнения CI-флоу на стороне GitHub:
- без Merge Queue
- с нативным GitHub Merge Queue

Тесты симулируются, но нагрузка выглядит как "тяжелый" CI:
- большой объем тестов
- шардирование
- заметное время выполнения джоб

## GitHub workflows в проекте

- `.github/workflows/ci-baseline.yml`
	- событие: `pull_request`
	- целевая ветка: `main-no-mq`
	- сценарий без Merge Queue
- `.github/workflows/ci-merge-queue.yml`
	- события: `pull_request`, `merge_group`
	- целевая ветка: `main`
	- сценарий с нативным GitHub Merge Queue
- `.github/workflows/heavy-suite.yml`
	- reusable heavy suite на 8 шардов
	- используется в обоих сценариях для честного сравнения

## Как включить нативный GitHub Merge Queue

1. Создайте две защищаемые ветки: `main-no-mq` и `main`.
2. Настройте Branch protection для `main-no-mq`:
	 - включите Required status checks
	 - выберите стабильный check `heavy-suite / gate`
	 - не включайте Merge Queue
3. Настройте Branch protection для `main`:
	 - включите Required status checks
	 - выберите стабильный check `heavy-suite / gate`
	 - включите `Require merge queue`
4. Делайте PR в обе ветки с одинаковой нагрузкой и сравнивайте Actions-метрики.

Важно: для реальной работы Merge Queue workflow обязан слушать событие `merge_group`.
Важно: check `heavy-suite / gate` появится в списке только после первого запуска Actions на PR в целевую ветку.

## Быстрая локальная симуляция

```bash
npm run compare
```

```bash
npm run compare:big
```

## CSV + график для презентации

```bash
npm run compare:sweep
```

После запуска генерируются файлы:
- `results/sweep.csv`
- `results/sweep-report.md`

Кастомный sweep:

```bash
node src/sweep.js --batches=1,2,4,6,8,10 --prs=120 --tests=1400 --trials=60
```

## Сбор реальных метрик из GitHub Actions

```bash
GH_TOKEN=YOUR_TOKEN npm run metrics:github -- --repo=owner/repo --days=14
```

Автоматически сохраняются файлы:
- `results/github-metrics.csv`
- `results/github-metrics-report.md`

Можно переопределить директорию вывода:

```bash
GH_TOKEN=YOUR_TOKEN npm run metrics:github -- --repo=owner/repo --days=14 --outdir=custom-results
```

Скрипт сравнивает:
- `pull_request` для ветки `main-no-mq`
- `pull_request` для ветки `main`
- `merge_group` для ветки `main`

И выводит:
- количество run
- success rate
- mean/p50/p95 duration
- mean/p95 queue wait

## Что смотреть в сравнении

- Duration (mean/p95): средняя и хвостовая скорость CI
- Queue wait: как долго run ждет старта
- Merge Group runs: стабильность прохождения очереди
- PR throughput: сколько PR реально доходит до merge за интервал
