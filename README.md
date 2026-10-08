# 🔐 Script Host

Приватный защищённый хостинг Lua-скриптов с привязкой к HWID и панелью администратора.

## 📋 Функционал

✅ **Привязка HWID** — каждый executor привязан к уникальному HWID
✅ **HMAC-подпись** — все запросы защищены криптографической подписью
✅ **Rate limiting** — защита от спама и перебора
✅ **Админ-панель** — управление пользователями и бланы
✅ **Одноразовые сессии** — сессии работают 60 секунд и удаляются после использования
✅ **Хонейпоты** — ловушки для автоматических сканеров
✅ **User-Agent фильтр** — только авторизованные клиенты
✅ **Docker** — готовое решение для HF Spaces, Railway, Render

## 🚀 Быстрый старт

### Локально

```bash
# 1. Установить зависимости
npm install

# 2. Запуск
node server.js
```

Открой http://localhost:3000

### На HF Spaces

1. Создай Space → тип Docker
2. Залей репозиторий
3. PORT=7860 уже стоит в Dockerfile

### На Railway / Render

1. Подключи GitHub-репозиторий
2. Автоматически определится Node.js
3. HTTPS даётся автоматически
4. Диск персистентный

## 🔑 Конфигурация

Измени `config.json`:

```json
{
  "port": 3000,
  "authTokens": ["41bcde6302bad3d97c545743990ec81c9df3773a0ad45b09024d2efa3f9ddb2c"],
  "hmacSecret": "12637a5efa78240f187086ef80f18a36abf8ac96290e9a9e32ad9ce612e1e671eca247b695fc2e4e00ab1be1a4d668c61577ef7bcf135ef84853933c8aa2c753",
  "adminKey": "41bcde6302bad3d97c545743990ec81c9df3773a0ad45b09024d2efa3f9ddb2c"
}
```

## 📡 API

### POST /auth — авторизация

```json
{
  "token": "41bcde...",
  "hwid": "unique_hwid",
  "executor": "Synapse",
  "userId": 123456,
  "username": "Player",
  "timestamp": "1694520000000",
  "signature": "hex_hmac_sha256",
  "scriptName": "example.lua"
}
```

Ответ:
```json
{
  "session": "random_session_id",
  "expiresIn": 60
}
```

### GET /script/:name — получить скрипт

Headers:
```
X-Session: session_id
```

## 📂 Структура проекта

```
script-host/
├── package.json
├── config.json
├── server.js
├── hwid_bindings.json
├── public/
│   ├── index.html
│   ├── script.html
│   ├── admin.html
│   ├── style.css
│   └── app.js
└── scripts/
    └── example.lua
```

## 🛡️ Безопасность

- HMAC-SHA256 подписи для всех запросов
- Rate limiting (30 запросов/мин)
- IP банлист с автоматическим добавлением при подозрении
- Хонейпоты для ловли сканеров
- User-Agent фильтр
- Одноразовые сессии
- Timing-safe сравнение подписей

## 📝 Лицензия

МИТ
