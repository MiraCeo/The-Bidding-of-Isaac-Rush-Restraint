/** Only same-origin absolute directory paths, never a URL or an Nginx directive. */
export function normalizeWebBase(value = '/') {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 200)
    throw new Error('网页base必须是以/开头的目录路径。');
  if (value === '/') return '/';
  const path = value.endsWith('/') ? value.slice(1, -1) : value.slice(1);
  const segments = path.split('/');
  if (segments.some((part) => !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part)))
    throw new Error('网页base包含空目录、特殊字符或路径跳转。');
  return `/${segments.join('/')}/`;
}

const headers =
  'add_header X-Content-Type-Options "nosniff" always;\n    add_header Referrer-Policy "strict-origin-when-cross-origin" always;';
export function nginxConfiguration(value = '/') {
  const base = normalizeWebBase(value);
  return `server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;
  ${headers}
  gzip on;
  gzip_types text/css application/javascript application/json image/svg+xml;
  location = /healthz {
    default_type text/plain;
    add_header Cache-Control "no-store" always;
    ${headers}
    return 200 "ok\\n";
  }
  location ${base}assets/ {
    add_header Cache-Control "public, max-age=604800, immutable" always;
    ${headers}
    try_files $uri =404;
  }
  location ${base}downloads/ {
    add_header Cache-Control "no-cache" always;
    ${headers}
    try_files $uri $uri/ =404;
  }
  location ${base} {
    add_header Cache-Control "no-cache" always;
    ${headers}
    try_files $uri $uri/ ${base}index.html;
  }
${base === '/' ? '' : '  location / { return 404; }'}
}
`;
}

export function runtimeDockerfile(base, version, commit) {
  const directory = normalizeWebBase(base);
  return `ARG NGINX_IMAGE=nginx:1.29-alpine
FROM \${NGINX_IMAGE}
LABEL org.opencontainers.image.title="The Bidding of Isaac" \\
      org.opencontainers.image.version="${version}" \\
      org.opencontainers.image.revision="${commit ?? 'unknown'}"
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY site/ /usr/share/nginx/html${directory}
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \\
  CMD wget -q --spider http://127.0.0.1/healthz || exit 1
`;
}
