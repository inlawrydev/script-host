FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# HF Spaces использует порт 7860
ENV PORT=7860
EXPOSE 7860

CMD ["node", "server.js"]
