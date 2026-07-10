FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=4000
ENV DB_PATH=/app/data/data.sqlite

RUN mkdir -p /app/data /app/uploads

EXPOSE 4000
# TEMP DIAGNOSTIC: bypass index.js entirely to test whether Node/Docker
# itself can produce any log output at all in this exact environment.
CMD ["node", "-e", "const fs=require('fs'); fs.writeSync(1,'DIAGNOSTIC: node -e is alive, pid '+process.pid+'\n'); let n=0; setInterval(()=>{n++; fs.writeSync(1,'DIAGNOSTIC tick '+n+'\n');}, 1000); require('http').createServer((req,res)=>res.end('ok')).listen(process.env.PORT||4000, '0.0.0.0', ()=>fs.writeSync(1,'DIAGNOSTIC: listening on '+(process.env.PORT||4000)+'\n'));"]
