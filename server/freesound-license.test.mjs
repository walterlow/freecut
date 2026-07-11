import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  classifyFreesoundLicense,
  isAllowedFreesoundLicense,
} from "./freesound-license.mjs";
import { getPublicStudioAudioStatus } from "./studio-audio-config.mjs";
import { FreesoundService } from "./freesound-service.mjs";

test("permits CC0 and CC BY while excluding NonCommercial and ShareAlike", () => {
  assert.equal(
    isAllowedFreesoundLicense(
      "https://creativecommons.org/publicdomain/zero/1.0/",
    ),
    true,
  );
  assert.equal(
    isAllowedFreesoundLicense("https://creativecommons.org/licenses/by/4.0/"),
    true,
  );
  assert.equal(
    isAllowedFreesoundLicense(
      "https://creativecommons.org/licenses/by-nc/4.0/",
    ),
    false,
  );
  assert.equal(
    isAllowedFreesoundLicense(
      "https://creativecommons.org/licenses/by-sa/4.0/",
    ),
    false,
  );
  assert.equal(classifyFreesoundLicense("").code, "unknown");
});

test("CC0-only policy rejects attributed recordings", () => {
  assert.equal(
    isAllowedFreesoundLicense(
      "https://creativecommons.org/licenses/by/4.0/",
      "cc0-only",
    ),
    false,
  );
});

test("public backend status never exposes credentials", () => {
  const status = getPublicStudioAudioStatus({
    apiKey: "secret-api-key",
    clientId: "client-id",
    clientSecret: "secret-client-value",
    callbackUrl:
      "http://freesound.org/home/app_permissions/permission_granted/",
  });
  const serialized = JSON.stringify(status);
  assert.equal(serialized.includes("secret-api-key"), false);
  assert.equal(serialized.includes("secret-client-value"), false);
  assert.equal(status.callbackMode, "manual-code");
});

test("frontend source does not reference backend credential names", async () => {
  const source = await readFile(
    new URL(
      "../src/features/editor/services/freesound-studio-audio-service.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal(source.includes("FREESOUND_API_KEY"), false);
  assert.equal(source.includes("FREESOUND_CLIENT_SECRET"), false);
});

test("search caches results and excludes incompatible licences", async () => {
  let requestCount = 0;
  let requestedUrl = "";
  const service = new FreesoundService(
    { apiKey: "test-key", clientId: "", clientSecret: "", callbackUrl: "" },
    {
      fetch: async (url) => {
        requestCount += 1;
        requestedUrl = String(url);
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 1,
                name: "Clean rain",
                username: "one",
                license: "https://creativecommons.org/publicdomain/zero/1.0/",
                previews: {
                  "preview-hq-mp3": "https://cdn.freesound.org/rain.mp3",
                },
                tags: ["rain", "ambience"],
                duration: 8,
                samplerate: 48000,
                bitdepth: 24,
              },
              {
                id: 2,
                name: "Restricted rain",
                username: "two",
                license: "https://creativecommons.org/licenses/by-nc/4.0/",
                previews: {
                  "preview-hq-mp3": "https://cdn.freesound.org/restricted.mp3",
                },
                tags: ["rain"],
                duration: 8,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    },
  );
  const first = await service.search({
    query: "rain ambience",
    targetDuration: 8,
  });
  const second = await service.search({
    query: "rain ambience",
    targetDuration: 8,
  });
  assert.deepEqual(
    first.map((sound) => sound.id),
    [1],
  );
  assert.deepEqual(
    second.map((sound) => sound.id),
    [1],
  );
  assert.equal(requestCount, 1);
  assert.match(requestedUrl, /\/apiv2\/search\/text\//);
});

test("cinematic quality mode keeps only stereo 48 kHz recordings with real bit depth", async () => {
  const service = new FreesoundService(
    { apiKey: "test-key", clientId: "", clientSecret: "", callbackUrl: "" },
    {
      fetch: async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                id: 11,
                name: "Cinema impact",
                username: "studio",
                license: "https://creativecommons.org/publicdomain/zero/1.0/",
                previews: { "preview-hq-mp3": "https://cdn.freesound.org/cinema.mp3" },
                tags: ["cinematic", "impact"],
                duration: 4,
                samplerate: 48000,
                bitdepth: 24,
                channels: 2,
              },
              {
                id: 12,
                name: "Phone impact",
                username: "mobile",
                license: "https://creativecommons.org/publicdomain/zero/1.0/",
                previews: { "preview-hq-mp3": "https://cdn.freesound.org/phone.mp3" },
                tags: ["impact"],
                duration: 4,
                samplerate: 44100,
                bitdepth: 16,
                channels: 1,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    },
  );

  const results = await service.search({ query: "cinematic impact", quality: "cinematic" });
  assert.deepEqual(results.map((sound) => sound.id), [11]);
});

test("failed and throttled API requests surface retry information", async () => {
  const service = new FreesoundService(
    { apiKey: "test-key", clientId: "", clientSecret: "", callbackUrl: "" },
    {
      fetch: async () =>
        new Response(JSON.stringify({ detail: "Request was throttled" }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "30" },
        }),
    },
  );
  await assert.rejects(
    service.search({ query: "door close" }),
    (error) => error.status === 429 && error.retryAfter === "30",
  );
});
