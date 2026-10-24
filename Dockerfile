FROM node:22-bookworm-slim

WORKDIR /opt/valet

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir -p /var/lib/valet && chown -R node:node /opt/valet /var/lib/valet

COPY --chown=node:node . .

ENV VALET_HOST=0.0.0.0
ENV VALET_PORT=8787
ENV VALET_DATA_DIR=/var/lib/valet

VOLUME /var/lib/valet
EXPOSE 8787
USER node

CMD ["node", "server/index.js"]
