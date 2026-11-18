FROM caddy:2-alpine

COPY Caddyfile /etc/caddy/Caddyfile
COPY serve-railway.sh /usr/local/bin/serve-box3d
RUN chmod 755 /usr/local/bin/serve-box3d \
    && caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

COPY index.html release-info.json robots.txt sitemap.xml /srv/box3d/
COPY assets /srv/box3d/assets
COPY studio /srv/box3d/studio
COPY licenses /srv/box3d/licenses

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/serve-box3d"]
