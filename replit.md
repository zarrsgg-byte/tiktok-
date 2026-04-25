# TikTok Downloader Telegram Bot

## Overview

This is a Telegram bot that allows users to download TikTok videos, audio, and photos without watermarks. The bot accepts TikTok links from users, processes them through the TikWM API and btch-downloader library, and returns the media content directly in Telegram. It supports multiple languages (English, Indonesian, Arabic, Chinese) and includes an AI assistant powered by an external chat API to help guide users.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Application Structure
- **Entry Point**: `index.js` bootstraps the application, sets up Express server, creates required directories, and handles global error management
- **Bot Logic**: `main.js` contains the Telegram bot initialization using `node-telegram-bot-api` library with polling mode
- **Request Handler**: `handler.js` processes TikTok URLs, manages video/audio streaming, and handles FFmpeg transcoding
- **Plugin System**: Modular plugins in `plugins/` directory handle specific content types (video vs photo/slideshow)

### Content Processing Pipeline
1. User sends TikTok link to bot
2. Link validated against allowed TikTok hosts
3. Content fetched via TikWM API (`https://www.tikwm.com/api/`) and btch-downloader library
4. Videos processed through FFmpeg for compression/format conversion when needed
5. Media sent back to user with metadata (title, audio info, direct links)

### Rate Limiting & Queue Management
- Custom `TaskQueue` class in `utils/queue.js` limits concurrent processing to 3 tasks
- Per-user cooldown tracking prevents spam
- Retry logic with exponential backoff for Telegram API rate limits (429 errors)

### Internationalization
- Language files stored as JSON in `lang/` directory
- Supports: English (en), Indonesian (id), Arabic (ar), Chinese (zh)
- Fallback to English for missing translations

### AI Integration
- External AI API at `https://aichat-api.vercel.app/chatgpt` handles off-topic messages
- Custom system prompt keeps responses focused on TikTok downloading guidance

### Temporary File Management
- `temp/` directory used for FFmpeg video processing
- Automatic cleanup scheduled via `AUDIO_CLEANUP_MS` config (60 seconds)

## External Dependencies

### Third-Party APIs
- **TikWM API**: `https://www.tikwm.com/api/` - Primary TikTok content extraction
- **AI Chat API**: `https://aichat-api.vercel.app/chatgpt` - Conversational AI for user guidance

### Key NPM Packages
- `node-telegram-bot-api`: Telegram Bot API wrapper
- `btch-downloader`: TikTok content downloader library
- `fluent-ffmpeg`: Video transcoding and compression
- `sharp`: Image processing for photo slideshows
- `express`: HTTP server for health checks and webhooks
- `axios` / `node-fetch`: HTTP clients for API requests

### Environment Variables
- `BOT_TOKEN`: Telegram bot authentication token
- `DEVELOPER_ID`: Admin user ID for privileged commands
- `GROUP_ID`: Associated Telegram group ID
- `PORT`: Server port (default: 5000)

### Data Storage
- JSON file-based persistence in `data/backups/`
- `users_backup.json`: User preferences and language settings
- `other_backup.json`: Additional bot state data
- In-memory `Map` for temporary audio URL storage (`utils/audioStore.js`)