FROM node:18
WORKDIR /app
COPY . .
# VULN: Running as root, no USER directive
# VULN: Copying everything including .env
RUN npm install
EXPOSE 3000
CMD ["node", "server.js"]
