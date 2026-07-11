FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=4000
ENV DB_PATH=/app/data/data.sqlite

RUN mkdir -p /app/data /app/uploads

EXPOSE 4000
# Running Node directly as PID 1 (CMD ["node", "index.js"]) is a known bad
# practice in Docker -- Node doesn't handle being PID 1 well (signal
# handling, zombie reaping), and on some container platforms this also
# interferes with stdout/log capture entirely, silently. Wrapping it in a
# shell so `sh` is PID 1 and `node` runs as a normal child process fixed a
# many-hour silent-crash mystery across two different hosting providers.
CMD ["sh", "-c", "node index.js"]
