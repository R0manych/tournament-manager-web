FROM node:22-alpine AS build
WORKDIR /app

# Устанавливаем зависимости отдельным слоем
COPY package*.json ./
RUN npm ci

# Окружение фронта. Vite подставляет переменные НА СБОРКЕ, поэтому значение
# фиксируется здесь и в рантайме уже не меняется: правка `.env` на сервере
# затрагивает только API. Значение по умолчанию — прод: собранный образ
# предназначен для сервера, а тестовые кнопки должны прятаться сами.
ARG VITE_APP_ENV=Production
ENV VITE_APP_ENV=$VITE_APP_ENV

# Собираем приложение
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS final
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
