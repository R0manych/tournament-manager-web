FROM node:22-alpine AS build
WORKDIR /app

# Устанавливаем зависимости отдельным слоем
COPY package*.json ./
RUN npm ci

# Собираем приложение
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS final
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
