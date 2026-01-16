const express = require("express");
const cron = require("node-cron");
const fs = require("fs").promises;
const path = require("path");
const { exec } = require("child_process");
const axios = require("axios");

const app = express();
let statsData = {};
let lastUpdatedTime = null;
let accountCache = {};

async function getEmail(configDir) {
  if (accountCache[configDir]) {
    return accountCache[configDir];
  }
  try {
    const accountFile = path.join(configDir, "google_accounts.json");
    const data = await fs.readFile(accountFile, "utf-8");
    const accountInfo = JSON.parse(data);
    if (accountInfo.active) {
      const email = accountInfo.active.replace(/ /g, "");
      accountCache[configDir] = email;
      return email;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

const REMAINING_USAGE_THRESHOLD = process.env.REMAINING_USAGE_THRESHOLD
  ? parseInt(process.env.REMAINING_USAGE_THRESHOLD)
  : 10;

const GEMINI_TIERS = {
  "3-Flash": ["gemini-3-flash-preview"],
  Flash: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"],
  Pro: ["gemini-2.5-pro", "gemini-3-pro-preview"],
};

async function getGeminiOauthCreds() {
  const clientId = process.env.GEMINI_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GEMINI_OAUTH_CLIENT_SECRET;
  return [clientId, clientSecret];
}

async function refreshGeminiToken(refreshToken) {
  const creds = await getGeminiOauthCreds();
  if (!creds) {
    return null;
  }

  const [clientId, clientSecret] = creds;
  const body = {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  };

  try {
    const response = await axios.post(
      "https://oauth2.googleapis.com/token",
      body,
    );
    if (response.status === 200) {
      return response.data;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

async function getGeminiCredentials(configDir) {
  let result = {};
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (apiKey) {
    result.api_key = apiKey;
  }

  const oauthPath = path.join(configDir, "oauth_creds.json");

  try {
    await fs.access(oauthPath);
    const oauthContent = await fs.readFile(oauthPath, "utf-8");
    const oauth = JSON.parse(oauthContent);
    result = { ...result, ...oauth, oauth_path: oauthPath };
  } catch (e) {
    // ignore
  }

  if (result.refresh_token && result.expiry_date) {
    const now = Date.now();
    if (now >= result.expiry_date) {
      const newTokens = await refreshGeminiToken(result.refresh_token);
      if (newTokens && newTokens.access_token) {
        result.access_token = newTokens.access_token;
        result.token_refreshed = true;

        const newExpiryMs = now + newTokens.expires_in * 1000;
        result.expiry_date = newExpiryMs;

        if (result.oauth_path) {
          try {
            const oauthData = JSON.parse(
              await fs.readFile(result.oauth_path, "utf-8"),
            );
            oauthData.access_token = newTokens.access_token;
            oauthData.expiry_date = newExpiryMs;
            await fs.writeFile(
              result.oauth_path,
              JSON.stringify(oauthData, null, 2),
            );
          } catch (e) {
            console.warn(`Warning: Could not save refreshed OAuth token: ${e}`);
          }
        }
      }
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function formatResetTime(isoTime) {
  if (!isoTime) return "N/A";
  try {
    const resetDt = new Date(isoTime);
    const now = new Date();
    const delta = resetDt - now;

    if (delta < 0) return "Now";

    const hours = Math.floor(delta / (1000 * 60 * 60));
    const minutes = Math.floor((delta % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  } catch (e) {
    return isoTime.slice(0, 19);
  }
}

async function getGeminiUsage(configDir, projectIdFromFolder) {
  const creds = await getGeminiCredentials(configDir);
  if (!creds) {
    return {
      error: "No credentials found",
      hint: `No credentials in ${configDir}`,
    };
  }

  const result = {};
  if (creds.token_refreshed) {
    result.token_refreshed = true;
  }

  if (creds.access_token) {
    const headers = {
      Authorization: `Bearer ${creds.access_token}`,
      "Content-Type": "application/json",
    };

    const loadBody = {
      metadata: {
        ideType: "IDE_UNSPECIFIED",
        platform: "PLATFORM_UNSPECIFIED",
        pluginType: "GEMINI",
      },
    };

    try {
      const loadAssistResponse = await axios.post(
        "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
        loadBody,
        { headers },
      );
      const data = loadAssistResponse.data;

      result.auth = "OAuth (Google Account)";
      result.status = "ok";
      if (data.currentTier) {
        result.tier = data.currentTier.name || data.currentTier.id || "unknown";
      }

      const projectId = !data.cloudaicompanionProject
        ? projectIdFromFolder
        : data.cloudaicompanionProject;
      if (projectId) {
        const quotaResponse = await axios.post(
          "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
          { project: projectId },
          { headers },
        );
        const quotaData = quotaResponse.data;
        if (quotaData.buckets) {
          result.models = {};
          for (const bucket of quotaData.buckets) {
            const modelId = Object.entries(GEMINI_TIERS).filter((o) => {
              return o[1].includes(bucket.modelId);
            })[0][0];
            const remaining = bucket.remainingFraction || 0;
            const resetTime = bucket.resetTime;

            const usedPct = Math.round((1 - remaining) * 1000) / 10;
            const remainingPct = Math.round(remaining * 1000) / 10;

            result.models[modelId] = {
              used: `${usedPct}%`,
              remaining: `${remainingPct}%`,
              resets_in: formatResetTime(resetTime),
              low_threshold: remainingPct < REMAINING_USAGE_THRESHOLD,
            };
          }
        }
      }
    } catch (e) {
      if (e.response && e.response.status === 401) {
        result.token_status = "expired";
        result.hint_refresh = "Run 'gemini' to refresh token";
      } else {
        result.error = `API error (${e.response ? e.response.status : "unknown"})`;
        result.hint = e.message;
      }
    }
  } else if (creds.api_key) {
    result.auth = "API Key";
    result.hint =
      "API key doesn't support quota API. Check https://aistudio.google.com";
  }

  if (!result.status) {
    result.status = result.auth ? "authenticated" : "unknown";
  }

  return result;
}

async function fetchGeminiStats() {
  const collectionPath = ".gemini-collection";
  let metrics = [];
  let currentProjectId = null;

  try {
    currentProjectId = (
      await fs.readFile(path.join(".gemini", "current-project"), "utf-8")
    ).trim();
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error(`Error reading current-project file: ${error}`);
    }
  }

  try {
    const entries = await fs.readdir(collectionPath, { withFileTypes: true });
    const subfolders = entries
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    const CONCURRENT_LIMIT = 3;
    const taskQueue = [...subfolders];

    const promises = Array(CONCURRENT_LIMIT)
      .fill(0)
      .map(async () => {
        const results = [];
        while (taskQueue.length > 0) {
          const subfolder = taskQueue.shift();
          if (subfolder) {
            const configDir = path.join(collectionPath, subfolder);
            const usageData = await getGeminiUsage(configDir, subfolder);
            const email = await getEmail(configDir);
            const isCurrent = subfolder === currentProjectId;
            const metric = {
              projectId: subfolder,
              isCurrent,
              ...usageData,
              email,
            };

            if (isCurrent && metric.models && metric.models["Pro"]) {
              metric.isCurrentLow = metric.models["Pro"].low_threshold;
            }
            results.push(metric);
          }
        }
        return results;
      });

    metrics = (await Promise.all(promises)).flat();
  } catch (error) {
    if (error.code === "ENOENT") {
      // do nothing if folder doesn't exist
    } else {
      console.error(`Error reading .gemini-collection: ${error}`);
    }
  }
  let prefer = null;
  let noCurrentProjectDetermined = false;

  // Only proceed with currentProject logic if currentProjectId was successfully read
  if (currentProjectId) {
    const currentMetric = metrics.find((m) => m.projectId === currentProjectId);

    if (currentMetric && currentMetric.models && currentMetric.models["Pro"]) {
      const proRemaining = parseFloat(currentMetric.models["Pro"].remaining);
      if (proRemaining < REMAINING_USAGE_THRESHOLD) {
        // Current project is below threshold, find a better one.
        let bestAlternative = null;
        let maxAlternativeRemaining = -1;
        for (const m of metrics) {
          if (m.projectId !== currentProjectId && m.models && m.models["Pro"]) {
            const rem = parseFloat(m.models["Pro"].remaining);
            if (
              rem >= REMAINING_USAGE_THRESHOLD &&
              rem > maxAlternativeRemaining
            ) {
              maxAlternativeRemaining = rem;
              bestAlternative = m.projectId;
            }
          }
        }
        prefer = bestAlternative;
      }
      // If not below threshold, `prefer` is null.
    } else {
      // Current project has no pro model, or not found in metrics list.
      noCurrentProjectDetermined = true;
    }
  } else {
    // No currentProjectId was found (e.g., ENOENT during initial read).
    noCurrentProjectDetermined = true;
  }

  if (noCurrentProjectDetermined) {
    // Find best project overall
    let maxProRemaining = -1;
    for (const metric of metrics) {
      if (metric.models && metric.models["Pro"]) {
        const remaining = parseFloat(metric.models["Pro"].remaining);
        if (remaining > maxProRemaining) {
          maxProRemaining = remaining;
          prefer = metric.projectId;
        }
      }
    }
  }

  return {
    metrics,
    prefer,
  };
}

// Background task pattern to ensure only one query task runs at a time.
let isQueryTaskRunning = false;
const runQueryTask = async () => {
  if (isQueryTaskRunning) {
    console.log("Query task is already running. Skipping this execution.");
    return;
  }
  isQueryTaskRunning = true;
  try {
    statsData = await fetchGeminiStats();
    lastUpdatedTime = new Date();
  } catch (error) {
  } finally {
    isQueryTaskRunning = false;
  }
};

// Schedule the background task to run every minute.
cron.schedule("* * * * *", runQueryTask);

app.use(express.static("public"));

app.get("/api/stats", (req, res) => {
  res.json({
    ...statsData,
    lastUpdatedTime: lastUpdatedTime,
  });
});

app.put("/api/try-switch", async (req, res) => {
  const preferredProjectId = statsData.prefer;

  // Case 1: A switch is recommended.
  if (preferredProjectId) {
    const srcDir = path.join(".gemini-collection", preferredProjectId);
    const destDir = ".gemini";

    try {
      const entries = await fs.readdir(destDir);
      for (const entry of entries) {
        if (entry !== "tmp") {
          await fs.rm(path.join(destDir, entry), {
            recursive: true,
            force: true,
          });
        }
      }
      await fs.writeFile(
        path.join(destDir, "current-project"),
        preferredProjectId,
        { flag: "w" },
      );
      await fs.cp(srcDir, destDir, {
        recursive: true,
        filter: (source) => path.basename(source) !== "tmp",
      });
      return res.status(200).send(`1|${preferredProjectId}`);
    } catch (error) {
      console.error(`Error switching account: ${error}`);
      return res.status(500).send("Failed to switch account");
    }
  }

  // Case 2: No switch is needed. Find the current project.
  let currentProjectId = null;
  try {
    currentProjectId = (
      await fs.readFile(path.join(".gemini", "current-project"), "utf-8")
    ).trim();
  } catch (error) {
    const currentMetric = statsData.metrics?.find((m) => m.isCurrent);
    if (currentMetric) {
      currentProjectId = currentMetric.projectId;
    }
  }

  if (currentProjectId) {
    return res.status(200).send(`0|${currentProjectId}`);
  }

  return res.status(404).send("No current project could be determined.");
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  // Fetch initial stats on startup
  runQueryTask();
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("SIGINT signal received: closing HTTP server");
  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
});
