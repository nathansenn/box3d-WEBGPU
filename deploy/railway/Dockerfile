FROM caddy:2-alpine

COPY Caddyfile /etc/caddy/Caddyfile
COPY serve-railway.sh /usr/local/bin/serve-box3d
RUN chmod 755 /usr/local/bin/serve-box3d \
    && caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

COPY index.html release-info.json robots.txt sitemap.xml /srv/box3d/
COPY assets /srv/box3d/assets
COPY studio /srv/box3d/studio
COPY licenses /srv/box3d/licenses
COPY lab.html /srv/box3d/lab.html
COPY box3d /srv/box3d/box3d
COPY textures /srv/box3d/textures
COPY soft-kernels-simd.wasm soft-kernels-scalar.wasm /srv/box3d/

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/serve-box3d"]
