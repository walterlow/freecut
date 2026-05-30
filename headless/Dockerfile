# FreeCut headless render service.
#
# Builds the harness (dist/) and runs serve.mjs with one warm headless Chrome.
# Google Chrome (not Chromium) is used so H.264/AAC (proprietary codecs) work;
# Mesa lavapipe provides software Vulkan so WebGPU effects can render without a
# physical GPU. For best performance / guaranteed effects, run on a GPU host
# with passthrough (see README) instead of software Vulkan.
#
# Build (context = repo root):
#   docker build -f headless/Dockerfile -t freecut-headless .
# Run (mount your workspace read-only):
#   docker run --rm -p 8787:8787 -v /path/to/FreeCutProjects:/workspace:ro freecut-headless
#   curl localhost:8787/health    # -> {"ok":true,"gpu":true,...}
FROM node:24-bookworm

# Google Chrome (proprietary codecs) + software Vulkan (lavapipe) for WebGPU + fonts.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates wget gnupg \
 && wget -qO- https://dl.google.com/linux/linux_signing_key.pub \
      | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
 && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" \
      > /etc/apt/sources.list.d/google-chrome.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      google-chrome-stable \
      mesa-vulkan-drivers libvulkan1 vulkan-tools \
      fonts-liberation fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Use the system Google Chrome; don't download Playwright's bundled Chromium.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install deps (ignore lifecycle scripts: the prepare hook sets up git hooks,
# which aren't present/needed in the image).
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Build the harness (dist/headless.html + assets).
COPY . .
RUN npm run build

# Vulkan ICDs are auto-discovered: on a Linux GPU host (run with
# `--gpus all -e NVIDIA_DRIVER_CAPABILITIES=all`) the NVIDIA Vulkan ICD is
# mounted and WebGPU uses the real GPU; otherwise the bundled Mesa lavapipe
# provides software WebGPU. --no-sandbox is required running Chrome as root.
# (To force software even on a GPU host: -e VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.x86_64.json)
ENV FREECUT_CHROME_ARGS="--no-sandbox"
ENV FREECUT_WORKSPACE=/workspace

EXPOSE 8787
CMD ["sh", "-c", "node headless/serve.mjs --workspace \"$FREECUT_WORKSPACE\" --port 8787"]
